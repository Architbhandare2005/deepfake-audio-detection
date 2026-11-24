# Audio Deepfake Detection

A small local web application for the CNN checkpoint in `audio.weights.h5`. It wraps the model in a FastAPI backend and provides a responsive dashboard for audio uploads, spoof/authentic scores, and the input log-mel spectrogram.

## Run locally

From the project root, with Python 3.10–3.12 installed:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload
```

Open <http://127.0.0.1:8000>. The backend expects `audio.weights.h5` in the project root, as it is in this project. TensorFlow loads the checkpoint on the first analysis request. If the checkpoint does not load, the sidebar and `/api/health` report the backend status.

## API

- `GET /api/health` reports checkpoint availability and readiness.
- `POST /api/analyze` accepts one multipart audio field named `file` and returns the class scores, audio metadata, and a normalized `128 × 63` log-mel matrix for the spectrogram view.
- `GET /docs` opens FastAPI's interactive API reference.

The backend mirrors the notebook's feature pipeline: mono audio resampled to 16 kHz, up to two seconds, 128-bin mel power converted to decibels, padded or cropped to 63 frames, then passed to the matching three-block CNN. Accepted formats are WAV, MP3, FLAC, OGG, M4A, and AAC (decoder support can vary by local codec installation); maximum upload size is 20 MB.

## What the interface shows

- Upload and analyze a clip locally, with an authentic-like or spoof-like score.
- Play, pause, restart, and seek through the selected audio on the device.
- Inspect a waveform for the full clip and a synchronized playhead in the analyzed window.
- Compare the two sigmoid-derived class probabilities.
- Inspect the actual log-mel features sent into the model.
- Read a plain-language explanation of the threshold and score gap, with model limitations.
- Review an architecture diagram for the CNN from the notebook.
- Check runtime and checkpoint status.

The notebook does not include held-out evaluation metrics. Scores are experimental model outputs and should not be treated as proof of authenticity or as a validated confidence estimate. The training notebook optionally reads FakeAVCeleb from a fixed Colab path, so the interface describes that dataset as optional.

## Image credits

The dashboard uses studio photographs served from Unsplash: [recording studio image](https://unsplash.com/photos/microphone-in-recording-studio-2f02b77fc618) and [audio mixing console](https://unsplash.com/photos/black-and-gray-audio-mixer-xo4ValczbuA). An internet connection is needed to load these photos and the hosted fonts; the application and model inference run locally.
