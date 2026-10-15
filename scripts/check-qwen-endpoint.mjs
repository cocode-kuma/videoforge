import 'dotenv/config';
const endpoint=process.env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1';
const result=await fetch(endpoint.replace(/\/$/,'')+'/chat/completions',{
  method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({model:'qwen3.8-flash',messages:[{role:'user',content:'只回复：连接成功'}],enable_thinking:false,max_tokens:32}),signal:AbortSignal.timeout(45000)
});
const data=await result.json();
console.log(JSON.stringify({status:result.status,model:data.model,reply:data.choices?.[0]?.message?.content,usage:data.usage,error:result.ok?undefined:{code:data.code??data.error?.code,message:data.message??data.error?.message}}));
