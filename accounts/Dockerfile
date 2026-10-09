# ProofLab accounts: removes a student's data and Google login together.
# Standard library only - nothing to install.
FROM python:3.11-slim
WORKDIR /app
COPY server.py sync_plan.py apptoken.py self_delete.py ./
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/server.py"]
