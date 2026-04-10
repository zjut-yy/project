from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .. import agent_internvideo_server as legacy


def ensure_model() -> None:
    legacy.ensure_model()


def run(
    user_text: str,
    video_path: Optional[Path],
    image_b64: Optional[str] = None,
    bound: Optional[Tuple[float, float]] = None,
    tracks_summary: Optional[str] = None,
) -> Optional[str]:
    return legacy.run_internvideo(user_text, video_path, image_b64=image_b64, bound=bound, tracks_summary=tracks_summary)


def run_from_plan(
    user_text: str,
    video_path: Optional[Path],
    unified_plan: Optional[Dict[str, Any]],
    tracks_path: Optional[Path] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    return legacy.run_internvideo_from_qwen_plan(
        user_text=user_text,
        video_path=video_path,
        unified_plan=unified_plan,
        tracks_path=tracks_path,
        context=context,
    )
