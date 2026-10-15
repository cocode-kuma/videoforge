import {resolve} from 'node:path';
import {readConfig} from '../shared/config.js';
import {NativeHarness} from '../plugins/cocode-director/native-harness.js';
const base=readConfig(),config={...base,model:'qwen3.8-flash',baseUrl:process.env.QWEN_BASE_URL!,apiKey:process.env.QWEN_API_KEY!,generationMaxTokens:2048};
let finished=false;
const usage={calls:0,promptTokens:0,completionTokens:0,totalTokens:0};
await new NativeHarness(config,AbortSignal.timeout(120000),usage,resolve('.test-artifacts/qwen-native-smoke'),{message:async()=>{},input:async()=>[],checkpoint:async()=>{},state:async()=>({}),tool:async()=>{}}).run('这是接口测试。请调用 finish_response，summary 为“工具调用成功”，然后停止。',{prompt:'测试工具调用'},[{name:'finish_response',description:'完成测试',parameters:{type:'object',properties:{summary:{type:'string'}},required:['summary']},execute:async()=>{finished=true;return {accepted:true};}}]);
if(!finished)throw Error('Native tool invocation failed');
console.log(JSON.stringify({model:config.model,toolCalling:true,usage}));
