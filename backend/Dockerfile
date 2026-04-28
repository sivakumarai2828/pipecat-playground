FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright dependencies for Chromium
RUN playwright install --with-deps chromium

# Copy application code
COPY . .

# Cloud Run sets the PORT environment variable
ENV PORT=8080
EXPOSE $PORT

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
