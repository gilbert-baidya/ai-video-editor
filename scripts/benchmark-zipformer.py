import json
import time
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

root = Path(__file__).resolve().parents[1]
model = root.parent.parent / "sermonclip-studio/models/zipformer_bn/sherpa-onnx-streaming-zipformer-bn-vosk-2026-02-09"
audio_path = root / "artifacts/foundation-sample/audio.wav"
output_path = root / "artifacts/foundation-sample/zipformer-benchmark.json"

with wave.open(str(audio_path), "rb") as audio:
    sample_rate = audio.getframerate()
    samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32) / 32768

recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=str(model / "tokens.txt"),
    encoder=str(model / "encoder.onnx"),
    decoder=str(model / "decoder.onnx"),
    joiner=str(model / "joiner.onnx"),
    num_threads=4,
    provider="coreml",
)
stream = recognizer.create_stream()
stream.accept_waveform(sample_rate, samples)
stream.accept_waveform(sample_rate, np.zeros(int(sample_rate * 0.5), dtype=np.float32))
stream.input_finished()
started = time.perf_counter()
while recognizer.is_ready(stream):
    recognizer.decode_stream(stream)
elapsed = time.perf_counter() - started
tokens = recognizer.tokens(stream)
timestamps = recognizer.timestamps(stream)
result = {
    "provider": "sherpa-onnx streaming Zipformer",
    "modelSource": "alphacep/vosk-model-small-streaming-bn",
    "modelWeights": "local Zipformer ONNX files; bundled README does not state a license",
    "licenseStatus": "REFERENCE / TEST ONLY",
    "audioSeconds": len(samples) / sample_rate,
    "decodeSeconds": elapsed,
    "realTimeFactor": elapsed / (len(samples) / sample_rate),
    "tokenCount": len(tokens),
    "timestampCount": len(timestamps),
    "timestampsAreMonotonic": all(right >= left for left, right in zip(timestamps, timestamps[1:])),
    "text": recognizer.get_result(stream),
    "timingSemantics": "streaming recognizer token emission timestamps; not forced alignment to authoritative transcript",
}
output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))