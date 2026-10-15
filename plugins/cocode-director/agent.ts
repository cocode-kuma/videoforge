import {z} from 'zod';
import {AppError, type TokenUsage} from '../../shared/contracts.js';
import type {Config} from '../../shared/config.js';
import {setTimeout as delay} from 'node:timers/promises';

export type Message = {role:'system'|'user'|'assistant'|'tool'; content:unknown; tool_calls?:ToolCall[]; tool_call_id?:string};
type ToolCall = {id:string;type:'function';function:{name:string;arguments:string}};
export type AgentTool = {name:string;description:string;parameters:unknown;execute:(args:unknown)=>Promise<unknown>};
type RequestOptions = {system:string;input:unknown;schema:z.ZodType;tools?:AgentTool[];maxTokens?:number;thinking?:boolean;
  images?:{label:string;url:string}[];vision?:boolean;onResponse?:(raw:string)=>Promise<void>};

/** Repair only an extra premature root brace before a known schema field. Never repair partial code or invent values. */
export function parseStructuredResponse(raw:string,schema:z.ZodType):unknown {
  const properties=(z.toJSONSchema(schema) as {properties?:Record<string,unknown>}).properties??{};
  let source=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  for(let attempt=0;;attempt++) {
    try {
      const value=JSON.parse(source);
      // Lossless compatibility: some models put the requested score beside its storyboard.
      const boardSchema=properties.storyboard as {properties?:Record<string,unknown>}|undefined;
      if(boardSchema?.properties?.musicScore&&value?.storyboard&&!value.storyboard.musicScore&&value.musicScore){
        value.storyboard.musicScore=value.musicScore;delete value.musicScore;
      }
      return schema.parse(value);
    }
    catch(error) {
      if(!(error instanceof SyntaxError)||attempt>=2)throw error;
      const position=Number(error.message.match(/after JSON at position (\d+)/)?.[1]);
      if(!Number.isFinite(position))throw error;
      const tail=source.slice(position).match(/^\s*,\s*"([^"\\]+)"\s*:/);
      const before=source.slice(0,position).trimEnd();
      if(!tail||!properties[tail[1]]||!before.endsWith('}'))throw error;
      source=before.slice(0,-1)+source.slice(position);
    }
  }
}

/** A bounded native tool loop. Skills return data; the model never gets shell or arbitrary file access. */
export class CreationAgent {
  constructor(readonly config:Config, readonly signal:AbortSignal, readonly usage:TokenUsage) {}
  async run<T>(options:RequestOptions):Promise<T> {
    const content:unknown = options.images?.length ? [
      {type:'text',text:JSON.stringify(options.input)},
      ...options.images.flatMap(frame=>[{type:'text',text:frame.label},{type:'image_url',image_url:{url:frame.url}}]),
    ] : JSON.stringify(options.input);
    const messages:Message[]=[{role:'system',content:options.system+`\n只返回符合此 JSON Schema 的对象：${JSON.stringify(z.toJSONSchema(options.schema))}`},
      {role:'user',content}];
    let toolCalls=0, formatRepairs=0, truncated=0;
    for(let round=0;round<8;round++) {
      this.signal.throwIfAborted();
      const vision=options.vision;
      const endpoint=vision?this.config.visionBaseUrl:this.config.baseUrl;
      const apiKey=vision?this.config.visionApiKey:this.config.apiKey;
      const model=vision?this.config.visionModel:this.config.model;
      const tools=options.tools??[];
      const thinking=options.thinking??this.config.thinking;
      const body={model,messages,temperature:0.4,max_tokens:Math.min(65536,(options.maxTokens??8000)*(truncated?2:1)),
        ...(!vision?{thinking:{type:thinking?'enabled':'disabled'},...(thinking?{reasoning_effort:this.config.thinkingEffort}:{})}:{}),
        response_format:{type:'json_object'},
        ...(tools.length?{tools:tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters}})),tool_choice:round<4&&!truncated&&!formatRepairs?'auto':'none'}:{}),
      };
      let response:Response|undefined;
      const modelUsage=(this.usage.byModel??={})[model]??= {calls:0,promptTokens:0,completionTokens:0,totalTokens:0};
      for(let attempt=0;attempt<2;attempt++) {
        this.usage.calls++;
        modelUsage.calls++;
        response=await fetch(endpoint.replace(/\/$/,'')+'/chat/completions',{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
          body:JSON.stringify(body),signal:AbortSignal.any([this.signal,AbortSignal.timeout(240000)]),
        });
        if(response.ok||![429,502,503,504].includes(response.status)||attempt===1)break;
        await response.body?.cancel();
        await delay(1000,undefined,{signal:this.signal});
      }
      if(!response?.ok)throw new AppError(503,`创作服务返回 ${response?.status??'异常'}，请检查模型服务`);
      const data=await response.json() as {choices?:{finish_reason?:string;message:{content?:string;reasoning_content?:string;tool_calls?:ToolCall[]}}[];usage?:Record<string,number>};
      const usage=data.usage;
      if(usage)for(const [field,key] of [['promptTokens','prompt_tokens'],['completionTokens','completion_tokens'],['totalTokens','total_tokens']] as const) {
        const count=usage[key]??(key==='total_tokens'?(usage.prompt_tokens??0)+(usage.completion_tokens??0):0);
        if(Number.isFinite(count)&&count>=0){this.usage[field]+=count;modelUsage[field]+=count;}
      }
      const choice=data.choices?.[0];
      if(!choice)throw new AppError(503,'创作服务没有返回内容');
      if(choice.message.content)await options.onResponse?.(choice.message.content);
      if(choice.finish_reason==='length') {
        if(truncated++>=1)throw Object.assign(new AppError(503,'生成内容超过输出预算，请减少内容或调高服务端输出预算'),{diagnostic:'模型输出截断，不能渲染不完整代码'});
        messages.push({role:'user',content:'Harness 检测到上次响应达到输出窗口上限，已扩大本次输出窗口。已有工具结果仍在上下文中。重新返回当前阶段完整有效 JSON，保留全部需求、视觉主体与动作设计；不要以删除内容来处理截断。'});
        continue;
      }
      if(choice.message.tool_calls?.length) {
        if(toolCalls+choice.message.tool_calls.length>12)throw new AppError(503,'本阶段技能调用超出预算');
        // DeepSeek thinking + tool calls require the original reasoning to be carried forward.
        messages.push({...choice.message,role:'assistant',content:choice.message.content??null} as Message);
        for(const call of choice.message.tool_calls) {
          toolCalls++;
          const tool=tools.find(tool=>tool.name===call.function.name);
          let result:unknown;
          try { if(!tool)throw new AppError(400,'未提供此工具');result=await tool.execute(JSON.parse(call.function.arguments)); }
          catch(error) {
            this.signal.throwIfAborted();
            if(error instanceof AppError&&error.status>=500)throw error;
            result={error:error instanceof Error?error.message:'工具参数异常'};
          }
          messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
        }
        continue;
      }
      const raw=choice.message.content??'';
      try { return parseStructuredResponse(raw,options.schema) as T; }
      catch(error) {
        if(formatRepairs++>=2)throw Object.assign(new AppError(503,'创作阶段返回格式错误'),{diagnostic:error instanceof Error?error.message:String(error)});
        messages.push({...choice.message,role:'assistant',content:raw} as Message,{role:'user',content:`修正响应的 JSON 格式和字段，不改变内容方向。${String(error).slice(0,5000)}`});
      }
    }
    throw new AppError(503,'本阶段读取技能次数过多，已停止以控制费用');
  }
}
