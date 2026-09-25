# Step 6: private Cloud Tasks worker for async voice transcription.
# Standard library only - nothing to install.
FROM python:3.11-slim
WORKDIR /app
COPY server.py .
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/server.py"]
