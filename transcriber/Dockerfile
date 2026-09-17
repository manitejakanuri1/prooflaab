# ProofLab transcriber: speech to text on CPU (faster-whisper), so recording
# works the same on every phone and laptop. No GPU, no ffmpeg install:
# faster-whisper decodes WebM/Opus and MP4/AAC through its bundled PyAV.
FROM python:3.11-slim

RUN pip install --no-cache-dir faster-whisper==1.0.3 requests==2.32.3 "huggingface-hub<1"

# Bake the model into the image so no request ever waits on a download.
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root='/models')"

WORKDIR /app
COPY server.py .
ENV PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
CMD ["python", "/app/server.py"]
