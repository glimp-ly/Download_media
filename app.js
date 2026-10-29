/* ==========================================================================
   VerdeDL — Lógica Principal
   Apartado 1: Descarga Directa (Principiantes)
   Apartado 2: Generador de Comandos yt-dlp (Avanzado)
   ========================================================================== */

(function () {
  "use strict";

  // URL activa de tu servicio desplegado en Render
  const DEFAULT_RENDER_URL = "https://download-media-fhx6.onrender.com";

  // Estado de la aplicación
  const state = {
    activeTab: "direct", // 'direct' | 'command'
    url: "",
    format: "mp4", // 'mp4' | 'mp3'
    videoQuality: "best",
    audioQuality: "0",
    osTarget: detectDefaultOS(),
    noPlaylist: true,
    embedMetadata: false,
    subtitles: false,
    browserCookies: "none",
    customCookiesText: localStorage.getItem("verdedl_cookies_txt") || "",
    backendUrl: getInitialBackendUrl(),
    backendOnline: false,
    previewTitle: "",
    isDownloading: false,
  };

  // Referencias al DOM
  const els = {
    brandHomeLink: document.getElementById("brandHomeLink"),
    tabBtnDirect: document.getElementById("tabBtnDirect"),
    tabBtnCommand: document.getElementById("tabBtnCommand"),
    goToCommandTabBtn: document.getElementById("goToCommandTabBtn"),

    heroDirect: document.getElementById("heroDirect"),
    heroCommand: document.getElementById("heroCommand"),
    viewDirectSection: document.getElementById("viewDirectSection"),
    viewCommandSection: document.getElementById("viewCommandSection"),
    qualityOptionsRow: document.getElementById("qualityOptionsRow"),
    osTargetGroup: document.getElementById("osTargetGroup"),

    videoUrlInput: document.getElementById("videoUrlInput"),
    clearUrlBtn: document.getElementById("clearUrlBtn"),
    pasteUrlBtn: document.getElementById("pasteUrlBtn"),
    urlValidationMsg: document.getElementById("urlValidationMsg"),
    platformBadge: document.getElementById("platformBadge"),

    videoPreviewCard: document.getElementById("videoPreviewCard"),
    previewThumbnail: document.getElementById("previewThumbnail"),
    previewDuration: document.getElementById("previewDuration"),
    previewExtractor: document.getElementById("previewExtractor"),
    previewTitle: document.getElementById("previewTitle"),
    previewAuthor: document.getElementById("previewAuthor"),

    formatMp4Btn: document.getElementById("formatMp4Btn"),
    formatMp3Btn: document.getElementById("formatMp3Btn"),
    videoQualityGroup: document.getElementById("videoQualityGroup"),
    audioQualityGroup: document.getElementById("audioQualityGroup"),
    videoQualitySelect: document.getElementById("videoQualitySelect"),
    audioQualitySelect: document.getElementById("audioQualitySelect"),
    osTargetSelect: document.getElementById("osTargetSelect"),

    optNoPlaylist: document.getElementById("optNoPlaylist"),
    optEmbedMetadata: document.getElementById("optEmbedMetadata"),
    optSubtitles: document.getElementById("optSubtitles"),
    subtitlesChipWrap: document.getElementById("subtitlesChipWrap"),
    browserCookiesSelect: document.getElementById("browserCookiesSelect"),

    cookiesHelperDetails: document.getElementById("cookiesHelperDetails"),
    customCookiesInput: document.getElementById("customCookiesInput"),
    cookiesFileInput: document.getElementById("cookiesFileInput"),
    cookiesSavedStatus: document.getElementById("cookiesSavedStatus"),

    terminalModeLabel: document.getElementById("terminalModeLabel"),
    ytdlpCommandOutput: document.getElementById("ytdlpCommandOutput"),
    cmdBreakdown: document.getElementById("cmdBreakdown"),
    copyCmdBtn: document.getElementById("copyCmdBtn"),
    copyCmdText: document.getElementById("copyCmdText"),
    copyPrimaryBtn: document.getElementById("copyPrimaryBtn"),
    downloadScriptBtn: document.getElementById("downloadScriptBtn"),
    downloadScriptPrimaryBtn: document.getElementById("downloadScriptPrimaryBtn"),
    scriptExtLabel: document.getElementById("scriptExtLabel"),
    scriptPrimaryBtnText: document.getElementById("scriptPrimaryBtnText"),

    directDownloadBtn: document.getElementById("directDownloadBtn"),
    directDownloadBtnText: document.getElementById("directDownloadBtnText"),
    downloadStatusPanel: document.getElementById("downloadStatusPanel"),
    downloadSpinner: document.getElementById("downloadSpinner"),
    downloadStatusTitle: document.getElementById("downloadStatusTitle"),
    downloadStatusDetail: document.getElementById("downloadStatusDetail"),
    progressBarFill: document.getElementById("progressBarFill"),

    historySection: document.getElementById("historySection"),
    historyList: document.getElementById("historyList"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),

    serverStatusBtn: document.getElementById("serverStatusBtn"),
    serverStatusDot: document.getElementById("serverStatusDot"),
    serverStatusText: document.getElementById("serverStatusText"),
    serverModal: document.getElementById("serverModal"),
    closeModalBtn: document.getElementById("closeModalBtn"),
    backendUrlInput: document.getElementById("backendUrlInput"),
    saveBackendBtn: document.getElementById("saveBackendBtn"),
    backendTestResult: document.getElementById("backendTestResult"),

    themeToggleBtn: document.getElementById("themeToggleBtn"),
    themeIconSun: document.getElementById("themeIconSun"),
    themeIconMoon: document.getElementById("themeIconMoon"),

    toastNotification: document.getElementById("toastNotification"),
    toastMessage: document.getElementById("toastMessage"),
  };

  let previewDebounceTimer = null;
  let toastTimeout = null;

  // ==========================================================================
  // Inicialización
  // ==========================================================================
  function init() {
    initTheme();
    els.osTargetSelect.value = state.osTarget;
    els.backendUrlInput.value = state.backendUrl;

    if (state.customCookiesText) {
      els.customCookiesInput.value = state.customCookiesText;
      els.cookiesSavedStatus.textContent = "Cookies cargadas listas para usar";
    }

    // Detectar si la URL tiene hash #comando o #descarga-directa
    if (window.location.hash === "#comando") {
      setActiveTab("command");
    } else {
      setActiveTab("direct");
    }

    bindEvents();
    updateUI();
    renderHistory();
    checkBackendStatus();

    // Ping preventivo cada 10 minutos para mantener Render despierto
    setInterval(() => {
      if (state.backendUrl) {
        checkBackendStatus(true);
      }
    }, 10 * 60 * 1000);
  }

  function detectDefaultOS() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) return "windows";
    return "unix";
  }

  function getInitialBackendUrl() {
    const saved = localStorage.getItem("verdedl_backend_url");
    if (
      saved &&
      saved !== "http://localhost:8000" &&
      saved !== "https://verdedl-ytdlp.onrender.com"
    ) {
      return saved;
    }
    return getDefaultBackendUrl();
  }

  function getDefaultBackendUrl() {
    const host = window.location.hostname.toLowerCase();
    if (window.location.protocol.startsWith("http") && !host.endsWith(".github.io")) {
      return window.location.origin;
    }
    return DEFAULT_RENDER_URL;
  }

  // ==========================================================================
  // Navegación entre Apartados (Descarga Directa vs Generador de Comando)
  // ==========================================================================
  function setActiveTab(tab) {
    state.activeTab = tab === "command" ? "command" : "direct";
    const isDirect = state.activeTab === "direct";

    els.tabBtnDirect.classList.toggle("active", isDirect);
    els.tabBtnCommand.classList.toggle("active", !isDirect);

    els.heroDirect.classList.toggle("hidden", !isDirect);
    els.heroCommand.classList.toggle("hidden", isDirect);

    els.viewDirectSection.classList.toggle("hidden", !isDirect);
    els.viewCommandSection.classList.toggle("hidden", isDirect);

    // En modo Descarga Directa (Principiante) ocultamos el selector de SO de terminal
    els.osTargetGroup.classList.toggle("hidden", isDirect);
    els.qualityOptionsRow.classList.toggle("single-col", isDirect);

    history.replaceState(null, "", isDirect ? "#descarga-directa" : "#comando");
    updateUI();
  }

  // ==========================================================================
  // Tema Verde Oscuro / Verde Claro
  // ==========================================================================
  function initTheme() {
    const savedTheme = localStorage.getItem("verdedl_theme") || "dark";
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("verdedl_theme", theme);
    if (theme === "light") {
      els.themeIconSun.classList.add("hidden");
      els.themeIconMoon.classList.remove("hidden");
    } else {
      els.themeIconSun.classList.remove("hidden");
      els.themeIconMoon.classList.add("hidden");
    }
  }

  // ==========================================================================
  // Eventos de Interfaz
  // ==========================================================================
  function bindEvents() {
    // Pestañas de Apartados
    els.tabBtnDirect.addEventListener("click", () => setActiveTab("direct"));
    els.tabBtnCommand.addEventListener("click", () => setActiveTab("command"));
    els.brandHomeLink.addEventListener("click", (e) => {
      e.preventDefault();
      setActiveTab("direct");
    });
    if (els.goToCommandTabBtn) {
      els.goToCommandTabBtn.addEventListener("click", () => setActiveTab("command"));
    }

    // Input de enlace
    els.videoUrlInput.addEventListener("input", (e) => {
      handleUrlChange(e.target.value.trim());
    });

    els.clearUrlBtn.addEventListener("click", () => {
      els.videoUrlInput.value = "";
      handleUrlChange("");
      els.videoUrlInput.focus();
    });

    els.pasteUrlBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          els.videoUrlInput.value = text.trim();
          handleUrlChange(text.trim());
          showToast("Enlace pegado desde el portapapeles");
        }
      } catch {
        els.videoUrlInput.focus();
        showToast("Presiona Ctrl+V para pegar tu enlace");
      }
    });

    // Selección MP4 vs MP3
    els.formatMp4Btn.addEventListener("click", () => setFormat("mp4"));
    els.formatMp3Btn.addEventListener("click", () => setFormat("mp3"));

    // Selectores de calidad y SO
    els.videoQualitySelect.addEventListener("change", (e) => {
      state.videoQuality = e.target.value;
      updateUI();
    });

    els.audioQualitySelect.addEventListener("change", (e) => {
      state.audioQuality = e.target.value;
      updateUI();
    });

    els.osTargetSelect.addEventListener("change", (e) => {
      state.osTarget = e.target.value;
      updateUI();
    });

    // Opciones del Generador de Comando
    els.optNoPlaylist.addEventListener("change", (e) => {
      state.noPlaylist = e.target.checked;
      updateUI();
    });

    els.optEmbedMetadata.addEventListener("change", (e) => {
      state.embedMetadata = e.target.checked;
      updateUI();
    });

    els.optSubtitles.addEventListener("change", (e) => {
      state.subtitles = e.target.checked;
      updateUI();
    });

    els.browserCookiesSelect.addEventListener("change", (e) => {
      state.browserCookies = e.target.value;
      updateUI();
    });

    // Cookies opcionales para descarga directa
    els.customCookiesInput.addEventListener("input", (e) => {
      state.customCookiesText = e.target.value.trim();
      if (state.customCookiesText) {
        localStorage.setItem("verdedl_cookies_txt", state.customCookiesText);
        els.cookiesSavedStatus.textContent = "Cookies guardadas en tu navegador";
      } else {
        localStorage.removeItem("verdedl_cookies_txt");
        els.cookiesSavedStatus.textContent = "";
      }
    });

    els.cookiesFileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result || "").trim();
        state.customCookiesText = content;
        els.customCookiesInput.value = content;
        localStorage.setItem("verdedl_cookies_txt", content);
        els.cookiesSavedStatus.textContent = `Archivo ${file.name} cargado correctamente`;
        showToast("Archivo cookies.txt cargado");
      };
      reader.readAsText(file);
    });

    // Copiar comando y descargar script
    els.copyCmdBtn.addEventListener("click", () => copyGeneratedCommand());
    els.copyPrimaryBtn.addEventListener("click", () => copyGeneratedCommand());
    els.downloadScriptBtn.addEventListener("click", () => downloadExecutableScript());
    if (els.downloadScriptPrimaryBtn) {
      els.downloadScriptPrimaryBtn.addEventListener("click", () => downloadExecutableScript());
    }

    // Descarga directa
    els.directDownloadBtn.addEventListener("click", () => triggerDirectDownload());

    // Historial
    els.clearHistoryBtn.addEventListener("click", () => {
      localStorage.removeItem("verdedl_history");
      renderHistory();
      showToast("Historial limpiado");
    });

    // Modal de servidor
    els.serverStatusBtn.addEventListener("click", () => {
      els.serverModal.classList.remove("hidden");
    });

    els.closeModalBtn.addEventListener("click", () => {
      els.serverModal.classList.add("hidden");
    });

    els.serverModal.addEventListener("click", (e) => {
      if (e.target === els.serverModal) {
        els.serverModal.classList.add("hidden");
      }
    });

    els.saveBackendBtn.addEventListener("click", async () => {
      const cleanUrl = els.backendUrlInput.value.trim().replace(/\/+$/, "");
      if (!cleanUrl) return;
      state.backendUrl = cleanUrl;
      localStorage.setItem("verdedl_backend_url", cleanUrl);
      els.backendTestResult.textContent = "Verificando conexión con el servidor...";
      const online = await checkBackendStatus();
      if (online) {
        els.backendTestResult.textContent = "¡Conectado! El servidor yt-dlp está listo.";
        showToast("Servidor yt-dlp conectado");
      } else {
        els.backendTestResult.textContent = "No se detectó respuesta en esa URL.";
      }
    });

    // Tema
    els.themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // ==========================================================================
  // Manejo de URL, Validación y Detección de Plataforma
  // ==========================================================================
  function handleUrlChange(rawUrl) {
    state.url = rawUrl;
    els.clearUrlBtn.classList.toggle("hidden", !rawUrl);

    if (!rawUrl) {
      els.urlValidationMsg.classList.add("hidden");
      els.platformBadge.classList.add("hidden");
      els.videoPreviewCard.classList.add("hidden");
      state.previewTitle = "";
      updateUI();
      return;
    }

    const validation = validateVideoUrl(rawUrl);
    if (!validation.valid) {
      els.urlValidationMsg.textContent = validation.message;
      els.urlValidationMsg.classList.remove("hidden");
      els.platformBadge.classList.add("hidden");
      els.videoPreviewCard.classList.add("hidden");
      updateUI();
      return;
    }

    els.urlValidationMsg.classList.add("hidden");
    els.platformBadge.textContent = validation.platform;
    els.platformBadge.classList.remove("hidden");
    updateUI();

    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(() => {
      fetchVideoPreview(rawUrl, validation.platform);
    }, 350);
  }

  function validateVideoUrl(input) {
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { valid: false, message: "El enlace debe comenzar con https:// o http://" };
      }
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      const platform = detectPlatformName(host);
      return { valid: true, platform, host };
    } catch {
      return {
        valid: false,
        message: "Ingresa un enlace válido (ejemplo: https://www.youtube.com/watch?v=...)",
      };
    }
  }

  function detectPlatformName(host) {
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
    if (host.includes("tiktok.com")) return "TikTok";
    if (host.includes("vimeo.com")) return "Vimeo";
    if (host.includes("twitch.tv")) return "Twitch";
    if (host.includes("twitter.com") || host.includes("x.com")) return "X / Twitter";
    if (host.includes("instagram.com")) return "Instagram";
    if (host.includes("soundcloud.com")) return "SoundCloud";
    if (host.includes("facebook.com") || host.includes("fb.watch")) return "Facebook";
    if (host.includes("dailymotion.com")) return "Dailymotion";
    if (host.includes("reddit.com") || host.includes("redd.it")) return "Reddit";
    if (host.includes("bilibili.com")) return "Bilibili";
    return "Enlace Compatible";
  }

  // ==========================================================================
  // Vista Previa del Video (oEmbed rápido + Backend yt-dlp)
  // ==========================================================================
  async function fetchVideoPreview(url, platformLabel) {
    // 1. Vista previa rápida por Noembed (instantánea y no bloqueada por IPs de datacenter)
    try {
      const oembedRes = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      if (oembedRes.ok) {
        const meta = await oembedRes.json();
        if (meta && meta.title) {
          renderPreviewCard({
            title: meta.title,
            author: meta.author_name || meta.provider_name || platformLabel,
            thumbnail: meta.thumbnail_url || "",
            duration: "",
            extractor: meta.provider_name || platformLabel,
          });
          return;
        }
      }
    } catch {
      // Continuar al backend si no soporta oEmbed
    }

    // 2. Respaldo mediante backend yt-dlp
    if (state.backendOnline) {
      try {
        const res = await fetch(`${state.backendUrl}/api/info?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.title) {
            renderPreviewCard({
              title: data.title,
              author: data.uploader || platformLabel,
              thumbnail: data.thumbnail || "",
              duration: data.duration_string || formatDuration(data.duration),
              extractor: data.extractor_key || platformLabel,
            });
            return;
          }
        }
      } catch {
        // Silencioso
      }
    }

    els.videoPreviewCard.classList.add("hidden");
  }

  function renderPreviewCard({ title, author, thumbnail, duration, extractor }) {
    state.previewTitle = title || "";
    els.previewTitle.textContent = title || "Video detectado";
    els.previewAuthor.textContent = author ? `Canal / Autor: ${author}` : "";
    els.previewExtractor.textContent = extractor || "Video";

    if (thumbnail) {
      els.previewThumbnail.src = thumbnail;
      els.previewThumbnail.parentElement.classList.remove("hidden");
    } else {
      els.previewThumbnail.parentElement.classList.add("hidden");
    }

    if (duration) {
      els.previewDuration.textContent = duration;
      els.previewDuration.classList.remove("hidden");
    } else {
      els.previewDuration.classList.add("hidden");
    }

    els.videoPreviewCard.classList.remove("hidden");
  }

  function formatDuration(sec) {
    if (!sec || isNaN(sec)) return "";
    const total = Math.floor(Number(sec));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  // ==========================================================================
  // Selección de Formato y Construcción del Comando yt-dlp
  // ==========================================================================
  function setFormat(fmt) {
    state.format = fmt;
    const isMp4 = fmt === "mp4";

    els.formatMp4Btn.classList.toggle("active", isMp4);
    els.formatMp4Btn.setAttribute("aria-checked", String(isMp4));

    els.formatMp3Btn.classList.toggle("active", !isMp4);
    els.formatMp3Btn.setAttribute("aria-checked", String(!isMp4));

    els.videoQualityGroup.classList.toggle("hidden", !isMp4);
    els.audioQualityGroup.classList.toggle("hidden", isMp4);
    els.subtitlesChipWrap.classList.toggle("hidden", !isMp4);

    updateUI();
  }

  function buildYtdlpCommand() {
    const parts = ["yt-dlp"];
    const explanations = [];
    const targetUrl = state.url || "https://www.youtube.com/watch?v=TU_VIDEO";

    if (state.format === "mp4") {
      if (state.videoQuality === "best") {
        parts.push('-f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b"');
        explanations.push({
          flag: "-f mp4",
          desc: "Mejor video + mejor audio disponibles en MP4",
        });
      } else {
        const h = state.videoQuality;
        parts.push(
          `-f "bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4] / bv*[height<=${h}]+ba/b[height<=${h}]"`
        );
        explanations.push({
          flag: `-f <=${h}p`,
          desc: `Resolución máxima limitada a ${h}p`,
        });
      }
      parts.push("--merge-output-format mp4");
      explanations.push({
        flag: "--merge-output-format mp4",
        desc: "Empaqueta el archivo final en contenedor .mp4",
      });
    } else {
      parts.push("-x", "--audio-format mp3", `--audio-quality ${state.audioQuality}`);
      explanations.push({
        flag: "-x --audio-format mp3",
        desc: "Extrae solo el audio y lo convierte a .mp3",
      });
      explanations.push({
        flag: `--audio-quality ${state.audioQuality}`,
        desc:
          state.audioQuality === "0"
            ? "Máxima calidad de audio VBR/320kbps"
            : `Bitrate objetivo de ${state.audioQuality}`,
      });
    }

    if (state.noPlaylist) {
      parts.push("--no-playlist");
      explanations.push({
        flag: "--no-playlist",
        desc: "Descarga únicamente el video del enlace",
      });
    } else {
      parts.push("--yes-playlist");
      explanations.push({
        flag: "--yes-playlist",
        desc: "Descarga toda la lista de reproducción si aplica",
      });
    }

    if (state.embedMetadata) {
      parts.push("--embed-thumbnail", "--embed-metadata");
      explanations.push({
        flag: "--embed-thumbnail --embed-metadata",
        desc: "Incrusta carátula e información del autor",
      });
    }

    if (state.format === "mp4" && state.subtitles) {
      parts.push("--write-subs", "--embed-subs", '--sub-langs "es.*,en.*"');
      explanations.push({
        flag: "--embed-subs",
        desc: "Incluye subtítulos en español e inglés",
      });
    }

    if (state.browserCookies && state.browserCookies !== "none") {
      parts.push(`--cookies-from-browser ${state.browserCookies}`);
      explanations.push({
        flag: `--cookies-from-browser ${state.browserCookies}`,
        desc: `Usa tu sesión de ${state.browserCookies} para evitar bloqueos anti-bot`,
      });
    }

    parts.push('-o "%(title)s.%(ext)s"');
    explanations.push({
      flag: '-o "%(title)s.%(ext)s"',
      desc: "Guarda el archivo con el título original del video",
    });

    const safeUrl = targetUrl.replace(/"/g, '\\"');
    parts.push(`"${safeUrl}"`);

    return {
      command: parts.join(" "),
      explanations,
    };
  }

  function updateUI() {
    const { command, explanations } = buildYtdlpCommand();
    els.ytdlpCommandOutput.textContent = command;

    const upperFormat = state.format.toUpperCase();
    const labelType = state.format === "mp4" ? "Video MP4" : "Audio MP3";
    els.terminalModeLabel.textContent = `Terminal · Comando yt-dlp (${upperFormat})`;
    els.directDownloadBtnText.textContent = `Descargar ${labelType} ahora`;

    const ext = state.osTarget === "windows" ? ".bat" : ".sh";
    els.scriptExtLabel.textContent = `Descargar ${ext}`;
    if (els.scriptPrimaryBtnText) {
      els.scriptPrimaryBtnText.textContent = `Descargar Script (${ext})`;
    }

    els.cmdBreakdown.innerHTML = explanations
      .map(
        (item) =>
          `<span class="cmd-chip"><strong>${escapeHtml(item.flag)}</strong>: ${escapeHtml(
            item.desc
          )}</span>`
      )
      .join("");
  }

  // ==========================================================================
  // Copiar Comando y Descargar Script Ejecutable (.sh / .bat)
  // ==========================================================================
  async function copyGeneratedCommand() {
    if (!state.url) {
      showToast("Pega primero el enlace del video para copiar el comando completo");
      els.videoUrlInput.focus();
      return;
    }

    const { command } = buildYtdlpCommand();
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = command;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    els.copyCmdText.textContent = "¡Copiado!";
    setTimeout(() => {
      els.copyCmdText.textContent = "Copiar comando";
    }, 2000);

    saveToHistory(state.url, state.format, command);
    showToast("Comando yt-dlp copiado al portapapeles");
  }

  function downloadExecutableScript() {
    if (!state.url) {
      showToast("Pega primero el enlace del video para generar el script");
      els.videoUrlInput.focus();
      return;
    }

    const { command } = buildYtdlpCommand();
    const isWin = state.osTarget === "windows";
    let content = "";
    let filename = "";

    if (isWin) {
      filename = `descargar_${state.format}.bat`;
      content = [
        "@echo off",
        "chcp 65001 >nul",
        "echo =====================================================",
        "echo   VerdeDL - Descargando con yt-dlp (" + state.format.toUpperCase() + ")",
        "echo =====================================================",
        "where yt-dlp >nul 2>nul",
        "if %errorlevel% neq 0 (",
        '  echo [!] yt-dlp no esta instalado. Instalalo con: winget install yt-dlp.yt-dlp',
        "  pause",
        "  exit /b 1",
        ")",
        command,
        "echo.",
        "echo [OK] Descarga finalizada.",
        "pause",
      ].join("\r\n");
    } else {
      filename = `descargar_${state.format}.sh`;
      content = [
        "#!/usr/bin/env bash",
        "set -e",
        'echo "====================================================="',
        `echo "  VerdeDL - Descargando con yt-dlp (${state.format.toUpperCase()})"`,
        'echo "====================================================="',
        "if ! command -v yt-dlp >/dev/null 2>&1; then",
        '  echo "[!] yt-dlp no está instalado. Instálalo con: pip install -U yt-dlp"',
        "  exit 1",
        "fi",
        command,
        'echo "[OK] Descarga finalizada correctamente."',
      ].join("\n");
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    saveToHistory(state.url, state.format, command);
    showToast(`Script ${filename} descargado`);
  }

  // ==========================================================================
  // Conexión con Backend yt-dlp (Render / Local) y Descarga Directa
  // ==========================================================================
  async function checkBackendStatus(silent = false) {
    const isRemoteRender = state.backendUrl.includes("onrender.com");
    if (!silent && isRemoteRender && !state.backendOnline) {
      els.serverStatusText.textContent = "Conectando con servidor...";
    }

    try {
      const controller = new AbortController();
      const timeoutMs = isRemoteRender ? 45000 : 4000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${state.backendUrl}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        state.backendOnline = Boolean(data && data.status === "ok");
      } else {
        state.backendOnline = false;
      }
    } catch {
      state.backendOnline = false;
    }

    updateServerStatusBadge();
    return state.backendOnline;
  }

  function updateServerStatusBadge() {
    if (state.backendOnline) {
      els.serverStatusDot.classList.add("online");
      els.serverStatusText.textContent = "Servidor Activo";
    } else {
      els.serverStatusDot.classList.remove("online");
      els.serverStatusText.textContent = "Servidor en reposo / Configurar";
    }
  }

  async function triggerDirectDownload() {
    if (state.isDownloading) return;

    if (!state.url) {
      els.urlValidationMsg.textContent = "Por favor, pega primero el enlace del video que deseas descargar.";
      els.urlValidationMsg.classList.remove("hidden");
      els.videoUrlInput.focus();
      return;
    }

    const validation = validateVideoUrl(state.url);
    if (!validation.valid) {
      els.urlValidationMsg.textContent = validation.message;
      els.urlValidationMsg.classList.remove("hidden");
      els.videoUrlInput.focus();
      return;
    }

    const { command } = buildYtdlpCommand();
    saveToHistory(state.url, state.format, command);

    state.isDownloading = true;
    els.directDownloadBtn.disabled = true;
    els.downloadStatusPanel.classList.remove("hidden");
    els.downloadSpinner.classList.remove("hidden");
    els.downloadStatusTitle.textContent = `Preparando tu archivo ${state.format.toUpperCase()}...`;
    els.downloadStatusDetail.textContent = "Conectando con el motor de descarga...";
    els.progressBarFill.style.width = "30%";

    const isOnline = await checkBackendStatus();
    if (!isOnline) {
      state.isDownloading = false;
      els.directDownloadBtn.disabled = false;
      els.downloadSpinner.classList.add("hidden");
      els.progressBarFill.style.width = "0%";
      els.downloadStatusTitle.textContent = "El servidor de descargas no respondió";
      els.downloadStatusDetail.textContent =
        "Verifica la conexión del servidor o usa el apartado Generador de Comando.";
      return;
    }

    els.progressBarFill.style.width = "55%";
    els.downloadStatusTitle.textContent = `Descargando ${state.format.toUpperCase()}... (esto puede tardar unos segundos)`;
    els.downloadStatusDetail.textContent = state.previewTitle
      ? `Procesando: ${state.previewTitle}`
      : "Obteniendo flujo de audio/video...";

    try {
      const response = await fetch(`${state.backendUrl}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: state.url,
          format: state.format,
          videoQuality: state.videoQuality,
          audioQuality: state.audioQuality,
          noPlaylist: state.noPlaylist,
          embedMetadata: state.embedMetadata,
          subtitles: state.subtitles,
          cookiesText: state.customCookiesText || "",
        }),
      });

      if (!response.ok) {
        let errMessage = "No se pudo completar la descarga.";
        try {
          const errData = await response.json();
          if (errData && errData.error) errMessage = errData.error;
        } catch {
          // Ignorar si no es JSON
        }
        throw new Error(errMessage);
      }

      els.progressBarFill.style.width = "92%";
      els.downloadStatusTitle.textContent = "¡Listo! Guardando archivo en tu dispositivo...";

      const blob = await response.blob();
      const filename = extractFilenameFromHeaders(response.headers) || `descarga.${state.format}`;

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      els.progressBarFill.style.width = "100%";
      els.downloadSpinner.classList.add("hidden");
      els.downloadStatusTitle.textContent = `¡Descarga completada! (${filename})`;
      els.downloadStatusDetail.textContent = "Revisa tu carpeta de descargas.";
      showToast(`¡Archivo ${state.format.toUpperCase()} descargado!`);
    } catch (err) {
      els.downloadSpinner.classList.add("hidden");
      els.progressBarFill.style.width = "0%";
      els.downloadStatusTitle.textContent = "No se pudo descargar directamente este video";
      const msg = err.message || "";
      els.downloadStatusDetail.textContent = msg;

      if (msg.toLowerCase().includes("bot") || msg.toLowerCase().includes("cookies")) {
        els.cookiesHelperDetails.open = true;
      }
    } finally {
      state.isDownloading = false;
      els.directDownloadBtn.disabled = false;
    }
  }

  function extractFilenameFromHeaders(headers) {
    const disposition = headers.get("Content-Disposition");
    if (!disposition) return null;

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (asciiMatch && asciiMatch[1]) {
      return asciiMatch[1];
    }
    return null;
  }

  // ==========================================================================
  // Historial Local (Sin Login)
  // ==========================================================================
  function getHistory() {
    try {
      const raw = localStorage.getItem("verdedl_history");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveToHistory(url, format, command) {
    if (!url) return;
    const list = getHistory().filter((item) => !(item.url === url && item.format === format));
    list.unshift({
      url,
      title: state.previewTitle || url,
      format: format.toUpperCase(),
      command,
      timestamp: Date.now(),
    });
    const trimmed = list.slice(0, 6);
    localStorage.setItem("verdedl_history", JSON.stringify(trimmed));
    renderHistory();
  }

  function renderHistory() {
    const list = getHistory();
    if (!list.length) {
      els.historySection.classList.add("hidden");
      els.historyList.innerHTML = "";
      return;
    }

    els.historySection.classList.remove("hidden");
    els.historyList.innerHTML = list
      .map(
        (item, idx) => `
        <div class="history-item">
          <div class="history-meta">
            <div class="history-item-top">
              <span class="history-badge">${escapeHtml(item.format)}</span>
              <span class="history-url" title="${escapeHtml(item.url)}">${escapeHtml(item.title)}</span>
            </div>
            <div class="history-cmd">${escapeHtml(item.command)}</div>
          </div>
          <div class="history-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-history-load="${idx}">Cargar enlace</button>
            <button type="button" class="btn btn-outline btn-sm" data-history-copy="${idx}">Copiar comando</button>
          </div>
        </div>
      `
      )
      .join("");

    els.historyList.querySelectorAll("[data-history-load]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = list[Number(btn.getAttribute("data-history-load"))];
        if (!item) return;
        els.videoUrlInput.value = item.url;
        setFormat(item.format.toLowerCase() === "mp3" ? "mp3" : "mp4");
        handleUrlChange(item.url);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    els.historyList.querySelectorAll("[data-history-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = list[Number(btn.getAttribute("data-history-copy"))];
        if (!item) return;
        await navigator.clipboard.writeText(item.command);
        showToast("Comando copiado del historial");
      });
    });
  }

  // ==========================================================================
  // Utilidades
  // ==========================================================================
  function showToast(message) {
    els.toastMessage.textContent = message;
    els.toastNotification.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      els.toastNotification.classList.add("hidden");
    }, 3000);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
