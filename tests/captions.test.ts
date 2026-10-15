import test from 'node:test';import assert from 'node:assert/strict';
import {parseCaptions,captionsAss} from '../plugins/cocode-director/captions.js';
test('caption timestamps are preserved and malformed or overlapping cues fail',()=>{
  const cues=parseCaptions('WEBVTT\n\n00:01.250 --> 00:03.750\n<b>你好</b> 世界\n\nsecond\n00:04.000 --> 00:05.000\n第二句');
  assert.deepEqual(cues[0],{start:1.25,end:3.75,text:'你好 世界'});
  assert.match(captionsAss(cues,1280,720),/Dialogue: 0,0:00:01.25,0:00:03.75/);
  assert.throws(()=>parseCaptions('1\n00:00:02,000 --> 00:00:01,000\n错误'));
  assert.throws(()=>parseCaptions('1\n00:00:00,000 --> 00:00:03,000\n第一句\n\n2\n00:00:02,000 --> 00:00:04,000\n重叠'));
});
