# Step 5 temporary Cloud Tasks smoke-test worker. Standard library only.
FROM python:3.11-slim
WORKDIR /app
COPY server.py .
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/server.py"]
