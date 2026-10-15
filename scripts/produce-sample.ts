import { mkdir,copyFile,writeFile,readFile,cp,mkdtemp,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import {tmpdir} from 'node:os';
import { DataStore } from '../plugins/cocode-data-store/index.js';
import { Director } from '../plugins/cocode-director/index.js';
import { readConfig } from '../shared/config.js';
import {hyperframesCli} from '../plugins/cocode-director/master.js';
import {runProcess} from '../plugins/cocode-director/process.js';
import {mixAudio,prepareAudio} from '../plugins/cocode-director/audio.js';

const root=process.cwd(), config=readConfig();
const whole=process.argv.includes('--whole');
const oneShot=process.argv.includes('--oneshot');
const output=join(root,'outputs',...(whole?[process.argv.includes('--fresh')?'whole-film-'+Date.now():'whole-film']:oneShot?['oneshot']:[]));await mkdir(output,{recursive:true});
console.log('本次独立任务输出目录：'+output);
// Real production scheduler and real model, with isolated local accounts and no mail.
const store=new DataStore({...config,dataRoot:join(root,'.test-artifacts/sample-data'),logsRoot:join(root,'.test-artifacts/sample-logs'),mailApiUrl:'',mailApiKey:'',officialQuotaApiUrl:'',officialQuotaApiKey:''});
await store.init();
const user=await store.register(`sample-${Date.now()}@example.com`,'sample-production-2026','成片验收','kuma','127.0.0.1');
const project=await store.createProject(user.id,'灵感成片 · DeepSeek 实际生产验收');
const director=new Director(store,{oneShot});
try {
  const job=await director.submit(user.id,project.id,{
    prompt:'为 cocode 酷码工作室制作一支高级感科技品牌短片，主题「灵感成片」。总共3个镜头，每镜头约5秒：一粒青色光点沿明确路径展开成抽象灵感网络；网络聚合成精致视频时间线与画面窗口，按步骤呈现从创意到分镜再到成片；最后线条收束成一个发光播放符号并落到品牌终章。深海蓝背景、青色与暖白，克制的杂志式构图，大字号中文，画面连续发展而不是孤立标题卡。仅使用本地代码生成的 SVG/CSS/GSAP 图形，不使用外链素材与字体。每镜头最多两行文字，不要把说明文字塞进画面。画面主文案依次是「让灵感有形」「让故事发生」「灵感，即刻成片」，副文案最多8个字。用有旋律的轻盈电子背景音乐，结尾自然收束，不要语音。',
    duration:15,aspect:'16:9',style:'cinematic',workflow:'general-video',narrationEnabled:false,music:'generated',captionsEnabled:false
  });
  await writeFile(join(output,'sample-job.json'),JSON.stringify({userId:user.id,projectId:project.id,jobId:job.id},null,2));
  let previous='';
  while(true){
    const p=await store.loadProject(user.id,project.id),r=p.renders.find(r=>r.id===job.id)!;
    if(r.message!==previous){console.log(r.message);previous=r.message;}
    if(r.status==='failed'){
      const dir=join(await store.projectDir(user.id,project.id),'renders',job.id);
      await writeFile(join(output,'sample-report.json'),JSON.stringify({firstAttemptOnly:oneShot,passed:false,render:r,storyboard:p.storyboard,taskDirectory:dir},null,2));
      if(!oneShot)throw new Error(r.error);
      console.log('首次验收未通过；不进行模型修复。正在导出首次结果供查看。');
      const temp=await mkdtemp(join(tmpdir(),'vf-first-output-'));
      try{
        const ready=r.generationMode==='whole-film'?await stat(join(dir,'index.html')).then(()=>true).catch(()=>false):p.storyboard&&(await Promise.all(p.storyboard.scenes.map(scene=>stat(join(dir,scene.id,'composition.html')).then(()=>true).catch(()=>false)))).every(Boolean);
        if(!ready)throw new Error('首次影片代码未完整生成，无法导出预览');
        await cp(dir,temp,{recursive:true});
        await runProcess(process.execPath,[hyperframesCli,'render','--output',join(temp,'final.mp4'),'--fps','30','--quality','standard','--workers','1'],temp,new AbortController().signal,config.renderTimeout);
        await copyFile(join(temp,'final.mp4'),join(dir,'final.mp4'));
        const audio=await readFile(join(dir,'audio-plan.json'),'utf8').then(JSON.parse).catch(()=>prepareAudio(dir,p.brief!,p.storyboard!,p.assets??[],config,new AbortController().signal));await mixAudio(dir,audio,15,config,new AbortController().signal);
        await copyFile(join(dir,'final.mp4'),join(output,'首次输出-未通过验收.mp4'));
        console.log('首次输出已保存，状态仍为未通过验收。');
      }finally{await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:300});}
      break;
    }
    if(r.status==='completed'){
      await copyFile(await store.artifact(user.id,project.id,r.video!),join(output,'灵感成片-DeepSeek.mp4'));
      await writeFile(join(output,'sample-report.json'),JSON.stringify({firstAttemptOnly:oneShot,passed:true,render:r,storyboard:p.storyboard},null,2));
      console.log('实际 AI 成片已保存到 '+join(output,'灵感成片-DeepSeek.mp4'));break;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
} finally {await director.dispose();}
