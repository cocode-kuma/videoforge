import {readFile,readdir,lstat} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {SkillLibrary} from './skills.js';
import {AppError} from '../../shared/contracts.js';

export class CreativeKnowledge {
  constructor(readonly bundled:SkillLibrary,readonly roots:{name:string;path:string}[]) {}
  async requiredSkills() {
    return (await this.entries()).filter(e => /(^|\/)SKILL\.md$/i.test(e.path)
      || e.id === 'creative/tutorial/video-creation.md' || (e.id.startsWith('project/') && /\.md$/i.test(e.path)))
      .map(e => e.id).sort();
  }
  async entries() {
    const files=(await this.bundled.catalog()).files.map(f=>({id:'hyperframes/'+f.path,path:f.path,sha256:f.sha256,root:this.bundled.root}));
    for(const r of this.roots) {
      const visit=async(dir:string,depth=0)=>{
        if(depth>7)return;
        for(const e of await readdir(join(r.path,dir),{withFileTypes:true}).catch(()=>[])) {
          if(e.isSymbolicLink()||e.name.startsWith('.')||e.name==='node_modules')continue;
          const p=dir?dir+'/'+e.name:e.name;
          if(e.isDirectory())await visit(p,depth+1);
          else if(/\.(md|html|js|py|tsx?)$/.test(p))files.push({id:r.name+'/'+p,path:p,sha256:'',root:r.path});
        }
      };await visit('');
    }
    return files;
  }
  async read(id:string,offset=0,length=16000) {
    const e=(await this.entries()).find(e=>e.id===id);if(!e)throw new AppError(404,'技能文件不存在');
    const target=resolve(e.root,e.path);if(!target.startsWith(resolve(e.root)+sep)||(await lstat(target)).isSymbolicLink())throw new AppError(403,'技能路径不合法');
    const content=await readFile(target,'utf8'),hash=createHash('sha256').update(content).digest('hex');
    if(e.sha256&&hash!==e.sha256)throw new AppError(503,'技能哈希不匹配');
    return {path:id,content:content.slice(offset,offset+length),nextOffset:offset+length<content.length?offset+length:null,total:content.length,sha256:hash};
  }
  async search(query:string) {
    const terms=query.toLowerCase().split(/[\s，,]+/).filter(Boolean),files=await this.entries();
    const aliases:Record<string,string[]>={'三维':['three','blender'],'配音':['audio','narration','voice'],'字幕':['caption'],'矢量':['svg'],'动画':['animation','motion'],'字体':['typography','font'],'着色器':['shader','webgl'],'图片':['image','media'],'故事':['story'],'构图':['composition','design']};
    for(const [key,values] of Object.entries(aliases))if(query.includes(key))terms.push(...values);
    const scored=[];
    for(const e of files) {
      const body=(await readFile(join(e.root,e.path),'utf8')).slice(0,30000),lower=body.toLowerCase();
      const score=terms.reduce((n,t)=>n+(e.id.toLowerCase().includes(t)?5:0)+(lower.includes(t)?1:0),0);
      if(score)scored.push({path:e.id,score,description:body.replace(/[#`*]/g,'').split('\n').filter(s=>s.trim()).slice(0,3).join(' ').slice(0,220)});
    }
    return scored.sort((a,b)=>b.score-a.score).slice(0,20);
  }
}
