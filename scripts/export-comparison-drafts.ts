import {cp,readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readConfig} from '../shared/config.js';
import {CreativeWorkspace} from '../plugins/cocode-director/workspace.js';
import {CreativeRuntime,cleanExecutionEnv} from '../plugins/cocode-director/creative-runtime.js';
import {runProcess} from '../plugins/cocode-director/process.js';
const output=resolve('.test-artifacts/model-comparison/drafts'),config=readConfig();
const sources={qwen:'.test-artifacts/model-comparison/qwen/data/6d544dca-ac83-4163-b220-9d0a825a993c/2a0e73bd-e9ce-47fc-9f94-526d7b4253bc/renders/1116c930-bc82-4f8a-a2e9-b05fc6f6dc37/workspace',deepseek:'.test-artifacts/model-comparison/deepseek/data/10e6530a-2951-4c92-843b-a952b81ad676/210f48a1-fd19-4443-a686-60f54d3019b7/renders/a6196119-cec4-4d34-8457-aec362d3c754/workspace'};
await mkdir(output,{recursive:true});const report=[];
for(const [model,source] of Object.entries(sources)){
  const root=join(output,model+'-workspace');
  await cp(resolve(source),root,{recursive:true,filter:p=>!/[\\/](?:\.harness|\.cache|\.render-[^\\/]+|previews|exports)(?:[\\/]|$)/.test(p)});
  const workspace=new CreativeWorkspace(root),spec=JSON.parse(await readFile(join(root,'project.json'),'utf8'));
  console.log(model+'：正在导出已有工程草稿');
  const runtime=new CreativeRuntime(config,workspace,new AbortController().signal,async text=>{console.log(model+'：'+text);});
  await runtime.prepareLibraries();
  await runtime.render(spec,'exports/draft.mp4',{benchmark:{capture:'cdp',workers:6,stream:false}});
  const video=join(output,model+'-draft.mp4');await copyFile(join(root,'exports/draft.mp4'),video);
  const probe=JSON.parse(await runProcess(config.ffprobe,['-v','error','-count_frames','-show_entries','format=duration:stream=width,height,nb_read_frames','-of','json',video],root,new AbortController().signal,60000,undefined,cleanExecutionEnv()));
  if(Number(probe.streams[0].nb_read_frames)!==Math.round(spec.duration*spec.fps))throw Error(model+' 草稿帧数不完整');
  report.push({model,video,probe,notice:'由模型已保存源码直接导出，未完成最终评审，不代表最终质量或公平的完整流程成绩。'});
  await writeFile(join(output,'draft-report.json'),JSON.stringify(report,null,2));
  console.log(model+'：草稿已导出 '+video);
}
