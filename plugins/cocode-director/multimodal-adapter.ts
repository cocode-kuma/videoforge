import {DeepSeekAdapter,type DeepSeekAdapterOptions} from '@deepseek-ai/dsh-llm-deepseek';
import {CallId,LlmError,type GenerateOptions,type StreamChunk} from '@deepseek-ai/dsh-llm';
import {EventSourceParserStream} from 'eventsource-parser/stream';
import type {Config} from '../../shared/config.js';

const text=(blocks:any[])=>blocks.filter(b=>b.type==='text').map(b=>b.text).join('');
const images=(blocks:any[])=>blocks.filter(b=>b.type==='image').map(b=>({type:'image_url',image_url:{url:`data:${b.mediaType};base64,${b.data}`}}));
export function multimodalMessages(options:GenerateOptions){
  const wire:any[]=options.system?[{role:'system',content:options.system}]:[];
  let pending:any[]=[];
  const flush=()=>{if(pending.length){wire.push({role:'user',content:pending});pending=[];}};
  for(const m of options.messages){
    const blocks=m.content as any[],tools=blocks.filter(b=>b.type==='tool-result');
    if(!tools.length)flush();
    if(m.role==='assistant'){
      const calls=blocks.filter(b=>b.type==='tool-call').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:b.arguments}}));
      const reasoning=blocks.filter(b=>b.type==='reasoning').map(b=>b.text).join('');
      wire.push({role:'assistant',content:text(blocks),...(calls.length?{tool_calls:calls,reasoning_content:reasoning}:{})});
    }else{
      const media=images(blocks),body=text(blocks);
      if(body||media.length||!tools.length)wire.push({role:m.role==='system'?'system':'user',content:media.length?[{type:'text',text:body},...media]:body});
      for(const tool of tools){
        wire.push({role:'tool',tool_call_id:tool.toolCallId,content:text(tool.content)||'图片已附在后续用户消息'});
        const media=images(tool.content);if(media.length)pending.push({type:'text',text:'工具 '+tool.toolCallId+' 返回的实际图片：'},...media);
      }
    }
  }
  flush();return wire;
}

/** Keep the upstream text route; add real image transport and Qwen's thinking controls. */
export class MultimodalAdapter extends DeepSeekAdapter{
  constructor(options:DeepSeekAdapterOptions,private vfConfig:Config){super(options);}
  async *stream(options:GenerateOptions):AsyncGenerator<StreamChunk>{
    const hasImages=options.messages.some(m=>(m.content as any[]).some(b=>b.type==='image'||b.type==='tool-result'&&b.content.some((c:any)=>c.type==='image')));
    const qwen=options.model.startsWith('qwen');
    if(!hasImages&&!qwen){yield* super.stream(options);return;}
    const thinking=this.vfConfig.thinking&&options.reasoningEffort!=='off'&&options.purpose!=='session-title';
    const body={model:options.model,messages:multimodalMessages(options),stream:true,stream_options:{include_usage:true},
      max_tokens:options.maxTokens??this.vfConfig.generationMaxTokens,
      ...(options.tools?.length?{tools:options.tools.map(t=>({type:'function',function:t}))}:{}),
      ...(options.temperature!==undefined?{temperature:options.temperature}:{}),
      ...(qwen?{enable_thinking:thinking,preserve_thinking:true,reasoning_effort:thinking?'high':'none'}:{thinking:{type:thinking?'enabled':'disabled'},...(thinking?{reasoning_effort:this.vfConfig.thinkingEffort}:{})})};
    const response=await fetch(this.vfConfig.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.vfConfig.apiKey},body:JSON.stringify(body),signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(300000)])});
    if(!response.ok||!response.body){await response.body?.cancel();throw new LlmError('模型接口返回 HTTP '+response.status,response.status===429?'RATE_LIMITED':'PROVIDER_ERROR');}
    const reader=response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader();
    const blocks:any[]=[],tools=new Map<number,any>();let finish='stop',usage:any,done=false;
    const open=(kind:string)=>{const b={index:blocks.length,kind,text:''};blocks.push(b);return b;};
    try{
      while(!done){
        const next=await reader.read();if(next.done)throw new LlmError('模型流未完整结束','INCOMPLETE_RESPONSE');
        if(next.value.data==='[DONE]'){done=true;break;}
        const chunk=JSON.parse(next.value.data);if(chunk.error)throw new LlmError('模型流返回错误','PROVIDER_ERROR');if(chunk.usage)usage=chunk.usage;
        const choice=chunk.choices?.[0],delta=choice?.delta;if(choice?.finish_reason)finish=choice.finish_reason;
        for(const [field,kind] of [['reasoning_content','reasoning'],['content','text']] as const){
          if(!delta?.[field])continue;let b=blocks.find(b=>b.kind===kind);
          if(!b){b=open(kind);yield {type:'block-start',index:b.index,blockType:kind};}
          b.text+=delta[field];yield {type:kind==='text'?'text-delta':'reasoning-delta',index:b.index,text:delta[field]};
        }
        for(const call of delta?.tool_calls??[]){
          let b=tools.get(call.index);if(!b){b=open('tool-call');tools.set(call.index,b);yield {type:'block-start',index:b.index,blockType:'tool-call'};}
          if(call.id)b.id=call.id;if(call.function?.name)b.name=(b.name??'')+call.function.name;
          b.text+=call.function?.arguments??'';
          yield {type:'tool-call-delta',index:b.index,id:CallId(b.id??''),...(call.function?.name?{name:call.function.name}:{}),argumentsDelta:call.function?.arguments??''};
        }
      }
      if(!blocks.length)throw new LlmError('模型没有返回内容','EMPTY_RESPONSE');
      for(const b of blocks)yield {type:'block-end',index:b.index,block:b.kind==='tool-call'?{type:'tool-call',id:CallId(b.id),name:b.name,arguments:b.text}:{type:b.kind,text:b.text}} as StreamChunk;
      if(usage){const cached=usage.prompt_tokens_details?.cached_tokens??usage.prompt_cache_hit_tokens??0;yield {type:'usage',usage:{inputTokens:usage.prompt_tokens-cached,outputTokens:usage.completion_tokens,cacheReadTokens:cached}};}
      yield {type:'finish',reason:finish==='tool_calls'?{kind:'tool-calls'}:finish==='length'?{kind:'max-tokens'}:{kind:'stop'}};
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
}
