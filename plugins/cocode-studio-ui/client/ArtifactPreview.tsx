import React, {useState,useRef,useEffect,useId} from 'react';
import {createPortal} from 'react-dom';
import {Image, Maximize2, Download, X, Play} from 'lucide-react';
import type {Message} from '../../../shared/contracts.js';

export function FinalVideo({url,duration}:{url:string;duration?:number}){
  const [open,setOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),titleId=useId();
  const downloadUrl=url+'?download=1';
  useEffect(()=>{
    if(!open)return;
    dialog.current?.showModal();
    return ()=>trigger.current?.focus();
  },[open]);
  return <div className="final-video-card">
    <button ref={trigger} className="final-video-trigger" aria-haspopup="dialog" onClick={()=>setOpen(true)}><span className="final-video-play"><Play size={21}/></span><span><strong>预览成片</strong><small>{duration?`${duration} 秒 · `:''}点击打开播放器</small></span><Maximize2 size={16}/></button>
    <a href={downloadUrl}><Download size={15}/>下载视频</a>
    {open&&createPortal(<dialog ref={dialog} className="artifact-lightbox final-video-dialog" aria-labelledby={titleId} onCancel={()=>setOpen(false)} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <div className="artifact-lightbox-header"><span><Play size={16}/><strong id={titleId}>成片预览</strong></span><button aria-label="关闭成片预览" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <div className="artifact-lightbox-canvas"><video src={url} controls playsInline autoPlay preload="metadata" aria-label="最终成片预览"/></div>
      <div className="artifact-lightbox-footer"><span>{duration?`成片 · ${duration} 秒`:'最终成片'}</span><a href={downloadUrl}><Download size={14}/>下载视频</a></div>
    </dialog>,document.body)}
  </div>;
}

export function ArtifactPreview({artifact,url}:{artifact:NonNullable<Message['attachments']>[number];url:string}){
  const [open,setOpen]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),titleId=useId();
  useEffect(()=>{
    if(!open)return;
    dialog.current?.showModal();
    return ()=>trigger.current?.focus();
  },[open]);
  if(artifact.kind==='image')return <div className="artifact-preview">
    <button ref={trigger} className="artifact-preview-toggle" aria-haspopup="dialog" onClick={()=>setOpen(true)}>
      <Image size={15}/><span>{artifact.label}</span><small>查看画面</small><Maximize2 size={13}/>
    </button>
    {open&&createPortal(<dialog ref={dialog} className="artifact-lightbox" aria-labelledby={titleId} onCancel={()=>setOpen(false)} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
      <div className="artifact-lightbox-header"><span><Image size={16}/><strong id={titleId}>{artifact.label}</strong></span><button aria-label="关闭画面预览" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <div className="artifact-lightbox-canvas"><img src={url} alt={artifact.label}/></div>
      <div className="artifact-lightbox-footer"><span>关键画面预览</span><a href={url+'&download=1'}><Download size={14}/> 下载画面</a></div>
    </dialog>,document.body)}
  </div>;
  return <div className="creative-artifact">
    {artifact.kind==='video'?<video src={url} controls preload="metadata"/>:artifact.kind==='audio'?<audio src={url} controls preload="metadata"/>:null}
    <a href={url+'&download=1'}>{artifact.label} · 下载</a>
  </div>;
}
