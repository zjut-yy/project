import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    host: str = os.environ.get("AGENT_HOST", "0.0.0.0")
    port: int = int(os.environ.get("AGENT_PORT", "8010"))
    disable_model: bool = os.environ.get("DISABLE_MODEL", "0") == "1"
    default_fps: float = float(os.environ.get("DEFAULT_FPS", "30.0"))


settings = Settings()
