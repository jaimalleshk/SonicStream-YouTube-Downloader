import os
import sys
import socket
import threading
import time
import uvicorn
import webview
from main import app

# Helper to find a free local port
def find_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

# Runner for the FastAPI backend
def start_server(port):
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    # Ensure correct base path for compiled execution (.exe)
    if getattr(sys, 'frozen', False):
        base_dir = sys._MEIPASS
        # Set working directory to static folder's parent
        os.chdir(os.path.dirname(sys.executable))
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    
    port = find_free_port()

    # Start FastAPI in a background daemon thread
    t = threading.Thread(target=start_server, args=(port,), daemon=True)
    t.start()
    
    # Wait for the server to spin up
    time.sleep(1.2)
    
    # Start native desktop window
    webview.create_window(
        title="SonicStream - YouTube Downloader",
        url=f"http://127.0.0.1:{port}",
        width=1120,
        height=820,
        min_size=(800, 600),
        resizable=True
    )
    webview.start()
