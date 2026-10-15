import 'dotenv/config';
const origin=process.env.OPUS_TEST_BASE_URL.replace(/\/v1\/?$/,'');
const headers={Authorization:'Bearer '+process.env.OPUS_TEST_API_KEY};
for(const path of ['/v1/models','/api/token/self']){
  const res=await fetch(origin+path,{headers,signal:AbortSignal.timeout(30000)});const data=await res.json().catch(()=>({}));
  console.log(JSON.stringify({path,status:res.status,models:path.includes('models')?data.data?.map(m=>m.id).filter(id=>/opus/.test(id)):undefined,balance:path.includes('self')?{success:data.success,remain_quota:data.data?.remain_quota,used_quota:data.data?.used_quota,unlimited_quota:data.data?.unlimited_quota}:undefined}));
}
