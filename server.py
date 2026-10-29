#!/usr/bin/env python3
"""
VerdeDL — Servidor Backend yt-dlp para Descarga Directa (MP4 / MP3)
-------------------------------------------------------------------
Sirve la web estática localmente y expone una API con CORS habilitado
para que tanto en local como desde GitHub Pages puedas descargar el
archivo MP4 o MP3 directamente en el navegador usando yt-dlp.

Uso:
    python3 server.py
"""

import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")
WEB_ROOT = Path(__file__).resolve().parent


def _detect_ytdlp_version() -> str:
    try:
        import yt_dlp  # type: ignore

        return str(yt_dlp.version.__version__)
    except Exception:
        pass
    try:
        res = subprocess.run(
            ["yt-dlp", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if res.returncode == 0:
            return res.stdout.strip()
    except Exception:
        pass
    return "installed"


YTDLP_VERSION = _detect_ytdlp_version()


def get_ytdlp_version() -> str:
    return YTDLP_VERSION


def validate_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    parsed = urllib.parse.urlparse(url.strip())
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


class VerdeDLRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def end_headers(self):
        # Cabeceras CORS para permitir conexión desde GitHub Pages
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Expose-Headers", "Content-Disposition")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "engine": "yt-dlp",
                    "version": get_ytdlp_version(),
                },
            )
            return

        if parsed.path == "/api/info":
            params = urllib.parse.parse_qs(parsed.query)
            url = (params.get("url") or [""])[0].strip()
            if not validate_url(url):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "URL inválida."})
                return
            self._handle_video_info(url)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/download":
            self._handle_download()
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Ruta no encontrada."})

    def _handle_video_info(self, url: str):
        try:
            cmd = [
                "yt-dlp",
                "--dump-single-json",
                "--no-playlist",
                "--no-warnings",
                url,
            ]
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
            if proc.returncode != 0 or not proc.stdout:
                self._send_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"error": "No se pudo obtener información del enlace."},
                )
                return

            info = json.loads(proc.stdout)
            self._send_json(
                HTTPStatus.OK,
                {
                    "title": info.get("title") or "Video",
                    "uploader": info.get("uploader") or info.get("channel") or "",
                    "thumbnail": info.get("thumbnail") or "",
                    "duration": info.get("duration") or 0,
                    "duration_string": info.get("duration_string") or "",
                    "extractor_key": info.get("extractor_key") or "Video",
                },
            )
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def _handle_download(self):
        try:
            content_len = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON inválido."})
            return

        url = str(payload.get("url") or "").strip()
        if not validate_url(url):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Enlace inválido."})
            return

        fmt = "mp3" if str(payload.get("format")).lower() == "mp3" else "mp4"
        video_quality = str(payload.get("videoQuality") or "best")
        audio_quality = str(payload.get("audioQuality") or "0")
        no_playlist = bool(payload.get("noPlaylist", True))
        embed_metadata = bool(payload.get("embedMetadata", False))
        subtitles = bool(payload.get("subtitles", False))

        with tempfile.TemporaryDirectory(prefix="verdedl_") as tmpdir:
            output_template = os.path.join(tmpdir, "%(title).120s.%(ext)s")
            cmd = ["yt-dlp", "--no-playlist" if no_playlist else "--yes-playlist", "--no-part"]

            if fmt == "mp4":
                if video_quality.isdigit():
                    h = video_quality
                    cmd.extend(
                        [
                            "-f",
                            f"bv*[height<={h}][ext=mp4]+ba[ext=m4a]/b[height<={h}][ext=mp4] / bv*[height<={h}]+ba/b[height<={h}]",
                        ]
                    )
                else:
                    cmd.extend(
                        [
                            "-f",
                            "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
                        ]
                    )
                cmd.extend(["--merge-output-format", "mp4"])
            else:
                valid_aq = audio_quality if audio_quality in ("0", "192K", "128K", "96K") else "0"
                cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", valid_aq])

            if embed_metadata:
                cmd.extend(["--embed-thumbnail", "--embed-metadata"])

            if fmt == "mp4" and subtitles:
                cmd.extend(["--write-subs", "--embed-subs", "--sub-langs", "es.*,en.*"])

            cmd.extend(["-o", output_template, "--", url])

            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=600,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                self._send_json(
                    HTTPStatus.GATEWAY_TIMEOUT,
                    {"error": "Tiempo de espera agotado al descargar el video."},
                )
                return

            if proc.returncode != 0:
                stderr_tail = (proc.stderr or proc.stdout or "Error en yt-dlp").strip().splitlines()[-1]
                self._send_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"error": f"yt-dlp reportó un error: {stderr_tail}"},
                )
                return

            files = [
                Path(tmpdir) / f
                for f in os.listdir(tmpdir)
                if os.path.isfile(os.path.join(tmpdir, f))
            ]
            if not files:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "No se encontró el archivo generado por yt-dlp."},
                )
                return

            # Preferir archivo que coincida con la extensión solicitada (.mp4 o .mp3)
            matching = [p for p in files if p.suffix.lower() == f".{fmt}"]
            target_file = matching[0] if matching else max(files, key=lambda p: p.stat().st_size)

            file_size = target_file.stat().st_size
            filename = target_file.name
            ascii_filename = filename.encode("ascii", "ignore").decode("ascii") or f"descarga.{fmt}"
            utf8_filename = urllib.parse.quote(filename)
            mime_type = (
                "audio/mpeg"
                if fmt == "mp3"
                else (mimetypes.guess_type(filename)[0] or "video/mp4")
            )

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{utf8_filename}',
            )
            self.end_headers()

            with open(target_file, "rb") as f:
                shutil.copyfileobj(f, self.wfile)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    if not shutil.which("yt-dlp"):
        print("[!] Advertencia: 'yt-dlp' no se encontró en el PATH. Instálalo con: pip install -U yt-dlp")

    server = ThreadingHTTPServer((HOST, PORT), VerdeDLRequestHandler)
    print("============================================================")
    print(f"  VerdeDL Server activo en: http://localhost:{PORT}")
    print(f"  Motor yt-dlp versión:     {get_ytdlp_version()}")
    print("  Presiona Ctrl+C para detener el servidor.")
    print("============================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDeteniendo servidor...")
        server.server_close()


if __name__ == "__main__":
    main()
