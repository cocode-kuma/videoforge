import {mkdir,readFile,writeFile,rename,lstat,readdir,copyFile,rm,cp} from 'node:fs/promises';
import {resolve,join,sep,dirname,relative} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from '../../shared/contracts.js';

/** All agent files live in one project checkout; reject links and traversal on reads AND writes. */
export class CreativeWorkspace {
  constructor(readonly root:string) {}
  async path(input:string,create=false):Promise<string> {
    if(!input||input.includes('\0')||input.includes(':')||input.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.env')))throw new AppError(400,'文件路径不合法');
    const target=resolve(this.root,input);
    if(!target.startsWith(resolve(this.root)+sep))throw new AppError(403,'只能操作当前创作工程');
    let cursor=resolve(this.root);
    for(const part of relative(this.root,target).split(sep)) {
      cursor=join(cursor,part);const s=await lstat(cursor).catch(()=>null);
      if(s?.isSymbolicLink())throw new AppError(403,'工程内不允许符号链接');
      if(!s&&!create)throw new AppError(404,'工程文件不存在：'+input);
    }
    if(create)await mkdir(dirname(target),{recursive:true});
    return target;
  }
  async write(path:string,content:string) {
    const target=await this.path(path,true),temp=target+'.tmp-'+randomUUID();
    await writeFile(temp,content);await rename(temp,target);
    return {path,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')};
  }
  async read(path:string,offset=0,length=24000) {
    const content=await readFile(await this.path(path),'utf8');
    return {path,content:content.slice(offset,offset+length),nextOffset:offset+length<content.length?offset+length:null,total:content.length};
  }
  async edit(path:string,before:string,after:string) {
    if(!before)throw new AppError(400,'替换内容不能为空');
    const content=await readFile(await this.path(path),'utf8');
    if(content.split(before).length!==2)throw new AppError(409,'匹配内容必须在文件中恰好出现一次，请先读取文件');
    return this.write(path,content.replace(before,after));
  }
  async append(path:string,content:string) {
    const existing=await readFile(await this.path(path),'utf8');return this.write(path,existing+content);
  }
  async files(dir='',depth=0):Promise<{path:string;bytes:number}[]> {
    const current=dir?await this.path(dir):this.root;
    const entries=await readdir(current,{withFileTypes:true}),result:{path:string;bytes:number}[]=[];
    for(const e of entries) {
      if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','versions'].includes(e.name)||e.name.endsWith('.tmp'))continue;
      const path=(dir?dir+'/':'')+e.name;
      if(e.isDirectory()&&depth<6)result.push(...await this.files(path,depth+1));
      else if(e.isFile())result.push({path,bytes:(await lstat(join(current,e.name))).size});
      if(result.length>=2000)break;
    }
    return result.slice(0,2000);
  }
  async snapshot(label:string) {
    const id=Date.now()+'-'+randomUUID().slice(0,8),folder=join(this.root,'versions',id);await mkdir(folder,{recursive:true});
    const files=await this.files();
    for(const f of files.filter(f=>!f.path.startsWith('.harness/')&&!f.path.startsWith('previews/')&&!f.path.startsWith('exports/'))) {
      const source=await this.path(f.path),target=join(folder,f.path);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
    }
    await writeFile(join(folder,'version.json'),JSON.stringify({id,label,files},null,2));return {id,label};
  }
  async restore(id:string) {
    if(!/^\d+-[a-f0-9]{8}$/.test(id))throw new AppError(400,'版本不存在');
    const folder=await this.path('versions/'+id),meta=JSON.parse(await readFile(join(folder,'version.json'),'utf8'));
    const wanted=new Set<string>(meta.files.map((f:{path:string})=>f.path));
    for(const f of await this.files())if(!wanted.has(f.path)&&!/^(.harness|previews|exports)\//.test(f.path))await rm(await this.path(f.path));
    for(const f of meta.files as {path:string}[]) {
      if(/^(.harness|previews|exports)\//.test(f.path))continue;
      const source=await this.path('versions/'+id+'/'+f.path),target=await this.path(f.path,true);await cp(source,target);
    }
    return {restored:id};
  }
}
