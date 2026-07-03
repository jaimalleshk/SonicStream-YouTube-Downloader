document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements - Settings & Search
    const urlInput = document.getElementById("urlInput");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const analyzeSpinner = document.getElementById("analyzeSpinner");
    const urlError = document.getElementById("urlError");
    const downloadDirInput = document.getElementById("downloadDirInput");
    const browseDirBtn = document.getElementById("browseDirBtn");
    const openFolderBtn = document.getElementById("openFolderBtn");

    // DOM Elements - Left Sidebar Playlist Explorer
    const tabPinned = document.getElementById("tabPinned");
    const tabAll = document.getElementById("tabAll");
    const tabTrash = document.getElementById("tabTrash");
    const playlistListContainer = document.getElementById("playlistListContainer");
    const sidebarPrevBtn = document.getElementById("sidebarPrevBtn");
    const sidebarPageInfo = document.getElementById("sidebarPageInfo");
    const sidebarNextBtn = document.getElementById("sidebarNextBtn");
    const btnCreateManual = document.getElementById("btnCreateManual");

    // DOM Elements - Right Playlist Items Grid
    const playlistTitle = document.getElementById("playlistTitle");
    const playlistMetaInfo = document.getElementById("playlistMetaInfo");
    const refreshPlaylistBtn = document.getElementById("refreshPlaylistBtn");
    const selectAllBtn = document.getElementById("selectAllBtn");
    const deselectAllBtn = document.getElementById("deselectAllBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const playlistSearch = document.getElementById("playlistSearch");
    const statusFilter = document.getElementById("statusFilter");
    const playlistTableBody = document.getElementById("playlistTableBody");
    const headerCheckbox = document.getElementById("headerCheckbox");
    const btnPrevPage = document.getElementById("btnPrevPage");
    const btnNextPage = document.getElementById("btnNextPage");
    const pageIndicator = document.getElementById("pageIndicator");

    // DOM Elements - Universal Media Player Controls
    const playerVideo = document.getElementById("playerVideo");
    const playerAudioArtPanel = document.getElementById("playerAudioArtPanel");
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
    const playerPrevBtn = document.getElementById("playerPrevBtn");
    const playerNextBtn = document.getElementById("playerNextBtn");
    const playerShuffleBtn = document.getElementById("playerShuffleBtn");
    const playerRepeatBtn = document.getElementById("playerRepeatBtn");
    const playerVolumeBtn = document.getElementById("playerVolumeBtn");
    const playerVolumeSlider = document.getElementById("playerVolumeSlider");
    const playerMaximizeBtn = document.getElementById("playerMaximizeBtn");

    // HUD and Terminal Console
    const gridHud = document.getElementById("gridHud");
    const hudJobTitle = document.getElementById("hudJobTitle");
    const hudCurrentFile = document.getElementById("hudCurrentFile");
    const hudSpeed = document.getElementById("hudSpeed");
    const hudEta = document.getElementById("hudEta");
    const hudProgressCount = document.getElementById("hudProgressCount");
    const consoleLogs = document.getElementById("consoleLogs");

    // State Variables
    let historyJobs = [];
    let currentPlaylistId = null;
    let playlistItems = [];
    let localItemStates = {}; // Map of item.id -> { status, percentage, speed, start_time, end_time, error_detail }
    let selectedItemIds = new Set();
    
    // Playback state variables
    let playQueue = [];
    let currentTrackIndex = -1;
    let isPlaying = false;
    let isShuffle = false;
    let isRepeat = false;
    let isMuted = false;
    let lastVolume = 80;
    let isMaximized = false;
    let currentEventSource = null;
    let nextTrackTimeout = null;
    let nextTrackCountdownInterval = null;

    // Sidebar & Items Pagination
    let sidebarTab = "all"; // Pinned, All, or Trash
    let sidebarPage = 1;
    const sidebarPageSize = 5;
    let currentPage = 1;
    const pageSize = 50;

    // Helper: format duration
    function formatDuration(seconds) {
        if (!seconds) return "--:--";
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) {
            return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Helper: show/hide errors
    function showError(msg) {
        urlError.textContent = msg;
        urlError.classList.remove("hidden");
    }
    function hideError() {
        urlError.classList.add("hidden");
    }

    // Terminal Logging
    function logToTerminal(msg, isError = false) {
        const p = document.createElement("p");
        p.textContent = msg;
        if (isError) {
            p.style.color = "var(--error)";
        }
        consoleLogs.appendChild(p);
        consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }

    // Load jobs history and populate left sidebar explorer
    async function loadSidebar() {
        try {
            const res = await fetch("/api/history");
            historyJobs = await res.json();
            
            // Auto select first active playlist if none active
            if (historyJobs.length > 0 && !currentPlaylistId) {
                const active = historyJobs.find(job => !job.deleted && !job.is_virtual && job.is_playlist !== false);
                if (active) {
                    selectPlaylist(active);
                }
            }
            
            renderSidebarList();
        } catch (e) {
            console.error("Failed to load history list:", e);
        }
    }

    // Fallback fetching helper for older history items without pre-extracted tracks
    async function fetchPlaylistTracksFallback(job) {
        try {
            const res = await fetch("/api/fetch-info", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: job.url })
            });
            if (res.ok) {
                const data = await res.json();
                const fetchedItems = data.entries || [];
                
                // Save to backend
                await fetch(`/api/history/${job.id}/items`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ items: fetchedItems })
                });
                
                // Update local job object
                job.items = fetchedItems.map(item => ({
                    id: item.id,
                    title: item.title,
                    uploader: item.uploader || "Unknown",
                    duration: item.duration || 0,
                    thumbnail: item.thumbnail,
                    url: item.url,
                    status: "queued",
                    percentage: 0.0,
                    speed: "--",
                    start_time: "--",
                    end_time: "--",
                    error_detail: ""
                }));
                job.total_tracks = fetchedItems.length;
                return job.items;
            }
        } catch (e) {
            console.error("Failed fallback fetch:", e);
        }
        return [];
    }

    function renderSidebarList() {
        playlistListContainer.innerHTML = "";
        
        let filtered = [];
        if (sidebarTab === "pinned") {
            filtered = historyJobs.filter(job => job.pinned && !job.deleted && job.id !== "deleted_tracks");
        } else if (sidebarTab === "all") {
            // Show all downloads virtual entry at index 0, followed by non-deleted items
            filtered = historyJobs.filter(job => !job.deleted && job.id !== "deleted_tracks");
        } else if (sidebarTab === "trash") {
            // Show deleted tracks virtual entry at index 0, followed by deleted items
            const trashPlaylists = historyJobs.filter(job => job.deleted);
            const deletedTracks = historyJobs.find(job => job.id === "deleted_tracks");
            filtered = deletedTracks ? [deletedTracks].concat(trashPlaylists) : trashPlaylists;
        }
        
        // Pagination logic
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / sidebarPageSize));
        if (sidebarPage > totalPages) sidebarPage = totalPages;
        if (sidebarPage < 1) sidebarPage = 1;
        
        const start = (sidebarPage - 1) * sidebarPageSize;
        const end = Math.min(start + sidebarPageSize, total);
        const pageItems = filtered.slice(start, end);
        
        sidebarPageInfo.textContent = `Page ${sidebarPage} of ${totalPages}`;
        sidebarPrevBtn.disabled = sidebarPage <= 1;
        sidebarNextBtn.disabled = sidebarPage >= totalPages;
        
        if (pageItems.length === 0) {
            playlistListContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 1.5rem 0;">No playlists found.</div>`;
            return;
        }
        
        pageItems.forEach(job => {
            const row = document.createElement("div");
            row.className = `sidebar-row ${currentPlaylistId === job.id ? 'active' : ''}`;
            
            const totalTracks = job.total_tracks || 0;
            const completed = job.success_count || 0;
            const percent = totalTracks > 0 ? Math.round((completed / totalTracks) * 100) : 0;
            const isPinned = job.pinned || false;
            const isVirtual = job.is_virtual || false;
            
            if (sidebarTab === "trash") {
                // Trash Tab controls (Restore / Delete permanently)
                row.innerHTML = `
                    <div class="sidebar-row-header">
                        <div class="sidebar-row-title" title="${job.title}">${job.title}</div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
                        <span style="font-size: 0.65rem; color: var(--text-muted);">${totalTracks} tracks</span>
                        <div class="sidebar-row-controls" style="display: flex; gap: 0.5rem; align-items: center;">
                            ${job.id !== "deleted_tracks" ? `
                            <button class="sidebar-row-btn restore-sidebar-btn" title="Restore Playlist">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
                            </button>
                            ` : ''}
                            <button class="sidebar-row-btn perm-delete-sidebar-btn" title="Delete Permanently" style="color: var(--error);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                        </div>
                    </div>
                `;
                
                row.addEventListener("click", (e) => {
                    if (e.target.closest("button")) return;
                    selectPlaylist(job);
                });
                
                if (job.id !== "deleted_tracks") {
                    row.querySelector(".restore-sidebar-btn").addEventListener("click", async (e) => {
                        e.stopPropagation();
                        try {
                            const res = await fetch(`/api/history/${job.id}/restore`, { method: "POST" });
                            if (res.ok) {
                                logToTerminal(`[System] Restored playlist "${job.title}".`);
                                await loadSidebar();
                            }
                        } catch (err) {
                            console.error("Restore failed:", err);
                        }
                    });
                }
                
                row.querySelector(".perm-delete-sidebar-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const warning = job.id === "deleted_tracks" 
                        ? "Are you sure you want to empty the deleted tracks list?" 
                        : `Are you sure you want to delete "${job.title}" permanently? This cannot be undone.`;
                    
                    if (!confirm(warning)) return;
                    
                    try {
                        const res = await fetch(`/api/history/${job.id}`, { method: "DELETE" });
                        if (res.ok) {
                            logToTerminal(`[System] Deleted "${job.title}" permanently.`);
                            if (currentPlaylistId === job.id) {
                                currentPlaylistId = null;
                                playlistItems = [];
                                playlistTitle.textContent = "No Playlist Selected";
                                playlistMetaInfo.textContent = "Select a playlist from the left explorer.";
                                playlistTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No items active.</td></tr>`;
                            }
                            await loadSidebar();
                        }
                    } catch (err) {
                        console.error("Permanent delete failed:", err);
                    }
                });
                
            } else {
                // Active Tabs (Pinned or All)
                row.innerHTML = `
                    <div class="sidebar-row-header">
                        <div class="sidebar-row-title" title="${job.title}">${job.title}</div>
                        ${!isVirtual ? `<span style="font-size: 0.65rem; color: var(--text-muted); font-weight: bold; flex-shrink: 0;">${percent}%</span>` : ''}
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
                        <span style="font-size: 0.65rem; color: var(--text-muted);">${completed}/${totalTracks} tracks</span>
                        <div class="sidebar-row-controls" style="display: flex; gap: 0.5rem; align-items: center;">
                            <button class="sidebar-row-btn play-sidebar-btn" title="Play Playlist">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </button>
                            <button class="sidebar-row-btn shuffle-sidebar-btn" title="Shuffle Play">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20l17-17M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
                            </button>
                            <button class="sidebar-row-btn resume-sidebar-btn" title="Resume Last Played">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                            </button>
                            ${!isVirtual ? `
                            <button class="sidebar-row-btn pin-sidebar-btn ${isPinned ? 'pinned-active' : ''}" title="${isPinned ? 'Unpin' : 'Pin'}">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                            </button>
                            <button class="sidebar-row-btn delete-sidebar-btn" title="Move to Trash" style="color: var(--error);">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                            ` : ''}
                        </div>
                    </div>
                    ${!isVirtual ? `
                    <div class="sidebar-row-progress-container" style="margin-top: 0.35rem;">
                        <div class="sidebar-row-progress-bar" style="width: ${percent}%;"></div>
                    </div>
                    ` : ''}
                `;
                
                row.addEventListener("click", (e) => {
                    if (e.target.closest("button")) return;
                    selectPlaylist(job);
                });
                
                row.querySelector(".play-sidebar-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await selectPlaylist(job);
                    let tracks = playQueue.filter(t => isTrackDownloaded(t));
                    if (tracks.length > 0) {
                        playTrack(tracks[0], playQueue, playQueue.findIndex(t => t.id === tracks[0].id));
                    } else {
                        alert("No downloaded tracks found in this playlist to play.");
                    }
                });
                
                row.querySelector(".shuffle-sidebar-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await selectPlaylist(job);
                    let tracks = playQueue.filter(t => isTrackDownloaded(t));
                    if (tracks.length > 0) {
                        isShuffle = true;
                        playerShuffleBtn.classList.add("active");
                        const rand = Math.floor(Math.random() * tracks.length);
                        const origIndex = playQueue.findIndex(t => t.id === tracks[rand].id);
                        playTrack(tracks[rand], playQueue, origIndex);
                    } else {
                        alert("No downloaded tracks found in this playlist to shuffle.");
                    }
                });

                row.querySelector(".resume-sidebar-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await selectPlaylist(job);
                    let tracks = playlistItems;
                    
                    if (tracks.length > 0) {
                        const lastPlayedId = job.last_played_track_id;
                        const lastPlayedShuffle = job.last_played_shuffle || false;
                        const savedShuffleOrder = job.shuffle_order || [];
                        const savedShuffleIndex = job.shuffle_index !== undefined ? job.shuffle_index : -1;
                        
                        let targetTrack = null;
                        let targetQueue = tracks;
                        let targetIndex = 0;
                        
                        if (lastPlayedId) {
                            targetTrack = tracks.find(t => t.id === lastPlayedId);
                        }
                        if (!targetTrack || !isTrackDownloaded(targetTrack)) {
                            const downloaded = tracks.filter(t => isTrackDownloaded(t));
                            targetTrack = downloaded.length > 0 ? downloaded[0] : null;
                        }
                        
                        if (!targetTrack) {
                            alert("No downloaded tracks available in this playlist to resume.");
                            return;
                        }
                        
                        if (lastPlayedShuffle && savedShuffleOrder.length > 0) {
                            isShuffle = true;
                            playerShuffleBtn.classList.add("active");
                            const orderedQueue = savedShuffleOrder.map(id => tracks.find(t => t.id === id)).filter(Boolean);
                            if (orderedQueue.length > 0) {
                                targetQueue = orderedQueue;
                                targetIndex = savedShuffleIndex >= 0 ? savedShuffleIndex : targetQueue.findIndex(t => t.id === targetTrack.id);
                            }
                        } else {
                            isShuffle = false;
                            playerShuffleBtn.classList.remove("active");
                            targetQueue = tracks;
                            targetIndex = targetQueue.findIndex(t => t.id === targetTrack.id);
                        }
                        
                        playTrack(targetTrack, targetQueue, targetIndex);
                    }
                });
                
                if (!isVirtual) {
                    row.querySelector(".pin-sidebar-btn").addEventListener("click", async (e) => {
                        e.stopPropagation();
                        try {
                            const res = await fetch(`/api/history/${job.id}/pin`, { method: "POST" });
                            if (res.ok) {
                                const data = await res.json();
                                job.pinned = data.pinned;
                                loadSidebar();
                            }
                        } catch (err) {
                            console.error("Failed to pin job:", err);
                        }
                    });

                    row.querySelector(".delete-sidebar-btn").addEventListener("click", async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Are you sure you want to move "${job.title}" to the trash bin?`)) return;
                        try {
                            const res = await fetch(`/api/history/${job.id}`, { method: "DELETE" });
                            if (res.ok) {
                                logToTerminal(`[System] Soft-deleted "${job.title}". Moved to Trash.`);
                                if (currentPlaylistId === job.id) {
                                    currentPlaylistId = null;
                                    playlistItems = [];
                                    playlistTitle.textContent = "No Playlist Selected";
                                    playlistMetaInfo.textContent = "Select a playlist from the left explorer.";
                                    playlistTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No items active.</td></tr>`;
                                }
                                await loadSidebar();
                            }
                        } catch (err) {
                            console.error("Soft delete failed:", err);
                        }
                    });
                }
            }
            
            playlistListContainer.appendChild(row);
        });
    }

    async function selectPlaylist(job) {
        currentPlaylistId = job.id;
        playlistTitle.textContent = job.title;
        urlInput.value = job.url || "";
        
        localItemStates = {};
        selectedItemIds.clear();
        
        if ((!job.items || job.items.length === 0) && job.url && !job.is_virtual) {
            playlistMetaInfo.textContent = "Loading items from YouTube...";
            playlistTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">Fetching track list...</td></tr>`;
            
            const fetched = await fetchPlaylistTracksFallback(job);
            if (fetched && fetched.length > 0) {
                playlistItems = fetched;
            } else {
                playlistItems = [];
                playlistTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--error); padding: 2rem;">Failed to fetch tracks.</td></tr>`;
                playlistMetaInfo.textContent = "Fetch failed.";
                return;
            }
        } else {
            playlistItems = job.items || [];
        }
        
        playlistMetaInfo.textContent = `${job.total_tracks} tracks | format: ${job.format || "audio"} | quality: ${job.quality || "highest"}`;
        
        playlistItems.forEach(item => {
            localItemStates[item.id] = {
                status: item.status || "queued",
                percentage: item.percentage || 0.0,
                speed: item.speed || "--",
                start_time: item.start_time || "--",
                end_time: item.end_time || "--",
                error_detail: item.error_detail || ""
            };
            selectedItemIds.add(item.id);
        });
        
        playQueue = playlistItems;
        currentTrackIndex = 0;
        
        currentPage = 1;
        renderPlaylistTable(playlistItems);
        updateSelectionMeta();
        renderSidebarList();

        // Auto-resume pending downloads (only for real, non-virtual playlists)
        if (!job.is_virtual && job.url) {
            const hasPending = playlistItems.some(item => {
                const status = localItemStates[item.id].status;
                return status === "queued" || status === "downloading" || status === "error" || status === "failed";
            });
            
            if (hasPending) {
                logToTerminal(`[System] Auto-resuming pending downloads for "${job.title}"...`);
                autoResumePlaylist(job.id);
            }
        }
    }

    async function autoResumePlaylist(jobId) {
        try {
            const res = await fetch("/api/history/resume", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ job_id: jobId, force_all: false })
            });
            if (res.ok) {
                const resData = await res.json();
                logToTerminal(`[System] Resumed pending queue successfully.`);
                hudJobTitle.textContent = `Active Job: #${resData.job_num} - ${resData.title}`;
                gridHud.classList.remove("hidden");
                startProgressStream();
            }
        } catch (e) {
            console.error("Auto-resume failed:", e);
        }
    }

    // Paging listeners for explorer sidebar
    sidebarPrevBtn.addEventListener("click", () => {
        if (sidebarPage > 1) {
            sidebarPage--;
            renderSidebarList();
        }
    });
    sidebarNextBtn.addEventListener("click", () => {
        let count = 0;
        if (sidebarTab === "pinned") count = historyJobs.filter(j => j.pinned && !j.deleted && j.id !== "deleted_tracks").length;
        else if (sidebarTab === "all") count = historyJobs.filter(j => !j.deleted && j.id !== "deleted_tracks").length;
        else if (sidebarTab === "trash") count = historyJobs.filter(j => j.deleted || j.id === "deleted_tracks").length;
        
        const totalPages = Math.ceil(count / sidebarPageSize);
        if (sidebarPage < totalPages) {
            sidebarPage++;
            renderSidebarList();
        }
    });

    // Sidebar tab selection
    tabPinned.addEventListener("click", () => {
        sidebarTab = "pinned";
        tabPinned.classList.add("active");
        tabAll.classList.remove("active");
        tabTrash.classList.remove("active");
        sidebarPage = 1;
        renderSidebarList();
    });
    tabAll.addEventListener("click", () => {
        sidebarTab = "all";
        tabAll.classList.add("active");
        tabPinned.classList.remove("active");
        tabTrash.classList.remove("active");
        sidebarPage = 1;
        renderSidebarList();
    });
    tabTrash.addEventListener("click", () => {
        sidebarTab = "trash";
        tabTrash.classList.add("active");
        tabPinned.classList.remove("active");
        tabAll.classList.remove("active");
        sidebarPage = 1;
        renderSidebarList();
    });
    // Create Manual Playlist button handler
    btnCreateManual.addEventListener("click", async () => {
        const option = confirm("Click OK to Import files from folder, or Cancel to Create an Empty Playlist.");
        if (option) {
            // Import folder
            try {
                const browseRes = await fetch("/api/settings/browse-folder", { method: "POST" });
                const browseData = await browseRes.json();
                if (browseData.folder_path) {
                    const title = prompt("Enter playlist title:");
                    if (!title || !title.trim()) return;
                    
                    const res = await fetch("/api/playlists/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: title.trim(), folder_path: browseData.folder_path })
                    });
                    
                    if (res.ok) {
                        const newPlaylist = await res.json();
                        logToTerminal(`[System] Imported local folder to playlist "${newPlaylist.title}".`);
                        await loadSidebar();
                        selectPlaylist(newPlaylist);
                    } else {
                        const errData = await res.json();
                        alert(`Import failed: ${errData.detail}`);
                    }
                }
            } catch (err) {
                console.error("Browse folder failed:", err);
            }
        } else {
            // Empty manual playlist
            const title = prompt("Enter playlist title:");
            if (!title || !title.trim()) return;
            
            try {
                const res = await fetch("/api/playlists/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: title.trim() })
                });
                if (res.ok) {
                    const newPlaylist = await res.json();
                    logToTerminal(`[System] Created manual playlist "${newPlaylist.title}".`);
                    await loadSidebar();
                    selectPlaylist(newPlaylist);
                }
            } catch (err) {
                console.error("Create manual playlist failed:", err);
            }
        }
    });

    // Sync/Refresh Playlist button handler
    refreshPlaylistBtn.addEventListener("click", async () => {
        if (!currentPlaylistId || currentPlaylistId === "all_downloads" || currentPlaylistId === "deleted_tracks") {
            alert("Please select a real YouTube playlist to sync.");
            return;
        }
        
        refreshPlaylistBtn.disabled = true;
        refreshPlaylistBtn.textContent = "Syncing...";
        logToTerminal(`[System] Fetching latest playlist uploads from YouTube...`);
        
        try {
            const res = await fetch(`/api/history/${currentPlaylistId}/refresh`, { method: "POST" });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Refresh failed");
            }
            
            const resData = await res.json();
            if (resData.new_count > 0) {
                logToTerminal(`[System] Sync completed! Found ${resData.new_count} new tracks.`);
                hudJobTitle.textContent = `Active Job: #${resData.job_num} - Delta Sync`;
                gridHud.classList.remove("hidden");
                
                await loadSidebar();
                startProgressStream();
            } else {
                logToTerminal(`[System] Playlist is already up to date. No new uploads detected.`);
                alert("Playlist is already up to date.");
            }
        } catch (err) {
            logToTerminal(`[Error] Refresh failed: ${err.message}`, true);
            alert(`Refresh failed: ${err.message}`);
        } finally {
            refreshPlaylistBtn.disabled = false;
            refreshPlaylistBtn.textContent = "Sync YouTube";
        }
    });

    // Render track rows in the Items Grid
    function renderPlaylistTable(items) {
        playlistTableBody.innerHTML = "";
        
        const query = playlistSearch.value.toLowerCase().trim();
        const status = statusFilter.value;
        
        const filteredItems = items.filter(item => {
            const title = item.title.toLowerCase();
            const channel = item.uploader.toLowerCase();
            const state = localItemStates[item.id] || { status: "queued" };
            const itemStatus = state.status || "queued";
            
            const matchesText = title.includes(query) || channel.includes(query);
            const matchesStatus = (status === "all") || (itemStatus === status);
            return matchesText && matchesStatus;
        });

        const totalFiltered = filteredItems.length;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
        
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        
        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageItems = filteredItems.slice(startIdx, endIdx);

        if (totalFiltered === 0) {
            playlistTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No items active.</td></tr>`;
            pageIndicator.textContent = "Page 1 of 1";
            btnPrevPage.disabled = true;
            btnNextPage.disabled = true;
            return;
        }

        pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
        btnPrevPage.disabled = currentPage === 1;
        btnNextPage.disabled = currentPage === totalPages;

        let allChecked = true;
        pageItems.forEach(item => {
            if (!selectedItemIds.has(item.id)) allChecked = false;
        });
        headerCheckbox.checked = allChecked && pageItems.length > 0;

        pageItems.forEach((item, idx) => {
            const state = localItemStates[item.id] || {
                status: "queued",
                percentage: 0.0,
                speed: "--",
                start_time: "--",
                end_time: "--",
                error_detail: ""
            };

            const row = document.createElement("tr");
            row.className = "playlist-row";
            row.setAttribute("data-id", item.id);
            
            const isPlayable = (state.status === "completed" || state.status === "skipped");
            if (isPlayable) {
                row.classList.add("playable");
            }
            
            const isChecked = selectedItemIds.has(item.id);
            const displayStatus = state.status === "skipped" ? "Downloaded" : state.status;
            
            // Conditional action buttons rendering
            let actionButtons = "";
            if (currentPlaylistId === "deleted_tracks") {
                // Restore / Permanent Delete for deleted tracks
                actionButtons = `
                    <button class="row-restore-btn" style="background: transparent; border: none; color: var(--text-primary); cursor: pointer; padding: 2px;" title="Restore to Playlist">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
                    </button>
                    <button class="row-perm-delete-btn" style="background: transparent; border: none; color: var(--error); cursor: pointer; padding: 2px;" title="Delete Permanently">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </button>
                `;
            } else {
                // Play controls + Playlist management tools
                actionButtons = `
                    <button class="row-play-btn" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px;" title="Play Track">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                    <button class="row-play-from-here-btn" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px;" title="Play From Here">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                    </button>
                    <button class="row-add-playlist-btn" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px;" title="Add to Playlist">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    ${currentPlaylistId !== "all_downloads" ? `
                    <button class="row-delete-btn" style="background: transparent; border: none; color: var(--error); cursor: pointer; padding: 2px;" title="Remove from Playlist">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                    ` : ''}
                `;
            }

            row.innerHTML = `
                <td><input type="checkbox" class="video-checkbox" ${isChecked ? 'checked' : ''} data-id="${item.id}"></td>
                <td style="font-weight: bold; color: var(--text-muted);">${startIdx + idx + 1}</td>
                <td class="thumb-cell"><img src="${item.thumbnail || 'https://i.ytimg.com/vi/default/hqdefault.jpg'}" alt="Thumb" style="width: 40px; height: 30px; object-fit: cover; border-radius: 4px;"></td>
                <td class="title-cell" title="${item.title}" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${item.title}</td>
                <td style="text-align: center;">
                    <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center;">
                        ${actionButtons}
                    </div>
                </td>
                <td style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">${item.uploader}</td>
                <td>${formatDuration(item.duration)}</td>
                <td class="status-cell">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-primary); text-transform: capitalize;" id="status-text-${item.id}">
                            ${displayStatus} (${state.percentage}%)
                        </span>
                        <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden;">
                            <div id="fill-${item.id}" style="width: ${state.percentage}%; height: 100%; background: var(--neon-blue); transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                </td>
            `;
            
            // Checkbox event binding
            row.querySelector(".video-checkbox").addEventListener("change", (e) => {
                if (e.target.checked) {
                    selectedItemIds.add(item.id);
                } else {
                    selectedItemIds.delete(item.id);
                }
                updateSelectionMeta();
                
                let allCheckedNow = true;
                pageItems.forEach(pi => {
                    if (!selectedItemIds.has(pi.id)) allCheckedNow = false;
                });
                headerCheckbox.checked = allCheckedNow;
            });

            if (currentPlaylistId === "deleted_tracks") {
                // Deleted Tracks action listeners
                row.querySelector(".row-restore-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    try {
                        const res = await fetch(`/api/history/deleted-tracks/${item.id}/restore`, { method: "POST" });
                        if (res.ok) {
                            logToTerminal(`[System] Restored "${item.title}" to its original playlist.`);
                            await loadSidebar();
                            // Refresh currently active Deleted Tracks view
                            const delTracks = historyJobs.find(j => j.id === "deleted_tracks");
                            if (delTracks) selectPlaylist(delTracks);
                        } else {
                            const errData = await res.json();
                            alert(`Restore failed: ${errData.detail}`);
                        }
                    } catch (err) {
                        console.error("Restore failed:", err);
                    }
                });

                row.querySelector(".row-perm-delete-btn").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Are you sure you want to delete "${item.title}" permanently from trash?`)) return;
                    try {
                        const res = await fetch(`/api/history/deleted-tracks/${item.id}/permanent`, { method: "DELETE" });
                        if (res.ok) {
                            logToTerminal(`[System] Deleted "${item.title}" permanently.`);
                            await loadSidebar();
                            const delTracks = historyJobs.find(j => j.id === "deleted_tracks");
                            if (delTracks) selectPlaylist(delTracks);
                        }
                    } catch (err) {
                        console.error("Permanent delete failed:", err);
                    }
                });
            } else {
                // Active Playlists action listeners
                row.querySelector(".row-play-btn").addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (!isTrackDownloaded(item)) {
                        alert("This track is not downloaded yet.");
                        return;
                    }
                    const globalIndex = playlistItems.findIndex(t => t.id === item.id);
                    playTrack(item, playlistItems, globalIndex);
                });
                
                row.querySelector(".row-play-from-here-btn").addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (!isTrackDownloaded(item)) {
                        alert("This track is not downloaded yet.");
                        return;
                    }
                    const globalIndex = playlistItems.findIndex(t => t.id === item.id);
                    const subQueue = playlistItems.slice(globalIndex);
                    playTrack(item, subQueue, 0);
                });

                row.querySelector(".row-add-playlist-btn").addEventListener("click", (e) => {
                    e.stopPropagation();
                    showAddToPlaylistMenu(item, e.currentTarget);
                });

                if (currentPlaylistId !== "all_downloads") {
                    row.querySelector(".row-delete-btn").addEventListener("click", async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Remove "${item.title}" from this playlist?`)) return;
                        try {
                            const res = await fetch(`/api/history/${currentPlaylistId}/tracks/${item.id}`, { method: "DELETE" });
                            if (res.ok) {
                                logToTerminal(`[System] Moved "${item.title}" to trash.`);
                                await loadSidebar();
                                const updatedJob = historyJobs.find(j => j.id === currentPlaylistId);
                                if (updatedJob) selectPlaylist(updatedJob);
                            }
                        } catch (err) {
                            console.error("Soft track delete failed:", err);
                        }
                    });
                }
            }

            // Double click fallback
            if (isPlayable) {
                row.addEventListener("dblclick", () => {
                    playLocalFile(item.title);
                });
            }
            
            playlistTableBody.appendChild(row);
        });
    }

    // Floating add-to-playlist dropdown helper
    function showAddToPlaylistMenu(item, buttonElement) {
        const existing = document.getElementById("addToPlaylistMenu");
        if (existing) existing.remove();
        
        const menu = document.createElement("div");
        menu.id = "addToPlaylistMenu";
        menu.style.position = "absolute";
        menu.style.background = "var(--card-bg)";
        menu.style.border = "1px solid var(--border-color)";
        menu.style.borderRadius = "8px";
        menu.style.padding = "0.5rem 0";
        menu.style.boxShadow = "0 10px 25px rgba(0,0,0,0.5)";
        menu.style.zIndex = "99999";
        menu.style.fontSize = "0.75rem";
        menu.style.minWidth = "160px";
        menu.style.backdropFilter = "blur(12px)";
        
        // Filter out virtual / deleted entries
        const validPlaylists = historyJobs.filter(job => !job.is_virtual && job.id !== "deleted_tracks" && !job.deleted);
        
        validPlaylists.forEach(playlist => {
            const opt = document.createElement("div");
            opt.className = "menu-item";
            opt.style.padding = "0.35rem 1rem";
            opt.style.cursor = "pointer";
            opt.style.color = "var(--text-primary)";
            opt.style.transition = "background 0.2s";
            opt.textContent = playlist.title;
            
            opt.addEventListener("mouseover", () => {
                opt.style.background = "rgba(255, 255, 255, 0.05)";
            });
            opt.addEventListener("mouseout", () => {
                opt.style.background = "transparent";
            });
            
            opt.addEventListener("click", () => {
                menu.remove();
                addTrackToPlaylist(item, playlist);
            });
            
            menu.appendChild(opt);
        });
        
        if (validPlaylists.length > 0) {
            const sep = document.createElement("div");
            sep.style.borderTop = "1px solid var(--border-color)";
            sep.style.margin = "0.25rem 0";
            menu.appendChild(sep);
        }
        
        const createOpt = document.createElement("div");
        createOpt.className = "menu-item";
        createOpt.style.padding = "0.35rem 1rem";
        createOpt.style.cursor = "pointer";
        createOpt.style.color = "var(--neon-blue)";
        createOpt.style.fontWeight = "bold";
        createOpt.textContent = "+ Create New Playlist...";
        
        createOpt.addEventListener("mouseover", () => {
            createOpt.style.background = "rgba(0, 242, 254, 0.08)";
        });
        createOpt.addEventListener("mouseout", () => {
            createOpt.style.background = "transparent";
        });
        
        createOpt.addEventListener("click", () => {
            menu.remove();
            createNewPlaylistWithTrack(item);
        });
        
        menu.appendChild(createOpt);
        
        document.body.appendChild(menu);
        
        const rect = buttonElement.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        menu.style.top = `${rect.bottom + scrollTop}px`;
        menu.style.left = `${rect.left + scrollLeft}px`;
        
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== buttonElement) {
                menu.remove();
                document.removeEventListener("mousedown", closeHandler);
            }
        };
        document.addEventListener("mousedown", closeHandler);
    }

    async function addTrackToPlaylist(item, playlist) {
        const exists = playlist.items && playlist.items.some(t => t.id === item.id);
        if (exists) {
            if (!confirm(`"${item.title}" is already in playlist "${playlist.title}". Do you want to add it anyway?`)) {
                return;
            }
        }
        
        try {
            const res = await fetch(`/api/playlists/${playlist.id}/add-track`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(item)
            });
            if (res.ok) {
                logToTerminal(`[System] Added "${item.title}" to playlist "${playlist.title}".`);
                await loadSidebar();
                if (currentPlaylistId === playlist.id) {
                    const updatedJob = historyJobs.find(j => j.id === playlist.id);
                    if (updatedJob) selectPlaylist(updatedJob);
                }
            } else {
                const data = await res.json();
                alert(`Failed to add track: ${data.detail}`);
            }
        } catch (e) {
            console.error("Add track failed:", e);
        }
    }

    async function createNewPlaylistWithTrack(item) {
        const name = prompt("Enter name for the new playlist:");
        if (!name || !name.trim()) return;
        
        try {
            const res = await fetch("/api/playlists/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: name.trim() })
            });
            if (res.ok) {
                const newPlaylist = await res.json();
                logToTerminal(`[System] Created new playlist "${newPlaylist.title}".`);
                await addTrackToPlaylist(item, newPlaylist);
            }
        } catch (e) {
            console.error("Create playlist failed:", e);
        }
    }

    async function playLocalFile(title) {
        const format = document.querySelector('input[name="format"]:checked')?.value || "audio";
        const downloadDir = downloadDirInput.value.trim();
        try {
            const res = await fetch("/api/play-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, format, download_dir: downloadDir })
            });
            if (!res.ok) {
                const data = await res.json();
                alert(`Playback failed: ${data.detail}`);
            }
        } catch (e) {
            alert(`Playback failed: ${e.message}`);
        }
    }

    function isTrackDownloaded(track) {
        const state = localItemStates[track.id] || {};
        return state.status === "completed" || state.status === "skipped";
    }

    // Grid checkbox selection operations
    headerCheckbox.addEventListener("change", (e) => {
        const checked = e.target.checked;
        const query = playlistSearch.value.toLowerCase().trim();
        const status = statusFilter.value;
        
        const filtered = playlistItems.filter(item => {
            const title = item.title.toLowerCase();
            const channel = item.uploader.toLowerCase();
            const state = localItemStates[item.id] || { status: "queued" };
            const itemStatus = state.status || "queued";
            
            const matchesText = title.includes(query) || channel.includes(query);
            const matchesStatus = (status === "all") || (itemStatus === status);
            return matchesText && matchesStatus;
        });

        filtered.forEach(item => {
            if (checked) {
                selectedItemIds.add(item.id);
            } else {
                selectedItemIds.delete(item.id);
            }
        });

        renderPlaylistTable(playlistItems);
        updateSelectionMeta();
    });

    selectAllBtn.addEventListener("click", () => {
        playlistItems.forEach(item => selectedItemIds.add(item.id));
        headerCheckbox.checked = true;
        renderPlaylistTable(playlistItems);
        updateSelectionMeta();
    });

    deselectAllBtn.addEventListener("click", () => {
        selectedItemIds.clear();
        headerCheckbox.checked = false;
        renderPlaylistTable(playlistItems);
        updateSelectionMeta();
    });

    function updateSelectionMeta() {
        const selectedCountNum = selectedItemIds.size;
        document.getElementById("selectedCount").textContent = selectedCountNum;
        document.getElementById("totalCount").textContent = playlistItems.length;
        downloadBtn.disabled = selectedCountNum === 0 || currentPlaylistId === "all_downloads" || currentPlaylistId === "deleted_tracks";
    }

    // Grid Filters
    playlistSearch.addEventListener("input", () => {
        currentPage = 1;
        renderPlaylistTable(playlistItems);
    });
    statusFilter.addEventListener("change", () => {
        currentPage = 1;
        renderPlaylistTable(playlistItems);
    });

    btnPrevPage.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderPlaylistTable(playlistItems);
        }
    });
    btnNextPage.addEventListener("click", () => {
        const query = playlistSearch.value.toLowerCase().trim();
        const status = statusFilter.value;
        const filteredCount = playlistItems.filter(item => {
            const title = item.title.toLowerCase();
            const channel = item.uploader.toLowerCase();
            const state = localItemStates[item.id] || { status: "queued" };
            const itemStatus = state.status || "queued";
            const matchesText = title.includes(query) || channel.includes(query);
            const matchesStatus = (status === "all") || (itemStatus === status);
            return matchesText && matchesStatus;
        }).length;
        
        const totalPages = Math.ceil(filteredCount / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            renderPlaylistTable(playlistItems);
        }
    });

    // Start download action
    downloadBtn.addEventListener("click", async () => {
        const selected = playlistItems.filter(item => selectedItemIds.has(item.id));
        if (selected.length === 0) return;

        const format = document.querySelector('input[name="format"]:checked').value;
        const quality = document.querySelector('input[name="quality"]:checked').value;
        const downloadDir = downloadDirInput.value.trim();
        const playlistTitleVal = playlistTitle.textContent;
        const playlistUrlVal = urlInput.value.trim();

        gridHud.classList.remove("hidden");
        hudJobTitle.textContent = "Queueing download...";
        
        selected.forEach(item => {
            localItemStates[item.id] = {
                status: "queued",
                percentage: 0.0,
                speed: "--",
                start_time: "--",
                end_time: "--",
                error_detail: ""
            };
        });
        renderPlaylistTable(playlistItems);

        try {
            const res = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: selected,
                    format,
                    quality,
                    playlist_title: playlistTitleVal,
                    playlist_url: playlistUrlVal,
                    skip_duplicates: true,
                    download_dir: downloadDir
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Failed to queue download");
            }

            const resData = await res.json();
            hudJobTitle.textContent = `Active Job: #${resData.job_num} - ${playlistTitleVal}`;
            
            await loadSidebar();
            startProgressStream();
        } catch (err) {
            logToTerminal(`[System Error] ${err.message}`, true);
            hudJobTitle.textContent = `Error: ${err.message}`;
        }
    });

    // SSE progress subscription stream
    function startProgressStream() {
        if (currentEventSource) {
            currentEventSource.close();
        }

        currentEventSource = new EventSource("/api/progress");

        currentEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            gridHud.classList.remove("hidden");
            
            if (data.status === "downloading") {
                hudJobTitle.textContent = data.playlist_title || `Job #${data.active_job_num}`;
                if (hudCurrentFile) hudCurrentFile.textContent = `↳ ${data.current_title}`;
                hudSpeed.textContent = data.speed;
                hudEta.textContent = data.eta;
            } else if (data.status === "completed") {
                hudJobTitle.textContent = `Completed: ${data.playlist_title || 'Job #' + data.active_job_num}`;
                if (hudCurrentFile) hudCurrentFile.textContent = "";
                hudSpeed.textContent = "--";
                hudEta.textContent = "--";
                loadSidebar();
            } else if (data.status === "failed") {
                hudJobTitle.textContent = `Failed: ${data.playlist_title || 'Job #' + data.active_job_num}`;
                if (hudCurrentFile) hudCurrentFile.textContent = "";
                hudSpeed.textContent = "--";
                hudEta.textContent = "--";
            }

            if (data.item_states) {
                let completedCount = 0;
                const totalCount = Object.keys(data.item_states).length;
                let triggerRedraw = false;

                Object.keys(data.item_states).forEach(id => {
                    const itemState = data.item_states[id];
                    const oldState = localItemStates[id] || {};
                    const isDone = (itemState.status === "completed" || itemState.status === "skipped" || itemState.status === "error");
                    const wasDone = (oldState.status === "completed" || oldState.status === "skipped" || oldState.status === "error");

                    if (isDone && !wasDone) {
                        triggerRedraw = true;
                    }

                    localItemStates[id] = itemState;
                    if (isDone) completedCount++;

                    const statusText = document.getElementById(`status-text-${id}`);
                    const fill = document.getElementById(`fill-${id}`);
                    const displayStatusStr = itemState.status === "skipped" ? "Downloaded" : itemState.status;
                    if (statusText) statusText.textContent = `${displayStatusStr} (${itemState.percentage}%)`;
                    if (fill) fill.style.width = `${itemState.percentage}%`;
                });

                hudProgressCount.textContent = `${completedCount} / ${totalCount}`;
                if (triggerRedraw) {
                    renderPlaylistTable(playlistItems);
                }
            }

            if (data.logs && data.logs.length > 0) {
                consoleLogs.innerHTML = "";
                data.logs.forEach(log => {
                    const p = document.createElement("p");
                    p.textContent = log;
                    if (log.startsWith("[System Error]") || log.startsWith("Error")) {
                        p.style.color = "var(--error)";
                    } else if (log.startsWith("Finished downloading")) {
                        p.style.color = "var(--success)";
                    } else if (log.startsWith("[Duplicate Skipped]")) {
                        p.style.color = "#fbbf24";
                    }
                    consoleLogs.appendChild(p);
                });
                consoleLogs.scrollTop = consoleLogs.scrollHeight;
            }

            if (data.status === "completed" || data.status === "failed") {
                currentEventSource.close();
                currentEventSource = null;
            }
        };
    }

    function generateShuffleOrder(tracks, currentTrackId = null) {
        let downloadedTracks = tracks.filter(t => isTrackDownloaded(t));
        if (downloadedTracks.length === 0) return [];
        
        let ids = downloadedTracks.map(t => t.id);
        
        // Fisher-Yates shuffle
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        
        // If currentTrackId is specified, place it at index 0
        if (currentTrackId) {
            const idx = ids.indexOf(currentTrackId);
            if (idx > -1) {
                ids.splice(idx, 1);
                ids.unshift(currentTrackId);
            }
        }
        
        return ids;
    }

    // Media Player Control state machine
    async function playTrack(track, queue, index, shuffleIndex = null, shuffleOrder = null) {
        if (!track) return;
        
        if (nextTrackTimeout) {
            clearTimeout(nextTrackTimeout);
            nextTrackTimeout = null;
        }
        if (nextTrackCountdownInterval) {
            clearInterval(nextTrackCountdownInterval);
            nextTrackCountdownInterval = null;
        }
        
        playQueue = queue || [track];
        currentTrackIndex = index !== undefined ? index : playQueue.findIndex(t => t.id === track.id);
        
        playerTrackTitle.textContent = track.title;
        playerTrackArtist.textContent = track.uploader || "Unknown";
        playerTrackThumb.src = track.thumbnail || `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
        
        const format = document.querySelector('input[name="format"]:checked')?.value || "audio";
        const downloadDir = downloadDirInput.value.trim();
        
        if (format === "video") {
            playerVideo.style.display = "block";
            playerAudioArtPanel.style.display = "none";
        } else {
            playerVideo.style.display = "none";
            playerAudioArtPanel.style.display = "flex";
        }
        
        if (playerStatusEq) {
            playerStatusEq.style.visibility = "hidden";
            playerStatusEq.classList.remove("playing");
        }
        if (playerStatusText) playerStatusText.textContent = "Loading...";
        
        try {
            const streamUrl = `/api/media/stream?video_url=${encodeURIComponent(track.url)}&title=${encodeURIComponent(track.title)}&format=${format}&download_dir=${encodeURIComponent(downloadDir)}`;
            
            playerVideo.src = streamUrl;
            playerVideo.load();
            
            await playerVideo.play();
            isPlaying = true;
            updatePlayBtnUI();
            
            if (playerStatusEq) {
                playerStatusEq.style.visibility = "visible";
                playerStatusEq.classList.add("playing");
            }
            if (playerStatusText) playerStatusText.textContent = "Playing";

            savePlaybackPosition(track.id, shuffleIndex, shuffleOrder);
        } catch (err) {
            console.error("Playback failed:", err);
            if (playerStatusEq) {
                playerStatusEq.style.visibility = "hidden";
                playerStatusEq.classList.remove("playing");
            }
            if (playerStatusText) playerStatusText.textContent = "Error Playing File";
            isPlaying = false;
            updatePlayBtnUI();
        }
    }

    async function savePlaybackPosition(trackId, shuffleIndex = null, shuffleOrder = null) {
        if (!currentPlaylistId || currentPlaylistId === "all_downloads" || currentPlaylistId === "deleted_tracks") return;
        
        const job = historyJobs.find(j => j.id === currentPlaylistId) || {};
        
        let finalShuffleOrder = shuffleOrder;
        let finalShuffleIndex = shuffleIndex;
        
        if (isShuffle) {
            if (!finalShuffleOrder) {
                finalShuffleOrder = job.shuffle_order || [];
                if (finalShuffleOrder.length === 0 || !finalShuffleOrder.includes(trackId)) {
                    finalShuffleOrder = generateShuffleOrder(playQueue, trackId);
                    finalShuffleIndex = 0;
                } else {
                    finalShuffleIndex = finalShuffleOrder.indexOf(trackId);
                }
            }
        } else {
            finalShuffleOrder = null;
            finalShuffleIndex = null;
        }
        
        const payload = {
            track_id: trackId,
            shuffle_mode: isShuffle,
            shuffle_order: finalShuffleOrder,
            shuffle_index: finalShuffleIndex
        };
        
        try {
            await fetch(`/api/history/${currentPlaylistId}/last-played`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (job) {
                job.last_played_track_id = trackId;
                job.last_played_shuffle = isShuffle;
                job.shuffle_order = payload.shuffle_order;
                job.shuffle_index = payload.shuffle_index;
            }
        } catch (e) {
            console.error("Playback position save failed:", e);
        }
    }

    function updatePlayBtnUI() {
        const svg = document.getElementById("playIconSvg");
        if (isPlaying) {
            svg.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
        } else {
            svg.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
        }
    }

    // Media Player DOM Listeners
    playerPlayPauseBtn.addEventListener("click", () => {
        if (!playerVideo.src) return;
        if (isPlaying) {
            playerVideo.pause();
            isPlaying = false;
        } else {
            playerVideo.play();
            isPlaying = true;
        }
        updatePlayBtnUI();
    });

    playerNextBtn.addEventListener("click", playNextTrack);
    playerPrevBtn.addEventListener("click", playPrevTrack);

    function playNextTrack() {
        if (playQueue.length === 0) return;
        
        if (isShuffle) {
            const job = historyJobs.find(j => j.id === currentPlaylistId) || {};
            let order = job.shuffle_order || [];
            let sIdx = job.shuffle_index !== undefined ? job.shuffle_index : -1;
            
            if (order.length === 0) {
                const currentTrack = playQueue[currentTrackIndex];
                order = generateShuffleOrder(playQueue, currentTrack ? currentTrack.id : null);
                sIdx = 0;
            } else {
                sIdx++;
            }
            
            if (sIdx >= order.length) {
                sIdx = 0; // Loop around
            }
            
            const nextTrackId = order[sIdx];
            const nextTrack = playQueue.find(t => t.id === nextTrackId);
            
            if (nextTrack) {
                const origIndex = playQueue.findIndex(t => t.id === nextTrackId);
                playTrack(nextTrack, playQueue, origIndex, sIdx, order);
            } else {
                logToTerminal("[Player] Next track not found in shuffle queue.");
            }
        } else {
            let startIndex = currentTrackIndex;
            let nextIndex = currentTrackIndex;
            let found = false;
            
            for (let i = 1; i <= playQueue.length; i++) {
                nextIndex = (startIndex + i) % playQueue.length;
                if (isTrackDownloaded(playQueue[nextIndex])) {
                    found = true;
                    break;
                }
            }
            
            if (found) {
                playTrack(playQueue[nextIndex], playQueue, nextIndex);
            } else {
                logToTerminal("[Player] No downloaded tracks in queue to skip to.");
            }
        }
    }

    function playPrevTrack() {
        if (playQueue.length === 0) return;
        
        if (isShuffle) {
            const job = historyJobs.find(j => j.id === currentPlaylistId) || {};
            let order = job.shuffle_order || [];
            let sIdx = job.shuffle_index !== undefined ? job.shuffle_index : -1;
            
            if (order.length === 0) {
                const currentTrack = playQueue[currentTrackIndex];
                order = generateShuffleOrder(playQueue, currentTrack ? currentTrack.id : null);
                sIdx = 0;
            } else {
                sIdx--;
            }
            
            if (sIdx < 0) {
                sIdx = order.length - 1; // Loop back
            }
            
            const prevTrackId = order[sIdx];
            const prevTrack = playQueue.find(t => t.id === prevTrackId);
            
            if (prevTrack) {
                const origIndex = playQueue.findIndex(t => t.id === prevTrackId);
                playTrack(prevTrack, playQueue, origIndex, sIdx, order);
            } else {
                logToTerminal("[Player] Previous track not found in shuffle queue.");
            }
        } else {
            let startIndex = currentTrackIndex;
            let prevIndex = currentTrackIndex;
            let found = false;
            
            for (let i = 1; i <= playQueue.length; i++) {
                prevIndex = (startIndex - i + playQueue.length) % playQueue.length;
                if (isTrackDownloaded(playQueue[prevIndex])) {
                    found = true;
                    break;
                }
            }
            
            if (found) {
                playTrack(playQueue[prevIndex], playQueue, prevIndex);
            } else {
                logToTerminal("[Player] No downloaded tracks in queue to skip to.");
            }
        }
    }

    playerVideo.addEventListener("ended", () => {
        if (isRepeat) {
            playerVideo.currentTime = 0;
            playerVideo.play();
        } else {
            if (nextTrackTimeout) {
                clearTimeout(nextTrackTimeout);
                nextTrackTimeout = null;
            }
            if (nextTrackCountdownInterval) {
                clearInterval(nextTrackCountdownInterval);
                nextTrackCountdownInterval = null;
            }
            
            const pauseInput = document.getElementById("playerPauseSeconds");
            const pauseSecs = pauseInput ? parseInt(pauseInput.value) : 5;
            
            if (pauseSecs > 0) {
                let count = pauseSecs;
                if (playerStatusEq) {
                    playerStatusEq.style.visibility = "hidden";
                    playerStatusEq.classList.remove("playing");
                }
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
                    if (nextTrackCountdownInterval) {
                        clearInterval(nextTrackCountdownInterval);
                        nextTrackCountdownInterval = null;
                    }
                    playNextTrack();
                }, pauseSecs * 1000);
            } else {
                playNextTrack();
            }
        }
    });

    // Time progress trackers
    playerVideo.addEventListener("timeupdate", () => {
        if (playerVideo.duration) {
            const current = playerVideo.currentTime;
            const duration = playerVideo.duration;
            playerProgressBar.value = (current / duration) * 100;
            playerCurrentTime.textContent = formatDuration(current);
            playerTotalTime.textContent = formatDuration(duration);
        }
    });

    playerProgressBar.addEventListener("input", (e) => {
        if (playerVideo.duration) {
            playerVideo.currentTime = (e.target.value / 100) * playerVideo.duration;
        }
    });

    playerShuffleBtn.addEventListener("click", () => {
        isShuffle = !isShuffle;
        playerShuffleBtn.classList.toggle("active", isShuffle);
        
        const job = historyJobs.find(j => j.id === currentPlaylistId);
        if (isShuffle) {
            const currentTrack = playQueue[currentTrackIndex];
            const order = generateShuffleOrder(playQueue, currentTrack ? currentTrack.id : null);
            if (job) {
                job.shuffle_order = order;
                job.shuffle_index = 0;
            }
            if (currentTrack) {
                savePlaybackPosition(currentTrack.id, 0, order);
            }
        } else {
            if (job) {
                job.shuffle_order = null;
                job.shuffle_index = null;
            }
            const currentTrack = playQueue[currentTrackIndex];
            if (currentTrack) {
                savePlaybackPosition(currentTrack.id, null, null);
            }
        }
    });

    playerRepeatBtn.addEventListener("click", () => {
        isRepeat = !isRepeat;
        playerRepeatBtn.classList.toggle("active", isRepeat);
    });

    // Volume controllers
    playerVolumeSlider.addEventListener("input", (e) => {
        playerVideo.volume = e.target.value / 100;
        isMuted = (playerVideo.volume === 0);
    });

    playerVolumeBtn.addEventListener("click", () => {
        isMuted = !isMuted;
        if (isMuted) {
            lastVolume = playerVolumeSlider.value;
            playerVideo.volume = 0;
            playerVolumeSlider.value = 0;
            playerVolumeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v6a3 3 0 0 0 3 3h3.58l4.42 4.42V12M22 9.42A9 9 0 0 0 9.42 22"/></svg>`;
        } else {
            playerVideo.volume = lastVolume / 100;
            playerVolumeSlider.value = lastVolume;
            playerVolumeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
        }
    });

    // Maximize Video toggle overlay (YouTube style overlay controls)
    let fullscreenTimeout = null;
    const playerControlsContainer = document.getElementById("playerControlsContainer");
    
    playerMaximizeBtn.addEventListener("click", () => {
        isMaximized = !isMaximized;
        if (isMaximized) {
            playerControlsContainer.classList.add("maximized");
            playerMaximizeBtn.title = "Minimize Player";
            playerMaximizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></svg>`;
            
            setupFullscreenAutoHide();
        } else {
            playerControlsContainer.classList.remove("maximized");
            playerControlsContainer.classList.remove("idle");
            playerMaximizeBtn.title = "Maximize Player";
            playerMaximizeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
            
            if (fullscreenTimeout) {
                clearTimeout(fullscreenTimeout);
                fullscreenTimeout = null;
            }
        }
    });

    function setupFullscreenAutoHide() {
        if (fullscreenTimeout) clearTimeout(fullscreenTimeout);
        playerControlsContainer.addEventListener("mousemove", handleFullscreenMouseMove);
    }

    function handleFullscreenMouseMove() {
        if (!isMaximized) {
            playerControlsContainer.removeEventListener("mousemove", handleFullscreenMouseMove);
            return;
        }
        
        playerControlsContainer.classList.remove("idle");
        clearTimeout(fullscreenTimeout);
        
        fullscreenTimeout = setTimeout(() => {
            if (isMaximized && isPlaying) {
                playerControlsContainer.classList.add("idle");
            }
        }, 3000);
    }

    // Column resizing handles injection helper
    function initResizableColumns() {
        const table = document.querySelector(".playlist-table-wrapper table");
        if (!table) return;
        
        const row = table.querySelector("thead tr");
        const cols = row ? row.children : [];
        
        for (let i = 0; i < cols.length; i++) {
            if (i < 2) continue; // Don't resize checkbox and index columns
            
            let resizer = cols[i].querySelector(".col-resizer");
            if (!resizer) {
                resizer = document.createElement("div");
                resizer.className = "col-resizer";
                cols[i].appendChild(resizer);
                cols[i].style.position = "relative";
                setupResizerEvents(resizer, cols[i]);
            }
        }
    }

    function setupResizerEvents(resizer, col) {
        let x = 0;
        let w = 0;
        
        const mouseMoveHandler = (e) => {
            const dx = e.clientX - x;
            const newWidth = Math.max(45, w + dx);
            col.style.width = `${newWidth}px`;
            col.style.minWidth = `${newWidth}px`;
            col.style.maxWidth = `${newWidth}px`;
        };
        
        const mouseUpHandler = () => {
            document.removeEventListener("mousemove", mouseMoveHandler);
            document.removeEventListener("mouseup", mouseUpHandler);
            resizer.classList.remove("resizing");
        };
        
        resizer.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            x = e.clientX;
            const styles = window.getComputedStyle(col);
            w = parseInt(styles.width, 10);
            
            resizer.classList.add("resizing");
            document.addEventListener("mousemove", mouseMoveHandler);
            document.addEventListener("mouseup", mouseUpHandler);
        });
    }

    // Analyze YouTube link input
    analyzeBtn.addEventListener("click", analyzeLink);
    urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") analyzeLink();
    });

    async function analyzeLink() {
        const url = urlInput.value.trim();
        if (!url) {
            showError("Please paste a valid YouTube video or playlist URL first.");
            return;
        }

        hideError();
        analyzeBtn.disabled = true;
        analyzeSpinner.classList.remove("hidden");
        logToTerminal(`[System] Fetching playlist metadata from YouTube...`);

        try {
            const res = await fetch("/api/fetch-info", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Link extraction failed.");
            }

            const data = await res.json();
            playlistItems = data.entries || [];
            playlistTitle.textContent = data.title || "YouTube Playlist";
            playlistMetaInfo.textContent = `${playlistItems.length} tracks fetched from YouTube. Selection ready.`;

            localItemStates = {};
            selectedItemIds.clear();
            currentPage = 1;

            playlistItems.forEach(item => {
                localItemStates[item.id] = {
                    status: "queued",
                    percentage: 0.0,
                    speed: "--",
                    start_time: "--",
                    end_time: "--",
                    error_detail: ""
                };
                selectedItemIds.add(item.id);
            });

            playQueue = playlistItems;
            currentTrackIndex = 0;

            renderPlaylistTable(playlistItems);
            updateSelectionMeta();
            logToTerminal(`[System] Metadata extraction complete. Selected ${playlistItems.length} items.`);

        } catch (err) {
            showError(err.message);
            logToTerminal(`[Error] Metadata extraction failed: ${err.message}`, true);
        } finally {
            analyzeBtn.disabled = false;
            analyzeSpinner.classList.add("hidden");
        }
    }

    // Default download directory config load
    async function loadDefaultDir() {
        try {
            const res = await fetch("/api/settings/dir");
            const data = await res.json();
            downloadDirInput.value = data.download_dir;
        } catch (e) {
            console.error("Failed to load default download dir settings:", e);
        }
    }

    browseDirBtn.addEventListener("click", async () => {
        try {
            const res = await fetch("/api/settings/browse", { method: "POST" });
            const data = await res.json();
            if (data.download_dir) {
                downloadDirInput.value = data.download_dir;
            }
        } catch (e) {
            console.error("Directory browse error:", e);
        }
    });

    openFolderBtn.addEventListener("click", async () => {
        const downloadDir = downloadDirInput.value.trim();
        try {
            const res = await fetch("/api/open-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ download_dir: downloadDir })
            });
            if (!res.ok) {
                const data = await res.json();
                alert(`Error opening folder: ${data.detail}`);
            }
        } catch (e) {
            alert(`Error opening folder: ${e.message}`);
        }
    });

    // YouTube player keyboard shortcuts listener
    document.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
            return;
        }

        let handled = false;
        const key = e.key.toLowerCase();
        
        switch (key) {
            case " ":
            case "k":
                playerPlayPauseBtn.click();
                handled = true;
                break;
            case "j":
                if (playerVideo.duration) {
                    playerVideo.currentTime = Math.max(0, playerVideo.currentTime - 10);
                }
                handled = true;
                break;
            case "l":
                if (playerVideo.duration) {
                    playerVideo.currentTime = Math.min(playerVideo.duration, playerVideo.currentTime + 10);
                }
                handled = true;
                break;
            case "arrowleft":
                if (playerVideo.duration) {
                    playerVideo.currentTime = Math.max(0, playerVideo.currentTime - 5);
                }
                handled = true;
                break;
            case "arrowright":
                if (playerVideo.duration) {
                    playerVideo.currentTime = Math.min(playerVideo.duration, playerVideo.currentTime + 5);
                }
                handled = true;
                break;
            case "arrowup":
                playerVolumeSlider.value = Math.min(100, parseInt(playerVolumeSlider.value) + 5);
                playerVolumeSlider.dispatchEvent(new Event("input"));
                handled = true;
                break;
            case "arrowdown":
                playerVolumeSlider.value = Math.max(0, parseInt(playerVolumeSlider.value) - 5);
                playerVolumeSlider.dispatchEvent(new Event("input"));
                handled = true;
                break;
            case "m":
                playerVolumeBtn.click();
                handled = true;
                break;
            case "f":
                playerMaximizeBtn.click();
                handled = true;
                break;
            case "n":
                if (e.shiftKey) {
                    playNextTrack();
                    handled = true;
                }
                break;
            case "p":
                if (e.shiftKey) {
                    playPrevTrack();
                    handled = true;
                }
                break;
        }

        if (e.key >= "0" && e.key <= "9") {
            if (playerVideo.duration) {
                const pct = parseInt(e.key) * 10;
                playerVideo.currentTime = (pct / 100) * playerVideo.duration;
                handled = true;
            }
        }

        if (handled) {
            e.preventDefault();
        }
    });

    // Start-up initialization
    loadDefaultDir();
    loadSidebar();
    initResizableColumns();

    // Settings Modal Triggers
    const btnOpenSettings = document.getElementById("btnOpenSettings");
    const settingsModal = document.getElementById("settingsModal");
    const btnCloseSettings = document.getElementById("btnCloseSettings");
    const btnSaveSettings = document.getElementById("btnSaveSettings");
    
    if (btnOpenSettings && settingsModal) {
        btnOpenSettings.addEventListener("click", () => {
            settingsModal.classList.remove("hidden");
            shadowInputFix();
            checkYtdlpVersion();
        });
    }
    
    if (btnCloseSettings && settingsModal) {
        btnCloseSettings.addEventListener("click", () => {
            settingsModal.classList.add("hidden");
        });
    }
    
    if (btnSaveSettings && settingsModal) {
        btnSaveSettings.addEventListener("click", () => {
            settingsModal.classList.add("hidden");
            logToTerminal("[System] Settings saved and applied successfully.");
        });
    }

    // --- Wi-Fi Sync (iPhone) settings section ---
    const syncEnabledToggle = document.getElementById("syncEnabledToggle");
    const syncPortInput = document.getElementById("syncPortInput");
    const syncAddressText = document.getElementById("syncAddressText");
    const syncTokenText = document.getElementById("syncTokenText");
    const btnCopySyncToken = document.getElementById("btnCopySyncToken");
    const btnRotateSyncToken = document.getElementById("btnRotateSyncToken");
    const btnExportManifest = document.getElementById("btnExportManifest");
    const syncManifestStatus = document.getElementById("syncManifestStatus");
    const syncRestartNote = document.getElementById("syncRestartNote");
    const syncCookiesInput = document.getElementById("syncCookiesInput");

    function renderSyncConfig(cfg) {
        if (!syncEnabledToggle) return;
        syncEnabledToggle.checked = !!cfg.enabled;
        syncPortInput.value = cfg.port || 8765;
        syncTokenText.textContent = cfg.token || "—";
        syncTokenText.title = cfg.token || "";
        const ip = (cfg.lan_ips && cfg.lan_ips[0]) || null;
        syncAddressText.textContent = cfg.enabled && ip ? `http://${ip}:${cfg.port}` : (cfg.enabled ? "no network detected" : "disabled");
        syncRestartNote.classList.toggle("hidden", !cfg.restart_required);
        if (syncCookiesInput) {
            syncCookiesInput.value = cfg.cookies_from_browser || "none";
        }
    }

    async function loadSyncConfig() {
        try {
            const res = await fetch("/api/sync/config");
            if (res.ok) renderSyncConfig(await res.json());
        } catch (e) { /* section stays inert if unavailable */ }
    }

    async function saveSyncConfig() {
        if (!syncEnabledToggle) return;
        try {
            const cookies_from_browser = syncCookiesInput ? syncCookiesInput.value : "none";
            const res = await fetch("/api/sync/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: syncEnabledToggle.checked,
                    port: parseInt(syncPortInput.value, 10) || 8765,
                    cookies_from_browser: cookies_from_browser
                })
            });
            if (res.ok) {
                const cfg = await res.json();
                renderSyncConfig(cfg);
                if (cfg.restart_required) {
                    logToTerminal("[Wi-Fi Sync] Setting saved — restart SonicStream to apply.");
                }
            }
        } catch (e) {
            logToTerminal("[Wi-Fi Sync] Failed to save settings: " + e.message);
        }
    }

    if (btnOpenSettings) btnOpenSettings.addEventListener("click", loadSyncConfig);
    if (btnSaveSettings) btnSaveSettings.addEventListener("click", saveSyncConfig);
    if (syncEnabledToggle) syncEnabledToggle.addEventListener("change", saveSyncConfig);
    if (syncCookiesInput) syncCookiesInput.addEventListener("change", saveSyncConfig);

    if (btnCopySyncToken) {
        btnCopySyncToken.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(syncTokenText.textContent || "");
                btnCopySyncToken.textContent = "Copied!";
                setTimeout(() => { btnCopySyncToken.textContent = "Copy"; }, 1500);
            } catch (e) { /* clipboard unavailable in some webview contexts */ }
        });
    }

    if (btnRotateSyncToken) {
        btnRotateSyncToken.addEventListener("click", async () => {
            if (!confirm("Generate a new pairing token? The iPhone app will need to be re-paired.")) return;
            try {
                const res = await fetch("/api/sync/rotate-token", { method: "POST" });
                if (res.ok) {
                    renderSyncConfig(await res.json());
                    logToTerminal("[Wi-Fi Sync] Pairing token rotated — update the iPhone app.");
                }
            } catch (e) { /* ignore */ }
        });
    }

    if (btnExportManifest) {
        btnExportManifest.addEventListener("click", async () => {
            syncManifestStatus.textContent = "Exporting…";
            try {
                const res = await fetch("/api/sync/export-manifest", { method: "POST" });
                if (res.ok) {
                    const data = await res.json();
                    syncManifestStatus.textContent = `Exported ${data.playlists} playlist(s)`;
                    logToTerminal("[Wi-Fi Sync] Manifest exported to " + data.path);
                } else {
                    syncManifestStatus.textContent = "Export failed";
                }
            } catch (e) {
                syncManifestStatus.textContent = "Export failed";
            }
        });
    }

    // yt-dlp version check and update
    async function checkYtdlpVersion() {
        const currentEl = document.getElementById("ytdlpCurrentVersion");
        const latestEl = document.getElementById("ytdlpLatestVersion");
        const statusEl = document.getElementById("ytdlpStatusText");
        const updateBtn = document.getElementById("btnUpdateYtdlp");
        
        currentEl.textContent = "Checking...";
        latestEl.textContent = "Checking...";
        statusEl.style.color = "var(--text-muted)";
        statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align: middle; margin-right: 4px; animation: spin 0.8s infinite linear;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Checking...`;
        updateBtn.classList.add("hidden");
        
        try {
            const res = await fetch("/api/ytdlp-version");
            const data = await res.json();
            
            currentEl.textContent = data.current_version;
            latestEl.textContent = data.latest_version;
            
            if (data.update_available) {
                statusEl.style.color = "#ffbd2e";
                statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align: middle; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Update available!`;
                latestEl.style.color = "#ffbd2e";
                updateBtn.classList.remove("hidden");
            } else {
                statusEl.style.color = "#27c93f";
                statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align: middle; margin-right: 4px;"><polyline points="20 6 9 17 4 12"/></svg> Up to date`;
                latestEl.style.color = "#27c93f";
                updateBtn.classList.add("hidden");
            }
        } catch (e) {
            currentEl.textContent = "Error";
            latestEl.textContent = "Error";
            statusEl.style.color = "var(--error)";
            statusEl.textContent = "Failed to check version";
        }
    }
    
    document.getElementById("btnUpdateYtdlp")?.addEventListener("click", async () => {
        const updateBtn = document.getElementById("btnUpdateYtdlp");
        const statusEl = document.getElementById("ytdlpStatusText");
        
        updateBtn.disabled = true;
        updateBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 0.8s infinite linear;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Updating...`;
        statusEl.style.color = "var(--neon-blue)";
        statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align: middle; margin-right: 4px; animation: spin 0.8s infinite linear;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Upgrading yt-dlp...`;
        logToTerminal("[System] Upgrading yt-dlp to latest version...");
        
        try {
            const res = await fetch("/api/ytdlp-update", { method: "POST" });
            const data = await res.json();
            
            if (data.success) {
                statusEl.style.color = "#27c93f";
                statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align: middle; margin-right: 4px;"><polyline points="20 6 9 17 4 12"/></svg> Updated! Restart app to apply.`;
                updateBtn.classList.add("hidden");
                logToTerminal(`[System] yt-dlp upgraded successfully. ${data.message}`);
            } else {
                statusEl.style.color = "var(--error)";
                statusEl.textContent = "Upgrade failed";
                logToTerminal(`[Error] yt-dlp upgrade failed: ${data.message}`, true);
                updateBtn.disabled = false;
                updateBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Retry`;
            }
        } catch (e) {
            statusEl.style.color = "var(--error)";
            statusEl.textContent = "Network error during upgrade";
            logToTerminal(`[Error] yt-dlp upgrade failed: ${e.message}`, true);
            updateBtn.disabled = false;
            updateBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Retry`;
        }
    });

    // Setup active states on startup radios
    function shadowInputFix() {
        const formatBtn = document.querySelector('input[name="format"]:checked')?.closest(".header-pill-btn");
        if (formatBtn) formatBtn.classList.add("active");
        const qualityBtn = document.querySelector('input[name="quality"]:checked')?.closest(".header-pill-btn");
        if (qualityBtn) qualityBtn.classList.add("active");
    }
    
    // Format selection change listener for auto quality selection
    const formatRadios = document.querySelectorAll('input[name="format"]');
    formatRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            document.querySelectorAll('input[name="format"]').forEach(r => {
                r.closest(".header-pill-btn")?.classList.remove("active");
            });
            if (e.target.checked) {
                e.target.closest(".header-pill-btn")?.classList.add("active");
                if (e.target.value === "audio") {
                    const highestRadio = document.querySelector('input[name="quality"][value="highest"]');
                    if (highestRadio && !highestRadio.checked) {
                        highestRadio.checked = true;
                        highestRadio.dispatchEvent(new Event("change"));
                    }
                }
            }
        });
    });

    const qualityRadios = document.querySelectorAll('input[name="quality"]');
    qualityRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            document.querySelectorAll('input[name="quality"]').forEach(r => {
                r.closest(".header-pill-btn")?.classList.remove("active");
            });
            if (e.target.checked) {
                e.target.closest(".header-pill-btn")?.classList.add("active");
            }
        });
    });

    shadowInputFix();
});
