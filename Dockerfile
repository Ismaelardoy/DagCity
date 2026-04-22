# --- DagCity Dockerfile ---
# Senior Platform Engineer approved base
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Create and set working directory
WORKDIR /app

# Copy source code
COPY src/ /app/src/

# Expose the serving port
EXPOSE 8080

# Default environment variables
ENV MANIFEST_PATH=/app/data/manifest.json
ENV PORT=8080

# Entry point
CMD ["python", "src/main.py"]
