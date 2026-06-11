from pathlib import Path
from typing import Any, Dict, List, Tuple

from .. import agent_internvideo_server as legacy


def load_tracks_and_metadata(
    tracks_path: Path,
    video_path: Path,
    context: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Tuple[int, int], float, int]:
    return legacy._load_tracks_and_metadata(tracks_path, video_path, context)
