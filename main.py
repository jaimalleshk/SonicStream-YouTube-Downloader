import os
import sys
import asyncio
import subprocess
import threading
from typing import List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import yt_dlp

app = FastAPI(title="YouTube Downloader")

# Setup directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Global state for downloading progress
progress_lock = threading.Lock()
download_state = {
    "status": "idle",       # idle, fetching, downloading, completed, failed
    "current_index": 0,
    "total_files": 0,
    "current_title": "",
    "percentage": 0.0,
    "speed": "0 KB/s",
    "eta": "00:00",
    "logs": [],
    "error_message": ""
}

class FetchRequest(BaseModel):
    url: str

class DownloadItem(BaseModel):
    id: str
    title: str
    url: str

class DownloadRequest(BaseModel):
    items: List[DownloadItem]
    format: str  # "audio" or "video"
    quality: str  # "low", "medium", "high", "highest"

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.post("/api/fetch-info")
async def fetch_info(req: FetchRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")

    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }

    try:
        # Run in executor to prevent blocking
        loop = asyncio.get_event_loop()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = await loop.run_in_executor(None, lambda: ydl.extract_info(url, download=False))
        
        if not info:
            raise HTTPException(status_code=400, detail="Could not retrieve video information")

        entries = []
        is_playlist = info.get('_type') == 'playlist'
        playlist_title = info.get('title', 'YouTube Playlist') if is_playlist else "Single Video"

        if is_playlist and 'entries' in info:
            for entry in info['entries']:
                if not entry:
                    continue
                video_id = entry.get('id') or entry.get('url')
                if not video_id:
                    continue
                entries.append({
                    "id": video_id,
                    "title": entry.get('title') or "Unknown Title",
                    "uploader": entry.get('uploader') or entry.get('channel') or "Unknown Channel",
                    "duration": entry.get('duration'),
                    "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                    "url": f"https://www.youtube.com/watch?v={video_id}"
                })
        else:
            video_id = info.get('id')
            entries.append({
                "id": video_id,
                "title": info.get('title') or "Unknown Title",
                "uploader": info.get('uploader') or info.get('channel') or "Unknown Channel",
                "duration": info.get('duration'),
                "thumbnail": info.get('thumbnail') or (f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else None),
                "url": url
            })

        return {
            "title": playlist_title,
            "is_playlist": is_playlist,
            "entries": entries
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def run_download_sync(request: DownloadRequest):
    global download_state
    
    with progress_lock:
        download_state.update({
            "status": "downloading",
            "current_index": 0,
            "total_files": len(request.items),
            "current_title": "",
            "percentage": 0.0,
            "speed": "0 KB/s",
            "eta": "00:00",
            "logs": ["Starting downloads..."],
            "error_message": ""
        })

    def progress_hook(d):
        global download_state
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 1
            downloaded = d.get('downloaded_bytes', 0)
            percent = (downloaded / total) * 100
            
            speed = d.get('_speed_str', '0 KB/s')
            eta = d.get('_eta_str', '00:00')
            
            with progress_lock:
                download_state["percentage"] = round(percent, 1)
                download_state["speed"] = speed
                download_state["eta"] = eta
        elif d['status'] == 'finished':
            with progress_lock:
                download_state["percentage"] = 100.0
                download_state["logs"].append(f"Finished downloading: {download_state['current_title']}")

    for idx, item in enumerate(request.items):
        with progress_lock:
            download_state["current_index"] = idx + 1
            download_state["current_title"] = item.title
            download_state["percentage"] = 0.0
            download_state["logs"].append(f"[{idx+1}/{len(request.items)}] Preparing: {item.title}")

        # Quality and format resolution
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [progress_hook],
            'outtmpl': os.path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s'),
        }

        if request.format == "audio":
            ydl_opts['format'] = 'bestaudio/best'
            # Map quality string to kbps
            quality_map = {
                "low": "64",
                "medium": "128",
                "high": "192",
                "highest": "320"
            }
            kbps = quality_map.get(request.quality, "192")
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': kbps,
            }]
        else:
            # Video qualities
            if request.quality == "low":
                ydl_opts['format'] = 'worstvideo[ext=mp4]+worstaudio/worst'
            elif request.quality == "medium":
                ydl_opts['format'] = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]/best'
            elif request.quality == "high":
                ydl_opts['format'] = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]/best'
            else: # highest
                ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
            
            # Ensure mp4 container merging
            ydl_opts['merge_output_format'] = 'mp4'

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([item.url])
        except Exception as e:
            error_str = f"Error downloading {item.title}: {str(e)}"
            with progress_lock:
                download_state["logs"].append(error_str)
                # Keep going with other tracks, don't crash entirely
            continue

    with progress_lock:
        download_state["status"] = "completed"
        download_state["logs"].append("All downloads finished!")

@app.post("/api/download")
async def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    global download_state
    if download_state["status"] == "downloading":
        raise HTTPException(status_code=400, detail="A download is already in progress")
    
    background_tasks.add_task(run_download_sync, req)
    return {"message": "Download started"}

@app.get("/api/progress")
async def get_progress_stream():
    async def event_generator():
        last_index = -1
        last_percent = -1.0
        last_status = ""
        
        while True:
            await asyncio.sleep(0.5)
            with progress_lock:
                status = download_state["status"]
                curr_idx = download_state["current_index"]
                percent = download_state["percentage"]
                title = download_state["current_title"]
                speed = download_state["speed"]
                eta = download_state["eta"]
                logs = list(download_state["logs"])
                total = download_state["total_files"]
                err = download_state["error_message"]

            import json
            payload = {
                "status": status,
                "current_index": curr_idx,
                "total_files": total,
                "current_title": title,
                "percentage": percent,
                "speed": speed,
                "eta": eta,
                "logs": logs[-15:], # Keep last 15 lines of logs for UI performance
                "error": err
            }
            yield f"data: {json.dumps(payload)}\n\n"
            
            if status in ["completed", "failed", "idle"] and last_status == status:
                # If we've reached a terminal state and already pushed it, we can break.
                break
                
            last_status = status

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/open-folder")
async def open_folder():
    try:
        if sys.platform == "win32":
            os.startfile(DOWNLOAD_DIR)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", DOWNLOAD_DIR])
        else:
            subprocess.Popen(["xdg-open", DOWNLOAD_DIR])
        return {"message": "Folder opened"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open downloads directory: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
