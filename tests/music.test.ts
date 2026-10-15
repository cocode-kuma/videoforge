import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeMusic, type MusicScore } from '../plugins/cocode-director/music.js';
test('code music is deterministic WAV with requested duration and bounded amplitude', () => {
  const score: MusicScore = { bpm: 120, notes: [{ beat: 0, length: 4, midi: 60, gain: 0.4, voice: 'soft' }, { beat: 1, length: 3, midi: 67, gain: 0.4, voice: 'pluck' }] };
  const wav = synthesizeMusic(score, 3);
  assert.deepEqual(wav, synthesizeMusic(score, 3));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.length, 44 + 3 * 24000 * 2);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 1000 && peak <= 27853);
  assert.throws(() => synthesizeMusic({ ...score, bpm: 0 }, 3));
});
