import React,{useEffect,useRef} from 'react';
import {Check,ArrowRight,Sparkles,X} from 'lucide-react';

export function PromptPolish({result,onClose}:{result:string|null;onClose:()=>void}) {
  const card=useRef<HTMLElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;card.current?.focus();return()=>previous?.focus();},[]);
  const keyboard=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();onClose();}
    if(event.key==='Tab'){
      const targets=card.current?.querySelectorAll<HTMLElement>('button,[tabindex="0"]');if(!targets?.length)return;
      const first=targets[0],last=targets[targets.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===card.current)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===card.current)){event.preventDefault();first.focus();}
    }
  };
  return <div className="prompt-polish-backdrop">
    <section ref={card} tabIndex={-1} onKeyDown={keyboard} className={'prompt-polish-card'+(result?' is-complete':'')} role="dialog" aria-modal="true" aria-labelledby="polish-title" aria-describedby="polish-description">
      <button className="polish-close" aria-label={result?'关闭润色结果':'取消润色'} onClick={onClose}><X size={18}/></button>
      <div className="polish-art" aria-hidden="true">
        <div className="polish-halo"/><div className="polish-orbit orbit-one"/><div className="polish-orbit orbit-two"/>
        <div className="polish-spark">{result?<Check size={30}/>:<Sparkles size={30}/>}</div>
        <span className="polish-token token-one">叙事</span><span className="polish-token token-two">画面</span><span className="polish-token token-three">节奏</span>
      </div>
      <div className="polish-eyebrow">VIDEOFORGE · CREATIVE INTELLIGENCE</div>
      <h2 id="polish-title">{result?'创意，已经清晰成形':'让灵感，成为好作品'}</h2>
      <p id="polish-description">{result?'润色后的提示词已交给创作 AI，制作正在继续。':'AI 正在结合教程与专业技能，整理你的创作要求。'}</p>
      {result?<div className="polish-result" tabIndex={0}>{result}</div>:<div className="polish-lines" aria-hidden="true"><i/><i/><i/><i/></div>}
      <div className="polish-footer" role="status" aria-live="polite">
        {result?<><span><Check size={14}/> 已使用润色后的提示词</span><button onClick={onClose}>查看创作进展 <ArrowRight size={15}/></button></>:
          <><span className="polish-pulse"/> 保留你的原意，让细节更准确 <span className="polish-dots">···</span></>}
      </div>
    </section>
  </div>;
}
