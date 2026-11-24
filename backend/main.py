"""FastAPI backend for the notebook's audio authenticity CNN."""

from __future__ import annotations

import os
import threading
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
WEIGHTS_PATH = ROOT / "audio.weights.h5"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}

app = FastAPI(
    title="Audio Deepfake Detection API",
    description="Analyzes a short audio clip with the project's trained CNN checkpoint.",
    version="1.0.0",
)
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")

_model: Any | None = None
_model_error: str | None = None
_model_lock = threading.Lock()
_inference_lock = threading.Lock()


def _build_model() -> Any:
    """Recreate the Sequential CNN used to save audio.weights.h5."""
    from tensorflow.keras import layers, models

    model = models.Sequential(
        [
            layers.Input(shape=(128, 63, 1)),
            layers.Conv2D(32, (3, 3), activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling2D(2, 2),
            layers.Conv2D(64, (3, 3), activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling2D(2, 2),
            layers.Conv2D(128, (3, 3), activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling2D(2, 2),
            layers.GlobalAveragePooling2D(),
            layers.Dense(128, activation="relu"),
            layers.Dropout(0.4),
            layers.Dense(1, activation="sigmoid"),
        ],
        name="audio_authenticity_cnn",
    )
    model.load_weights(str(WEIGHTS_PATH))
    return model


def _get_model() -> Any:
    global _model, _model_error
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        if not WEIGHTS_PATH.is_file():
            _model_error = f"Model weights not found at {WEIGHTS_PATH.name}."
            raise RuntimeError(_model_error)
        try:
            _model = _build_model()
            _model_error = None
        except Exception as exc:  # Report optional ML dependency/version errors via health.
            _model_error = f"Could not load the model: {exc}"
            raise RuntimeError(_model_error) from exc
    return _model


def _extract_features(audio_bytes: bytes, suffix: str) -> tuple[np.ndarray, np.ndarray, float]:
    """Apply the same 16 kHz, 2 second log-mel preprocessing as the notebook."""
    import librosa

    file_descriptor, temp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(file_descriptor, "wb") as audio_file:
            audio_file.write(audio_bytes)
        # Close the handle before librosa opens the path; Windows disallows
        # reopening a NamedTemporaryFile that is still held open.
        samples, sample_rate = librosa.load(temp_path, sr=16000, duration=2.0, mono=True)
    finally:
        try:
            Path(temp_path).unlink(missing_ok=True)
        except OSError:
            pass

    if samples.size == 0:
        raise ValueError("No audio samples were found in this file.")

    mel = librosa.feature.melspectrogram(y=samples, sr=sample_rate, n_mels=128)
    log_mel = librosa.power_to_db(mel)
    frame_count = log_mel.shape[1]
    if frame_count < 63:
        log_mel = np.pad(
            log_mel,
            ((0, 0), (0, 63 - frame_count)),
            mode="minimum",
        )
    else:
        log_mel = log_mel[:, :63]

    duration_seconds = float(samples.size / sample_rate)
    return log_mel.astype(np.float32), samples, duration_seconds


@app.get("/")
def home() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, Any]:
    ready = _model is not None
    return {
        "status": "ready" if ready else "starting",
        "model_ready": ready,
        "weights_found": WEIGHTS_PATH.is_file(),
        "weights_file": WEIGHTS_PATH.name,
        "detail": _model_error or ("CNN checkpoint loaded." if ready else "Model loads on the first analysis."),
        "input": {"sample_rate_hz": 16000, "mel_bins": 128, "time_frames": 63, "window_seconds": 2},
    }


@app.post("/api/analyze")
def analyze_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = Path(file.filename or "audio.wav").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Use a WAV, MP3, FLAC, OGG, M4A, or AAC audio file.")

    payload = file.file.read(MAX_UPLOAD_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="The selected audio file is empty.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio files must be 20 MB or smaller.")

    try:
        log_mel, samples, duration = _extract_features(payload, suffix)
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not decode this audio file. Try a WAV or FLAC file. ({exc})",
        ) from exc

    try:
        model = _get_model()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    model_input = log_mel[np.newaxis, ..., np.newaxis]
    try:
        with _inference_lock:
            spoof_probability = float(model.predict(model_input, verbose=0).reshape(-1)[0])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Model inference failed: {exc}") from exc

    spoof_probability = float(np.clip(spoof_probability, 0.0, 1.0))
    authentic_probability = 1.0 - spoof_probability
    label = "spoof" if spoof_probability >= 0.5 else "authentic"
    low, high = float(np.min(log_mel)), float(np.max(log_mel))
    normalized = (log_mel - low) / (high - low) if high > low else np.zeros_like(log_mel)

    return {
        "filename": filename,
        "label": label,
        "spoof_probability": round(spoof_probability, 6),
        "authentic_probability": round(authentic_probability, 6),
        "score": round(max(spoof_probability, authentic_probability), 6),
        "duration_seconds": round(duration, 3),
        "analyzed_seconds": round(min(duration, 2.0), 3),
        "sample_rate_hz": 16000,
        "sample_count": int(samples.size),
        "spectrogram": np.round(normalized, 3).tolist(),
        "spectrogram_shape": [128, 63],
        "note": "Experimental model output. The notebook does not report held-out evaluation metrics.",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
