import {Context} from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import LlmRuntime,{createUserMessage,resolveRetryPolicy} from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import * as Checkpoint from '@deepseek-ai/dsh-session-checkpoint-policy';
import * as Retry from '@deepseek-ai/dsh-llm-retry';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import Compaction from '@deepseek-ai/dsh-compaction-basic';
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import {MultimodalAdapter} from './multimodal-adapter.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Config} from '../../shared/config.js';
import {AppError,type TokenUsage} from '../../shared/contracts.js';
import type {AgentTool} from './agent.js';
import type {LoopHooks} from './harness-loop.js';
import {withVideoCreativeDoctrine} from './agentloop-prompts.js';

/** DSH owns turns, inbox, tool dispatch, replay, cancellation and compaction.
 * The product adapter only binds a tenant workspace and projects public events. */
export class NativeHarness {
  constructor(readonly config:Config,readonly signal:AbortSignal,readonly usage:TokenUsage,readonly dir:string,readonly hooks:LoopHooks){}
  async run(system:string,input:unknown,tools:AgentTool[]):Promise<void>{
    system=withVideoCreativeDoctrine(system);
    await mkdir(this.dir,{recursive:true});
    const ctx=new Context(),fibers:any[]=[];
    const mount=async(plugin:any,config?:unknown)=>{const fiber=ctx.plugin(plugin,config);fibers.push(fiber);await fiber;};
    let handle:Awaited<ReturnType<typeof ctx.agents.create>>|undefined;
    let pending=Promise.resolve(),failure:unknown,delivered=false;
    const enqueue=(work:()=>Promise<void>)=>{pending=pending.then(work).catch(error=>{failure??=error;});};
    const texts=new Map<string,string>(),calls=new Map<string,{id:string;name:string;args:unknown}>();
    const phases=new Set<string>(),published=new Map<string,number>();
    const key=join(this.dir,'native-session.json');
    const stored=await readFile(key,'utf8').then(JSON.parse).catch(()=>null);
    let id=SessionId(stored?.id??randomUUID());
    const userMessage=(text:string)=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
    const abort=()=>handle?.agent.cancel({kind:'user'},{keepInbox:true});
    try{
      await mount(SessionStore);await mount(AgentRegistry);await mount(LlmRuntime);
      await mount(SystemPrompt,{persona:system,includeRuntimeContext:false});await mount(ToolRuntime,{mode:'native'});
      ctx.llm.registerAdapter(['deepseek-official'],new MultimodalAdapter({
        options:()=>({baseURL:this.config.baseUrl,apiKeyEnv:'DEEPSEEK_API_KEY' as any,
          defaults:{thinking:this.config.thinking?'enabled':'disabled',reasoningEffort:this.config.thinking?(this.config.thinkingEffort==='max'?'max':'high'):'off'},
          maxTokens:this.config.generationMaxTokens,defaultContextWindow:1000000,models:[],streamIdleTimeoutMs:300000,retryPolicy:resolveRetryPolicy({mode:'normal'},'videoforge')}),
        resolveApiKey:async()=>this.config.apiKey,resolveUserId:()=>('videoforge-local' as any),
      },this.config));
      await mount(Persistence,{root:join(this.dir,'sessions'),compression:'none'});
      await mount(Checkpoint);await mount(Retry);await mount(TokenMeter);await mount(ToolResultPruner);await mount(Compaction,{});
      await mount(AgentLoop,{agents:[]});
      ctx.on('session/event',(_session,event)=>{
        if(event.type==='request/header'){
          const model=this.config.model,record=(this.usage.byModel??={})[model]??={calls:0,promptTokens:0,completionTokens:0,totalTokens:0};
          this.usage.calls++;record.calls++;
        }
        if(!['assistant/chunk','assistant/message','tool/call','tool/result'].includes(event.type))
          enqueue(()=>this.hooks.event?.('event-'+id+'-'+event.seq,event.type,event.data)??Promise.resolve());
        if(event.type==='step/start'){
          const m='dsh-'+id+'-'+event.data.turn+'-'+event.data.step;
          enqueue(()=>this.hooks.phase?.(m,'responding')??Promise.resolve());
        }
        if(event.type==='assistant/chunk'){
          const m='dsh-'+id+'-'+event.data.turn+'-'+event.data.step,chunk=event.data.chunk;
          if(chunk.type==='text-delta'){
            const text=(texts.get(m)??'')+chunk.text;texts.set(m,text);
            if(Date.now()-(published.get(m)??0)>180){published.set(m,Date.now());enqueue(()=>this.hooks.message(m,text,true));}
          }else if(chunk.type==='reasoning-delta'&&!phases.has(m)){
            phases.add(m);enqueue(()=>this.hooks.phase?.(m,'thinking')??Promise.resolve());
          }
        }
        if(event.type==='assistant/message'){
          const m='dsh-'+id+'-'+event.data.turn+'-'+event.data.step;
          const text=event.data.message.content.filter(b=>b.type==='text').map(b=>(b as any).text).join('\n');
          enqueue(async()=>{
            if(text)await this.hooks.message(m,text,false);await this.hooks.phase?.(m,'done');
            const u=event.data.usage;if(u){const model=this.config.model,record=(this.usage.byModel??={})[model]??={calls:0,promptTokens:0,completionTokens:0,totalTokens:0};
              const input=u.inputTokens+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0),total=input+u.outputTokens;
              this.usage.promptTokens+=input;this.usage.completionTokens+=u.outputTokens;this.usage.totalTokens+=total;
              this.usage.cacheReadTokens=(this.usage.cacheReadTokens??0)+(u.cacheReadTokens??0);
              record.promptTokens+=input;record.completionTokens+=u.outputTokens;record.totalTokens+=total;record.cacheReadTokens=(record.cacheReadTokens??0)+(u.cacheReadTokens??0);}
            await this.hooks.checkpoint();
          });
        }
        if(event.type==='tool/call'){
          const d=event.data;let args:unknown;try{args=JSON.parse(d.arguments);}catch{args=d.arguments;}
          const call={id:d.callId,name:d.name,args};calls.set(call.id,call);
          enqueue(()=>this.hooks.tool(call.name,'running',undefined,call));
        }
        if(event.type==='tool/result'){
          const block=event.data.message.content[0],call=calls.get(block.toolCallId);
          if(call){const result=block.content.map(b=>b.type==='text'?(b as any).text:b.type==='image'?'已返回图像':b);
            let value:unknown=result;try{if(result.length===1&&typeof result[0]==='string')value=JSON.parse(result[0]);}catch{}
            enqueue(()=>this.hooks.tool(call.name,block.isError?'error':'done',value,call));}
        }
        if(event.type==='turn/end'&&event.data.reason.kind==='error')failure=event.data.reason.error;
        if(event.type==='step/end')enqueue(()=>this.hooks.checkpoint());
      });
      const setup=async(agentCtx:Context)=>{
        for(const pack of this.config.nativePlugins){
          const module=await import(pack.name),plugin=module.default??module;
          const inject=plugin.inject??module.inject??[];
          const required=Array.isArray(inject)?inject:inject.required??[];
          const missing=required.filter((name:string)=>!agentCtx.get(name));
          if(missing.length)throw new AppError(503,'DSH 插件 '+pack.name+' 缺少依赖：'+missing.join(', '));
          const config=JSON.parse(JSON.stringify(pack.config).replaceAll('{{workspace}}',dirname(this.dir).replace(/\\/g,'/')));
          await agentCtx.plugin(plugin,config);
        }
        for(const tool of tools)agentCtx.tools.register({name:tool.name,description:tool.description,parameters:tool.parameters as Record<string,unknown>,
          output:{schema:{},render:(_args,value)=>{
            const images=(value as any)?.__images??[];
            const clean=Array.isArray(value)||value===null||typeof value!=='object'?value:{...value};if(clean&&typeof clean==='object'&&!Array.isArray(clean))delete (clean as any).__images;
            return [{type:'text',text:JSON.stringify(clean)},...images.map((i:any)=>{
              if(i.type==='text')return i;
              const url=i.image_url?.url??'',match=/^data:([^;]+);base64,(.*)$/.exec(url);
              return match?{type:'image',mediaType:match[1],data:match[2]}:{type:'text',text:'图像无法解析'};
            })] as any;
          }},
          execute:async(args,exec)=>{
            await pending;if(failure)throw failure;this.signal.throwIfAborted();
            const value=await tool.execute(args);
            if(tool.name==='submit_delivery'||tool.name==='finish_response'){delivered=true;exec.concludeTurn();}
            return JSON.parse(JSON.stringify(value??null));
          },
        });
        agentCtx.on('agent/pre-step',async(payload,next)=>{
          await pending;this.signal.throwIfAborted();if(failure)throw failure;
          const updates=await this.hooks.input();
          const planReminder=this.hooks.planReminder?.();
          const decision=await next();
          if(decision.kind!=='enter')return decision;
          return {...decision,messages:[...decision.messages,...updates.map(userMessage),...(planReminder?[userMessage(planReminder)]:[])]};
        });
        agentCtx.on('agent/turn-stopping',async({agent,signal})=>{
          await pending;signal.throwIfAborted();if(failure)throw failure;
          if(!delivered)agent.steer(userMessage('本轮尚未结束。讨论、分析、研究任务用 finish_response 返回答复；制作或修改成片必须完成实际导出、评审并 submit_delivery。存在错误则修复，检查通过则交付，避免反复生成同样的预览。'));
        });
      };
      const agentOptions={provider:'deepseek-official',model:this.config.model,maxTokens:this.config.generationMaxTokens};
      const cwd=dirname(this.dir);
      const restored=stored?await ctx.sessionPersistence.load(id):null;
      if(restored&&restored.meta.cwd!==cwd){
        const previous=id,snapshot=restored;
        id=SessionId(randomUUID());
        handle=await ctx.agents.create({sessionId:id,seed:snapshot.events,meta:{cwd,parentSession:previous,seedLength:snapshot.events.length},agentOptions,setup});
      }else handle=stored?await ctx.agents.resume({resumeSessionId:id,agentOptions,setup}):await ctx.agents.create({sessionId:id,meta:{cwd},agentOptions,setup});
      await writeFile(key,JSON.stringify({id,cwd}));
      this.signal.addEventListener('abort',abort,{once:true});this.signal.throwIfAborted();
      // Legacy checkpoints are reference context, never re-executed tool calls.
      const legacy=!stored?await readFile(join(this.dir,'checkpoint.json'),'utf8').then(JSON.parse).catch(()=>null):null;
      if(legacy)handle.agent.inject(userMessage('旧工程执行历史已保存。以下历史仅供恢复上下文，不重复执行付费工具：'+JSON.stringify(legacy.messages.map((m:any)=>({role:m.role,content:m.content,tool_calls:m.tool_calls})))));
      handle.agent.followup(userMessage(JSON.stringify(input)));
      await handle.agent.whenIdle();await pending;
      await ctx.sessions.flush(handle.agent.session);
      this.signal.throwIfAborted();if(failure)throw new AppError(503,'Agent 执行失败：'+JSON.stringify(failure));
    }finally{
      this.signal.removeEventListener('abort',abort);
      await handle?.dispose();await pending;
      for(const fiber of fibers.reverse())await fiber.dispose();
    }
  }
}
