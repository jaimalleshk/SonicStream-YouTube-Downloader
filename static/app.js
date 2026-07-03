document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const urlInput = document.getElementById("urlInput");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const analyzeSpinner = document.getElementById("analyzeSpinner");
    const urlError = document.getElementById("urlError");
    
    const playlistSection = document.getElementById("playlistSection");
    const playlistTitle = document.getElementById("playlistTitle");
    const playlistMeta = document.getElementById("playlistMeta");
    const playlistSearch = document.getElementById("playlistSearch");
    const statusFilter = document.getElementById("statusFilter");
    const playlistTableBody = document.getElementById("playlistTableBody");
    const headerCheckbox = document.getElementById("headerCheckbox");
    
    const selectAllBtn = document.getElementById("selectAllBtn");
    const deselectAllBtn = document.getElementById("deselectAllBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const skipDuplicatesCheckbox = document.getElementById("skipDuplicatesCheckbox");
    
    const gridHud = document.getElementById("gridHud");
    const hudJobTitle = document.getElementById("hudJobTitle");
    const hudSpeed = document.getElementById("hudSpeed");
    const hudEta = document.getElementById("hudEta");
    const hudProgressCount = document.getElementById("hudProgressCount");
    const consoleLogs = document.getElementById("consoleLogs");
    
    const openFolderBtn = document.getElementById("openFolderBtn");

    // Download Folder selector elements
    const downloadDirInput = document.getElementById("downloadDirInput");
    const browseDirBtn = document.getElementById("browseDirBtn");

    // History elements
    const historyBtn = document.getElementById("historyBtn");
    const historyModal = document.getElementById("historyModal");
    const closeHistoryModalBtn = document.getElementById("closeHistoryModalBtn");
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    const historyTableBody = document.getElementById("historyTableBody");
    const historySearch = document.getElementById("historySearch");
    const historyTypeFilter = document.getElementById("historyTypeFilter");

    // Pagination elements
    const btnFirstPage = document.getElementById("btnFirstPage");
    const btnPrevPage = document.getElementById("btnPrevPage");
    const btnNextPage = document.getElementById("btnNextPage");
    const btnLastPage = document.getElementById("btnLastPage");
    const pageIndicator = document.getElementById("pageIndicator");
    const paginationRange = document.getElementById("paginationRange");
    const paginationTotal = document.getElementById("paginationTotal");

    // Global Caches for Interactive Grid Sorting & Live Sync
    let playlistItems = [];
    let localItemStates = {}; // Map of item.id -> { job_num, status, percentage, speed, start_time, end_time, error_detail }
    let currentEventSource = null;
    let currentSortCol = null;
    let sortAsc = true;
    let historyItemsCache = []; // Global history log cache for search filtering

    // Pagination State
    let currentPage = 1;
    const pageSize = 50;

    // Helper: format duration in seconds to MM:SS or H:MM:SS
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

    // Format Pill change listeners
    const formatRadios = document.querySelectorAll('input[name="format"]');
    formatRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            document.querySelectorAll('input[name="format"]').forEach(r => {
                r.closest(".header-pill-btn")?.classList.remove("active");
            });
            if (e.target.checked) {
                e.target.closest(".header-pill-btn")?.classList.add("active");
            }
            updateActiveQualityLabel();
        });
    });

    // Quality Pill change listeners
    const qualityRadios = document.querySelectorAll('input[name="quality"]');
    qualityRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            document.querySelectorAll('input[name="quality"]').forEach(r => {
                r.closest(".header-pill-btn")?.classList.remove("active");
            });
            if (e.target.checked) {
                e.target.closest(".header-pill-btn")?.classList.add("active");
            }
            updateActiveQualityLabel();
        });
    });

    // Ensure label click toggles radio
    document.querySelectorAll(".header-pill-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const radio = btn.querySelector('input[type="radio"]');
            if (radio && e.target !== radio && !radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change"));
            }
        });
    });

    function updateActiveQualityLabel() {
        const format = document.querySelector('input[name="format"]:checked')?.value || "audio";
        const quality = document.querySelector('input[name="quality"]:checked')?.value || "high";
        
        const formatText = format === "audio" ? "Audio (.mp3)" : "Video (.mp4)";
        
        let qualityText = "High";
        if (format === "audio") {
            const map = { low: "Low (64 kbps)", medium: "Medium (128 kbps)", high: "High (192 kbps)", highest: "Highest (320 kbps)" };
            qualityText = map[quality] || "High (192 kbps)";
        } else {
            const map = { low: "Low (360p)", medium: "Medium (480p)", high: "High (720p)", highest: "Highest (1080p)" };
            qualityText = map[quality] || "High (720p)";
        }
        
        const formatTextEl = document.getElementById("activeFormatText");
        const qualityTextEl = document.getElementById("activeQualityText");
        if (formatTextEl) formatTextEl.textContent = formatText;
        if (qualityTextEl) qualityTextEl.textContent = qualityText;

        // Dynamic size calculations based on selection formatting
        updateSelectionMeta();
    }

    // Load initial default directory path
    async function loadDefaultDir() {
        try {
            const res = await fetch("/api/settings/dir");
            const data = await res.json();
            if (data.download_dir) {
                downloadDirInput.value = data.download_dir;
                syncSavingToLabel();
            }
        } catch (e) {
            console.error("Error loading default directory:", e);
        }
    }
    loadDefaultDir();

    // Directory selector browse dialog mapping
    browseDirBtn.addEventListener("click", async () => {
        browseDirBtn.disabled = true;
        const oldText = browseDirBtn.textContent;
        browseDirBtn.textContent = "Browsing...";
        try {
            const res = await fetch("/api/settings/browse", { method: "POST" });
            const data = await res.json();
            if (data.download_dir) {
                downloadDirInput.value = data.download_dir;
                syncSavingToLabel();
            }
        } catch (e) {
            alert(`Failed to select folder: ${e.message}`);
        } finally {
            browseDirBtn.disabled = false;
            browseDirBtn.textContent = oldText;
        }
    });

    // Manual typing directory listener
    downloadDirInput.addEventListener("input", syncSavingToLabel);

    function syncSavingToLabel() {
        const path = downloadDirInput.value.trim() || "--";
        const lbl = document.getElementById("lblSavingTo");
        if (lbl) {
            lbl.textContent = `Saving to: ${path}`;
            lbl.title = path; // Tooltip shows full path
        }
    }

    // Analyze link
    analyzeBtn.addEventListener("click", analyzeLink);
    urlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            analyzeLink();
        }
    });

    async function analyzeLink() {
        const url = urlInput.value.trim();
        if (!url) {
            showError("Please enter a valid YouTube video or playlist URL");
            return;
        }

        // Reset UI
        hideError();
        analyzeSpinner.classList.remove("hidden");
        analyzeBtn.disabled = true;
        playlistSection.classList.add("hidden");
        playlistItems = [];
        localItemStates = {};
        currentPage = 1;

        try {
            const response = await fetch("/api/fetch-info", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || "Failed to parse YouTube link");
            }

            playlistItems = data.entries;
            playlistTitle.textContent = data.title;
            
            // Initialize local states cache
            playlistItems.forEach(item => {
                localItemStates[item.id] = {
                    job_num: "--",
                    status: "queued",
                    percentage: 0.0,
                    speed: "--",
                    start_time: "--",
                    end_time: "--",
                    error_detail: ""
                };
            });

            renderPlaylistTable(playlistItems);
            
            // Auto check all items by default
            headerCheckbox.checked = true;
            toggleAllCheckboxes(true);
            updateSelectionMeta();
            
            playlistSection.classList.remove("hidden");
            playlistSection.scrollIntoView({ behavior: "smooth" });

        } catch (err) {
            showError(err.message);
        } finally {
            analyzeSpinner.classList.add("hidden");
            analyzeBtn.disabled = false;
        }
    }

    function renderPlaylistTable(items) {
        playlistTableBody.innerHTML = "";
        
        // Sort items array: uncompleted items first, completed/skipped/error items last.
        items.sort((a, b) => {
            const stateA = localItemStates[a.id] || { status: "queued" };
            const stateB = localItemStates[b.id] || { status: "queued" };
            
            const isDoneA = (stateA.status === "completed" || stateA.status === "skipped" || stateA.status === "error");
            const isDoneB = (stateB.status === "completed" || stateB.status === "skipped" || stateB.status === "error");
            
            // Primary Sort: Active/Queued comes first, finished moves to bottom (last pages)
            if (isDoneA !== isDoneB) {
                return isDoneA ? 1 : -1;
            }
            
            // Secondary Sort: header sort
            if (currentSortCol) {
                let valA = "";
                let valB = "";
                
                if (currentSortCol === "title") {
                    valA = a.title || "";
                    valB = b.title || "";
                } else if (currentSortCol === "uploader") {
                    valA = a.uploader || "";
                    valB = b.uploader || "";
                } else if (currentSortCol === "duration") {
                    valA = a.duration || 0;
                    valB = b.duration || 0;
                } else {
                    if (currentSortCol === "job_num") {
                        valA = stateA.job_num || 0;
                        valB = stateB.job_num || 0;
                    } else if (currentSortCol === "status") {
                        valA = stateA.percentage || 0;
                        valB = stateB.percentage || 0;
                    } else if (currentSortCol === "speed") {
                        valA = parseFloat(stateA.speed) || 0;
                        valB = parseFloat(stateB.speed) || 0;
                    } else if (currentSortCol === "start_time") {
                        valA = stateA.start_time || "";
                        valB = stateB.start_time || "";
                    } else if (currentSortCol === "end_time") {
                        valA = stateA.end_time || "";
                        valB = stateB.end_time || "";
                    } else if (currentSortCol === "status_detail") {
                        valA = stateA.status || "";
                        valB = stateB.status || "";
                    } else if (currentSortCol === "error_detail") {
                        valA = stateA.error_detail || "";
                        valB = stateB.error_detail || "";
                    }
                }
                
                if (typeof valA === "string") {
                    return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
                } else {
                    return sortAsc ? (valA - valB) : (valB - valA);
                }
            }
            
            // Tertiary Sort: default index order
            return playlistItems.indexOf(a) - playlistItems.indexOf(b);
        });

        // Filter items
        const query = playlistSearch.value.toLowerCase().trim();
        const status = statusFilter.value;
        
        const filteredItems = items.filter(item => {
            const title = item.title.toLowerCase();
            const channel = item.uploader.toLowerCase();
            const state = localItemStates[item.id] || { status: "queued" };
            const itemStatus = state.status || "queued";
            
            const matchesText = title.includes(query) || channel.includes(query);
            
            let matchesStatus = false;
            if (status === "all") {
                matchesStatus = true;
            } else if (status === "queued" && itemStatus === "queued") {
                matchesStatus = true;
            } else if (status === "downloading" && itemStatus === "downloading") {
                matchesStatus = true;
            } else if (status === "completed" && itemStatus === "completed") {
                matchesStatus = true;
            } else if (status === "skipped" && itemStatus === "skipped") {
                matchesStatus = true;
            } else if (status === "error" && itemStatus === "error") {
                matchesStatus = true;
            }
            
            return matchesText && matchesStatus;
        });

        const totalFiltered = filteredItems.length;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
        
        // Boundaries checks
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        
        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const pageItems = filteredItems.slice(startIdx, endIdx);

        // Update Pagination Controls Info
        if (totalFiltered === 0) {
            playlistTableBody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted); padding: 2rem;">No videos found matching current filter.</td></tr>`;
            paginationRange.textContent = "0 - 0";
            paginationTotal.textContent = "0";
            pageIndicator.textContent = "Page 1 of 1";
            btnFirstPage.disabled = true;
            btnPrevPage.disabled = true;
            btnNextPage.disabled = true;
            btnLastPage.disabled = true;
            return;
        }

        paginationRange.textContent = `${startIdx + 1} - ${Math.min(endIdx, totalFiltered)}`;
        paginationTotal.textContent = totalFiltered;
        pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
        
        btnFirstPage.disabled = currentPage === 1;
        btnPrevPage.disabled = currentPage === 1;
        btnNextPage.disabled = currentPage === totalPages;
        btnLastPage.disabled = currentPage === totalPages;

        // Render pageItems rows
        pageItems.forEach(item => {
            const state = localItemStates[item.id] || {
                job_num: "--",
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
            
            const jobDisplay = state.job_num !== "--" ? `#${state.job_num}` : "--";
            const speedDisplay = state.speed !== "0 KB/s" ? state.speed : "--";
            
            const isPlayable = (state.status === "completed" || state.status === "skipped");
            if (isPlayable) {
                row.classList.add("playable");
            }
            const playIcon = isPlayable ? " ▶" : "";
            
            row.innerHTML = `
                <td><input type="checkbox" class="video-checkbox" checked data-id="${item.id}"></td>
                <td class="thumb-cell"><img src="${item.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120'}" alt="Thumb"></td>
                <td class="title-cell" title="${item.title}">${item.title}</td>
                <td class="channel-cell">${item.uploader}</td>
                <td class="duration-cell">${formatDuration(item.duration)}</td>
                <td class="job-cell" id="job-${item.id}">${jobDisplay}</td>
                <td class="status-cell" id="status-col-${item.id}">
                    <div class="cell-progress-container">
                        <span id="percent-val-${item.id}" style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono);">${state.percentage}%</span>
                        <div class="cell-progress-bar">
                            <div class="cell-progress-fill" id="fill-${item.id}" style="width: ${state.percentage}%;"></div>
                        </div>
                    </div>
                </td>
                <td class="speed-cell" id="speed-${item.id}">${speedDisplay}</td>
                <td class="time-cell" id="start-${item.id}">${state.start_time}</td>
                <td class="time-cell" id="end-${item.id}">${state.end_time}</td>
                <td><span class="status-detail-cell ${state.status}" id="status-detail-${item.id}" style="${isPlayable ? 'cursor: pointer;' : ''}" title="${isPlayable ? 'Click to Play' : ''}">${state.status}${playIcon}</span></td>
                <td class="error-detail-cell" id="error-${item.id}" title="${state.error_detail}">${state.error_detail || "--"}</td>
            `;
            
            row.querySelector(".video-checkbox").addEventListener("change", () => {
                updateSelectionMeta();
                const allChecked = Array.from(document.querySelectorAll(".video-checkbox")).every(c => c.checked);
                headerCheckbox.checked = allChecked;
            });

            // Bind Direct Playback shortcuts on completed tracks
            if (isPlayable) {
                row.addEventListener("dblclick", () => {
                    playLocalFile(item.title);
                });
                const badge = row.querySelector(".status-detail-cell");
                if (badge) {
                    badge.addEventListener("click", (e) => {
                        e.stopPropagation();
                        playLocalFile(item.title);
                    });
                }
            }
            
            playlistTableBody.appendChild(row);
        });
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

    // Toggle all checkboxes
    headerCheckbox.addEventListener("change", (e) => {
        toggleAllCheckboxes(e.target.checked);
        updateSelectionMeta();
    });

    function toggleAllCheckboxes(checked) {
        const checkboxes = document.querySelectorAll(".video-checkbox");
        checkboxes.forEach(cb => {
            const row = cb.closest("tr");
            if (row && row.style.display !== "none") {
                cb.checked = checked;
            }
        });
    }

    selectAllBtn.addEventListener("click", () => {
        toggleAllCheckboxes(true);
        headerCheckbox.checked = true;
        updateSelectionMeta();
    });

    deselectAllBtn.addEventListener("click", () => {
        toggleAllCheckboxes(false);
        headerCheckbox.checked = false;
        updateSelectionMeta();
    });

    function updateSelectionMeta() {
        const selected = getSelectedItems();
        const checkedCount = selected.length;
        
        if (checkedCount === 0) {
            playlistMeta.textContent = `0 of ${playlistItems.length} items selected`;
            downloadBtn.disabled = true;
            return;
        }

        // Sum durations
        const totalSeconds = selected.reduce((sum, item) => sum + (item.duration || 0), 0);
        
        // Sum file size estimations
        const format = document.querySelector('input[name="format"]:checked')?.value || "audio";
        const quality = document.querySelector('input[name="quality"]:checked')?.value || "high";
        
        let bytesPerSec = 0.024 * 1024 * 1024;
        if (format === "audio") {
            const rates = { low: 0.008, medium: 0.016, high: 0.024, highest: 0.04 };
            bytesPerSec = (rates[quality] || 0.024) * 1024 * 1024;
        } else {
            const rates = { low: 0.05, medium: 0.1, high: 0.2, highest: 0.4 };
            bytesPerSec = (rates[quality] || 0.2) * 1024 * 1024;
        }
        
        const estSizeBytes = totalSeconds * bytesPerSec;
        const estSizeMB = (estSizeBytes / (1024 * 1024)).toFixed(0);
        
        // Format duration
        let durationStr = "";
        const hrs = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = Math.floor(totalSeconds % 60);
        if (hrs > 0) {
            durationStr = `${hrs}h ${mins}m`;
        } else if (mins > 0) {
            durationStr = `${mins}m ${secs}s`;
        } else {
            durationStr = `${secs}s`;
        }

        playlistMeta.textContent = `${checkedCount} of ${playlistItems.length} items selected (${durationStr} | ~${estSizeMB} MB)`;
        downloadBtn.disabled = false;
    }

    function getSelectedItems() {
        const checkedCheckboxes = document.querySelectorAll(".video-checkbox:checked");
        const selectedIds = Array.from(checkedCheckboxes).map(cb => dataId => cb.getAttribute("data-id"));
        const actualIds = Array.from(checkedCheckboxes).map(cb => cb.getAttribute("data-id"));
        return playlistItems.filter(item => actualIds.includes(item.id));
    }

    // Interactive Sorting
    const sortHeaders = document.querySelectorAll("th.sortable");
    sortHeaders.forEach(th => {
        th.addEventListener("click", () => {
            const col = th.getAttribute("data-sort");
            if (currentSortCol === col) {
                sortAsc = !sortAsc;
            } else {
                currentSortCol = col;
                sortAsc = true;
            }
            
            sortHeaders.forEach(h => {
                h.classList.remove("asc", "desc");
            });
            th.classList.add(sortAsc ? "asc" : "desc");
            
            renderPlaylistTable(playlistItems);
        });
    });

    // Combined Filters: Search + Status dropdown (Resets to page 1)
    playlistSearch.addEventListener("input", () => {
        currentPage = 1;
        renderPlaylistTable(playlistItems);
    });
    statusFilter.addEventListener("change", () => {
        currentPage = 1;
        renderPlaylistTable(playlistItems);
    });

    // Pagination controls event binding
    btnFirstPage.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage = 1;
            renderPlaylistTable(playlistItems);
        }
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
        const filteredCount = getFilteredCount(playlistItems, query, status);
        const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
        if (currentPage < totalPages) {
            currentPage++;
            renderPlaylistTable(playlistItems);
        }
    });

    btnLastPage.addEventListener("click", () => {
        const query = playlistSearch.value.toLowerCase().trim();
        const status = statusFilter.value;
        const filteredCount = getFilteredCount(playlistItems, query, status);
        const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
        if (currentPage < totalPages) {
            currentPage = totalPages;
            renderPlaylistTable(playlistItems);
        }
    });

    function getFilteredCount(items, query, status) {
        return items.filter(item => {
            const title = item.title.toLowerCase();
            const channel = item.uploader.toLowerCase();
            const state = localItemStates[item.id] || { status: "queued" };
            const itemStatus = state.status || "queued";
            
            const matchesText = title.includes(query) || channel.includes(query);
            
            let matchesStatus = false;
            if (status === "all") {
                matchesStatus = true;
            } else if (status === "queued" && itemStatus === "queued") {
                matchesStatus = true;
            } else if (status === "downloading" && itemStatus === "downloading") {
                matchesStatus = true;
            } else if (status === "completed" && itemStatus === "completed") {
                matchesStatus = true;
            } else if (status === "skipped" && itemStatus === "skipped") {
                matchesStatus = true;
            } else if (status === "error" && itemStatus === "error") {
                matchesStatus = true;
            }
            return matchesText && matchesStatus;
        }).length;
    }

    // Start download process
    downloadBtn.addEventListener("click", async () => {
        const selected = getSelectedItems();
        if (selected.length === 0) return;

        const format = document.querySelector('input[name="format"]:checked').value;
        const quality = document.querySelector('input[name="quality"]:checked').value;
        const skipDuplicates = skipDuplicatesCheckbox.checked;
        const downloadDir = downloadDirInput.value.trim();
        
        const playlistTitleVal = playlistTitle.textContent;
        const playlistUrlVal = urlInput.value.trim();

        // Display Active HUD
        gridHud.classList.remove("hidden");
        hudJobTitle.textContent = "Queueing download...";
        
        // Reset local cached states for selection to queued status
        selected.forEach(item => {
            localItemStates[item.id] = {
                job_num: "--",
                status: "queued",
                percentage: 0.0,
                speed: "--",
                start_time: "--",
                end_time: "--",
                error_detail: ""
            };
        });
        
        // Force refresh grid states
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
                    skip_duplicates: skipDuplicates,
                    download_dir: downloadDir
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Failed to queue download job");
            }

            const resData = await res.json();
            hudJobTitle.textContent = `Active Job: #${resData.job_num} - ${playlistTitleVal}`;

            // Immediately start progress stream
            startProgressStream();

        } catch (err) {
            logToTerminal(`[System Error] ${err.message}`, true);
            hudJobTitle.textContent = `Error: ${err.message}`;
        }
    });

    function startProgressStream() {
        if (currentEventSource) {
            currentEventSource.close();
        }

        currentEventSource = new EventSource("/api/progress");

        currentEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            // Show HUD
            gridHud.classList.remove("hidden");
            
            if (data.status === "downloading") {
                hudJobTitle.textContent = `Active Job: #${data.active_job_num} - ${data.current_title}`;
                hudSpeed.textContent = data.speed;
                hudEta.textContent = data.eta;
            } else if (data.status === "completed") {
                hudJobTitle.textContent = `Completed Job #${data.active_job_num}`;
                hudSpeed.textContent = "--";
                hudEta.textContent = "--";
            } else if (data.status === "failed") {
                hudJobTitle.textContent = `Failed Job #${data.active_job_num}: ${data.error}`;
                hudSpeed.textContent = "--";
                hudEta.textContent = "--";
            }

            // Sync item states directly in DOM rows and local cache
            if (data.item_states) {
                let completedCount = 0;
                const totalCount = Object.keys(data.item_states).length;
                let triggerTableRedraw = false;

                Object.keys(data.item_states).forEach(id => {
                    const itemState = data.item_states[id];
                    const oldState = localItemStates[id] || {};
                    
                    const wasDone = (oldState.status === "completed" || oldState.status === "skipped" || oldState.status === "error");
                    const isDone = (itemState.status === "completed" || itemState.status === "skipped" || itemState.status === "error");

                    // Trigger pagination redraw to push done item to the last page!
                    if (isDone && !wasDone) {
                        triggerTableRedraw = true;
                    }

                    // Cache state
                    localItemStates[id] = itemState;
                    
                    // Increment overall progress completed count
                    if (isDone) {
                        completedCount++;
                    }

                    // Dynamically update elements inside table row for real-time responsiveness
                    const jobCell = document.getElementById(`job-${id}`);
                    const percentCell = document.getElementById(`percent-val-${id}`);
                    const fillCell = document.getElementById(`fill-${id}`);
                    const speedCell = document.getElementById(`speed-${id}`);
                    const startCell = document.getElementById(`start-${id}`);
                    const endCell = document.getElementById(`end-${id}`);
                    const detailCell = document.getElementById(`status-detail-${id}`);
                    const errorCell = document.getElementById('error-' + id);

                    if (jobCell) jobCell.textContent = itemState.job_num !== "--" ? `#${itemState.job_num}` : "--";
                    if (percentCell) percentCell.textContent = `${itemState.percentage}%`;
                    if (fillCell) fillCell.style.width = `${itemState.percentage}%`;
                    if (speedCell) speedCell.textContent = itemState.speed !== "0 KB/s" ? itemState.speed : "--";
                    if (startCell) startCell.textContent = itemState.start_time;
                    if (endCell) endCell.textContent = itemState.end_time;
                    if (detailCell) {
                        const isPlayable = (itemState.status === "completed" || itemState.status === "skipped");
                        const playIcon = isPlayable ? " ▶" : "";
                        detailCell.textContent = `${itemState.status}${playIcon}`;
                        detailCell.className = `status-detail-cell ${itemState.status}`;
                        detailCell.style.cursor = isPlayable ? 'pointer' : '';
                        detailCell.title = isPlayable ? 'Click to Play' : '';
                    }
                    if (errorCell) {
                        errorCell.textContent = itemState.error_detail || "--";
                        errorCell.title = itemState.error_detail || "";
                    }
                });

                hudProgressCount.textContent = `${completedCount} / ${totalCount} Completed (Pending: ${totalCount - completedCount})`;

                // If any item transitioned to completed/done, redraw the table to automatically move it to the last page!
                if (triggerTableRedraw) {
                    renderPlaylistTable(playlistItems);
                }
            }

            // Render logs
            if (data.logs && data.logs.length > 0) {
                consoleLogs.innerHTML = "";
                data.logs.forEach(log => {
                    const p = document.createElement("p");
                    p.textContent = log;
                    if (log.startsWith("[System Error]") || log.startsWith("Error") || log.startsWith("Fatal worker error")) {
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

            // Terminal end state (This individual job finished)
            if (data.status === "completed" || data.status === "failed") {
                currentEventSource.close();
                currentEventSource = null;
            }
        };

        currentEventSource.onerror = (e) => {
            console.log("SSE update stream connected");
        };
    }

    function logToTerminal(msg, isError = false) {
        const p = document.createElement("p");
        p.textContent = msg;
        if (isError) {
            p.style.color = "var(--error)";
        }
        consoleLogs.appendChild(p);
        consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }

    // Opening downloads folder
    async function openLocalDownloadsFolder() {
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
    }

    openFolderBtn.addEventListener("click", openLocalDownloadsFolder);

    // History Modal actions
    historyBtn.addEventListener("click", openHistoryModal);
    closeHistoryModalBtn.addEventListener("click", () => {
        historyModal.classList.add("hidden");
    });
    
    clearHistoryBtn.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to clear your download history?")) return;
        try {
            await fetch("/api/history/clear", { method: "POST" });
            loadHistoryItems();
        } catch (e) {
            console.error("Error clearing history:", e);
        }
    });

    async function openHistoryModal() {
        historyModal.classList.remove("hidden");
        loadHistoryItems();
    }

    // Bind event listeners to Jobs search filters
    historySearch.addEventListener("input", filterAndRenderHistory);
    historyTypeFilter.addEventListener("change", filterAndRenderHistory);

    async function loadHistoryItems() {
        historyTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Loading logs...</td></tr>`;
        try {
            const res = await fetch("/api/history");
            historyItemsCache = await res.json();
            filterAndRenderHistory();
        } catch (e) {
            historyTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--error); padding: 1.5rem;">Failed to load history: ${e.message}</td></tr>`;
        }
    }

    function filterAndRenderHistory() {
        const query = historySearch.value.toLowerCase().trim();
        const typeFilter = historyTypeFilter.value;
        
        const filtered = historyItemsCache.filter(item => {
            const title = item.title.toLowerCase();
            const matchesText = title.includes(query);
            
            const isPlaylist = item.is_playlist || item.total_tracks > 1;
            let matchesType = false;
            if (typeFilter === "all") {
                matchesType = true;
            } else if (typeFilter === "playlist" && isPlaylist) {
                matchesType = true;
            } else if (typeFilter === "single" && !isPlaylist) {
                matchesType = true;
            }
            
            return matchesText && matchesType;
        });
        
        renderHistory(filtered);
    }

    function renderHistory(items) {
        historyTableBody.innerHTML = "";
        if (!items || items.length === 0) {
            historyTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem 0;">No download logs found.</td></tr>`;
            return;
        }

        items.forEach(item => {
            const row = document.createElement("tr");
            
            // Find all history entries with the exact same URL to compute URL-specific stats
            const relatedEntries = historyItemsCache.filter(h => h.url && h.url === item.url);
            const timesDownloaded = relatedEntries.length;
            
            // Sort related entries by timestamp ascending to determine first and last run dates
            const sortedRelated = [...relatedEntries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            const firstDateStr = sortedRelated.length > 0 
                ? new Date(sortedRelated[0].timestamp).toLocaleString() 
                : new Date(item.timestamp).toLocaleString();
                
            const lastDateStr = sortedRelated.length > 0 
                ? new Date(sortedRelated[sortedRelated.length - 1].timestamp).toLocaleString() 
                : new Date(item.timestamp).toLocaleString();
            
            const isPlaylist = item.is_playlist || item.total_tracks > 1;
            const typeLabel = isPlaylist ? "Playlist" : "Single File";
            const typeClass = isPlaylist ? "badge-video" : "badge-quality";
            
            const successCount = item.success_count || 0;
            const failureCount = item.failure_count || 0;
            
            const jobNumDisplay = item.job_num ? `#${item.job_num}` : "--";

            row.innerHTML = `
                <td class="job-cell">${jobNumDisplay}</td>
                <td><span class="history-badge ${typeClass}">${typeLabel}</span></td>
                <td style="font-weight: 600; color: var(--text-primary);" title="${item.title}">${item.title}</td>
                <td class="duration-cell" style="text-align: center;">${item.total_tracks}</td>
                <td class="duration-cell" style="text-align: center; font-family: var(--font-mono); font-weight: 700; color: var(--neon-blue);">${timesDownloaded}</td>
                <td class="time-cell">${firstDateStr}</td>
                <td class="time-cell">${lastDateStr}</td>
                <td style="color: #27c93f; font-weight: 700; font-family: var(--font-mono); text-align: center;">${successCount}</td>
                <td style="color: var(--error); font-weight: 700; font-family: var(--font-mono); text-align: center;">${failureCount}</td>
                <td>
                    <div style="display: flex; gap: 0.4rem;">
                        <button class="btn btn-secondary btn-sm load-grid-btn" data-url="${item.url}" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;">
                            Load Grid
                        </button>
                        <button class="btn btn-primary btn-sm redownload-btn" data-id="${item.id}" style="padding: 0.35rem 0.6rem; font-size: 0.75rem; background: linear-gradient(135deg, var(--neon-blue), var(--neon-purple)); border: none;">
                            Delta D/L
                        </button>
                    </div>
                </td>
            `;

            row.querySelector(".load-grid-btn").addEventListener("click", (e) => {
                const url = e.target.getAttribute("data-url");
                urlInput.value = url;
                historyModal.classList.add("hidden");
                analyzeLink();
            });

            row.querySelector(".redownload-btn").addEventListener("click", async (e) => {
                const jobId = e.target.getAttribute("data-id");
                e.target.disabled = true;
                e.target.textContent = "Queueing...";
                try {
                    const res = await fetch("/api/history/resume", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ job_id: jobId })
                    });
                    if (res.ok) {
                        historyModal.classList.add("hidden");
                        
                        // Clear grid status caches and redraw
                        localItemStates = {};
                        renderPlaylistTable(playlistItems);

                        startProgressStream();
                    } else {
                        const err = await res.json();
                        alert(`Failed to resume job: ${err.detail}`);
                        e.target.disabled = false;
                        e.target.textContent = "Delta D/L";
                    }
                } catch (err) {
                    alert(`Error: ${err.message}`);
                    e.target.disabled = false;
                    e.target.textContent = "Delta D/L";
                }
            });

            historyTableBody.appendChild(row);
        });
    }

    function shadowInputFix() {
        const initialFormat = document.querySelector('input[name="format"]:checked');
        if (initialFormat) {
            initialFormat.closest(".header-pill-btn")?.classList.add("active");
        }
        const initialQuality = document.querySelector('input[name="quality"]:checked');
        if (initialQuality) {
            initialQuality.closest(".header-pill-btn")?.classList.add("active");
        }
        updateActiveQualityLabel();
    }

    // Startup shadow configuration checks
    shadowInputFix();
});
