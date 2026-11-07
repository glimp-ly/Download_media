#!/usr/bin/env python3
"""
VerdeDL — Servidor Backend yt-dlp para Descarga Directa (MP4 / MP3)
-------------------------------------------------------------------
Características principales:
1. Túnel automático Cloudflare WARP en espacio de usuario (wgcf + wireproxy en 127.0.0.1:11080)
   para salir a YouTube con IP limpia de WARP en lugar de la IP bloqueada de AWS/Render.
2. Proveedor local de PO Tokens (bgutil-pot en 127.0.0.1:4416) + NodeJS JS Challenge Solver.
3. Seguimiento de progreso en tiempo real (/api/download/start, /api/download/progress, /api/download/file)
   leyendo los estados y porcentajes reales de yt-dlp línea por línea.
"""

import base64
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import uuid
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

# Registro en memoria de trabajos de descarga activos
JOBS_LOCK = threading.Lock()
JOBS: dict[str, dict] = {}

PROGRESS_RE = re.compile(
    r"\[download\]\s+(?P<pct>\d+(?:\.\d+)?)%"
    r"(?:\s+of\s+~?\s*(?P<size>\S+))?"
    r"(?:\s+at\s+(?P<speed>\S+))?"
    r"(?:\s+ETA\s+(?P<eta>\S+))?"
)


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


def cleanup_old_jobs():
    """Limpia trabajos antiguos que hayan quedado sin reclamar tras 15 minutos."""
    now = time.time()
    expired_ids = []
    with JOBS_LOCK:
        for jid, job in list(JOBS.items()):
            if now - job.get("created_at", now) > 900:
                expired_ids.append(jid)
        for jid in expired_ids:
            job = JOBS.pop(jid, None)
            if job and job.get("tmpdir"):
                shutil.rmtree(job["tmpdir"], ignore_errors=True)


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


def build_base_ytdlp_args(
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
        "--newline",
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


def build_attempt_profiles(cookies_file: str | None) -> list[list[str]]:
    warp_ready = is_port_open(WARP_PROXY_PORT)
    profiles: list[list[str]] = []

    if warp_ready:
        profiles.append(["--proxy", WARP_PROXY_URL])
        profiles.append(
            [
                "--proxy",
                WARP_PROXY_URL,
                "--extractor-args",
                "youtube:player_client=mweb,android_vr",
            ]
        )

    profiles.append(
        [
            "--impersonate",
            "chrome",
            "--extractor-args",
            "youtube:player_client=mweb,android_vr",
        ]
    )

    if cookies_file:
        cookie_flags = ["--cookies", cookies_file, "--extractor-args", "youtube:player_client=mweb,web"]
        if warp_ready:
            profiles.append(["--proxy", WARP_PROXY_URL] + cookie_flags)
        profiles.append(["--impersonate", "chrome"] + cookie_flags)

    return profiles


def update_job(job_id: str, **updates):
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(updates)


def parse_ytdlp_line(job_id: str, line: str, fmt: str, stream_count: int) -> int:
    """Interpreta una línea de salida de yt-dlp y actualiza el estado y porcentaje del trabajo."""
    s = line.strip()
    if not s:
        return stream_count

    if s.startswith("[youtube]") or s.startswith("[info]"):
        if "Downloading webpage" in s or "Extracting URL" in s:
            update_job(job_id, stage="Analizando enlace del video…", percent=4)
        elif "player API JSON" in s or "m3u8 information" in s:
            update_job(job_id, stage="Obteniendo formatos de video y audio…", percent=8)
        elif "Solving JS challenges" in s:
            update_job(job_id, stage="Preparando descarga…", percent=12)
        return stream_count

    if s.startswith("[download] Destination:"):
        stream_count += 1
        if fmt == "mp3":
            update_job(job_id, stage="Descargando pista de audio…")
        elif stream_count == 1:
            update_job(job_id, stage="Descargando pista de video…")
        else:
            update_job(job_id, stage="Descargando pista de audio para unir…")
        return stream_count

    m = PROGRESS_RE.search(s)
    if m:
        try:
            raw_pct = float(m.group("pct"))
        except ValueError:
            raw_pct = 0.0

        # Escalar el porcentaje de forma continua:
        # En MP4 normalmente se descarga video (12%->78%) + audio (78%->92%) + unión ffmpeg (95%)
        # En MP3 se descarga audio (12%->88%) + conversión a MP3 (95%)
        if fmt == "mp4":
            if stream_count <= 1:
                scaled = 12.0 + (raw_pct * 0.66)
                stage_label = "Descargando video…"
            else:
                scaled = 78.0 + (raw_pct * 0.14)
                stage_label = "Descargando audio…"
        else:
            scaled = 12.0 + (raw_pct * 0.76)
            stage_label = "Descargando audio…"

        size_val = m.group("size") or ""
        speed_val = m.group("speed") or ""
        eta_val = m.group("eta") or ""
        if speed_val == "Unknown":
            speed_val = ""
        if eta_val == "Unknown":
            eta_val = ""

        update_job(
            job_id,
            percent=round(min(94.0, max(5.0, scaled)), 1),
            raw_percent=round(raw_pct, 1),
            stage=stage_label,
            size=size_val,
            speed=speed_val,
            eta=eta_val,
        )
        return stream_count

    if s.startswith("[Merger]"):
        update_job(
            job_id,
            percent=95.0,
            stage="Uniendo video y audio en formato MP4…",
            speed="",
            eta="",
        )
    elif s.startswith("[ExtractAudio]"):
        update_job(
            job_id,
            percent=95.0,
            stage="Convirtiendo audio a formato MP3…",
            speed="",
            eta="",
        )
    elif s.startswith("[EmbedThumbnail]") or s.startswith("[Metadata]"):
        update_job(
            job_id,
            percent=97.0,
            stage="Incrustando portada y datos…",
            speed="",
            eta="",
        )

    return stream_count


def run_download_job(job_id: str, payload: dict):
    """Ejecuta yt-dlp en un hilo en segundo plano actualizando el progreso en tiempo real."""
    url = str(payload.get("url") or "").strip()
    fmt = "mp3" if str(payload.get("format")).lower() == "mp3" else "mp4"
    video_quality = str(payload.get("videoQuality") or "best")
    audio_quality = str(payload.get("audioQuality") or "0")
    no_playlist = bool(payload.get("noPlaylist", True))
    embed_metadata = bool(payload.get("embedMetadata", False))
    subtitles = bool(payload.get("subtitles", False))

    tmpdir = tempfile.mkdtemp(prefix="verdedl_")
    update_job(job_id, tmpdir=tmpdir, stage="Conectando con la plataforma…", percent=2.0)

    cookies_file = get_working_cookie_file("", tmpdir)
    output_template = os.path.join(tmpdir, "%(title).120s.%(ext)s")
    base_args = build_base_ytdlp_args(
        fmt=fmt,
        video_quality=video_quality,
        audio_quality=audio_quality,
        no_playlist=no_playlist,
        embed_metadata=embed_metadata,
        subtitles=subtitles,
        output_template=output_template,
    )

    profiles = build_attempt_profiles(cookies_file)
    errors_collected: list[str] = []
    success = False

    for extra_flags in profiles:
        # Limpiar archivos parciales entre intentos si hubo un intento previo fallido
        for fname in os.listdir(tmpdir):
            if fname != "cookies.txt":
                try:
                    os.remove(os.path.join(tmpdir, fname))
                except OSError:
                    pass

        cmd = base_args + extra_flags + ["--", url]
        stream_count = 0
        proc_lines: list[str] = []

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                proc_lines.append(line.rstrip())
                stream_count = parse_ytdlp_line(job_id, line, fmt, stream_count)

            proc.wait(timeout=600)
        except subprocess.TimeoutExpired:
            proc.kill()
            update_job(
                job_id,
                status="error",
                stage="Tiempo de espera agotado",
                error="Tiempo de espera agotado al descargar el video.",
            )
            return
        except Exception as exc:
            errors_collected.append(str(exc))
            continue

        if proc.returncode == 0:
            success = True
            break

        err_lines = [l for l in proc_lines if "ERROR:" in l]
        if err_lines:
            errors_collected.append(err_lines[-1])
        elif proc_lines:
            errors_collected.append(proc_lines[-1])

    if not success:
        primary_error = errors_collected[0] if errors_collected else "Error al ejecutar yt-dlp."
        update_job(
            job_id,
            status="error",
            stage="No se pudo completar la descarga",
            error=f"yt-dlp reportó un error: {primary_error}",
        )
        return

    files = [
        Path(tmpdir) / f
        for f in os.listdir(tmpdir)
        if os.path.isfile(os.path.join(tmpdir, f)) and f != "cookies.txt"
    ]
    if not files:
        update_job(
            job_id,
            status="error",
            stage="Error al generar el archivo",
            error="No se encontró el archivo generado por yt-dlp.",
        )
        return

    matching = [p for p in files if p.suffix.lower() == f".{fmt}"]
    target_file = matching[0] if matching else max(files, key=lambda p: p.stat().st_size)

    update_job(
        job_id,
        status="ready",
        percent=100.0,
        stage="¡Archivo listo! Guardando en tu dispositivo…",
        speed="",
        eta="",
        file_path=str(target_file),
        filename=target_file.name,
        fmt=fmt,
    )


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

        if parsed.path == "/api/download/progress":
            params = urllib.parse.parse_qs(parsed.query)
            job_id = (params.get("id") or [""])[0].strip()
            self._handle_download_progress(job_id)
            return

        if parsed.path == "/api/download/file":
            params = urllib.parse.parse_qs(parsed.query)
            job_id = (params.get("id") or [""])[0].strip()
            self._handle_download_file(job_id)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/download/start":
            self._handle_download_start()
            return
        if parsed.path == "/api/download":
            self._handle_download_sync()
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Ruta no encontrada."})

    def _handle_download_start(self):
        cleanup_old_jobs()
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

        job_id = uuid.uuid4().hex
        with JOBS_LOCK:
            JOBS[job_id] = {
                "id": job_id,
                "status": "running",
                "percent": 1.0,
                "raw_percent": 0.0,
                "stage": "Iniciando descarga…",
                "size": "",
                "speed": "",
                "eta": "",
                "error": "",
                "file_path": "",
                "filename": "",
                "fmt": "mp3" if str(payload.get("format")).lower() == "mp3" else "mp4",
                "tmpdir": "",
                "created_at": time.time(),
            }

        worker = threading.Thread(target=run_download_job, args=(job_id, payload), daemon=True)
        worker.start()

        self._send_json(HTTPStatus.OK, {"job_id": job_id})

    def _handle_download_progress(self, job_id: str):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            if not job:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Trabajo de descarga no encontrado."})
                return
            data = {
                "status": job["status"],
                "percent": job["percent"],
                "raw_percent": job["raw_percent"],
                "stage": job["stage"],
                "size": job["size"],
                "speed": job["speed"],
                "eta": job["eta"],
                "filename": job["filename"],
                "error": job["error"],
            }
        self._send_json(HTTPStatus.OK, data)

    def _handle_download_file(self, job_id: str):
        with JOBS_LOCK:
            job = JOBS.pop(job_id, None)

        if not job or job.get("status") != "ready" or not job.get("file_path"):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "El archivo aún no está listo o ya fue descargado."})
            return

        tmpdir = job.get("tmpdir")
        try:
            target_file = Path(job["file_path"])
            if not target_file.is_file():
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Archivo no encontrado en el servidor."})
                return

            fmt = job.get("fmt") or "mp4"
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
        finally:
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)

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

    def _handle_download_sync(self):
        """Endpoint síncrono de respaldo (/api/download)."""
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

        job_id = uuid.uuid4().hex
        with JOBS_LOCK:
            JOBS[job_id] = {
                "id": job_id,
                "status": "running",
                "percent": 0.0,
                "raw_percent": 0.0,
                "stage": "",
                "size": "",
                "speed": "",
                "eta": "",
                "error": "",
                "file_path": "",
                "filename": "",
                "fmt": "mp3" if str(payload.get("format")).lower() == "mp3" else "mp4",
                "tmpdir": "",
                "created_at": time.time(),
            }

        run_download_job(job_id, payload)
        with JOBS_LOCK:
            job = JOBS.get(job_id)

        if not job or job.get("status") != "ready":
            err = (job or {}).get("error") or "Error al procesar la descarga."
            if job and job.get("tmpdir"):
                shutil.rmtree(job["tmpdir"], ignore_errors=True)
            with JOBS_LOCK:
                JOBS.pop(job_id, None)
            self._send_json(HTTPStatus.BAD_GATEWAY, {"error": err})
            return

        self._handle_download_file(job_id)

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
