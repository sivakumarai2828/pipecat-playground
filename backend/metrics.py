import time
import json
from typing import List, Dict

class EventBus:
    def __init__(self):
        self.subscribers = []

    async def subscribe(self, websocket):
        self.subscribers.append(websocket)

    async def unsubscribe(self, websocket):
        if websocket in self.subscribers:
            self.subscribers.remove(websocket)

    async def broadcast(self, message: Dict):
        payload = json.dumps(message)
        print(f"Broadcasting to {len(self.subscribers)} subscribers: {message.get('type')}")
        for sub in self.subscribers:
            try:
                await sub.send_text(payload)
            except Exception as e:
                print(f"Broadcast error: {e}")
                pass

class MetricsTracker:
    def __init__(self):
        self.start_times = {}

    def start(self, key: str):
        self.start_times[key] = time.perf_counter()

    def end(self, key: str) -> float:
        if key in self.start_times:
            lat = (time.perf_counter() - self.start_times[key]) * 1000
            del self.start_times[key]
            return round(lat, 2)
        return 0.0
