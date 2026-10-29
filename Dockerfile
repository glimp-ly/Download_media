# ==========================================================================
# VerdeDL — Dockerfile listo para Render.com (Python + yt-dlp + ffmpeg + NodeJS)
# ==========================================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app

# Instalar ffmpeg y nodejs (nodejs permite a yt-dlp-ejs resolver los desafíos JS de YouTube)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp con soporte completo (yt-dlp-ejs y curl-cffi para TLS de navegador)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --upgrade -r requirements.txt

# Copiar los archivos de la aplicación (Frontend + Servidor Backend)
COPY index.html styles.css app.js server.py ./

EXPOSE 10000

CMD ["python3", "server.py"]
