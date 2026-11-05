/* ==========================================================================
   VerdeDL — lógica de la interfaz
   Inicio: pegar enlace → elegir video/audio → descargar.
   Ajustes: calidad, extras y (en "Avanzado") comando yt-dlp y servidor.
   ========================================================================== */

(function () {
  "use strict";

  // Servidor de descargas por defecto (Render)
  const DEFAULT_BACKEND = "https://download-media-fhx6.onrender.com";
  const STORE_KEY = "verdedl_settings";

  const DEFAULTS = {
    videoQuality: "best",
    audioQuality: "0",
    embedMetadata: false,
    subtitles: false,
    playlist: false,
    browserCookies: "none",
    osTarget: /win/i.test(navigator.userAgent) ? "windows" : "unix",
    backendUrl: "",
  };

  const VIDEO_LABELS = {
    best: "la mejor disponible",
    2160: "4K",
    1440: "1440p",
    1080: "1080p",
    720: "720p",
    480: "480p",
    360: "360p",
  };
  const AUDIO_LABELS = { 0: "máxima (320 kbps)", "192K": "192 kbps", "128K": "128 kbps", "96K": "96 kbps" };

  const ICONS = {
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
    loading: '<span class="spinner"></span>',
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    viewHome: $("viewHome"),
    viewSettings: $("viewSettings"),
    navSettings: $("navSettings"),

    urlInput: $("urlInput"),
    clearBtn: $("clearBtn"),
    pasteBtn: $("pasteBtn"),
    urlHint: $("urlHint"),
    preview: $("preview"),
    previewThumb: $("previewThumb"),
    previewTitle: $("previewTitle"),
    previewMeta: $("previewMeta"),
    formatRadios: document.querySelectorAll('input[name="format"]'),
    downloadBtn: $("downloadBtn"),
    downloadLabel: $("downloadLabel"),
    qualitySummary: $("qualitySummary"),

    status: $("status"),
    statusIcon: $("statusIcon"),
    statusTitle: $("statusTitle"),
    statusText: $("statusText"),
    statusBar: $("statusBar"),
    statusDetails: $("statusDetails"),
    statusRaw: $("statusRaw"),

    videoQuality: $("videoQuality"),
    audioQuality: $("audioQuality"),
    optMetadata: $("optMetadata"),
    optSubtitles: $("optSubtitles"),
    osTarget: $("osTarget"),
    cmdFormat: $("cmdFormat"),
    optPlaylist: $("optPlaylist"),
    browserCookies: $("browserCookies"),
    cmdOutput: $("cmdOutput"),
    copyCmdBtn: $("copyCmdBtn"),
    scriptBtn: $("scriptBtn"),
    serverStatus: $("serverStatus"),
    backendInput: $("backendInput"),
    saveBackendBtn: $("saveBackendBtn"),
    resetBackendBtn: $("resetBackendBtn"),
    resetAllBtn: $("resetAllBtn"),

    toast: $("toast"),
  };

  const state = { url: "", format: "mp4", title: "", busy: false };
  let settings = loadSettings();
  let previewTimer = null;
  let toastTimer = null;

  // ------------------------------------------------------------------
  // Ajustes guardados
  // ------------------------------------------------------------------
  function loadSettings() {
    // Limpiar datos de versiones anteriores
    ["verdedl_cookies_txt", "verdedl_backend_url", "verdedl_history", "verdedl_theme"].forEach((k) =>
      localStorage.removeItem(k)
    );
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    updateHomeLabels();
    renderCommand();
  }

  function backendUrl() {
    if (settings.backendUrl) return settings.backendUrl;
    const host = location.hostname;
    if (location.protocol.startsWith("http") && !host.endsWith(".github.io")) return location.origin;
    return DEFAULT_BACKEND;
  }

  function fillSettingsForm() {
    els.videoQuality.value = settings.videoQuality;
    els.audioQuality.value = settings.audioQuality;
    els.optMetadata.checked = settings.embedMetadata;
    els.optSubtitles.checked = settings.subtitles;
    els.osTarget.value = settings.osTarget;
    els.optPlaylist.checked = settings.playlist;
    els.browserCookies.value = settings.browserCookies;
    els.backendInput.value = settings.backendUrl;
    els.backendInput.placeholder = backendUrl();
  }

  // ------------------------------------------------------------------
  // Navegación (#inicio / #ajustes)
  // ------------------------------------------------------------------
  function route() {
    const onSettings = location.hash === "#ajustes";
    els.viewHome.hidden = onSettings;
    els.viewSettings.hidden = !onSettings;
    els.navSettings.classList.toggle("active", onSettings);
    window.scrollTo(0, 0);
    if (onSettings) {
      els.cmdFormat.value = state.format;
      renderCommand();
      refreshServerStatus();
    }
  }

  // ------------------------------------------------------------------
  // Pantalla principal
  // ------------------------------------------------------------------
  function updateHomeLabels() {
    const isVideo = state.format === "mp4";
    els.downloadLabel.textContent = isVideo ? "Descargar video" : "Descargar audio";
    els.qualitySummary.textContent = isVideo
      ? VIDEO_LABELS[settings.videoQuality] || settings.videoQuality
      : AUDIO_LABELS[settings.audioQuality] || settings.audioQuality;
  }

  function validateUrl(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      return { ok: true, host: u.hostname.replace(/^www\.|^m\./, "") };
    } catch {
      return { ok: false, msg: "Eso no parece un enlace. Debe empezar con https://" };
    }
  }

  function setHint(msg) {
    els.urlHint.textContent = msg || "";
    els.urlHint.hidden = !msg;
  }

  function onUrlChange(value) {
    state.url = value.trim();
    state.title = "";
    els.clearBtn.hidden = !state.url;
    els.preview.hidden = true;
    setHint("");
    clearTimeout(previewTimer);

    if (!state.url) return;
    const v = validateUrl(state.url);
    if (!v.ok) {
      if (state.url.length > 6) setHint(v.msg);
      return;
    }
    previewTimer = setTimeout(() => loadPreview(state.url), 400);
  }

  async function loadPreview(url) {
    try {
      const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (url !== state.url || !data || !data.title) return;
      state.title = data.title;
      els.previewTitle.textContent = data.title;
      els.previewMeta.textContent = [data.author_name, data.provider_name].filter(Boolean).join(" · ");
      if (data.thumbnail_url) {
        els.previewThumb.src = data.thumbnail_url;
        els.previewThumb.hidden = false;
      } else {
        els.previewThumb.hidden = true;
      }
      els.preview.hidden = false;
    } catch {
      /* la vista previa es opcional */
    }
  }

  // ------------------------------------------------------------------
  // Estado de la descarga
  // ------------------------------------------------------------------
  function showStatus(kind, title, text, raw) {
    els.status.hidden = false;
    els.status.className = `status is-${kind}`;
    els.statusIcon.innerHTML = ICONS[kind] || "";
    els.statusTitle.textContent = title;
    els.statusText.textContent = text || "";
    els.statusBar.hidden = kind !== "loading";
    els.statusDetails.hidden = !raw;
    els.statusDetails.open = false;
    els.statusRaw.textContent = raw || "";
  }

  function friendlyError(raw) {
    const m = (raw || "").toLowerCase();
    if (m.includes("private")) return "Este video es privado y no se puede descargar.";
    if (m.includes("age") && (m.includes("restrict") || m.includes("confirm your age")))
      return "Este video tiene restricción de edad y no se puede descargar.";
    if (m.includes("unsupported url")) return "Esta página todavía no es compatible. Prueba con otro enlace.";
    if (m.includes("unavailable") || m.includes("removed") || m.includes("not available"))
      return "El video no está disponible. Puede que lo hayan borrado o que no se vea en tu país.";
    if (m.includes("live")) return "No se pueden descargar transmisiones en vivo mientras están en curso.";
    if (m.includes("tiempo de espera") || m.includes("timeout"))
      return "La descarga tardó demasiado. Prueba con una calidad menor o un video más corto.";
    if (m.includes("bot") || m.includes("sign in") || m.includes("403") || m.includes("player response"))
      return "La plataforma bloqueó la descarga por un momento. Inténtalo de nuevo en unos minutos.";
    return "No pudimos descargar este enlace. Revisa que sea correcto o inténtalo más tarde.";
  }

  async function pingServer(timeoutMs, onSlow) {
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), timeoutMs);
    const slow = onSlow ? setTimeout(onSlow, 2500) : null;
    try {
      const res = await fetch(`${backendUrl()}/api/health`, { signal: controller.signal, cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      return Boolean(data && data.status === "ok");
    } catch {
      return false;
    } finally {
      clearTimeout(killer);
      if (slow) clearTimeout(slow);
    }
  }

  async function download() {
    if (state.busy) return;

    if (!state.url) {
      setHint("Primero pega el enlace del video.");
      els.urlInput.focus();
      return;
    }
    const v = validateUrl(state.url);
    if (!v.ok) {
      setHint(v.msg);
      els.urlInput.focus();
      return;
    }

    state.busy = true;
    els.downloadBtn.disabled = true;
    showStatus("loading", "Conectando…", "");

    const online = await pingServer(70000, () =>
      showStatus(
        "loading",
        "Preparando el servicio…",
        "La primera descarga puede tardar hasta un minuto mientras el servicio se activa."
      )
    );

    if (!online) {
      showStatus(
        "error",
        "El servicio no está disponible",
        "Inténtalo de nuevo en unos minutos.",
        `Sin respuesta de ${backendUrl()}/api/health`
      );
      finish();
      return;
    }

    const isVideo = state.format === "mp4";
    showStatus(
      "loading",
      isVideo ? "Preparando tu video…" : "Preparando tu audio…",
      state.title ? `«${state.title}». Puede tardar un poco según la duración.` : "Puede tardar un poco según la duración."
    );

    try {
      const res = await fetch(`${backendUrl()}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: state.url,
          format: state.format,
          videoQuality: settings.videoQuality,
          audioQuality: settings.audioQuality,
          noPlaylist: true,
          embedMetadata: settings.embedMetadata,
          subtitles: settings.subtitles,
        }),
      });

      if (!res.ok) {
        let raw = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data && data.error) raw = data.error;
        } catch {
          /* respuesta no JSON */
        }
        showStatus("error", "No se pudo descargar", friendlyError(raw), raw);
        return;
      }

      const blob = await res.blob();
      const filename = filenameFromHeaders(res.headers) || `descarga.${state.format}`;
      saveBlob(blob, filename);
      showStatus("done", "¡Listo!", `Se guardó «${filename}» en tu carpeta de descargas.`);
    } catch (err) {
      showStatus(
        "error",
        "Se perdió la conexión",
        "Revisa tu internet e inténtalo de nuevo.",
        String(err && err.message ? err.message : err)
      );
    } finally {
      finish();
    }
  }

  function finish() {
    state.busy = false;
    els.downloadBtn.disabled = false;
  }

  function filenameFromHeaders(headers) {
    const cd = headers.get("Content-Disposition") || "";
    const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8) {
      try {
        return decodeURIComponent(utf8[1]);
      } catch {
        return utf8[1];
      }
    }
    const ascii = cd.match(/filename="?([^";]+)"?/i);
    return ascii ? ascii[1] : null;
  }

  function saveBlob(blob, filename) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  }

  // ------------------------------------------------------------------
  // Comando yt-dlp (Ajustes → Avanzado)
  // ------------------------------------------------------------------
  function buildCommand(fmt) {
    const parts = ["yt-dlp"];
    if (fmt === "mp4") {
      const q = settings.videoQuality;
      const f =
        q === "best"
          ? "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"
          : `bv*[height<=${q}][ext=mp4]+ba[ext=m4a]/b[height<=${q}][ext=mp4]/bv*[height<=${q}]+ba/b[height<=${q}]`;
      parts.push(`-f "${f}"`, "--merge-output-format mp4");
      if (settings.subtitles) parts.push("--write-subs --embed-subs", '--sub-langs "es.*,en.*"');
    } else {
      parts.push("-x --audio-format mp3", `--audio-quality ${settings.audioQuality}`);
    }
    parts.push(settings.playlist ? "--yes-playlist" : "--no-playlist");
    if (settings.embedMetadata) parts.push("--embed-thumbnail --embed-metadata");
    if (settings.browserCookies !== "none") parts.push(`--cookies-from-browser ${settings.browserCookies}`);
    parts.push('-o "%(title)s.%(ext)s"');
    const url = (state.url || "ENLACE_DEL_VIDEO").replace(/"/g, '\\"');
    parts.push(`"${url}"`);
    return parts.join(" ");
  }

  function renderCommand() {
    els.cmdOutput.textContent = buildCommand(els.cmdFormat.value);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function downloadScript() {
    const fmt = els.cmdFormat.value;
    const cmd = buildCommand(fmt);
    const win = settings.osTarget === "windows";
    const name = `descargar_${fmt}.${win ? "bat" : "sh"}`;
    const body = win
      ? [
          "@echo off",
          "chcp 65001 >nul",
          "where yt-dlp >nul 2>nul || (echo Instala yt-dlp con: winget install yt-dlp.yt-dlp & pause & exit /b 1)",
          cmd,
          "pause",
        ].join("\r\n")
      : [
          "#!/usr/bin/env bash",
          "set -e",
          'command -v yt-dlp >/dev/null || { echo "Instala yt-dlp con: pip install -U yt-dlp"; exit 1; }',
          cmd,
        ].join("\n");
    saveBlob(new Blob([body], { type: "text/plain;charset=utf-8" }), name);
    toast(`Se descargó ${name}`);
  }

  async function refreshServerStatus() {
    els.serverStatus.textContent = "comprobando…";
    els.serverStatus.className = "server-status";
    const ok = await pingServer(60000);
    els.serverStatus.textContent = ok ? "en línea" : "sin respuesta";
    els.serverStatus.className = `server-status ${ok ? "ok" : "bad"}`;
    return ok;
  }

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  function bind() {
    window.addEventListener("hashchange", route);

    els.urlInput.addEventListener("input", (e) => onUrlChange(e.target.value));
    els.urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") download();
    });
    els.clearBtn.addEventListener("click", () => {
      els.urlInput.value = "";
      onUrlChange("");
      els.status.hidden = true;
      els.urlInput.focus();
    });
    els.pasteBtn.addEventListener("click", async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) return toast("No hay nada copiado");
        els.urlInput.value = text;
        onUrlChange(text);
      } catch {
        els.urlInput.focus();
        toast("Mantén pulsado el campo y elige «Pegar»");
      }
    });

    els.formatRadios.forEach((r) =>
      r.addEventListener("change", () => {
        state.format = r.value;
        updateHomeLabels();
      })
    );
    els.downloadBtn.addEventListener("click", download);

    // Ajustes
    els.videoQuality.addEventListener("change", (e) => {
      settings.videoQuality = e.target.value;
      saveSettings();
    });
    els.audioQuality.addEventListener("change", (e) => {
      settings.audioQuality = e.target.value;
      saveSettings();
    });
    els.optMetadata.addEventListener("change", (e) => {
      settings.embedMetadata = e.target.checked;
      saveSettings();
    });
    els.optSubtitles.addEventListener("change", (e) => {
      settings.subtitles = e.target.checked;
      saveSettings();
    });
    els.osTarget.addEventListener("change", (e) => {
      settings.osTarget = e.target.value;
      saveSettings();
    });
    els.optPlaylist.addEventListener("change", (e) => {
      settings.playlist = e.target.checked;
      saveSettings();
    });
    els.browserCookies.addEventListener("change", (e) => {
      settings.browserCookies = e.target.value;
      saveSettings();
    });
    els.cmdFormat.addEventListener("change", renderCommand);

    els.copyCmdBtn.addEventListener("click", async () => {
      await copyText(buildCommand(els.cmdFormat.value));
      toast(state.url ? "Comando copiado" : "Comando copiado (pega un enlace en Inicio para completarlo)");
    });
    els.scriptBtn.addEventListener("click", downloadScript);

    els.saveBackendBtn.addEventListener("click", async () => {
      settings.backendUrl = els.backendInput.value.trim().replace(/\/+$/, "");
      saveSettings();
      const ok = await refreshServerStatus();
      toast(ok ? "Servidor conectado" : "No responde esa dirección");
    });
    els.resetBackendBtn.addEventListener("click", () => {
      settings.backendUrl = "";
      saveSettings();
      fillSettingsForm();
      refreshServerStatus();
    });
    els.resetAllBtn.addEventListener("click", () => {
      settings = { ...DEFAULTS };
      saveSettings();
      fillSettingsForm();
      toast("Ajustes restablecidos");
    });
  }

  function init() {
    fillSettingsForm();
    updateHomeLabels();
    bind();
    route();
    // Despertar el servidor en segundo plano para que la primera descarga sea más rápida
    pingServer(60000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
