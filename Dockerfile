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

# Instalar el binario bgutil-pot y su plugin oficial para yt-dlp en /etc/yt-dlp/plugins/bgutil
RUN curl -fsSL https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-linux-x86_64 \
    -o /usr/local/bin/bgutil-pot && \
    chmod +x /usr/local/bin/bgutil-pot && \
    mkdir -p /etc/yt-dlp/plugins/bgutil && \
    curl -fsSL https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-ytdlp-pot-provider-rs.zip \
    -o /tmp/plugin.zip && \
    python3 -m zipfile -e /tmp/plugin.zip /etc/yt-dlp/plugins/bgutil && \
    rm -f /tmp/plugin.zip

# Instalar yt-dlp con yt-dlp-ejs y curl-cffi
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --upgrade -r requirements.txt

# Copiar los archivos de la aplicación (Frontend + Servidor Backend)
COPY index.html styles.css app.js server.py ./

EXPOSE 10000

CMD ["python3", "server.py"]
