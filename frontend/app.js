const fileInput = document.querySelector('#audio-file');
const dropzone = document.querySelector('#dropzone');
const dropTitle = document.querySelector('#drop-title');
const dropHint = document.querySelector('#drop-hint');
const selectedFileCard = document.querySelector('#selected-file');
const selectedName = document.querySelector('#selected-name');
const selectedSize = document.querySelector('#selected-size');
const analyzeButton = document.querySelector('#analyze-button');
const resultEmpty = document.querySelector('#result-empty');
const resultContent = document.querySelector('#result-content');
const resultState = document.querySelector('#result-state');
const toast = document.querySelector('#toast');
const canvas = document.querySelector('#spectrogram');
const placeholder = document.querySelector('#chart-placeholder');
const audioPreview = document.querySelector('#audio-preview');
const playButton = document.querySelector('#play-button');
const playIcon = document.querySelector('#play-icon');
const playLabel = document.querySelector('#play-label');
const restartButton = document.querySelector('#restart-button');
const seekSlider = document.querySelector('#seek-slider');
const waveformCanvas = document.querySelector('#waveform-canvas');
const waveformPlaceholder = document.querySelector('#waveform-placeholder');
const waveformPlayhead = document.querySelector('#waveform-playhead');
const spectrogramPlayhead = document.querySelector('#spectrogram-playhead');
let selectedFile = null;
let toastTimer = null;
let latestSpectrogram = null;
let latestAnalyzedSeconds = 0;
let waveformPeaks = [];
let waveformDuration = 0;
let audioObjectUrl = null;
let waveformRequestId = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 5500);
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function updateWaveformAxis(duration) {
  const labels = [...document.querySelectorAll('#waveform-axis span')];
  labels.forEach((label, index) => {
    label.textContent = Number.isFinite(duration) && duration > 0
      ? formatTime(duration * index / (labels.length - 1))
      : (index === 0 ? '0:00' : '—');
  });
}

function drawWaveform() {
  if (!waveformPeaks.length) return;
  const bounds = waveformCanvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(bounds.width * ratio);
  const height = Math.round(bounds.height * ratio);
  waveformCanvas.width = width;
  waveformCanvas.height = height;
  const context = waveformCanvas.getContext('2d');
  const center = height / 2;
  const duration = Number.isFinite(audioPreview.duration) ? audioPreview.duration : waveformDuration;
  const progress = duration > 0 ? Math.min(audioPreview.currentTime / duration, 1) : 0;
  const step = width / waveformPeaks.length;
  context.lineWidth = Math.max(1, step * 0.58);
  context.lineCap = 'round';
  waveformPeaks.forEach((peak, index) => {
    const x = (index + 0.5) * step;
    const amplitude = Math.max(1.5 * ratio, peak * height * 0.46);
    context.strokeStyle = index / waveformPeaks.length <= progress ? '#47765a' : '#99b8a0';
    context.beginPath();
    context.moveTo(x, center - amplitude);
    context.lineTo(x, center + amplitude);
    context.stroke();
  });
}

async function buildWaveform(file) {
  const requestId = ++waveformRequestId;
  waveformPeaks = [];
  waveformPlaceholder.hidden = false;
  waveformPlayhead.hidden = true;
  document.querySelector('#waveform-status').textContent = 'READING AUDIO LOCALLY';
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    document.querySelector('#waveform-status').textContent = 'WAVEFORM UNAVAILABLE IN THIS BROWSER';
    return;
  }

  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    if (requestId !== waveformRequestId) return;
    waveformDuration = audioBuffer.duration;
    const points = Math.min(1400, Math.max(240, Math.floor(audioBuffer.length / 96)));
    const samplesPerPoint = Math.max(1, Math.floor(audioBuffer.length / points));
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) => audioBuffer.getChannelData(channel));
    waveformPeaks = Array.from({ length: points }, (_, point) => {
      const start = point * samplesPerPoint;
      const end = Math.min(audioBuffer.length, start + samplesPerPoint);
      let peak = 0;
      for (const channel of channels) {
        for (let sample = start; sample < end; sample++) peak = Math.max(peak, Math.abs(channel[sample]));
      }
      return peak;
    });
    waveformPlaceholder.hidden = true;
    document.querySelector('#waveform-status').textContent = `WAVEFORM READY · ${audioBuffer.sampleRate.toLocaleString()} HZ SOURCE`;
    updateWaveformAxis(audioBuffer.duration);
    drawWaveform();
    updatePlaybackUi();
  } catch {
    if (requestId !== waveformRequestId) return;
    waveformPlaceholder.querySelector('b').textContent = 'Waveform preview is not supported for this file in the browser';
    waveformPlaceholder.querySelector('span:last-child').textContent = 'You can still analyze it with the model below.';
    document.querySelector('#waveform-status').textContent = 'BROWSER DECODE UNAVAILABLE';
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function updatePlaybackUi() {
  const duration = Number.isFinite(audioPreview.duration) ? audioPreview.duration : waveformDuration;
  const current = Number.isFinite(audioPreview.currentTime) ? audioPreview.currentTime : 0;
  document.querySelector('#play-current-time').textContent = formatTime(current);
  document.querySelector('#play-duration').textContent = formatTime(duration);
  if (duration > 0) seekSlider.value = String(Math.round(current / duration * 1000));

  const fraction = duration > 0 ? Math.min(current / duration, 1) : 0;
  waveformPlayhead.hidden = !waveformPeaks.length;
  waveformPlayhead.style.left = `${fraction * 100}%`;
  if (waveformPeaks.length) drawWaveform();

  if (latestSpectrogram && latestAnalyzedSeconds > 0 && current <= latestAnalyzedSeconds) {
    spectrogramPlayhead.hidden = false;
    spectrogramPlayhead.style.left = `${Math.min(current / latestAnalyzedSeconds, 1) * 100}%`;
  } else {
    spectrogramPlayhead.hidden = true;
  }
}

function clearAudioPreview() {
  audioPreview.pause();
  audioPreview.removeAttribute('src');
  audioPreview.load();
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = null;
  waveformRequestId += 1;
  waveformPeaks = [];
  waveformDuration = 0;
  waveformCanvas.getContext('2d').clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  waveformPlaceholder.hidden = false;
  waveformPlaceholder.querySelector('b').textContent = 'Choose a clip to draw its waveform';
  waveformPlaceholder.querySelector('span:last-child').textContent = 'Playback stays on this device.';
  waveformPlayhead.hidden = true;
  spectrogramPlayhead.hidden = true;
  document.querySelector('#waveform-file-name').textContent = 'No audio selected';
  document.querySelector('#waveform-caption').textContent = 'CHOOSE AUDIO TO BEGIN';
  document.querySelector('#waveform-status').textContent = 'NO AUDIO LOADED';
  document.querySelector('#play-current-time').textContent = '0:00';
  document.querySelector('#play-duration').textContent = '0:00';
  playLabel.textContent = 'Play audio';
  playIcon.textContent = '▶';
  playButton.disabled = true;
  restartButton.disabled = true;
  seekSlider.disabled = true;
  seekSlider.value = '0';
  updateWaveformAxis(0);
}

function chooseFile(file) {
  if (!file) return;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac'].includes(extension)) {
    showToast('Choose a WAV, MP3, FLAC, OGG, M4A, or AAC file.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast('This file is larger than the 20 MB upload limit.');
    return;
  }
  selectedFile = file;
  clearAudioPreview();
  resultEmpty.hidden = false;
  resultContent.hidden = true;
  document.querySelector('#result-explainer').hidden = true;
  resultState.textContent = 'READY TO ANALYZE';
  document.querySelector('#spectrogram-caption').textContent = 'WAITING FOR AUDIO';
  latestAnalyzedSeconds = 0;
  placeholder.hidden = false;
  latestSpectrogram = null;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  audioObjectUrl = URL.createObjectURL(file);
  audioPreview.src = audioObjectUrl;
  audioPreview.load();
  playButton.disabled = false;
  restartButton.disabled = false;
  seekSlider.disabled = false;
  document.querySelector('#waveform-file-name').textContent = file.name;
  document.querySelector('#waveform-caption').textContent = 'BUILDING WAVEFORM';
  updateWaveformAxis(0);
  buildWaveform(file);
  dropTitle.textContent = 'Audio ready to analyze';
  dropHint.textContent = 'Choose a different file by clicking here';
  selectedName.textContent = file.name;
  selectedSize.textContent = formatBytes(file.size);
  selectedFileCard.hidden = false;
  analyzeButton.disabled = false;
  resultState.textContent = 'READY TO ANALYZE';
  document.querySelector('.live-tag').classList.remove('error');
  document.querySelector('.live-tag').classList.add('ready');
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('drag-over'); chooseFile(event.dataTransfer.files[0]); });
document.querySelector('#remove-file').addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  clearAudioPreview();
  selectedFileCard.hidden = true;
  resultEmpty.hidden = false;
  resultContent.hidden = true;
  document.querySelector('#result-explainer').hidden = true;
  document.querySelector('#spectrogram-caption').textContent = 'WAITING FOR AUDIO';
  latestAnalyzedSeconds = 0;
  latestSpectrogram = null;
  placeholder.hidden = false;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  dropTitle.textContent = 'Drop an audio file here';
  dropHint.innerHTML = 'or <u>browse files</u> from your device';
  analyzeButton.disabled = true;
  resultState.textContent = 'AWAITING AUDIO';
  document.querySelector('.live-tag').classList.remove('ready', 'error');
});

playButton.addEventListener('click', async () => {
  if (!audioPreview.src) return;
  if (audioPreview.paused) {
    try {
      await audioPreview.play();
    } catch {
      showToast('This browser could not play the selected audio format.');
    }
  } else {
    audioPreview.pause();
  }
});

restartButton.addEventListener('click', () => {
  if (!audioPreview.src) return;
  audioPreview.currentTime = 0;
  if (audioPreview.paused) audioPreview.play().catch(() => showToast('This browser could not play the selected audio format.'));
  updatePlaybackUi();
});

seekSlider.addEventListener('input', () => {
  const duration = Number.isFinite(audioPreview.duration) ? audioPreview.duration : waveformDuration;
  if (duration > 0) audioPreview.currentTime = Number(seekSlider.value) / 1000 * duration;
});

audioPreview.addEventListener('loadedmetadata', () => {
  const duration = Number.isFinite(audioPreview.duration) ? audioPreview.duration : waveformDuration;
  document.querySelector('#waveform-caption').textContent = `${formatTime(duration)} CLIP · LOCAL PLAYBACK`;
  document.querySelector('#waveform-status').textContent = 'AUDIO READY · PLAYBACK STAYS LOCAL';
  updateWaveformAxis(duration);
  updatePlaybackUi();
});
audioPreview.addEventListener('play', () => { playIcon.textContent = 'Ⅱ'; playLabel.textContent = 'Pause audio'; });
audioPreview.addEventListener('pause', () => { playIcon.textContent = '▶'; playLabel.textContent = 'Play audio'; });
audioPreview.addEventListener('timeupdate', updatePlaybackUi);
audioPreview.addEventListener('ended', updatePlaybackUi);
audioPreview.addEventListener('error', () => {
  if (selectedFile) document.querySelector('#waveform-status').textContent = 'BROWSER PLAYBACK UNAVAILABLE';
});

async function checkApi() {
  const light = document.querySelector('#api-status-light');
  const label = document.querySelector('#api-status');
  const detail = document.querySelector('#api-status-detail');
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('API unavailable');
    const health = await response.json();
    light.className = `status-light ${health.weights_found ? 'online' : 'offline'}`;
    label.textContent = health.model_ready ? 'Model ready' : (health.weights_found ? 'API available' : 'Weights missing');
    detail.textContent = health.model_ready ? 'CNN checkpoint loaded' : (health.weights_found ? 'Checkpoint loads on first analysis' : 'Add audio.weights.h5 to project root');
  } catch {
    light.className = 'status-light offline';
    label.textContent = 'API offline';
    detail.textContent = 'Start the backend on port 8000';
  }
}

function drawSpectrogram(matrix) {
  if (!matrix?.length) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext('2d');
  const columns = matrix[0].length;
  const rows = matrix.length;
  const image = context.createImageData(canvas.width, canvas.height);
  const palette = [[61, 49, 102], [101, 89, 161], [145, 107, 179], [206, 119, 133], [235, 171, 120], [237, 218, 163]];
  for (let y = 0; y < canvas.height; y++) {
    const melBin = Math.max(0, rows - 1 - Math.floor(y / canvas.height * rows));
    for (let x = 0; x < canvas.width; x++) {
      const frame = Math.min(columns - 1, Math.floor(x / canvas.width * columns));
      const value = Math.max(0, Math.min(0.999, matrix[melBin][frame]));
      const section = value * (palette.length - 1);
      const index = Math.floor(section);
      const mix = section - index;
      const left = palette[index];
      const right = palette[Math.min(index + 1, palette.length - 1)];
      const offset = (y * canvas.width + x) * 4;
      image.data[offset] = left[0] + (right[0] - left[0]) * mix;
      image.data[offset + 1] = left[1] + (right[1] - left[1]) * mix;
      image.data[offset + 2] = left[2] + (right[2] - left[2]) * mix;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  placeholder.hidden = true;
}

function showResult(result) {
  resultEmpty.hidden = true;
  resultContent.hidden = false;
  document.querySelector('#result-explainer').hidden = false;
  const spoof = result.spoof_probability * 100;
  const authentic = result.authentic_probability * 100;
  const top = Math.max(spoof, authentic);
  document.querySelector('#score-value').textContent = `${Math.round(top)}%`;
  document.querySelector('#score-ring').style.background = `conic-gradient(${result.label === 'spoof' ? '#df8b70' : '#82ae91'} ${top * 3.6}deg, #e4e7df ${top * 3.6}deg)`;
  const classification = document.querySelector('#classification');
  classification.textContent = result.label === 'spoof' ? 'Spoof-like signal' : 'Authentic-like signal';
  classification.className = `classification ${result.label}`;
  document.querySelector('#result-file-name').textContent = result.filename;
  document.querySelector('#result-duration').textContent = `${result.duration_seconds.toFixed(2)} sec source · ${result.analyzed_seconds.toFixed(2)} sec analyzed`;
  document.querySelector('#authentic-value').textContent = `${authentic.toFixed(1)}%`;
  document.querySelector('#spoof-value').textContent = `${spoof.toFixed(1)}%`;
  document.querySelector('#authentic-bar').style.width = `${authentic}%`;
  document.querySelector('#spoof-bar').style.width = `${spoof}%`;
  document.querySelector('#result-note').textContent = result.note;
  document.querySelector('#result-state').textContent = 'ANALYSIS COMPLETE';
  document.querySelector('.live-tag').classList.add('ready');
  document.querySelector('#spectrogram-caption').textContent = `${result.analyzed_seconds.toFixed(2)} SEC · ${result.spectrogram_shape.join(' × ')}`;
  latestAnalyzedSeconds = result.analyzed_seconds;
  document.querySelectorAll('.x-axis [data-axis]').forEach((label, index) => {
    label.textContent = `${(latestAnalyzedSeconds * index / 4).toFixed(2)} s`;
  });

  const spoofSelected = result.label === 'spoof';
  const margin = Math.abs(spoof - authentic);
  document.querySelector('#explainer-mark').classList.toggle('spoof-mark', spoofSelected);
  document.querySelector('#explainer-mark').textContent = spoofSelected ? 'S' : 'A';
  document.querySelector('#explanation-title').textContent = spoofSelected ? 'The model leans spoof-like' : 'The model leans authentic-like';
  document.querySelector('#explanation-copy').textContent = `For the analyzed window, the model assigned ${spoof.toFixed(1)}% to the spoof class and ${authentic.toFixed(1)}% to the authentic class. Its output follows a 50% spoof-score cutoff; this is a classifier result, not proof about who made the recording.`;
  document.querySelector('#score-gap').textContent = `${margin.toFixed(1)} percentage points`;
  document.querySelector('#explainer-caveat').textContent = `${result.note} The CNN does not provide frame-level explanations or identify a particular voice generator.`;
  latestSpectrogram = result.spectrogram;
  drawSpectrogram(latestSpectrogram);
  updatePlaybackUi();
}

analyzeButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  const label = analyzeButton.querySelector('.button-label');
  analyzeButton.disabled = true;
  analyzeButton.classList.add('busy');
  label.textContent = 'Analyzing signal';
  resultState.textContent = 'PROCESSING';
  document.querySelector('.live-tag').classList.remove('ready', 'error');
  try {
    const body = new FormData();
    body.append('file', selectedFile);
    const response = await fetch('/api/analyze', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Analysis failed.');
    showResult(data);
  } catch (error) {
    resultState.textContent = 'ANALYSIS FAILED';
    document.querySelector('.live-tag').classList.add('error');
    showToast(error.message || 'The API could not analyze this file.');
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.classList.remove('busy');
    label.textContent = 'Analyze again';
  }
});

window.addEventListener('resize', () => {
  if (latestSpectrogram) drawSpectrogram(latestSpectrogram);
  if (waveformPeaks.length) drawWaveform();
});
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
  });
});
checkApi();
