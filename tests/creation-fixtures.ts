import {fixtureBoard} from './fixtures.js';
export const creationBoard=structuredClone(fixtureBoard);
creationBoard.scenes.forEach(scene=>scene.narration='');
export const creationHtml=`<!doctype html><html><head><meta charset="utf-8"><script src="gsap.min.js"></script><style>html,body{margin:0;background:#101b12}#main{position:relative;width:1280px;height:720px;overflow:hidden;background:#101b12;color:#f2f8ed}h1{position:absolute;left:100px;top:90px;margin:0;font:64px Arial}#ball{position:absolute;left:100px;top:300px;width:120px;height:120px;border-radius:50%;background:#b8ef88}#h2{opacity:0}#brand{position:absolute;left:100px;bottom:40px;font:24px Arial}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="15" data-width="1280" data-height="720"><h1 id="h1">让灵感发生</h1><h1 id="h2">想象，成为作品</h1><div id="ball"></div><div id="brand">cocode 酷码工作室 · Cocode Studio VideoForge</div></div><script>const tl=gsap.timeline({paused:true});tl.to('#ball',{x:800,duration:15,ease:'none'},0);tl.set('#h1',{opacity:0},7.5);tl.set('#h2',{opacity:1},7.5);window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script></body></html>`;
export function stageName(system:string) {
  return system.includes('阶段1/5')?'story':system.includes('阶段2/5')?'design':system.includes('阶段3/5')?'motion':system.includes('阶段4/5')?'code':system.includes('阶段5/5')?'delivery':system.includes('根据真实诊断进行局部修复')?'repair':'review';
}
export function creationResponse(stage:string,html=creationHtml) {
  const board=structuredClone(creationBoard);
  if(stage==='story')return {title:board.title,concept:board.concept,emotionalArc:board.emotionalArc,requirements:['两个主文案清晰可读'],storyBeats:['灵感展开','世界形成'],assetStrategy:'原创代码图形',capabilityNotes:[]};
  if(stage==='design')return {designSpec:board.designSpec,visualStyle:board.visualStyle,keyframes:[{at:1,composition:'标题与主体分层',subject:'绿色星球',lighting:'清晰高对比'}],assetUsage:[]};
  if(stage==='motion')return {scenes:board.scenes,choreography:[{start:0,end:15,subject:'绿色星球',action:'从左向右平滑移动',transition:'连续运动'}]};
  if(stage==='code')return {html};
  if(stage==='delivery')return {storyboard:board};
  if(stage==='repair')return {html,storyboard:board};
  return {passed:true,issues:[],summary:'内容与代码符合需求'};
}
