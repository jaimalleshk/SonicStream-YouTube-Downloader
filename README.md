# SonicStream - YouTube Audio & Video Downloader

SonicStream is a modern, high-speed media downloader designed to extract playlists and single videos from YouTube. It features a stunning glassmorphism dark-mode interface, selectable audio/video quality tiers, and local desktop integration.

## Key Features

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
  - A dedicated "Open Downloads" button that instantly opens the local downloads directory in Windows File Explorer (or your operating system's default file browser).
- **Premium Responsive Interface**:
  - Built with pure CSS glassmorphism, glowing borders, custom layout checkboxes, and rich animations.

---

## Technical Stack

- **Backend**: FastAPI (Python 3.11+), `yt-dlp` (YouTube downloader engine), `uvicorn` (ASGI web server).
- **Frontend**: Vanilla HTML5, CSS3, Modern JavaScript (ES6+), Server-Sent Events (SSE) for progress streaming.
- **Utilities**: FFmpeg (used by `yt-dlp` for high-quality audio extraction and video/audio merging).

---

## Setup & Running Locally

### Prerequisites

Ensure you have **Python 3.11+** and **FFmpeg** installed and added to your system's PATH.

### 1. Initialize Virtual Environment
```bash
python -m venv .venv
```

### 2. Activate Virtual Environment
- **Windows (PowerShell)**:
  ```powershell
  .venv\Scripts\Activate.ps1
  ```
- **Windows (CMD)**:
  ```cmd
  .venv\Scripts\activate.bat
  ```
- **macOS / Linux**:
  ```bash
  source .venv/bin/activate
  ```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Start the Application
```bash
python main.py
```

Open your browser and navigate to `http://127.0.0.1:8000` to start downloading.
