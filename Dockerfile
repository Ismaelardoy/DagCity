# --- DagCity Dockerfile ---
# Senior Platform Engineer approved base
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/app/src

# Create and set working directory
WORKDIR /app

# Copy source code
# Copy source code and install dependencies
COPY src/ /app/src/
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Expose the serving port
EXPOSE 8080

# Default environment variables
ENV MANIFEST_PATH=/data/target/manifest.json
ENV PORT=8080

# Entry point: Use Uvicorn for FastAPI and Live Sync support
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080", "--ws", "none"]
