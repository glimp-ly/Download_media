# VerdeDL — Descargador Web con `yt-dlp` (MP4 & MP3)

Aplicación web responsiva con paleta de colores verdes, sin necesidad de login, lista para publicarse tanto en **GitHub Pages** como en **Render.com** (con **Docker + Python + `yt-dlp` + `ffmpeg`** incluidos para descarga directa desde el navegador para cualquier visitante).

## Características principales

- **Sin registro ni login:** Acceso inmediato a todas las funciones.
- **Descarga directa en el navegador (MP4 y MP3):** Cualquier persona que entre a la web puede pegar el link y descargar el archivo `.mp4` o `.mp3` directamente a su celular o PC gracias al backend integrado para **Render**.
- **Armado automático del comando `yt-dlp`:**
  - Actualización en tiempo real del comando según el enlace y las opciones elegidas (`MP4` con resolución hasta 4K/1080p/720p o `MP3` hasta 320kbps).
  - Explicación visual de cada parámetro, copiado en 1 clic y descarga de script ejecutable (`.sh` / `.bat`).
- **Anti-suspensión para Render:** Incluye ping automático en [`app.js`](./app.js) y endpoint `/api/health` listo para mantener el servicio despierto 24/7 con [cron-job.org](https://cron-job.org) o UptimeRobot.

---

## Cómo activarlo en Render al conectar tu GitHub (Gratis)

El repositorio ya incluye [`Dockerfile`](./Dockerfile) y [`render.yaml`](./render.yaml) con `python3`, `yt-dlp` y `ffmpeg` preconfigurados:

1. Sube este repositorio a tu cuenta de **GitHub**.
2. Entra a [Render.com](https://render.com/) → **New +** → **Web Service** (o **Blueprint**).
3. Conecta tu repositorio de GitHub:
   - Render detectará automáticamente el **Runtime: Docker** y el plan **Free**.
   - Haz clic en **Create Web Service**.
4. Cuando termine de desplegar, Render te dará una URL como `https://verdedl-ytdlp.onrender.com`:
   - Si compartes directamente esa URL de Render, **ya incluye tanto la página web completa como el motor de descargas `yt-dlp`**.
   - Si además publicas en **GitHub Pages**, asegúrate de que la constante `DEFAULT_RENDER_URL` en la línea 11 de [`app.js`](./app.js) tenga tu URL de Render (por defecto ya viene como `"https://verdedl-ytdlp.onrender.com"`).

### Evitar que Render se duerma tras 15 minutos de inactividad
Crea una tarea gratuita en [cron-job.org](https://cron-job.org) apuntando a:
```text
https://TU-SERVICIO.onrender.com/api/health
```
Configúrala cada **10 minutos**. Así el contenedor de Render permanecerá activo las 24 horas dentro de las 750 horas gratuitas mensuales.
