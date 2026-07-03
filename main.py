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
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse
from pydantic import BaseModel
import yt_dlp

app = FastAPI(title="YouTube Downloader")

# Setup directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = r"D:\OneDrive - Triamber\YoutubeDownloads"
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
    uploader: Optional[str] = "Unknown"
    duration: Optional[int] = 0
    thumbnail: Optional[str] = None

class DownloadRequest(BaseModel):
    items: List[DownloadItem]
    format: str  # "audio" or "video"
    quality: str  # "low", "medium", "high", "highest"
    playlist_title: Optional[str] = None
    playlist_url: Optional[str] = None
    skip_duplicates: Optional[bool] = True
    download_dir: Optional[str] = None

class SaveItemsRequest(BaseModel):
    items: List[DownloadItem]

class LastPlayedRequest(BaseModel):
    track_id: str
    shuffle_mode: bool
    shuffle_order: Optional[List[str]] = None
    shuffle_index: Optional[int] = None

class CreatePlaylistRequest(BaseModel):
    title: str

class ImportFolderRequest(BaseModel):
    title: str
    folder_path: str



import re

def clean_ansi(text: str) -> str:
    if not text:
        return ""
    ansi_escape = re.compile(r'(?:\x1B[@-_]|[\x80-\x9F])[0-?]*[ -/]*[@-~]')
    return ansi_escape.sub('', text)

# Helper: Sanitize windows filenames
def sanitize_filename(filename: str) -> str:
    for char in ['\\', '/', ':', '*', '?', '"', '<', '>', '|']:
        filename = filename.replace(char, '_')
    filename = filename.rstrip('. ')
    return filename

def check_local_duplicate(title: str, format_type: str, download_dir: str) -> Optional[str]:
    target_exts = [".mp3"] if format_type == "audio" else [".mp4", ".mkv", ".webm"]
    
    def clean_fuzzy(s: str) -> str:
        return "".join(c.lower() for c in s if c.isalnum())
        
    fuzzy_title = clean_fuzzy(title)
    if not fuzzy_title:
        return None
        
    try:
        if os.path.exists(download_dir):
            files = os.listdir(download_dir)
            for f in files:
                name, ext = os.path.splitext(f)
                if ext.lower() in target_exts:
                    if clean_fuzzy(name) == fuzzy_title:
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

def update_history_track_status(job_id: str, track_id: str, status: str, percentage: float, speed: str = "--", start_time: str = None, end_time: str = None, error_detail: str = ""):
    with history_lock:
        history = load_history()
        for job in history:
            if job.get("id") == job_id:
                items = job.get("items", [])
                for track in items:
                    if track.get("id") == track_id:
                        track["status"] = status
                        track["percentage"] = percentage
                        if speed != "--":
                            track["speed"] = speed
                        if start_time:
                            track["start_time"] = start_time
                        if end_time:
                            track["end_time"] = end_time
                        if error_detail is not None:
                            track["error_detail"] = error_detail
                        break
                
                # Recompute job counts
                success = sum(1 for t in items if t.get("status") in ["completed", "skipped"])
                failures = sum(1 for t in items if t.get("status") == "error")
                job["success_count"] = success
                job["failure_count"] = failures
                job["completed_tracks"] = success + failures
                break
        save_history(history)

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

# yt-dlp version check and self-update endpoints
@app.get("/api/ytdlp-version")
async def get_ytdlp_version():
    """Return current installed yt-dlp version and check for updates."""
    current_version = yt_dlp.version.__version__
    update_available = False
    latest_version = current_version

    try:
        # Use yt-dlp's own update check (quick network call)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _check_ytdlp_latest)
        if result and result != current_version:
            latest_version = result
            update_available = True
    except Exception:
        pass  # Silently fail; we still return the current version

    return {
        "current_version": current_version,
        "latest_version": latest_version,
        "update_available": update_available
    }

def _check_ytdlp_latest():
    """Check PyPI for the latest yt-dlp release version."""
    try:
        import urllib.request
        url = "https://pypi.org/pypi/yt-dlp/json"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return data.get("info", {}).get("version", "")
    except Exception:
        return None

@app.post("/api/ytdlp-update")
async def update_ytdlp():
    """Upgrade yt-dlp to the latest version using pip."""
    try:
        python_exe = sys.executable
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, lambda: subprocess.run(
            [python_exe, "-m", "pip", "install", "--upgrade", "yt-dlp"],
            capture_output=True, text=True, timeout=120
        ))
        
        if result.returncode == 0:
            # Re-read the version after upgrade
            new_version = "unknown"
            for line in result.stdout.splitlines():
                if "Successfully installed yt-dlp" in line:
                    parts = line.split("yt-dlp-")
                    if len(parts) > 1:
                        new_version = parts[-1].strip()
                        break
            
            return {
                "success": True,
                "message": "yt-dlp upgraded successfully. Restart the app to use the new version.",
                "output": result.stdout[-500:] if len(result.stdout) > 500 else result.stdout,
                "new_version": new_version
            }
        else:
            return {
                "success": False,
                "message": f"Upgrade failed: {result.stderr[-300:] if result.stderr else 'Unknown error'}"
            }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Upgrade timed out after 120 seconds.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
        'socket_timeout': 15,
        'no_interactive': True,
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
    
    # Establish target custom directory
    target_dir = request.download_dir or DOWNLOAD_DIR
    os.makedirs(target_dir, exist_ok=True)
    
    # Set active job in queue state
    with queue_lock:
        queue_state["active_job"] = {
            "id": job_id,
            "job_num": job_num,
            "title": job_data["title"],
            "total_tracks": len(request.items),
            "format": request.format,
            "quality": request.quality,
            "download_dir": target_dir
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

    success_count = 0
    failure_count = 0

    for idx, item in enumerate(request.items):
        with progress_lock:
            download_state["current_index"] = idx + 1
            download_state["current_title"] = item.title
            download_state["percentage"] = 0.0
            download_state["speed"] = "0 KB/s"
            download_state["eta"] = "00:00"
            download_state["logs"].append(f"[{idx+1}/{len(request.items)}] Preparing: {item.title}")
            download_state["item_states"][item.id].update({
                "status": "downloading",
                "percentage": 0.0,
                "speed": "0 KB/s",
                "start_time": datetime.now().strftime("%H:%M:%S")
            })
        update_history_track_status(
            job_id=job_id,
            track_id=item.id,
            status="downloading",
            percentage=0.0,
            start_time=datetime.now().strftime("%H:%M:%S")
        )

        def progress_hook(d):
            global download_state
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 1
                downloaded = d.get('downloaded_bytes', 0)
                percent = round((downloaded / total) * 100, 1)
                
                # Robust speed extraction and fallback
                speed = d.get('_speed_str')
                if speed:
                    speed = clean_ansi(speed)
                else:
                    speed_bytes = d.get('speed')
                    if speed_bytes is not None:
                        if speed_bytes > 1024 * 1024:
                            speed = f"{speed_bytes / (1024 * 1024):.1f} MB/s"
                        elif speed_bytes > 1024:
                            speed = f"{speed_bytes / 1024:.1f} KB/s"
                        else:
                            speed = f"{speed_bytes} B/s"
                    else:
                        speed = '0 KB/s'
                speed = speed.strip()

                # Robust ETA extraction and fallback
                eta = d.get('_eta_str')
                if eta:
                    eta = clean_ansi(eta)
                else:
                    eta_val = d.get('eta')
                    if eta_val is not None:
                        mins = int(eta_val // 60)
                        secs = int(eta_val % 60)
                        eta = f"{mins:02d}:{secs:02d}"
                    else:
                        eta = '00:00'
                eta = eta.strip()
                
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

        def pp_hook(d):
            global download_state
            if d['status'] == 'started':
                pp_name = d.get('postprocessor', 'Post-processor')
                msg = f"Post-processing: Running {pp_name} (this can take a few minutes for long tracks)..."
                with progress_lock:
                    download_state["percentage"] = 100.0
                    download_state["speed"] = "Processing..."
                    download_state["eta"] = "Running..."
                    download_state["logs"].append(msg)
                    if item.id in download_state["item_states"]:
                        download_state["item_states"][item.id].update({
                            "status": "downloading",
                            "percentage": 100.0,
                            "speed": "Processing..."
                        })
            elif d['status'] == 'finished':
                with progress_lock:
                    download_state["speed"] = "Finishing..."
                    download_state["eta"] = "Finishing..."

        # Check for local duplicates first
        duplicate_path = check_local_duplicate(item.title, request.format, target_dir)
        
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
            success_count += 1
            update_history_track_status(
                job_id=job_id,
                track_id=item.id,
                status="skipped",
                percentage=100.0,
                end_time=datetime.now().strftime("%H:%M:%S")
            )
            continue

        # Quality and format resolution
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [progress_hook],
            'postprocessor_hooks': [pp_hook],
            'outtmpl': os.path.join(target_dir, '%(title)s.%(ext)s'),
            'download_archive': os.path.join(target_dir, 'download_archive.txt'),
            'nooverwrites': True,
            'noplaylist': True,
            'writethumbnail': True,
            'socket_timeout': 15,
            'retries': 3,
            'fragment_retries': 3,
            'no_interactive': True,
            'postprocessor_args': {
                'ffmpeg': ['-y'],
            },
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
                import traceback
                traceback.print_exc()
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
            success_count += 1
            update_history_track_status(
                job_id=job_id,
                track_id=item.id,
                status="completed",
                percentage=100.0,
                end_time=datetime.now().strftime("%H:%M:%S")
            )
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
            failure_count += 1
            update_history_track_status(
                job_id=job_id,
                track_id=item.id,
                status="error",
                percentage=0.0,
                end_time=datetime.now().strftime("%H:%M:%S"),
                error_detail=error_msg
            )

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
    # Establish target custom directory
    target_dir = req.download_dir or DOWNLOAD_DIR
    os.makedirs(target_dir, exist_ok=True)
    
    # Get incremental job number from history
    job_id = f"job_{int(time.time())}"
    timestamp = datetime.now().isoformat()
    
    title = req.playlist_title or (req.items[0].title if req.items else "Single Video")
    url = req.playlist_url or (req.items[0].url if req.items else "")

    with history_lock:
        history = load_history()
        
        # Check for existing job with the same URL (excluding empty URLs)
        existing_job = None
        if url:
            for job in history:
                if job.get("url") == url:
                    existing_job = job
                    break
        
        if existing_job:
            # Reuse existing job
            job_id = existing_job["id"]
            new_job_num = existing_job["job_num"]
            title = existing_job["title"]
            
            # Find and append delta tracks or resume incomplete ones
            existing_items_map = {it["id"]: it for it in existing_job.get("items", [])}
            delta_items = []
            for item in req.items:
                if item.id not in existing_items_map:
                    new_item_dict = {
                        "id": item.id,
                        "title": item.title,
                        "uploader": item.uploader or "Unknown",
                        "duration": item.duration or 0,
                        "thumbnail": item.thumbnail,
                        "url": item.url,
                        "status": "queued",
                        "percentage": 0.0,
                        "speed": "--",
                        "start_time": "--",
                        "end_time": "--",
                        "error_detail": ""
                    }
                    existing_job.setdefault("items", []).append(new_item_dict)
                    delta_items.append(item)
                else:
                    existing_track = existing_items_map[item.id]
                    if existing_track.get("status") not in ["completed", "skipped"]:
                        # Reset to queued state to download it
                        existing_track["status"] = "queued"
                        existing_track["percentage"] = 0.0
                        existing_track["speed"] = "--"
                        existing_track["start_time"] = "--"
                        existing_track["end_time"] = "--"
                        existing_track["error_detail"] = ""
                        delta_items.append(item)
            
            existing_job["total_tracks"] = len(existing_job["items"])
            existing_job["format"] = req.format
            existing_job["quality"] = req.quality
            save_history(history)
            
            # Queue only delta items for downloading
            import copy
            req_queued = copy.copy(req)
            req_queued.items = delta_items
        else:
            # Create a brand new job entry
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
                "success_count": 0,
                "failure_count": 0,
                "is_playlist": len(req.items) > 1 or req.playlist_url is not None,
                "format": req.format,
                "quality": req.quality,
                "download_dir": target_dir,
                "pinned": False,
                "items": [
                    {
                        "id": item.id,
                        "title": item.title,
                        "uploader": item.uploader or "Unknown",
                        "duration": item.duration or 0,
                        "thumbnail": item.thumbnail,
                        "url": item.url,
                        "status": "queued",
                        "percentage": 0.0,
                        "speed": "--",
                        "start_time": "--",
                        "end_time": "--",
                        "error_detail": ""
                    }
                    for item in req.items
                ]
            }
            history.insert(0, new_entry)
            save_history(history)
            req_queued = req

    # Sort items so that shorter tracks are downloaded first, and larger/longer tracks are downloaded last!
    if req_queued.items:
        req_queued.items.sort(key=lambda x: x.duration or 0)

    # Push to task queue
    job_data = {
        "job_id": job_id,
        "job_num": new_job_num,
        "title": title,
        "request": req_queued
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
                    "quality": j["request"].quality,
                    "download_dir": j["request"].download_dir
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
        history = load_history()
        
        # 1. Compute union of all completed/skipped tracks for "All Downloads"
        unique_tracks = {}
        for job in history:
            if job.get("deleted") or job.get("id") == "deleted_tracks":
                continue
            for item in job.get("items", []):
                if item.get("status") in ["completed", "skipped"]:
                    track_id = item.get("id")
                    if track_id not in unique_tracks:
                        copied = dict(item)
                        copied["status"] = "completed"
                        copied["percentage"] = 100.0
                        unique_tracks[track_id] = copied
                        
        all_downloads_job = {
            "id": "all_downloads",
            "job_num": 0,
            "title": "All Downloads",
            "url": "",
            "format": "audio",
            "quality": "highest",
            "items": list(unique_tracks.values()),
            "total_tracks": len(unique_tracks),
            "success_count": len(unique_tracks),
            "failure_count": 0,
            "completed_tracks": len(unique_tracks),
            "pinned": False,
            "deleted": False,
            "is_virtual": True
        }
        
        # 2. Find or synthesize "Deleted Tracks"
        deleted_tracks_job = None
        for job in history:
            if job.get("id") == "deleted_tracks":
                deleted_tracks_job = job
                break
                
        if not deleted_tracks_job:
            deleted_tracks_job = {
                "id": "deleted_tracks",
                "job_num": 0,
                "title": "Deleted Tracks",
                "url": "",
                "format": "audio",
                "quality": "highest",
                "items": [],
                "total_tracks": 0,
                "success_count": 0,
                "failure_count": 0,
                "completed_tracks": 0,
                "pinned": False,
                "deleted": False,
                "is_virtual": True
            }
            history.append(deleted_tracks_job)
            save_history(history)
            
        return [all_downloads_job] + history

@app.post("/api/history/clear")
async def clear_history():
    with history_lock:
        save_history([])
    return {"message": "History cleared"}

class ResumeRequest(BaseModel):
    job_id: str
    force_all: bool = False

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
    url = get_clean_playlist_url(url)
    original_dir = job.get("download_dir", DOWNLOAD_DIR)

    # 2. Extract playlist entries from YouTube
    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 15,
        'no_interactive': True,
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
            entry_title = entry.get('title') or "Unknown Title"
            entry_url = f"https://www.youtube.com/watch?v={video_id}" if is_playlist else url
            entry_uploader = entry.get('uploader') or entry.get('channel') or "Unknown"
            entry_duration = entry.get('duration') or 0
            entry_thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if is_playlist else entry.get('thumbnail')
            entries.append(DownloadItem(
                id=video_id,
                title=entry_title,
                url=entry_url,
                uploader=entry_uploader,
                duration=entry_duration,
                thumbnail=entry_thumb
            ))
            
        # 3. Update existing job items state in history
        with history_lock:
            history = load_history()
            target_job = None
            for item in history:
                if item.get("id") == req.job_id:
                    target_job = item
                    break
                    
            if not target_job:
                raise HTTPException(status_code=404, detail="Job not found")

            # Populates items list if it was missing (fallback for old items)
            if not target_job.get("items"):
                target_job["items"] = [
                    {
                        "id": item.id,
                        "title": item.title,
                        "uploader": item.uploader or "Unknown",
                        "duration": item.duration or 0,
                        "thumbnail": item.thumbnail,
                        "url": item.url,
                        "status": "queued",
                        "percentage": 0.0,
                        "speed": "--",
                        "start_time": "--",
                        "end_time": "--",
                        "error_detail": ""
                    }
                    for item in entries
                ]
            else:
                # Merge any newly discovered items
                existing_ids = {it["id"] for it in target_job["items"]}
                for item in entries:
                    if item.id not in existing_ids:
                        target_job["items"].append({
                            "id": item.id,
                            "title": item.title,
                            "uploader": item.uploader or "Unknown",
                            "duration": item.duration or 0,
                            "thumbnail": item.thumbnail,
                            "url": item.url,
                            "status": "queued",
                            "percentage": 0.0,
                            "speed": "--",
                            "start_time": "--",
                            "end_time": "--",
                            "error_detail": ""
                        })

            # Reset status of items that need downloading
            tracks_to_download = []
            for track in target_job["items"]:
                is_done = track.get("status") in ["completed", "skipped"]
                if req.force_all or not is_done:
                    track["status"] = "queued"
                    track["percentage"] = 0.0
                    track["speed"] = "--"
                    track["start_time"] = "--"
                    track["end_time"] = "--"
                    track["error_detail"] = ""
                    
                    tracks_to_download.append(DownloadItem(
                        id=track["id"],
                        title=track["title"],
                        url=track["url"],
                        uploader=track["uploader"],
                        duration=track["duration"],
                        thumbnail=track["thumbnail"]
                    ))

            target_job["total_tracks"] = len(target_job["items"])
            save_history(history)
            
            job_id = target_job["id"]
            job_num = target_job["job_num"]
            title = target_job["title"]
            frontend_entries = target_job["items"]

        # Sort items so that shorter tracks are downloaded first, and larger/longer tracks are downloaded last!
        if tracks_to_download:
            tracks_to_download.sort(key=lambda x: x.duration or 0)

        # 4. Queue download
        dl_req = DownloadRequest(
            items=tracks_to_download,
            format=job.get("format", "audio"),
            quality=job.get("quality", "highest"),
            playlist_title=title,
            playlist_url=url,
            skip_duplicates=not req.force_all,
            download_dir=original_dir
        )
        
        job_data = {
            "job_id": job_id,
            "job_num": job_num,
            "title": title,
            "request": dl_req
        }
        
        with queue_lock:
            queue_state["pending_jobs"].append(job_data)
            
        download_queue.put(job_data)
        return {"message": "Job resumed and queued", "job_id": job_id, "job_num": job_num, "title": title, "url": url, "entries": frontend_entries}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resumption failed: {str(e)}")

class OpenFolderRequest(BaseModel):
    download_dir: Optional[str] = None

@app.post("/api/open-folder")
async def open_folder(req: OpenFolderRequest):
    target_dir = req.download_dir or DOWNLOAD_DIR
    os.makedirs(target_dir, exist_ok=True)
    try:
        if sys.platform == "win32":
            os.startfile(target_dir)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", target_dir])
        else:
            subprocess.Popen(["xdg-open", target_dir])
        return {"message": "Folder opened"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open downloads directory: {str(e)}")

class PlayRequest(BaseModel):
    title: str
    format: str
    download_dir: Optional[str] = None

@app.post("/api/play-file")
async def play_file(req: PlayRequest):
    target_dir = req.download_dir or DOWNLOAD_DIR
    duplicate_path = check_local_duplicate(req.title, req.format, target_dir)
    if not duplicate_path or not os.path.exists(duplicate_path):
        raise HTTPException(status_code=404, detail="Local file not found. Ensure it has finished downloading.")
    try:
        if sys.platform == "win32":
            os.startfile(duplicate_path)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", duplicate_path])
        else:
            subprocess.Popen(["xdg-open", duplicate_path])
        return {"message": "Playing file"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to play file: {str(e)}")

@app.get("/api/settings/dir")
async def get_default_dir():
    return {"download_dir": DOWNLOAD_DIR}

@app.post("/api/settings/browse")
async def browse_dir():
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True) # Force focus to front
        
        folder = filedialog.askdirectory(title="Select Download Directory")
        root.destroy()
        
        if folder:
            folder = os.path.normpath(folder)
            return {"download_dir": folder}
        return {"download_dir": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open browse dialog: {str(e)}")

@app.post("/api/history/{job_id}/pin")
async def pin_job(job_id: str):
    with history_lock:
        history = load_history()
        found = False
        pinned_state = False
        for job in history:
            if job.get("id") == job_id:
                job["pinned"] = not job.get("pinned", False)
                pinned_state = job["pinned"]
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Job not found")
        save_history(history)
    return {"message": "Job pin status toggled", "pinned": pinned_state}

@app.delete("/api/history/{job_id}")
async def delete_job(job_id: str):
    with history_lock:
        history = load_history()
        found = False
        for job in history:
            if job.get("id") == job_id:
                if job.get("deleted"):
                    # Already soft-deleted: delete PERMANENTLY!
                    history.remove(job)
                else:
                    # Soft delete!
                    job["deleted"] = True
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Job not found")
        save_history(history)
    return {"message": "Job deleted successfully"}

@app.post("/api/history/{job_id}/restore")
async def restore_job(job_id: str):
    with history_lock:
        history = load_history()
        found = False
        for job in history:
            if job.get("id") == job_id:
                job["deleted"] = False
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Job not found")
        save_history(history)
    return {"message": "Playlist restored successfully"}

@app.post("/api/playlists/create")
async def create_playlist(req: CreatePlaylistRequest):
    with history_lock:
        history = load_history()
        job_id = f"manual_{int(time.time())}"
        
        max_num = 0
        for job in history:
            if "job_num" in job:
                max_num = max(max_num, job["job_num"])
                
        new_job = {
            "id": job_id,
            "job_num": max_num + 1,
            "title": req.title,
            "url": "",
            "format": "audio",
            "quality": "highest",
            "items": [],
            "total_tracks": 0,
            "success_count": 0,
            "failure_count": 0,
            "completed_tracks": 0,
            "pinned": False,
            "deleted": False
        }
        history.insert(0, new_job)
        save_history(history)
    return new_job

@app.post("/api/playlists/import")
async def import_playlist(req: ImportFolderRequest):
    if not os.path.exists(req.folder_path):
        raise HTTPException(status_code=400, detail="Folder path does not exist")
        
    audio_exts = [".mp3", ".m4a", ".mp4", ".wav", ".webm", ".aac"]
    items = []
    
    try:
        for filename in os.listdir(req.folder_path):
            name, ext = os.path.splitext(filename)
            if ext.lower() in audio_exts:
                file_path = os.path.join(req.folder_path, filename)
                item_id = f"local_{abs(hash(file_path))}"
                items.append({
                    "id": item_id,
                    "title": name,
                    "uploader": "Local Folder",
                    "duration": 0,
                    "thumbnail": "https://i.ytimg.com/vi/default/hqdefault.jpg",
                    "url": file_path,
                    "status": "completed",
                    "percentage": 100.0,
                    "speed": "--",
                    "start_time": "--",
                    "end_time": "--",
                    "error_detail": ""
                })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to scan folder: {str(e)}")
        
    if len(items) == 0:
        raise HTTPException(status_code=400, detail="No audio/video files found in selected folder")
        
    with history_lock:
        history = load_history()
        job_id = f"manual_{int(time.time())}"
        max_num = 0
        for job in history:
            if "job_num" in job:
                max_num = max(max_num, job["job_num"])
                
        new_job = {
            "id": job_id,
            "job_num": max_num + 1,
            "title": req.title,
            "url": "",
            "format": "audio",
            "quality": "highest",
            "items": items,
            "total_tracks": len(items),
            "success_count": len(items),
            "failure_count": 0,
            "completed_tracks": len(items),
            "pinned": False,
            "deleted": False
        }
        history.insert(0, new_job)
        save_history(history)
    return new_job

@app.post("/api/settings/browse-folder")
async def browse_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog
        
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        
        folder = filedialog.askdirectory(title="Select Folder to Import")
        root.destroy()
        
        if folder:
            folder = os.path.normpath(folder)
            return {"folder_path": folder}
        return {"folder_path": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open browse dialog: {str(e)}")

@app.post("/api/playlists/{job_id}/add-track")
async def add_track(job_id: str, item: DownloadItem):
    with history_lock:
        history = load_history()
        found = False
        for job in history:
            if job.get("id") == job_id:
                target_dir = job.get("download_dir", DOWNLOAD_DIR)
                local_path = check_local_duplicate(item.title, job.get("format", "audio"), target_dir)
                status = "completed" if local_path and os.path.exists(local_path) else "queued"
                
                new_item = {
                    "id": item.id,
                    "title": item.title,
                    "uploader": item.uploader or "Unknown",
                    "duration": item.duration or 0,
                    "thumbnail": item.thumbnail,
                    "url": item.url,
                    "status": status,
                    "percentage": 100.0 if status == "completed" else 0.0,
                    "speed": "--",
                    "start_time": "--",
                    "end_time": "--",
                    "error_detail": ""
                }
                
                job.setdefault("items", []).append(new_item)
                job["total_tracks"] = len(job["items"])
                
                success = sum(1 for t in job["items"] if t.get("status") in ["completed", "skipped"])
                job["success_count"] = success
                job["completed_tracks"] = success
                found = True
                break
                
        if not found:
            raise HTTPException(status_code=404, detail="Playlist not found")
        save_history(history)
    return {"message": "Track added successfully"}

@app.delete("/api/history/{job_id}/tracks/{track_id}")
async def delete_track(job_id: str, track_id: str):
    with history_lock:
        history = load_history()
        track_to_delete = None
        
        for job in history:
            if job.get("id") == job_id:
                items = job.get("items", [])
                for track in items:
                    if track.get("id") == track_id:
                        track_to_delete = dict(track)
                        items.remove(track)
                        break
                job["total_tracks"] = len(items)
                success = sum(1 for t in items if t.get("status") in ["completed", "skipped"])
                job["success_count"] = success
                job["completed_tracks"] = success
                break
                
        if not track_to_delete:
            raise HTTPException(status_code=404, detail="Track not found in playlist")
            
        deleted_playlist = None
        for job in history:
            if job.get("id") == "deleted_tracks":
                deleted_playlist = job
                break
                
        if not deleted_playlist:
            deleted_playlist = {
                "id": "deleted_tracks",
                "job_num": 0,
                "title": "Deleted Tracks",
                "url": "",
                "format": "audio",
                "quality": "highest",
                "items": [],
                "total_tracks": 0,
                "success_count": 0,
                "failure_count": 0,
                "completed_tracks": 0,
                "pinned": False,
                "deleted": False
            }
            history.append(deleted_playlist)
            
        track_to_delete["original_playlist_id"] = job_id
        deleted_playlist["items"].append(track_to_delete)
        deleted_playlist["total_tracks"] = len(deleted_playlist["items"])
        
        save_history(history)
    return {"message": "Track soft-deleted and moved to trash"}

@app.post("/api/history/deleted-tracks/{track_id}/restore")
async def restore_track(track_id: str):
    with history_lock:
        history = load_history()
        track_to_restore = None
        deleted_playlist = None
        
        for job in history:
            if job.get("id") == "deleted_tracks":
                deleted_playlist = job
                items = job.get("items", [])
                for track in items:
                    if track.get("id") == track_id:
                        track_to_restore = dict(track)
                        items.remove(track)
                        break
                job["total_tracks"] = len(items)
                break
                
        if not track_to_restore:
            raise HTTPException(status_code=404, detail="Deleted track not found")
            
        original_id = track_to_restore.get("original_playlist_id")
        restored = False
        if original_id:
            for job in history:
                if job.get("id") == original_id:
                    track_to_restore.pop("original_playlist_id", None)
                    job.setdefault("items", []).append(track_to_restore)
                    job["total_tracks"] = len(job["items"])
                    success = sum(1 for t in job["items"] if t.get("status") in ["completed", "skipped"])
                    job["success_count"] = success
                    job["completed_tracks"] = success
                    restored = True
                    break
                    
        if not restored:
            raise HTTPException(status_code=400, detail="Original playlist does not exist anymore.")
            
        save_history(history)
    return {"message": "Track restored successfully"}

@app.delete("/api/history/deleted-tracks/{track_id}/permanent")
async def delete_track_permanent(track_id: str):
    with history_lock:
        history = load_history()
        found = False
        for job in history:
            if job.get("id") == "deleted_tracks":
                items = job.get("items", [])
                for track in items:
                    if track.get("id") == track_id:
                        items.remove(track)
                        found = True
                        break
                job["total_tracks"] = len(items)
                break
        if not found:
            raise HTTPException(status_code=404, detail="Track not found in trash")
        save_history(history)
    return {"message": "Track deleted permanently"}

@app.post("/api/history/{job_id}/items")
async def save_job_items(job_id: str, req: SaveItemsRequest):
    with history_lock:
        history = load_history()
        found = False
        for job in history:
            if job.get("id") == job_id:
                job["items"] = [
                    {
                        "id": item.id,
                        "title": item.title,
                        "uploader": item.uploader or "Unknown",
                        "duration": item.duration or 0,
                        "thumbnail": item.thumbnail,
                        "url": item.url,
                        "status": "queued",
                        "percentage": 0.0,
                        "speed": "--",
                        "start_time": "--",
                        "end_time": "--",
                        "error_detail": ""
                    }
                    for item in req.items
                ]
                job["total_tracks"] = len(job["items"])
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Job not found")
        save_history(history)
    return {"message": "Job items saved successfully"}

@app.post("/api/history/{job_id}/last-played")
async def save_last_played(job_id: str, req: LastPlayedRequest):
    with history_lock:
        history = load_history()
        found = False
        for job in history:
            if job.get("id") == job_id:
                job["last_played_track_id"] = req.track_id
                job["last_played_shuffle"] = req.shuffle_mode
                job["shuffle_order"] = req.shuffle_order
                job["shuffle_index"] = req.shuffle_index
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Job not found")
        save_history(history)
    return {"message": "Playback position saved successfully"}

@app.get("/api/media/stream")
async def stream_media(video_url: str, title: str, format: str, download_dir: Optional[str] = None):
    target_dir = download_dir or DOWNLOAD_DIR
    local_path = check_local_duplicate(title, format, target_dir)
    if local_path and os.path.exists(local_path):
        return FileResponse(local_path)
        
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
    }
    if format == "audio":
        ydl_opts['format'] = 'bestaudio/best'
    else:
        ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best/bestvideo+bestaudio'
        
    try:
        loop = asyncio.get_event_loop()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = await loop.run_in_executor(None, lambda: ydl.extract_info(video_url, download=False))
            stream_url = info.get('url')
            if stream_url:
                return RedirectResponse(stream_url)
    except Exception as e:
        print(f"Streaming extraction failed: {e}")
    raise HTTPException(status_code=404, detail="Media stream URL could not be resolved")

@app.post("/api/history/{job_id}/refresh")
async def refresh_job(job_id: str):
    with history_lock:
        history = load_history()
        
    job = None
    for item in history:
        if item.get("id") == job_id:
            job = item
            break
            
    if not job:
        raise HTTPException(status_code=404, detail="Job not found in history")
        
    url = job.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Job does not have a URL associated")
        
    url = get_clean_playlist_url(url)
    original_dir = job.get("download_dir", DOWNLOAD_DIR)
    
    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 15,
        'no_interactive': True,
    }
    
    try:
        loop = asyncio.get_event_loop()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = await loop.run_in_executor(None, lambda: ydl.extract_info(url, download=False))
            
        if not info:
            raise HTTPException(status_code=400, detail="Could not retrieve video information")
            
        is_playlist = info.get('_type') == 'playlist'
        raw_items = info.get('entries', []) if is_playlist else [info]
        
        # Get current tracks in history
        existing_ids = {track.get("id") for track in job.get("items", [])}
        
        new_tracks = []
        new_entries_for_download = []
        
        for entry in raw_items:
            if not entry:
                continue
            video_id = entry.get('id') or entry.get('url')
            if not video_id:
                continue
                
            entry_title = entry.get('title') or "Unknown Title"
            entry_url = f"https://www.youtube.com/watch?v={video_id}" if is_playlist else url
            entry_uploader = entry.get('uploader') or entry.get('channel') or "Unknown"
            entry_duration = entry.get('duration') or 0
            entry_thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if is_playlist else entry.get('thumbnail')
            
            track_data = {
                "id": video_id,
                "title": entry_title,
                "uploader": entry_uploader,
                "duration": entry_duration,
                "thumbnail": entry_thumb,
                "url": entry_url,
                "status": "queued",
                "percentage": 0.0,
                "speed": "--",
                "start_time": "--",
                "end_time": "--",
                "error_detail": ""
            }
            
            if video_id not in existing_ids:
                new_tracks.append(track_data)
                new_entries_for_download.append(DownloadItem(
                    id=video_id,
                    title=entry_title,
                    url=entry_url,
                    uploader=entry_uploader,
                    duration=entry_duration,
                    thumbnail=entry_thumb
                ))
                
        if not new_tracks:
            return {"message": "No new tracks found. Playlist is up to date.", "new_count": 0}
            
        # Update job in history
        with history_lock:
            history = load_history()
            target_job = None
            for item in history:
                if item.get("id") == job_id:
                    target_job = item
                    if "items" not in item:
                        item["items"] = []
                    item["items"].extend(new_tracks)
                    item["total_tracks"] = len(item["items"])
                    break
            save_history(history)
            
            if target_job:
                existing_job_num = target_job["job_num"]
                existing_title = target_job["title"]
            else:
                existing_job_num = job.get("job_num", 1)
                existing_title = job.get("title", "YouTube Playlist")
            
        # Sort items so that shorter tracks are downloaded first, and larger/longer tracks are downloaded last!
        if new_entries_for_download:
            new_entries_for_download.sort(key=lambda x: x.duration or 0)

        # Queue the download for ONLY the new tracks
        dl_req = DownloadRequest(
            items=new_entries_for_download,
            format=job.get("format", "audio"),
            quality=job.get("quality", "highest"),
            playlist_title=existing_title,
            playlist_url=url,
            skip_duplicates=True,
            download_dir=original_dir
        )
        
        job_data = {
            "job_id": job_id,
            "job_num": existing_job_num,
            "title": existing_title,
            "request": dl_req
        }
        
        with queue_lock:
            queue_state["pending_jobs"].append(job_data)
            
        download_queue.put(job_data)
        return {"message": f"Queued {len(new_tracks)} new tracks", "new_count": len(new_tracks), "job_id": job_id, "job_num": existing_job_num}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# Wi-Fi Sync module (branch: feature/wifi-sync)
#
# Lets the companion iPhone app (MusicApp) pull playlists and audio files over
# the local network. Fully additive — nothing above this line was modified.
#
# - Disabled by default. Enable via wifi_sync_setup.py (writes sync_config.json
#   next to history.json; gui.py binds the server to the LAN only when enabled).
# - Every endpoint except /api/sync/info requires the pairing token from
#   sync_config.json (header `X-Sync-Token` or `?token=`). Requests from
#   127.0.0.1 that carry no token are allowed, so the desktop UI could call
#   these endpoints too.
# - Audio only by design: video jobs are excluded from the manifest.
# =============================================================================
import secrets
from fastapi import Request

SYNC_CONFIG_FILE = os.path.join(BASE_DIR, "sync_config.json")
sync_config_lock = threading.Lock()

def load_sync_config() -> dict:
    """Reads sync_config.json, creating it (disabled, fresh pairing token) on first use."""
    with sync_config_lock:
        cfg = {"enabled": False, "port": 8765}
        if os.path.exists(SYNC_CONFIG_FILE):
            try:
                with open(SYNC_CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg.update(json.load(f))
            except Exception:
                pass
        if not cfg.get("token"):
            cfg["token"] = secrets.token_hex(16)
            try:
                with open(SYNC_CONFIG_FILE, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, indent=2)
            except Exception:
                pass
        return cfg

def _sync_auth(request: Request):
    """Token check: a supplied token must match; no token is OK only from localhost."""
    cfg = load_sync_config()
    supplied = request.headers.get("x-sync-token") or request.query_params.get("token")
    if supplied:
        if secrets.compare_digest(supplied, str(cfg.get("token", ""))):
            return
        raise HTTPException(status_code=401, detail="Invalid sync token")
    client_host = request.client.host if request.client else ""
    if client_host in ("127.0.0.1", "::1"):
        return
    raise HTTPException(status_code=401, detail="Sync token required")

def _clean_fuzzy_sync(s: str) -> str:
    # Same normalization rule as check_local_duplicate() so title->file matching
    # behaves identically to the in-app player.
    return "".join(c.lower() for c in s if c.isalnum())

def _build_file_index(download_dir: str) -> dict:
    """fuzzy-title -> filename for every .mp3 in a folder (one listdir per folder)."""
    index = {}
    try:
        if os.path.exists(download_dir):
            for f in os.listdir(download_dir):
                name, ext = os.path.splitext(f)
                if ext.lower() == ".mp3":
                    index[_clean_fuzzy_sync(name)] = f
    except Exception:
        pass
    return index

def build_sync_manifest() -> dict:
    """All non-deleted audio playlists with exact local filenames per track."""
    with history_lock:
        history = load_history()

    dir_indexes: dict = {}
    playlists = []
    for job in history:
        if job.get("deleted") or job.get("id") in ("all_downloads", "deleted_tracks"):
            continue
        if job.get("format", "audio") != "audio":
            continue
        target_dir = job.get("download_dir", DOWNLOAD_DIR)
        if target_dir not in dir_indexes:
            dir_indexes[target_dir] = _build_file_index(target_dir)
        index = dir_indexes[target_dir]

        tracks = []
        for item in job.get("items", []):
            title = item.get("title", "")
            filename = index.get(_clean_fuzzy_sync(title)) if title else None
            tracks.append({
                "file": filename,
                "title": title,
                "artist": item.get("uploader") or "Unknown Artist",
                "duration": item.get("duration") or 0,
                "youtube_id": item.get("id", ""),
            })

        playlists.append({
            "id": job.get("id", ""),
            "title": job.get("title", "Untitled"),
            "pinned": bool(job.get("pinned")),
            "track_count": len(tracks),
            "available_count": sum(1 for t in tracks if t["file"]),
            "tracks": tracks,
        })

    return {
        "version": 1,
        "app": "SonicStream",
        "exported_at": datetime.now().isoformat(),
        "playlists": playlists,
    }

@app.get("/api/sync/info")
async def sync_info():
    """Tokenless discovery ping so the phone can identify the server."""
    cfg = load_sync_config()
    return {"app": "SonicStream", "sync_version": 1, "wifi_sync_enabled": bool(cfg.get("enabled"))}

@app.get("/api/sync/manifest")
async def sync_manifest(request: Request):
    _sync_auth(request)
    return build_sync_manifest()

@app.get("/api/sync/file/{playlist_id}/{filename}")
async def sync_file(playlist_id: str, filename: str, request: Request):
    _sync_auth(request)
    if filename != os.path.basename(filename) or filename in ("", ".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")

    with history_lock:
        history = load_history()
    job = next((j for j in history if j.get("id") == playlist_id), None)
    if job is None:
        raise HTTPException(status_code=404, detail="Playlist not found")

    target_dir = os.path.abspath(job.get("download_dir", DOWNLOAD_DIR))
    file_path = os.path.abspath(os.path.join(target_dir, filename))
    if os.path.commonpath([file_path, target_dir]) != target_dir:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, media_type="audio/mpeg", filename=filename)

@app.post("/api/sync/export-manifest")
async def sync_export_manifest(request: Request):
    """Writes playlists_manifest.json into the downloads folder, so the playlist
    structure travels with the files on any transfer path (USB copy, OneDrive)."""
    _sync_auth(request)
    manifest = build_sync_manifest()
    out_path = os.path.join(DOWNLOAD_DIR, "playlists_manifest.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return {"message": "Manifest exported", "path": out_path, "playlists": len(manifest["playlists"])}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
