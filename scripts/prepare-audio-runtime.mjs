import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const root = resolve('.venv-tts');
const interpreter = resolve(root,process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const candidate = process.env.VIDEOFORGE_PYTHON || process.env.HYPERFRAMES_PYTHON || 'python';
function run(cmd,args) {
  const result = spawnSync(cmd,args,{stdio:'inherit',windowsHide:true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Audio environment preparation failed');
}
if (!existsSync(interpreter)) run(candidate,['-m','venv',root]);
run(interpreter,['-m','pip','install','-r',resolve('scripts/audio-requirements.lock.txt')]);
run(interpreter,['-c','import kokoro_onnx,soundfile; print("Local audio dependencies ready")']);
console.log('Prepared '+interpreter+'; speech model cache downloads on the first preparation synthesis.');
