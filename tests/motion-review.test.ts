import test from 'node:test';
import assert from 'node:assert/strict';
import {frameDifferenceClues} from '../plugins/cocode-director/motion-review.js';
import {captureWorkerLimit} from '../plugins/cocode-director/creative-runtime.js';

test('static frame clues distinguish still holds from moving frames without a pass/fail threshold',()=>{
  const staticFrames=frameDifferenceClues(Buffer.from([10,10,10,10,10,10]),2,2);
  assert.equal(staticFrames.nearStaticRatio,1);assert.equal(staticFrames.longestNearStatic.duration,1);
  const moving=frameDifferenceClues(Buffer.from([10,10,20,20,40,40]),2,2);
  assert.equal(moving.meanDifference,15);assert.equal(moving.nearStaticRatio,0);
  assert.equal('passed' in moving,false);
});
test('capture defaults to six and scales with resources; explicit eight and sixteen are supported',()=>{
  const gib=1024**3;
  assert.equal(captureWorkerLimit(4*gib,8,''),6);
  assert.equal(captureWorkerLimit(2.5*gib,8,''),4);
  assert.equal(captureWorkerLimit(1.5*gib,8,''),2);
  assert.equal(captureWorkerLimit(10*gib,8,''),8);
  assert.equal(captureWorkerLimit(18*gib,16,''),16);
  assert.equal(captureWorkerLimit(4*gib,8,'16'),16);
});
