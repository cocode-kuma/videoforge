import { musicScoreSchema, type MusicScore } from '../../shared/music-score.js';
export { musicScoreSchema, type MusicScore } from '../../shared/music-score.js';
/** Pure offline synthesis. The model supplies bounded data, never executable code. */
export function synthesizeMusic(input: MusicScore, duration: number, sampleRate = 24000): Buffer {
  const score = musicScoreSchema.parse(input);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error('Invalid music duration');
  if (![24000, 48000].includes(sampleRate)) throw new Error('Invalid sample rate');
  const samples = new Float64Array(Math.round(duration * sampleRate));
  const secondsPerBeat = 60 / score.bpm;
  for (const note of score.notes) {
    const start = Math.round(note.beat * secondsPerBeat * sampleRate);
    const count = Math.round(note.length * secondsPerBeat * sampleRate);
    const hz = 440 * 2 ** ((note.midi - 69) / 12);
    let seed=(note.midi*2654435761+start)>>>0;
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / sampleRate, phase = 2 * Math.PI * hz * t;
      const attack = Math.min(1, i / (sampleRate * 0.015));
      const release = Math.min(1, (count - i) / (sampleRate * 0.08));
      const envelope = attack * release * (note.voice === 'pluck' ? Math.exp(-4 * i / count) : 1);
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/2147483648-1;
      const wave = note.voice==='kick'?Math.sin(2*Math.PI*(45*t+70*(1-Math.exp(-20*t))/20))*Math.exp(-10*t)
        :note.voice==='snare'?(noise*0.8+Math.sin(phase)*0.2)*Math.exp(-18*t)
        :note.voice==='hat'?noise*Math.exp(-40*t)*0.4
        :note.voice==='bass'?(Math.sin(phase)+0.2*Math.sin(2*phase))/1.2
        :note.voice==='pad'?(Math.sin(phase*.997)+Math.sin(phase*1.003)+Math.sin(phase*2)*.15)/2.15*Math.min(1,t/.12)
        :note.voice==='bell'?(Math.sin(phase)+.35*Math.sin(phase*2.76)+.15*Math.sin(phase*4.1))/1.5*Math.exp(-2*t)
        :note.voice === 'soft' ? (Math.sin(phase) + 0.25 * Math.sin(2 * phase)) / 1.25 : Math.sin(phase);
      samples[start + i] += wave * envelope * note.gain;
    }
  }
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const factor = peak > 0.85 ? 0.85 / peak : 1;
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF',0); out.writeUInt32LE(out.length - 8,4); out.write('WAVEfmt ',8);
  out.writeUInt32LE(16,16); out.writeUInt16LE(1,20); out.writeUInt16LE(1,22);
  out.writeUInt32LE(sampleRate,24); out.writeUInt32LE(sampleRate * 2,28);
  out.writeUInt16LE(2,32); out.writeUInt16LE(16,34); out.write('data',36); out.writeUInt32LE(samples.length * 2,40);
  for (let i = 0; i < samples.length; i++) {
    const fade = Math.min(1, i / (sampleRate * 0.3), (samples.length - i) / (sampleRate * 0.5));
    out.writeInt16LE(Math.round(samples[i] * factor * fade * 32767),44 + i * 2);
  }
  return out;
}
