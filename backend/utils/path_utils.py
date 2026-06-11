from pathlib import Path

from .. import agent_internvideo_server as legacy


def resolve_path(raw: str) -> Path:
    return legacy.resolve_path(raw)
