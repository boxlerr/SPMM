from fastapi import WebSocket, WebSocketDisconnect
from typing import List
import logging
import json

logger = logging.getLogger("uvicorn")

class WSManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WS: Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WS: Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
            
        logger.debug(f"WS: Broadcasting message to {len(self.active_connections)} clients")
        
        # Serialize once
        json_msg = json.dumps(message, ensure_ascii=False, default=str)
        
        to_remove = []
        for connection in self.active_connections:
            try:
                await connection.send_text(json_msg)
            except Exception as e:
                logger.error(f"WS: Error sending to client: {e}")
                to_remove.append(connection)
        
        # Cleanup dead connections
        for dead_conn in to_remove:
            self.disconnect(dead_conn)
