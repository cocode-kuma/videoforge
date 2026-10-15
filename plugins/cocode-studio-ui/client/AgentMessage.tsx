import React,{useState} from 'react';
import type {Message} from '../../../shared/contracts.js';
import {Terminal,FileText,Search,Globe,Folder,Check,LoaderCircle,AlertCircle,ListChecks,ChevronDown} from 'lucide-react';

export function conversationItems(messages:Message[]){
  const items:{message:Message;tools?:Message[]}[]=[];
  for(const message of messages){
    if(message.kind==='event'||message.kind==='activity')continue;
    if(message.kind==='tool'){
      const previous=items[items.length-1];
      if(previous?.tools&&previous.message.jobId===message.jobId)previous.tools.push(message);
      else items.push({message,tools:[message]});
    }else items.push({message});
  }
  return items;
}
export function ToolActivity({messages}:{messages:Message[]}){
  const rows=messages.map(m=>{
    const name=m.tool?.name??'';
    const Icon=/command|script/.test(name)?Terminal:/search/.test(name)?Search:/browse|web/.test(name)?Globe:/plan/.test(name)?ListChecks:/list/.test(name)?Folder:FileText;
    const status=m.tool?.status;
    const label=/command|script/.test(name)?(status==='running'?'正在运行命令':'已运行命令'):/plan/.test(name)?'已更新计划':m.text.split(' · ')[0];
    return <div className="tool-row" key={m.id}><Icon size={15} strokeWidth={1.6}/><span>{label}</span>{status==='running'?<LoaderCircle size={13} className="spin"/>:status==='error'?<AlertCircle size={13}/>:null}</div>;
  });
  if(messages.length===1)return <div className="tool-stack">{rows}</div>;
  const running=messages.some(m=>m.tool?.status==='running');
  return <details className="tool-stack"><summary>{running?<LoaderCircle size={15} className="spin"/>:<Check size={15}/>}<span>{running?'正在处理':'已完成'} {messages.length} 项操作</span><ChevronDown size={13}/></summary><div className="tool-rows">{rows}</div></details>;
}

export function AgentMessage({message:m,onAnswer,answerEnabled=true}:{message:Message;onAnswer:(text:string)=>Promise<void>;answerEnabled?:boolean}){
  const [answering,setAnswering]=useState(false);
  if(m.kind==='tool')return <ToolActivity messages={[m]}/>;
  if(m.kind==='event'||m.kind==='activity')return null;
  if(m.kind==='question'&&m.question)return <div id={"question-"+m.id} className={`agent-question ${m.question.status==='open'?'awaiting-answer':''}`} role={m.question.status==='open'?'alert':undefined}>{m.question.status==='open'&&<div className="question-badge">需要你的回答</div>}<strong>{m.text}</strong>
    {m.question.status==='open'?<><p>等待你的回答，可以选择下方选项或在输入框回复。</p><div>{m.question.options.map((option,i)=><button key={i} disabled={answering||!answerEnabled} onClick={()=>{setAnswering(true);void onAnswer(option).catch(()=>setAnswering(false));}}>{option}</button>)}</div></>:<p>{m.question.status==='answered'?'已回答：'+m.question.answer:'提问已暂停，继续工程后可接着沟通。'}</p>}
  </div>;
  return <div className="message-text">{m.text}</div>;
}
