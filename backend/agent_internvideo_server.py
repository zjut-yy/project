from __future__ import annotations
import base64
import csv
import io
import os
import math
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Set
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum

from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

try:
    import numpy as np
    from sklearn.cluster import DBSCAN
    from sklearn.preprocessing import StandardScaler
except Exception:  # pragma: no cover
    np = None
    DBSCAN = None
    StandardScaler = None

try:
    import torch
except Exception:  # pragma: no cover
    torch = None

try:
    import torchvision.transforms as T
    from torchvision.transforms.functional import InterpolationMode
except Exception:  # pragma: no cover
    T = None
    InterpolationMode = None

try:
    from decord import VideoReader, cpu
except Exception:  # pragma: no cover
    VideoReader = None
    cpu = None

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None

try:
    from transformers import AutoModel, AutoTokenizer, AutoModelForCausalLM
except Exception:  # pragma: no cover
    AutoModel = None
    AutoTokenizer = None
    AutoModelForCausalLM = None

try:
    import httpx
except Exception:  # pragma: no cover
    httpx = None

logger = logging.getLogger("agent_iv25")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s - %(message)s")

REPO_ROOT = Path(__file__).resolve().parents[2]
VIS_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as exc:
        logger.warning("Failed to load env file %s: %s", path, exc)


_load_dotenv(VIS_DIR / ".env")


def _local_path(raw: Any, base: Path = VIS_DIR) -> Path:
    path = Path(str(raw)).expanduser()
    if path.is_absolute():
        return path.resolve()
    return (base / path).resolve()


MODEL_ROOT = _local_path(os.environ.get("MODEL_ROOT", str(BACKEND_DIR / "model")))
DATASET_ROOT = _local_path(os.environ.get("DATASET_ROOT", str(BACKEND_DIR / "dataset")))
MODEL_DIR = _local_path(os.environ.get("INTERNVIDEO_MODEL_PATH", str(MODEL_ROOT / "InternVideo2.5")))
MODEL_DIR_ALIAS = MODEL_DIR.parent / "InternVideo2"
DEFAULT_PORT = int(os.environ.get("AGENT_PORT", "8010"))
DISABLE_MODEL = os.environ.get("DISABLE_MODEL", "0") == "1"
DEFAULT_FPS = float(os.environ.get("DEFAULT_FPS", "30.0"))
EVENT_MAX = int(os.environ.get("EVENT_MAX", "5"))
IV_LOG_PROMPT_IO = os.environ.get("IV_LOG_PROMPT_IO", "1").strip() != "0"
IV_LOG_MAX_CHARS = max(256, int(os.environ.get("IV_LOG_MAX_CHARS", "4000")))


def _clip_log_text(raw: Any, max_chars: int = IV_LOG_MAX_CHARS) -> str:
    text = str(raw or "")
    if not text:
        return ""
    flat = " ".join(text.splitlines()).strip()
    if len(flat) <= max_chars:
        return flat
    return f"{flat[:max_chars]} ...(truncated, total={len(flat)} chars)"


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        val = float(raw)
        if math.isfinite(val):
            return val
    except Exception:
        pass
    return default


SCREEN_REGION_MIN_DWELL_SEC = max(0.0, _env_float("SCREEN_REGION_MIN_DWELL_SEC", 2.0))
LOW_MOTION_ABS_SPEED_MAX = max(0.0, _env_float("LOW_MOTION_ABS_SPEED_MAX", 35.0))
LOW_MOTION_ABS_DISPLACEMENT_MAX = max(0.0, _env_float("LOW_MOTION_ABS_DISPLACEMENT_MAX", 80.0))
def _parse_event_labels_env(default: List[str]) -> List[str]:
    raw = os.environ.get("EVENT_LABELS")
    if not raw:
        return default
    parts = [p.strip() for p in raw.replace("|", ",").split(",") if p.strip()]
    return parts or default


EVENT_LABELS = _parse_event_labels_env(["上车", "下车", "上下车", "交互", "未知"])


def _match_named_screen_region(nx: float, ny: float, region_name: Optional[str]) -> bool:
    region = (region_name or "").strip().lower()
    if (
        "左上" in region
        or "top-left" in region
        or "upper-left" in region
        or "left_top" in region
        or "top_left" in region
    ):
        return nx < 0.45 and ny < 0.45
    if (
        "右上" in region
        or "top-right" in region
        or "upper-right" in region
        or "right_top" in region
        or "top_right" in region
    ):
        return nx > 0.55 and ny < 0.45
    if (
        "左下" in region
        or "bottom-left" in region
        or "lower-left" in region
        or "left_bottom" in region
        or "bottom_left" in region
    ):
        return nx < 0.45 and ny > 0.55
    if (
        "右下" in region
        or "bottom-right" in region
        or "lower-right" in region
        or "right_bottom" in region
        or "bottom_right" in region
    ):
        return nx > 0.55 and ny > 0.55
    if "left_side" in region:
        return nx < 0.4
    if "right_side" in region:
        return nx > 0.6
    if "top_side" in region:
        return ny < 0.4
    if "bottom_side" in region:
        return ny > 0.6
    if "central_area" in region:
        return 0.3 <= nx <= 0.7 and 0.3 <= ny <= 0.7
    if "左" in region or "left" in region:
        return nx < 0.4
    if "右" in region or "right" in region:
        return nx > 0.6
    if "上" in region or "top" in region:
        return ny < 0.4
    if "下" in region or "bottom" in region:
        return ny > 0.6
    if "中" in region or "center" in region:
        return 0.3 <= nx <= 0.7 and 0.3 <= ny <= 0.7
    return True
    return True

# VIRAT官方类别定义（统一映射）
# 0: Background (背景)
# 1: Person (人)
# 2: Car (小汽车)
# 3: Vehicle (其他车辆)
# 4: Object (物体)
# 5: Bike/Motorcycle (自行车/摩托车)
VIRAT_CLASS_BACKGROUND = 0
VIRAT_CLASS_PERSON = 1
VIRAT_CLASS_CAR = 2
VIRAT_CLASS_VEHICLE = 3
VIRAT_CLASS_OBJECT = 4
VIRAT_CLASS_BIKE = 5

# 类别集合（向后兼容）
PERSON_CLASSES = {VIRAT_CLASS_PERSON}
VEHICLE_CLASSES = {VIRAT_CLASS_CAR, VIRAT_CLASS_VEHICLE}  # Car + Vehicle
BIKE_CLASSES = {VIRAT_CLASS_BIKE}
OBJECT_CLASSES = {VIRAT_CLASS_OBJECT}
BACKGROUND_CLASSES = {VIRAT_CLASS_BACKGROUND}

# 类别标签映射
VIRAT_CLASS_LABELS = {
    VIRAT_CLASS_BACKGROUND: "背景",
    VIRAT_CLASS_PERSON: "人",
    VIRAT_CLASS_CAR: "小汽车",
    VIRAT_CLASS_VEHICLE: "其他车辆",
    VIRAT_CLASS_OBJECT: "物体",
    VIRAT_CLASS_BIKE: "自行车/摩托车",
}

# 类别到查询类的映射（用于LLM查询解析）
def map_virat_class_to_query_class(virat_class: int) -> int:
    """将VIRAT类别映射到查询类别（用于LLM）"""
    # 查询类别：1=Person, 2=Car, 3=Vehicle, 4=Object, 5=Bike
    mapping = {
        VIRAT_CLASS_PERSON: 1,
        VIRAT_CLASS_CAR: 2,
        VIRAT_CLASS_VEHICLE: 3,
        VIRAT_CLASS_OBJECT: 4,
        VIRAT_CLASS_BIKE: 5,
    }
    return mapping.get(virat_class, virat_class)

def map_query_class_to_virat_classes(query_class: int) -> Set[int]:
    """将查询类别映射回VIRAT类别集合"""
    mapping = {
        1: {VIRAT_CLASS_PERSON},
        2: {VIRAT_CLASS_CAR},
        3: {VIRAT_CLASS_VEHICLE},
        4: {VIRAT_CLASS_OBJECT},
        5: {VIRAT_CLASS_BIKE},
    }
    return mapping.get(query_class, {query_class})

VLLM_URL = os.environ.get("VLLM_URL")  # e.g., http://localhost:8001/v1

# VIRAT dataset configuration
VIRAT_DATASET_DIR = _local_path(os.environ.get("VIRAT_DATASET_DIR", str(DATASET_ROOT / "VIRAT")))
MEVA_DATASET_DIR = _local_path(os.environ.get("MEVA_DATASET_DIR", str(DATASET_ROOT / "MEVA")))

# WildTrack dataset configuration
WILDTRACK_DATASET_DIR = _local_path(os.environ.get("WILDTRACK_DATASET_DIR", str(DATASET_ROOT / "WildTrack")))
WILDTRACK_VIRAT_DATASET_DIR = _local_path(os.environ.get("WILDTRACK_VIRAT_DATASET_DIR", str(DATASET_ROOT / "WildTrack_VIRAT")))

class TimeReference(Enum):
    ABSOLUTE_SEC = "absolute_sec"
    RELATIVE_LAST = "relative_last"
    RELATIVE_FIRST = "relative_first"
    FRAME_RANGE = "frame_range"
    PERCENTAGE = "percentage"


class SpatialRegion(Enum):
    FULL = "full"
    ROI_RECT = "roi_rect"
    ROI_POLYGON = "roi_polygon"
    INTERSECTION = "intersection"
    ROAD_EDGE = "road_edge"
    CROSSWALK = "crosswalk"
    SCREEN_REGION = "screen_region"


class BehaviorType(Enum):
    STATIC = "static"
    MOVING = "moving"
    ENTER = "enter"
    EXIT = "exit"
    PASS_THROUGH = "pass_through"
    TURN_LEFT = "turn_left"
    TURN_RIGHT = "turn_right"
    U_TURN = "u_turn"
    STOP = "stop"
    ACCELERATE = "accelerate"
    DECELERATE = "decelerate"
    LANE_CHANGE = "lane_change"
    INTERACT = "interact"


_ACTION_TO_BEHAVIOR: Dict[str, BehaviorType] = {
    "walking": BehaviorType.MOVING,
    "driving": BehaviorType.MOVING,
    "standing": BehaviorType.STOP,
    "parking": BehaviorType.STOP,
    "turning": BehaviorType.TURN_LEFT,
    "leaving": BehaviorType.EXIT,
    "entering": BehaviorType.ENTER,
}

_BEHAVIOR_DISPLAY_NAME: Dict[BehaviorType, str] = {
    BehaviorType.ENTER: "进入",
    BehaviorType.EXIT: "离开",
    BehaviorType.PASS_THROUGH: "经过",
    BehaviorType.STOP: "停车/停留",
}


def _parse_behavior_actions(actions: Any) -> Set[BehaviorType]:
    behaviors: Set[BehaviorType] = set()
    if not isinstance(actions, list):
        return behaviors
    for act in actions:
        if not isinstance(act, str):
            continue
        mapped = _ACTION_TO_BEHAVIOR.get(act.strip().lower())
        if mapped is not None:
            behaviors.add(mapped)
    return behaviors


@dataclass
class TimeConstraint:
    ref_type: TimeReference = TimeReference.ABSOLUTE_SEC
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None
    start_frame: Optional[int] = None
    end_frame: Optional[int] = None

    def resolve(self, total_frames: int, fps: float) -> Tuple[int, int]:
        total_sec = total_frames / fps if fps > 0 else 0
        if self.ref_type == TimeReference.RELATIVE_LAST:
            duration = self.end_sec or 0
            end_f = total_frames
            start_f = max(0, int(total_frames - duration * fps))
            return start_f, end_f
        if self.ref_type == TimeReference.RELATIVE_FIRST:
            duration = self.end_sec or total_sec
            start_f = 0
            end_f = min(total_frames, int(duration * fps))
            return start_f, end_f
        if self.ref_type == TimeReference.FRAME_RANGE:
            start_f = self.start_frame or 0
            end_f = self.end_frame or total_frames
            return max(0, start_f), min(total_frames, end_f)
        if self.ref_type == TimeReference.PERCENTAGE:
            start_pct = (self.start_sec or 0) / 100.0
            end_pct = (self.end_sec or 100) / 100.0
            start_f = int(total_frames * start_pct)
            end_f = int(total_frames * end_pct)
            return start_f, end_f
        start_f = int((self.start_sec or 0) * fps)
        end_f = int((self.end_sec or total_sec) * fps)
        return max(0, start_f), min(total_frames, end_f)


@dataclass
class SpatialConstraint:
    region_type: SpatialRegion = SpatialRegion.FULL
    rect: Optional[Tuple[float, float, float, float]] = None
    polygon: Optional[List[Tuple[float, float]]] = None
    screen_region_name: Optional[str] = None

    def contains_point(self, x: float, y: float, img_w: int = 1920, img_h: int = 1080) -> bool:
        nx, ny = x / max(img_w, 1e-6), y / max(img_h, 1e-6)
        if self.region_type == SpatialRegion.FULL:
            return True
        if self.region_type == SpatialRegion.ROI_RECT and self.rect:
            x1, y1, x2, y2 = self.rect
            return x1 <= nx <= x2 and y1 <= ny <= y2
        if self.region_type == SpatialRegion.ROI_POLYGON and self.polygon:
            return self._point_in_polygon(nx, ny, self.polygon)
        if self.region_type == SpatialRegion.SCREEN_REGION:
            return self._check_screen_region(nx, ny)
        if self.region_type == SpatialRegion.INTERSECTION:
            return 0.25 <= nx <= 0.75 and 0.25 <= ny <= 0.75
        if self.region_type == SpatialRegion.CROSSWALK and self.rect:
            x1, y1, x2, y2 = self.rect
            return x1 <= nx <= x2 and y1 <= ny <= y2
        return True

    def _point_in_polygon(self, x: float, y: float, polygon: List[Tuple[float, float]]) -> bool:
        n = len(polygon)
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = polygon[i]
            xj, yj = polygon[j]
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / max((yj - yi), 1e-6) + xi):
                inside = not inside
            j = i
        return inside

    def _check_screen_region(self, nx: float, ny: float) -> bool:
        return _match_named_screen_region(nx, ny, self.screen_region_name)


@dataclass
class BehaviorConstraint:
    behaviors: Set[BehaviorType] = field(default_factory=set)
    interact_with_classes: Optional[Set[int]] = None
    speed_threshold: Optional[float] = None
    angle_threshold: float = 45.0


@dataclass
class QueryIntent:
    target_classes: Set[int] = field(default_factory=set)
    target_label: str = ""
    time_constraint: Optional[TimeConstraint] = None
    spatial_constraint: Optional[SpatialConstraint] = None
    behavior_constraint: Optional[BehaviorConstraint] = None
    needs_interaction: bool = False
    interaction_partner_classes: Set[int] = field(default_factory=set)
    interaction_partner_label: str = ""
    raw_query: str = ""


@dataclass
class ClusterResult:
    shape_clusters: Dict[int, int]
    behavior_clusters: Dict[int, int]
    interaction_clusters: Dict[Tuple[int, int], int]
    final_clusters: Dict[int, int]
    anomaly_ids: List[int]


class BehaviorDetector:
    def __init__(self, fps: float = 30.0, img_w: int = 1920, img_h: int = 1080):
        self.fps = fps
        self.img_w = img_w
        self.img_h = img_h

    def detect_behaviors(
        self,
        tracks: List[Dict[str, Any]],
        frame_range: Tuple[int, int],
        spatial_constraint: Optional[SpatialConstraint],
        behavior_constraint: Optional[BehaviorConstraint],
    ) -> Dict[int, Set[BehaviorType]]:
        results: Dict[int, Set[BehaviorType]] = {}
        if behavior_constraint is None or not behavior_constraint.behaviors:
            return results
        start_f, end_f = frame_range
        for t in tracks:
            points = [p for p in t.get("points", []) if start_f <= p.get("frame", 0) <= end_f]
            if len(points) < 2:
                continue
            detected: Set[BehaviorType] = set()
            if spatial_constraint and (
                BehaviorType.ENTER in behavior_constraint.behaviors
                or BehaviorType.EXIT in behavior_constraint.behaviors
                or BehaviorType.PASS_THROUGH in behavior_constraint.behaviors
            ):
                detected |= self._detect_enter_exit(points, spatial_constraint)
            if BehaviorType.STOP in behavior_constraint.behaviors:
                if self._detect_stop(points):
                    detected.add(BehaviorType.STOP)
            if BehaviorType.MOVING in behavior_constraint.behaviors:
                if self._detect_moving(points):
                    detected.add(BehaviorType.MOVING)
            if BehaviorType.TURN_LEFT in behavior_constraint.behaviors or BehaviorType.TURN_RIGHT in behavior_constraint.behaviors:
                angle_th = behavior_constraint.angle_threshold if behavior_constraint else 45.0
                if self._detect_turning(points, angle_th):
                    detected.add(BehaviorType.TURN_LEFT)
            matched = detected & behavior_constraint.behaviors
            if matched:
                results[t["id"]] = matched
        return results

    def _detect_enter_exit(self, points: List[Dict[str, Any]], spatial: SpatialConstraint) -> Set[BehaviorType]:
        res: Set[BehaviorType] = set()
        first_in = spatial.contains_point(points[0]["x"], points[0]["y"], self.img_w, self.img_h)
        last_in = spatial.contains_point(points[-1]["x"], points[-1]["y"], self.img_w, self.img_h)
        any_in = any(spatial.contains_point(p["x"], p["y"], self.img_w, self.img_h) for p in points)
        if not first_in and last_in:
            res.add(BehaviorType.ENTER)
        if first_in and not last_in:
            res.add(BehaviorType.EXIT)
        if not first_in and any_in and not last_in:
            res.add(BehaviorType.PASS_THROUGH)
        return res

    def _detect_stop(self, points: List[Dict[str, Any]], min_frames: int = 10) -> bool:
        if len(points) < min_frames:
            return False
        for i in range(len(points) - min_frames + 1):
            window = points[i : i + min_frames]
            max_dist = 0.0
            for j in range(1, len(window)):
                dx = window[j]["x"] - window[0]["x"]
                dy = window[j]["y"] - window[0]["y"]
                max_dist = max(max_dist, math.hypot(dx, dy))
            if max_dist < 5.0:
                return True
        return False

    def _detect_moving(self, points: List[Dict[str, Any]], min_dist: float = 8.0) -> bool:
        if len(points) < 2:
            return False
        dx = points[-1]["x"] - points[0]["x"]
        dy = points[-1]["y"] - points[0]["y"]
        return math.hypot(dx, dy) >= min_dist

    def _detect_turning(self, points: List[Dict[str, Any]], angle_threshold: float = 45.0) -> bool:
        if len(points) < 5:
            return False
        mid = len(points) // 2
        v1x = points[mid]["x"] - points[0]["x"]
        v1y = points[mid]["y"] - points[0]["y"]
        v2x = points[-1]["x"] - points[mid]["x"]
        v2y = points[-1]["y"] - points[mid]["y"]
        norm1 = math.hypot(v1x, v1y)
        norm2 = math.hypot(v2x, v2y)
        if norm1 < 1e-6 or norm2 < 1e-6:
            return False
        cosang = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (norm1 * norm2)))
        angle = math.degrees(math.acos(cosang))
        return angle >= angle_threshold

app = FastAPI(title="InternVideo2.5 Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_tokenizer = None
_generation_config = dict(
    do_sample=False,
    max_new_tokens=512,
    num_beams=1,
)

QWEN_MODEL_DIR = MODEL_ROOT / "Qwen2.5-7B-Instruct"
QWEN_MODEL_PATH = str(_local_path(os.environ.get("QWEN_MODEL_PATH", str(QWEN_MODEL_DIR))))
QWEN_MAX_NEW_TOKENS = int(os.environ.get("QWEN_MAX_NEW_TOKENS", "256"))
QWEN_TEMPERATURE = float(os.environ.get("QWEN_TEMPERATURE", "0.2"))


_qwen_model = None
_qwen_tokenizer = None

_behavior_detector = BehaviorDetector(fps=DEFAULT_FPS)

REPORT_SYSTEM_PROMPT = (
    "你是中文监控报告撰写助手。"
    "你只可以基于给定 JSON 数据生成通顺中文，不得添加 JSON 中不存在的事实。"
)


def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        v = float(val)
        if math.isfinite(v):
            return v
    except Exception:
        pass
    return default


def resolve_path(raw: str) -> Path:
    """Convert web path to filesystem path"""
    p = Path(raw)
    
    # If it's already absolute, try to map it
    if p.is_absolute():
        # Handle paths starting with /backend/...
        if str(p).startswith('/backend/'):
            rel_part = str(p).replace('/backend/', '', 1)
            mapped = (BACKEND_DIR / rel_part).resolve()
            if mapped.exists():
                logger.debug(f"resolve_path: {raw} -> {mapped}")
                return mapped
        
        # Handle paths starting with /vis/backend/...
        if str(p).startswith('/vis/backend/'):
            rel_part = str(p).replace('/vis/backend/', '', 1)
            mapped = (BACKEND_DIR / rel_part).resolve()
            if mapped.exists():
                logger.debug(f"resolve_path: {raw} -> {mapped}")
                return mapped
        
        # If no mapping worked, return original
        return p
    
    # Handle relative paths
    cleaned = raw.lstrip('/')
    
    # Try multiple possible locations
    possible_paths = [
        (VIS_DIR / cleaned).resolve(),
        (BACKEND_DIR / cleaned).resolve(),
        (REPO_ROOT / cleaned).resolve(),
        (REPO_ROOT / 'vis' / cleaned).resolve(),
        (REPO_ROOT / 'vis' / 'backend' / cleaned).resolve(),
    ]
    
    for cand in possible_paths:
        if cand.exists():
            logger.debug(f"resolve_path: {raw} -> {cand}")
            return cand
    
    # If nothing found, return the most likely candidate
    default = (BACKEND_DIR / cleaned).resolve()
    logger.warning(f"resolve_path not found, returning best-effort: {raw} -> {default}")
    return default


def derive_fps(video_path: Optional[Path]) -> float:
    if VideoReader is None or video_path is None:
        return DEFAULT_FPS
    try:
        vr = VideoReader(str(video_path), ctx=cpu(0), num_threads=1)
        fps = safe_float(vr.get_avg_fps(), DEFAULT_FPS)
        return fps if fps > 1 else DEFAULT_FPS
    except Exception as exc:  # pragma: no cover
        logger.warning("fallback fps: %s", exc)
        return DEFAULT_FPS


def _parse_world_csv(tracks_path: Path) -> Optional[Tuple[List[Dict[str, Any]], Tuple[int, int]]]:
    tracks: Dict[int, Dict[str, Any]] = {}
    min_frame, max_frame = math.inf, -math.inf

    with tracks_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            return None

        index_map: Dict[str, int] = {}
        for idx, name in enumerate(header):
            key = str(name).strip().lower().lstrip("\ufeff")
            if key:
                index_map[key] = idx

        required = {"obj_id", "frame", "x_world", "y_world"}
        if not required.issubset(index_map.keys()):
            return None

        idx_obj = index_map["obj_id"]
        idx_frame = index_map["frame"]
        idx_x = index_map["x_world"]
        idx_y = index_map["y_world"]
        idx_cls = index_map.get("cls")
        idx_valid = index_map.get("valid")

        for row in reader:
            if not row:
                continue
            try:
                if idx_valid is not None and idx_valid < len(row):
                    valid_raw = str(row[idx_valid]).strip().lower()
                    if valid_raw and valid_raw not in {"1", "1.0", "true", "yes", "y"}:
                        continue

                obj_id = int(float(str(row[idx_obj]).strip()))
                frame = int(float(str(row[idx_frame]).strip()))
                cx = float(str(row[idx_x]).strip())
                cy = float(str(row[idx_y]).strip())

                cls_raw = 0
                if idx_cls is not None and idx_cls < len(row):
                    cls_raw = int(float(str(row[idx_cls]).strip() or "0"))
                cls_id = VIRAT_CLASS_PERSON if cls_raw == 0 else cls_raw
            except Exception:
                continue

            if obj_id not in tracks:
                tracks[obj_id] = {"id": obj_id, "cls": cls_id, "points": []}
            tracks[obj_id]["points"].append({"frame": frame, "x": cx, "y": cy, "w": 1.0, "h": 1.0})
            min_frame = min(min_frame, frame)
            max_frame = max(max_frame, frame)

    sorted_tracks: List[Dict[str, Any]] = []
    for t in tracks.values():
        t["points"].sort(key=lambda p: p["frame"])
        sorted_tracks.append(t)

    return sorted_tracks, (int(min_frame if min_frame < math.inf else 0), int(max_frame if max_frame > -math.inf else 0))


def parse_tracks(tracks_path: Path, dataset_type: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Tuple[int, int]]:
    tracks = {}
    min_frame, max_frame = math.inf, -math.inf
    normalized_dataset_type = (dataset_type or "").lower()
    is_wildtrack = normalized_dataset_type == "wildtrack"
    is_world_dataset = normalized_dataset_type in {"wildtrack", "meva"}

    if tracks_path.suffix.lower() == ".csv" and is_world_dataset:
        parsed = _parse_world_csv(tracks_path)
        if parsed is not None:
            return parsed

    with tracks_path.open("r", encoding="utf-8") as f:
        for raw in f:
            parts = raw.strip().split()
            if len(parts) < 8:
                continue
            try:
                if is_wildtrack:
                    # WildTrack raw format: obj_id frame x1 y1 x2 y2 conf cls
                    obj_id = int(parts[0])
                    frame = int(parts[1])
                    x1, y1 = float(parts[2]), float(parts[3])
                    x2, y2 = float(parts[4]), float(parts[5])
                    w = max(1.0, x2 - x1)
                    h = max(1.0, y2 - y1)
                    cx = x1 + w * 0.5
                    cy = y1 + h * 0.5
                    cls_raw = int(parts[7])
                    cls_id = VIRAT_CLASS_PERSON if cls_raw == 0 else cls_raw
                else:
                    # VIRAT format: seq_id obj_id frame x y w h cls
                    _, obj_id_s, frame_s, x_s, y_s, w_s, h_s, cls_s = parts[:8]
                    obj_id = int(obj_id_s)
                    frame = int(frame_s)
                    x, y, w, h = float(x_s), float(y_s), float(w_s), float(h_s)
                    cx = x + w * 0.5
                    cy = y + h * 0.5
                    cls_id = int(cls_s)
            except Exception:
                continue
            if obj_id not in tracks:
                tracks[obj_id] = {"id": obj_id, "cls": cls_id, "points": []}
            tracks[obj_id]["points"].append({"frame": frame, "x": cx, "y": cy, "w": w, "h": h})
            min_frame = min(min_frame, frame)
            max_frame = max(max_frame, frame)
    sorted_tracks = []
    for t in tracks.values():
        t["points"].sort(key=lambda p: p["frame"])
        sorted_tracks.append(t)
    return sorted_tracks, (int(min_frame if min_frame < math.inf else 0), int(max_frame if max_frame > -math.inf else 0))


def box_iou(a: Dict[str, float], b: Dict[str, float]) -> float:
    ax0, ay0 = a["x"] - a["w"] * 0.5, a["y"] - a["h"] * 0.5
    ax1, ay1 = a["x"] + a["w"] * 0.5, a["y"] + a["h"] * 0.5
    bx0, by0 = b["x"] - b["w"] * 0.5, b["y"] - b["h"] * 0.5
    bx1, by1 = b["x"] + b["w"] * 0.5, b["y"] + b["h"] * 0.5
    inter_x0 = max(ax0, bx0)
    inter_y0 = max(ay0, by0)
    inter_x1 = min(ax1, bx1)
    inter_y1 = min(ay1, by1)
    inter_w = max(0.0, inter_x1 - inter_x0)
    inter_h = max(0.0, inter_y1 - inter_y0)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0.0
    area_a = (ax1 - ax0) * (ay1 - ay0)
    area_b = (bx1 - bx0) * (by1 - by0)
    denom = max(area_a + area_b - inter_area, 1e-6)
    return inter_area / denom


def detect_interactions(
    tracks: List[Dict[str, Any]],
    fps: float,
    frame_range: Tuple[int, int],
    subject_classes: Optional[set] = None,
    partner_classes: Optional[set] = None,
    event_labels: Optional[Dict[Tuple[int, int], str]] = None,
    event_scores: Optional[Dict[Tuple[int, int], Any]] = None,
) -> Dict[str, Any]:
    subject_classes = subject_classes or PERSON_CLASSES
    partner_classes = partner_classes or VEHICLE_CLASSES
    frames = defaultdict(lambda: {"subjects": [], "partners": []})
    pair_frames: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    for t in tracks:
        cls_id = t.get("cls")
        is_subject = cls_id in subject_classes
        is_partner = cls_id in partner_classes
        if not is_subject and not is_partner:
            continue
        for p in t["points"]:
            if is_subject:
                frames[p["frame"]]["subjects"].append((t["id"], p))
            if is_partner:
                frames[p["frame"]]["partners"].append((t["id"], p))
    interaction_frames: Dict[int, List[int]] = defaultdict(list)
    partners_map: Dict[int, set] = defaultdict(set)
    for frame_idx in sorted(frames.keys()):
        subjects = frames[frame_idx]["subjects"]
        partners = frames[frame_idx]["partners"]
        if not subjects or not partners:
            continue
        for pid, p_box in subjects:
            for oid, o_box in partners:
                if pid == oid:
                    continue
                iou = box_iou(p_box, o_box)
                dx = p_box["x"] - o_box["x"]
                dy = p_box["y"] - o_box["y"]
                dist = math.hypot(dx, dy)
                scale = 0.5 * (p_box["w"] + p_box["h"] + o_box["w"] + o_box["h"]) / 4.0
                if iou > 0.05 or dist < scale:
                    interaction_frames[pid].append(frame_idx)
                    partners_map[pid].add(oid)
                    pair_frames[(pid, oid)].append(frame_idx)
    pair_segments: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}
    segments: List[Tuple[int, int]] = []
    highlights: Set[int] = set()
    min_f, max_f = frame_range

    def _collapse_frames(frames_list: List[int]) -> List[Tuple[int, int]]:
        if not frames_list:
            return []
        uniq = sorted(set(frames_list))
        start = uniq[0]
        last = uniq[0]
        collapsed: List[Tuple[int, int]] = []
        for f in uniq[1:]:
            if f - last <= 3:
                last = f
                continue
            collapsed.append((start, last))
            start = f
            last = f
        collapsed.append((start, last))
        return collapsed

    for (pid, oid), frames_list in pair_frames.items():
        segs = _collapse_frames(frames_list)
        if not segs:
            continue
        pair_segments[(pid, oid)] = segs
        segments.extend(segs)
        highlights.add(pid)

    segments.sort(key=lambda s: (s[0], s[1]))
    if segments:
        start_sec = (segments[0][0] - min_f) / fps
        end_sec = (segments[-1][1] - min_f) / fps
    else:
        start_sec, end_sec = 0.0, 0.0

    events: List[Dict[str, Any]] = []
    for (pid, oid), segs in pair_segments.items():
        label = None
        score: Optional[float] = None
        if event_labels and (pid, oid) in event_labels:
            label = str(event_labels[(pid, oid)])
        if event_scores and (pid, oid) in event_scores:
            score_val = event_scores[(pid, oid)]
            if isinstance(score_val, dict):
                best = max(score_val.items(), key=lambda kv: kv[1]) if score_val else None
                if best:
                    label = label or str(best[0])
                    score = float(best[1])
            elif isinstance(score_val, (int, float)):
                score = float(score_val)
        for seg in segs:
            events.append({
                "person_id": pid,
                "partner_id": oid,
                "start_frame": seg[0],
                "end_frame": seg[1],
                "event": label or "交互",
                "score": score,
            })

    # Limit total events if requested
    if EVENT_MAX and len(events) > EVENT_MAX:
        events = sorted(events, key=lambda e: (e.get("start_frame", 0), e.get("end_frame", 0)))[:EVENT_MAX]
    return {
        "highlights": sorted(list(highlights)),
        "segments": segments,
        "partners": {pid: sorted(list(vs)) for pid, vs in partners_map.items()},
        "timeSecRange": [round(start_sec, 2), round(end_sec, 2)] if segments else None,
        "events": events,
        "pairSegments": {f"{pid}-{oid}": segs for (pid, oid), segs in pair_segments.items()},
    }


def resample_trajectory(points: List[Dict[str, Any]], n: int = 20) -> Optional[Any]:
    if np is None:
        return None
    if len(points) == 0:
        return np.zeros((n, 2), dtype=float)
    if len(points) == 1:
        x = float(points[0].get("x", 0.0))
        y = float(points[0].get("y", 0.0))
        return np.tile([x, y], (n, 1))

    coords = np.array([[float(p.get("x", 0.0)), float(p.get("y", 0.0))] for p in points], dtype=float)
    diffs = np.diff(coords, axis=0)
    dists = np.sqrt((diffs ** 2).sum(axis=1))
    cumlen = np.concatenate([[0.0], np.cumsum(dists)])
    total = float(cumlen[-1]) if len(cumlen) else 0.0

    if total < 1e-6:
        return np.tile(coords[0], (n, 1))

    sample_lens = np.linspace(0.0, total, n)
    resampled = np.zeros((n, 2), dtype=float)
    for i, sl in enumerate(sample_lens):
        idx = int(np.searchsorted(cumlen, sl, side="right") - 1)
        idx = min(max(idx, 0), len(coords) - 2)
        den = max(float(dists[idx]), 1e-6)
        t = float((sl - cumlen[idx]) / den)
        resampled[i] = coords[idx] + t * diffs[idx]
    return resampled


def cluster_by_shape(
    tracks: List[Dict[str, Any]],
    frame_range: Tuple[int, int],
    eps: float = 80.0,
    min_samples: int = 2,
    n_resample: int = 20,
) -> Dict[int, int]:
    abs_start, abs_end = frame_range
    valid_tracks: List[int] = []
    features: List[Any] = []
    for t in tracks:
        pts = [p for p in t.get("points", []) if abs_start <= int(p.get("frame", -1)) <= abs_end]
        if len(pts) < 3:
            continue
        resampled = resample_trajectory(pts, n=n_resample)
        if resampled is None:
            continue
        valid_tracks.append(int(t.get("id")))
        features.append(resampled.flatten())

    if len(valid_tracks) < 2:
        return {tid: 0 for tid in valid_tracks}

    if np is None or DBSCAN is None or StandardScaler is None:
        return {tid: 0 for tid in valid_tracks}

    X = np.array(features, dtype=float)
    X_norm = StandardScaler().fit_transform(X)
    labels = DBSCAN(eps=max(1e-6, float(eps) / 100.0), min_samples=int(min_samples)).fit_predict(X_norm)
    return {tid: int(label) for tid, label in zip(valid_tracks, labels)}


def encode_spatiotemporal(
    track: Dict[str, Any],
    frame_range: Tuple[int, int],
    fps: float,
    n_time_bins: int = 8,
    n_space_bins: int = 4,
) -> Optional[Any]:
    if np is None:
        return None
    abs_start, abs_end = frame_range
    feature = np.zeros((n_time_bins, n_space_bins, n_space_bins), dtype=float)

    pts = [p for p in track.get("points", []) if abs_start <= int(p.get("frame", -1)) <= abs_end]
    if not pts:
        return feature.flatten()

    t_range = max(abs_end - abs_start, 1)
    img_w, img_h = 1920.0, 1080.0

    for p in pts:
        frame = int(p.get("frame", abs_start))
        ti = int((frame - abs_start) / t_range * (n_time_bins - 1))
        xi = int(float(p.get("x", 0.0)) / img_w * (n_space_bins - 1))
        yi = int(float(p.get("y", 0.0)) / img_h * (n_space_bins - 1))

        ti = max(0, min(n_time_bins - 1, ti))
        xi = max(0, min(n_space_bins - 1, xi))
        yi = max(0, min(n_space_bins - 1, yi))
        feature[ti][xi][yi] += 1.0

    total = float(feature.sum())
    if total > 0:
        feature /= total
    return feature.flatten()


def cluster_by_behavior(
    tracks: List[Dict[str, Any]],
    frame_range: Tuple[int, int],
    fps: float,
    eps: float = 0.15,
    min_samples: int = 2,
) -> Dict[int, int]:
    valid_tracks: List[int] = []
    features: List[Any] = []
    for t in tracks:
        feat = encode_spatiotemporal(t, frame_range, fps)
        if feat is None:
            continue
        if float(feat.sum()) == 0.0:
            continue
        valid_tracks.append(int(t.get("id")))
        features.append(feat)

    if len(valid_tracks) < 2:
        return {tid: 0 for tid in valid_tracks}

    if np is None or DBSCAN is None:
        return {tid: 0 for tid in valid_tracks}

    X = np.array(features, dtype=float)
    labels = DBSCAN(eps=float(eps), min_samples=int(min_samples), metric="cosine").fit_predict(X)
    return {tid: int(label) for tid, label in zip(valid_tracks, labels)}


def cluster_by_interaction(
    interaction_result: Optional[Dict[str, Any]],
    fps: float,
    frame_range: Tuple[int, int],
    time_gap_sec: float = 5.0,
) -> Dict[Tuple[int, int], int]:
    if not isinstance(interaction_result, dict):
        return {}

    events = interaction_result.get("events") or []
    if not isinstance(events, list) or not events:
        return {}

    abs_start = frame_range[0]
    event_times: List[List[float]] = []
    event_pairs: List[Tuple[int, int]] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        try:
            start_f = int(ev.get("start_frame", 0))
            end_f = int(ev.get("end_frame", start_f))
            pid = int(ev.get("person_id"))
            oid = int(ev.get("partner_id"))
        except Exception:
            continue
        mid_sec = ((start_f + end_f) / 2.0 - abs_start) / max(fps, 1e-6)
        event_times.append([float(mid_sec)])
        event_pairs.append((pid, oid))

    if len(event_pairs) < 2:
        return {pair: 0 for pair in event_pairs}

    if np is None or DBSCAN is None:
        # Fallback: sequential grouping by time gap
        merged: Dict[Tuple[int, int], int] = {}
        zipped = sorted(zip(event_times, event_pairs), key=lambda x: x[0][0])
        cid = 0
        prev_t = None
        for et, pair in zipped:
            t = et[0]
            if prev_t is not None and (t - prev_t) > float(time_gap_sec):
                cid += 1
            merged[pair] = cid
            prev_t = t
        return merged

    X = np.array(event_times, dtype=float)
    labels = DBSCAN(eps=float(time_gap_sec), min_samples=1).fit_predict(X)
    return {pair: int(label) for pair, label in zip(event_pairs, labels)}


def cluster_tracks(
    tracks: List[Dict[str, Any]],
    frame_range: Tuple[int, int],
    fps: float,
    interaction_result: Optional[Dict[str, Any]] = None,
    w_shape: float = 0.5,
    w_behavior: float = 0.5,
) -> ClusterResult:
    _ = (w_shape, w_behavior)  # Placeholder weights for future extension.
    shape_clusters = cluster_by_shape(tracks, frame_range)
    behavior_clusters = cluster_by_behavior(tracks, frame_range, fps)
    interaction_clusters = cluster_by_interaction(interaction_result, fps, frame_range)

    all_ids = set(shape_clusters) | set(behavior_clusters)
    final: Dict[int, int] = {}
    for tid in all_ids:
        s = int(shape_clusters.get(tid, 0))
        b = int(behavior_clusters.get(tid, 0))
        if s == -1 and b == -1:
            final[tid] = -1
        elif s == -1 or b == -1:
            final[tid] = -2
        else:
            final[tid] = b

    anomaly_ids = [tid for tid, cid in final.items() if cid in (-1, -2)]
    return ClusterResult(
        shape_clusters=shape_clusters,
        behavior_clusters=behavior_clusters,
        interaction_clusters=interaction_clusters,
        final_clusters=final,
        anomaly_ids=sorted(anomaly_ids),
    )


def extract_objective_facts_from_interaction_result(
    interaction_result: Optional[Dict[str, Any]],
    fps: float,
    frame_range: Optional[Tuple[int, int]],
) -> Dict[str, Any]:
    """Convert interaction detection output into objective facts schema."""
    if not isinstance(interaction_result, dict):
        return {"interactions": []}

    min_frame = frame_range[0] if isinstance(frame_range, tuple) and len(frame_range) == 2 else 0
    interactions: List[Dict[str, Any]] = []

    pair_segments = interaction_result.get("pairSegments") if isinstance(interaction_result.get("pairSegments"), dict) else {}
    if pair_segments:
        for pair_key, segments in pair_segments.items():
            try:
                person_s, vehicle_s = str(pair_key).split("-", 1)
                person_id = int(person_s)
                vehicle_id = int(vehicle_s)
            except Exception:
                continue
            if not isinstance(segments, list):
                continue
            for seg in segments:
                if not (isinstance(seg, (list, tuple)) and len(seg) == 2):
                    continue
                try:
                    start_f = int(seg[0])
                    end_f = int(seg[1])
                except Exception:
                    continue
                start_sec = max(0.0, (start_f - min_frame) / max(fps, 1e-6))
                end_sec = max(start_sec, (end_f - min_frame) / max(fps, 1e-6))
                interactions.append({
                    "time_interval": [round(start_sec, 2), round(end_sec, 2)],
                    "person_id": person_id,
                    "vehicle_id": vehicle_id,
                })

    if not interactions:
        events = interaction_result.get("events") if isinstance(interaction_result.get("events"), list) else []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            try:
                person_id = int(ev.get("person_id"))
                vehicle_id = int(ev.get("partner_id"))
                start_f = int(ev.get("start_frame", 0))
                end_f = int(ev.get("end_frame", start_f))
            except Exception:
                continue
            start_sec = max(0.0, (start_f - min_frame) / max(fps, 1e-6))
            end_sec = max(start_sec, (end_f - min_frame) / max(fps, 1e-6))
            interactions.append({
                "time_interval": [round(start_sec, 2), round(end_sec, 2)],
                "person_id": person_id,
                "vehicle_id": vehicle_id,
            })

    return {"interactions": interactions}


def extract_objective_facts_via_internvideo(text: str, video_path: Optional[Path]) -> Dict[str, Any]:
    """Run InternVideo to get objective facts; return empty facts on any failure."""
    if video_path is None or not video_path.exists():
        return {"interactions": []}
    prompt = (
        "请仅输出 JSON，格式为 {\"interactions\":[{\"time_interval\":[0,1],\"person_id\":1,\"vehicle_id\":2}]}。"
        "若未观察到交互，输出 {\"interactions\":[]}。"
        f"用户问题: {text}"
    )
    raw = run_internvideo(prompt, video_path=video_path)
    if not raw:
        return {"interactions": []}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and isinstance(parsed.get("interactions"), list):
            return parsed
    except Exception:
        pass
    return {"interactions": []}


def merge_objective_facts(track_facts: Optional[Dict[str, Any]], video_facts: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge interaction lists and deduplicate by ids + time interval."""
    merged: List[Dict[str, Any]] = []
    seen = set()
    for facts in (track_facts, video_facts):
        items = facts.get("interactions", []) if isinstance(facts, dict) else []
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            interval = item.get("time_interval")
            if not (isinstance(interval, list) and len(interval) == 2):
                continue
            try:
                t0 = float(interval[0])
                t1 = float(interval[1])
                pid = int(item.get("person_id"))
                vid = int(item.get("vehicle_id"))
            except Exception:
                continue
            key = (pid, vid, round(min(t0, t1), 2), round(max(t0, t1), 2))
            if key in seen:
                continue
            seen.add(key)
            merged.append({
                "time_interval": [key[2], key[3]],
                "person_id": pid,
                "vehicle_id": vid,
            })
    merged.sort(key=lambda x: (x["time_interval"][0], x["person_id"], x["vehicle_id"]))
    return {"interactions": merged}


def build_chinese_report_from_objective_facts(user_text: str, facts: Optional[Dict[str, Any]]) -> str:
    """Render a concise Chinese report from objective facts."""
    interactions = facts.get("interactions", []) if isinstance(facts, dict) else []
    if not isinstance(interactions, list) or not interactions:
        return "未检测到明确的人车交互事件。"

    parts: List[str] = []
    for item in interactions[:5]:
        if not isinstance(item, dict):
            continue
        interval = item.get("time_interval", [0, 0])
        pid = item.get("person_id")
        vid = item.get("vehicle_id")
        if isinstance(interval, list) and len(interval) == 2:
            parts.append(f"{interval[0]}-{interval[1]}秒 行人{pid}与车辆{vid}")
    if not parts:
        return f"共检测到 {len(interactions)} 条人车交互事件。"
    return f"共检测到 {len(interactions)} 条人车交互事件：" + "；".join(parts)


def _extract_event_overrides(context: Dict[str, Any]) -> Tuple[Dict[Tuple[int, int], str], Dict[Tuple[int, int], Any]]:
    """Extract per-pair interaction event labels/scores from context payload.

    Expected shapes:
    - List of dicts with keys person_id/partner_id and event/score/scores
    - Dict mapping "pid-oid" -> {"event": str, "score": float} or raw label
    """
    labels: Dict[Tuple[int, int], str] = {}
    scores: Dict[Tuple[int, int], Any] = {}

    raw = context.get("interactionEvents") or context.get("interaction_event_overrides")
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            pid = item.get("person_id") or item.get("personId") or item.get("pid") or item.get("subject")
            oid = item.get("partner_id") or item.get("partnerId") or item.get("oid") or item.get("object")
            if pid is None or oid is None:
                continue
            key = (int(pid), int(oid))
            if item.get("event"):
                labels[key] = str(item["event"])
            elif item.get("label"):
                labels[key] = str(item["label"])
            if "scores" in item and isinstance(item.get("scores"), dict):
                scores[key] = item.get("scores")
            elif "score" in item:
                scores[key] = item.get("score")
    elif isinstance(raw, dict):
        for raw_key, val in raw.items():
            if isinstance(val, dict):
                pid = val.get("person_id") or val.get("personId") or val.get("pid") or val.get("subject")
                oid = val.get("partner_id") or val.get("partnerId") or val.get("oid") or val.get("object")
                label_val = val.get("event") or val.get("label")
                score_val = val.get("scores") if isinstance(val.get("scores"), dict) else val.get("score")
                if pid is not None and oid is not None:
                    key = (int(pid), int(oid))
                    if label_val:
                        labels[key] = str(label_val)
                    if score_val is not None:
                        scores[key] = score_val
                    continue
            if not isinstance(raw_key, str):
                continue
            parts = re.split(r"[-_:]", raw_key)
            if len(parts) != 2:
                continue
            try:
                pid = int(parts[0])
                oid = int(parts[1])
            except ValueError:
                continue
            key = (pid, oid)
            if isinstance(val, (str, int, float)):
                labels[key] = str(val)
            elif isinstance(val, dict):
                if val.get("event") or val.get("label"):
                    labels[key] = str(val.get("event") or val.get("label"))
                if val.get("scores"):
                    scores[key] = val.get("scores")
                elif val.get("score") is not None:
                    scores[key] = val.get("score")

    return labels, scores


def infer_time_window(text: str, context: Dict[str, Any], fps: float, frame_range: Tuple[int, int]) -> Tuple[float, float]:
    numbers = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)]
    if len(numbers) >= 2:
        start_sec, end_sec = numbers[0], numbers[1]
    elif len(numbers) == 1:
        start_sec, end_sec = max(0.0, numbers[0] - 2.0), numbers[0] + 2.0
    else:
        cur_sec = safe_float(context.get("currentSec"), 0.0)
        start_sec, end_sec = max(0.0, cur_sec - 3.0), cur_sec + 3.0
    min_f, max_f = frame_range
    min_sec = min_f / fps if fps else 0.0
    max_sec = max_f / fps if fps else end_sec
    start_sec = max(min_sec, start_sec)
    end_sec = min(max_sec, end_sec)
    if end_sec <= start_sec:
        end_sec = start_sec + max(1.0, 1.0 / max(fps, 1.0))
    return round(start_sec, 2), round(end_sec, 2)


def ensure_model():
    global _model, _tokenizer
    if DISABLE_MODEL:
        return None, None
    if _model is not None and _tokenizer is not None:
        return _model, _tokenizer
    if torch is None or AutoModel is None or AutoTokenizer is None:
        logger.warning("torch/transformers not available; model disabled")
        return None, None
    # Workaround: local path basename contains a dot, which breaks dynamic module name resolution.
    load_path = MODEL_DIR
    try:
        if "." in MODEL_DIR.name:
            if not MODEL_DIR_ALIAS.exists():
                try:
                    os.symlink(MODEL_DIR, MODEL_DIR_ALIAS, target_is_directory=True)
                    logger.info("Created symlink for model: %s -> %s", MODEL_DIR_ALIAS, MODEL_DIR)
                except Exception:
                    # Fallback to using the original path; dynamic module cache fixes may apply.
                    logger.warning("Symlink creation failed; proceeding with original path: %s", MODEL_DIR)
            if MODEL_DIR_ALIAS.exists():
                load_path = MODEL_DIR_ALIAS
    except Exception as _e:
        logger.warning("Alias path setup failed: %s", _e)

    device_map = "auto"
    torch_dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float16
    logger.info("loading InternVideo2.5 from %s", load_path)
    _tokenizer = AutoTokenizer.from_pretrained(str(load_path), trust_remote_code=True)
    _model = AutoModel.from_pretrained(
        str(load_path),
        trust_remote_code=True,
        torch_dtype=torch_dtype,
        device_map=device_map,
    ).eval()
    return _model, _tokenizer


def ensure_qwen():
    global _qwen_model, _qwen_tokenizer
    if _qwen_model is not None and _qwen_tokenizer is not None:
        return _qwen_model, _qwen_tokenizer
    if AutoModelForCausalLM is None or AutoTokenizer is None or torch is None:
        logger.warning("transformers not available; Qwen2.5 disabled")
        return None, None
    load_path = Path(QWEN_MODEL_PATH)
    if not load_path.exists():
        logger.warning("Qwen2.5 path missing: %s", load_path)
        return None, None
    logger.info("loading Qwen2.5 from %s", load_path)
    _qwen_tokenizer = AutoTokenizer.from_pretrained(str(load_path), trust_remote_code=True)
    _qwen_model = AutoModelForCausalLM.from_pretrained(
        str(load_path),
        trust_remote_code=True,
        device_map="auto",
    ).eval()
    return _qwen_model, _qwen_tokenizer


def qwen_chat(prompt: str, system: Optional[str] = None, max_new_tokens: int = QWEN_MAX_NEW_TOKENS) -> Optional[str]:
    if VLLM_URL and httpx is not None:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(
                    f"{VLLM_URL.rstrip('/')}/chat/completions",
                    json={
                        "model": "./Qwen2.5-7B-Instruct",
                        "messages": messages,
                        "max_tokens": max_new_tokens,
                        "temperature": QWEN_TEMPERATURE,
                    },
                )
                data = resp.json()
                text = data.get("choices", [{}])[0].get("message", {}).get("content")
                if text:
                    return str(text).strip()
        except Exception as exc:  # pragma: no cover
            logger.warning("vLLM chat failed: %s", exc)
    model, tokenizer = ensure_qwen()
    if model is None or tokenizer is None:
        return None
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        input_ids = tokenizer.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt")
        input_ids = input_ids.to(model.device)
        with torch.no_grad():
            output_ids = model.generate(
                input_ids,
                max_new_tokens=max_new_tokens,
                temperature=QWEN_TEMPERATURE,
                do_sample=QWEN_TEMPERATURE > 0,
                eos_token_id=tokenizer.eos_token_id,
            )
        gen_ids = output_ids[0, input_ids.shape[1]:]
        return tokenizer.decode(gen_ids, skip_special_tokens=True).strip()
    except Exception as exc:  # pragma: no cover
        logger.warning("qwen chat failed: %s", exc)
        return None


QWEN_UNIFIED_SYSTEM = (
    "你是视频监控查询 JSON 规划器。你的唯一任务是把用户问题转为可执行 JSON。只输出 JSON，不要 Markdown，不要解释。\n"
    "必须严格输出以下结构（字段名固定，禁止增删字段）：\n"
    "{\n"
    "  \"target\": {\"classes\": [1], \"label\": \"行人\"},\n"
    "  \"time\": {\"type\": \"all\", \"value\": null},\n"
    "  \"spatial\": {\"type\": \"none\", \"areas\": []},\n"
    "  \"behavior\": {\"actions\": [], \"negate\": false},\n"
    "  \"interaction\": {\"enabled\": false, \"with_classes\": [], \"include_all_partners\": false},\n"
    "  \"trajectory\": {\"operators\": []},\n"
    "  \"output\": {\"type\": \"highlight\", \"message\": \"已标注{label}，共{count}条\"}\n"
    "}\n"
    "classes 仅允许: 1(行人),2(汽车),3(大型车辆),4(物体),5(骑行者),6(其他物体)。\n"
    "time.type 仅允许: all,last_sec,first_sec,first_half,last_half,range_sec。range_sec 的 value 必须是 [start,end]（秒）。\n"
    "spatial.type 仅允许: none,intersection,crosswalk,roadside,parking_lot,area。\n"
    "behavior.actions 仅允许: standing,talking,carrying,walking,driving,parking,turning,leaving,entering。\n"
    "trajectory.operators[].name 仅允许: overview,dwell,speed,low_motion,stop_go,route,flow,cross,pair_motion,crowd_density。\n"
    "一、时间泛化规则（强约束）：\n"
    "1) 出现明确时长/时间点（如 前90秒、前1分30秒、30到90秒、第30-90秒）时，优先使用 first_sec 或 range_sec，不要退化成 first_half/last_half。\n"
    "2) 仅当文本明确出现 前半段/后半段 时，才使用 first_half/last_half。\n"
    "3) 若时间不明确，才使用 all。\n"
    "二、空间泛化规则（强约束）：\n"
    "1) 出现方位词时优先使用 spatial.type=area，areas 使用标准名: left_top,right_top,left_bottom,right_bottom,left_side,right_side,top_side,bottom_side,central_area。\n"
    "2) 例如 右上/右上角/top-right/upper-right 必须映射为 right_top；左下角必须映射为 left_bottom。\n"
    "3) 只有明确出现 路边/道路边缘 时才使用 roadside；不要把角落区域误映射为 roadside。\n"
    "三、轨迹任务规则（强约束）：\n"
    "1) 若用户问题包含 轨迹/轨迹分析/轨迹筛选/路径/流向/移动模式 等语义，trajectory.operators 不能只给 overview。\n"
    "2) 这类请求至少选择一个实算子: route/flow/cross/speed/low_motion/dwell/stop_go，可附加 overview。\n"
    "3) 当请求属于轨迹统计/轨迹筛选时，behavior.actions 必须为空数组。\n"
    "4) low_motion 必须包含 params: speed_quantile_max, displacement_quantile_max, min_duration_sec。\n"
    "四、ID簇聚焦规则（强约束）：\n"
    "1) 当用户问题出现 IDxx（如 ID41、id41、41号轨迹）且出现 簇/那一簇/同簇/聚簇 时，trajectory.operators 必须包含 dwell 与 low_motion 两个算子，且不能只给 route/flow/overview。\n"
    "2) dwell.params 必须给出 min_duration_sec（建议>=6）；low_motion.params 必须给出 speed_quantile_max 与 displacement_quantile_max（建议<=0.25）以及 min_duration_sec（建议>=6）。\n"
    "3) 这类请求应优先做收敛筛选：可附加 overview，但不能替代 dwell+low_motion。\n"
    "五、稳健性与冲突消解：\n"
    "1) 严禁把轨迹算子词放入 behavior.actions（如 low_motion/speed/dwell/route/flow/stop_go/cross/pair_motion/crowd_density）。\n"
    "2) 若同一句包含细粒度时间与粗粒度时间，优先细粒度（秒级）。\n"
    "3) 若空间有明确方位词，优先方位词映射，不要回退到 central_area。\n"
    "4) 不确定时保留默认值，不要杜撰字段。\n"
    "output.type 仅允许: highlight,count。\n"
    "示例1 输入: \"着重分析前90秒右上角那群人的轨迹\"。\n"
    "示例1 输出: {\"target\":{\"classes\":[1],\"label\":\"人群\"},\"time\":{\"type\":\"first_sec\",\"value\":90},\"spatial\":{\"type\":\"area\",\"areas\":[\"right_top\"]},\"behavior\":{\"actions\":[],\"negate\":false},\"interaction\":{\"enabled\":false,\"with_classes\":[],\"include_all_partners\":false},\"trajectory\":{\"operators\":[{\"name\":\"route\",\"params\":{}},{\"name\":\"flow\",\"params\":{}},{\"name\":\"overview\",\"params\":{}}]},\"output\":{\"type\":\"highlight\",\"message\":\"已标注{label}，共{count}条\"}}\n"
    "示例2 输入: \"找出30到90秒中央区域低速小位移行人\"。\n"
    "示例2 输出: {\"target\":{\"classes\":[1],\"label\":\"行人\"},\"time\":{\"type\":\"range_sec\",\"value\":[30,90]},\"spatial\":{\"type\":\"area\",\"areas\":[\"central_area\"]},\"behavior\":{\"actions\":[],\"negate\":false},\"interaction\":{\"enabled\":false,\"with_classes\":[],\"include_all_partners\":false},\"trajectory\":{\"operators\":[{\"name\":\"low_motion\",\"params\":{\"speed_quantile_max\":0.35,\"displacement_quantile_max\":0.35,\"min_duration_sec\":4}}]},\"output\":{\"type\":\"highlight\",\"message\":\"已标注{label}，共{count}条\"}}\n"
    "示例3 输入: \"统计后半段路边人群\"。\n"
    "示例3 输出: {\"target\":{\"classes\":[1],\"label\":\"人群\"},\"time\":{\"type\":\"last_half\",\"value\":null},\"spatial\":{\"type\":\"roadside\",\"areas\":[]},\"behavior\":{\"actions\":[],\"negate\":false},\"interaction\":{\"enabled\":false,\"with_classes\":[],\"include_all_partners\":false},\"trajectory\":{\"operators\":[{\"name\":\"overview\",\"params\":{}}]},\"output\":{\"type\":\"count\",\"message\":\"已统计{label}，共{count}条\"}}"
    "示例4 输入: \"分析右上角ID41那一簇的轨迹\"。\n"
    "示例4 输出: {\"target\":{\"classes\":[1],\"label\":\"人群\"},\"time\":{\"type\":\"all\",\"value\":null},\"spatial\":{\"type\":\"area\",\"areas\":[\"right_top\"]},\"behavior\":{\"actions\":[],\"negate\":false},\"interaction\":{\"enabled\":false,\"with_classes\":[],\"include_all_partners\":false},\"trajectory\":{\"operators\":[{\"name\":\"dwell\",\"params\":{\"min_duration_sec\":6}},{\"name\":\"low_motion\",\"params\":{\"speed_quantile_max\":0.25,\"displacement_quantile_max\":0.25,\"min_duration_sec\":6}},{\"name\":\"overview\",\"params\":{}}]},\"output\":{\"type\":\"highlight\",\"message\":\"已标注{label}，共{count}条\"}}\n"
)



TRAJECTORY_OPERATOR_WHITELIST: Set[str] = {
    "overview", "dwell", "speed", "low_motion", "stop_go", "route", "flow", "cross", "pair_motion", "crowd_density"
}


def _normalize_trajectory_operator_name(name: Any) -> Optional[str]:
    if not isinstance(name, str):
        return None
    key = name.strip().lower()
    if not key:
        return None
    if key in TRAJECTORY_OPERATOR_WHITELIST:
        return key
    return None


def _normalize_trajectory_operator_candidates(raw_ops: Any) -> List[Dict[str, Any]]:
    ops: List[Dict[str, Any]] = []
    if isinstance(raw_ops, list):
        for item in raw_ops:
            if isinstance(item, str):
                name = _normalize_trajectory_operator_name(item)
                if name:
                    ops.append({"name": name, "params": {}})
                continue
            if not isinstance(item, dict):
                continue
            name = _normalize_trajectory_operator_name(item.get("name"))
            if not name:
                continue
            params = item.get("params") if isinstance(item.get("params"), dict) else {}
            clean: Dict[str, Any] = {}
            for k, v in params.items():
                if isinstance(k, str) and isinstance(v, (int, float)) and math.isfinite(float(v)):
                    clean[k] = float(v)
            ops.append({"name": name, "params": clean})

    dedup: Dict[str, Dict[str, Any]] = {}
    for op in ops:
        nm = op.get("name")
        if not isinstance(nm, str):
            continue
        if nm not in dedup:
            dedup[nm] = {"name": nm, "params": dict(op.get("params") or {})}
        else:
            dedup[nm]["params"].update(op.get("params") or {})
    return list(dedup.values())


def _trajectory_operators_from_plan(unified_plan: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(unified_plan, dict):
        return []
    traj = unified_plan.get("trajectory")
    if not isinstance(traj, dict):
        return []
    return _normalize_trajectory_operator_candidates(traj.get("operators"))


def _operator_params(ops: List[Dict[str, Any]], name: str) -> Dict[str, Any]:
    for op in ops:
        if op.get("name") == name:
            return dict(op.get("params") or {})
    return {}


def _safe_load_json(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None

    text = str(raw).strip()
    if not text:
        return None

    candidates: List[str] = [text]

    # Common LLM style: fenced json block
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())

    # Try substring from first '{' to last '}' as a tolerant fallback
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(text[first_brace:last_brace + 1])

    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def generate_unified_plan(question: str, ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Prompt-only conversion: Qwen directly maps question to JSON."""
    ctx_desc = {
        "maxSec": ctx.get("maxSec"),
        "currentSec": ctx.get("currentSec"),
    }
    prompt = f"用户问题: {question}\n上下文: {json.dumps(ctx_desc, ensure_ascii=False)}"
    raw = qwen_chat(prompt, system=QWEN_UNIFIED_SYSTEM, max_new_tokens=256)
    if raw:
        logger.info("qwen unified raw: %s", raw)
    parsed = _safe_load_json(raw)
    if isinstance(parsed, dict):
        try:
            logger.info("qwen unified parsed: %s", json.dumps(parsed, ensure_ascii=False))
        except Exception:
            logger.info("qwen unified parsed (non-serializable)")
        return parsed
    return None


def _map_query_classes(raw_classes: List[int]) -> Set[int]:
    """Map query class ids to VIRAT class ids using unified mapping."""
    mapped: Set[int] = set()
    for cid in raw_classes:
        virat_classes = map_query_class_to_virat_classes(cid)
        mapped.update(virat_classes)
    return mapped


def query_json_to_intent(query: Dict[str, Any], fallback: QueryIntent, total_frames: int, fps: float) -> QueryIntent:
    if not query or not isinstance(query, dict):
        return fallback
    intent = QueryIntent(
        raw_query=fallback.raw_query or "",
        target_classes=set(fallback.target_classes or set()),
        target_label=fallback.target_label,
        time_constraint=fallback.time_constraint,
        spatial_constraint=fallback.spatial_constraint,
        behavior_constraint=fallback.behavior_constraint,
        needs_interaction=bool(fallback.needs_interaction),
        interaction_partner_classes=set(fallback.interaction_partner_classes or set()),
        interaction_partner_label=fallback.interaction_partner_label,
    )

    target = query.get("target", {}) if isinstance(query.get("target"), dict) else {}
    raw_classes = target.get("classes") or []
    if isinstance(raw_classes, list):
        mapped_classes = _map_query_classes([int(c) for c in raw_classes if isinstance(c, (int, float))])
        if mapped_classes:
            intent.target_classes = mapped_classes
    if not intent.target_classes:
        intent.target_classes = set(fallback.target_classes or (PERSON_CLASSES | VEHICLE_CLASSES))

    label = target.get("label") if isinstance(target.get("label"), str) else ""
    if label:
        intent.target_label = label

    time_cfg = query.get("time", {}) if isinstance(query.get("time"), dict) else {}
    t_type = (time_cfg.get("type") or "all").lower()
    t_val = time_cfg.get("value")

    if t_type == "last_sec" and isinstance(t_val, (int, float)) and math.isfinite(float(t_val)):
        intent.time_constraint = TimeConstraint(ref_type=TimeReference.RELATIVE_LAST, end_sec=float(t_val))
    elif t_type == "first_sec" and isinstance(t_val, (int, float)) and math.isfinite(float(t_val)):
        intent.time_constraint = TimeConstraint(ref_type=TimeReference.RELATIVE_FIRST, end_sec=float(t_val))
    elif t_type == "first_half":
        intent.time_constraint = TimeConstraint(ref_type=TimeReference.PERCENTAGE, start_sec=0, end_sec=50)
    elif t_type == "last_half":
        intent.time_constraint = TimeConstraint(ref_type=TimeReference.PERCENTAGE, start_sec=50, end_sec=100)
    elif t_type == "range_sec" and isinstance(t_val, list) and len(t_val) == 2:
        start_v = safe_float(t_val[0], math.nan)
        end_v = safe_float(t_val[1], math.nan)
        if math.isfinite(start_v) and math.isfinite(end_v):
            intent.time_constraint = TimeConstraint(
                ref_type=TimeReference.ABSOLUTE_SEC,
                start_sec=float(min(start_v, end_v)),
                end_sec=float(max(start_v, end_v)),
            )

    spatial_cfg = query.get("spatial", {}) if isinstance(query.get("spatial"), dict) else {}
    s_type = (spatial_cfg.get("type") or "none").lower()
    if s_type == "intersection":
        intent.spatial_constraint = SpatialConstraint(region_type=SpatialRegion.INTERSECTION)
    elif s_type == "crosswalk":
        intent.spatial_constraint = SpatialConstraint(region_type=SpatialRegion.CROSSWALK, rect=(0.2, 0.5, 0.8, 0.9))
    elif s_type == "roadside":
        intent.spatial_constraint = SpatialConstraint(region_type=SpatialRegion.ROAD_EDGE)
    elif s_type == "parking_lot":
        intent.spatial_constraint = SpatialConstraint(region_type=SpatialRegion.SCREEN_REGION, screen_region_name="中")
    elif s_type == "area":
        areas = spatial_cfg.get("areas")
        area_name = None
        if isinstance(areas, list):
            for area in areas:
                if isinstance(area, str) and area.strip():
                    area_name = area.strip()
                    break
        intent.spatial_constraint = SpatialConstraint(
            region_type=SpatialRegion.SCREEN_REGION,
            screen_region_name=area_name or "中",
        )

    behavior_cfg = query.get("behavior", {}) if isinstance(query.get("behavior"), dict) else {}
    behaviors = _parse_behavior_actions(behavior_cfg.get("actions"))
    if behaviors:
        intent.behavior_constraint = BehaviorConstraint(behaviors=behaviors)

    inter_cfg = query.get("interaction", {}) if isinstance(query.get("interaction"), dict) else {}
    if inter_cfg.get("enabled"):
        intent.needs_interaction = True
        with_classes = inter_cfg.get("with_classes") or []
        if isinstance(with_classes, list):
            intent.interaction_partner_classes = _map_query_classes([int(c) for c in with_classes if isinstance(c, (int, float))])
        if not intent.interaction_partner_classes:
            intent.interaction_partner_classes = VEHICLE_CLASSES
        if intent.behavior_constraint is None:
            intent.behavior_constraint = BehaviorConstraint()
        intent.behavior_constraint.behaviors.add(BehaviorType.INTERACT)
        intent.behavior_constraint.interact_with_classes = intent.interaction_partner_classes

    if not intent.target_label:
        labels = []
        if intent.target_classes & PERSON_CLASSES:
            labels.append("行人")
        if intent.target_classes & VEHICLE_CLASSES:
            labels.append("车辆")
        if intent.target_classes & BIKE_CLASSES:
            labels.append("骑行者")
        if intent.target_classes & OBJECT_CLASSES:
            labels.append("物体")
        intent.target_label = "、".join(labels) or "目标"

    if intent.time_constraint is None:
        intent.time_constraint = fallback.time_constraint or TimeConstraint(ref_type=TimeReference.ABSOLUTE_SEC, start_sec=0, end_sec=None)
    return intent


def format_output_message(template: str, label: str, count: int, time_range: Optional[List[float]], partner_count: Optional[int] = None) -> str:
    msg = template.replace("{label}", label)
    msg = msg.replace("{count}", str(count))
    if partner_count is not None:
        msg = msg.replace("{partner_count}", str(partner_count))
    if time_range and len(time_range) == 2:
        msg = msg.replace("{time_range}", f"{time_range[0]}-{time_range[1]}秒")
    else:
        msg = msg.replace("{time_range}", "")
    return msg


IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def build_transform(input_size: int):
    if T is not None and InterpolationMode is not None:
        return T.Compose([
            T.Lambda(lambda img: img.convert("RGB") if img.mode != "RGB" else img),
            T.Resize((input_size, input_size), interpolation=InterpolationMode.BICUBIC),
            T.ToTensor(),
            T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ])

    # Fallback transform for environments without torchvision.
    if torch is None or Image is None:
        return None

    try:
        import numpy as _np
    except Exception:
        return None

    mean = torch.tensor(IMAGENET_MEAN, dtype=torch.float32).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=torch.float32).view(3, 1, 1)

    def _fallback_transform(img):
        if img.mode != "RGB":
            img = img.convert("RGB")
        # PIL's BICUBIC is available without torchvision.
        img = img.resize((input_size, input_size), Image.BICUBIC)
        arr = _np.asarray(img, dtype=_np.float32) / 255.0
        tensor = torch.from_numpy(arr).permute(2, 0, 1).contiguous()
        tensor = (tensor - mean) / std
        return tensor

    return _fallback_transform


def find_closest_aspect_ratio(aspect_ratio: float, target_ratios: List[Tuple[int, int]], width: int, height: int, image_size: int):
    best_ratio_diff = float("inf")
    best_ratio = (1, 1)
    area = width * height
    for ratio in target_ratios:
        target_aspect_ratio = ratio[0] / ratio[1]
        ratio_diff = abs(aspect_ratio - target_aspect_ratio)
        if ratio_diff < best_ratio_diff:
            best_ratio_diff = ratio_diff
            best_ratio = ratio
        elif ratio_diff == best_ratio_diff:
            if area > 0.5 * image_size * image_size * ratio[0] * ratio[1]:
                best_ratio = ratio
    return best_ratio


def dynamic_preprocess(image: Image.Image, min_num: int = 1, max_num: int = 6, image_size: int = 448, use_thumbnail: bool = False):
    orig_width, orig_height = image.size
    aspect_ratio = orig_width / orig_height
    target_ratios = set(
        (i, j)
        for n in range(min_num, max_num + 1)
        for i in range(1, n + 1)
        for j in range(1, n + 1)
        if i * j <= max_num and i * j >= min_num
    )
    target_ratios = sorted(target_ratios, key=lambda x: x[0] * x[1])
    target_aspect_ratio = find_closest_aspect_ratio(aspect_ratio, target_ratios, orig_width, orig_height, image_size)
    target_width = image_size * target_aspect_ratio[0]
    target_height = image_size * target_aspect_ratio[1]
    blocks = target_aspect_ratio[0] * target_aspect_ratio[1]
    resized_img = image.resize((target_width, target_height))
    processed_images = []
    for i in range(blocks):
        box = (
            (i % (target_width // image_size)) * image_size,
            (i // (target_width // image_size)) * image_size,
            ((i % (target_width // image_size)) + 1) * image_size,
            ((i // (target_width // image_size)) + 1) * image_size,
        )
        split_img = resized_img.crop(box)
        processed_images.append(split_img)
    if use_thumbnail and len(processed_images) != 1:
        thumbnail_img = image.resize((image_size, image_size))
        processed_images.append(thumbnail_img)
    return processed_images


def build_video_tokens(video_path: Path, bound: Optional[Tuple[float, float]] = None, num_segments: int = 64, input_size: int = 448):
    if VideoReader is None or T is None or Image is None or torch is None:
        return None, None
    logger.info("build_video_tokens opening video: %s", video_path)
    vr = VideoReader(str(video_path), ctx=cpu(0), num_threads=1)
    max_frame = len(vr) - 1
    fps = float(vr.get_avg_fps()) if hasattr(vr, "get_avg_fps") else DEFAULT_FPS
    if bound:
        start, end = bound
        start_idx = max(0, int(start * fps))
        end_idx = min(int(end * fps), max_frame)
    else:
        start_idx, end_idx = 0, max_frame
    seg_size = max(1, (end_idx - start_idx) / float(num_segments))
    frame_indices = [int(start_idx + (seg_size * 0.5) + round(seg_size * idx)) for idx in range(num_segments)]
    transform = build_transform(input_size)
    pixel_values_list = []
    num_patches_list = []
    for frame_index in frame_indices:
        frame_index = min(max_frame, max(0, frame_index))
        img = Image.fromarray(vr[frame_index].asnumpy()).convert("RGB")
        tiles = dynamic_preprocess(img, image_size=input_size, use_thumbnail=True, max_num=1)
        pixel_values = [transform(tile) for tile in tiles]
        stacked = torch.stack(pixel_values)
        num_patches_list.append(stacked.shape[0])
        pixel_values_list.append(stacked)
    pixel_values = torch.cat(pixel_values_list)
    return pixel_values, num_patches_list


def build_image_tokens(image_b64: str, input_size: int = 448):
    if T is None or Image is None or torch is None:
        return None, None
    header, _, payload = image_b64.partition(",")
    raw = base64.b64decode(payload or header)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    transform = build_transform(input_size)
    tiles = dynamic_preprocess(img, image_size=input_size, use_thumbnail=True, max_num=4)
    pv_list = [transform(tile) for tile in tiles]
    pixel_values = torch.stack(pv_list)
    return pixel_values, [pixel_values.shape[0]]


def run_internvideo(
    question: str,
    video_path: Optional[Path] = None,
    bound: Optional[Tuple[float, float]] = None,
    pixel_values: Optional[torch.Tensor] = None,
    num_patches_list: Optional[List[int]] = None,
) -> Optional[str]:
    model, tokenizer = ensure_model()
    if model is None or tokenizer is None:
        return None
    try:
        if pixel_values is None or num_patches_list is None:
            if video_path is None:
                return None
            pixel_values, num_patches_list = build_video_tokens(video_path, bound=bound, num_segments=64)
        if pixel_values is None or num_patches_list is None:
            return None
        num_patches_list = [int(x) for x in num_patches_list if int(x) > 0]
        if not num_patches_list:
            return None
        total_expected = int(sum(num_patches_list))
        total_actual = int(pixel_values.shape[0])
        if total_actual < total_expected:
            logger.warning(
                "model inference skipped: pixel count mismatch actual=%d expected=%d",
                total_actual,
                total_expected,
            )
            return None
        if total_actual > total_expected:
            pixel_values = pixel_values[:total_expected]

        # InternVideo2.5 groups visual tokens by local_num_frames=4.
        frame_count = len(num_patches_list)
        local_num_frames = 4
        usable_frames = (frame_count // local_num_frames) * local_num_frames
        if usable_frames < local_num_frames:
            logger.warning("model inference skipped: insufficient frames for local grouping, frames=%d", frame_count)
            return None
        if usable_frames != frame_count:
            num_patches_list = num_patches_list[:usable_frames]
            keep_patches = int(sum(num_patches_list))
            pixel_values = pixel_values[:keep_patches]
            logger.info("trimmed frame sequence for local grouping: %d -> %d", frame_count, usable_frames)

        if int(pixel_values.shape[0]) != int(sum(num_patches_list)):
            logger.warning(
                "model inference skipped after trim: pixel count mismatch actual=%d expected=%d",
                int(pixel_values.shape[0]),
                int(sum(num_patches_list)),
            )
            return None

        target_dtype = next(model.parameters()).dtype
        pixel_values = pixel_values.to(model.device, dtype=target_dtype)  # type: ignore
        prefix = "".join([f"Frame{i+1}: <image>\n" for i in range(len(num_patches_list))])
        prompt = prefix + question
        generation_config = dict(_generation_config)
        if IV_LOG_PROMPT_IO:
            logger.info(
                "internvideo request frames=%d patches=%d chars=%d prompt=%s",
                len(num_patches_list),
                int(sum(num_patches_list)),
                len(prompt),
                _clip_log_text(prompt),
            )
        with torch.no_grad():
            output, _ = model.chat(
                tokenizer,
                pixel_values,
                prompt,
                generation_config,
                num_patches_list=num_patches_list,
                history=None,
                return_history=True,
            )
        if IV_LOG_PROMPT_IO:
            logger.info("internvideo response chars=%d text=%s", len(str(output or "")), _clip_log_text(output))
        return output
    except Exception as exc:  # pragma: no cover
        logger.warning("model inference failed: %s", exc)
        return None



def _compress_tracks_for_prompt(
    tracks_path: Optional[Path],
    dataset_type: Optional[str],
    limit_tracks: int = 24,
) -> Dict[str, Any]:
    if tracks_path is None or not tracks_path.exists():
        return {"total_tracks": 0, "frame_range": None, "class_counts": {}, "samples": []}

    tracks, frame_range = parse_tracks(tracks_path, dataset_type=dataset_type)
    class_counts: Dict[str, int] = {}
    for t in tracks:
        cls_id = int(t.get("cls", 0))
        key = str(cls_id)
        class_counts[key] = class_counts.get(key, 0) + 1

    ranked = sorted(tracks, key=lambda t: len(t.get("points", [])), reverse=True)[:limit_tracks]
    samples: List[Dict[str, Any]] = []
    for t in ranked:
        points = t.get("points", [])
        if not points:
            continue
        first = points[0]
        mid = points[len(points) // 2]
        last = points[-1]
        samples.append({
            "id": t.get("id"),
            "cls": t.get("cls"),
            "n": len(points),
            "f0": first.get("frame"),
            "f1": last.get("frame"),
            "path": [
                [round(float(first.get("x", 0.0)), 1), round(float(first.get("y", 0.0)), 1)],
                [round(float(mid.get("x", 0.0)), 1), round(float(mid.get("y", 0.0)), 1)],
                [round(float(last.get("x", 0.0)), 1), round(float(last.get("y", 0.0)), 1)],
            ],
        })

    return {
        "total_tracks": len(tracks),
        "frame_range": [frame_range[0], frame_range[1]],
        "class_counts": class_counts,
        "samples": samples,
    }


def _bound_from_unified_plan(unified_plan: Optional[Dict[str, Any]], context: Optional[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    if not isinstance(unified_plan, dict):
        return None
    time_cfg = unified_plan.get("time") if isinstance(unified_plan.get("time"), dict) else {}
    t_type = str(time_cfg.get("type") or "all").lower()
    t_val = time_cfg.get("value")

    max_sec = None
    if isinstance(context, dict):
        try:
            raw_max = context.get("maxSec")
            if raw_max is not None:
                max_sec = float(raw_max)
        except Exception:
            max_sec = None

    if t_type == "range_sec":
        if isinstance(t_val, (int, float)):
            t_val = [t_val]
        if isinstance(t_val, list) and len(t_val) >= 1:
            try:
                start = float(t_val[0])
                if len(t_val) >= 2 and t_val[1] is not None:
                    end = float(t_val[1])
                else:
                    end = max_sec if max_sec is not None else start + 1.0
            except Exception:
                return None
            if end < start:
                start, end = end, start
            if max_sec is not None:
                start = max(0.0, min(start, max_sec))
                end = max(0.0, min(end, max_sec))
            return (round(start, 2), round(max(start, end), 2))

    if t_type == "first_sec" and isinstance(t_val, (int, float)):
        end = max(0.0, float(t_val))
        if max_sec is not None:
            end = min(end, max_sec)
        return (0.0, round(end, 2))

    if t_type == "last_sec" and isinstance(t_val, (int, float)) and max_sec is not None:
        duration = max(0.0, float(t_val))
        start = max(0.0, max_sec - duration)
        return (round(start, 2), round(max_sec, 2))

    return None


def _build_internvideo_prompt_from_plan(
    question: str,
    unified_plan: Optional[Dict[str, Any]],
    track_summary: Optional[Dict[str, Any]] = None,
) -> str:
    plan_json = json.dumps(unified_plan or {}, ensure_ascii=False)
    track_json = json.dumps(track_summary or {}, ensure_ascii=False)
    return (
        "你将收到用户问题、Qwen任务JSON，以及压缩轨迹摘要。"
        "请依据Qwen任务JSON优先执行，并结合轨迹摘要聚焦关键时空片段后分析视频。"
        "输出简洁中文结论。"
        f"\n用户问题: {question}"
        f"\nQwen任务JSON: {plan_json}"
        f"\n压缩轨迹摘要: {track_json}"
    )


def run_internvideo_from_qwen_plan(
    question: str,
    video_path: Optional[Path],
    unified_plan: Optional[Dict[str, Any]],
    tracks_path: Optional[Path] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    if video_path is None or not video_path.exists():
        return None

    dataset_type = (context.get("dataset_type") or context.get("datasetType")) if isinstance(context, dict) else None
    track_summary = _compress_tracks_for_prompt(tracks_path, dataset_type=dataset_type)
    bound = _bound_from_unified_plan(unified_plan, context)

    prompt = _build_internvideo_prompt_from_plan(question, unified_plan, track_summary=track_summary)
    return run_internvideo(prompt, video_path=video_path, bound=bound)


def _load_tracks_and_metadata(
    tracks_path: Path,
    video_path: Optional[Path],
    context: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Tuple[int, int], float, int]:
    """Load tracks and derive frame/fps metadata for downstream filtering."""
    dataset_type = str(context.get("dataset_type") or context.get("datasetType") or "").lower()
    tracks, frame_range = parse_tracks(tracks_path, dataset_type=dataset_type)

    fps_hint = safe_float(
        context.get("activeFps") if context.get("activeFps") is not None else context.get("fps"),
        math.nan,
    )
    if not math.isfinite(fps_hint) or fps_hint <= 0:
        fps_hint = safe_float(context.get("fpsHint"), math.nan)

    is_fused_multi = bool(context.get("isFusedMultiCamera")) or str(context.get("sceneMode") or "") == "fused_multi_camera"

    fps = derive_fps(video_path)
    if math.isfinite(fps_hint) and fps_hint > 0:
        if video_path is None or (isinstance(video_path, Path) and not video_path.exists()) or is_fused_multi or dataset_type == "wildtrack":
            fps = float(fps_hint)
        elif not math.isfinite(fps) or fps <= 1:
            fps = float(fps_hint)

    detector = _behavior_detector
    detector.fps = fps if fps else DEFAULT_FPS

    total_frames = max(0, frame_range[1] - frame_range[0] + 1)
    if total_frames == 0:
        total_frames = int(max(context.get("maxSec", 0) * fps, fps)) if fps else 0

    return tracks, frame_range, fps, total_frames


def _parse_user_intent(
    question: str,
    context: Dict[str, Any],
    total_frames: int,
    fps: float,
    unified: Optional[Dict[str, Any]] = None,
) -> QueryIntent:
    """Parse user intent from Qwen JSON only."""
    unified_plan = unified or generate_unified_plan(question, context)
    base_intent = QueryIntent(raw_query=question)

    intent = query_json_to_intent(unified_plan or {}, base_intent, total_frames, fps)
    if not intent.target_classes:
        intent.target_classes = PERSON_CLASSES | VEHICLE_CLASSES
        intent.target_label = "车辆和行人"
    return intent


def _filter_tracks_by_intent(
    tracks: List[Dict[str, Any]],
    intent: QueryIntent,
    frame_range: Tuple[int, int],
    fps: float,
    total_frames: int
) -> Tuple[List[Dict[str, Any]], Tuple[int, int]]:
    """Filter tracks by class, time, and spatial constraints."""
    time_constraint = intent.time_constraint or TimeConstraint(ref_type=TimeReference.ABSOLUTE_SEC, start_sec=0, end_sec=None)
    rel_start, rel_end = time_constraint.resolve(total_frames if total_frames > 0 else int(fps), fps if fps else DEFAULT_FPS)
    abs_start = (frame_range[0] + rel_start) if frame_range != (0, 0) else rel_start
    abs_end = (frame_range[0] + rel_end) if frame_range != (0, 0) else rel_end
    safe_fps = max(1e-6, float(fps or DEFAULT_FPS))

    def within_time(p_frame: int) -> bool:
        return abs_start <= p_frame <= abs_end

    # Filter by class and time
    candidate_tracks = [
        t for t in tracks 
        if t.get("cls") in intent.target_classes 
        and any(within_time(p.get("frame", 0)) for p in t.get("points", []))
    ]

    # Spatial filter
    spatial_bounds: Optional[Tuple[float, float, float, float]] = None
    if intent.spatial_constraint and intent.spatial_constraint.region_type == SpatialRegion.SCREEN_REGION:
        xs: List[float] = []
        ys: List[float] = []
        for t in candidate_tracks:
            for p in t.get("points", []):
                if not within_time(p.get("frame", 0)):
                    continue
                x = safe_float(p.get("x"), math.nan)
                y = safe_float(p.get("y"), math.nan)
                if math.isfinite(x) and math.isfinite(y):
                    xs.append(x)
                    ys.append(y)
        if xs and ys:
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            if (max_x - min_x) > 1e-6 and (max_y - min_y) > 1e-6:
                spatial_bounds = (min_x, max_x, min_y, max_y)

    def in_dynamic_screen_region(x: float, y: float, region_name: Optional[str]) -> bool:
        if spatial_bounds is None:
            return True
        min_x, max_x, min_y, max_y = spatial_bounds
        nx = (x - min_x) / max(max_x - min_x, 1e-6)
        ny = (y - min_y) / max(max_y - min_y, 1e-6)
        return _match_named_screen_region(nx, ny, region_name)

    def _max_contiguous_span(frames: List[int], max_gap: int = 2) -> int:
        if not frames:
            return 0
        seq = sorted(set(int(f) for f in frames))
        start = seq[0]
        last = seq[0]
        best = 1
        for f in seq[1:]:
            if f - last <= max_gap:
                last = f
                continue
            best = max(best, last - start + 1)
            start = f
            last = f
        return max(best, last - start + 1)

    def track_in_spatial(t: Dict[str, Any]) -> bool:
        if intent.spatial_constraint is None:
            return True
        if intent.spatial_constraint.region_type == SpatialRegion.SCREEN_REGION and spatial_bounds is not None:
            hit_frames: List[int] = []
            all_frames: List[int] = []
            for p in t.get("points", []):
                frame_id = int(p.get("frame", 0))
                if not within_time(frame_id):
                    continue
                all_frames.append(frame_id)
                x = safe_float(p.get("x"), 0.0)
                y = safe_float(p.get("y"), 0.0)
                if in_dynamic_screen_region(x, y, intent.spatial_constraint.screen_region_name):
                    hit_frames.append(frame_id)
            if not hit_frames:
                return False

            all_sorted = sorted(set(all_frames))
            frame_steps = [
                max(1, int(all_sorted[i + 1] - all_sorted[i]))
                for i in range(len(all_sorted) - 1)
                if all_sorted[i + 1] > all_sorted[i]
            ]
            sample_gap = max(1, int(round(_median([float(v) for v in frame_steps])))) if frame_steps else 1
            adaptive_gap = max(2, int(round(2.5 * sample_gap)))
            span_frames = _max_contiguous_span(hit_frames, max_gap=adaptive_gap)
            min_hit_points = max(2, int(math.ceil(SCREEN_REGION_MIN_DWELL_SEC * safe_fps / max(1, sample_gap))))
            return (span_frames / safe_fps) >= SCREEN_REGION_MIN_DWELL_SEC and len(set(hit_frames)) >= min_hit_points

        for p in t.get("points", []):
            if not within_time(p.get("frame", 0)):
                continue
            x = safe_float(p.get("x"), 0.0)
            y = safe_float(p.get("y"), 0.0)
            if intent.spatial_constraint.contains_point(x, y):
                return True
        return False

    spatial_tracks = [t for t in candidate_tracks if track_in_spatial(t)]
    return spatial_tracks, (abs_start, abs_end)


def _detect_behaviors_and_interactions(
    tracks: List[Dict[str, Any]],
    spatial_tracks: List[Dict[str, Any]],
    intent: QueryIntent,
    frame_range: Tuple[int, int],
    fps: float,
    unified: Optional[Dict[str, Any]]
) -> Tuple[Set[int], Optional[Dict[str, Any]], Set[int], Set[int], bool]:
    """Detect behaviors and interactions, return behavior_ids, interaction_result, interaction_ids, interaction_partner_ids, include_all_partners."""
    detector = _behavior_detector
    abs_start, abs_end = frame_range
    
    # Behavior detection
    behavior_hits = detector.detect_behaviors(
        spatial_tracks,
        (abs_start, abs_end),
        intent.spatial_constraint,
        intent.behavior_constraint,
    )
    behavior_ids = set(behavior_hits.keys())

    # Interaction detection if needed
    interaction_result = None
    interaction_ids: Set[int] = set()
    interaction_partner_ids: Set[int] = set()
    include_all_partners = False
    
    if isinstance(unified, dict):
        interaction_cfg = unified.get("interaction") if isinstance(unified.get("interaction"), dict) else {}
        include_all_partners = bool(interaction_cfg.get("include_all_partners"))
    
    if intent.needs_interaction:
        partner_classes = intent.interaction_partner_classes or VEHICLE_CLASSES
        subject_classes = intent.target_classes or PERSON_CLASSES
        interaction_result = detect_interactions(
            tracks,
            fps or DEFAULT_FPS,
            (abs_start, abs_end),
            subject_classes=subject_classes,
            partner_classes=partner_classes,
        )
        interaction_ids = set(interaction_result.get("highlights", []))
        partners_map = interaction_result.get("partners", {}) if isinstance(interaction_result, dict) else {}
        if partners_map:
            interaction_partner_ids = {vid for vids in partners_map.values() for vid in vids}
    
    return behavior_ids, interaction_result, interaction_ids, interaction_partner_ids, include_all_partners


def _compute_highlights(
    spatial_tracks: List[Dict[str, Any]],
    behavior_ids: Set[int],
    intent: QueryIntent,
    interaction_ids: Set[int],
    interaction_partner_ids: Set[int],
    include_all_partners: bool
) -> List[int]:
    """Compute final highlight track IDs based on all filters."""
    base_ids = {t["id"] for t in spatial_tracks}
    
    if behavior_ids:
        base_ids = base_ids & behavior_ids if base_ids else behavior_ids
    
    if intent.needs_interaction and interaction_ids:
        interaction_hit_ids = set(interaction_ids)
        if (intent.target_classes & VEHICLE_CLASSES) and interaction_partner_ids:
            interaction_hit_ids |= interaction_partner_ids
        if include_all_partners and interaction_partner_ids:
            interaction_hit_ids |= interaction_partner_ids
        if intent.spatial_constraint is not None:
            base_ids = interaction_hit_ids & base_ids if base_ids else interaction_hit_ids
        else:
            base_ids = interaction_hit_ids
    
    return sorted(list(base_ids))





def _slice_track_points(track: Dict[str, Any], frame_range: Tuple[int, int]) -> List[Dict[str, Any]]:
    start_f, end_f = frame_range
    pts = [p for p in (track.get("points") or []) if start_f <= int(p.get("frame", -1)) <= end_f]
    pts.sort(key=lambda p: int(p.get("frame", 0)))
    return pts


def _track_motion_profile(points: List[Dict[str, Any]], fps: float) -> Dict[str, float]:
    if len(points) < 2:
        return {
            "durationSec": 0.0,
            "displacement": 0.0,
            "avgSpeed": 0.0,
            "maxSpeed": 0.0,
            "stopRatio": 1.0,
        }

    safe_fps = max(1e-6, float(fps or DEFAULT_FPS))
    first = points[0]
    last = points[-1]
    duration_sec = max(0.0, (float(last.get("frame", 0)) - float(first.get("frame", 0))) / safe_fps)
    displacement = math.hypot(
        safe_float(last.get("x"), 0.0) - safe_float(first.get("x"), 0.0),
        safe_float(last.get("y"), 0.0) - safe_float(first.get("y"), 0.0),
    )

    speeds: List[float] = []
    for i in range(1, len(points)):
        p0, p1 = points[i - 1], points[i]
        df = max(1.0, float(p1.get("frame", 0)) - float(p0.get("frame", 0)))
        dt = df / safe_fps
        dist = math.hypot(
            safe_float(p1.get("x"), 0.0) - safe_float(p0.get("x"), 0.0),
            safe_float(p1.get("y"), 0.0) - safe_float(p0.get("y"), 0.0),
        )
        speeds.append(dist / max(1e-6, dt))

    avg_speed = sum(speeds) / max(1, len(speeds))
    max_speed = max(speeds) if speeds else 0.0
    stop_th = max(1.0, 0.2 * avg_speed)
    stop_ratio = sum(1 for v in speeds if v <= stop_th) / max(1, len(speeds))

    return {
        "durationSec": round(duration_sec, 3),
        "displacement": round(displacement, 3),
        "avgSpeed": round(avg_speed, 3),
        "maxSpeed": round(max_speed, 3),
        "stopRatio": round(stop_ratio, 3),
    }


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    vals = sorted(float(v) for v in values)
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return 0.5 * (vals[mid - 1] + vals[mid])


def _mad(values: List[float], med: Optional[float] = None) -> float:
    if not values:
        return 0.0
    m = _median(values) if med is None else float(med)
    return _median([abs(float(v) - m) for v in values])


def _quantile(values: List[float], q: float, default: float = 0.0) -> float:
    if not values:
        return float(default)
    qq = min(1.0, max(0.0, float(q)))
    vals = sorted(float(v) for v in values)
    pos = qq * (len(vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return vals[lo]
    alpha = pos - lo
    return vals[lo] * (1.0 - alpha) + vals[hi] * alpha


def _extract_region_order(question: str) -> Tuple[Optional[str], Optional[str]]:
    text = question or ""
    regions = ["左上", "右上", "左下", "右下", "左", "右", "上", "下", "中"]
    hits: List[Tuple[int, str]] = []
    for r in regions:
        idx = text.find(r)
        if idx >= 0:
            hits.append((idx, r))
    hits.sort(key=lambda x: x[0])
    if len(hits) >= 2:
        return hits[0][1], hits[1][1]
    return None, None


def _region_of_point(x: float, y: float, bounds: Tuple[float, float, float, float]) -> str:
    min_x, max_x, min_y, max_y = bounds
    nx = (x - min_x) / max(1e-6, max_x - min_x)
    ny = (y - min_y) / max(1e-6, max_y - min_y)
    if nx < 0.45 and ny < 0.45:
        return "左上"
    if nx > 0.55 and ny < 0.45:
        return "右上"
    if nx < 0.45 and ny > 0.55:
        return "左下"
    if nx > 0.55 and ny > 0.55:
        return "右下"
    if nx < 0.4:
        return "左"
    if nx > 0.6:
        return "右"
    if ny < 0.4:
        return "上"
    if ny > 0.6:
        return "下"
    return "中"


def _build_trajectory_evidence(
    question: str,
    intent: QueryIntent,
    tracks: List[Dict[str, Any]],
    spatial_tracks: List[Dict[str, Any]],
    highlights: List[int],
    abs_frame_range: Tuple[int, int],
    fps: float,
    cluster_result: ClusterResult,
    unified_plan: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    planned_ops = _trajectory_operators_from_plan(unified_plan)
    planned_tags = {op.get("name") for op in planned_ops if isinstance(op.get("name"), str)}
    tags = set(planned_tags) if planned_tags else set()
    tags.add("overview")

    track_index = {int(t.get("id")): t for t in tracks if t.get("id") is not None}
    if intent.spatial_constraint is not None:
        candidate_tracks = spatial_tracks
    else:
        candidate_tracks = spatial_tracks if spatial_tracks else tracks
    if highlights:
        analysis_tracks = [track_index[hid] for hid in highlights if hid in track_index]
        if not analysis_tracks:
            analysis_tracks = candidate_tracks
    else:
        analysis_tracks = candidate_tracks

    abs_start, abs_end = abs_frame_range
    safe_fps = max(1e-6, float(fps or DEFAULT_FPS))
    time_range_sec = [round(abs_start / safe_fps, 2), round(abs_end / safe_fps, 2)]

    stats_by_id: Dict[int, Dict[str, Any]] = {}
    avg_speeds: List[float] = []
    xs: List[float] = []
    ys: List[float] = []

    for t in analysis_tracks:
        tid = int(t.get("id", -1))
        pts = _slice_track_points(t, abs_frame_range)
        if not pts:
            continue
        prof = _track_motion_profile(pts, safe_fps)
        stats_by_id[tid] = {
            "id": tid,
            "cls": int(t.get("cls", 0)),
            "first": pts[0],
            "last": pts[-1],
            "n": len(pts),
            **prof,
        }
        avg_speeds.append(prof["avgSpeed"])
        xs.extend([safe_float(p.get("x"), 0.0) for p in pts])
        ys.extend([safe_float(p.get("y"), 0.0) for p in pts])

    evidences: List[Dict[str, Any]] = []

    overview_ids = sorted(list(stats_by_id.keys()))[:30]
    evidences.append({
        "type": "selection_overview",
        "label": "筛选概览",
        "description": "轨迹算子阶段的基础候选集合。",
        "ids": overview_ids,
        "timeSecRange": time_range_sec,
        "score": round(min(1.0, len(stats_by_id) / max(1, len(candidate_tracks))), 3),
        "metrics": {
            "candidateTracks": len(candidate_tracks),
            "analysisTracks": len(stats_by_id),
            "highlightCount": len(highlights),
            "plannerOperators": sorted([str(x) for x in planned_tags]),
        },
    })

    if "dwell" in tags and stats_by_id:
        dwell_params = _operator_params(planned_ops, "dwell")
        dwell_min_dur = safe_float(dwell_params.get("min_duration_sec"), max(3.0, 0.08 * (time_range_sec[1] - time_range_sec[0])))
        dwell_min_dur = max(1.0, dwell_min_dur)
        ranked = sorted(
            stats_by_id.values(),
            key=lambda s_info: (s_info.get("durationSec", 0.0), -s_info.get("avgSpeed", 0.0), s_info.get("stopRatio", 0.0)),
            reverse=True,
        )
        dwell_ids = [int(s_info["id"]) for s_info in ranked if s_info.get("durationSec", 0.0) >= dwell_min_dur][:20]
        if not dwell_ids:
            dwell_ids = [int(s_info["id"]) for s_info in ranked[:10]]
        evidences.append({
            "type": "dwell_candidates",
            "label": "停留/排队候选",
            "description": "按长时段停留与低位移速度排序得到的候选。",
            "ids": dwell_ids,
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, len(dwell_ids) / max(1, len(stats_by_id))), 3),
            "metrics": {
                "medianDurationSec": round(_median([s_info.get("durationSec", 0.0) for s_info in ranked]), 3),
                "medianAvgSpeed": round(_median([s_info.get("avgSpeed", 0.0) for s_info in ranked]), 3),
                "minDurationSec": round(dwell_min_dur, 3),
            },
        })

    if "speed" in tags and stats_by_id:
        med = _median(avg_speeds)
        mad = max(1e-6, _mad(avg_speeds, med))
        outliers: List[int] = []
        for s_info in stats_by_id.values():
            z = abs((s_info.get("avgSpeed", 0.0) - med) / (1.4826 * mad))
            if z >= 2.0 and s_info.get("avgSpeed", 0.0) > med:
                outliers.append(int(s_info["id"]))
        if not outliers:
            outliers = [int(s_info["id"]) for s_info in sorted(stats_by_id.values(), key=lambda x: x.get("avgSpeed", 0.0), reverse=True)[:10]]
        evidences.append({
            "type": "speed_outliers",
            "label": "速度异常候选",
            "description": "基于轨迹速度的鲁棒离群检测（MAD）。",
            "ids": outliers,
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, len(outliers) / max(1, len(stats_by_id))), 3),
            "metrics": {
                "medianSpeed": round(med, 3),
                "madSpeed": round(mad, 3),
            },
        })

    if "stop_go" in tags and stats_by_id:
        stop_go_params = _operator_params(planned_ops, "stop_go")
        low_factor = min(1.0, max(0.2, safe_float(stop_go_params.get("low_factor"), 0.5)))
        high_factor = max(1.2, safe_float(stop_go_params.get("high_factor"), 1.8))
        stop_go_ids: List[int] = []
        for s_track in analysis_tracks:
            tid = int(s_track.get("id", -1))
            pts = _slice_track_points(s_track, abs_frame_range)
            if len(pts) < 5:
                continue
            speeds: List[float] = []
            for i in range(1, len(pts)):
                p0, p1 = pts[i - 1], pts[i]
                dt = max(1e-6, (int(p1.get("frame", 0)) - int(p0.get("frame", 0))) / safe_fps)
                dist = math.hypot(
                    safe_float(p1.get("x"), 0.0) - safe_float(p0.get("x"), 0.0),
                    safe_float(p1.get("y"), 0.0) - safe_float(p0.get("y"), 0.0),
                )
                speeds.append(dist / dt)
            if not speeds:
                continue
            s_med = _median(speeds)
            low = [v <= max(1.0, low_factor * s_med) for v in speeds]
            high = [v >= max(2.0, high_factor * s_med) for v in speeds]
            has_pause = any(low[i] and low[i + 1] for i in range(max(0, len(low) - 1)))
            has_leave = any(high)
            if has_pause and has_leave:
                stop_go_ids.append(tid)
        evidences.append({
            "type": "stop_then_go",
            "label": "停后快走候选",
            "description": "检测先低速停顿再快速离开的轨迹。",
            "ids": stop_go_ids[:20],
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, len(stop_go_ids) / max(1, len(stats_by_id))), 3),
            "metrics": {
                "count": len(stop_go_ids),
                "lowFactor": round(low_factor, 3),
                "highFactor": round(high_factor, 3),
            },
        })

    if "low_motion" in tags and stats_by_id:
        low_params = _operator_params(planned_ops, "low_motion")
        speed_q = min(0.95, max(0.05, safe_float(low_params.get("speed_quantile_max"), 0.35)))
        disp_q = min(0.95, max(0.05, safe_float(low_params.get("displacement_quantile_max"), 0.35)))
        min_dur = max(1.0, safe_float(low_params.get("min_duration_sec"), max(3.0, 0.06 * (time_range_sec[1] - time_range_sec[0]))))
        speed_cap_rel = _quantile([s_info.get("avgSpeed", 0.0) for s_info in stats_by_id.values()], speed_q, 0.0)
        disp_cap_rel = _quantile([s_info.get("displacement", 0.0) for s_info in stats_by_id.values()], disp_q, 0.0)
        speed_cap_abs = max(0.0, safe_float(low_params.get("speed_abs_max"), LOW_MOTION_ABS_SPEED_MAX))
        disp_cap_abs = max(0.0, safe_float(low_params.get("displacement_abs_max"), LOW_MOTION_ABS_DISPLACEMENT_MAX))
        speed_cap = min(speed_cap_rel, speed_cap_abs)
        disp_cap = min(disp_cap_rel, disp_cap_abs)
        low_motion_ids = [
            int(s_info["id"])
            for s_info in stats_by_id.values()
            if s_info.get("avgSpeed", 0.0) <= speed_cap
            and s_info.get("displacement", 0.0) <= disp_cap
            and s_info.get("durationSec", 0.0) >= min_dur
        ][:24]
        evidences.append({
            "type": "low_motion_small_displacement",
            "label": "低速小位移候选",
            "description": "结合速度分位与位移分位筛选低速且位移小的人群。",
            "ids": low_motion_ids,
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, len(low_motion_ids) / max(1, len(stats_by_id))), 3),
            "metrics": {
                "speedQuantileMax": round(speed_q, 3),
                "displacementQuantileMax": round(disp_q, 3),
                "speedCapRelative": round(speed_cap_rel, 3),
                "displacementCapRelative": round(disp_cap_rel, 3),
                "speedCapAbsolute": round(speed_cap_abs, 3),
                "displacementCapAbsolute": round(disp_cap_abs, 3),
                "speedCap": round(speed_cap, 3),
                "displacementCap": round(disp_cap, 3),
                "minDurationSec": round(min_dur, 3),
                "hitCount": len(low_motion_ids),
            },
        })

    if "route" in tags and stats_by_id:
        cluster_counts: Dict[int, int] = defaultdict(int)
        for tid in stats_by_id.keys():
            cid = cluster_result.final_clusters.get(tid)
            if cid is not None:
                cluster_counts[int(cid)] += 1
        top_clusters = sorted(cluster_counts.items(), key=lambda kv: kv[1], reverse=True)[:3]
        route_ids: List[int] = []
        for cid, _ in top_clusters:
            route_ids.extend([tid for tid, tcid in cluster_result.final_clusters.items() if tcid == cid][:8])
        evidences.append({
            "type": "main_routes",
            "label": "主流路线簇",
            "description": "基于轨迹聚类的主流行进模式。",
            "ids": route_ids[:30],
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, sum(c for _, c in top_clusters) / max(1, len(stats_by_id))), 3),
            "metrics": {"topClusters": [{"cluster": int(cid), "count": int(c)} for cid, c in top_clusters]},
        })

    if "flow" in tags and stats_by_id:
        enter_ids: List[int] = []
        exit_ids: List[int] = []
        margin = max(3, int(2 * safe_fps))
        for tid, s_info in stats_by_id.items():
            first_f = int(s_info["first"].get("frame", abs_start))
            last_f = int(s_info["last"].get("frame", abs_end))
            if first_f > abs_start + margin:
                enter_ids.append(tid)
            if last_f < abs_end - margin:
                exit_ids.append(tid)
        evidences.append({
            "type": "flow_split",
            "label": "进出流量",
            "description": "按时间窗内首次/末次出现帧近似估计进入和离开。",
            "ids": (enter_ids[:12] + exit_ids[:12]),
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, (len(enter_ids) + len(exit_ids)) / max(1, len(stats_by_id))), 3),
            "metrics": {"enterCount": len(enter_ids), "exitCount": len(exit_ids)},
        })

    if "cross" in tags and stats_by_id and xs and ys:
        from_region, to_region = _extract_region_order(question)
        bounds = (min(xs), max(xs), min(ys), max(ys))
        cross_ids: List[int] = []
        if from_region and to_region:
            for tid, s_info in stats_by_id.items():
                p0 = s_info["first"]
                p1 = s_info["last"]
                start_r = _region_of_point(safe_float(p0.get("x"), 0.0), safe_float(p0.get("y"), 0.0), bounds)
                end_r = _region_of_point(safe_float(p1.get("x"), 0.0), safe_float(p1.get("y"), 0.0), bounds)
                if start_r == from_region and end_r == to_region:
                    cross_ids.append(tid)
        evidences.append({
            "type": "cross_region_transfer",
            "label": "跨区域穿行",
            "description": "检测从起始区域到目标区域的轨迹迁移。",
            "ids": cross_ids[:20],
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, len(cross_ids) / max(1, len(stats_by_id))), 3),
            "metrics": {"from": from_region, "to": to_region, "count": len(cross_ids)},
        })

    if "crowd_density" in tags and stats_by_id and xs and ys:
        density_params = _operator_params(planned_ops, "crowd_density")
        grid_size = int(max(3, min(8, safe_float(density_params.get("grid_size"), 4))))
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        span_x = max(1e-6, max_x - min_x)
        span_y = max(1e-6, max_y - min_y)
        cell_to_ids: Dict[str, Set[int]] = defaultdict(set)
        for tid, info in stats_by_id.items():
            p0 = info.get("last") or info.get("first") or {}
            px = safe_float(p0.get("x"), min_x)
            py = safe_float(p0.get("y"), min_y)
            ix = min(grid_size - 1, max(0, int((px - min_x) / span_x * grid_size)))
            iy = min(grid_size - 1, max(0, int((py - min_y) / span_y * grid_size)))
            cell_to_ids[f"{ix},{iy}"].add(int(tid))
        top_cells = sorted(cell_to_ids.items(), key=lambda kv: len(kv[1]), reverse=True)[:3]
        density_ids: List[int] = []
        for _, ids in top_cells:
            density_ids.extend(sorted(list(ids))[:12])
        density_ids = density_ids[:30]
        top_count = len(top_cells[0][1]) if top_cells else 0
        evidences.append({
            "type": "crowd_density_hotspots",
            "label": "拥堵密集候选",
            "description": "基于空间网格聚集度识别密集区域中的人群。",
            "ids": density_ids,
            "timeSecRange": time_range_sec,
            "score": round(min(1.0, top_count / max(1, len(stats_by_id))), 3),
            "metrics": {
                "gridSize": grid_size,
                "topCells": [{"cell": cell, "count": len(ids)} for cell, ids in top_cells],
            },
        })

    return evidences[:10]


def _estimate_trajectory_confidence(
    highlights: List[int],
    spatial_tracks: List[Dict[str, Any]],
    trajectory_evidence: List[Dict[str, Any]],
) -> float:
    candidate_n = max(1, len(spatial_tracks))
    highlight_coverage = min(1.0, len(highlights) / candidate_n)

    specific_scores: List[float] = []
    for ev in trajectory_evidence:
        try:
            if ev.get("type") == "selection_overview":
                continue
            ids = ev.get("ids")
            if not isinstance(ids, list) or not ids:
                continue
            sc = float(ev.get("score", 0.0))
            specific_scores.append(max(0.0, min(1.0, sc)))
        except Exception:
            continue

    best_specific = max(specific_scores) if specific_scores else 0.0
    consistency = (sum(specific_scores) / len(specific_scores)) if specific_scores else 0.0

    conf = 0.18 + 0.34 * highlight_coverage + 0.28 * best_specific + 0.20 * consistency
    if not specific_scores:
        conf -= 0.15
    if not highlights:
        conf -= 0.08
    return round(max(0.08, min(0.93, conf)), 3)


def _evidence_ids_by_type(trajectory_evidence: List[Dict[str, Any]], evidence_type: str) -> Set[int]:
    ids: Set[int] = set()
    for ev in trajectory_evidence:
        if not isinstance(ev, dict) or ev.get("type") != evidence_type:
            continue
        raw_ids = ev.get("ids")
        if not isinstance(raw_ids, list):
            continue
        for tid in raw_ids:
            try:
                ids.add(int(tid))
            except Exception:
                continue
    return ids


def _apply_trajectory_constraints_to_highlights(
    highlights: List[int],
    trajectory_evidence: List[Dict[str, Any]],
    unified_plan: Optional[Dict[str, Any]],
    fallback_ids: Optional[List[int]] = None,
) -> List[int]:
    planned_ops = _trajectory_operators_from_plan(unified_plan)
    seed = [int(tid) for tid in highlights] if highlights else [int(tid) for tid in (fallback_ids or [])]
    if not seed:
        return []
    if not planned_ops:
        return sorted(list(set(seed)))

    # Strict operators must constrain final highlights instead of only being descriptive evidence.
    strict_evidence_map = {
        "low_motion": "low_motion_small_displacement",
        "dwell": "dwell_candidates",
    }

    constrained = set(seed)
    for op in planned_ops:
        name = op.get("name") if isinstance(op, dict) else None
        if not isinstance(name, str):
            continue
        evidence_type = strict_evidence_map.get(name)
        if evidence_type is None:
            continue
        op_ids = _evidence_ids_by_type(trajectory_evidence, evidence_type)
        if not op_ids:
            constrained.clear()
            break
        constrained &= op_ids

    return sorted(list(constrained))


def _build_response_message(
    question: str,
    intent: QueryIntent,
    highlights: List[int],
    time_range_sec: Optional[List[float]],
    interaction_result: Optional[Dict[str, Any]],
    objective_facts: Optional[Dict[str, Any]],
    fps: float,
    unified: Optional[Dict[str, Any]],
    interaction_partner_ids: Set[int],
    include_all_partners: bool,
    tracks: Optional[List[Dict[str, Any]]] = None,
    frame_range: Optional[Tuple[int, int]] = None,
) -> str:
    """Build the response message text."""
    time_constraint = intent.time_constraint or TimeConstraint(ref_type=TimeReference.ABSOLUTE_SEC, start_sec=0, end_sec=None)
    
    # Build message parts
    parts = []
    if time_constraint.ref_type == TimeReference.RELATIVE_LAST and time_constraint.end_sec:
        parts.append(f"最后{int(time_constraint.end_sec)}秒内")
    elif time_constraint.ref_type == TimeReference.RELATIVE_FIRST and time_constraint.end_sec:
        parts.append(f"前{int(time_constraint.end_sec)}秒内")
    elif time_range_sec:
        parts.append(f"{time_range_sec[0]}–{time_range_sec[1]}秒")
    
    if intent.spatial_constraint:
        if intent.spatial_constraint.region_type == SpatialRegion.INTERSECTION:
            parts.append("在路口")
        elif intent.spatial_constraint.region_type == SpatialRegion.CROSSWALK:
            parts.append("在斑马线区域")
        elif intent.spatial_constraint.region_type == SpatialRegion.ROAD_EDGE:
            parts.append("在路边")
        elif intent.spatial_constraint.region_type == SpatialRegion.SCREEN_REGION:
            parts.append(f"在画面{intent.spatial_constraint.screen_region_name or ''}")
    
    if intent.behavior_constraint and intent.behavior_constraint.behaviors:
        behavior_names = [
            _BEHAVIOR_DISPLAY_NAME[b]
            for b in intent.behavior_constraint.behaviors
            if b in _BEHAVIOR_DISPLAY_NAME
        ]
        if behavior_names:
            parts.append("、".join(behavior_names))
    
    label = intent.target_label or "目标"
    message_prefix = "、".join(parts) if parts else "已标注"
    if highlights:
        message = f"{message_prefix}的{label}，共 {len(highlights)} 条"
    else:
        message = f"{message_prefix}的{label}，未找到匹配轨迹"

    # Apply LLM output template if available
    output_cfg = unified.get("output") if isinstance(unified, dict) else None
    output_template = output_cfg.get("message") if isinstance(output_cfg, dict) else None
    if output_template:
        partner_count = len(interaction_partner_ids) if include_all_partners else None
        message = format_output_message(output_template, label, len(highlights), time_range_sec, partner_count=partner_count)

    # Structured response for interaction queries: facts -> text LLM report
    if intent.needs_interaction:
        facts = objective_facts or extract_objective_facts_from_interaction_result(
            interaction_result,
            fps,
            frame_range,
        )
        message = build_chinese_report_from_objective_facts(question, facts)
    
    return message


def _assemble_response_core(
    question: str,
    ctx: Dict[str, Any],
    tracks: List[Dict[str, Any]],
    frame_range: Tuple[int, int],
    fps: float,
    total_frames: int,
    unified: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Assemble response using a provided unified plan (or auto-generate if missing)."""
    unified_plan = unified or generate_unified_plan(question, ctx)

    # 1. Parse user intent
    intent = _parse_user_intent(question, ctx, total_frames, fps, unified_plan)

    # 2. Filter tracks by intent
    spatial_tracks, abs_frame_range = _filter_tracks_by_intent(tracks, intent, frame_range, fps, total_frames)

    # 3. Detect behaviors and interactions
    behavior_ids, interaction_result, interaction_ids, interaction_partner_ids, include_all_partners = _detect_behaviors_and_interactions(
        tracks, spatial_tracks, intent, abs_frame_range, fps, unified_plan
    )

    # 4. Compute highlights
    highlights = _compute_highlights(
        spatial_tracks, behavior_ids, intent,
        interaction_ids, interaction_partner_ids, include_all_partners
    )

    # 4.5 Cluster candidate tracks for grouped browsing and anomaly focus
    cluster_result = cluster_tracks(
        tracks=spatial_tracks,
        frame_range=abs_frame_range,
        fps=fps,
        interaction_result=interaction_result,
    )

    # 5. Build objective facts for interaction
    objective_facts = extract_objective_facts_from_interaction_result(
        interaction_result,
        fps,
        abs_frame_range,
    )

    # 5.5 Trajectory-first evidence layer (Phase 1)
    trajectory_evidence = _build_trajectory_evidence(
        question,
        intent,
        tracks,
        spatial_tracks,
        highlights,
        abs_frame_range,
        fps,
        cluster_result,
        unified_plan=unified_plan,
    )
    constrained_highlights = _apply_trajectory_constraints_to_highlights(
        highlights,
        trajectory_evidence,
        unified_plan,
        fallback_ids=[int(t.get("id")) for t in spatial_tracks if t.get("id") is not None],
    )
    if constrained_highlights != highlights:
        highlights = constrained_highlights
        trajectory_evidence = _build_trajectory_evidence(
            question,
            intent,
            tracks,
            spatial_tracks,
            highlights,
            abs_frame_range,
            fps,
            cluster_result,
            unified_plan=unified_plan,
        )
    trajectory_confidence = _estimate_trajectory_confidence(highlights, spatial_tracks, trajectory_evidence)
    planner_ops = _trajectory_operators_from_plan(unified_plan)
    reasoning_mode = "trajectory-first-llm" if planner_ops else "trajectory-first"

    # 6. Build response message
    abs_start, abs_end = abs_frame_range
    start_sec = abs_start / fps if fps else 0.0
    end_sec = abs_end / fps if fps else start_sec
    time_range_sec = [round(start_sec, 2), round(end_sec, 2)] if fps else None

    message = _build_response_message(
        question,
        intent,
        highlights,
        time_range_sec,
        interaction_result,
        objective_facts,
        fps,
        unified_plan,
        interaction_partner_ids, include_all_partners,
        tracks=tracks, frame_range=abs_frame_range
    )

    # 7. Build final response
    filter_classes = set(intent.target_classes)
    if intent.needs_interaction:
        filter_classes |= intent.interaction_partner_classes or set()
    if intent.behavior_constraint and BehaviorType.INTERACT in intent.behavior_constraint.behaviors:
        filter_classes |= {VIRAT_CLASS_PERSON}  # Use unified mapping

    dim_ids = [t["id"] for t in tracks if t.get("id") not in highlights]
    resp = {
        "message": message,
        "filter": {
            "classes": sorted(list(filter_classes)) if filter_classes else sorted(list(intent.target_classes)),
            "minFrames": ctx.get("minFrames", None),
            "timeSecRange": time_range_sec,
        },
        "highlights": highlights,
        "dim": {"trackIds": dim_ids, "mode": "hide" if highlights else "opacity"},
        "viz": {
            "opacityTracks": 0.6 if highlights else None,
            "opacityVideo": 0.85 if highlights else None,
        },
        "trajectoryEvidence": trajectory_evidence,
        "confidence": {
            "trajectory": trajectory_confidence,
            "final": trajectory_confidence,
        },
        "reasoningMode": reasoning_mode,
        "trajectoryPlanner": {"operators": [op.get("name") for op in planner_ops], "source": "llm" if planner_ops else "fallback"},
    }

    # Attach interaction window if available
    if interaction_result and interaction_result.get("timeSecRange"):
        resp["filter"]["timeSecRange"] = interaction_result["timeSecRange"]

    resp["clusters"] = {
        "trackClusters": cluster_result.final_clusters,
        "anomalyIds": cluster_result.anomaly_ids,
        "interactionClusters": {
            f"{pid}-{oid}": cid
            for (pid, oid), cid in cluster_result.interaction_clusters.items()
        },
    }

    if intent.needs_interaction:
        resp["objectiveFacts"] = objective_facts

    if isinstance(unified_plan, dict):
        if isinstance(unified_plan.get("visual_hint"), str):
            resp["visualHint"] = unified_plan.get("visual_hint")
        if isinstance(unified_plan.get("visual_verify"), list):
            resp["visualVerify"] = [x for x in unified_plan.get("visual_verify") if isinstance(x, str)]
    return resp


def assemble_response(question: str, tracks_path: Path, video_path: Path, screenshot: Optional[str] = None, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Main function to assemble response by coordinating all sub-functions."""
    ctx = context or {}

    # 1. Load tracks and metadata
    tracks, frame_range, fps, total_frames = _load_tracks_and_metadata(tracks_path, video_path, ctx)

    # 2. Base response with Qwen plan
    unified = ctx.get("qwenPlan") if isinstance(ctx.get("qwenPlan"), dict) else generate_unified_plan(question, ctx)
    resp = _assemble_response_core(question, ctx, tracks, frame_range, fps, total_frames, unified)

    return resp


@app.post("/query")
async def query(payload: Dict[str, Any] = Body(...)):
    text = payload.get("text", "")
    ctx = payload.get("context", {}) or {}
    if not isinstance(ctx, dict):
        ctx = {}
    if ctx.get("datasetType") and not ctx.get("dataset_type"):
        ctx["dataset_type"] = ctx.get("datasetType")
    if ctx.get("worldTracksPath") and not ctx.get("tracksPath"):
        ctx["tracksPath"] = ctx.get("worldTracksPath")

    tracks_path = ctx.get("worldTracksPath") or ctx.get("tracksPath") or payload.get("worldTracksPath") or payload.get("tracksPath")
    video_path = ctx.get("videoPath") or payload.get("videoPath")
    screenshot = payload.get("screenshot")

    is_fused_multi = bool(ctx.get("isFusedMultiCamera"))         or str(ctx.get("sceneMode") or "") == "fused_multi_camera"         or str(ctx.get("datasetType") or ctx.get("dataset_type") or "").lower() == "wildtrack"

    if not tracks_path:
        return {"message": "缺少轨迹路径", "highlights": []}
    if not video_path and not is_fused_multi:
        return {"message": "缺少视频路径", "highlights": []}

    resolved_tracks = resolve_path(tracks_path)
    if not resolved_tracks.exists():
        return {"message": f"轨迹文件不存在: {tracks_path}", "highlights": []}

    resolved_video = resolve_path(video_path) if video_path else None
    if not is_fused_multi and (resolved_video is None or not resolved_video.exists()):
        return {"message": f"视频文件不存在: {video_path}", "highlights": []}

    # 主流程: Qwen把问题转成JSON -> InternVideo按JSON处理视频
    unified_plan = generate_unified_plan(text, ctx)

    ctx_with_plan = dict(ctx)
    if unified_plan is not None:
        ctx_with_plan["qwenPlan"] = unified_plan

    resp = assemble_response(
        text,
        resolved_tracks,
        resolved_video,
        screenshot=screenshot,
        context=ctx_with_plan,
    )

    resp["qwenPlan"] = unified_plan or {}
    if resolved_video is not None and resolved_video.exists():
        iv_answer = run_internvideo_from_qwen_plan(text, resolved_video, unified_plan, tracks_path=resolved_tracks, context=ctx_with_plan)
        if iv_answer:
            resp["internvideoAnswer"] = iv_answer
            resp["message"] = iv_answer

    return resp

@app.post("/analyze_video")
async def analyze_video(payload: Dict[str, Any] = Body(...)):
    text = payload.get("text", "")
    tracks_path = payload.get("tracksPath")
    video_path = payload.get("videoPath")
    if not tracks_path or not video_path:
        return {"message": "缺少视频或轨迹路径", "highlights": []}
    resolved_tracks = resolve_path(tracks_path)
    resolved_video = resolve_path(video_path)
    resp = assemble_response(text, resolved_tracks, resolved_video, context=payload.get("context") or {})

    track_facts = resp.get("objectiveFacts") if isinstance(resp.get("objectiveFacts"), dict) else {"interactions": []}
    video_facts = extract_objective_facts_via_internvideo(text, resolved_video)
    merged_facts = merge_objective_facts(track_facts, video_facts)
    report = build_chinese_report_from_objective_facts(text, merged_facts)

    resp["objectiveFacts"] = merged_facts
    resp["message"] = "全视频分析完成: " + report
    return resp


@app.get("/health")
async def health():
    qwen_loaded = _qwen_model is not None and _qwen_tokenizer is not None
    return {
        "status": "ok",
        "internvideo_loaded": _model is not None and _tokenizer is not None,
        "internvideo_path": str(MODEL_DIR),
        "qwen_loaded": qwen_loaded,
        "qwen_path": QWEN_MODEL_PATH,
    }


def scan_virat_scenes() -> List[Dict[str, Any]]:
    """
    Scan VIRAT-like single-camera datasets and WildTrack.
    Returns list of scenes with scene_id, video_path, tracks_path, dataset_type.
    """
    scenes = []

    def to_web_path(p: Path) -> str:
        """Convert absolute filesystem path to web-accessible path"""
        try:
            rel = p.relative_to(REPO_ROOT)
        except ValueError:
            return str(p)

        parts = list(rel.parts)

        if len(parts) >= 2 and parts[0] == 'vis' and parts[1] == 'backend':
            return '/' + '/'.join(parts[1:])
        elif len(parts) >= 1 and parts[0] == 'backend':
            return '/' + '/'.join(parts)
        else:
            return '/backend/' + '/'.join(parts)

    for dataset_dir, dataset_type, dataset_label in [
        (VIRAT_DATASET_DIR, "virat", "VIRAT"),
        (MEVA_DATASET_DIR, "meva", "MEVA"),
    ]:
        if not dataset_dir.exists():
            logger.warning("%s dataset directory not found: %s", dataset_label, dataset_dir)
            continue

        fused_scene_manifests: List[Path] = []
        if dataset_type == "meva":
            fused_scene_manifests = sorted(dataset_dir.glob("meva_fused_*.scene.json"))

        video_files = sorted(dataset_dir.glob("*.mp4"))
        for video_path in video_files:
            scene_id = video_path.stem
            if scene_id.startswith("meva_fused_"):
                continue
            tracks_path = video_path.parent / f"{scene_id}.viratdata.objects.txt"

            duration = 0.0
            fps = DEFAULT_FPS
            frame_count = 0

            if video_path.exists():
                try:
                    if VideoReader is not None:
                        vr = VideoReader(str(video_path), ctx=cpu(0))
                        fps = safe_float(vr.get_avg_fps(), DEFAULT_FPS)
                        frame_count = len(vr)
                        duration = frame_count / fps if fps > 0 else 0.0
                except Exception as e:
                    logger.warning(f"Error reading video {video_path}: {e}")

            scene_info = {
                "scene_id": scene_id,
                "dataset_type": dataset_type,
                "scene_mode": "single_camera",
                "coordinate_space": "image",
                "video_path": to_web_path(video_path),
                "tracks_path": to_web_path(tracks_path),
                "video_exists": video_path.exists(),
                "tracks_exists": tracks_path.exists(),
                "duration": duration,
                "fps": fps,
                "frame_count": frame_count,
                "camera_sources": [],
            }
            scenes.append(scene_info)

        if dataset_type == "meva":
            for manifest_path in fused_scene_manifests:
                try:
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                except Exception as e:
                    logger.warning("Error reading MEVA fused scene manifest %s: %s", manifest_path, e)
                    continue
                if not isinstance(manifest, dict):
                    continue
                world_file = str(manifest.get("world_tracks_file") or "").strip()
                if not world_file:
                    continue
                world_tracks_path = manifest_path.parent / world_file
                track_text_file = str(manifest.get("track_text_events_file") or "").strip()
                track_text_events_path = manifest_path.parent / track_text_file if track_text_file else None
                camera_sources_raw = manifest.get("camera_sources") if isinstance(manifest.get("camera_sources"), list) else []
                camera_sources: List[Dict[str, Any]] = []
                frame_count = 0
                duration = 0.0
                fps = DEFAULT_FPS
                for item in camera_sources_raw:
                    if not isinstance(item, dict):
                        continue
                    source_scene_id = item.get("scene_id")
                    video_file = str(item.get("video_file") or "").strip()
                    tracks_file = str(item.get("tracks_file") or "").strip()
                    video_path = manifest_path.parent / video_file if video_file else None
                    tracks_path = manifest_path.parent / tracks_file if tracks_file else None
                    item_fps = safe_float(item.get("fps"), DEFAULT_FPS)
                    item_frame_count = int(item.get("frame_count") or 0)
                    item_duration = float(item.get("duration") or 0.0)
                    fps = max(fps, item_fps)
                    frame_count = max(frame_count, item_frame_count + int(item.get("frame_offset") or 0))
                    duration = max(duration, item_duration + float(item.get("frame_offset") or 0) / max(item_fps or DEFAULT_FPS, 1e-6))
                    camera_sources.append(
                        {
                            "scene_id": source_scene_id,
                            "camera_id": item.get("camera_id"),
                            "video_path": to_web_path(video_path) if video_path and video_path.exists() else None,
                            "tracks_path": to_web_path(tracks_path) if tracks_path and tracks_path.exists() else None,
                            "image_dir": item.get("image_dir"),
                            "fps": item_fps,
                            "frame_count": item_frame_count,
                            "duration": item_duration,
                            "frame_offset": int(item.get("frame_offset") or 0),
                            "world_transform_mode": item.get("world_transform_mode"),
                        }
                    )
                scenes.insert(
                    0,
                    {
                        "scene_id": str(manifest.get("scene_id") or manifest_path.stem.replace(".scene", "")),
                        "dataset_type": dataset_type,
                        "scene_mode": "fused_multi_camera",
                        "coordinate_space": str(manifest.get("coordinate_space") or "world"),
                        "world_transform_mode": manifest.get("world_transform_mode"),
                        "coordinate_note": manifest.get("coordinate_note"),
                        "video_path": None,
                        "tracks_path": to_web_path(world_tracks_path),
                        "world_tracks_path": to_web_path(world_tracks_path),
                        "track_text_events_path": to_web_path(track_text_events_path) if track_text_events_path and track_text_events_path.exists() else None,
                        "video_exists": any(bool(x.get("video_path")) for x in camera_sources),
                        "tracks_exists": world_tracks_path.exists(),
                        "duration": duration,
                        "fps": fps,
                        "frame_count": frame_count,
                        "fused": True,
                        "camera_sources": camera_sources,
                    },
                )

    wildtrack_dirs = [d for d in [WILDTRACK_DATASET_DIR, WILDTRACK_VIRAT_DATASET_DIR] if d.exists()]
    if wildtrack_dirs:
        scene_file_map: Dict[str, Path] = {}

        for wt_dir in wildtrack_dirs:
            candidates = list(wt_dir.glob("**/*.viratdata.objects.txt"))

            for p in sorted(candidates):
                scene_id = p.stem.replace(".viratdata.objects", "")
                if scene_id not in scene_file_map:
                    if p.parent.name.startswith('C') or p.parent == wt_dir:
                        scene_file_map[scene_id] = p
                        logger.info(f"Found WildTrack scene: {scene_id} at {p}")

        wildtrack_target_fps = 2.0
        wildtrack_target_frame_count = 2000
        wildtrack_target_duration = wildtrack_target_frame_count / wildtrack_target_fps
        per_camera_scenes: List[Dict[str, Any]] = []

        for scene_id in sorted(scene_file_map.keys()):
            tracks_path = scene_file_map[scene_id]
            img_dir = None

            possible_img_dirs = [
                tracks_path.parent / "img",
                tracks_path.parent.parent / tracks_path.parent.name / "img",
                WILDTRACK_DATASET_DIR / tracks_path.parent.name / "img",
                WILDTRACK_VIRAT_DATASET_DIR / tracks_path.parent.name / "img",
            ]

            for candidate in possible_img_dirs:
                if candidate.exists() and candidate.is_dir():
                    img_dir = candidate
                    logger.info(f"Found image directory for {scene_id}: {img_dir}")
                    break

            camera_id = tracks_path.parent.name if tracks_path.parent.name.startswith('C') else 'unknown'
            rebuilt_video_path = None
            if camera_id.startswith('C') and camera_id[1:].isdigit():
                rebuilt_video_path = tracks_path.parent / f"cam{camera_id[1:]}.mp4"

            video_exists = bool(rebuilt_video_path and rebuilt_video_path.exists())
            if rebuilt_video_path and not video_exists:
                logger.warning(
                    "Rebuilt WildTrack video missing for %s: %s",
                    scene_id,
                    rebuilt_video_path,
                )

            world_tracks_path = WILDTRACK_DATASET_DIR / "world_coords" / f"{camera_id.upper()}_world.csv"
            world_tracks_exists = world_tracks_path.exists() and world_tracks_path.is_file()
            scene_info = {
                "scene_id": scene_id,
                "dataset_type": "wildtrack",
                "scene_mode": "single_camera",
                "coordinate_space": "world" if world_tracks_exists else "image",
                "video_path": to_web_path(rebuilt_video_path) if video_exists and rebuilt_video_path else None,
                "image_dir": to_web_path(img_dir) if img_dir and img_dir.exists() else None,
                "tracks_path": to_web_path(tracks_path),
                "video_exists": video_exists,
                "tracks_exists": True,
                "image_dir_exists": img_dir is not None and img_dir.exists(),
                "duration": wildtrack_target_duration,
                "fps": wildtrack_target_fps,
                "frame_count": wildtrack_target_frame_count,
                "camera_id": camera_id,
                "raw_tracks_path": str(tracks_path),
                "camera_sources": [],
            }
            if world_tracks_exists:
                scene_info["world_tracks_path"] = to_web_path(world_tracks_path)
            per_camera_scenes.append(scene_info)
            scenes.append(scene_info)

        world_fused_path = WILDTRACK_DATASET_DIR / "world_coords" / "wildtrack_7cams_world.csv"
        world_fused_exists = world_fused_path.exists() and world_fused_path.is_file()
        if world_fused_exists and per_camera_scenes:
            camera_sources = []
            for scene in sorted(per_camera_scenes, key=lambda item: item.get("camera_id") or ""):
                camera_sources.append(
                    {
                        "scene_id": scene.get("scene_id"),
                        "camera_id": scene.get("camera_id"),
                        "video_path": scene.get("video_path"),
                        "tracks_path": scene.get("tracks_path"),
                        "image_dir": scene.get("image_dir"),
                        "fps": scene.get("fps"),
                        "frame_count": scene.get("frame_count"),
                        "duration": scene.get("duration"),
                    }
                )
            base_scene = camera_sources[0] if camera_sources else {}
            scenes.insert(
                0,
                {
                    "scene_id": "wildtrack_fused_7cams",
                    "dataset_type": "wildtrack",
                    "scene_mode": "fused_multi_camera",
                    "coordinate_space": "world",
                    "video_path": None,
                    "tracks_path": to_web_path(world_fused_path),
                    "world_tracks_path": to_web_path(world_fused_path),
                    "video_exists": any(bool(scene.get("video_exists")) for scene in per_camera_scenes),
                    "tracks_exists": True,
                    "duration": max(float(scene.get("duration") or 0.0) for scene in per_camera_scenes),
                    "fps": float(base_scene.get("fps") or wildtrack_target_fps),
                    "frame_count": max(int(scene.get("frame_count") or 0) for scene in per_camera_scenes),
                    "fused": True,
                    "camera_sources": camera_sources,
                },
            )
    else:
        logger.warning(
            "WildTrack dataset directory not found: checked %s and %s",
            WILDTRACK_VIRAT_DATASET_DIR,
            WILDTRACK_DATASET_DIR,
        )

    logger.info(f"Total: {len(scenes)} scenes from all datasets")
    return scenes


@app.get("/virat/scenes")
async def list_virat_scenes():
    """
    List all available VIRAT scenes.
    Returns list of scenes with basic metadata.
    """
    scenes = scan_virat_scenes()
    return {
        "scenes": scenes,
        "total": len(scenes),
        "dataset_path": str(VIRAT_DATASET_DIR),
    }


@app.get("/virat/scenes/{scene_id}")
async def get_virat_scene(scene_id: str):
    """
    Get detailed information about a specific VIRAT scene.
    """
    scenes = scan_virat_scenes()
    scene = next((s for s in scenes if s["scene_id"] == scene_id), None)
    
    if not scene:
        return {"error": f"Scene {scene_id} not found", "scene_id": scene_id}
    
    # Use resolved scene paths to avoid mismatches across dataset layouts
    tracks_path = resolve_path(scene["tracks_path"])
    video_path = resolve_path(scene["video_path"]) if scene.get("video_path") else None
    
    # Parse tracks to get object statistics
    object_stats = {
        "total_objects": 0,
        "object_types": {},
        "frame_range": None,
    }
    
    if tracks_path.exists():
        try:
            tracks, frame_range = parse_tracks(tracks_path, dataset_type=scene.get("dataset_type"))
            object_stats["total_objects"] = len(tracks)
            object_stats["frame_range"] = frame_range
            
            # Count objects by class using unified mapping
            for track in tracks:
                cls_id = track.get("cls", 0)
                cls_name = VIRAT_CLASS_LABELS.get(cls_id, f"unknown_{cls_id}")
                object_stats["object_types"][cls_name] = object_stats["object_types"].get(cls_name, 0) + 1
        except Exception as e:
            logger.warning(f"Error parsing tracks for {scene_id}: {e}")
    
    scene["object_stats"] = object_stats
    return scene


@app.post("/virat/analyze")
async def analyze_virat_scene(payload: Dict[str, Any] = Body(...)):
    """
    Analyze a VIRAT scene by scene_id.
    This is a convenience endpoint that automatically resolves video and tracks paths.
    """
    scene_id = payload.get("scene_id")
    text = payload.get("text", "")
    
    if not scene_id:
        return {"error": "scene_id is required", "message": "缺少场景ID"}
    
    # Get scene info
    scenes = scan_virat_scenes()
    scene = next((s for s in scenes if s["scene_id"] == scene_id), None)
    
    if not scene:
        return {"error": f"Scene {scene_id} not found", "message": f"场景 {scene_id} 不存在"}
    
    if scene["dataset_type"] in {"virat", "meva"} and not scene["video_exists"]:
        return {"error": f"Video file not found for scene {scene_id}", "message": f"场景 {scene_id} 的视频文件不存在"}
    
    if not scene["tracks_exists"]:
        return {"error": f"Tracks file not found for scene {scene_id}", "message": f"场景 {scene_id} 的标注文件不存在"}
    
    # Resolve paths
    tracks_path = resolve_path(scene["tracks_path"])
    video_path = resolve_path(scene["video_path"]) if scene.get("video_path") else None
    
    user_context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    context = dict(user_context)
    context["dataset_type"] = scene.get("dataset_type")
    context["sceneMode"] = scene.get("scene_mode") or user_context.get("sceneMode") or "single_camera"
    context["isFusedMultiCamera"] = bool(scene.get("scene_mode") == "fused_multi_camera")
    if scene.get("world_tracks_path") and not context.get("worldTracksPath"):
        context["worldTracksPath"] = scene.get("world_tracks_path")
    if isinstance(scene.get("camera_sources"), list) and scene.get("camera_sources") and not context.get("cameraSources"):
        context["cameraSources"] = scene.get("camera_sources")
    if scene.get("fps") and not context.get("fps"):
        context["fps"] = scene.get("fps")

    # Use existing analyze_video logic
    resp = assemble_response(
        text,
        tracks_path,
        video_path,
        context=context
    )
    full_video_mode = bool(payload.get("full_video")) or not user_context
    if full_video_mode:
        track_facts = resp.get("objectiveFacts") if isinstance(resp.get("objectiveFacts"), dict) else {"interactions": []}
        is_video_file = video_path is not None and video_path.suffix.lower() in {".mp4", ".avi", ".mov", ".mkv", ".webm"}
        video_facts = extract_objective_facts_via_internvideo(text, video_path) if is_video_file else {"interactions": []}
        merged_facts = merge_objective_facts(track_facts, video_facts)
        report = build_chinese_report_from_objective_facts(text, merged_facts)
        resp["objectiveFacts"] = merged_facts
        resp["message"] = report

    resp["scene_id"] = scene_id
    resp["message"] = f"场景 {scene_id} 分析完成: " + resp.get("message", "")
    return resp


def main():
    uvicorn.run(app, host="0.0.0.0", port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
