import {join} from 'node:path';
import {DataStore} from '../plugins/cocode-data-store/index.js';
import {Director} from '../plugins/cocode-director/index.js';
import {createApp} from '../plugins/cocode-studio-ui/index.js';
import {readConfig} from '../shared/config.js';
const store=new DataStore({...readConfig(),origin:'http://localhost:3091',dataRoot:join(process.cwd(),'.test-artifacts/ui-data'),logsRoot:join(process.cwd(),'.test-artifacts/ui-logs'),apiKey:'',mailApiUrl:'',officialQuotaApiUrl:''});await store.init();
const director=new Director(store),server=createApp(store,director).listen(3091,'127.0.0.1',()=>console.log('界面验收服务已启动'));
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void director.dispose().finally(()=>server.close(()=>process.exit(0)));});
