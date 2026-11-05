#!/usr/bin/env python3
"""
VerdeDL — Servidor Backend yt-dlp para Descarga Directa (MP4 / MP3)
-------------------------------------------------------------------
Características principales:
1. Túnel automático Cloudflare WARP en espacio de usuario (wgcf + wireproxy en 127.0.0.1:1080)
   para salir a YouTube con IP limpia de WARP en lugar de la IP bloqueada de AWS/Render,
   permitiendo descargar en 1080p MP4 y MP3 sin necesidad de cookies.
2. Proveedor local de PO Tokens (bgutil-pot en 127.0.0.1:4416) + NodeJS JS Challenge Solver.
3. Soporte opcional de cookies (solo como respaldo si el video tiene restricción de edad).
"""

import base64
import json
import mimetypes
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")
WEB_ROOT = Path(__file__).resolve().parent
PLUGIN_DIR = Path("/etc/yt-dlp/plugins")
WARP_DIR = Path("/tmp/verdedl_warp")
WARP_PROXY_PORT = 11080
WARP_PROXY_URL = f"socks5://127.0.0.1:{WARP_PROXY_PORT}"
PERSISTENT_COOKIE_FILE = Path("/tmp/verdedl_session_cookies.txt")
COOKIE_LOCK = threading.Lock()

SECRET_COOKIE_PATHS = [
    Path("/etc/secrets/cookies.txt"),
    WEB_ROOT / "cookies.txt",
]


def _detect_ytdlp_version() -> str:
    try:
        import yt_dlp  # type: ignore

        return str(yt_dlp.version.__version__)
    except Exception:
        pass
    return "installed"


YTDLP_VERSION = _detect_ytdlp_version()


def get_ytdlp_version() -> str:
    return YTDLP_VERSION


def is_port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def start_warp_proxy_daemon():
    """Configura e inicia Cloudflare WARP (wgcf + wireproxy) en 127.0.0.1:11080."""
    wgcf_bin = shutil.which("wgcf")
    wp_bin = shutil.which("wireproxy")
    if not wgcf_bin or not wp_bin:
        return None

    try:
        WARP_DIR.mkdir(parents=True, exist_ok=True)
        profile_conf = WARP_DIR / "wgcf-profile.conf"

        if not profile_conf.is_file():
            account_toml = WARP_DIR / "wgcf-account.toml"
            if not account_toml.is_file():
                subprocess.run(
                    [wgcf_bin, "register", "--accept-tos"],
                    cwd=str(WARP_DIR),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=20,
                    check=True,
                )
            subprocess.run(
                [wgcf_bin, "generate"],
                cwd=str(WARP_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=True,
            )
            with open(profile_conf, "a", encoding="utf-8") as f:
                f.write(f"\n[Socks5]\nBindAddress = 127.0.0.1:{WARP_PROXY_PORT}\n")

        proc = subprocess.Popen(
            [wp_bin, "-s", "-c", str(profile_conf)],
            cwd=str(WARP_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for _ in range(15):
            if is_port_open(WARP_PROXY_PORT):
                print(f"  Túnel Cloudflare WARP activo en {WARP_PROXY_URL}")
                return proc
            time.sleep(0.3)

        return proc
    except Exception as exc:
        print(f"  [!] No se pudo iniciar Cloudflare WARP: {exc}")
        return None


def start_pot_provider_daemon():
    """Inicia el servidor local bgutil-pot en el puerto 4416 si está instalado."""
    pot_bin = shutil.which("bgutil-pot")
    if not pot_bin:
        return None
    try:
        proc = subprocess.Popen(
            [pot_bin, "server", "--host", "127.0.0.1", "--port", "4416"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print("  Proveedor PO Token (bgutil-pot) activo en 127.0.0.1:4416")
        return proc
    except Exception as exc:
        print(f"  [!] No se pudo iniciar bgutil-pot: {exc}")
        return None


def _decode_raw_cookies(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return ""
    if "\n" not in raw and "\t" not in raw and not raw.startswith("#"):
        try:
            decoded = base64.b64decode(raw).decode("utf-8", errors="ignore")
            if "\t" in decoded or "youtube.com" in decoded:
                return decoded.strip()
        except Exception:
            pass
    return raw


def init_persistent_cookies():
    with COOKIE_LOCK:
        if PERSISTENT_COOKIE_FILE.is_file() and PERSISTENT_COOKIE_FILE.stat().st_size > 0:
            return
        env_raw = _decode_raw_cookies(os.environ.get("YTDLP_COOKIES") or "")
        if env_raw:
            PERSISTENT_COOKIE_FILE.write_text(env_raw + "\n", encoding="utf-8")
            return
        for p in SECRET_COOKIE_PATHS:
            if p.is_file() and p.stat().st_size > 0:
                try:
                    content = p.read_text(encoding="utf-8", errors="ignore").strip()
                    if content:
                        PERSISTENT_COOKIE_FILE.write_text(content + "\n", encoding="utf-8")
                        return
                except Exception:
                    pass


def get_working_cookie_file(payload_cookies: str, tmpdir: str) -> str | None:
    custom = _decode_raw_cookies(payload_cookies)
    with COOKIE_LOCK:
        if custom:
            PERSISTENT_COOKIE_FILE.write_text(custom + "\n", encoding="utf-8")
        elif not PERSISTENT_COOKIE_FILE.is_file() or PERSISTENT_COOKIE_FILE.stat().st_size == 0:
            init_persistent_cookies()

        if PERSISTENT_COOKIE_FILE.is_file() and PERSISTENT_COOKIE_FILE.stat().st_size > 0:
            local_copy = os.path.join(tmpdir, "cookies.txt")
            shutil.copyfile(PERSISTENT_COOKIE_FILE, local_copy)
            return local_copy
    return None


def validate_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    parsed = urllib.parse.urlparse(url.strip())
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


class VerdeDLRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def end_headers(self):
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
                    "warp_active": is_port_open(WARP_PROXY_PORT),
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
        cmd = [
            "yt-dlp",
            "--no-js-runtimes",
            "--js-runtimes",
            "node",
            "--dump-single-json",
            "--no-playlist",
            "--no-warnings",
        ]
        if is_port_open(WARP_PROXY_PORT):
            cmd.extend(["--proxy", WARP_PROXY_URL])
        if PLUGIN_DIR.is_dir():
            cmd.extend(["--plugin-dirs", str(PLUGIN_DIR)])

        cmd.extend(["--", url])
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=35,
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

    def _build_base_ytdlp_args(
        self,
        fmt: str,
        video_quality: str,
        audio_quality: str,
        no_playlist: bool,
        embed_metadata: bool,
        subtitles: bool,
        output_template: str,
    ) -> list[str]:
        args = [
            "yt-dlp",
            "--no-js-runtimes",
            "--js-runtimes",
            "node",
            "--no-playlist" if no_playlist else "--yes-playlist",
            "--no-part",
            "--geo-bypass",
        ]

        if PLUGIN_DIR.is_dir():
            args.extend(["--plugin-dirs", str(PLUGIN_DIR)])

        if fmt == "mp4":
            if video_quality.isdigit():
                h = video_quality
                args.extend(
                    [
                        "-f",
                        f"bv*[height<={h}][ext=mp4]+ba[ext=m4a]/b[height<={h}][ext=mp4]/bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b",
                    ]
                )
            else:
                args.extend(
                    [
                        "-f",
                        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
                    ]
                )
            args.extend(["--merge-output-format", "mp4"])
        else:
            valid_aq = audio_quality if audio_quality in ("0", "192K", "128K", "96K") else "0"
            args.extend(["-x", "--audio-format", "mp3", "--audio-quality", valid_aq])

        if embed_metadata:
            args.extend(["--embed-thumbnail", "--embed-metadata"])

        if fmt == "mp4" and subtitles:
            args.extend(["--write-subs", "--embed-subs", "--sub-langs", "es.*,en.*"])

        args.extend(["-o", output_template])
        return args

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
            cookies_file = get_working_cookie_file(str(payload.get("cookiesText") or ""), tmpdir)

            output_template = os.path.join(tmpdir, "%(title).120s.%(ext)s")
            base_args = self._build_base_ytdlp_args(
                fmt=fmt,
                video_quality=video_quality,
                audio_quality=audio_quality,
                no_playlist=no_playlist,
                embed_metadata=embed_metadata,
                subtitles=subtitles,
                output_template=output_template,
            )

            warp_ready = is_port_open(WARP_PROXY_PORT)
            profiles: list[list[str]] = []

            if warp_ready:
                # 1. Intento principal: A través de Cloudflare WARP sin cookies (usa clientes nativos tv_samsung + visionos)
                profiles.append(["--proxy", WARP_PROXY_URL])
                # 2. Respaldo con WARP + mweb y PO Token
                profiles.append(
                    [
                        "--proxy",
                        WARP_PROXY_URL,
                        "--extractor-args",
                        "youtube:player_client=mweb,android_vr",
                    ]
                )

            # 3. Intento directo con PO Token
            profiles.append(
                [
                    "--impersonate",
                    "chrome",
                    "--extractor-args",
                    "youtube:player_client=mweb,android_vr",
                ]
            )

            # 4. Solo si los anteriores fallan (ej. video con restricción de edad) y hay cookies disponibles
            if cookies_file:
                cookie_flags = ["--cookies", cookies_file, "--extractor-args", "youtube:player_client=mweb,web"]
                if warp_ready:
                    profiles.append(["--proxy", WARP_PROXY_URL] + cookie_flags)
                profiles.append(["--impersonate", "chrome"] + cookie_flags)

            errors_collected: list[str] = []
            success = False

            for extra_flags in profiles:
                cmd = base_args + extra_flags + ["--", url]
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

                if proc.returncode == 0:
                    success = True
                    break

                err_lines = [
                    line
                    for line in (proc.stderr or proc.stdout or "").splitlines()
                    if "ERROR:" in line
                ]
                if err_lines:
                    errors_collected.append(err_lines[-1])
                elif proc.stderr or proc.stdout:
                    errors_collected.append((proc.stderr or proc.stdout).strip().splitlines()[-1])

            if not success:
                primary_error = errors_collected[0] if errors_collected else "Error al ejecutar yt-dlp."
                self._send_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"error": f"yt-dlp reportó un error: {primary_error}"},
                )
                return

            files = [
                Path(tmpdir) / f
                for f in os.listdir(tmpdir)
                if os.path.isfile(os.path.join(tmpdir, f)) and f != "cookies.txt"
            ]
            if not files:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": "No se encontró el archivo generado por yt-dlp."},
                )
                return

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
        print("[!] Advertencia: 'yt-dlp' no se encontró en el PATH.")

    init_persistent_cookies()
    print("============================================================")
    warp_proc = start_warp_proxy_daemon()
    pot_proc = start_pot_provider_daemon()
    server = ThreadingHTTPServer((HOST, PORT), VerdeDLRequestHandler)
    print(f"  VerdeDL Server activo en: http://localhost:{PORT}")
    print(f"  Motor yt-dlp versión:     {get_ytdlp_version()}")
    print(f"  Túnel Cloudflare WARP:    {'ACTIVO' if is_port_open(WARP_PROXY_PORT) else 'INACTIVO'}")
    print("  Presiona Ctrl+C para detener el servidor.")
    print("============================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDeteniendo servidor...")
        server.server_close()
        if warp_proc:
            warp_proc.terminate()
        if pot_proc:
            pot_proc.terminate()


if __name__ == "__main__":
    main()
