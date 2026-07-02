# SonicStream - YouTube Downloader (Windows Desktop App)

SonicStream is a modern, high-speed media downloader designed to extract playlists and single videos from YouTube. It features a stunning glassmorphism dark-mode native desktop window, selectable audio/video quality tiers, and local desktop integration.

## Key Features

- **Native Windows App**: Launches in a dedicated desktop window using Microsoft Edge WebView2, bypassing the need to open browser tabs or deal with port conflicts.
- **Playlist & Single Link Extraction**: Paste any YouTube playlist or video link to instantly retrieve title, duration, uploader, and video listing.
- **Selective Batch Downloading**: Check or uncheck individual items in a playlist to download only the tracks you want. Includes title search filtering and select/deselect all utilities.
- **Premium Audio Conversion**:
  - Convert videos to high-quality MP3 format.
  - Selectable bitrates: Low (64 kbps), Medium (128 kbps), High (192 kbps), and Highest (320 kbps).
- **High-Definition Video Downloading**:
  - Download video files in MP4 format.
  - Selectable resolutions: Low (360p), Medium (480p), High (720p), and Highest (1080p+).
- **Live Progress Monitor**:
  - Real-time download percentage, speed indicator, and ETA tracking.
  - A scrollable console output window displaying live backend stream logs directly from the parser.
- **Desktop Explorer Integration**:
  - A dedicated "Open Downloads" button that instantly opens the local downloads directory in Windows File Explorer.
- **Premium Design**:
  - Built with pure CSS glassmorphism, glowing borders, custom layout checkboxes, and rich animations.

---

## Setup & Running Locally

### Running the App
Double-click the **`SonicStream.bat`** file in the root folder. The app will launch in a dedicated desktop window instantly.

---

## Technical Stack

- **Backend**: FastAPI (Python 3.11+), `yt-dlp` (YouTube downloader engine), `uvicorn` (ASGI web server).
- **Desktop Wrapper**: `pywebview` (Python library for mounting WebView2).
- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+), Server-Sent Events (SSE) for progress streaming.
- **Utilities**: FFmpeg (used by `yt-dlp` for high-quality audio extraction and video/audio merging).
