from typing import Any, Dict, List

from .. import agent_internvideo_server as legacy


def detect_behaviors(track: Dict[str, Any], fps: float = 30.0) -> List[Dict[str, Any]]:
    detector = legacy.BehaviorDetector(fps=fps)
    return detector.detect_behaviors(track)
