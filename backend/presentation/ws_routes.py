from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.infrastructure.realtime.ws_manager import WSManager
import logging

router = APIRouter()
logger = logging.getLogger("uvicorn")

# Global instance for now (could be singleton or injected)
ws_manager = WSManager()

def get_ws_manager():
    return ws_manager

@router.websocket("/ws/notifications")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; we might ignore incoming messages for now
            data = await websocket.receive_text()
            # Optional: echo or handle ping/pong
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WS: Error in endpoint: {e}")
        ws_manager.disconnect(websocket)
