# ==========================================================================
# VerdeDL — Dockerfile para Render (Python + yt-dlp + ffmpeg + Node + BgUtil POT)
# ==========================================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app

# Instalar ffmpeg y nodejs (necesario para desafíos JS de YouTube)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Instalar el generador nativo de PO Tokens (BotGuard) en Rust para evitar bloqueos en IPs cloud
RUN curl -fsSL https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64 \
    -o /usr/local/bin/bgutil-pot && \
    chmod +x /usr/local/bin/bgutil-pot

# Instalar yt-dlp (con yt-dlp-ejs y curl-cffi) y el plugin bgutil-ytdlp-pot-provider
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --upgrade -r requirements.txt

# Copiar los archivos de la aplicación (Frontend + Servidor Backend)
COPY index.html styles.css app.js server.py ./

EXPOSE 10000

CMD ["python3", "server.py"]
