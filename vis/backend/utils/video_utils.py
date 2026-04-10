from pathlib import Path
from typing import Optional, Tuple

from .. import agent_internvideo_server as legacy


def derive_fps(video_path: Optional[Path]) -> float:
    return legacy.derive_fps(video_path)


def build_video_tokens(
    video_path: Path,
    bound: Optional[Tuple[float, float]] = None,
    num_segments: int = 64,
    input_size: int = 448,
):
    return legacy.build_video_tokens(video_path, bound=bound, num_segments=num_segments, input_size=input_size)
