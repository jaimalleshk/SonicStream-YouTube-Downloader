import os
import sys
import json
import time
import socket
import queue
import asyncio
import subprocess
import threading
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse, parse_qs
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

# History config
HISTORY_FILE = os.path.join(BASE_DIR, "history.json")
history_lock = threading.Lock()

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Global state for downloading progress
progress_lock = threading.Lock()
download_state = {
    "status": "idle",       # idle, downloading, completed, failed
    "current_index": 0,
    "total_files": 0,
    "current_title": "",
    "percentage": 0.0,
    "speed": "0 KB/s",
    "eta": "00:00",
    "logs": [],
    "error_message": "",
    "item_states": {},      # Map of item.id -> status, percent, speed, etc.
    "active_job_num": 0
}

# Queue Management
download_queue = queue.Queue()
queue_lock = threading.Lock()
queue_state = {
    "active_job": None,       # current active job details
    "pending_jobs": []        # list of queued jobs
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
    playlist_title: Optional[str] = None
    playlist_url: Optional[str] = None
    skip_duplicates: Optional[bool] = True

# Helper: Sanitize windows filenames
def sanitize_filename(filename: str) -> str:
    for char in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']:
        filename = filename.replace(char, '_')
    filename = filename.rstrip('. ')
    return filename

def check_local_duplicate(title: str, format_type: str, download_dir: str) -> Optional[str]:
    target_exts = [".mp3"] if format_type == "audio" else [".mp4", ".mkv", ".webm"]
    # Pure-python sanitization matching Windows rules
    sanitized_title = title
    for char in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']:
        sanitized_title = sanitized_title.replace(char, '_')
    sanitized_title = sanitized_title.rstrip('. ')
    
    try:
        if os.path.exists(download_dir):
            files = os.listdir(download_dir)
            for f in files:
                name, ext = os.path.splitext(f)
                if name.lower() == sanitized_title.lower() and ext.lower() in target_exts:
                    return os.path.join(download_dir, f)
    except Exception:
        pass
    return None

# History Helpers
def load_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_history(history):
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

def update_history_item(job_id: str, completed_count: int):
    with history_lock:
        history = load_history()
        for item in history:
            if item.get("id") == job_id:
                item["completed_tracks"] = completed_count
                break
        save_history(history)

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

def get_clean_playlist_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        if 'list' in query:
            playlist_id = query['list'][0]
            return f"https://www.youtube.com/playlist?list={playlist_id}"
    except Exception:
        pass
    return url

@app.post("/api/fetch-info")
async def fetch_info(req: FetchRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
    
    url = get_clean_playlist_url(url)

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

def run_download_job(job_data: dict):
    global download_state, queue_state
    
    job_id = job_data["job_id"]
    job_num = job_data["job_num"]
    request = job_data["request"]
    
    # Set active job in queue state
    with queue_lock:
        queue_state["active_job"] = {
            "id": job_id,
            "job_num": job_num,
            "title": job_data["title"],
            "total_tracks": len(request.items),
            "format": request.format,
            "quality": request.quality
        }
        # Remove from pending list
        queue_state["pending_jobs"] = [j for j in queue_state["pending_jobs"] if j["job_id"] != job_id]

    # Initialize item states map for inline updates
    item_states = {}
    for item in request.items:
        item_states[item.id] = {
            "job_num": job_num,
            "status": "queued",
            "percentage": 0.0,
            "speed": "0 KB/s",
            "start_time": "--",
            "end_time": "--",
            "error_detail": ""
        }

    with progress_lock:
        download_state.update({
            "status": "downloading",
            "current_index": 0,
            "total_files": len(request.items),
            "current_title": "",
            "percentage": 0.0,
            "speed": "0 KB/s",
            "eta": "00:00",
            "logs": [f"Starting Job #{job_num}: {job_data['title']}"],
            "error_message": "",
            "item_states": item_states,
            "active_job_num": job_num
        })

    completed_count = 0

    for idx, item in enumerate(request.items):
        with progress_lock:
            download_state["current_index"] = idx + 1
            download_state["current_title"] = item.title
            download_state["percentage"] = 0.0
            download_state["logs"].append(f"[{idx+1}/{len(request.items)}] Preparing: {item.title}")
            download_state["item_states"][item.id].update({
                "status": "downloading",
                "start_time": datetime.now().strftime("%H:%M:%S")
            })

        def progress_hook(d):
            global download_state
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 1
                downloaded = d.get('downloaded_bytes', 0)
                percent = round((downloaded / total) * 100, 1)
                
                speed = d.get('_speed_str', '0 KB/s')
                eta = d.get('_eta_str', '00:00')
                
                with progress_lock:
                    download_state["percentage"] = percent
                    download_state["speed"] = speed
                    download_state["eta"] = eta
                    if item.id in download_state["item_states"]:
                        download_state["item_states"][item.id].update({
                            "percentage": percent,
                            "speed": speed
                        })
            elif d['status'] == 'finished':
                info = d.get('info_dict', {})
                title = info.get('title') or download_state["current_title"]
                with progress_lock:
                    download_state["percentage"] = 100.0
                    download_state["logs"].append(f"Finished downloading: {title}")

        # Check for local duplicates first
        duplicate_path = check_local_duplicate(item.title, request.format, DOWNLOAD_DIR)
        
        if request.skip_duplicates and duplicate_path:
            skip_msg = f"[Duplicate Skipped] \"{os.path.basename(duplicate_path)}\" already exists at: {duplicate_path}"
            with progress_lock:
                download_state["percentage"] = 100.0
                download_state["logs"].append(skip_msg)
                if item.id in download_state["item_states"]:
                    download_state["item_states"][item.id].update({
                        "status": "skipped",
                        "percentage": 100.0,
                        "end_time": datetime.now().strftime("%H:%M:%S")
                    })
            completed_count += 1
            update_history_item(job_id, completed_count)
            continue

        # Quality and format resolution
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [progress_hook],
            'outtmpl': os.path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s'),
            'download_archive': os.path.join(DOWNLOAD_DIR, 'download_archive.txt'),
            'nooverwrites': True,
            'noplaylist': True,
            'writethumbnail': True,
        }

        if request.format == "audio":
            ydl_opts['format'] = 'bestaudio/best'
            quality_map = {
                "low": "64",
                "medium": "128",
                "high": "192",
                "highest": "320"
            }
            kbps = quality_map.get(request.quality, "192")
            ydl_opts['postprocessors'] = [
                {
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': kbps,
                },
                {
                    'key': 'EmbedThumbnail',
                },
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                }
            ]
        else:
            if request.quality == "low":
                ydl_opts['format'] = 'worstvideo[ext=mp4]+worstaudio/worst'
            elif request.quality == "medium":
                ydl_opts['format'] = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]/best'
            elif request.quality == "high":
                ydl_opts['format'] = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]/best'
            else: # highest
                ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
            
            ydl_opts['merge_output_format'] = 'mp4'
            ydl_opts['postprocessors'] = [
                {
                    'key': 'EmbedThumbnail',
                },
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                }
            ]

        max_retries = 3
        success = False
        error_msg = ""
        
        for attempt in range(max_retries):
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([item.url])
                success = True
                break
            except Exception as e:
                error_msg = str(e)
                if attempt < max_retries - 1:
                    with progress_lock:
                        download_state["logs"].append(
                            f"[Retry Attempt {attempt + 2}/{max_retries}] for: {item.title} (Reason: {error_msg})"
                        )
                    time.sleep(2)
        
        if success:
            with progress_lock:
                if item.id in download_state["item_states"]:
                    download_state["item_states"][item.id].update({
                        "status": "completed",
                        "percentage": 100.0,
                        "end_time": datetime.now().strftime("%H:%M:%S")
                    })
            completed_count += 1
            update_history_item(job_id, completed_count)
        else:
            error_str = f"Error downloading {item.title} after {max_retries} attempts: {error_msg}"
            with progress_lock:
                download_state["logs"].append(error_str)
                if item.id in download_state["item_states"]:
                    download_state["item_states"][item.id].update({
                        "status": "error",
                        "end_time": datetime.now().strftime("%H:%M:%S"),
                        "error_detail": error_msg
                    })
            completed_count += 1
            update_history_item(job_id, completed_count)

    with progress_lock:
        download_state["status"] = "completed"
        download_state["logs"].append("All downloads finished!")

    with queue_lock:
        queue_state["active_job"] = None

def worker_loop():
    while True:
        job = download_queue.get()
        try:
            run_download_job(job)
        except Exception as e:
            print(f"Error in queue worker: {e}")
            with queue_lock:
                queue_state["active_job"] = None
            with progress_lock:
                download_state["status"] = "failed"
                download_state["error_message"] = str(e)
                download_state["logs"].append(f"Fatal worker error: {str(e)}")
        finally:
            download_queue.task_done()

# Start background queue thread immediately
worker_thread = threading.Thread(target=worker_loop, daemon=True)
worker_thread.start()

@app.post("/api/download")
async def start_download(req: DownloadRequest):
    # Get incremental job number from history
    job_id = f"job_{int(time.time())}"
    timestamp = datetime.now().isoformat()
    
    title = req.playlist_title or (req.items[0].title if req.items else "Single Video")
    url = req.playlist_url or (req.items[0].url if req.items else "")

    with history_lock:
        history = load_history()
        max_job_num = 0
        for h_item in history:
            if "job_num" in h_item:
                max_job_num = max(max_job_num, h_item["job_num"])
        new_job_num = max_job_num + 1

        new_entry = {
            "id": job_id,
            "job_num": new_job_num,
            "title": title,
            "url": url,
            "timestamp": timestamp,
            "total_tracks": len(req.items),
            "completed_tracks": 0,
            "format": req.format,
            "quality": req.quality
        }
        history.insert(0, new_entry)
        save_history(history)

    # Push to task queue
    job_data = {
        "job_id": job_id,
        "job_num": new_job_num,
        "title": title,
        "request": req
    }
    
    with queue_lock:
        queue_state["pending_jobs"].append(job_data)
        
    download_queue.put(job_data)
    return {"message": "Job queued successfully", "job_id": job_id, "job_num": new_job_num}

@app.get("/api/queue")
async def get_queue():
    with queue_lock:
        return {
            "active_job": queue_state["active_job"],
            "pending_jobs": [
                {
                    "id": j["job_id"],
                    "job_num": j["job_num"],
                    "title": j["title"],
                    "total_tracks": len(j["request"].items),
                    "format": j["request"].format,
                    "quality": j["request"].quality
                } for j in queue_state["pending_jobs"]
            ]
        }

@app.get("/api/progress")
async def get_progress_stream():
    async def event_generator():
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
                item_states = dict(download_state["item_states"])
                active_job_num = download_state["active_job_num"]

            payload = {
                "status": status,
                "current_index": curr_idx,
                "total_files": total,
                "current_title": title,
                "percentage": percent,
                "speed": speed,
                "eta": eta,
                "logs": logs[-15:],
                "error": err,
                "item_states": item_states,
                "active_job_num": active_job_num
            }
            yield f"data: {json.dumps(payload)}\n\n"
            
            if status in ["completed", "failed"] and last_status == status:
                break
                
            last_status = status

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/history")
async def get_history():
    with history_lock:
        return load_history()

@app.post("/api/history/clear")
async def clear_history():
    with history_lock:
        save_history([])
    return {"message": "History cleared"}

class ResumeRequest(BaseModel):
    job_id: str

@app.post("/api/history/resume")
async def resume_job(req: ResumeRequest):
    # 1. Find the history job
    with history_lock:
        history = load_history()
    
    job = None
    for item in history:
        if item.get("id") == req.job_id:
            job = item
            break
            
    if not job:
        raise HTTPException(status_code=404, detail="Job not found in history")
        
    url = job.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Job does not have a URL associated")

    # 2. Extract playlist entries
    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    
    try:
        loop = asyncio.get_event_loop()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = await loop.run_in_executor(None, lambda: ydl.extract_info(url, download=False))
            
        if not info:
            raise HTTPException(status_code=400, detail="Could not retrieve video information for resumption")
            
        entries = []
        is_playlist = info.get('_type') == 'playlist'
        
        raw_items = info.get('entries', []) if is_playlist else [info]
        for entry in raw_items:
            if not entry:
                continue
            video_id = entry.get('id') or entry.get('url')
            if not video_id:
                continue
            entries.append(DownloadItem(
                id=video_id,
                title=entry.get('title') or "Unknown Title",
                url=f"https://www.youtube.com/watch?v={video_id}" if is_playlist else url
            ))
            
        # 3. Create the DownloadRequest
        dl_req = DownloadRequest(
            items=entries,
            format=job.get("format", "audio"),
            quality=job.get("quality", "highest"),
            playlist_title=job.get("title"),
            playlist_url=url,
            skip_duplicates=True
        )
        
        # 4. Trigger download (push to queue)
        job_id = f"job_{int(time.time())}"
        
        with history_lock:
            history = load_history()
            max_job_num = 0
            for h_item in history:
                if "job_num" in h_item:
                    max_job_num = max(max_job_num, h_item["job_num"])
            new_job_num = max_job_num + 1
            
            # Insert a new entry so they see the resumption attempt history
            new_entry = {
                "id": job_id,
                "job_num": new_job_num,
                "title": f"[Resumed] {job.get('title')}",
                "url": url,
                "timestamp": datetime.now().isoformat(),
                "total_tracks": len(entries),
                "completed_tracks": 0,
                "format": job.get("format", "audio"),
                "quality": job.get("quality", "highest")
            }
            history.insert(0, new_entry)
            save_history(history)
            
        job_data = {
            "job_id": job_id,
            "job_num": new_job_num,
            "title": f"[Resumed] {job.get('title')}",
            "request": dl_req
        }
        
        with queue_lock:
            queue_state["pending_jobs"].append(job_data)
            
        download_queue.put(job_data)
        return {"message": "Job resumed and queued", "job_id": job_id, "job_num": new_job_num}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resumption failed: {str(e)}")

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
