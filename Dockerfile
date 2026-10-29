# ==========================================================================
# VerdeDL — Dockerfile listo para Render.com (Python + yt-dlp + ffmpeg)
# ==========================================================================
FROM python:3.12-slim

# Evitar archivos .pyc y habilitar logs en tiempo real en Render
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app

# Instalar ffmpeg y certificados (necesarios para unir MP4 y extraer MP3 con yt-dlp)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Instalar la versión más reciente de yt-dlp
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --upgrade -r requirements.txt

# Copiar los archivos de la aplicación (Frontend + Servidor Backend)
COPY index.html styles.css app.js server.py ./

EXPOSE 10000

# Iniciar el servidor multihilo
CMD ["python3", "server.py"]
