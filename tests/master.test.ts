import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, toSubComposition } from '../plugins/cocode-director/master.js';
import { fixtureBoard } from './fixtures.js';
import { fitNarration } from '../plugins/cocode-director/audio.js';
test('master seams use frame-exact matching vectors and stable scene selectors',()=>{
  const ledger = createLedger(fixtureBoard);
  assert.equal(ledger.seams[0].cut,7.5);
  assert.equal(ledger.seams[0].exit.axis,ledger.seams[0].entry.axis);
  assert.equal(ledger.seams[0].exit.dir,ledger.seams[0].entry.dir);
  assert.equal(ledger.seams[0].exit.selector,'#vf-wrap-s1');
});
test('sub-composition conversion carries styles and scripts inside its transport template',()=>{
  const doc = '<html><head><style>#root{color:red}</style><script src="gsap.min.js"></script></head><body><div id="root" data-composition-id="s1">Hello</div><script>window.__timelines.s1=gsap.timeline({paused:true});</script></body></html>';
  const child = toSubComposition(doc);
  assert.ok(child.indexOf('<template>')<child.indexOf('<style>'));
  assert.ok(child.indexOf('</template>')>child.indexOf('window.__timelines'));
  assert.ok(!child.includes('src="gsap.min.js"'));
  assert.equal(toSubComposition(child),child);
});
test('actual narration duration reallocates frames without cutting speech',()=>{
  const board = structuredClone(fixtureBoard);
  const plan = {cues:[{sceneId:'s1',start:0,duration:9,text:'First',file:'a.wav'},{sceneId:'s2',start:7.5,duration:3,text:'Second',file:'b.wav'}]};
  fitNarration(board,plan,15);
  assert.ok(board.scenes[0].duration>=9.25);
  assert.equal(board.scenes.reduce((n,s)=>n+Math.round(s.duration*30),0),450);
  assert.equal(plan.cues[1].start,board.scenes[0].duration);
  assert.throws(()=>fitNarration(board,{cues:[{...plan.cues[0],duration:20}]},15),/旁白/);
});
