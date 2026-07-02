document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const urlInput = document.getElementById("urlInput");
    const analyzeBtn = document.getElementById("analyzeBtn");
    const analyzeSpinner = document.getElementById("analyzeSpinner");
    const urlError = document.getElementById("urlError");
    
    const formatLabels = document.querySelectorAll(".toggle-option");
    const qualityCards = document.querySelectorAll(".quality-card");
    
    const playlistSection = document.getElementById("playlistSection");
    const playlistTitle = document.getElementById("playlistTitle");
    const playlistMeta = document.getElementById("playlistMeta");
    const playlistSearch = document.getElementById("playlistSearch");
    const playlistTableBody = document.getElementById("playlistTableBody");
    const headerCheckbox = document.getElementById("headerCheckbox");
    
    const selectAllBtn = document.getElementById("selectAllBtn");
    const deselectAllBtn = document.getElementById("deselectAllBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    
    const progressModal = document.getElementById("progressModal");
    const downloadBadge = document.getElementById("downloadBadge");
    const progressIndex = document.getElementById("progressIndex");
    const progressTitle = document.getElementById("progressTitle");
    const progressFill = document.getElementById("progressFill");
    const progressPercent = document.getElementById("progressPercent");
    const progressSpeed = document.getElementById("progressSpeed");
    const progressEta = document.getElementById("progressEta");
    const consoleLogs = document.getElementById("consoleLogs");
    
    const closeModalBtn = document.getElementById("closeModalBtn");
    const modalOpenFolderBtn = document.getElementById("modalOpenFolderBtn");
    const openFolderBtn = document.getElementById("openFolderBtn");

    // History elements
    const historyBtn = document.getElementById("historyBtn");
    const historyModal = document.getElementById("historyModal");
    const closeHistoryModalBtn = document.getElementById("closeHistoryModalBtn");
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    const historyList = document.getElementById("historyList");

    // Global Caches
    let playlistItems = [];
    let currentEventSource = null;

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

    // Format Toggle change listeners & click fallbacks
    const formatRadios = document.querySelectorAll('input[name="format"]');
    formatRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            formatLabels.forEach(l => l.classList.remove("active"));
            const activeLabel = e.target.closest(".toggle-option");
            if (activeLabel) activeLabel.classList.add("active");
            toggleQualityLabels(e.target.value);
        });
    });

    formatLabels.forEach(label => {
        label.addEventListener("click", (e) => {
            const radio = label.querySelector('input[type="radio"]');
            if (radio && e.target !== radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change"));
            }
        });
    });

    function toggleQualityLabels(format) {
        const audioDetails = document.querySelectorAll(".q-detail");
        const videoDetails = document.querySelectorAll(".q-detail-vid");
        
        if (format === "audio") {
            audioDetails.forEach(el => el.classList.remove("hidden"));
            videoDetails.forEach(el => el.classList.add("hidden"));
        } else {
            audioDetails.forEach(el => el.classList.add("hidden"));
            videoDetails.forEach(el => el.classList.remove("hidden"));
        }
    }

    // Quality Cards selection change listeners & click fallbacks
    const qualityRadios = document.querySelectorAll('input[name="quality"]');
    qualityRadios.forEach(radio => {
        radio.addEventListener("change", (e) => {
            qualityCards.forEach(c => c.classList.remove("active"));
            const activeCard = e.target.closest(".quality-card");
            if (activeCard) activeCard.classList.add("active");
        });
    });

    qualityCards.forEach(card => {
        card.addEventListener("click", (e) => {
            const radio = card.querySelector('input[type="radio"]');
            if (radio && e.target !== radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change"));
            }
        });
    });

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
            renderPlaylistTable(playlistItems);
            
            // Auto check all items by default
            headerCheckbox.checked = true;
            toggleAllCheckboxes(true);
            updateSelectionMeta();
            
            playlistSection.classList.remove("hidden");
            // Scroll to playlist
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
        
        if (items.length === 0) {
            playlistTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No videos found matching current filter.</td></tr>`;
            return;
        }

        items.forEach(item => {
            const row = document.createElement("tr");
            row.setAttribute("data-id", item.id);
            row.innerHTML = `
                <td><input type="checkbox" class="video-checkbox" checked data-id="${item.id}"></td>
                <td class="thumb-cell"><img src="${item.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120'}" alt="Thumb"></td>
                <td>
                    <div class="title-cell" title="${item.title}">${item.title}</div>
                </td>
                <td class="channel-cell">${item.uploader}</td>
                <td class="duration-cell">${formatDuration(item.duration)}</td>
            `;
            
            // Row checkbox toggle updates count
            row.querySelector(".video-checkbox").addEventListener("change", () => {
                updateSelectionMeta();
                // If any unchecked, uncheck header checkbox
                const allChecked = Array.from(document.querySelectorAll(".video-checkbox")).every(c => c.checked);
                headerCheckbox.checked = allChecked;
            });
            
            playlistTableBody.appendChild(row);
        });
    }

    // Toggle all checkboxes
    headerCheckbox.addEventListener("change", (e) => {
        toggleAllCheckboxes(e.target.checked);
        updateSelectionMeta();
    });

    function toggleAllCheckboxes(checked) {
        const checkboxes = document.querySelectorAll(".video-checkbox");
        checkboxes.forEach(cb => {
            // Only toggle visible items if search is active
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

    // Selection meta count
    function updateSelectionMeta() {
        const checkedCount = getSelectedItems().length;
        playlistMeta.textContent = `${checkedCount} of ${playlistItems.length} items selected`;
        downloadBtn.disabled = checkedCount === 0;
    }

    function getSelectedItems() {
        const checkedCheckboxes = document.querySelectorAll(".video-checkbox:checked");
        const selectedIds = Array.from(checkedCheckboxes).map(cb => cb.getAttribute("data-id"));
        return playlistItems.filter(item => selectedIds.includes(item.id));
    }

    // Filter list
    playlistSearch.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        const rows = playlistTableBody.querySelectorAll("tr");
        
        rows.forEach(row => {
            const title = row.querySelector(".title-cell")?.textContent.toLowerCase() || "";
            const channel = row.querySelector(".channel-cell")?.textContent.toLowerCase() || "";
            
            if (title.includes(query) || channel.includes(query)) {
                row.style.display = "";
            } else {
                row.style.display = "none";
            }
        });
    });

    // Start download process
    downloadBtn.addEventListener("click", async () => {
        const selected = getSelectedItems();
        if (selected.length === 0) return;

        const format = document.querySelector('input[name="format"]:checked').value;
        const quality = document.querySelector('input[name="quality"]:checked').value;
        
        const playlistTitleVal = playlistTitle.textContent;
        const playlistUrlVal = urlInput.value.trim();

        // Reset and prepare progress modal
        progressModal.classList.remove("hidden");
        closeModalBtn.classList.add("hidden");
        modalOpenFolderBtn.classList.add("hidden");
        downloadBadge.textContent = "Downloading";
        downloadBadge.className = "status-badge pulse";
        progressFill.style.width = "0%";
        progressPercent.textContent = "0%";
        progressSpeed.textContent = "0 KB/s";
        progressEta.textContent = "00:00";
        progressIndex.textContent = `Preparing 1 of ${selected.length}`;
        progressTitle.textContent = selected[0].title;
        consoleLogs.innerHTML = `<p class="system-line">Initiating background queue...</p>`;

        try {
            const res = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: selected,
                    format,
                    quality,
                    playlist_title: playlistTitleVal,
                    playlist_url: playlistUrlVal
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || "Failed to trigger download queue");
            }

            // Stream progress
            startProgressStream();

        } catch (err) {
            logToTerminal(`[System Error] ${err.message}`, true);
            downloadBadge.textContent = "Error";
            downloadBadge.className = "status-badge";
            downloadBadge.style.background = "rgba(239, 68, 68, 0.15)";
            downloadBadge.style.color = "var(--error)";
            closeModalBtn.classList.remove("hidden");
        }
    });

    function startProgressStream() {
        if (currentEventSource) {
            currentEventSource.close();
        }

        currentEventSource = new EventSource("/api/progress");

        currentEventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            // Update UI elements
            if (data.status === "downloading") {
                progressIndex.textContent = `Item ${data.current_index} of ${data.total_files}`;
                progressTitle.textContent = data.current_title;
                progressFill.style.width = `${data.percentage}%`;
                progressPercent.textContent = `${data.percentage}%`;
                progressSpeed.textContent = data.speed;
                progressEta.textContent = data.eta;
            }

            // Render logs
            if (data.logs && data.logs.length > 0) {
                consoleLogs.innerHTML = "";
                data.logs.forEach(log => {
                    const p = document.createElement("p");
                    p.textContent = log;
                    if (log.startsWith("[System Error]") || log.startsWith("Error")) {
                        p.style.color = "var(--error)";
                    } else if (log.startsWith("Finished downloading")) {
                        p.style.color = "var(--success)";
                    }
                    consoleLogs.appendChild(p);
                });
                consoleLogs.scrollTop = consoleLogs.scrollHeight;
            }

            // Terminating states
            if (data.status === "completed") {
                currentEventSource.close();
                downloadBadge.textContent = "Finished";
                downloadBadge.className = "status-badge";
                downloadBadge.style.background = "rgba(16, 185, 129, 0.15)";
                downloadBadge.style.color = "var(--success)";
                
                progressFill.style.width = "100%";
                progressPercent.textContent = "100%";
                progressSpeed.textContent = "Done";
                progressEta.textContent = "--:--";

                closeModalBtn.classList.remove("hidden");
                modalOpenFolderBtn.classList.remove("hidden");
            } else if (data.status === "failed") {
                currentEventSource.close();
                downloadBadge.textContent = "Failed";
                downloadBadge.className = "status-badge";
                downloadBadge.style.background = "rgba(239, 68, 68, 0.15)";
                downloadBadge.style.color = "var(--error)";
                closeModalBtn.classList.remove("hidden");
            }
        };

        currentEventSource.onerror = (e) => {
            console.log("SSE Connection update:", e);
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

    // Modal dismissing
    closeModalBtn.addEventListener("click", () => {
        progressModal.classList.add("hidden");
    });

    // Opening local explorer downloads directory
    async function openLocalDownloadsFolder() {
        try {
            const res = await fetch("/api/open-folder", { method: "POST" });
            if (!res.ok) {
                const data = await res.json();
                alert(`Error opening folder: ${data.detail}`);
            }
        } catch (e) {
            alert(`Error opening folder: ${e.message}`);
        }
    }

    openFolderBtn.addEventListener("click", openLocalDownloadsFolder);
    modalOpenFolderBtn.addEventListener("click", openLocalDownloadsFolder);

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

    async function loadHistoryItems() {
        historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Loading logs...</div>`;
        try {
            const res = await fetch("/api/history");
            const data = await res.json();
            renderHistory(data);
        } catch (e) {
            historyList.innerHTML = `<div style="text-align: center; color: var(--error); padding: 1.5rem;">Failed to load history: ${e.message}</div>`;
        }
    }

    function renderHistory(items) {
        historyList.innerHTML = "";
        if (!items || items.length === 0) {
            historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem 0;">No download logs found.</div>`;
            return;
        }

        items.forEach(item => {
            const card = document.createElement("div");
            card.className = "history-card";
            
            const dateStr = new Date(item.timestamp).toLocaleString();
            
            card.innerHTML = `
                <div class="history-info">
                    <div class="h-title" title="${item.title}">${item.title}</div>
                    <div class="h-meta">
                        <span class="history-badge badge-${item.format}">${item.format}</span>
                        <span class="history-badge badge-quality">${item.quality}</span>
                        <span class="h-time">${dateStr}</span>
                    </div>
                </div>
                <div class="history-status-container">
                    <span class="history-progress-text">${item.completed_tracks} / ${item.total_tracks} tracks</span>
                    <button class="btn btn-secondary btn-sm re-analyze-history-btn" data-url="${item.url}">
                        Re-analyze
                    </button>
                </div>
            `;
            
            card.querySelector(".re-analyze-history-btn").addEventListener("click", (e) => {
                const url = e.target.getAttribute("data-url");
                urlInput.value = url;
                historyModal.classList.add("hidden");
                analyzeLink();
            });
            
            historyList.appendChild(card);
        });
    }

    // Helpers for error reporting
    function showError(msg) {
        urlError.textContent = msg;
        urlError.classList.remove("hidden");
    }

    function shadowInputFix() {
        // Initial sync of styling to reflect default checked radios
        const initialFormat = document.querySelector('input[name="format"]:checked');
        if (initialFormat) {
            const activeLabel = initialFormat.closest(".toggle-option");
            if (activeLabel) activeLabel.classList.add("active");
            toggleQualityLabels(initialFormat.value);
        }
        const initialQuality = document.querySelector('input[name="quality"]:checked');
        if (initialQuality) {
            const activeCard = initialQuality.closest(".quality-card");
            if (activeCard) activeCard.classList.add("active");
        }
    }

    function hideError() {
        urlError.textContent = "";
        urlError.classList.add("hidden");
    }

    // Execute shadow fix on startup
    shadowInputFix();
});
