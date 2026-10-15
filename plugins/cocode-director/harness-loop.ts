import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Config} from '../../shared/config.js';
import {AppError,type TokenUsage} from '../../shared/contracts.js';
import type {AgentTool} from './agent.js';
import {withVideoCreativeDoctrine} from './agentloop-prompts.js';

type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
type Chat={role:'system'|'user'|'assistant'|'tool';content:unknown;reasoning_content?:string;tool_calls?:ToolCall[];tool_call_id?:string};
export type LoopHooks={message:(id:string,text:string,streaming:boolean)=>Promise<void>;input:()=>Promise<string[]>;
  checkpoint:()=>Promise<void>;state:()=>Promise<unknown>;tool:(name:string,status:'running'|'done'|'error',result?:unknown,call?:{id:string;args:unknown})=>Promise<void>;
  phase?:(id:string,status:'thinking'|'responding'|'done')=>Promise<void>;
  event?:(id:string,type:string,data:unknown)=>Promise<void>;
  planReminder?:()=>string|undefined};

async function atomic(path:string,data:unknown){const temp=path+'.tmp';await writeFile(temp,JSON.stringify(data));await rename(temp,path);}
/** Persistent native agent loop. No fixed creative stages or compulsory whole-code response. */
export class HarnessLoop {
  constructor(readonly config:Config,readonly signal:AbortSignal,readonly usage:TokenUsage,readonly dir:string,readonly hooks:LoopHooks) {}
  async run(system:string,input:unknown,tools:AgentTool[]):Promise<void> {
    system=withVideoCreativeDoctrine(system);
    await mkdir(this.dir,{recursive:true});
    const saved=await readFile(join(this.dir,'checkpoint.json'),'utf8').then(raw=>JSON.parse(raw) as {messages:Chat[]}).catch(()=>null);
    let messages:Chat[]=saved?.messages??[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}];
    messages[0]={role:'system',content:system};
    // Resolve an interrupted tool boundary from its journal; never replay an uncertain external action.
    let lastIndex=-1;for(let i=messages.length-1;i>=0;i--)if(messages[i].role==='assistant'&&messages[i].tool_calls){lastIndex=i;break;}
    const last=messages[lastIndex];
    const resolved=new Set(messages.slice(lastIndex+1).filter(m=>m.role==='tool').map(m=>m.tool_call_id));
    if(last?.tool_calls)for(const call of last.tool_calls.filter(c=>!resolved.has(c.id))) {
      const result=await readFile(join(this.dir,'tool-'+this.safeId(call.id)+'.json'),'utf8').then(JSON.parse).catch(()=>({error:'该工具执行被中断，结果不确定。先检查工程及素材，不要重复付费生成。'}));
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
    }
    if(saved)messages.push({role:'user',content:'恢复后的工程信息与用户消息，以其中最新用户要求为准：'+JSON.stringify(input)});
    let consecutive=0,previous='';
    const deadline=this.signal;
    for(;;) {
      deadline.throwIfAborted();
      const inputUpdates=await this.hooks.input();
      for(const text of inputUpdates)messages.push({role:'user',content:text});
      // Compact old observations, retaining the user brief, recent exchanges, full current tool groups and persisted project state.
      if(JSON.stringify(messages).length>60000&&messages.length>12) {
        let start=Math.max(2,messages.length-8);while(start>2&&messages[start].role==='tool')start--;
        const requests=messages.slice(2,start).filter(m=>m.role==='user'&&typeof m.content==='string'&&!m.content.startsWith('工作区是事实来源。'));
        messages=[messages[0],messages[1],...requests,{role:'user',content:'工作区是事实来源。历史工具输出已归档，源码按需分页读取。当前状态：'+JSON.stringify(await this.hooks.state())},...messages.slice(start)];
      }
      await atomic(join(this.dir,'checkpoint.json'),{messages});await this.hooks.checkpoint();
      const model=this.config.model,perModel=(this.usage.byModel??={})[model]??={calls:0,promptTokens:0,completionTokens:0,totalTokens:0};
      const publicId=randomUUID();let publicText='',lastPublish=0;
      await this.hooks.phase?.(publicId,'responding');
      const publish=async(force=false)=>{if(publicText&&(force||Date.now()-lastPublish>180)){lastPublish=Date.now();await this.hooks.message(publicId,publicText,!force);}};
      this.usage.calls++;perModel.calls++;
      const response=await fetch(this.config.baseUrl.replace(/\/$/,'')+'/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.config.apiKey},signal:deadline,
        body:JSON.stringify({model,messages,stream:true,stream_options:{include_usage:true},max_tokens:this.config.generationMaxTokens,
          thinking:{type:this.config.thinking?'enabled':'disabled'},...(this.config.thinking?{reasoning_effort:this.config.thinkingEffort}:{}),
          tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}})),tool_choice:'auto'}),
      });
      if(!response.ok)throw new AppError(503,'DeepSeek 创作服务返回 '+response.status+'，工程已保存，可以继续');
      const calls=new Map<number,ToolCall>();let reasoning='',finish='';
      const consume=async(data:any)=>{
        const choice=data.choices?.[0],delta=choice?.delta??choice?.message??{};
        if(delta.content){publicText+=delta.content;await publish();}
        if(delta.reasoning_content){if(!reasoning)await this.hooks.phase?.(publicId,'thinking');reasoning+=delta.reasoning_content;}
        for(const item of delta.tool_calls??[]){const i=item.index??calls.size,call=calls.get(i)??{id:'',type:'function',function:{name:'',arguments:''}};if(item.id)call.id=item.id;if(item.function?.name)call.function.name+=item.function.name;if(item.function?.arguments)call.function.arguments+=item.function.arguments;calls.set(i,call);}
        if(choice?.finish_reason)finish=choice.finish_reason;
        if(data.usage)for(const [a,b] of [['promptTokens','prompt_tokens'],['completionTokens','completion_tokens'],['totalTokens','total_tokens']] as const){const n=data.usage[b]??(a==='totalTokens'?(data.usage.prompt_tokens??0)+(data.usage.completion_tokens??0):0);if(Number.isFinite(n)&&n>=0){const previousUsage=(consume as any).usage??={};const deltaUsage=n-(previousUsage[a]??0);if(deltaUsage>0){this.usage[a]+=deltaUsage;perModel[a]+=deltaUsage;previousUsage[a]=n;}}}
      };
      if(response.headers.get('content-type')?.includes('text/event-stream')) {
        if(!response.body)throw new AppError(503,'创作服务没有返回消息');
        const decoder=new TextDecoder();let buffer='';
        for await(const chunk of response.body as any) {
          deadline.throwIfAborted();buffer+=decoder.decode(chunk,{stream:true});
          let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(line.startsWith('data:')&&line.slice(5).trim()!=='[DONE]')await consume(JSON.parse(line.slice(5)));}
        }
        if(buffer.trim().startsWith('data:')&&!buffer.includes('[DONE]'))await consume(JSON.parse(buffer.trim().slice(5)));
      } else await consume(await response.json());
      await publish(true);
      await this.hooks.phase?.(publicId,'done');
      // Images have now been observed by the model. Keep file labels, not the same
      // image payload on every subsequent turn; inspect_artifact can observe again.
      for(const message of messages)if(message.role==='user'&&Array.isArray(message.content)){
        const parts=message.content as {type:string;text?:string}[];
        if(parts.some(p=>p.type==='image_url'))message.content=parts.filter(p=>p.type==='text').map(p=>p.text).join('\n')+'\n以上画面已查看并保存在工程。需要重新观察时调用 inspect_artifact；不要依据未重新检查的旧画面判断新修改。';
      }
      const assistant:Chat={role:'assistant',content:publicText||null,...(reasoning?{reasoning_content:reasoning}:{}),...(calls.size?{tool_calls:[...calls.values()]}:{})};
      if(finish==='length') {
        if(!calls.size)messages.push(assistant);
        await this.hooks.message(randomUUID(),'本次输出窗口已满，将保留文件并继续分段操作。',false);
        messages.push({role:'user',content:'输出窗口已耗尽。已完成工程仍在工作区；读取检查后继续完成文件，不缩减需求，不重复整片输出。使用 write_file/edit_file 将工作分成可保存的操作。'});
        await atomic(join(this.dir,'checkpoint.json'),{messages});continue;
      }
      messages.push(assistant);await atomic(join(this.dir,'checkpoint.json'),{messages});
      if(!calls.size){messages.push({role:'user',content:'请继续操作工作区完成任务。只有 submit_delivery 成功后才能结束。你可以先说明计划，再调用相关工具。'});continue;}
      let delivered=false;const observations:unknown[]=[];
      for(const call of calls.values()) {
        deadline.throwIfAborted();const tool=tools.find(t=>t.name===call.function.name);let result:unknown;
        const callInfo={id:call.id,args:(()=>{try{return JSON.parse(call.function.arguments);}catch{return call.function.arguments;}})()};
        await this.hooks.tool(call.function.name,'running',undefined,callInfo);
        const signature=call.function.name+call.function.arguments;
        try {
          if(!tool)throw new AppError(400,'工具不存在');
          if(call.function.name==='submit_delivery'&&call!==[...calls.values()].at(-1))throw new AppError(409,'submit_delivery 必须是本次工具组的最后操作；先完成修改再提交');
          if(signature===previous&&consecutive>=3)throw new AppError(409,'重复操作没有进展，请读取诊断并改变策略');
          result=await tool.execute(JSON.parse(call.function.arguments));
          if(result&&typeof result==='object'&&'__images' in result) {
            const object=result as {__images:unknown[]};const images=object.__images;
            result={...object};delete (result as any).__images;
            messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
            observations.push(...images);
          } else messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
          consecutive=signature===previous?consecutive+1:0;
          await this.hooks.tool(call.function.name,'done',result,callInfo);
          delivered||=call.function.name==='submit_delivery'&&(result as any)?.accepted===true;
        } catch(error) {
          deadline.throwIfAborted();result={error:error instanceof Error?error.message:String(error),diagnostic:(error as any)?.diagnostic};
          messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
          consecutive=signature===previous?consecutive+1:1;await this.hooks.tool(call.function.name,'error',result,callInfo);
        }
        previous=signature;
        await atomic(join(this.dir,'tool-'+this.safeId(call.id)+'.json'),result);
        await atomic(join(this.dir,'checkpoint.json'),{messages});await this.hooks.checkpoint();
      }
      if(observations.length)messages.push({role:'user',content:observations});
      const updates=await this.hooks.input();
      for(const text of updates)messages.push({role:'user',content:text});
      await atomic(join(this.dir,'checkpoint.json'),{messages});await this.hooks.checkpoint();
      if(delivered&&!updates.length)return;
    }
  }
  private safeId(id:string){return id.replace(/[^\w-]/g,'').slice(0,160);}
}
