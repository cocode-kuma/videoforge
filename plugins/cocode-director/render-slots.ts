/** Rendering consumes machine capacity; conversations do not. */
const pools=new Map<string,{active:number;waiters:(()=>void)[]}>();
export async function withRenderSlot<T>(key:string,limit:number,signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
  let pool=pools.get(key);if(!pool){pool={active:0,waiters:[]};pools.set(key,pool);}
  const p=pool;
  signal.throwIfAborted();
  if(p.active>=limit)await new Promise<void>((resolve,reject)=>{
    const ready=()=>{signal.removeEventListener('abort',cancel);resolve();};
    const cancel=()=>{const index=p.waiters.indexOf(ready);if(index>=0)p.waiters.splice(index,1);signal.removeEventListener('abort',cancel);reject(signal.reason);};
    p.waiters.push(ready);signal.addEventListener('abort',cancel,{once:true});
  });else p.active++;
  try{signal.throwIfAborted();return await work();}
  finally{const next=p.waiters.shift();if(next)next();else p.active--;if(p.active===0&&!p.waiters.length)pools.delete(key);}
}
