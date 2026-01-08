
import json
import os
from typing import List

CONFIG_FILE = "backend/data/config.json"

class ConfigRepository:
    def __init__(self):
        self.file_path = CONFIG_FILE
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        if not os.path.exists(os.path.dirname(self.file_path)):
            os.makedirs(os.path.dirname(self.file_path))
        if not os.path.exists(self.file_path):
            with open(self.file_path, 'w') as f:
                json.dump({"blocked_dates": []}, f)

    def _load_config(self):
        try:
            with open(self.file_path, 'r') as f:
                return json.load(f)
        except Exception:
            return {"blocked_dates": []}

    def _save_config(self, config):
        with open(self.file_path, 'w') as f:
            json.dump(config, f, indent=4)

    def get_blocked_dates(self) -> List[str]:
        config = self._load_config()
        return config.get("blocked_dates", [])

    def add_blocked_date(self, date_str: str):
        config = self._load_config()
        dates = set(config.get("blocked_dates", []))
        dates.add(date_str)
        config["blocked_dates"] = sorted(list(dates))
        self._save_config(config)

    def remove_blocked_date(self, date_str: str):
        config = self._load_config()
        dates = set(config.get("blocked_dates", []))
        if date_str in dates:
            dates.remove(date_str)
            config["blocked_dates"] = sorted(list(dates))
            self._save_config(config)
