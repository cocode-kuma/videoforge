import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCheckReport,describeQualityFailure} from '../plugins/cocode-director/quality.js';
const valid={ok:true,lint:{ok:true},runtime:{ok:true},layout:{ok:true,samples:[1,2]},contrast:{ok:true,enabled:true,samples:[1],checked:4},snapshots:{enabled:true,files:['snapshots/1.png']}};
test('quality requires actual samples and rejects runtime failures',()=>{
  assert.equal(parseCheckReport('[INFO] engine\n'+JSON.stringify(valid)).ok,true);
  assert.throws(()=>parseCheckReport(JSON.stringify({...valid,layout:{ok:true,samples:[]}})),/样本/);
  assert.throws(()=>parseCheckReport(JSON.stringify({...valid,runtime:{ok:false}})),/问题/);
  assert.throws(()=>parseCheckReport('exit 0 without JSON'),/报告/);
  assert.match(describeQualityFailure({diagnostic:'missing_gsap_plugin: MotionPathPlugin'})??'',/动画依赖/);
  assert.match(describeQualityFailure({diagnostic:'gsap_non_transform_motion: left'})??'',/逐帧卡顿/);
  assert.match(describeQualityFailure({diagnostic:'Error: 镜头 s1 主文案阅读时间不足'})??'',/停留时间不足/);
});
