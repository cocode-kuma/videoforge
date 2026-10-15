import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {AppError} from '../../shared/contracts.js';
import {cleanExecutionEnv} from './creative-runtime.js';

/** Ordered, lossless PNG input; backpressure bounds memory to a few frames. */
export class PngEncoder {
  private child;
  private outcome:Promise<void>;
  private error?:Error;
  private diagnostics='';
  private timer:ReturnType<typeof setTimeout>;
  private stop=()=>{this.child.kill();};
  constructor(ffmpeg:string,fps:number,target:string,cwd:string,private signal:AbortSignal,timeout:number){
    this.child=spawn(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',target],{cwd,env:cleanExecutionEnv(),windowsHide:true,stdio:['pipe','ignore','pipe']});
    this.child.stderr.on('data',chunk=>{this.diagnostics=(this.diagnostics+chunk).slice(-8000);});
    this.child.stdin.on('error',error=>{this.error=error;});
    this.outcome=new Promise((resolve,reject)=>{
      this.child.once('error',reject);
      this.child.once('close',code=>code===0?resolve():reject(new AppError(503,'视频编码失败：'+this.diagnostics)));
    });
    void this.outcome.catch(error=>{this.error=error;});
    this.timer=setTimeout(this.stop,timeout);signal.addEventListener('abort',this.stop,{once:true});
  }
  async write(png:Buffer){
    this.signal.throwIfAborted();if(this.error)throw this.error;
    if(!this.child.stdin.write(png))await Promise.race([
      once(this.child.stdin,'drain',{signal:this.signal}),
      this.outcome.then(()=>{throw new AppError(503,'视频编码器提前结束');}),
    ]);
    if(this.error)throw this.error;
  }
  async finish(){try{this.child.stdin.end();await this.outcome;this.signal.throwIfAborted();}finally{this.cleanup();}}
  async dispose(){this.stop();await this.outcome.catch(()=>{});this.cleanup();}
  private cleanup(){clearTimeout(this.timer);this.signal.removeEventListener('abort',this.stop);}
}
