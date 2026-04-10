import importlib
import csv
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

VIRAT_CLASS_BACKGROUND = 0
VIRAT_CLASS_PERSON = 1
VIRAT_CLASS_CAR = 2
VIRAT_CLASS_VEHICLE = 3
VIRAT_CLASS_OBJECT = 4
VIRAT_CLASS_BIKE = 5

PERSON_CLASSES: Set[int] = {VIRAT_CLASS_PERSON}
VEHICLE_CLASSES: Set[int] = {VIRAT_CLASS_CAR, VIRAT_CLASS_VEHICLE}
BIKE_CLASSES: Set[int] = {VIRAT_CLASS_BIKE}
OBJECT_CLASSES: Set[int] = {VIRAT_CLASS_OBJECT}
BACKGROUND_CLASSES: Set[int] = {VIRAT_CLASS_BACKGROUND}

VIRAT_CLASS_LABELS = {
    VIRAT_CLASS_BACKGROUND: "背景",
    VIRAT_CLASS_PERSON: "人",
    VIRAT_CLASS_CAR: "小汽车",
    VIRAT_CLASS_VEHICLE: "其他车辆",
    VIRAT_CLASS_OBJECT: "物体",
    VIRAT_CLASS_BIKE: "自行车/摩托车",
}


def _legacy():
    return importlib.import_module("vis.backend.agent_internvideo_server")


def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except Exception:
        return default


def derive_fps(video_path: Optional[Path]) -> float:
    legacy = _legacy()
    if legacy.VideoReader is None or video_path is None:
        return legacy.DEFAULT_FPS
    try:
        vr = legacy.VideoReader(str(video_path), ctx=legacy.cpu(0), num_threads=1)
        fps = safe_float(vr.get_avg_fps(), legacy.DEFAULT_FPS)
        return fps if fps > 1 else legacy.DEFAULT_FPS
    except Exception as exc:  # pragma: no cover
        legacy.logger.warning("fallback fps: %s", exc)
        return legacy.DEFAULT_FPS


def _parse_wildtrack_world_csv(tracks_path: Path) -> Optional[Tuple[List[Dict[str, Any]], Tuple[int, int]]]:
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

    sorted_tracks = []
    for t in tracks.values():
        t["points"].sort(key=lambda p: p["frame"])
        sorted_tracks.append(t)

    return sorted_tracks, (
        int(min_frame if min_frame < math.inf else 0),
        int(max_frame if max_frame > -math.inf else 0),
    )


def parse_tracks(
    tracks_path: Path,
    dataset_type: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Tuple[int, int]]:
    tracks: Dict[int, Dict[str, Any]] = {}
    min_frame, max_frame = math.inf, -math.inf
    is_wildtrack = (dataset_type or "").lower() == "wildtrack"

    if is_wildtrack and tracks_path.suffix.lower() == ".csv":
        parsed = _parse_wildtrack_world_csv(tracks_path)
        if parsed is not None:
            return parsed

    with tracks_path.open("r", encoding="utf-8") as f:
        for raw in f:
            parts = raw.strip().split()
            if len(parts) < 8:
                continue
            try:
                if is_wildtrack:
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

    return sorted_tracks, (
        int(min_frame if min_frame < math.inf else 0),
        int(max_frame if max_frame > -math.inf else 0),
    )
