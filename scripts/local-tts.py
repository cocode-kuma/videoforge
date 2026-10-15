"""Project-local Kokoro ONNX worker. Text and audio never leave the machine."""
import json
import sys
from pathlib import Path
import kokoro_onnx
import soundfile as sf

request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
model = kokoro_onnx.Kokoro(request["model"], request["voices"])
samples, rate = model.create(request["text"], voice="zf_xiaobei", speed=1.0, lang="cmn")
sf.write(request["output"], samples, rate)
print(json.dumps({"sampleRate": rate, "duration": len(samples) / rate, "voice": "zf_xiaobei", "language": "cmn"}))
