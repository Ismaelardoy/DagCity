import json
import asyncio
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse
from core.watcher import ManifestWatcher

router = APIRouter(prefix="/api", tags=["streaming"])

# Global watcher instance to be initialized in main.py
watcher_instance = None

@router.get("/live-stream")
async def live_stream(request: Request):
    """
    Server-Sent Events: Streams graph updates whenever any project
    in the workspace is modified.
    """
    async def event_generator():
        global watcher_instance
        if not watcher_instance:
            yield {"data": json.dumps({"error": "Watcher not initialized"})}
            return

        queue = watcher_instance.subscribe()
        try:
            while True:
                # Wait for a change event (returns project_name)
                project_name = await queue.get()
                
                if await request.is_disconnected():
                    break

                if not project_name:
                    continue

                # Broadcast that a specific project changed
                print(f"[📡] Broadcasting update for project: {project_name}")
                yield {"data": json.dumps({"type": "update", "project": project_name})}
        finally:
            watcher_instance.unsubscribe(queue)

    return EventSourceResponse(event_generator())
