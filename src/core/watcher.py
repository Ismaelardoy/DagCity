import os
import asyncio
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from typing import Set, Callable

class ManifestEventHandler(FileSystemEventHandler):
    """
    Senior Watchman: Detects dbt manifest modifications.
    Uses a small debounce to avoid partial read issues.
    """
    def __init__(self, manifest_path: str, on_change_callback: Callable):
        self.manifest_path = os.path.abspath(manifest_path)
        self.manifest_dir = os.path.dirname(self.manifest_path)
        self.on_change_callback = on_change_callback
        self.last_triggered = 0
        self.debounce_seconds = 0.5

    def on_modified(self, event):
        if event.is_directory:
            return
        
        event_path = os.path.abspath(event.src_path)
        if event_path.endswith("manifest.json"):
            now = time.time()
            if now - self.last_triggered > self.debounce_seconds:
                self.last_triggered = now
                # Extract project name from path (assumes /data/projects/{name}/manifest.json)
                parts = event_path.split(os.sep)
                project_name = None
                try:
                    # Look for the part after 'projects'
                    idx = parts.index("projects")
                    if idx + 1 < len(parts):
                        project_name = parts[idx+1]
                except ValueError:
                    pass

                print(f"[WATCHER] Change detected in {event_path} (Project: {project_name})")
                self.on_change_callback(project_name)

class ManifestWatcher:
    """
    Containerized Watcher Engine.
    Orchestrates the watchdog observer and bridges it to the FastAPI async loop.
    """
    def __init__(self, manifest_path: str, loop: asyncio.AbstractEventLoop):
        self.manifest_path = manifest_path
        self.loop = loop
        self.subscribers: Set[asyncio.Queue] = set()
        self.observer = None
        
        # Determine directory to watch
        self.watch_dir = os.path.dirname(os.path.abspath(manifest_path))
        if not os.path.exists(self.watch_dir):
            os.makedirs(self.watch_dir, exist_ok=True)

    def start(self, recursive: bool = False):
        print(f"[*] Starting Watchdog on: {self.watch_dir} (Recursive: {recursive})...")
        handler = ManifestEventHandler(self.manifest_path, self._trigger_event)
        self.observer = Observer()
        self.observer.schedule(handler, self.watch_dir, recursive=recursive)
        self.observer.start()

    def stop(self):
        if self.observer:
            self.observer.stop()
            self.observer.join()

    def _trigger_event(self, project_name: str = None):
        """Bridge from watchdog thread to asyncio loop."""
        for queue in list(self.subscribers):
            self.loop.call_soon_threadsafe(queue.put_nowait, project_name)

    def subscribe(self) -> asyncio.Queue:
        queue = asyncio.Queue()
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        self.subscribers.discard(queue)
