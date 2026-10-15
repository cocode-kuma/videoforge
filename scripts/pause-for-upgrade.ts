import {DataStore} from '../plugins/cocode-data-store/index.js';
import {readConfig} from '../shared/config.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const store=new DataStore(readConfig());
// Do not init a second store: init owns restart recovery for a stopped server.
const accounts=JSON.parse(await readFile(join(store.config.dataRoot,'users.json'),'utf8'));
for(const user of accounts.users){
  const projects=await store.listProjects(user.id);
  for(const project of projects)for(const job of project.renders.filter(r=>['queued','rendering','assembling','storyboarding'].includes(r.status))){
    const token=await store.newSession(user.id);
    try{
      const origin='http://127.0.0.1:3088';
      const response=await fetch(origin+`/api/projects/${project.id}/jobs/${job.id}/cancel`,{method:'POST',headers:{Cookie:'cocode_session='+token,'Content-Type':'application/json','X-Cocode-Request':'studio',Origin:origin},body:'{}'});
      if(!response.ok)throw new Error('停止并保存失败：'+response.status+' '+await response.text());
      console.log(JSON.stringify({project:project.id,job:job.id,saved:true}));
    }finally{await store.logout(token);}
  }
}
