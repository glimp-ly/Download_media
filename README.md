# VerdeDL — Descargador Web con `yt-dlp` (MP4 & MP3)

Aplicación web responsiva con paleta de colores verdes, sin necesidad de login, diseñada para funcionar tanto publicada estáticamente en **GitHub Pages** como conectada a un motor local/remoto de **`yt-dlp`** para descargas directas.

## Características principales

- **Sin registro ni login:** Acceso inmediato a todas las funciones.
- **Selector intuitivo MP4 (Video) y MP3 (Audio):**
  - **MP4:** Selección de resolución máxima (`Mejor calidad`, `4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`), subtítulos e incrustación de miniatura/metadatos.
  - **MP3:** Extracción directa de audio con selección de calidad (`320kbps / VBR 0`, `192K`, `128K`, `96K`).
- **Armado automático del comando `yt-dlp`:**
  - Actualización en tiempo real del comando exacto según el enlace y las opciones elegidas.
  - Explicación visual de cada parámetro del comando.
  - Botón para copiar con un clic y descarga de script ejecutable (`.sh` para Linux/macOS o `.bat` para Windows).
- **Vista previa del video:** Muestra título, autor y miniatura automáticamente (compatible con GitHub Pages vía oEmbed y con metadatos completos vía `yt-dlp`).
- **Descarga directa desde el navegador:** Incluye [`server.py`](./server.py) con `yt-dlp` y soporte CORS para descargar el archivo `.mp4` o `.mp3` directamente a tu dispositivo.
- **Diseño Responsive y Paleta Verde:** Adaptado a móviles, tablets y escritorio, con cambio entre modo **Verde Bosque Oscuro** y **Verde Menta Claro**.

---

## Cómo publicar en GitHub Pages

1. Sube este repositorio a GitHub.
2. Ve a **Settings → Pages** en tu repositorio.
3. En **Build and deployment**, selecciona **Deploy from a branch** (rama `main` / carpeta `/ (root)`) o **GitHub Actions** (ya incluye el workflow en `.github/workflows/deploy-pages.yml`).
4. ¡Listo! Tu web estará publicada en `https://<tu-usuario>.github.io/<tu-repo>/`.

---

## Cómo usar la descarga directa con `yt-dlp`

Para descargar el archivo `.mp4` o `.mp3` directamente desde el navegador (incluso entrando desde tu URL de GitHub Pages):

1. Asegúrate de tener `yt-dlp` y `ffmpeg` instalados:
   ```bash
   pip install -U yt-dlp
   ```
2. Inicia el servidor incluido:
   ```bash
   python3 server.py
   ```
3. Abre `http://localhost:8000` (o usa tu web de GitHub Pages; se conectará automáticamente a `http://localhost:8000`).
