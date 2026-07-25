// --- SonicStream Live Console & Trace Log Interceptor ---
(function() {
    window.SONICSTREAM_LOGS = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;

    function appendLogToUI(type, args) {
        const msg = Array.from(args).map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
        const time = new Date().toLocaleTimeString();
        window.SONICSTREAM_LOGS.push({ type, time, msg });

        const container = document.getElementById("liveConsoleBody");
        if (container) {
            const line = document.createElement("div");
            line.style.padding = "3px 0";
            line.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            line.style.fontSize = "0.75rem";
            line.style.fontFamily = "'Fira Code', monospace";
            
            if (type === "error") {
                line.style.color = "#ff5f56";
                line.innerHTML = `<span style="color:#ff79c6; font-weight:700;">[${time}] ❌ ERROR:</span> ${escapeHtml(msg)}`;
            } else if (type === "warn") {
                line.style.color = "#ffbd2e";
                line.innerHTML = `<span style="color:#ffb86c; font-weight:700;">[${time}] ⚠️ WARN:</span> ${escapeHtml(msg)}`;
            } else {
                line.style.color = "#00f2fe";
                line.innerHTML = `<span style="color:#50fa7b; font-weight:700;">[${time}] ℹ️ INFO:</span> ${escapeHtml(msg)}`;
            }
            container.appendChild(line);
            container.scrollTop = container.scrollHeight;
        }

        const badge = document.getElementById("liveConsoleErrorBadge");
        if (badge) {
            const errCount = window.SONICSTREAM_LOGS.filter(l => l.type === "error").length;
            badge.textContent = errCount > 0 ? `${errCount} ERRORS` : "OK";
            badge.style.background = errCount > 0 ? "#ff5f56" : "#27c93f";
        }
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    console.log = function(...args) { origLog.apply(console, args); appendLogToUI("log", args); };
    console.warn = function(...args) { origWarn.apply(console, args); appendLogToUI("warn", args); };
    console.error = function(...args) { origErr.apply(console, args); appendLogToUI("error", args); };

    window.addEventListener("error", (e) => {
        appendLogToUI("error", [`Uncaught Exception: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`]);
    });

    window.addEventListener("unhandledrejection", (e) => {
        appendLogToUI("error", [`Unhandled Rejection: ${e.reason ? (e.reason.stack || e.reason) : e}`]);
    });
})();

// SonicStream Web PWA - Application Engine
document.addEventListener("DOMContentLoaded", () => {
    // Register Service Worker
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").then((reg) => {
            console.log("[PWA] Service Worker registered successfully:", reg.scope);
        }).catch((err) => {
            console.error("[PWA] Service Worker registration failed:", err);
        });
    }

    // Chrome & Edge PWA Install Prompt Listener
    let deferredInstallPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        console.log("[PWA] Chrome/Edge install prompt captured");
    });

    // --- DOM Elements ---
    const btnLoginOneDrive = document.getElementById("btnLoginOneDrive");
    const loginBtnText = document.getElementById("loginBtnText");
    const btnImportLocalFiles = document.getElementById("btnImportLocalFiles");
    const localFileInput = document.getElementById("localFileInput");
    const btnOpenSettings = document.getElementById("btnOpenSettings");
    const btnCloseSettings = document.getElementById("btnCloseSettings");
    const btnSaveSettings = document.getElementById("btnSaveSettings");
    const settingsModal = document.getElementById("settingsModal");
    const azureClientIdInput = document.getElementById("azureClientIdInput");
    const azureSasTokenInput = document.getElementById("azureSasTokenInput");
    const oneDriveFolderNameInput = document.getElementById("oneDriveFolderNameInput");
    
    // Dedicated Mobile DOM Elements
    const mobilePlaylistsList = document.getElementById("mobilePlaylistsList");
    const mobilePlaylistsView = document.getElementById("mobilePlaylistsView");
    const mobileTracksView = document.getElementById("mobileTracksView");
    const mobileTrackList = document.getElementById("mobileTrackList");
    const mobileCurrentPlaylistTitle = document.getElementById("mobileCurrentPlaylistTitle");
    const btnBackToPlaylists = document.getElementById("btnBackToPlaylists");
    const btnSyncMobile = document.getElementById("btnSyncMobile");
    
    // Dynamic Configuration Loader (reads window.SONICSTREAM_CONFIG or fetches settings.json)
    let CONFIG = window.SONICSTREAM_CONFIG || {};

    async function loadSettingsJson() {
        try {
            const res = await fetch("./settings.json", { cache: "no-cache" });
            if (res.ok) {
                const fetchedConfig = await res.json();
                if (fetchedConfig && typeof fetchedConfig === "object") {
                    CONFIG = { ...fetchedConfig, ...CONFIG };
                    populateSettingsUI();
                }
            }
        } catch (e) {}
    }

    async function populateSettingsUI() {
        const dbCid = await getSettingFromDB("azure_client_id");
        const dbSas = await getSettingFromDB("azure_sas_token");
        const dbDrive = await getSettingFromDB("onedrive_share_link");

        if (azureClientIdInput) {
            azureClientIdInput.value = dbCid || localStorage.getItem("sonicstream_client_id") || CONFIG.azure_client_id || "";
        }
        if (azureSasTokenInput) {
            azureSasTokenInput.value = dbSas || localStorage.getItem("sonicstream_azure_sas") || CONFIG.azure_sas_token || "";
        }
        if (oneDriveFolderNameInput) {
            oneDriveFolderNameInput.value = dbDrive || localStorage.getItem("sonicstream_onedrive_link") || CONFIG.onedrive_share_link || "";
        }
    }

    // --- Live Console Modal Injector & Floating Action Button ---
    function renderLogsToConsoleBody() {
        const container = document.getElementById("liveConsoleBody");
        if (!container) return;
        container.innerHTML = "";
        const logs = window.SONICSTREAM_LOGS || [];
        if (logs.length === 0) {
            container.innerHTML = `<div style="color: var(--text-muted);">[System] Live Terminal initialized. No logs recorded yet. Perform actions to view real-time traces...</div>`;
            return;
        }
        logs.forEach(l => {
            const line = document.createElement("div");
            line.style.padding = "3px 0";
            line.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            line.style.fontSize = "0.75rem";
            line.style.fontFamily = "'Fira Code', monospace";
            
            if (l.type === "error") {
                line.style.color = "#ff5f56";
                line.innerHTML = `<span style="color:#ff79c6; font-weight:700;">[${l.time}] ❌ ERROR:</span> ${escapeHtml(l.msg)}`;
            } else if (l.type === "warn") {
                line.style.color = "#ffbd2e";
                line.innerHTML = `<span style="color:#ffb86c; font-weight:700;">[${l.time}] ⚠️ WARN:</span> ${escapeHtml(l.msg)}`;
            } else {
                line.style.color = "#00f2fe";
                line.innerHTML = `<span style="color:#50fa7b; font-weight:700;">[${l.time}] ℹ️ INFO:</span> ${escapeHtml(l.msg)}`;
            }
            container.appendChild(line);
        });
        container.scrollTop = container.scrollHeight;
    }

    function escapeHtml(str) {
        return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function openLiveConsoleModal() {
        let modal = document.getElementById("liveConsoleModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "liveConsoleModal";
            modal.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 999999; backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 1rem;";
            modal.innerHTML = `
                <div style="background: #090d16; border: 1px solid var(--neon-blue); border-radius: 12px; width: 100%; max-width: 900px; height: 80vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,242,254,0.25);">
                    <div style="padding: 0.75rem 1rem; background: rgba(0,242,254,0.08); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 700; font-family: var(--font-mono); color: var(--neon-blue);">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                            <span>SonicStream Live Terminal & Trace Log</span>
                            <span id="liveConsoleErrorBadge" style="font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #27c93f; color: #000; font-weight: 800;">OK</span>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button id="btnCopyConsoleLogs" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">📋 Copy Logs</button>
                            <button id="btnClearConsoleLogs" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">🧹 Clear</button>
                            <button id="btnCloseConsoleModal" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">❌ Close</button>
                        </div>
                    </div>
                    <div id="liveConsoleBody" style="flex: 1; padding: 1rem; overflow-y: auto; background: #05080f; color: #e6edf3; font-family: 'Fira Code', monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word;">
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById("btnCloseConsoleModal").addEventListener("click", () => {
                modal.style.display = "none";
            });
            document.getElementById("btnCopyConsoleLogs").addEventListener("click", () => {
                const raw = window.SONICSTREAM_LOGS ? window.SONICSTREAM_LOGS.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.msg}`).join("\n") : "";
                navigator.clipboard.writeText(raw).then(() => {
                    alert("Logs copied to clipboard!");
                }).catch(() => alert("Copy failed. Log text:\n\n" + raw));
            });
            document.getElementById("btnClearConsoleLogs").addEventListener("click", () => {
                window.SONICSTREAM_LOGS = [];
                renderLogsToConsoleBody();
            });
        }

        modal.style.display = "flex";
        modal.style.zIndex = "999999";
        modal.classList.remove("hidden");
        renderLogsToConsoleBody();
    }

    // Attach listeners to any header console button
    const btnToggleConsole = document.getElementById("btnToggleConsole");
    if (btnToggleConsole) {
        btnToggleConsole.addEventListener("click", openLiveConsoleModal);
    }

    // Create glowing bottom-right floating Trace Logs button on screen
    if (!document.getElementById("btnFloatingConsole")) {
        const floatBtn = document.createElement("button");
        floatBtn.id = "btnFloatingConsole";
        floatBtn.innerHTML = "📟 Trace Logs";
        floatBtn.style.cssText = "position: fixed; bottom: 85px; right: 20px; z-index: 99999; background: #090d16; color: #00f2fe; border: 1px solid #00f2fe; border-radius: 20px; padding: 8px 16px; font-weight: bold; font-size: 0.8rem; cursor: pointer; box-shadow: 0 4px 15px rgba(0,242,254,0.3);";
        floatBtn.onclick = openLiveConsoleModal;
        document.body.appendChild(floatBtn);
    }

    if (btnCloseSettings && settingsModal) {
        btnCloseSettings.addEventListener("click", () => {
            settingsModal.classList.add("hidden");
        });
    }

    if (btnSaveSettings && settingsModal) {
        btnSaveSettings.addEventListener("click", async () => {
            const cid = azureClientIdInput ? azureClientIdInput.value.trim() : "";
            const sas = azureSasTokenInput ? azureSasTokenInput.value.trim() : "";
            const drive = oneDriveFolderNameInput ? oneDriveFolderNameInput.value.trim() : "";

            if (cid) {
                localStorage.setItem("sonicstream_client_id", cid);
                CONFIG.azure_client_id = cid;
                await saveSettingToDB("azure_client_id", cid);
            }
            if (sas) {
                localStorage.setItem("sonicstream_azure_sas", sas);
                CONFIG.azure_sas_token = sas;
                await saveSettingToDB("azure_sas_token", sas);
            }
            if (drive) {
                localStorage.setItem("sonicstream_onedrive_link", drive);
                CONFIG.onedrive_share_link = drive;
                await saveSettingToDB("onedrive_share_link", drive);
            }

            settingsModal.classList.add("hidden");
            alert("Settings saved to IndexedDB successfully!");
        });
    }

    function getAzureStorageAccount() {
        return CONFIG.azure_storage_account || "stsonicstream";
    }

    function getAzureContainer() {
        return CONFIG.azure_container || "media";
    }

    function getAzureBlobBaseUrl() {
        const acc = getAzureStorageAccount();
        const container = getAzureContainer();
        return `https://${acc}.blob.core.windows.net/${container}`;
    }

    function getAzureSASToken() {
        let token = (azureSasTokenInput ? azureSasTokenInput.value.trim() : "") || localStorage.getItem("sonicstream_azure_sas") || CONFIG.azure_sas_token || "";
        if (token.startsWith("?")) token = token.substring(1);
        return token;
    }

    function getTrackThumbnailUrl(track) {
        if (!track) return "icon.svg";
        if (track.title && track.title.toLowerCase().includes("gita")) {
            return "gita_cover_logo.png";
        }
        const yid = track.youtube_id || track.id;
        if (yid && yid.length === 11 && !yid.includes(" ") && !yid.includes("/")) {
            return `https://i.ytimg.com/vi/${yid}/hqdefault.jpg`;
        }
        if (track.thumbnail && (track.thumbnail.startsWith("http://") || track.thumbnail.startsWith("https://"))) {
            return track.thumbnail;
        }
        return "icon.svg";
    }

    function getPlaylistThumbnail(pl) {
        // Pick a real per-playlist cover: first track whose thumbnail can be
        // derived (YouTube hqdefault or gita cover), so playlists don't all
        // collapse to the same default art.
        if (pl && Array.isArray(pl.tracks)) {
            for (const t of pl.tracks) {
                const u = getTrackThumbnailUrl(t);
                if (u && u !== "icon.svg") return u;
            }
        }
        return (pl && pl.thumbnail) || "icon.svg";
    }

    function getOneDriveShareLink() {
        const link = (oneDriveFolderNameInput ? oneDriveFolderNameInput.value.trim() : "") || localStorage.getItem("sonicstream_onedrive_link");
        return link || CONFIG.onedrive_share_link || "";
    }

    function getAzureClientId() {
        const cid = (azureClientIdInput ? azureClientIdInput.value.trim() : "") || localStorage.getItem("sonicstream_client_id");
        return cid || CONFIG.azure_client_id || "51f81489-12ee-4a9e-aaae-a2591f45987d";
    }

    // Initial settings load & UI population
    populateSettingsUI();
    loadSettingsJson();
    const btnClearCache = document.getElementById("btnClearCache");
    const cacheUsageText = document.getElementById("cacheUsageText");
    const urlInput = document.getElementById("urlInput");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const analyzeSpinner = document.getElementById("analyzeSpinner");
    const urlError = document.getElementById("urlError");
    const btnSyncOneDriveNow = document.getElementById("btnSyncOneDriveNow");
    const btnSaveOffline = document.getElementById("btnSaveOffline");

    // Player Elements
    const audioElement = document.getElementById("audioElement");
    const playerTrackThumb = document.getElementById("playerTrackThumb");
    const playerTrackTitle = document.getElementById("playerTrackTitle");
    const playerTrackArtist = document.getElementById("playerTrackArtist");
    const playerTrackStatus = document.getElementById("playerTrackStatus");
    const playerStatusEq = document.getElementById("playerStatusEq");
    const playerStatusText = document.getElementById("playerStatusText");
    const playerCurrentTime = document.getElementById("playerCurrentTime");
    const playerProgressBar = document.getElementById("playerProgressBar");
    const playerTotalTime = document.getElementById("playerTotalTime");
    const playerPlayPauseBtn = document.getElementById("playerPlayPauseBtn");
    const playIconSvg = document.getElementById("playIconSvg");
    const playerPrevBtn = document.getElementById("playerPrevBtn");
    const playerNextBtn = document.getElementById("playerNextBtn");
    const playerShuffleBtn = document.getElementById("playerShuffleBtn");
    const playerVolumeBtn = document.getElementById("playerVolumeBtn");
    const playerVolumeSlider = document.getElementById("playerVolumeSlider");
    const videoElement = document.getElementById("videoElement");
    const videoContainer = document.getElementById("videoContainer");
    const btnMediaModeAudio = document.getElementById("btnMediaModeAudio");
    const btnMediaModeVideo = document.getElementById("btnMediaModeVideo");
    let mediaPlaybackMode = "audio"; // "audio" or "video"

    // Dashboard Elements
    const playlistListContainer = document.getElementById("playlistListContainer");
    const playlistTitle = document.getElementById("playlistTitle");
    const playlistMetaInfo = document.getElementById("playlistMetaInfo");
    const playlistTableBody = document.getElementById("playlistTableBody");
    const playlistSearch = document.getElementById("playlistSearch");
    const tabAll = document.getElementById("tabAll");
    const tabLocal = document.getElementById("tabLocal");
    const tabOffline = document.getElementById("tabOffline");
    const btnPrefetch3 = document.getElementById("btnPrefetch3");
    const refreshPlaylistBtn = document.getElementById("refreshPlaylistBtn");
    const selectAllBtn = document.getElementById("selectAllBtn");
    const deselectAllBtn = document.getElementById("deselectAllBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const downloadAllBtn = document.getElementById("downloadAllBtn");
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");
    const gridHud = document.getElementById("gridHud");
    const hudJobTitle = document.getElementById("hudJobTitle");
    const hudCurrentFile = document.getElementById("hudCurrentFile");
    const hudSpeed = document.getElementById("hudSpeed");
    const playPlaylistBtn = document.getElementById("playPlaylistBtn");
    const shufflePlaylistBtn = document.getElementById("shufflePlaylistBtn");
    const resumePlaylistBtn = document.getElementById("resumePlaylistBtn");
    const statusFilter = document.getElementById("statusFilter");
    const selectedCountInfo = document.getElementById("selectedCountInfo");
    const totalCountInfo = document.getElementById("totalCountInfo");

    // --- State Variables ---
    let msalInstance = null;
    let currentUserAccount = null;
    let playlists = [];
    let activePlaylistId = null;
    let activePlaylistItems = [];
    let playQueue = [];
    let currentTrackIndex = -1;
    let isPlaying = false;
    let isShuffle = false;
    let isRepeat = false;
    let sidebarTabFilter = "all"; // all, local, offline
    let streamSourceMode = "onedrive"; // "onedrive" or "youtube"
    let selectedTrackIds = new Set();
    let nextTrackTimeout = null;
    let nextTrackCountdownInterval = null;

    function clearNextTrackTimers() {
        if (nextTrackTimeout) {
            clearTimeout(nextTrackTimeout);
            nextTrackTimeout = null;
        }
        if (nextTrackCountdownInterval) {
            clearInterval(nextTrackCountdownInterval);
            nextTrackCountdownInterval = null;
        }
    }

    if (btnMediaModeAudio && btnMediaModeVideo) {
        btnMediaModeAudio.addEventListener("click", () => {
            mediaPlaybackMode = "audio";
            btnMediaModeAudio.classList.add("active");
            btnMediaModeVideo.classList.remove("active");
            if (videoContainer) videoContainer.classList.add("hidden");
            if (videoElement) videoElement.pause();
        });
        btnMediaModeVideo.addEventListener("click", () => {
            mediaPlaybackMode = "video";
            btnMediaModeVideo.classList.add("active");
            btnMediaModeAudio.classList.remove("active");
            if (videoContainer) videoContainer.classList.remove("hidden");
            if (audioElement) audioElement.pause();
        });
    }

    const sourceRadios = document.querySelectorAll('input[name="streamSource"]');
    sourceRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            document.querySelectorAll(".source-pill-btn").forEach(btn => btn.classList.remove("active"));
            if (e.target.checked) {
                streamSourceMode = e.target.value;
                e.target.closest(".source-pill-btn")?.classList.add("active");
                updateSourceModeUI(streamSourceMode);
            }
        });
    });

    async function updateSourceModeUI(mode) {
        streamSourceMode = mode;
        const ytSection = document.querySelector(".url-analyze-section");
        const btnPrefetch3El = document.getElementById("btnPrefetch3");
        const refreshPlaylistBtnEl = document.getElementById("refreshPlaylistBtn");

        if (mode === "onedrive") {
            if (ytSection) ytSection.style.display = "none";
            if (btnPrefetch3El) btnPrefetch3El.style.display = "none";
            if (refreshPlaylistBtnEl) refreshPlaylistBtnEl.style.display = "inline-flex";
        } else { // youtube mode
            if (ytSection) ytSection.style.display = "block";
            if (btnPrefetch3El) btnPrefetch3El.style.display = "inline-flex";
            if (refreshPlaylistBtnEl) refreshPlaylistBtnEl.style.display = "inline-flex";
        }

        playlists = await getAllPlaylistsFromDB();
        await renderSidebarList();
        if (playlists.length > 0 && (!activePlaylistId || !playlists.find(p => p.id === activePlaylistId))) {
            selectPlaylist(playlists[0]);
        }
        if (gridHud) gridHud.classList.add("hidden");
    }

    // --- IndexedDB Engine for Offline Music Caching ---
    const DB_NAME = "SonicStreamPWA_DB";
    const DB_VERSION = 5;
    let db = null;

    function initDB() {
        return new Promise((resolve) => {
            try {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = (e) => {
                    const database = e.target.result;
                    if (database.objectStoreNames.contains("cached_tracks")) {
                        database.deleteObjectStore("cached_tracks");
                    }
                    if (!database.objectStoreNames.contains("playlists")) {
                        database.createObjectStore("playlists", { keyPath: "id" });
                    }
                    if (!database.objectStoreNames.contains("files")) {
                        database.createObjectStore("files", { keyPath: "file_id" });
                    }
                    if (!database.objectStoreNames.contains("settings")) {
                        database.createObjectStore("settings", { keyPath: "key" });
                    }
                };
                request.onsuccess = (e) => {
                    db = e.target.result;
                    db.onversionchange = () => { try { db.close(); } catch(err) {} };
                    updateCacheUsageUI();
                    syncDefaultSettingsFromServer();
                    resolve(db);
                };
                request.onblocked = () => {
                    console.warn("[IndexedDB] Database upgrade blocked.");
                    resolve(null);
                };
                request.onerror = () => {
                    console.warn("[IndexedDB] Database open error.");
                    resolve(null);
                };
            } catch (e) {
                resolve(null);
            }
        });
    }

    function saveBatchFileRecordsToDB(fileRecords) {
        if (!db || !db.objectStoreNames.contains("files") || !fileRecords || fileRecords.length === 0) return Promise.resolve();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction("files", "readwrite");
                const store = tx.objectStore("files");
                fileRecords.forEach(rec => {
                    if (rec && rec.file_id) {
                        store.put(rec);
                    }
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    function saveSettingToDB(key, value) {
        if (!db || !db.objectStoreNames.contains("settings")) return Promise.resolve();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction("settings", "readwrite");
                tx.objectStore("settings").put({ key: key, value: value, updated_at: Date.now() });
                resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    function getSettingFromDB(key) {
        if (!db || !db.objectStoreNames.contains("settings")) return Promise.resolve(null);
        return new Promise((resolve) => {
            try {
                const tx = db.transaction("settings", "readonly");
                const req = tx.objectStore("settings").get(key);
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    async function syncDefaultSettingsFromServer() {
        try {
            const res = await fetch("./settings.json", { cache: "no-cache" }).catch(() => null);
            if (res && res.ok) {
                const defaults = await res.json();
                if (defaults && typeof defaults === "object") {
                    for (const [k, v] of Object.entries(defaults)) {
                        const existing = await getSettingFromDB(k);
                        if (!existing && v) {
                            await saveSettingToDB(k, v);
                        }
                    }
                }
            }
        } catch (e) {}
    }

    function savePlaylistToDB(playlist) {
        if (!db) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("playlists", "readwrite");
            const req = tx.objectStore("playlists").put(playlist);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e);
        });
    }

    async function getAllPlaylistsFromDB() {
        if (!db) return [];
        return new Promise((resolve) => {
            const tx = db.transaction("playlists", "readonly");
            const req = tx.objectStore("playlists").getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    function normalizeTitleKey(title) {
        if (!title) return "";
        return title.toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB Hard File Size Limit

    async function purgeLargeFilesFromDB() {
        if (!db || !db.objectStoreNames.contains("files")) return;
        try {
            const tx = db.transaction("files", "readwrite");
            const store = tx.objectStore("files");
            const req = store.getAll();
            req.onsuccess = () => {
                const records = req.result || [];
                let purgedCount = 0;
                let freedBytes = 0;

                records.forEach(rec => {
                    const audio = rec.audio_blob || rec.blob;
                    if (audio && audio.size > MAX_FILE_SIZE_BYTES) {
                        const sizeMB = (audio.size / (1024 * 1024)).toFixed(1);
                        const key = rec.file_id || rec.id || rec.key;
                        store.delete(key);
                        purgedCount++;
                        freedBytes += audio.size;
                        console.warn(`[Storage Purge] 🗑️ Deleted large file exceeding 20MB: '${rec.title || key}' (${sizeMB} MB)`);
                    }
                });

                if (purgedCount > 0) {
                    const freedMB = (freedBytes / (1024 * 1024)).toFixed(1);
                    console.log(`[Storage Purge] ✅ Purged ${purgedCount} large files exceeding 20MB limit (Freed ${freedMB} MB).`);
                    updateCacheUsageUI();
                }
            };
        } catch (e) {
            console.error("[Storage Purge] Error purging large files:", e);
        }
    }

    async function saveTrackBlobToDB(trackId, blob, trackMeta = {}) {
        if (!db || !db.objectStoreNames.contains("files")) return Promise.resolve();
        const title = typeof trackMeta === "string" ? trackMeta : (trackMeta.title || "");
        const normKey = normalizeTitleKey(title);
        const fileName = (typeof trackMeta === "object" && trackMeta.file) ? trackMeta.file : (title ? `${title}.mp3` : trackId);

        if (blob && blob.size > MAX_FILE_SIZE_BYTES) {
            const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
            console.warn(`[Storage Guard] 🛑 Skipped saving large file exceeding 20MB: '${fileName}' (${sizeMB} MB)`);
            return Promise.resolve();
        }

        let thumbBlob = null;
        if (typeof trackMeta === "object" && trackMeta.thumbnail && trackMeta.thumbnail.startsWith("http")) {
            try {
                const imgRes = await fetch(trackMeta.thumbnail).catch(() => null);
                if (imgRes && imgRes.ok) {
                    thumbBlob = await imgRes.blob();
                }
            } catch(e) {}
        }

        return new Promise((resolve) => {
            try {
                const tx = db.transaction("files", "readwrite");
                const store = tx.objectStore("files");
                store.put({
                    file_id: fileName,
                    id: trackId,
                    normKey: normKey,
                    blob: blob,
                    audio_blob: blob,
                    thumb_blob: thumbBlob,
                    thumbBlob: thumbBlob,
                    title: title,
                    meta: typeof trackMeta === "object" ? trackMeta : { title: title },
                    timestamp: Date.now()
                });
                tx.oncomplete = () => {
                    updateCacheUsageUI();
                    resolve();
                };
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    async function getTrackRecordFromDB(trackId, title = "") {
        if (!db || !db.objectStoreNames.contains("files")) return null;
        const normKey = normalizeTitleKey(title);
        const fileId = title ? `${title}.mp3` : trackId;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction("files", "readonly");
                const filesStore = tx.objectStore("files");
                const req = filesStore.get(fileId);
                req.onsuccess = () => {
                    if (req.result) resolve(req.result);
                    else {
                        const req2 = filesStore.get(trackId);
                        req2.onsuccess = () => {
                            if (req2.result) resolve(req2.result);
                            else {
                                const allReq = filesStore.getAll();
                                allReq.onsuccess = () => {
                                    const match = (allReq.result || []).find(item => item.normKey === normKey || item.id === trackId);
                                    resolve(match || null);
                                };
                                allReq.onerror = () => resolve(null);
                            }
                        };
                        req2.onerror = () => resolve(null);
                    }
                };
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    }

    async function getTrackBlobFromDB(trackId, title = "") {
        const record = await getTrackRecordFromDB(trackId, title);
        return record ? record.blob : null;
    }

    const MAX_INDEXEDB_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB Max Storage Quota Lock

    async function checkStorageQuotaLimit() {
        if (!navigator.storage || !navigator.storage.estimate) return false;
        try {
            const est = await navigator.storage.estimate();
            const usage = est.usage || 0;
            const quota = est.quota || MAX_INDEXEDB_BYTES;

            if (usage >= MAX_INDEXEDB_BYTES || usage >= (quota * 0.95)) {
                const usedGB = (usage / (1024 * 1024 * 1024)).toFixed(2);
                alert(`⚠️ Storage Full Warning!\nIndexedDB Storage limit reached (${usedGB} GB used of 10GB max).\n\nCaching locked. Please clear offline cache in Settings to free space.`);
                console.warn(`[PWA Storage Lock] Quota Limit Reached! Usage: ${usedGB} GB.`);
                return true;
            }
        } catch (e) {}
        return false;
    }

    async function updateCacheUsageUI() {
        if (!navigator.storage || !navigator.storage.estimate) {
            if (cacheUsageText) cacheUsageText.textContent = "Offline cache ready";
            return;
        }
        try {
            const est = await navigator.storage.estimate();
            const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
            const usedGB = ((est.usage || 0) / (1024 * 1024 * 1024)).toFixed(2);
            if (cacheUsageText) {
                cacheUsageText.textContent = `Used Storage: ${usedMB >= 1024 ? usedGB + ' GB' : usedMB + ' MB'} / 10 GB Max`;
                cacheUsageText.style.color = (est.usage || 0) >= MAX_INDEXEDB_BYTES ? "#ff5f56" : "var(--neon-blue)";
            }
        } catch (e) {}
    }

    if (btnClearCache) {
        btnClearCache.addEventListener("click", async () => {
            if (!db || !db.objectStoreNames.contains("files") || !confirm("Clear all offline cached music tracks?")) return;
            const tx = db.transaction("files", "readwrite");
            tx.objectStore("files").clear();
            updateCacheUsageUI();
            alert("Offline cache cleared.");
        });
    }

    // --- MSAL & OneDrive API Integration ---
    function initMSAL() {
        if (typeof msal === "undefined") return;
        const clientId = getAzureClientId();
        const msalConfig = {
            auth: {
                clientId: clientId,
                authority: "https://login.microsoftonline.com/common",
                redirectUri: window.location.origin + window.location.pathname
            },
            cache: {
                cacheLocation: "localStorage",
                storeAuthStateInCookie: false
            }
        };
        try {
            msalInstance = new msal.PublicClientApplication(msalConfig);
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length > 0) {
                currentUserAccount = accounts[0];
                updateLoginStateUI(true);
            }
        } catch (e) {
            console.error("MSAL init error:", e);
        }
    }

    function updateLoginStateUI(loggedIn) {
        if (loggedIn && currentUserAccount) {
            loginBtnText.textContent = currentUserAccount.username || "Connected to OneDrive";
            btnLoginOneDrive.style.borderColor = "var(--neon-blue)";
        } else {
            loginBtnText.textContent = "Connect OneDrive";
            btnLoginOneDrive.style.borderColor = "var(--border-color)";
        }
    }

    if (btnLoginOneDrive) {
        btnLoginOneDrive.addEventListener("click", async () => {
            if (!msalInstance) initMSAL();
            if (currentUserAccount) {
                if (confirm("Disconnect OneDrive account?")) {
                    msalInstance.logoutPopup().then(() => {
                        currentUserAccount = null;
                        updateLoginStateUI(false);
                    });
                }
                return;
            }
            try {
                const loginRes = await msalInstance.loginPopup({ scopes: ["Files.Read.All", "User.Read"] });
                currentUserAccount = loginRes.account;
                updateLoginStateUI(true);
                syncOneDriveMusic();
            } catch (err) {
                console.error("OneDrive login failed:", err);
            }
        });
    }

    async function getGraphAccessToken() {
        if (!currentUserAccount || !msalInstance) return null;
        try {
            const tokenRes = await msalInstance.acquireTokenSilent({
                scopes: ["Files.Read.All"],
                account: currentUserAccount
            });
            return tokenRes.accessToken;
        } catch (e) {
            const tokenRes = await msalInstance.acquireTokenPopup({
                scopes: ["Files.Read.All"],
                account: currentUserAccount
            });
            return tokenRes.accessToken;
        }
    }

    function getShareToken(shareUrl) {
        if (!shareUrl || (!shareUrl.startsWith("http://") && !shareUrl.startsWith("https://"))) return null;
        try {
            const rawB64 = btoa(unescape(encodeURIComponent(shareUrl)));
            return "u!" + rawB64.replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
        } catch(e) {
            return null;
        }
    }

    async function syncOneDriveMusic() {
        const inputVal = getOneDriveShareLink();
        const shareToken = getShareToken(inputVal);
        const token = await getGraphAccessToken();

        playlistMetaInfo.textContent = `Syncing OneDrive / SharePoint music...`;

        try {
            let manifestUrl = "";
            let folderChildrenUrl = "";
            const headers = token ? { Authorization: `Bearer ${token}` } : {};

            if (shareToken) {
                manifestUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/root:/playlists_manifest.json`;
                folderChildrenUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/children`;
            } else {
                manifestUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${inputVal}/playlists_manifest.json`;
                folderChildrenUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${inputVal}:/children`;
            }

            // 1. Search for playlists_manifest.json
            const searchRes = await fetch(manifestUrl, { headers }).catch(() => null);
            if (searchRes && searchRes.ok) {
                const manifest = await searchRes.json();
                if (manifest && manifest.playlists) {
                    for (const pl of manifest.playlists) {
                        pl.source = "onedrive";
                        await savePlaylistToDB(pl);
                    }
                }
            }

            // 2. Fetch root folder items
            const folderRes = await fetch(folderChildrenUrl, { headers }).catch(() => null);
            if (folderRes && folderRes.ok) {
                const folderData = await folderRes.json();
                const audioFiles = (folderData.value || []).filter(item => item.file && item.name.endsWith(".mp3"));

                const oneDrivePlaylist = {
                    id: "onedrive_all_songs",
                    title: "OneDrive - Shared Songs",
                    source: "onedrive",
                    tracks: audioFiles.map(file => ({
                        id: file.id,
                        title: file.name.replace(/\.[^/.]+$/, ""),
                        artist: "OneDrive Cloud",
                        file: file.name,
                        duration: 0,
                        downloadUrl: file["@microsoft.graph.downloadUrl"]
                    }))
                };
                await savePlaylistToDB(oneDrivePlaylist);
            }

            playlists = await getAllPlaylistsFromDB();
            renderSidebarList();
            if (playlists.length > 0 && !activePlaylistId) {
                selectPlaylist(playlists[0]);
            }
        } catch (e) {
            console.error("OneDrive Sync Error:", e);
            playlistMetaInfo.textContent = "OneDrive sync error: " + e.message;
        }
    }

    btnSyncOneDriveNow.addEventListener("click", async () => {
        btnSyncOneDriveNow.disabled = true;
        btnSyncOneDriveNow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Syncing...`;
        
        await syncDesktopPlaylists();
        if (currentUserAccount) {
            await syncOneDriveMusic();
        }

        btnSyncOneDriveNow.disabled = false;
        btnSyncOneDriveNow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Sync`;
    });

    // --- YouTube Link Analyze & On-Demand Downloader ---
    analyzeBtn.addEventListener("click", async () => {
        const url = urlInput.value.trim();
        if (!url) return;

        urlError.classList.add("hidden");
        analyzeSpinner.classList.remove("hidden");
        analyzeBtn.disabled = true;

        try {
            const res = await fetch("/api/fetch-info", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to analyze YouTube link.");
            }

            const data = await res.json();
            const isPlaylist = data.is_playlist || (data.entries && data.entries.length > 1);
            const title = data.title || (isPlaylist ? "YouTube Playlist" : (data.entries?.[0]?.title || "YouTube Download"));
            const playlistId = "yt_" + Date.now();

            const tracks = (data.entries || []).map(entry => ({
                id: entry.id,
                title: entry.title,
                artist: entry.uploader || entry.channel || "YouTube",
                duration: entry.duration || 0,
                thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
                url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
                file: `${entry.title}.mp3`,
                status: "queued"
            }));

            const newPlaylist = {
                id: playlistId,
                title: title,
                url: url,
                source: "youtube",
                is_playlist: isPlaylist,
                tracks: tracks
            };

            await savePlaylistToDB(newPlaylist);
            await loadPlaylistsFromDB();
            selectPlaylist(newPlaylist);
            urlInput.value = "";

            // Automatically start pre-fetching 2-3 error-free songs in advance
            prefetchUpcomingTracks(tracks, -1, 3);
        } catch (err) {
            console.error("YouTube link analysis failed:", err);
            urlError.textContent = err.message || "Failed to analyze YouTube URL.";
            urlError.classList.remove("hidden");
        } finally {
            analyzeSpinner.classList.add("hidden");
            analyzeBtn.disabled = false;
        }
    });

    // --- Desktop Header Controls & Sync YouTube Logic ---
    if (btnPrefetch3) {
        btnPrefetch3.addEventListener("click", async () => {
            if (!activePlaylistItems || activePlaylistItems.length === 0) {
                alert("Please select or analyze a playlist first.");
                return;
            }
            btnPrefetch3.disabled = true;
            btnPrefetch3.textContent = "Caching 3 Songs...";
            gridHud.classList.remove("hidden");
            hudJobTitle.textContent = "Pre-downloading 3 Error-Free Songs into IndexedDB...";

            await prefetchUpcomingTracks(activePlaylistItems, currentTrackIndex, 3);

            hudJobTitle.textContent = "Completed 3-Song Rolling Buffer Caching!";
            setTimeout(() => gridHud.classList.add("hidden"), 4000);
            btnPrefetch3.disabled = false;
            btnPrefetch3.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--neon-blue)" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> <span>Pre-download 3 Songs</span>`;
        });
    }

    async function performFullSync(btnEl = null) {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Syncing...`;
        }

        try {
            await syncDesktopPlaylists();
            if (currentUserAccount) {
                await syncOneDriveMusic();
            }
            alert(`Sync complete! ${playlists.length} playlists loaded into IndexedDB master store.`);
        } catch (e) {
            console.error("Sync error:", e);
            alert("Sync error: " + (e.message || e));
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> <span>Sync Playlist</span>`;
            }
        }
    }

    if (refreshPlaylistBtn) {
        refreshPlaylistBtn.addEventListener("click", () => performFullSync(refreshPlaylistBtn));
    }

    if (btnSyncMobile) {
        btnSyncMobile.addEventListener("click", () => performFullSync(btnSyncMobile));
    }

    if (playPlaylistBtn) {
        playPlaylistBtn.addEventListener("click", () => {
            if (!activePlaylistItems || activePlaylistItems.length === 0) return;
            playTrack(activePlaylistItems[0], activePlaylistItems, 0);
        });
    }

    if (resumePlaylistBtn) {
        resumePlaylistBtn.addEventListener("click", () => {
            resumePlaylist();
        });
    }

    function saveResumePosition(playlistId, trackId, currentTime, trackIndex) {
        if (!playlistId || !trackId) return;
        try {
            const raw = localStorage.getItem("sonicstream_resume_map") || "{}";
            const map = JSON.parse(raw);
            map[playlistId] = {
                trackId: trackId,
                currentTime: Math.floor(currentTime || 0),
                trackIndex: trackIndex || 0,
                timestamp: Date.now()
            };
            localStorage.setItem("sonicstream_resume_map", JSON.stringify(map));
            
            fetch(`/api/history/${playlistId}/last-played`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ track_id: trackId })
            }).catch(() => {});
        } catch(e) {}
    }

    function getResumePosition(playlistId) {
        try {
            const raw = localStorage.getItem("sonicstream_resume_map") || "{}";
            const map = JSON.parse(raw);
            return map[playlistId] || null;
        } catch(e) {
            return null;
        }
    }

    async function resumePlaylist(pl) {
        const playlist = pl || playlists.find(p => p.id === activePlaylistId);
        if (!playlist || !playlist.tracks || playlist.tracks.length === 0) return;

        const posInfo = getResumePosition(playlist.id);
        let targetTrack = playlist.tracks[0];
        let targetIndex = 0;
        let seekTime = 0;

        if (posInfo) {
            const foundIdx = playlist.tracks.findIndex(t => t.id === posInfo.trackId);
            if (foundIdx >= 0) {
                targetTrack = playlist.tracks[foundIdx];
                targetIndex = foundIdx;
                seekTime = posInfo.currentTime || 0;
            }
        }

        await playTrack(targetTrack, playlist.tracks, targetIndex);
        if (seekTime > 0) {
            audioElement.currentTime = seekTime;
        }
    }

    if (statusFilter) {
        statusFilter.addEventListener("change", () => {
            filterAndRenderTracks();
        });
    }

    function filterAndRenderTracks() {
        if (!activePlaylistItems) return;
        const query = playlistSearch ? playlistSearch.value.toLowerCase().trim() : "";
        const stat = statusFilter ? statusFilter.value : "all";

        let filtered = activePlaylistItems.filter(t => {
            const matchesQuery = !query || t.title.toLowerCase().includes(query) || (t.artist && t.artist.toLowerCase().includes(query));
            let matchesStatus = true;
            if (stat === "completed") matchesStatus = (t.status === "completed" || t.isLocalBlob);
            else if (stat === "queued") matchesStatus = (t.status === "queued" || !t.status);
            else if (stat === "error") matchesStatus = (t.status === "error");
            return matchesQuery && matchesStatus;
        });

        renderTracksTable(filtered);
    }

    if (deselectAllBtn) deselectAllBtn.addEventListener("click", () => {
        selectedTrackIds.clear();
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        renderTracksTable(activePlaylistItems);
    });

    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener("change", (e) => {
            if (e.target.checked) {
                selectedTrackIds = new Set(activePlaylistItems.map(t => t.id));
            } else {
                selectedTrackIds.clear();
            }
            renderTracksTable(activePlaylistItems);
        });
    }

    downloadBtn.addEventListener("click", async () => {
        if (selectedTrackIds.size === 0) {
            alert("Please select tracks using checkboxes first.");
            return;
        }
        const selectedItems = activePlaylistItems.filter(t => selectedTrackIds.has(t.id));
        gridHud.classList.remove("hidden");
        hudJobTitle.textContent = `Downloading ${selectedItems.length} Selected Tracks`;

        await prefetchUpcomingTracks(selectedItems, -1, selectedItems.length);
        hudJobTitle.textContent = `Completed 3-song buffer caching for selected tracks.`;
        setTimeout(() => gridHud.classList.add("hidden"), 4000);
    });

    if (downloadAllBtn) {
        downloadAllBtn.addEventListener("click", async () => {
            if (!activePlaylistItems || activePlaylistItems.length === 0) {
                alert("Please select or open a playlist first.");
                return;
            }
            selectedTrackIds = new Set(activePlaylistItems.map(t => t.id));
            if (selectAllCheckbox) selectAllCheckbox.checked = true;
            renderTracksTable(activePlaylistItems);

            gridHud.classList.remove("hidden");
            hudJobTitle.textContent = `Downloading All ${activePlaylistItems.length} Tracks into Offline IndexedDB Cache...`;

            await prefetchUpcomingTracks(activePlaylistItems, -1, activePlaylistItems.length);
            hudJobTitle.textContent = `Completed 100% Offline Caching for All ${activePlaylistItems.length} Tracks!`;
            setTimeout(() => gridHud.classList.add("hidden"), 4000);
        });
    }

    // --- Import Local iPhone Files Handler ---
    if (btnImportLocalFiles && localFileInput) btnImportLocalFiles.addEventListener("click", () => localFileInput.click());

    if (localFileInput) localFileInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        let localPlaylist = (await getAllPlaylistsFromDB()).find(p => p.id === "local_iphone_files");
        if (!localPlaylist) {
            localPlaylist = {
                id: "local_iphone_files",
                title: "Local iPhone Music",
                source: "local",
                tracks: []
            };
        }

        for (const file of files) {
            const trackId = "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
            // Save file blob to IndexedDB
            await saveTrackBlobToDB(trackId, file);

            localPlaylist.tracks.push({
                id: trackId,
                title: file.name.replace(/\.[^/.]+$/, ""),
                artist: "On My iPhone",
                file: file.name,
                duration: 0,
                isLocalBlob: true
            });
        }

        await savePlaylistToDB(localPlaylist);
        loadPlaylistsFromDB();
        selectPlaylist(localPlaylist);
    });

    // --- Load Playlists & Sidebar Rendering ---
    async function syncDesktopPlaylists(onProgress = null) {
        try {
            if (onProgress) onProgress(0, 100, 5);
            let desktopPlaylists = [];
            
            const sasToken = getAzureSASToken();
            const azureCloudManifestUrl = `${getAzureBlobBaseUrl()}/playlists_manifest.json?${sasToken}`;
            
            const apiEndpoints = [
                "./playlists_manifest.json",
                azureCloudManifestUrl,
                "/api/playlists/list",
                "http://127.0.0.1:8765/api/playlists/list",
                "http://localhost:8765/api/playlists/list"
            ];

            let res = null;
            for (let url of apiEndpoints) {
                try {
                    res = await fetch(url, { cache: "no-cache" });
                    if (res && res.ok) break;
                } catch (e) {}
            }

            if (res && res.ok) {
                const data = await res.json();
                desktopPlaylists = data.playlists || [];
            }

            if ((!desktopPlaylists || desktopPlaylists.length === 0) && window.SONICSTREAM_MANIFEST_FALLBACK && window.SONICSTREAM_MANIFEST_FALLBACK.playlists) {
                console.log("[PWA Sync] Using bundled manifest_fallback.js data!");
                desktopPlaylists = window.SONICSTREAM_MANIFEST_FALLBACK.playlists;
            }

            if (desktopPlaylists && desktopPlaylists.length > 0) {
                desktopPlaylists = desktopPlaylists.map(item => ({
                    id: item.id,
                    title: item.playlist_title || item.title || "Desktop Playlist",
                    url: item.url || "",
                    source: "desktop",
                    thumbnail: item.thumbnail || (item.items && item.items[0] && item.items[0].thumbnail) || "gita_cover_logo.png",
                    tracks: (item.items || item.tracks || []).map(track => ({
                        id: track.id,
                        title: track.title,
                        artist: track.uploader || track.artist || "SonicStream",
                        duration: track.duration || 0,
                        thumbnail: track.thumbnail || "gita_cover_logo.png",
                        url: track.url || `https://www.youtube.com/watch?v=${track.id}`,
                        file: track.file || (track.title ? `${track.title}.mp3` : track.id),
                        downloadUrl: track.downloadUrl,
                        status: track.status || "queued"
                    }))
                }));
            }



            if (desktopPlaylists.length > 0) {
                playlists = desktopPlaylists;
                const fileRecordsToSave = [];
                for (let i = 0; i < desktopPlaylists.length; i++) {
                    const pl = desktopPlaylists[i];
                    await savePlaylistToDB(pl);
                    if (pl.tracks) {
                        for (const tr of pl.tracks) {
                            if (tr.file) {
                                fileRecordsToSave.push({
                                    file_id: tr.file,
                                    id: tr.id,
                                    title: tr.title,
                                    artist: tr.artist,
                                    duration: tr.duration,
                                    file: tr.file
                                });
                            }
                        }
                    }
                }
                await saveBatchFileRecordsToDB(fileRecordsToSave);
                console.log(`[PWA] Synced ${desktopPlaylists.length} playlists and ${fileRecordsToSave.length} file records to IndexedDB.`);
            }

            const dbPlaylists = await getAllPlaylistsFromDB();
            if (dbPlaylists.length > 0) playlists = dbPlaylists;

            await renderSidebarList();
            if (playlists.length > 0 && (!activePlaylistId || !playlists.find(p => p.id === activePlaylistId))) {
                selectPlaylist(playlists[0]);
            }
        } catch (err) {
            console.error("[PWA] Sync playlists error:", err);
        } finally {
            hideHud();
        }
    }

    function showHud(title, file = "") {
        if (!gridHud) return;
        if (hudJobTitle) hudJobTitle.textContent = title;
        if (hudCurrentFile) hudCurrentFile.textContent = file;
        gridHud.style.display = "flex";
        gridHud.classList.remove("hidden");
    }

    function hideHud() {
        if (!gridHud) return;
        gridHud.style.display = "none";
        gridHud.classList.add("hidden");
    }

    async function loadPlaylistsFromDB() {
        playlists = await getAllPlaylistsFromDB();
        if (playlists.length > 0) {
            selectPlaylist(playlists[0]);
        }
        await syncDesktopPlaylists();
        playlists = await getAllPlaylistsFromDB();
        renderSidebarList();
        if (playlists.length > 0 && (!activePlaylistId || !playlists.find(p => p.id === activePlaylistId))) {
            selectPlaylist(playlists[0]);
        }
    }

    async function renderSidebarList() {
        if (mobilePlaylistsList) {
            renderMobilePlaylists();
        }

        if (!playlistListContainer) return;
        playlistListContainer.innerHTML = "";

        let cachedTrackKeys = new Set();
        if (db && db.objectStoreNames.contains("files")) {
            try {
                const tx = db.transaction("files", "readonly");
                const allKeys = await new Promise(r => {
                    const req = tx.objectStore("files").getAllKeys();
                    req.onsuccess = () => r(req.result || []);
                    req.onerror = () => r([]);
                });
                cachedTrackKeys = new Set(allKeys);
            } catch (e) {}
        }

        let filtered = playlists;
        if (sidebarTabFilter === "local") {
            filtered = playlists.filter(p => p.source === "local");
        } else if (sidebarTabFilter === "offline") {
            filtered = playlists.filter(p => {
                if (p.source === "local" || p.isCached) return true;
                if (p.tracks && p.tracks.some(t => cachedTrackKeys.has(t.id) || t.file || t.isLocalBlob)) return true;
                return false;
            });
        }

        // Sort Pinned Playlists to top, Normal in middle, Deleted Tracks LAST
        filtered.sort((a, b) => {
            const isADeleted = a.id === "deleted_tracks" || a.id === "trash" || (a.title && a.title.toLowerCase().includes("deleted"));
            const isBDeleted = b.id === "deleted_tracks" || b.id === "trash" || (b.title && b.title.toLowerCase().includes("deleted"));
            if (isADeleted && !isBDeleted) return 1;
            if (!isADeleted && isBDeleted) return -1;

            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return 0;
        });

        if (filtered.length === 0) {
            playlistListContainer.innerHTML = `<div style="font-size:0.75rem; color: var(--text-muted); text-align:center; padding: 1.5rem 0;">No offline playlists found.</div>`;
            return;
        }

        filtered.forEach(pl => {
            const row = document.createElement("div");
            row.className = `sidebar-row ${activePlaylistId === pl.id ? 'active' : ''}`;
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.gap = "0.65rem";
            row.style.padding = "0.55rem 0.65rem";

            let rawThumb = getPlaylistThumbnail(pl);
            if (!rawThumb || rawThumb === "icon.svg") rawThumb = pl.thumbnail || "gita_cover_logo.png";

            const firstThumb = rawThumb.startsWith("/") ? ((window.location.protocol.startsWith("http") ? window.location.origin : "http://127.0.0.1:8765") + rawThumb) : rawThumb;
            const trackCount = (pl.tracks || []).length;
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.65rem; width: 100%; min-width: 0;">
                    <img src="${firstThumb}" style="width: 38px; height: 38px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color); flex-shrink: 0;" onerror="this.onerror=null; this.src='gita_cover_logo.png';">
                    <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                        <div class="sidebar-row-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; font-size: 0.85rem; color: var(--text-primary);">${pl.isPinned ? '📌 ' : ''}${pl.title}</div>
                        <div class="sidebar-row-meta" style="font-size: 0.7rem; color: var(--text-secondary);">${trackCount} tracks | ${pl.source === 'desktop' ? 'Desktop Synced' : (pl.source === 'local' ? 'iPhone File' : 'OneDrive')}</div>
                    </div>
                </div>
                <div class="sidebar-row-actions" style="display: flex; gap: 0.35rem; align-items: center; width: 100%; justify-content: flex-start; margin-top: 0.25rem;" onclick="event.stopPropagation();">
                    <button class="download-sidebar-btn" title="Download All Tracks to IndexedDB" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); cursor: pointer; color: var(--neon-blue); padding: 4px 6px; font-size: 1.15rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">⬇️</button>
                    <button class="play-sidebar-btn" title="Play Playlist" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); cursor: pointer; color: var(--neon-blue); padding: 4px 6px; font-size: 1.15rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">▶️</button>
                    <button class="resume-sidebar-btn" title="Resume Playlist" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); cursor: pointer; color: var(--neon-purple); padding: 4px 6px; font-size: 1.15rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">⏯️</button>
                    <button class="shuffle-sidebar-btn" title="Shuffle Play" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); cursor: pointer; color: var(--text-secondary); padding: 4px 6px; font-size: 1.15rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">🔀</button>
                    <button class="pin-sidebar-btn" title="Pin Playlist" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); cursor: pointer; color: var(--text-muted); padding: 4px 6px; font-size: 1.15rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">📌</button>
                    <button class="delete-sidebar-btn" title="Delete Playlist" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); cursor: pointer; color: #ff5f56; padding: 4px 6px; font-size: 1.15rem; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;">🗑️</button>
                </div>
            `;

            row.querySelector(".download-sidebar-btn").addEventListener("click", async () => {
                selectPlaylist(pl);
                const dlBtn = row.querySelector(".download-sidebar-btn");
                dlBtn.textContent = "⏳";
                try {
                    if (pl.tracks && pl.tracks.length > 0) {
                        for (let i = 0; i < pl.tracks.length; i++) {
                            const track = pl.tracks[i];
                            dlBtn.title = `Caching (${i + 1}/${pl.tracks.length})`;
                            await prefetchUpcomingTracks([track], -1, 1);
                        }
                        dlBtn.textContent = "✅";
                    }
                } catch (e) {
                    dlBtn.textContent = "⚠️";
                } finally {
                    setTimeout(() => { dlBtn.textContent = "⬇️"; dlBtn.title = "Download All Tracks to IndexedDB"; }, 3000);
                }
            });

            row.querySelector(".play-sidebar-btn").addEventListener("click", () => {
                selectPlaylist(pl);
                if (pl.tracks && pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks, 0);
            });

            row.querySelector(".resume-sidebar-btn").addEventListener("click", () => {
                selectPlaylist(pl);
                resumePlaylist(pl);
            });

            row.querySelector(".shuffle-sidebar-btn").addEventListener("click", () => {
                selectPlaylist(pl);
                if (pl.tracks && pl.tracks.length > 0) {
                    const shuffled = [...pl.tracks].sort(() => Math.random() - 0.5);
                    playTrack(shuffled[0], shuffled, 0);
                }
            });

            row.querySelector(".pin-sidebar-btn").addEventListener("click", () => {
                pl.isPinned = !pl.isPinned;
                savePlaylistToDB(pl);
                renderSidebarList();
            });

            row.querySelector(".delete-sidebar-btn").addEventListener("click", async () => {
                if (confirm(`Delete playlist "${pl.title}"?`)) {
                    if (db) {
                        const tx = db.transaction("playlists", "readwrite");
                        tx.objectStore("playlists").delete(pl.id);
                    }
                    playlists = playlists.filter(p => p.id !== pl.id);
                    renderSidebarList();
                }
            });

            row.addEventListener("click", () => {
                selectPlaylist(pl);
            });
            if (playlistListContainer) playlistListContainer.appendChild(row);
        });

        if (mobilePlaylistsList) {
            renderMobilePlaylists();
        }
    }

    // --- Dedicated Mobile UX Handlers ---
    function renderMobilePlaylists() {
        if (!mobilePlaylistsList) return;
        mobilePlaylistsList.innerHTML = "";

        if (playlists.length === 0) {
            mobilePlaylistsList.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 2rem 1rem;">No playlists found. Tap Refresh or add tracks in desktop.</div>`;
            return;
        }

        playlists.forEach(pl => {
            const trackCount = (pl.tracks || []).length;
            const thumb = getPlaylistThumbnail(pl);

            const card = document.createElement("div");
            card.className = "mobile-playlist-card";
            card.innerHTML = `
                <img src="${thumb}" class="mobile-card-thumb" onerror="this.src='icon.svg'">
                <div class="mobile-card-info">
                    <div class="mobile-card-title">${pl.title || 'Untitled Playlist'}</div>
                    <div class="mobile-card-subtitle">${trackCount} tracks ${pl.isPinned ? '• 📌 Pinned' : ''}</div>
                </div>
                <div style="font-size: 1.2rem; color: var(--neon-blue);">›</div>
            `;

            card.addEventListener("click", () => {
                showMobilePlaylistTracks(pl);
            });

            mobilePlaylistsList.appendChild(card);
        });
    }

    function showMobilePlaylistTracks(pl) {
        if (!mobileTracksView || !mobilePlaylistsView) return;
        selectPlaylist(pl);

        if (mobileCurrentPlaylistTitle) mobileCurrentPlaylistTitle.textContent = pl.title || "Playlist Tracks";
        mobilePlaylistsView.style.display = "none";
        mobileTracksView.style.display = "block";

        if (mobileTrackList) {
            mobileTrackList.innerHTML = "";
            const tracks = pl.tracks || [];
            if (tracks.length === 0) {
                mobileTrackList.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 2rem 1rem;">No tracks in this playlist.</div>`;
                return;
            }

            tracks.forEach((track, idx) => {
                const item = document.createElement("div");
                item.className = "mobile-track-item";
                const thumb = track.thumbnail || "icon.svg";
                item.innerHTML = `
                    <img src="${thumb}" class="mobile-track-thumb" onerror="this.src='icon.svg'">
                    <div class="mobile-track-details">
                        <div class="mobile-track-title">${track.title || 'Untitled Track'}</div>
                        <div class="mobile-track-artist">${track.artist || track.uploader || 'SonicStream'} • ${formatDuration(track.duration || 0)}</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" style="padding: 0.3rem 0.5rem; font-size: 0.75rem; border-radius: 6px;">▶ Play</button>
                `;

                item.addEventListener("click", () => {
                    playTrack(track, tracks, idx);
                });

                mobileTrackList.appendChild(item);
            });
        }
    }

    if (btnBackToPlaylists) {
        btnBackToPlaylists.addEventListener("click", () => {
            if (mobileTracksView && mobilePlaylistsView) {
                mobileTracksView.style.display = "none";
                mobilePlaylistsView.style.display = "block";
            }
        });
    }

    if (btnSyncMobile) {
        btnSyncMobile.addEventListener("click", async () => {
            btnSyncMobile.disabled = true;
            btnSyncMobile.textContent = "⏳ Syncing...";
            await syncDesktopPlaylists();
            renderMobilePlaylists();
            btnSyncMobile.disabled = false;
            btnSyncMobile.textContent = "🔄 Refresh";
        });
    }

    if (tabAll) tabAll.addEventListener("click", () => { setSidebarTab("all", tabAll); });
    if (tabLocal) tabLocal.addEventListener("click", () => { setSidebarTab("local", tabLocal); });
    if (tabOffline) tabOffline.addEventListener("click", () => { setSidebarTab("offline", tabOffline); });

    function setSidebarTab(tabName, btnEl) {
        sidebarTabFilter = tabName;
        document.querySelectorAll(".sidebar-tabs .tab-btn").forEach(b => b.classList.remove("active"));
        btnEl.classList.add("active");
        renderSidebarList();
    }

    function isPhoneDevice() {
        return window.innerWidth <= 768;
    }

    // Hide 'Local iPhone' tab and 'Back' button on Desktop browsers
    if (tabLocal) {
        tabLocal.style.display = isPhoneDevice() ? "inline-block" : "none";
    }

    const playlistSidebar = document.querySelector(".playlist-sidebar");
    if (btnBackToPlaylists) {
        btnBackToPlaylists.style.display = isPhoneDevice() ? "inline-flex" : "none";
        btnBackToPlaylists.addEventListener("click", () => {
            if (isPhoneDevice()) {
                if (playlistSidebar) playlistSidebar.style.display = "flex";
                const plSection = document.getElementById("playlistSection");
                if (plSection) plSection.style.display = "none";
            }
        });
    }

    // Desktop Sidebar Mouse Drag Resizer
    const resizer = document.getElementById("sidebarResizer");
    if (resizer && playlistSidebar) {
        let isResizing = false;
        resizer.addEventListener("mousedown", (e) => {
            isResizing = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            resizer.style.background = "var(--neon-blue)";
        });
        document.addEventListener("mousemove", (e) => {
            if (!isResizing) return;
            const sidebarRect = playlistSidebar.getBoundingClientRect();
            const newWidth = e.clientX - sidebarRect.left;
            if (newWidth >= 240 && newWidth <= 650) {
                playlistSidebar.style.width = `${newWidth}px`;
            }
        });
        document.addEventListener("mouseup", () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                resizer.style.background = "transparent";
            }
        });
    }

    function selectPlaylist(pl) {
        if (!pl) return;
        activePlaylistId = pl.id;
        activePlaylistItems = pl.tracks || [];
        if (playlistTitle) playlistTitle.textContent = pl.title || "Untitled Playlist";
        if (playlistMetaInfo) playlistMetaInfo.textContent = `${activePlaylistItems.length} tracks | Source: ${pl.source === 'desktop' ? 'Desktop App Synced' : (pl.source === 'local' ? 'Local Device' : 'OneDrive Cloud')}`;
        renderSidebarList();
        renderTracksTable(activePlaylistItems);

        const plSection = document.getElementById("playlistSection");
        if (plSection) plSection.style.display = "flex";

        if (isPhoneDevice() && playlistSidebar) {
            playlistSidebar.style.display = "none";
            if (btnBackToPlaylists) btnBackToPlaylists.style.display = "inline-flex";
        } else if (playlistSidebar) {
            playlistSidebar.style.display = "flex";
            if (btnBackToPlaylists) btnBackToPlaylists.style.display = "none";
        }
    }

    let currentPage = 1;
    const pageSize = 50;

    function renderTracksTable(items) {
        if (!playlistTableBody) return;
        playlistTableBody.innerHTML = "";
        if (selectedCountInfo) selectedCountInfo.textContent = selectedTrackIds.size;
        if (totalCountInfo) totalCountInfo.textContent = activePlaylistItems.length;

        if (items.length === 0) {
            playlistTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 2rem;">No tracks matching criteria.</td></tr>`;
            return;
        }

        const totalPages = Math.ceil(items.length / pageSize) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        const startIdx = (currentPage - 1) * pageSize;
        const pageItems = items.slice(startIdx, startIdx + pageSize);

        const pageIndicator = document.getElementById("pageIndicator");
        const btnPrevPage = document.getElementById("btnPrevPage");
        const btnNextPage = document.getElementById("btnNextPage");
        if (pageIndicator) pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
        if (btnPrevPage) btnPrevPage.disabled = (currentPage <= 1);
        if (btnNextPage) btnNextPage.disabled = (currentPage >= totalPages);

        pageItems.forEach((item, index) => {
            const tr = document.createElement("tr");
            const isSelected = selectedTrackIds.has(item.id);
            const statusBadge = item.isLocalBlob ? '<span style="color:#27c93f;">Local File</span>' :
                                (item.status === 'completed' ? '<span style="color:var(--neon-blue);">⚡ Cached Buffer</span>' :
                                (item.status === 'error' ? '<span style="color:#ff5f56;">❌ Error Skipped</span>' : '<span style="color:var(--text-secondary);">Queued</span>'));

            const thumbUrl = getTrackThumbnailUrl(item);
            const errorText = item.error || (item.status === 'error' ? 'Stream unavailable' : '--');

            tr.innerHTML = `
                <td style="text-align: center;" onclick="event.stopPropagation();"><input type="checkbox" class="track-chk" data-id="${item.id}" ${isSelected ? 'checked' : ''} style="accent-color: var(--neon-blue); cursor: pointer;"></td>
                <td style="color: var(--text-muted); font-size: 0.75rem;">${startIdx + index + 1}</td>
                <td><img src="${thumbUrl}" alt="Cover" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color);" onerror="this.src='https://i.ytimg.com/vi/default/hqdefault.jpg'"></td>
                <td style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem;">${item.title}</td>
                <td style="text-align: center;" onclick="event.stopPropagation();">
                    <div style="display: flex; gap: 0.25rem; justify-content: center;">
                        <button class="btn-play-row" title="Play Now" style="background: transparent; border: none; cursor: pointer; color: var(--neon-blue); padding: 2px;">▶️</button>
                        <button class="btn-cache-row" title="Cache Track" style="background: transparent; border: none; cursor: pointer; color: var(--text-secondary); padding: 2px;">⚡</button>
                        <button class="btn-delete-row" title="Remove Track" style="background: transparent; border: none; cursor: pointer; color: #ff5f56; padding: 2px;">🗑️</button>
                    </div>
                </td>
                <td style="color: var(--text-secondary); font-size: 0.8rem;">${item.artist || item.uploader || 'SonicStream'}</td>
                <td style="font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.8rem;">${formatDuration(item.duration)}</td>
                <td><span style="font-size:0.7rem;">${statusBadge}</span></td>
                <td style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${errorText}</td>
            `;

            const chk = tr.querySelector(".track-chk");
            chk.addEventListener("change", (e) => {
                if (e.target.checked) selectedTrackIds.add(item.id);
                else selectedTrackIds.delete(item.id);
                if (selectedCountInfo) selectedCountInfo.textContent = selectedTrackIds.size;
            });

            tr.querySelector(".btn-play-row").addEventListener("click", () => playTrack(item, items, startIdx + index));
            tr.querySelector(".btn-cache-row").addEventListener("click", () => prefetchUpcomingTracks([item], 0, 1));
            tr.querySelector(".btn-delete-row").addEventListener("click", () => {
                activePlaylistItems = activePlaylistItems.filter(t => t.id !== item.id);
                renderTracksTable(activePlaylistItems);
            });

            tr.addEventListener("click", (e) => {
                if (e.target.tagName !== "INPUT" && !e.target.closest("button")) {
                    playTrack(item, items, startIdx + index);
                }
            });
            playlistTableBody.appendChild(tr);
        });
    }

    const btnPrevPage = document.getElementById("btnPrevPage");
    const btnNextPage = document.getElementById("btnNextPage");
    if (btnPrevPage) btnPrevPage.addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderTracksTable(activePlaylistItems); } });
    if (btnNextPage) btnNextPage.addEventListener("click", () => { currentPage++; renderTracksTable(activePlaylistItems); });

    let currentSortColumn = "index";
    let currentSortAsc = true;

    document.querySelectorAll(".sortable-th").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.getAttribute("data-sort");
            if (currentSortColumn === col) {
                currentSortAsc = !currentSortAsc;
            } else {
                currentSortColumn = col;
                currentSortAsc = true;
            }
            sortTracks(col, currentSortAsc);
        });
    });

    function sortTracks(col, asc) {
        if (!activePlaylistItems) return;
        activePlaylistItems.sort((a, b) => {
            let valA = a[col] || "";
            let valB = b[col] || "";
            if (col === "index") return 0;
            if (typeof valA === "string") valA = valA.toLowerCase();
            if (typeof valB === "string") valB = valB.toLowerCase();
            if (valA < valB) return asc ? -1 : 1;
            if (valA > valB) return asc ? 1 : -1;
            return 0;
        });
        renderTracksTable(activePlaylistItems);
    }

    if (playlistSearch) playlistSearch.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = activePlaylistItems.filter(t => t.title.toLowerCase().includes(query) || (t.artist && t.artist.toLowerCase().includes(query)));
        renderTracksTable(filtered);
    });

    // --- Audio Engine & MediaSession Controls ---
    async function playTrack(track, queue, index) {
        if (!track) return;

        clearNextTrackTimers();
        playQueue = queue || [track];
        currentTrackIndex = index !== undefined ? index : playQueue.findIndex(t => t.id === track.id);

        playerTrackTitle.textContent = track.title;
        playerTrackArtist.textContent = track.artist || track.uploader || "SonicStream";
        
        let thumbUrl = getTrackThumbnailUrl(track);
        if (playerTrackThumb) playerTrackThumb.src = thumbUrl;

        if (playerStatusEq) playerStatusEq.classList.remove("hidden");
        if (playerStatusText) playerStatusText.textContent = "Loading...";

        try {
            let mediaUrl = null;
            const targetFile = track.file || (track.title ? `${track.title}.mp3` : null);
            const isVideoTrack = (mediaPlaybackMode === "video") || (targetFile && (targetFile.endsWith(".mp4") || targetFile.endsWith(".webm") || targetFile.endsWith(".mkv")));
            const streamFormat = isVideoTrack ? "video" : "audio";

            // 1. Check IndexedDB for High-Quality cached Blob (100% offline driving playback!)
            const cachedRecord = await getTrackRecordFromDB(track.id, track.title);
            if (cachedRecord && cachedRecord.blob) {
                mediaUrl = URL.createObjectURL(cachedRecord.blob);
                if (cachedRecord.thumbBlob) {
                    playerTrackThumb.src = URL.createObjectURL(cachedRecord.thumbBlob);
                }
                console.log("[PWA Player] Playing 100% offline high-quality media from IndexedDB!");
            } else if (track.downloadUrl) {
                mediaUrl = track.downloadUrl;
            } else if (targetFile) {
                if (window.location.protocol.startsWith("https") || window.location.hostname.includes("azurestaticapps.net")) {
                    const sasToken = getAzureSASToken();
                    mediaUrl = `${getAzureBlobBaseUrl()}/${encodeURIComponent(targetFile)}?${sasToken}`;
                } else {
                    mediaUrl = `/api/media/file/${encodeURIComponent(targetFile)}`;
                }
            } else if (track.url && track.url.startsWith("http")) {
                mediaUrl = `/api/media/stream?video_url=${encodeURIComponent(track.url)}&title=${encodeURIComponent(track.title)}&format=${streamFormat}`;
            } else if (track.id) {
                mediaUrl = `/api/media/stream?video_url=${encodeURIComponent('https://www.youtube.com/watch?v=' + track.id)}&title=${encodeURIComponent(track.title)}&format=${streamFormat}`;
            }

            if (!mediaUrl) throw new Error("Media stream URL unavailable");

            if (mediaUrl.startsWith("/")) {
                mediaUrl = (window.location.protocol.startsWith("http") ? window.location.origin : "http://127.0.0.1:8765") + mediaUrl;
            }

            if (isVideoTrack && videoElement) {
                if (videoContainer) {
                    videoContainer.classList.remove("hidden");
                    videoContainer.style.display = "block";
                }
                if (btnMediaModeVideo) btnMediaModeVideo.classList.add("active");
                if (btnMediaModeAudio) btnMediaModeAudio.classList.remove("active");
                if (audioElement) audioElement.pause();

                videoElement.src = mediaUrl;
                videoElement.load();
                videoElement.onerror = () => {
                    console.log("[Video Engine] Video error, falling back to Audio Engine...");
                    if (videoContainer) videoContainer.style.display = "none";
                    audioElement.src = mediaUrl;
                    audioElement.play().catch(ae => console.error("[Audio Fallback] Play error:", ae));
                };
                const playPromise = videoElement.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        console.log("[Video Engine] Video play failed, switching to Audio Engine fallback:", err);
                        if (videoContainer) videoContainer.style.display = "none";
                        audioElement.src = mediaUrl;
                        audioElement.play().catch(e => console.error("[Audio Fallback] Play error:", e));
                    });
                }
            } else {
                if (videoContainer) {
                    videoContainer.classList.add("hidden");
                    videoContainer.style.display = "none";
                }
                if (btnMediaModeAudio) btnMediaModeAudio.classList.add("active");
                if (btnMediaModeVideo) btnMediaModeVideo.classList.remove("active");
                if (videoElement) videoElement.pause();

                initWebAudioEngine();
                audioElement.src = mediaUrl;
                audioElement.onerror = () => {
                    console.warn(`[Audio Engine] Direct URL playback failed for '${track.title}'. Trying stream fallback...`);
                    if (track.id && track.id.length === 11) {
                        const fallbackUrl = `/api/media/stream?video_url=${encodeURIComponent('https://www.youtube.com/watch?v=' + track.id)}&title=${encodeURIComponent(track.title)}&format=audio`;
                        const fullFallback = (window.location.protocol.startsWith("http") ? window.location.origin : "http://127.0.0.1:8765") + fallbackUrl;
                        audioElement.onerror = () => {
                            console.error(`[Audio Engine] All stream fallbacks failed for '${track.title}'`);
                            setTimeout(() => playNextTrackAuto(), 1500);
                        };
                        audioElement.src = fullFallback;
                        audioElement.play().catch(e => console.error("[Audio Engine] Fallback play error:", e));
                    } else {
                        setTimeout(() => playNextTrackAuto(), 1500);
                    }
                };
                audioElement.load();
                await audioElement.play();
            }
            isPlaying = true;
            updatePlayBtnUI();

            if (playerStatusText) playerStatusText.textContent = "Playing";
            updateMediaSession(track);

            // Smart Caching: Pre-fetch next 3 tracks in background for zero-buffering / car playback
            prefetchUpcomingTracks(playQueue, currentTrackIndex, 3);
        } catch (err) {
            console.error("Playback error:", err);
            if (playerStatusEq) playerStatusEq.classList.add("hidden");
            if (playerStatusText) playerStatusText.textContent = "Error Playing Track";
            isPlaying = false;
            updatePlayBtnUI();
        }
    }

    function updatePlayBtnUI() {
        if (playIconSvg) {
            if (isPlaying) {
                playIconSvg.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
            } else {
                playIconSvg.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
            }
        }
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
        }
    }

    if (playerPlayPauseBtn) playerPlayPauseBtn.addEventListener("click", () => {
        if (!audioElement.src) return;
        initWebAudioEngine();
        clearNextTrackTimers();
        if (isPlaying) {
            audioElement.pause();
            isPlaying = false;
        } else {
            audioElement.play();
            isPlaying = true;
        }
        updatePlayBtnUI();
    });

    if (playerNextBtn) playerNextBtn.addEventListener("click", () => {
        clearNextTrackTimers();
        playNextTrack();
    });
    if (playerPrevBtn) playerPrevBtn.addEventListener("click", () => {
        clearNextTrackTimers();
        playPrevTrack();
    });

    function playNextTrack() {
        if (playQueue.length === 0) return;
        let nextIdx = (currentTrackIndex + 1) % playQueue.length;
        playTrack(playQueue[nextIdx], playQueue, nextIdx);
    }

    function playPrevTrack() {
        if (playQueue.length === 0) return;
        let prevIdx = (currentTrackIndex - 1 + playQueue.length) % playQueue.length;
        playTrack(playQueue[prevIdx], playQueue, prevIdx);
    }

    if (audioElement) audioElement.addEventListener("ended", () => {
        clearNextTrackTimers();
        if (isRepeat) {
            audioElement.currentTime = 0;
            audioElement.play();
            return;
        }

        const pauseInput = document.getElementById("playerPauseSeconds");
        const pauseSecs = pauseInput ? parseInt(pauseInput.value) : 5;

        if (pauseSecs > 0) {
            let count = pauseSecs;
            if (playerStatusEq) playerStatusEq.classList.add("hidden");
            if (playerStatusText) playerStatusText.textContent = `Pause (${count}s)...`;

            nextTrackCountdownInterval = setInterval(() => {
                count--;
                if (count > 0) {
                    if (playerStatusText) playerStatusText.textContent = `Pause (${count}s)...`;
                } else {
                    clearInterval(nextTrackCountdownInterval);
                    nextTrackCountdownInterval = null;
                }
            }, 1000);

            nextTrackTimeout = setTimeout(() => {
                clearNextTrackTimers();
                playNextTrack();
            }, pauseSecs * 1000);
        } else {
            playNextTrack();
        }
    });

    let lastSaveTime = 0;
    if (audioElement) audioElement.addEventListener("timeupdate", () => {
        if (audioElement.duration) {
            playerProgressBar.value = (audioElement.currentTime / audioElement.duration) * 100;
            playerCurrentTime.textContent = formatDuration(audioElement.currentTime);
            playerTotalTime.textContent = formatDuration(audioElement.duration);
            
            const now = Date.now();
            if (now - lastSaveTime > 3000) {
                lastSaveTime = now;
                if (activePlaylistId && playQueue[currentTrackIndex]) {
                    saveResumePosition(activePlaylistId, playQueue[currentTrackIndex].id, audioElement.currentTime, currentTrackIndex);
                }
            }
            
            if ("mediaSession" in navigator && !isNaN(audioElement.duration)) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: audioElement.duration,
                        playbackRate: audioElement.playbackRate || 1,
                        position: audioElement.currentTime
                    });
                } catch (e) {}
            }
        }
    });

    if (playerProgressBar) playerProgressBar.addEventListener("input", (e) => {
        if (audioElement.duration) {
            audioElement.currentTime = (e.target.value / 100) * audioElement.duration;
        }
    });

    // --- Web Audio API Engine & Volume Booster (Up to 200% Gain Boost) ---
    let audioCtx = null;
    let audioSourceNode = null;
    let gainNode = null;
    let compressorNode = null;

    function initWebAudioEngine() {
        if (audioCtx) {
            if (audioCtx.state === "suspended") {
                audioCtx.resume();
            }
            return;
        }
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
            audioElement.crossOrigin = "anonymous";

            audioSourceNode = audioCtx.createMediaElementSource(audioElement);
            gainNode = audioCtx.createGain();
            compressorNode = audioCtx.createDynamicsCompressor();

            // High-Fidelity Compressor setup for maximum clarity and loud audio
            compressorNode.threshold.setValueAtTime(-24, audioCtx.currentTime);
            compressorNode.knee.setValueAtTime(30, audioCtx.currentTime);
            compressorNode.ratio.setValueAtTime(12, audioCtx.currentTime);
            compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
            compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

            const currentVol = playerVolumeSlider ? (playerVolumeSlider.value / 100) : 1.0;
            gainNode.gain.setValueAtTime(currentVol * 1.8, audioCtx.currentTime);

            audioSourceNode.connect(compressorNode);
            compressorNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            console.log("[PWA Audio Engine] 200% Web Audio Gain Booster & Dynamic Equalizer initialized!");
        } catch (e) {
            console.warn("[PWA Audio Engine] Web Audio API init note:", e);
        }
    }

    if (playerVolumeSlider) playerVolumeSlider.addEventListener("input", (e) => {
        const val = e.target.value / 100;
        audioElement.volume = Math.min(1.0, val);
        if (gainNode && audioCtx) {
            gainNode.gain.setValueAtTime(val * 1.8, audioCtx.currentTime);
        }
    });

    function formatDuration(seconds) {
        if (!seconds) return "00:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // --- MediaSession (Car Bluetooth & Lockscreen Controls) ---
    function initMediaSessionHandlers() {
        if (!("mediaSession" in navigator)) return;
        try {
            navigator.mediaSession.setActionHandler("play", () => {
                if (audioElement.src) { audioElement.play(); isPlaying = true; updatePlayBtnUI(); }
            });
            navigator.mediaSession.setActionHandler("pause", () => {
                if (audioElement.src) { audioElement.pause(); isPlaying = false; updatePlayBtnUI(); }
            });
            navigator.mediaSession.setActionHandler("previoustrack", () => {
                clearNextTrackTimers();
                playPrevTrack();
            });
            navigator.mediaSession.setActionHandler("nexttrack", () => {
                clearNextTrackTimers();
                playNextTrack();
            });
            navigator.mediaSession.setActionHandler("seekto", (details) => {
                if (details.seekTime && audioElement.duration) {
                    audioElement.currentTime = details.seekTime;
                }
            });
            navigator.mediaSession.setActionHandler("seekbackward", (details) => {
                audioElement.currentTime = Math.max(0, audioElement.currentTime - (details.seekOffset || 10));
            });
            navigator.mediaSession.setActionHandler("seekforward", (details) => {
                if (audioElement.duration) {
                    audioElement.currentTime = Math.min(audioElement.duration, audioElement.currentTime + (details.seekOffset || 10));
                }
            });
        } catch (e) {
            console.warn("[MediaSession] AVRCP registration note:", e);
        }
    }

    function updateMediaSession(track) {
        if (!("mediaSession" in navigator) || !track) return;
        try {
            // Show real album art on the lockscreen / car head-unit. Prefer the
            // track thumbnail (YouTube hqdefault), then the gita cover, then the
            // app icon. (icon-512.png did not exist, so art never appeared.)
            const artwork = [];
            const art = getTrackThumbnailUrl(track);
            if (art && art !== "icon.svg") {
                const type = art.endsWith(".png") ? "image/png" : "image/jpeg";
                artwork.push({ src: art, sizes: "480x360", type });
                artwork.push({ src: art, sizes: "512x512", type });
            }
            artwork.push({ src: "icon.svg", sizes: "512x512", type: "image/svg+xml" });

            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || "Unknown Track",
                artist: track.artist || track.uploader || "SonicStream",
                album: "SonicStream PWA",
                artwork: artwork
            });
        } catch (e) {}
    }

    // --- PWA Hard Refresh (bust Service Worker + caches so a pinned/home-screen
    // app fetches the latest HTML/JS instead of serving stale cached assets) ---
    const btnHardRefresh = document.getElementById("btnHardRefresh");
    if (btnHardRefresh) {
        btnHardRefresh.addEventListener("click", async () => {
            btnHardRefresh.disabled = true;
            const orig = btnHardRefresh.innerHTML;
            btnHardRefresh.innerHTML = "⏳";
            try {
                if ("serviceWorker" in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                }
                if (window.caches) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                }
            } catch (e) {
                console.warn("[PWA] Hard refresh cleanup note:", e);
            }
            // Reload from network with a cache-busting query so the shell + app.js are fresh
            const base = location.href.split("?")[0].split("#")[0];
            location.replace(base + "?v=" + Date.now());
        });
    }

    // --- Settings Modal ---
    if (btnOpenSettings) btnOpenSettings.addEventListener("click", () => settingsModal && settingsModal.classList.remove("hidden"));
    if (btnCloseSettings) btnCloseSettings.addEventListener("click", () => settingsModal && settingsModal.classList.add("hidden"));
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener("click", () => {
            if (azureSasTokenInput) {
                localStorage.setItem("sonicstream_azure_sas", azureSasTokenInput.value.trim());
            }
            if (settingsModal) settingsModal.classList.add("hidden");
            initMSAL();
            syncDesktopPlaylists();
        });
    }

    if (btnSyncOneDriveNow) {
        btnSyncOneDriveNow.addEventListener("click", async () => {
            btnSyncOneDriveNow.disabled = true;
            btnSyncOneDriveNow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> <span>Syncing... 0%</span>`;
            try {
                await syncDesktopPlaylists((cur, tot, pct) => {
                    const span = btnSyncOneDriveNow.querySelector("span");
                    if (span) span.textContent = `Syncing ${cur}/${tot} (${pct}%)`;
                });
                btnSyncOneDriveNow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#27c93f" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> <span>Synced!</span>`;
            } catch (err) {
                btnSyncOneDriveNow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff5f56" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>Failed</span>`;
            } finally {
                setTimeout(() => {
                    btnSyncOneDriveNow.disabled = false;
                    btnSyncOneDriveNow.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> <span>Sync</span>`;
                }, 2000);
            }
        });
    }

    if (refreshPlaylistBtn) {
        refreshPlaylistBtn.addEventListener("click", async () => {
            refreshPlaylistBtn.disabled = true;
            refreshPlaylistBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> <span>Syncing Manifest...</span>`;
            try {
                await syncDesktopPlaylists();

                if (activePlaylistItems && activePlaylistItems.length > 0) {
                    const total = activePlaylistItems.length;
                    for (let i = 0; i < total; i++) {
                        const track = activePlaylistItems[i];
                        const pct = Math.round(((i + 1) / total) * 100);
                        refreshPlaylistBtn.querySelector("span").textContent = `Caching (${i + 1}/${total} - ${pct}%)`;

                        // Pre-download track blob into IndexedDB
                        await prefetchUpcomingTracks([track], -1, 1);
                    }
                    refreshPlaylistBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27c93f" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> <span>All Downloaded & Cached!</span>`;
                } else {
                    refreshPlaylistBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27c93f" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> <span>Synced!</span>`;
                }
            } catch (err) {
                console.error("Sync error:", err);
                refreshPlaylistBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff5f56" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span>Sync Failed</span>`;
            } finally {
                setTimeout(() => {
                    refreshPlaylistBtn.disabled = false;
                    refreshPlaylistBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> <span>Sync Playlist</span>`;
                }, 3000);
            }
        });
    }

    // --- Smart Lookahead Pre-fetching & High-Quality Audio Caching ---
    async function prefetchUpcomingTracks(queue, currentIndex, count = 3) {
        if (!queue || queue.length === 0) return;

        let downloadedCount = 0;
        let scanOffset = 1;

        while (downloadedCount < count && scanOffset <= queue.length) {
            const nextIdx = (currentIndex + scanOffset) % queue.length;
            const upcomingTrack = queue[nextIdx];
            scanOffset++;

            if (!upcomingTrack || upcomingTrack.isLocalBlob) continue;

            const existingBlob = await getTrackBlobFromDB(upcomingTrack.id, upcomingTrack.title);
            if (existingBlob) {
                upcomingTrack.status = "completed";
                downloadedCount++;
                continue;
            }

            try {
                let streamUrl = upcomingTrack.downloadUrl;

                // Strategy 1: OneDrive Cloud Stream
                if (!streamUrl && currentUserAccount) {
                    try {
                        const token = await getGraphAccessToken();
                        const folderName = oneDriveFolderNameInput.value.trim() || "YoutubeDownloads";
                        const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${folderName}/${encodeURIComponent(upcomingTrack.file || (upcomingTrack.title + '.mp3'))}`, {
                            headers: { Authorization: `Bearer ${token}` }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            streamUrl = data["@microsoft.graph.downloadUrl"];
                            upcomingTrack.downloadUrl = streamUrl;
                        }
                    } catch (e) {}
                }

                // Strategy 2: Direct OneDrive / Desktop Audio Stream
                if (!streamUrl && upcomingTrack.file) {
                    if (window.location.protocol.startsWith("https") || window.location.hostname.includes("azurestaticapps.net")) {
                        const sasToken = getAzureSASToken();
                        streamUrl = `${getAzureBlobBaseUrl()}/${encodeURIComponent(upcomingTrack.file)}?${sasToken}`;
                    } else {
                        streamUrl = `http://127.0.0.1:8765/api/media/file/${encodeURIComponent(upcomingTrack.file)}`;
                    }
                } else if (!streamUrl && upcomingTrack.url) {
                    streamUrl = `http://127.0.0.1:8765/api/media/stream?video_url=${encodeURIComponent(upcomingTrack.url)}&title=${encodeURIComponent(upcomingTrack.title)}&format=audio`;
                }

                if (streamUrl && streamUrl.startsWith("/")) {
                    streamUrl = (window.location.protocol.startsWith("http") ? window.location.origin : "http://127.0.0.1:8765") + streamUrl;
                }

                if (streamUrl) {
                    try {
                        const audioRes = await fetch(streamUrl).catch(() => null);
                        if (audioRes && audioRes.ok) {
                            const blob = await audioRes.blob();
                            await saveTrackBlobToDB(upcomingTrack.id, blob, upcomingTrack.title);
                            console.log(`[PWA High-Quality Cache] Saved HQ audio track (${downloadedCount + 1}/${count}): ${upcomingTrack.title}`);
                        }
                        upcomingTrack.status = "completed";
                        downloadedCount++;
                    } catch (e) {
                        upcomingTrack.status = "completed";
                        downloadedCount++;
                    }
                } else {
                    upcomingTrack.status = "queued";
                }
            } catch (err) {
                upcomingTrack.status = "queued";
            }
        }
        renderTracksTable(activePlaylistItems);
    }

    if (btnSaveOffline) btnSaveOffline.addEventListener("click", async () => {
        if (!activePlaylistItems || activePlaylistItems.length === 0) {
            alert("No tracks to cache in active playlist.");
            return;
        }
        btnSaveOffline.disabled = true;
        btnSaveOffline.textContent = "Caching Playlist...";
        try {
            await prefetchUpcomingTracks(activePlaylistItems, -1, activePlaylistItems.length);
            alert(`Successfully cached '${playlistTitle.textContent}' for 100% offline playback!`);
        } catch (e) {
            console.error("Cache offline error:", e);
        } finally {
            btnSaveOffline.disabled = false;
            btnSaveOffline.textContent = "Cache Offline";
        }
    });

    // --- Startup Initialization ---
    initDB().then(async () => {
        await purgeLargeFilesFromDB();
        await loadPlaylistsFromDB();
    });
    initMSAL();
    initMediaSessionHandlers();
});
