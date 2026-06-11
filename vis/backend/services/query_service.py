import importlib
import csv
import hashlib
import json
import math
import os
import re
from pathlib import Path
from collections import defaultdict
from typing import Any, DefaultDict, Dict, List, Optional, Tuple

from ..dataset.scene_loader import scan_all_scenes
from ..utils.path_utils import resolve_path
from .track_processor import VIRAT_CLASS_LABELS, derive_fps, parse_tracks


VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
DEFAULT_FUSION_MODE = os.environ.get("TRACK_EVENT_FUSION_MODE", "all_cameras+fusion").strip().lower() or "all_cameras+fusion"
GOD_VIEW_FULL_FUSION_MODE = "god_view_full_fusion"
DEFAULT_QWEN_FUSION_MODEL_PATH = str((Path(__file__).resolve().parents[1] / "model" / "Qwen2.5-7B-Instruct").resolve())
TRACK_EVENT_QWEN_FUSION_ENABLED = os.environ.get("TRACK_EVENT_QWEN_FUSION_ENABLED", "1").strip() != "0"
DEFAULT_CAMERA_LIMIT = max(1, int(os.environ.get("TRACK_EVENT_CAMERA_LIMIT", "3")))
DEFAULT_EVENT_LIMIT = max(1, int(os.environ.get("TRACK_EVENT_MAX_EVENTS", "400")))
ENABLE_VISUAL_PROMPT = os.environ.get("TRACK_EVENT_VISUAL_PROMPT", "1").strip() != "0"
TOP1_VISUAL_ONLY = os.environ.get("TRACK_EVENT_TOP1_VISUAL_ONLY", "1").strip() != "0"
DEBUG_VLM_IO = os.environ.get("TRACK_EVENT_LOG_VLM_IO", "1").strip() != "0"
VLM_LOG_MAX_CHARS = max(256, int(os.environ.get("TRACK_EVENT_LOG_VLM_MAX_CHARS", "4000")))
GOD_VIEW_QWEN_MAX_NEW_TOKENS = max(256, int(os.environ.get("TRACK_EVENT_GOD_QWEN_MAX_NEW_TOKENS", "1200")))
TRACK_EVENT_EXPORT_ENABLED = os.environ.get("TRACK_EVENT_EXPORT_ENABLED", "1").strip() != "0"
TRACK_EVENT_EXPORT_DIR = os.environ.get("TRACK_EVENT_EXPORT_DIR", "").strip()
TRACK_EVENT_EXPORT_FULL_RESPONSE = os.environ.get("TRACK_EVENT_EXPORT_FULL_RESPONSE", "0").strip() != "0"
TRACK_EVENT_SCHEMA_VERSION = 3
TRACK_FUSION_EXPORT_ENABLED = os.environ.get("TRACK_FUSION_EXPORT_ENABLED", "1").strip() != "0"
TRACK_EVENT_REUSE_ENABLED = os.environ.get("TRACK_EVENT_REUSE_ENABLED", "1").strip() != "0"
TRACK_CAMERA_DESC_REUSE_ENABLED = os.environ.get("TRACK_CAMERA_DESC_REUSE_ENABLED", "1").strip() != "0"
TRACK_CAMERA_DESC_CACHE_DIR = os.environ.get("TRACK_CAMERA_DESC_CACHE_DIR", "").strip()
TRACK_FUSION_REUSE_ENABLED = os.environ.get("TRACK_FUSION_REUSE_ENABLED", "1").strip() != "0"
TRACK_FUSION_CACHE_DIR = os.environ.get("TRACK_FUSION_CACHE_DIR", "").strip()
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _legacy():
    os.environ.setdefault("QWEN_MODEL_PATH", DEFAULT_QWEN_FUSION_MODEL_PATH)
    return importlib.import_module("vis.backend.agent_internvideo_server")


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        num = float(val)
        if math.isfinite(num):
            return num
    except Exception:
        pass
    return default


def _safe_bool(val: Any, default: bool = False) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return float(val) != 0.0
    if isinstance(val, str):
        text = val.strip().lower()
        if text in {"1", "true", "yes", "y", "on"}:
            return True
        if text in {"0", "false", "no", "n", "off"}:
            return False
    return default


def _normalize_project_path_string(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    try:
        return str(resolve_path(text).resolve())
    except Exception:
        pass
    try:
        return str(Path(text).resolve())
    except Exception:
        return text


def _paths_equivalent(a: Any, b: Any) -> bool:
    left = _normalize_project_path_string(a)
    right = _normalize_project_path_string(b)
    return bool(left and right and left == right)


def _cache_scene_digest_source(tracks_path: Path, dataset_type: str, scene_stem: str) -> str:
    return f"{_normalize_project_path_string(tracks_path)}|{str(dataset_type or '').strip().lower()}|{scene_stem}"


def _cache_query_digest_source(
    tracks_path: Path,
    dataset_type: str,
    query_text: str,
    video_path: Optional[Path],
    *,
    fusion: bool = False,
) -> str:
    normalized_tracks = _normalize_project_path_string(tracks_path)
    normalized_video = _normalize_project_path_string(video_path) if video_path is not None else ""
    suffix = "|fusion" if fusion else ""
    return f"{normalized_tracks}|{str(dataset_type or '').strip().lower()}|{str(query_text or '')}|{normalized_video}{suffix}"


def _looks_like_structured_text(text: Any) -> bool:
    content = str(text or "").strip()
    if not content:
        return False
    if content.startswith("{") or content.startswith("["):
        return True
    lowered = content.lower()
    markers = [
        "overall_summary",
        "self_action",
        "interaction_type",
        "severity_level",
        "short_description",
        "interaction_frame",
        "interaction_events",
        "camera_scores",
    ]
    hit_count = sum(1 for marker in markers if marker in lowered)
    if hit_count >= 2:
        return True
    if hit_count >= 1 and lowered.count("\"") >= 8:
        return True
    return False


INTERACTION_TYPE_ROUTINE = {
    "擦肩而过",
    "并排行走",
    "驻足交谈",
    "常规肢体接触",
    "同向跟随",
    "递送物品",
}
INTERACTION_TYPE_ALERT = {
    "异常聚集",
    "暴力冲突",
}
INTERACTION_TYPE_ALL = [
    "擦肩而过",
    "并排行走",
    "驻足交谈",
    "常规肢体接触",
    "同向跟随",
    "递送物品",
    "异常聚集",
    "暴力冲突",
]


def _extract_interaction_type(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if text.lower() in {"none", "无", "无交互"}:
        return "none"
    for label in INTERACTION_TYPE_ALL:
        if label in text:
            return label
    return ""


def _map_interaction_type_to_class(interaction_type: Any, severity_level: Any) -> str:
    text = str(interaction_type or "").strip().lower()
    if not text or text in {"none", "无", "无交互"}:
        return "none"
    for alert_key in INTERACTION_TYPE_ALERT:
        if alert_key in text:
            return "alert"
    for routine_key in INTERACTION_TYPE_ROUTINE:
        if routine_key in text:
            return "routine"
    try:
        level = float(severity_level)
        if level <= 0:
            return "none"
        if level >= 2:
            return "alert"
        return "routine"
    except Exception:
        return "none"


def _normalize_interaction_class(raw: Any) -> str:
    text = str(raw or "").strip().lower()
    if text in {"routine", "alert", "none"}:
        return text
    if not text:
        return "none"
    if any(key in text for key in ["alert", "高危", "危险", "风险", "扭打", "推搡", "追逐", "尾随", "抢夺", "跌倒"]):
        return "alert"
    if any(key in text for key in ["routine", "常规", "同行", "交谈", "擦肩", "打招呼", "递送", "路过", "并排", "跟随", "肢体接触", "异常聚集", "暴力冲突"]):
        if any(key in text for key in ["异常聚集", "暴力冲突"]):
            return "alert"
        return "routine"
    return "none"


def _normalize_interaction_events(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        frame = item.get("frame")
        if not isinstance(frame, (int, float)):
            frame = item.get("frame_idx", item.get("frame_id"))
        start_raw = item.get("start_frame", item.get("start", item.get("frame_start")))
        end_raw = item.get("end_frame", item.get("end", item.get("frame_end")))
        try:
            frame_val = int(round(float(frame))) if frame is not None else None
        except Exception:
            frame_val = None
        try:
            start_val = int(round(float(start_raw))) if start_raw is not None else None
        except Exception:
            start_val = None
        try:
            end_val = int(round(float(end_raw))) if end_raw is not None else None
        except Exception:
            end_val = None
        if start_val is not None and end_val is not None and start_val > end_val:
            start_val, end_val = end_val, start_val
        if frame_val is None and start_val is not None and end_val is not None:
            frame_val = int(round((start_val + end_val) / 2.0))
        event_type = _normalize_interaction_class(item.get("type") or item.get("label") or item.get("interaction_class"))
        detail = str(item.get("detail") or item.get("reason") or item.get("description") or "").strip()
        frame_source = str(item.get("frame_source") or "").strip()
        confidence_val = item.get("confidence")
        try:
            confidence = float(confidence_val) if confidence_val is not None else None
        except Exception:
            confidence = None
        event_item = {"frame": frame_val, "type": event_type, "detail": detail}
        if isinstance(start_val, int):
            event_item["start_frame"] = start_val
        if isinstance(end_val, int):
            event_item["end_frame"] = end_val
        if isinstance(confidence, float) and math.isfinite(confidence):
            event_item["confidence"] = max(0.0, min(1.0, confidence))
        if frame_source:
            event_item["frame_source"] = frame_source
        normalized.append(event_item)
    return normalized


def _infer_interaction_class_from_events(events: List[Dict[str, Any]]) -> str:
    if not events:
        return "none"
    if any(str(ev.get("type") or "").lower() == "alert" for ev in events):
        return "alert"
    if any(str(ev.get("type") or "").lower() == "routine" for ev in events):
        return "routine"
    return "none"


def _pick_primary_interaction_frame(events: List[Dict[str, Any]]) -> Optional[int]:
    if not events:
        return None
    for preferred in ("alert", "routine"):
        for ev in events:
            if str(ev.get("type") or "").lower() != preferred:
                continue
            frame = ev.get("frame")
            if isinstance(frame, (int, float)):
                return int(round(float(frame)))
    for ev in events:
        frame = ev.get("frame")
        if isinstance(frame, (int, float)):
            return int(round(float(frame)))
    return None


def _collect_interaction_reference_frames(raw: Any) -> List[int]:
    if not isinstance(raw, list):
        return []
    frames = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        val = item.get("frame")
        if not isinstance(val, (int, float)):
            continue
        try:
            frames.add(int(round(float(val))))
        except Exception:
            continue
    return sorted(frames)


def _normalize_interaction_frame_value(
    frame: Any,
    frame_start: int,
    frame_end: int,
    reference_frames: Optional[List[int]] = None,
) -> Tuple[Optional[int], str]:
    if not isinstance(frame, (int, float)):
        return None, "missing"
    try:
        raw_num = float(frame)
    except Exception:
        return None, "missing"
    if not math.isfinite(raw_num):
        return None, "missing"

    raw_frame = int(round(raw_num))
    lo = min(int(frame_start), int(frame_end))
    hi = max(int(frame_start), int(frame_end))
    if lo <= raw_frame <= hi:
        return raw_frame, "raw"

    div10_frame = int(round(raw_num / 10.0))
    if lo <= div10_frame <= hi:
        return div10_frame, "div10"

    mul10_frame = int(round(raw_num * 10.0))
    if lo <= mul10_frame <= hi:
        return mul10_frame, "mul10"

    refs = reference_frames or []
    if refs:
        in_range_refs = [x for x in refs if lo <= x <= hi]
        pool = in_range_refs if in_range_refs else refs
        snapped = min(pool, key=lambda x: abs(x - raw_frame))
        return int(snapped), "snapped"

    if hi >= lo:
        return int(lo + (hi - lo) // 2), "midpoint"
    return None, "dropped"


def _coerce_fused_range(raw: Any) -> Optional[Dict[str, int]]:
    if not isinstance(raw, dict):
        return None
    start_raw = raw.get("start_frame", raw.get("start", raw.get("frame_start")))
    end_raw = raw.get("end_frame", raw.get("end", raw.get("frame_end")))
    try:
        start_val = int(round(float(start_raw))) if start_raw is not None else None
    except Exception:
        start_val = None
    try:
        end_val = int(round(float(end_raw))) if end_raw is not None else None
    except Exception:
        end_val = None
    if not isinstance(start_val, int) or not isinstance(end_val, int):
        return None
    if start_val > end_val:
        start_val, end_val = end_val, start_val
    return {"start_frame": start_val, "end_frame": end_val}



def _build_fused_interaction_events(
    interaction_class: str,
    interaction_type: str,
    fused_range: Optional[Dict[str, int]],
    confidence: float,
) -> List[Dict[str, Any]]:
    if interaction_class not in {"routine", "alert"}:
        return []
    if interaction_type not in INTERACTION_TYPE_ALL:
        return []
    if confidence <= 0 or not isinstance(fused_range, dict):
        return []
    start_f = fused_range.get("start_frame")
    end_f = fused_range.get("end_frame")
    if not isinstance(start_f, int) or not isinstance(end_f, int):
        return []
    if start_f > end_f:
        start_f, end_f = end_f, start_f
    frame_mid = int(round((start_f + end_f) / 2.0))
    return [{
        "frame": frame_mid,
        "frame_source": "fused_range_mid",
        "type": interaction_class,
        "detail": interaction_type,
        "start_frame": start_f,
        "end_frame": end_f,
        "confidence": confidence,
    }]



def _derive_fusion_interaction_state(payload: Any) -> Dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    raw_payload: Dict[str, Any] = {}
    raw_value = data.get("raw")
    if isinstance(raw_value, dict):
        raw_payload = raw_value
    elif isinstance(raw_value, str):
        raw_payload = _safe_json_loads(raw_value) or {}

    fused_type_source = str(
        data.get("fused_type")
        or raw_payload.get("fused_type")
        or data.get("interaction_type")
        or raw_payload.get("interaction_type")
        or ""
    ).strip()
    fused_type = _extract_interaction_type(fused_type_source)
    if not fused_type and fused_type_source.lower() == "none":
        fused_type = "none"

    fused_range = _coerce_fused_range(data.get("fused_range"))
    if fused_range is None:
        fused_range = _coerce_fused_range(raw_payload.get("fused_range"))

    confidence = _safe_float(data.get("confidence"), -1.0)
    if confidence < 0:
        confidence = _safe_float(data.get("fused_confidence"), -1.0)
    if confidence < 0:
        confidence = _safe_float(raw_payload.get("confidence"), -1.0)
    if confidence < 0:
        confidence = _safe_float(raw_payload.get("fused_confidence"), -1.0)
    confidence = _clamp01(confidence) if confidence >= 0 else 0.0

    interaction_type_source = str(
        data.get("interaction_type")
        or raw_payload.get("interaction_type")
        or fused_type
        or ""
    ).strip()
    interaction_type = _extract_interaction_type(interaction_type_source)
    if not interaction_type and fused_type in INTERACTION_TYPE_ALL:
        interaction_type = fused_type
    if not interaction_type and fused_type == "none":
        interaction_type = "none"

    interaction_class = _normalize_interaction_class(data.get("interaction_class"))
    if interaction_class == "none" and interaction_type and interaction_type != "none":
        interaction_class = _map_interaction_type_to_class(interaction_type, 1)

    interaction_detail = str(
        data.get("interaction_detail")
        or raw_payload.get("interaction_detail")
        or ""
    ).strip()
    interaction_events_raw = data.get("interaction_events")
    if not isinstance(interaction_events_raw, list):
        interaction_events_raw = raw_payload.get("interaction_events")
    interaction_events = _normalize_interaction_events(interaction_events_raw)

    if interaction_type == "none" or fused_type == "none":
        return {
            "fused_type": "none",
            "fused_range": None,
            "confidence": 0.0,
            "interaction_type": "none",
            "interaction_class": "none",
            "interaction_detail": "",
            "interaction_events": [],
        }

    if not interaction_detail and interaction_type in INTERACTION_TYPE_ALL:
        interaction_detail = str(
            data.get("fused_description")
            or raw_payload.get("fused_description")
            or interaction_type
        ).strip()

    if not interaction_events:
        interaction_events = _build_fused_interaction_events(
            interaction_class=interaction_class,
            interaction_type=interaction_type,
            fused_range=fused_range,
            confidence=confidence,
        )

    return {
        "fused_type": fused_type,
        "fused_range": fused_range,
        "confidence": confidence,
        "interaction_type": interaction_type,
        "interaction_class": interaction_class,
        "interaction_detail": interaction_detail,
        "interaction_events": interaction_events,
    }



def _fill_fused_interaction_fields(event: Dict[str, Any]) -> None:
    if not isinstance(event, dict):
        return

    fusion_details = event.get("fusion_details") or {}
    fusion_source = fusion_details.get("raw")
    fusion_state = _derive_fusion_interaction_state(
        fusion_source if isinstance(fusion_source, dict) else {"raw": fusion_source}
    )
    fused_type = str(fusion_state.get("fused_type") or "").strip()
    if not fused_type:
        return

    event["interaction_type"] = str(fusion_state.get("interaction_type") or fused_type)
    if fused_type == "none":
        event["interaction_class"] = "none"
        event["interaction_detail"] = ""
        event["interaction_events"] = []
        event["interaction_frame"] = None
        event["interaction_frame_source"] = "fused_none"
        return

    interaction_class = str(fusion_state.get("interaction_class") or "").strip()
    interaction_detail = str(fusion_state.get("interaction_detail") or fused_type).strip()
    interaction_events = (
        fusion_state.get("interaction_events")
        if isinstance(fusion_state.get("interaction_events"), list)
        else []
    )
    if interaction_class not in {"routine", "alert"}:
        return
    if not interaction_events:
        return

    event["interaction_class"] = interaction_class
    event["interaction_detail"] = interaction_detail
    if not event.get("interaction_events"):
        event["interaction_events"] = interaction_events
        event["interaction_frame"] = _pick_primary_interaction_frame(interaction_events)
        event["interaction_frame_source"] = str(
            interaction_events[0].get("frame_source") or "fused_range_mid"
        )


def _rectify_interaction_fields(
    payload: Dict[str, Any],
    frame_start: int,
    frame_end: int,
    reference_frames: Optional[List[int]] = None,
) -> None:
    if not isinstance(payload, dict):
        return

    refs = reference_frames if isinstance(reference_frames, list) else []
    if not refs:
        refs = _collect_interaction_reference_frames(payload.get("target_box_series"))
    if not refs:
        refs = _collect_interaction_reference_frames(payload.get("target_boxes"))

    normalized_events = _normalize_interaction_events(payload.get("interaction_events"))
    fixed_events: List[Dict[str, Any]] = []
    dropped = 0
    for ev in normalized_events:
        fixed_frame, fixed_source = _normalize_interaction_frame_value(
            ev.get("frame"),
            frame_start=frame_start,
            frame_end=frame_end,
            reference_frames=refs,
        )
        start_frame = ev.get("start_frame")
        end_frame = ev.get("end_frame")
        start_fixed, _ = _normalize_interaction_frame_value(
            start_frame,
            frame_start=frame_start,
            frame_end=frame_end,
            reference_frames=refs,
        )
        end_fixed, _ = _normalize_interaction_frame_value(
            end_frame,
            frame_start=frame_start,
            frame_end=frame_end,
            reference_frames=refs,
        )
        if isinstance(start_fixed, int) and isinstance(end_fixed, int) and start_fixed > end_fixed:
            start_fixed, end_fixed = end_fixed, start_fixed
        if fixed_frame is None and isinstance(start_fixed, int) and isinstance(end_fixed, int):
            fixed_frame = int(round((start_fixed + end_fixed) / 2.0))
            fixed_source = "range_mid"
        if fixed_frame is None:
            dropped += 1
            continue
        fixed_ev = dict(ev)
        fixed_ev["frame"] = int(fixed_frame)
        fixed_ev["frame_source"] = fixed_source
        if isinstance(start_fixed, int):
            fixed_ev["start_frame"] = int(start_fixed)
        if isinstance(end_fixed, int):
            fixed_ev["end_frame"] = int(end_fixed)
        fixed_events.append(fixed_ev)

    interaction_class = _normalize_interaction_class(payload.get("interaction_class"))
    if interaction_class == "none":
        interaction_class = _infer_interaction_class_from_events(fixed_events)

    fixed_frame, fixed_source = _normalize_interaction_frame_value(
        payload.get("interaction_frame"),
        frame_start=frame_start,
        frame_end=frame_end,
        reference_frames=refs,
    )
    if fixed_frame is None:
        primary = _pick_primary_interaction_frame(fixed_events)
        if isinstance(primary, int):
            fixed_frame = primary
            fixed_source = "event_primary"

    payload["interaction_class"] = interaction_class
    payload["interaction_frame"] = int(fixed_frame) if isinstance(fixed_frame, int) else None
    payload["interaction_frame_source"] = fixed_source
    payload["interaction_detail"] = str(payload.get("interaction_detail") or "").strip()
    payload["interaction_events"] = fixed_events
    payload["interaction_events_dropped"] = int(dropped)


def _rectify_track_text_events_interactions(
    events: List[Dict[str, Any]],
    dataset_type: str = "",
) -> List[Dict[str, Any]]:
    if not isinstance(events, list):
        return []
    dataset_norm = str(dataset_type or "").strip().lower()
    is_wildtrack = dataset_norm == "wildtrack"
    out: List[Dict[str, Any]] = []
    for item in events:
        if not isinstance(item, dict):
            continue
        frame_start = item.get("frame_start")
        frame_end = item.get("frame_end")
        if not isinstance(frame_start, (int, float)) or not isinstance(frame_end, (int, float)):
            out.append(item)
            continue
        frame_start_i = int(round(float(frame_start)))
        frame_end_i = int(round(float(frame_end)))

        if is_wildtrack:
            item["t_start"] = round(frame_start_i / 2.0, 3)
            item["t_end"] = round(frame_end_i / 2.0, 3)

        mc_list = item.get("multi_camera_descriptions")
        if isinstance(mc_list, list):
            for mc in mc_list:
                if not isinstance(mc, dict):
                    continue
                mc_refs = _collect_interaction_reference_frames(mc.get("target_box_series"))
                if not mc_refs:
                    mc_refs = _collect_interaction_reference_frames(mc.get("target_boxes"))
                _rectify_interaction_fields(
                    mc,
                    frame_start=frame_start_i,
                    frame_end=frame_end_i,
                    reference_frames=mc_refs,
                )

        root_refs: List[int] = []
        if isinstance(mc_list, list) and mc_list:
            primary_mc = None
            for mc in mc_list:
                if isinstance(mc, dict) and _safe_bool(mc.get("primary_visual_camera"), default=False):
                    primary_mc = mc
                    break
            if primary_mc is None:
                primary_mc = mc_list[0] if isinstance(mc_list[0], dict) else None
            if isinstance(primary_mc, dict):
                root_refs = _collect_interaction_reference_frames(primary_mc.get("target_box_series"))
                if not root_refs:
                    root_refs = _collect_interaction_reference_frames(primary_mc.get("target_boxes"))

        _rectify_interaction_fields(
            item,
            frame_start=frame_start_i,
            frame_end=frame_end_i,
            reference_frames=root_refs,
        )
        out.append(item)
    return out


def _slug_text(text: str, default: str = "track_events") -> str:
    raw = str(text or "").strip().lower()
    cleaned = re.sub(r"[^a-z0-9_-]+", "_", raw).strip("_")
    return cleaned or default


def _resolve_track_event_export_dir(tracks_path: Path, context: Optional[Dict[str, Any]]) -> Path:
    custom_dir = ""
    if isinstance(context, dict):
        custom_dir = str(
            context.get("trackTextExportDir")
            or context.get("track_text_export_dir")
            or ""
        ).strip()
    if custom_dir:
        return resolve_path(custom_dir)
    if TRACK_EVENT_EXPORT_DIR:
        return resolve_path(TRACK_EVENT_EXPORT_DIR)
    return tracks_path.parent / "track_text_events"


def _resolve_track_camera_desc_cache_dir(tracks_path: Path, context: Optional[Dict[str, Any]]) -> Path:
    custom_dir = ""
    if isinstance(context, dict):
        custom_dir = str(
            context.get("trackCameraDescCacheDir")
            or context.get("track_camera_desc_cache_dir")
            or ""
        ).strip()
    if custom_dir:
        return resolve_path(custom_dir)
    if TRACK_CAMERA_DESC_CACHE_DIR:
        return resolve_path(TRACK_CAMERA_DESC_CACHE_DIR)
    return tracks_path.parent / "track_camera_desc_cache"


def _resolve_track_fusion_cache_dir(tracks_path: Path, context: Optional[Dict[str, Any]]) -> Path:
    custom_dir = ""
    if isinstance(context, dict):
        custom_dir = str(
            context.get("trackFusionCacheDir")
            or context.get("track_fusion_cache_dir")
            or ""
        ).strip()
    if custom_dir:
        return resolve_path(custom_dir)
    if TRACK_FUSION_CACHE_DIR:
        return resolve_path(TRACK_FUSION_CACHE_DIR)
    return tracks_path.parent / "track_fusion_cache"


def _track_camera_desc_cache_file_path(
    tracks_path: Path,
    dataset_type: str,
    track_id: int,
    camera_id: str,
    frame_start: int,
    frame_end: int,
    context: Optional[Dict[str, Any]],
) -> Path:
    base_dir = _resolve_track_camera_desc_cache_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    scene_stem = _slug_text(scene_hint or tracks_path.stem or "scene")
    cam_stem = _slug_text(camera_id or "cam")
    scene_digest_src = _cache_scene_digest_source(tracks_path, dataset_type, scene_stem)
    scene_digest = hashlib.sha1(scene_digest_src.encode("utf-8")).hexdigest()[:10]
    filename = f"{scene_stem}_{scene_digest}_tid{int(track_id)}_{cam_stem}_f{int(frame_start)}_{int(frame_end)}.json"
    return base_dir / filename


def _track_camera_desc_trajectory_cache_file_path(
    tracks_path: Path,
    dataset_type: str,
    track_id: int,
    frame_start: int,
    frame_end: int,
    context: Optional[Dict[str, Any]],
) -> Path:
    base_dir = _resolve_track_camera_desc_cache_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    scene_stem = _slug_text(scene_hint or tracks_path.stem or "scene")
    scene_digest_src = _cache_scene_digest_source(tracks_path, dataset_type, scene_stem)
    scene_digest = hashlib.sha1(scene_digest_src.encode("utf-8")).hexdigest()[:10]
    filename = f"{scene_stem}_{scene_digest}_tid{int(track_id)}_f{int(frame_start)}_{int(frame_end)}.json"
    return base_dir / filename


def _track_camera_desc_cache_glob_pattern(
    tracks_path: Path,
    dataset_type: str,
    track_id: int,
    frame_start: int,
    frame_end: int,
    context: Optional[Dict[str, Any]],
) -> Tuple[Path, str]:
    base_dir = _resolve_track_camera_desc_cache_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    scene_stem = _slug_text(scene_hint or tracks_path.stem or "scene")
    scene_digest_src = _cache_scene_digest_source(tracks_path, dataset_type, scene_stem)
    scene_digest = hashlib.sha1(scene_digest_src.encode("utf-8")).hexdigest()[:10]
    pattern = f"{scene_stem}_{scene_digest}_tid{int(track_id)}*_f{int(frame_start)}_{int(frame_end)}.json"
    return base_dir, pattern


def _track_fusion_cache_file_path(
    tracks_path: Path,
    dataset_type: str,
    track_id: int,
    frame_start: int,
    frame_end: int,
    fusion_mode: str,
    camera_signature: str,
    context: Optional[Dict[str, Any]],
) -> Path:
    base_dir = _resolve_track_fusion_cache_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    scene_stem = _slug_text(scene_hint or tracks_path.stem or "scene")
    mode_stem = _slug_text(fusion_mode or "fusion")
    cam_stem = _slug_text(camera_signature or "allcams")
    scene_digest_src = _cache_scene_digest_source(tracks_path, dataset_type, scene_stem)
    scene_digest = hashlib.sha1(scene_digest_src.encode("utf-8")).hexdigest()[:10]
    filename = f"{scene_stem}_{scene_digest}_tid{int(track_id)}_f{int(frame_start)}_{int(frame_end)}_{mode_stem}_{cam_stem}.json"
    return base_dir / filename


def _track_fusion_cache_glob_pattern(
    tracks_path: Path,
    dataset_type: str,
    track_id: int,
    frame_start: int,
    frame_end: int,
    fusion_mode: str,
    context: Optional[Dict[str, Any]],
) -> Tuple[Path, str]:
    base_dir = _resolve_track_fusion_cache_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    scene_stem = _slug_text(scene_hint or tracks_path.stem or "scene")
    mode_stem = _slug_text(fusion_mode or "fusion")
    scene_digest_src = _cache_scene_digest_source(tracks_path, dataset_type, scene_stem)
    scene_digest = hashlib.sha1(scene_digest_src.encode("utf-8")).hexdigest()[:10]
    pattern = f"{scene_stem}_{scene_digest}_tid{int(track_id)}_f{int(frame_start)}_{int(frame_end)}_{mode_stem}_*.json"
    return base_dir, pattern


def _fusion_cache_key(
    track_id: int,
    frame_start: int,
    frame_end: int,
    fusion_mode: str,
    camera_signature: str,
) -> Tuple[int, int, int, str, str]:
    return (
        int(track_id),
        int(frame_start),
        int(frame_end),
        str(fusion_mode or "all_cameras+fusion").strip().lower() or "all_cameras+fusion",
        str(camera_signature or "allcams").strip().upper() or "ALLCAMS",
    )


def _trajectory_fusion_cache_key(
    track_id: int,
    frame_start: int,
    frame_end: int,
    fusion_mode: str,
) -> Tuple[int, int, int, str]:
    return (
        int(track_id),
        int(frame_start),
        int(frame_end),
        str(fusion_mode or "all_cameras+fusion").strip().lower() or "all_cameras+fusion",
    )


def _get_priority_fusion_legacy_files(tracks_path: Optional[Path], context: Optional[Dict[str, Any]]) -> List[Path]:
    out: List[Path] = []
    if tracks_path is None:
        return out

    # Support user/context-specified priority files.
    if isinstance(context, dict):
        custom_paths = context.get("trackFusionLegacyFiles") or context.get("track_fusion_legacy_files")
        if isinstance(custom_paths, list):
            for raw in custom_paths:
                try:
                    p = resolve_path(str(raw))
                    if p.exists() and p.is_file() and p.suffix.lower() == ".json":
                        out.append(p)
                except Exception:
                    continue

    # WildTrack fused scene priority files requested by user.
    stem = str(tracks_path.stem or "").lower()
    if "wildtrack" in stem and "7cams" in stem:
        candidate_a = tracks_path.parent / "track_fusion_results" / "wildtrack_fused_7cams_f0c74a5e1d_fusion.json"
        candidate_b = _prefer_clean_track_text_events_file(
            tracks_path.parent / "track_text_events" / "wildtrack_fused_7cams_8fc7aced2f.json"
        )
        if candidate_a.exists() and candidate_a.is_file():
            out.append(candidate_a)
        if candidate_b is not None and candidate_b.exists() and candidate_b.is_file():
            out.append(candidate_b)

    dedup: List[Path] = []
    seen = set()
    for p in out:
        key = str(p.resolve())
        if key in seen:
            continue
        seen.add(key)
        dedup.append(p)
    return dedup


def _build_legacy_track_fusion_index(
    tracks_path: Optional[Path],
    dataset_type: str,
    context: Optional[Dict[str, Any]],
) -> Dict[Tuple[int, int, int, str, str], Dict[str, Any]]:
    if tracks_path is None:
        return {}

    out: Dict[Tuple[int, int, int, str, str], Dict[str, Any]] = {}
    try:
        candidates: List[Path] = []
        priority_files = _get_priority_fusion_legacy_files(tracks_path, context)
        candidates.extend(priority_files)

        fusion_dir = tracks_path.parent / "track_fusion_results"
        text_dir = tracks_path.parent / "track_text_events"
        for d in [fusion_dir, text_dir]:
            if d.exists() and d.is_dir():
                recent = sorted(
                    [p for p in d.glob("*.json") if p.is_file()],
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
                candidates.extend(recent[:200])

        # Keep order: priority files first, then latest files.
        dedup_candidates: List[Path] = []
        seen_candidates = set()
        for p in candidates:
            key = str(p.resolve())
            if key in seen_candidates:
                continue
            seen_candidates.add(key)
            dedup_candidates.append(p)

        dataset_norm = str(dataset_type or "").strip().lower()
        tracks_norm = _normalize_project_path_string(tracks_path)

        for path in dedup_candidates:
            try:
                with path.open("r", encoding="utf-8") as f:
                    payload = json.load(f)
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue

            meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
            meta_tracks = str(meta.get("tracks_path") or "").strip()
            meta_dataset = str(meta.get("dataset_type") or "").strip().lower()
            if meta_tracks and not _paths_equivalent(meta_tracks, tracks_norm):
                continue
            if dataset_norm and meta_dataset and meta_dataset != dataset_norm:
                continue

            events = payload.get("fusion_results")
            if not isinstance(events, list):
                events = payload.get("track_text_events")
            if not isinstance(events, list):
                continue

            for ev in events:
                if not isinstance(ev, dict):
                    continue
                tid = ev.get("track_id")
                f0 = ev.get("frame_start")
                f1 = ev.get("frame_end")
                if not isinstance(tid, (int, float)) or not isinstance(f0, (int, float)) or not isinstance(f1, (int, float)):
                    continue

                fusion_mode = str(ev.get("fusion_mode") or "all_cameras+fusion").strip().lower() or "all_cameras+fusion"
                mc = ev.get("multi_camera_descriptions") if isinstance(ev.get("multi_camera_descriptions"), list) else []
                cam_sig = _build_fusion_camera_signature(mc)
                key = _fusion_cache_key(int(tid), int(f0), int(f1), fusion_mode, cam_sig)
                if key in out:
                    continue

                full_summary = str(
                    ev.get("full_summary")
                    or ev.get("fusion_summary")
                    or ev.get("fused_description")
                    or ev.get("overall_summary")
                    or ev.get("summary")
                    or ""
                ).strip()
                if not full_summary:
                    continue
                short_label = str(ev.get("short_label") or "").strip()[:15]
                conflict_resolution = str(ev.get("conflict_resolution") or "无冲突").strip() or "无冲突"
                reasoning_insights = str(ev.get("reasoning_insights") or "").strip()
                confidence = _clamp01(_safe_float(ev.get("fusion_confidence", ev.get("confidence")), 0.0))
                model_path = str(meta.get("qwen_model_path") or "")
                fusion_details = ev.get("fusion_details") if isinstance(ev.get("fusion_details"), dict) else {}
                raw_payload = fusion_details.get("raw") if isinstance(fusion_details.get("raw"), dict) else None
                fusion_state = _derive_fusion_interaction_state({
                    "fused_type": ev.get("fused_type"),
                    "fused_range": ev.get("fused_range"),
                    "confidence": confidence,
                    "interaction_type": ev.get("interaction_type"),
                    "interaction_class": ev.get("interaction_class"),
                    "interaction_detail": ev.get("interaction_detail"),
                    "interaction_events": ev.get("interaction_events"),
                    "fused_description": ev.get("fused_description") or full_summary,
                    "raw": raw_payload,
                })

                out[key] = {
                    "ok": True,
                    "short_label": short_label,
                    "full_summary": full_summary,
                    "fused_type": str(fusion_state.get("fused_type") or ev.get("fused_type") or "").strip(),
                    "fused_range": fusion_state.get("fused_range") if isinstance(fusion_state.get("fused_range"), dict) else None,
                    "fused_description": str(ev.get("fused_description") or "").strip() or full_summary,
                    "camera_scores": ev.get("camera_scores") if isinstance(ev.get("camera_scores"), dict) else {},
                    "conflict_resolution": conflict_resolution,
                    "reasoning_insights": reasoning_insights,
                    "confidence": confidence,
                    "interaction_type": str(fusion_state.get("interaction_type") or "").strip(),
                    "interaction_class": str(fusion_state.get("interaction_class") or "none").strip() or "none",
                    "interaction_detail": str(fusion_state.get("interaction_detail") or "").strip(),
                    "interaction_events": fusion_state.get("interaction_events") if isinstance(fusion_state.get("interaction_events"), list) else [],
                    "raw": raw_payload,
                    "model_path": model_path,
                    "cache_hit": True,
                    "cache_path": path,
                    "legacy_source": "fusion_results" if isinstance(payload.get("fusion_results"), list) else "track_text_events",
                }

                # Track-level alias: let any camera signature reuse the same trajectory cache.
                traj_key = _trajectory_fusion_cache_key(int(tid), int(f0), int(f1), fusion_mode)
                out.setdefault(  # type: ignore[arg-type]
                    traj_key,
                    out[key],
                )
        if out:
            _legacy().logger.info(
                "fusion legacy index built: entries=%s priority_files=%s",
                len(out),
                [str(p) for p in priority_files],
            )
    except Exception as e:
        _legacy().logger.warning("failed to build legacy fusion index: %s", e)
        return {}
    return out


def _load_track_fusion_cache(
    tracks_path: Optional[Path],
    dataset_type: str,
    track_id: int,
    frame_start: int,
    frame_end: int,
    fusion_mode: str,
    camera_signature: str,
    context: Optional[Dict[str, Any]],
    legacy_index: Optional[Dict[Tuple[int, int, int, str, str], Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    if not TRACK_FUSION_REUSE_ENABLED:
        return None
    if isinstance(context, dict) and (
        "trackFusionReuseEnabled" in context or "track_fusion_reuse_enabled" in context
    ):
        if not _safe_bool(
            context.get("trackFusionReuseEnabled", context.get("track_fusion_reuse_enabled")),
            default=TRACK_FUSION_REUSE_ENABLED,
        ):
            return None

    if tracks_path is None:
        return None

    force_refresh = False
    if isinstance(context, dict) and (
        "trackFusionForceRefresh" in context or "track_fusion_force_refresh" in context
    ):
        force_refresh = _safe_bool(
            context.get("trackFusionForceRefresh", context.get("track_fusion_force_refresh")),
            default=False,
        )
    if force_refresh:
        return None

    cache_path = _track_fusion_cache_file_path(
        tracks_path=tracks_path,
        dataset_type=dataset_type,
        track_id=track_id,
        frame_start=frame_start,
        frame_end=frame_end,
        fusion_mode=fusion_mode,
        camera_signature=camera_signature,
        context=context,
    )
    if (not cache_path.exists() or not cache_path.is_file()) and camera_signature:
        # Backward compatibility for old cache key without camera signature.
        cache_path = _track_fusion_cache_file_path(
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            track_id=track_id,
            frame_start=frame_start,
            frame_end=frame_end,
            fusion_mode=fusion_mode,
            camera_signature="",
            context=context,
        )
    if not cache_path.exists() or not cache_path.is_file():
        cache_dir, cache_pattern = _track_fusion_cache_glob_pattern(
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            track_id=track_id,
            frame_start=frame_start,
            frame_end=frame_end,
            fusion_mode=fusion_mode,
            context=context,
        )
        if cache_dir.exists() and cache_dir.is_dir():
            for candidate_path in sorted(cache_dir.glob(cache_pattern), key=lambda p: p.stat().st_mtime, reverse=True):
                if candidate_path == cache_path:
                    continue
                try:
                    with candidate_path.open("r", encoding="utf-8") as f:
                        payload = json.load(f)
                    if not isinstance(payload, dict):
                        continue
                    fused_description = str(payload.get("fused_description") or "").strip()
                    full_summary = str(payload.get("full_summary") or payload.get("fusion_summary") or fused_description or "").strip()
                    if not full_summary:
                        continue
                    fused_type = str(payload.get("fused_type") or "").strip()
                    short_label = str(payload.get("short_label") or fused_type or "").strip()[:15]
                    conflict_resolution = str(payload.get("conflict_resolution") or "无冲突").strip() or "无冲突"
                    reasoning_insights = str(payload.get("reasoning_insights") or "").strip()
                    confidence = _clamp01(_safe_float(payload.get("confidence"), 0.0))
                    camera_scores = payload.get("camera_scores") if isinstance(payload.get("camera_scores"), dict) else {}
                    fusion_state = _derive_fusion_interaction_state(payload)
                    hit = {
                        "ok": True,
                        "short_label": short_label,
                        "full_summary": full_summary,
                        "fused_type": str(fusion_state.get("fused_type") or fused_type or "").strip(),
                        "fused_range": fusion_state.get("fused_range") if isinstance(fusion_state.get("fused_range"), dict) else None,
                        "fused_description": fused_description or full_summary,
                        "camera_scores": camera_scores,
                        "conflict_resolution": conflict_resolution,
                        "reasoning_insights": reasoning_insights,
                        "confidence": _clamp01(_safe_float(fusion_state.get("confidence"), confidence)),
                        "interaction_type": str(fusion_state.get("interaction_type") or "").strip(),
                        "interaction_class": str(fusion_state.get("interaction_class") or "none").strip() or "none",
                        "interaction_detail": str(fusion_state.get("interaction_detail") or "").strip(),
                        "interaction_events": fusion_state.get("interaction_events") if isinstance(fusion_state.get("interaction_events"), list) else [],
                        "raw": payload.get("raw"),
                        "model_path": str(payload.get("model_path") or ""),
                        "cache_hit": True,
                        "cache_path": candidate_path,
                    }
                    _legacy().logger.info(
                        "fusion cache hit (trajectory-glob): tid=%s frame=%s-%s mode=%s cams=%s source=%s",
                        track_id,
                        frame_start,
                        frame_end,
                        fusion_mode,
                        camera_signature,
                        str(candidate_path),
                    )
                    return hit
                except Exception:
                    continue
    if not cache_path.exists() or not cache_path.is_file():
        if isinstance(legacy_index, dict):
            lookup_key = _fusion_cache_key(track_id, frame_start, frame_end, fusion_mode, camera_signature)
            legacy_hit = legacy_index.get(lookup_key)
            if isinstance(legacy_hit, dict):
                _legacy().logger.info(
                    "fusion cache hit (legacy): tid=%s frame=%s-%s mode=%s cams=%s source=%s",
                    track_id,
                    frame_start,
                    frame_end,
                    fusion_mode,
                    camera_signature,
                    str(legacy_hit.get("cache_path") or "legacy_index"),
                )
                return legacy_hit
            # Backward compatibility for old entries without camera signature.
            legacy_hit_no_cam = legacy_index.get(_fusion_cache_key(track_id, frame_start, frame_end, fusion_mode, ""))
            if isinstance(legacy_hit_no_cam, dict):
                _legacy().logger.info(
                    "fusion cache hit (legacy/no-cam): tid=%s frame=%s-%s mode=%s cams=%s source=%s",
                    track_id,
                    frame_start,
                    frame_end,
                    fusion_mode,
                    camera_signature,
                    str(legacy_hit_no_cam.get("cache_path") or "legacy_index"),
                )
                return legacy_hit_no_cam
            # Trajectory-level compatibility: reuse any cache for the same track segment,
            # even if it was generated with a different camera signature.
            traj_key = _trajectory_fusion_cache_key(track_id, frame_start, frame_end, fusion_mode)
            legacy_hit_traj = legacy_index.get(traj_key)  # type: ignore[arg-type]
            if isinstance(legacy_hit_traj, dict):
                _legacy().logger.info(
                    "fusion cache hit (trajectory): tid=%s frame=%s-%s mode=%s cams=%s source=%s",
                    track_id,
                    frame_start,
                    frame_end,
                    fusion_mode,
                    camera_signature,
                    str(legacy_hit_traj.get("cache_path") or "legacy_index"),
                )
                return legacy_hit_traj
        _legacy().logger.info(
            "fusion cache miss: tid=%s frame=%s-%s mode=%s cams=%s",
            track_id,
            frame_start,
            frame_end,
            fusion_mode,
            camera_signature,
        )
        return None
    try:
        with cache_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict):
            return None
        fused_description = str(payload.get("fused_description") or "").strip()
        full_summary = str(payload.get("full_summary") or payload.get("fusion_summary") or fused_description or "").strip()
        if not full_summary:
            return None
        fused_type = str(payload.get("fused_type") or "").strip()
        short_label = str(payload.get("short_label") or fused_type or "").strip()[:15]
        conflict_resolution = str(payload.get("conflict_resolution") or "无冲突").strip() or "无冲突"
        reasoning_insights = str(payload.get("reasoning_insights") or "").strip()
        confidence = _clamp01(_safe_float(payload.get("confidence"), 0.0))
        camera_scores = payload.get("camera_scores") if isinstance(payload.get("camera_scores"), dict) else {}
        fusion_state = _derive_fusion_interaction_state(payload)
        hit = {
            "ok": True,
            "short_label": short_label,
            "full_summary": full_summary,
            "fused_type": str(fusion_state.get("fused_type") or fused_type or "").strip(),
            "fused_range": fusion_state.get("fused_range") if isinstance(fusion_state.get("fused_range"), dict) else None,
            "fused_description": fused_description or full_summary,
            "camera_scores": camera_scores,
            "conflict_resolution": conflict_resolution,
            "reasoning_insights": reasoning_insights,
            "confidence": _clamp01(_safe_float(fusion_state.get("confidence"), confidence)),
            "interaction_type": str(fusion_state.get("interaction_type") or "").strip(),
            "interaction_class": str(fusion_state.get("interaction_class") or "none").strip() or "none",
            "interaction_detail": str(fusion_state.get("interaction_detail") or "").strip(),
            "interaction_events": fusion_state.get("interaction_events") if isinstance(fusion_state.get("interaction_events"), list) else [],
            "raw": payload.get("raw"),
            "model_path": str(payload.get("model_path") or ""),
            "cache_hit": True,
            "cache_path": cache_path,
        }
        _legacy().logger.info(
            "fusion cache hit: tid=%s frame=%s-%s mode=%s cams=%s source=%s",
            track_id,
            frame_start,
            frame_end,
            fusion_mode,
            camera_signature,
            str(cache_path),
        )
        return hit
    except Exception as e:
        _legacy().logger.warning("failed to load track fusion cache: %s", e)
        return None


def _save_track_fusion_cache(
    tracks_path: Optional[Path],
    dataset_type: str,
    track_id: int,
    frame_start: int,
    frame_end: int,
    fusion_mode: str,
    camera_signature: str,
    fusion_result: Dict[str, Any],
    context: Optional[Dict[str, Any]],
) -> Optional[Path]:
    if tracks_path is None or not isinstance(fusion_result, dict):
        return None
    full_summary = str(fusion_result.get("full_summary") or "").strip()
    if not full_summary:
        return None

    try:
        cache_path = _track_fusion_cache_file_path(
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            track_id=track_id,
            frame_start=frame_start,
            frame_end=frame_end,
            fusion_mode=fusion_mode,
            camera_signature=camera_signature,
            context=context,
        )
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        fusion_state = _derive_fusion_interaction_state(fusion_result)
        fused_type = str(fusion_state.get("fused_type") or fusion_result.get("fused_type") or "").strip() or "none"
        fused_range = fusion_state.get("fused_range") if isinstance(fusion_state.get("fused_range"), dict) else None
        interaction_type = str(fusion_state.get("interaction_type") or fused_type or "none").strip() or "none"
        interaction_class = str(fusion_state.get("interaction_class") or "none").strip() or "none"
        interaction_detail = str(fusion_state.get("interaction_detail") or "").strip()
        interaction_events = (
            fusion_state.get("interaction_events")
            if isinstance(fusion_state.get("interaction_events"), list)
            else []
        )
        payload = {
            "short_label": str(fusion_result.get("short_label") or "").strip()[:15],
            "full_summary": full_summary,
            "fusion_summary": full_summary,
            "fused_type": fused_type,
            "fused_range": fused_range,
            "fused_confidence": _clamp01(_safe_float(fusion_result.get("confidence"), 0.0)),
            "fused_description": str(fusion_result.get("fused_description") or "").strip(),
            "camera_scores": fusion_result.get("camera_scores") if isinstance(fusion_result.get("camera_scores"), dict) else {},
            "conflict_resolution": str(fusion_result.get("conflict_resolution") or "无冲突").strip() or "无冲突",
            "reasoning_insights": str(fusion_result.get("reasoning_insights") or "").strip(),
            "confidence": _clamp01(_safe_float(fusion_result.get("confidence"), 0.0)),
            "interaction_type": interaction_type,
            "interaction_class": interaction_class,
            "interaction_detail": interaction_detail,
            "interaction_events": interaction_events,
            "model_path": str(fusion_result.get("model_path") or os.environ.get("QWEN_MODEL_PATH", DEFAULT_QWEN_FUSION_MODEL_PATH)),
            "camera_signature": str(camera_signature or ""),
            "raw": fusion_result.get("raw"),
        }
        tmp_path = cache_path.with_suffix(cache_path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp_path.replace(cache_path)
        return cache_path
    except Exception as e:
        _legacy().logger.warning("failed to save track fusion cache: %s", e)
        return None


def _build_legacy_track_camera_desc_index(
    tracks_path: Optional[Path],
    dataset_type: str,
    context: Optional[Dict[str, Any]],
) -> Dict[Tuple[int, str, int, int], Dict[str, Any]]:
    if tracks_path is None:
        return {}
    out: Dict[Tuple[int, str, int, int], Dict[str, Any]] = {}
    try:
        export_dir = _resolve_track_event_export_dir(tracks_path, context)
        if not export_dir.exists() or not export_dir.is_dir():
            return {}
        candidates = sorted(
            [p for p in export_dir.glob("*.json") if p.is_file()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for path in candidates[:200]:
            try:
                with path.open("r", encoding="utf-8") as f:
                    payload = json.load(f)
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
            meta_tracks = str(meta.get("tracks_path") or "").strip()
            meta_dataset = str(meta.get("dataset_type") or "").strip().lower()
            if meta_tracks and not _paths_equivalent(meta_tracks, tracks_path):
                continue
            if meta_dataset and str(dataset_type or "").strip().lower() and meta_dataset != str(dataset_type).strip().lower():
                continue

            events = payload.get("track_text_events")
            if not isinstance(events, list):
                continue
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                tid = ev.get("track_id")
                f0 = ev.get("frame_start")
                f1 = ev.get("frame_end")
                if not isinstance(tid, (int, float)) or not isinstance(f0, (int, float)) or not isinstance(f1, (int, float)):
                    continue
                per_camera = ev.get("multi_camera_descriptions")
                if not isinstance(per_camera, list):
                    continue
                for item in per_camera:
                    if not isinstance(item, dict):
                        continue
                    cam_id = _normalize_camera_id(item.get("camera_id"))
                    summary = str(item.get("summary") or "").strip()
                    if not cam_id or not summary:
                        continue
                    key = (int(tid), cam_id, int(f0), int(f1))
                    if key in out:
                        continue
                    interactions = item.get("interactions") if isinstance(item.get("interactions"), list) else []
                    out[key] = {
                        "summary": summary,
                        "self_action": str(item.get("self_action") or summary).strip() or summary,
                        "interactions": interactions,
                        "description_source": "internvideo_cache",
                        "cache_path": path,
                    }
    except Exception as e:
        _legacy().logger.warning("failed to build legacy track-camera cache index: %s", e)
        return {}
    return out


def _load_track_camera_desc_cache(
    tracks_path: Optional[Path],
    dataset_type: str,
    track_id: int,
    camera_id: Optional[str],
    frame_start: int,
    frame_end: int,
    context: Optional[Dict[str, Any]],
    legacy_index: Optional[Dict[Tuple[int, str, int, int], Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    if not TRACK_CAMERA_DESC_REUSE_ENABLED:
        return None
    if isinstance(context, dict) and (
        "trackCameraDescReuseEnabled" in context or "track_camera_desc_reuse_enabled" in context
    ):
        if not _safe_bool(
            context.get("trackCameraDescReuseEnabled", context.get("track_camera_desc_reuse_enabled")),
            default=TRACK_CAMERA_DESC_REUSE_ENABLED,
        ):
            return None

    cam_norm = _normalize_camera_id(camera_id)
    if tracks_path is None or not isinstance(cam_norm, str) or not cam_norm.strip():
        return None

    force_refresh = False
    if isinstance(context, dict) and (
        "trackCameraDescForceRefresh" in context or "track_camera_desc_force_refresh" in context
    ):
        force_refresh = _safe_bool(
            context.get("trackCameraDescForceRefresh", context.get("track_camera_desc_force_refresh")),
            default=False,
        )
    if force_refresh:
        return None

    cache_path = _track_camera_desc_cache_file_path(
        tracks_path=tracks_path,
        dataset_type=dataset_type,
        track_id=track_id,
        camera_id=cam_norm,
        frame_start=frame_start,
        frame_end=frame_end,
        context=context,
    )
    if cache_path.exists() and cache_path.is_file():
        try:
            with cache_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            if isinstance(payload, dict):
                summary = str(payload.get("summary") or "").strip()
                self_action = str(payload.get("self_action") or summary).strip() or summary
                if summary and not (_looks_like_structured_text(summary) or _looks_like_structured_text(self_action)):
                    self_action = str(payload.get("self_action") or summary).strip() or summary
                    interactions = payload.get("interactions") if isinstance(payload.get("interactions"), list) else []
                    interaction_events = _normalize_interaction_events(payload.get("interaction_events"))
                    interaction_class = _normalize_interaction_class(payload.get("interaction_class"))
                    if interaction_class == "none":
                        interaction_class = _infer_interaction_class_from_events(interaction_events)
                    interaction_frame = payload.get("interaction_frame")
                    if not isinstance(interaction_frame, (int, float)):
                        interaction_frame = _pick_primary_interaction_frame(interaction_events)
                    interaction_frame_source = str(payload.get("interaction_frame_source") or "").strip()
                    if not interaction_frame_source:
                        interaction_frame_source = "raw" if isinstance(interaction_frame, (int, float)) else "missing"
                    interaction_detail = str(payload.get("interaction_detail") or "").strip()
                    source = str(payload.get("description_source") or "internvideo_cache")
                    return {
                        "summary": summary,
                        "self_action": self_action,
                        "interactions": interactions,
                        "interaction_class": interaction_class,
                        "interaction_frame": int(round(float(interaction_frame))) if isinstance(interaction_frame, (int, float)) else None,
                        "interaction_frame_source": interaction_frame_source,
                        "interaction_detail": interaction_detail,
                        "interaction_events": interaction_events,
                        "description_source": source,
                        "cache_path": cache_path,
                    }
        except Exception as e:
            _legacy().logger.warning("failed to load track-camera description cache: %s", e)

    trajectory_cache_path = _track_camera_desc_trajectory_cache_file_path(
        tracks_path=tracks_path,
        dataset_type=dataset_type,
        track_id=track_id,
        frame_start=frame_start,
        frame_end=frame_end,
        context=context,
    )
    if trajectory_cache_path.exists() and trajectory_cache_path.is_file():
        try:
            with trajectory_cache_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            if isinstance(payload, dict):
                summary = str(payload.get("summary") or "").strip()
                self_action = str(payload.get("self_action") or summary).strip() or summary
                description_source = str(payload.get("description_source") or "").strip().lower()
                if (
                    summary
                    and description_source in {"internvideo", "internvideo_cache"}
                    and not (_looks_like_structured_text(summary) or _looks_like_structured_text(self_action))
                ):
                    self_action = str(payload.get("self_action") or summary).strip() or summary
                    interactions = payload.get("interactions") if isinstance(payload.get("interactions"), list) else []
                    interaction_events = _normalize_interaction_events(payload.get("interaction_events"))
                    interaction_class = _normalize_interaction_class(payload.get("interaction_class"))
                    if interaction_class == "none":
                        interaction_class = _infer_interaction_class_from_events(interaction_events)
                    interaction_frame = payload.get("interaction_frame")
                    if not isinstance(interaction_frame, (int, float)):
                        interaction_frame = _pick_primary_interaction_frame(interaction_events)
                    interaction_frame_source = str(payload.get("interaction_frame_source") or "").strip()
                    if not interaction_frame_source:
                        interaction_frame_source = "raw" if isinstance(interaction_frame, (int, float)) else "missing"
                    interaction_detail = str(payload.get("interaction_detail") or "").strip()
                    source = description_source or "internvideo_cache"
                    return {
                        "summary": summary,
                        "self_action": self_action,
                        "interactions": interactions,
                        "interaction_class": interaction_class,
                        "interaction_frame": int(round(float(interaction_frame))) if isinstance(interaction_frame, (int, float)) else None,
                        "interaction_frame_source": interaction_frame_source,
                        "interaction_detail": interaction_detail,
                        "interaction_events": interaction_events,
                        "description_source": source,
                        "cache_path": trajectory_cache_path,
                    }
        except Exception as e:
            _legacy().logger.warning("failed to load track-camera trajectory cache: %s", e)

    cache_dir, cache_pattern = _track_camera_desc_cache_glob_pattern(
        tracks_path=tracks_path,
        dataset_type=dataset_type,
        track_id=track_id,
        frame_start=frame_start,
        frame_end=frame_end,
        context=context,
    )
    if cache_dir.exists() and cache_dir.is_dir():
        for candidate_path in sorted(cache_dir.glob(cache_pattern), key=lambda p: p.stat().st_mtime, reverse=True):
            if candidate_path == cache_path or candidate_path == trajectory_cache_path:
                continue
            try:
                with candidate_path.open("r", encoding="utf-8") as f:
                    payload = json.load(f)
                if isinstance(payload, dict):
                    summary = str(payload.get("summary") or "").strip()
                    self_action = str(payload.get("self_action") or summary).strip() or summary
                    if summary and not (_looks_like_structured_text(summary) or _looks_like_structured_text(self_action)):
                        interactions = payload.get("interactions") if isinstance(payload.get("interactions"), list) else []
                        interaction_events = _normalize_interaction_events(payload.get("interaction_events"))
                        interaction_class = _normalize_interaction_class(payload.get("interaction_class"))
                        if interaction_class == "none":
                            interaction_class = _infer_interaction_class_from_events(interaction_events)
                        interaction_frame = payload.get("interaction_frame")
                        if not isinstance(interaction_frame, (int, float)):
                            interaction_frame = _pick_primary_interaction_frame(interaction_events)
                        interaction_frame_source = str(payload.get("interaction_frame_source") or "").strip()
                        if not interaction_frame_source:
                            interaction_frame_source = "raw" if isinstance(interaction_frame, (int, float)) else "missing"
                        interaction_detail = str(payload.get("interaction_detail") or "").strip()
                        source = str(payload.get("description_source") or "internvideo_cache").strip() or "internvideo_cache"
                        return {
                            "summary": summary,
                            "self_action": self_action,
                            "interactions": interactions,
                            "interaction_class": interaction_class,
                            "interaction_frame": int(round(float(interaction_frame))) if isinstance(interaction_frame, (int, float)) else None,
                            "interaction_frame_source": interaction_frame_source,
                            "interaction_detail": interaction_detail,
                            "interaction_events": interaction_events,
                            "description_source": source,
                            "cache_path": candidate_path,
                        }
            except Exception:
                continue

    if isinstance(legacy_index, dict):
        legacy_key = (int(track_id), cam_norm, int(frame_start), int(frame_end))
        legacy_hit = legacy_index.get(legacy_key)
        if isinstance(legacy_hit, dict):
            return legacy_hit
    return None


def _save_track_camera_desc_cache(
    tracks_path: Optional[Path],
    dataset_type: str,
    track_id: int,
    camera_id: Optional[str],
    frame_start: int,
    frame_end: int,
    summary: str,
    self_action: str,
    interactions: List[Dict[str, Any]],
    interaction_class: str,
    interaction_frame: Optional[int],
    interaction_frame_source: str,
    interaction_detail: str,
    interaction_events: List[Dict[str, Any]],
    description_source: str,
    context: Optional[Dict[str, Any]],
) -> Optional[Path]:
    if tracks_path is None or not isinstance(camera_id, str) or not camera_id.strip():
        return None
    text_summary = str(summary or "").strip()
    if not text_summary:
        return None
    if str(description_source or "") not in {"internvideo", "internvideo_cache"}:
        return None

    try:
        cache_path = _track_camera_desc_cache_file_path(
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            track_id=track_id,
            camera_id=camera_id,
            frame_start=frame_start,
            frame_end=frame_end,
            context=context,
        )
        trajectory_cache_path = _track_camera_desc_trajectory_cache_file_path(
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            track_id=track_id,
            frame_start=frame_start,
            frame_end=frame_end,
            context=context,
        )
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": TRACK_EVENT_SCHEMA_VERSION,
            "summary": text_summary,
            "self_action": str(self_action or text_summary),
            "interactions": interactions if isinstance(interactions, list) else [],
            "interaction_class": _normalize_interaction_class(interaction_class),
            "interaction_frame": int(interaction_frame) if isinstance(interaction_frame, (int, float)) else None,
            "interaction_frame_source": str(interaction_frame_source or "missing").strip() or "missing",
            "interaction_detail": str(interaction_detail or "").strip(),
            "interaction_events": _normalize_interaction_events(interaction_events),
            "description_source": "internvideo_cache",
        }
        tmp_path = cache_path.with_suffix(cache_path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp_path.replace(cache_path)
        try:
            traj_tmp_path = trajectory_cache_path.with_suffix(trajectory_cache_path.suffix + ".tmp")
            with traj_tmp_path.open("w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            traj_tmp_path.replace(trajectory_cache_path)
        except Exception:
            pass
        return cache_path
    except Exception as e:
        _legacy().logger.warning("failed to save track-camera description cache: %s", e)
        return None


def _legacy_home_alias_path(raw: Any) -> Optional[Path]:
    text = _normalize_project_path_string(raw)
    if not text:
        return None
    current_root = str(PROJECT_ROOT)
    legacy_root = "/home/yangyu/MiniCPM-S"
    if text.startswith(current_root):
        return Path(legacy_root + text[len(current_root):])
    return None


def _legacy_track_event_export_file_path(
    tracks_path: Path,
    dataset_type: str,
    query_text: str,
    video_path: Optional[Path],
    context: Optional[Dict[str, Any]],
) -> Optional[Path]:
    legacy_tracks = _legacy_home_alias_path(tracks_path)
    if legacy_tracks is None:
        return None
    legacy_video = _legacy_home_alias_path(video_path) if video_path is not None else None
    out_dir = _resolve_track_event_export_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    stem = _slug_text(scene_hint or tracks_path.stem or "track_events")
    query_digest_src = f"{legacy_tracks}|{str(dataset_type or '').strip().lower()}|{str(query_text or '')}|{legacy_video or ''}"
    query_digest = hashlib.sha1(query_digest_src.encode("utf-8")).hexdigest()[:10]
    return out_dir / f"{stem}_{query_digest}.json"


def _prefer_clean_track_text_events_file(path: Optional[Path]) -> Optional[Path]:
    if path is None:
        return None
    if not path.exists() or not path.is_file() or path.suffix.lower() != ".json":
        return path
    for suffix in ("_clean_v4.json", "_clean_v3.json"):
        clean_candidate = path.with_name(path.stem + suffix)
        if clean_candidate.exists() and clean_candidate.is_file():
            return clean_candidate
    return path

def _track_event_export_file_path(
    tracks_path: Path,
    dataset_type: str,
    query_text: str,
    video_path: Optional[Path],
    context: Optional[Dict[str, Any]],
) -> Path:
    out_dir = _resolve_track_event_export_dir(tracks_path, context)
    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    stem = _slug_text(scene_hint or tracks_path.stem or "track_events")
    query_digest_src = _cache_query_digest_source(tracks_path, dataset_type, query_text, video_path)
    query_digest = hashlib.sha1(query_digest_src.encode("utf-8")).hexdigest()[:10]
    file_name = f"{stem}_{query_digest}.json"
    return out_dir / file_name


def _load_track_text_events_json(
    tracks_path: Path,
    dataset_type: str,
    query_text: str,
    video_path: Optional[Path],
    context: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    reuse_enabled = TRACK_EVENT_REUSE_ENABLED
    if isinstance(context, dict) and (
        "trackTextReuseEnabled" in context or "track_text_reuse_enabled" in context
    ):
        reuse_enabled = _safe_bool(
            context.get("trackTextReuseEnabled", context.get("track_text_reuse_enabled")),
            default=TRACK_EVENT_REUSE_ENABLED,
        )
    if not reuse_enabled:
        return None

    force_refresh = False
    if isinstance(context, dict) and (
        "trackTextForceRefresh" in context or "track_text_force_refresh" in context
    ):
        force_refresh = _safe_bool(
            context.get("trackTextForceRefresh", context.get("track_text_force_refresh")),
            default=False,
        )
    if force_refresh:
        return None

    normalized_dataset_type = str(dataset_type or "").strip().lower()
    if normalized_dataset_type == "meva":
        stem = tracks_path.stem.replace('.viratdata.objects', '')
        fixed_candidates = [
            tracks_path.with_name(f"{stem}.track_text_events.json"),
        ]
        if tracks_path.suffix.lower() == ".csv":
            fixed_candidates.append(tracks_path.with_name(f"{tracks_path.stem}.track_text_events.json"))
        out_path = None
        for candidate in fixed_candidates:
            fixed_scene_path = _prefer_clean_track_text_events_file(candidate)
            if fixed_scene_path is not None and fixed_scene_path.exists() and fixed_scene_path.is_file():
                out_path = fixed_scene_path
                break
    else:
        out_path = None

    if out_path is None:
        out_path = _prefer_clean_track_text_events_file(
            _track_event_export_file_path(
                tracks_path=tracks_path,
                dataset_type=dataset_type,
                query_text=query_text,
                video_path=video_path,
                context=context,
            )
        )
    if out_path is None or not out_path.exists() or not out_path.is_file():
        legacy_out_path = _prefer_clean_track_text_events_file(
            _legacy_track_event_export_file_path(
                tracks_path=tracks_path,
                dataset_type=dataset_type,
                query_text=query_text,
                video_path=video_path,
                context=context,
            )
        )
        if legacy_out_path is None or not legacy_out_path.exists() or not legacy_out_path.is_file():
            return None
        out_path = legacy_out_path

    try:
        with out_path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict):
            return None
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        schema_version = int(meta.get("schema_version") or payload.get("schema_version") or 0)
        if schema_version < TRACK_EVENT_SCHEMA_VERSION:
            return None
        events = payload.get("track_text_events")
        if not isinstance(events, list):
            return None
        stats = payload.get("track_text_generation_stats")
        return {
            "track_text_events": events,
            "track_text_generation_stats": stats if isinstance(stats, dict) else None,
            "path": out_path,
        }
    except Exception as e:
        _legacy().logger.warning("failed to load track_text events json cache: %s", e)
        return None


def _export_track_text_events_json(
    resp: Dict[str, Any],
    tracks_path: Path,
    dataset_type: str,
    query_text: str,
    video_path: Optional[Path],
    context: Optional[Dict[str, Any]],
) -> Optional[Path]:
    if not isinstance(resp, dict):
        return None

    export_enabled = TRACK_EVENT_EXPORT_ENABLED
    if isinstance(context, dict) and (
        "trackTextExportEnabled" in context or "track_text_export_enabled" in context
    ):
        export_enabled = _safe_bool(
            context.get("trackTextExportEnabled", context.get("track_text_export_enabled")),
            default=TRACK_EVENT_EXPORT_ENABLED,
        )
    if not export_enabled:
        return None

    events = resp.get("track_text_events")
    if not isinstance(events, list):
        return None

    out_path = _track_event_export_file_path(
        tracks_path=tracks_path,
        dataset_type=dataset_type,
        query_text=query_text,
        video_path=video_path,
        context=context,
    )
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        _legacy().logger.warning("failed to prepare track_text export dir: %s", e)
        return None

    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()

    payload: Dict[str, Any] = {
        "meta": {
            "schema_version": TRACK_EVENT_SCHEMA_VERSION,
            "dataset_type": str(dataset_type or ""),
            "query_text": str(query_text or ""),
            "tracks_path": str(tracks_path),
            "video_path": str(video_path) if video_path is not None else None,
            "scene_id": scene_hint or None,
            "events_count": len(events),
        },
        "track_text_generation_stats": resp.get("track_text_generation_stats"),
        "track_text_events": events,
    }

    export_full_response = TRACK_EVENT_EXPORT_FULL_RESPONSE
    if isinstance(context, dict) and (
        "trackTextExportFullResponse" in context or "track_text_export_full_response" in context
    ):
        export_full_response = _safe_bool(
            context.get("trackTextExportFullResponse", context.get("track_text_export_full_response")),
            default=TRACK_EVENT_EXPORT_FULL_RESPONSE,
        )
    if export_full_response:
        payload["response"] = resp

    try:
        tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp_path.replace(out_path)
        return out_path
    except Exception as e:
        _legacy().logger.warning("failed to export track_text events json: %s", e)
        return None


def _export_track_fusion_results_json(
    resp: Dict[str, Any],
    tracks_path: Path,
    dataset_type: str,
    query_text: str,
    video_path: Optional[Path],
    context: Optional[Dict[str, Any]],
) -> Optional[Path]:
    if not TRACK_FUSION_EXPORT_ENABLED or not isinstance(resp, dict):
        return None
    events = resp.get("track_text_events")
    if not isinstance(events, list) or not events:
        return None

    out_dir = _resolve_track_event_export_dir(tracks_path, context).parent / "track_fusion_results"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        _legacy().logger.warning("failed to prepare fusion export dir: %s", e)
        return None

    scene_hint = ""
    if isinstance(context, dict):
        scene_hint = str(context.get("scene_id") or context.get("sceneId") or "").strip()
    stem = _slug_text(scene_hint or tracks_path.stem or "fusion")
    digest_src = _cache_query_digest_source(tracks_path, dataset_type, query_text, video_path, fusion=True)
    digest = hashlib.sha1(digest_src.encode("utf-8")).hexdigest()[:10]
    out_path = out_dir / f"{stem}_{digest}_fusion.json"

    fusion_items = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        fusion_items.append(
            {
                "track_id": ev.get("track_id"),
                "class_label": ev.get("class_label"),
                "frame_start": ev.get("frame_start"),
                "frame_end": ev.get("frame_end"),
                "fusion_mode": ev.get("fusion_mode"),
                "fusion_summary": ev.get("fusion_summary"),
                "short_label": ev.get("short_label"),
                "full_summary": ev.get("full_summary"),
                "conflict_resolution": ev.get("conflict_resolution"),
                "reasoning_insights": ev.get("reasoning_insights"),
                "fusion_confidence": ev.get("fusion_confidence"),
                "fusion_details": ev.get("fusion_details") if isinstance(ev.get("fusion_details"), dict) else {},
                "description_camera_id": ev.get("description_camera_id"),
                "multi_camera_descriptions": ev.get("multi_camera_descriptions") if isinstance(ev.get("multi_camera_descriptions"), list) else [],
            }
        )

    payload = {
        "meta": {
            "dataset_type": str(dataset_type or ""),
            "query_text": str(query_text or ""),
            "tracks_path": str(tracks_path),
            "video_path": str(video_path) if video_path is not None else None,
            "scene_id": scene_hint or None,
            "fusion_count": len(fusion_items),
            "qwen_model_path": os.environ.get("QWEN_MODEL_PATH", DEFAULT_QWEN_FUSION_MODEL_PATH),
        },
        "fusion_results": fusion_items,
    }
    try:
        tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp_path.replace(out_path)
        return out_path
    except Exception as e:
        _legacy().logger.warning("failed to export fusion results json: %s", e)
        return None


def _extract_fallback_ids_from_evidence(resp: Dict[str, Any]) -> List[int]:
    evidence = resp.get("trajectoryEvidence")
    if not isinstance(evidence, list):
        return []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        ids = item.get("ids")
        if not isinstance(ids, list):
            continue
        parsed = [int(x) for x in ids if isinstance(x, (int, float))]
        if parsed:
            return parsed
    return []


def _safe_json_loads(raw: str) -> Optional[Dict[str, Any]]:
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    candidates = [text]
    fence_start = text.find("```")
    if fence_start != -1:
        fence_end = text.rfind("```")
        if fence_end > fence_start:
            fenced = text[fence_start + 3:fence_end].strip()
            fenced = fenced.removeprefix("json").strip() if fenced.lower().startswith("json") else fenced
            candidates.insert(0, fenced)
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        candidates.append(text[first:last + 1])
    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _clip_log_text(raw: Any, max_chars: int = VLM_LOG_MAX_CHARS) -> str:
    text = str(raw or "")
    if not text:
        return ""
    flat = " ".join(text.splitlines()).strip()
    if len(flat) <= max_chars:
        return flat
    return f"{flat[:max_chars]} ...(truncated, total={len(flat)} chars)"


def _sanitize_context_for_vlm(context_snippet: str) -> str:
    text = str(context_snippet or "").strip()
    if not text:
        return "无"
    # Keep only target trajectory coarse info, hide neighbor IDs to reduce copy/hallucination.
    first_line = text.splitlines()[0].strip()
    first_line = re.sub(r"ID\s*\d+", "目标", first_line)
    first_line = first_line.replace("目标轨迹:", "目标轨迹概况:")
    return first_line or "无"


def _normalize_camera_id(raw: Any) -> Optional[str]:
    text = str(raw or "").strip().upper()
    if not text:
        return None
    if text.startswith("C") and text[1:].isdigit():
        return text
    if text.isdigit():
        return f"C{text}"
    return text


def _build_fusion_camera_signature(per_camera: List[Dict[str, Any]]) -> str:
    cams: List[str] = []
    for item in per_camera:
        if not isinstance(item, dict):
            continue
        cam = _normalize_camera_id(item.get("camera_id"))
        if cam:
            cams.append(cam)
    if not cams:
        return "allcams"
    uniq = sorted(set(cams))
    return "_".join(uniq)


def _collect_camera_videos_from_context(context: Optional[Dict[str, Any]]) -> Dict[str, Path]:
    if not isinstance(context, dict):
        return {}
    camera_sources = context.get("cameraSources")
    if not isinstance(camera_sources, list):
        return {}
    mapping: Dict[str, Path] = {}
    for item in camera_sources:
        if not isinstance(item, dict):
            continue
        cam_id = _normalize_camera_id(item.get("cameraId"))
        video_path = item.get("videoPath")
        if not cam_id or not video_path:
            continue
        try:
            resolved = resolve_path(str(video_path))
            if resolved.exists():
                mapping[cam_id] = resolved
        except Exception:
            continue
    return mapping


def _collect_camera_tracks_from_context(context: Optional[Dict[str, Any]]) -> Dict[str, Path]:
    if not isinstance(context, dict):
        return {}
    camera_sources = context.get("cameraSources")
    if not isinstance(camera_sources, list):
        return {}
    mapping: Dict[str, Path] = {}
    for item in camera_sources:
        if not isinstance(item, dict):
            continue
        cam_id = _normalize_camera_id(item.get("cameraId"))
        tracks_path = item.get("tracksPath")
        if not cam_id or not tracks_path:
            continue
        try:
            resolved = resolve_path(str(tracks_path))
            if resolved.exists():
                mapping[cam_id] = resolved
        except Exception:
            continue
    return mapping


def _collect_camera_image_dirs_from_context(context: Optional[Dict[str, Any]]) -> Dict[str, Path]:
    if not isinstance(context, dict):
        return {}
    camera_sources = context.get("cameraSources")
    if not isinstance(camera_sources, list):
        return {}
    mapping: Dict[str, Path] = {}
    for item in camera_sources:
        if not isinstance(item, dict):
            continue
        cam_id = _normalize_camera_id(item.get("cameraId"))
        image_dir = item.get("imageDir")
        if not cam_id or not image_dir:
            continue
        try:
            resolved = resolve_path(str(image_dir))
            if resolved.exists() and resolved.is_dir():
                mapping[cam_id] = resolved
        except Exception:
            continue
    return mapping


def _parse_camera_track_boxes(tracks_path: Path, dataset_hint: str = "") -> Dict[int, List[Dict[str, float]]]:
    out: DefaultDict[int, List[Dict[str, float]]] = defaultdict(list)
    if not tracks_path.exists():
        return {}

    is_wildtrack = str(dataset_hint or "").lower() == "wildtrack"

    def _parse_wild(parts: List[str]) -> Optional[Tuple[int, Dict[str, float]]]:
        if len(parts) < 8:
            return None
        try:
            obj_id = int(float(parts[0]))
            frame = int(float(parts[1]))
            x1 = float(parts[2])
            y1 = float(parts[3])
            x2 = float(parts[4])
            y2 = float(parts[5])
            if x2 < x1:
                x1, x2 = x2, x1
            if y2 < y1:
                y1, y2 = y2, y1
            w = max(1.0, x2 - x1)
            h = max(1.0, y2 - y1)
            cx = x1 + w * 0.5
            cy = y1 + h * 0.5
            return obj_id, {
                "frame": float(frame),
                "x": float(cx),
                "y": float(cy),
                "w": float(w),
                "h": float(h),
                "x1": float(x1),
                "y1": float(y1),
                "x2": float(x2),
                "y2": float(y2),
            }
        except Exception:
            return None

    def _parse_virat(parts: List[str]) -> Optional[Tuple[int, Dict[str, float]]]:
        if len(parts) < 8:
            return None
        try:
            obj_id = int(float(parts[1]))
            frame = int(float(parts[2]))
            x = float(parts[3])
            y = float(parts[4])
            w = max(1.0, float(parts[5]))
            h = max(1.0, float(parts[6]))
            x1 = x
            y1 = y
            x2 = x1 + w
            y2 = y1 + h
            cx = x1 + w * 0.5
            cy = y1 + h * 0.5
            return obj_id, {
                "frame": float(frame),
                "x": float(cx),
                "y": float(cy),
                "w": float(w),
                "h": float(h),
                "x1": float(x1),
                "y1": float(y1),
                "x2": float(x2),
                "y2": float(y2),
            }
        except Exception:
            return None

    try:
        with tracks_path.open("r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) < 8:
                    continue
                parsers = [_parse_wild, _parse_virat] if is_wildtrack else [_parse_virat, _parse_wild]
                parsed: Optional[Tuple[int, Dict[str, float]]] = None
                for parser in parsers:
                    parsed = parser(parts)
                    if parsed is not None:
                        break
                if parsed is None:
                    continue
                tid, box = parsed
                out[tid].append(box)
    except Exception as e:
        _legacy().logger.warning("failed to parse camera tracks file %s: %s", tracks_path, e)
        return {}

    sorted_out: Dict[int, List[Dict[str, float]]] = {}
    for tid, boxes in out.items():
        sorted_out[int(tid)] = sorted(boxes, key=lambda b: int(b.get("frame", 0)))
    return sorted_out


def _sample_track_boxes(
    boxes: List[Dict[str, float]],
    frame_start: int,
    frame_end: int,
    max_samples: int = 4,
) -> List[Dict[str, Any]]:
    if not boxes:
        return []
    lo = min(frame_start, frame_end)
    hi = max(frame_start, frame_end)
    in_range = [b for b in boxes if lo <= int(b.get("frame", -1)) <= hi]
    pool = in_range if in_range else boxes
    if not pool:
        return []

    anchors = [lo, (lo + hi) // 2, hi]
    picked: List[Dict[str, float]] = []
    used = set()
    for anchor in anchors:
        best = min(pool, key=lambda b: abs(int(b.get("frame", anchor)) - anchor))
        fid = int(best.get("frame", -1))
        if fid in used:
            continue
        used.add(fid)
        picked.append(best)

    if len(picked) < max_samples:
        for b in pool:
            if len(picked) >= max_samples:
                break
            fid = int(b.get("frame", -1))
            if fid in used:
                continue
            used.add(fid)
            picked.append(b)

    return [
        {
            "frame": int(b.get("frame", 0)),
            "x": round(_safe_float(b.get("x"), 0.0), 2),
            "y": round(_safe_float(b.get("y"), 0.0), 2),
            "w": round(_safe_float(b.get("w"), 1.0), 2),
            "h": round(_safe_float(b.get("h"), 1.0), 2),
            "x1": round(_safe_float(b.get("x1"), 0.0), 2),
            "y1": round(_safe_float(b.get("y1"), 0.0), 2),
            "x2": round(_safe_float(b.get("x2"), 0.0), 2),
            "y2": round(_safe_float(b.get("y2"), 0.0), 2),
        }
        for b in picked[:max_samples]
    ]


def _collect_track_boxes_for_realtime(
    boxes: List[Dict[str, float]],
    frame_start: int,
    frame_end: int,
    stride: int = 1,
    max_samples: int = 1200,
) -> List[Dict[str, Any]]:
    if not boxes:
        return []
    lo = min(frame_start, frame_end)
    hi = max(frame_start, frame_end)
    in_range = [b for b in boxes if lo <= int(b.get("frame", -1)) <= hi]
    pool = in_range if in_range else boxes
    if not pool:
        return []

    stride_safe = max(1, int(stride))
    cap = max(1, int(max_samples))
    out: List[Dict[str, Any]] = []
    for idx, b in enumerate(pool):
        if idx % stride_safe != 0:
            continue
        out.append(
            {
                "frame": int(b.get("frame", 0)),
                "x1": round(_safe_float(b.get("x1"), 0.0), 2),
                "y1": round(_safe_float(b.get("y1"), 0.0), 2),
                "x2": round(_safe_float(b.get("x2"), 0.0), 2),
                "y2": round(_safe_float(b.get("y2"), 0.0), 2),
            }
        )
        if len(out) >= cap:
            break
    return out


def _nearest_box_for_frame(
    boxes: List[Dict[str, float]],
    frame_idx: int,
    max_gap: int,
) -> Optional[Dict[str, float]]:
    if not boxes:
        return None
    best = min(boxes, key=lambda b: abs(int(b.get("frame", frame_idx)) - frame_idx))
    gap = abs(int(best.get("frame", frame_idx)) - frame_idx)
    if gap > max(1, max_gap):
        return None
    return best


def _build_highlight_video_tokens(
    video_path: Path,
    bound: Optional[Tuple[float, float]],
    boxes: List[Dict[str, float]],
    track_id: int,
    num_segments: int = 48,
    input_size: int = 448,
) -> Tuple[Optional[Any], Optional[List[int]]]:
    legacy = _legacy()
    if (
        legacy.VideoReader is None
        or legacy.cpu is None
        or legacy.Image is None
        or legacy.torch is None
        or legacy.T is None
        or not boxes
    ):
        return None, None

    try:
        from PIL import ImageDraw
    except Exception:
        return None, None

    try:
        vr = legacy.VideoReader(str(video_path), ctx=legacy.cpu(0), num_threads=1)
        max_frame = len(vr) - 1
        if max_frame <= 0:
            return None, None

        fps = float(vr.get_avg_fps()) if hasattr(vr, "get_avg_fps") else 30.0
        if bound:
            start, end = bound
            start_idx = max(0, int(start * fps))
            end_idx = min(int(end * fps), max_frame)
        else:
            start_idx, end_idx = 0, max_frame
        if end_idx <= start_idx:
            end_idx = min(max_frame, start_idx + 1)

        seg_size = max(1.0, (end_idx - start_idx) / float(max(1, num_segments)))
        frame_indices = [
            int(start_idx + (seg_size * 0.5) + round(seg_size * idx))
            for idx in range(max(1, num_segments))
        ]
        max_gap = max(2, int(seg_size * 1.5))

        transform = legacy.build_transform(input_size)
        pixel_values_list = []
        num_patches_list: List[int] = []

        for frame_index in frame_indices:
            frame_index = min(max_frame, max(0, frame_index))
            img = legacy.Image.fromarray(vr[frame_index].asnumpy()).convert("RGB")
            draw = ImageDraw.Draw(img)
            box = _nearest_box_for_frame(boxes, frame_index, max_gap=max_gap)
            if box is not None:
                x1 = int(round(_safe_float(box.get("x1"), 0.0)))
                y1 = int(round(_safe_float(box.get("y1"), 0.0)))
                x2 = int(round(_safe_float(box.get("x2"), x1 + 2.0)))
                y2 = int(round(_safe_float(box.get("y2"), y1 + 2.0)))
                w_img, h_img = img.size
                x1 = max(0, min(w_img - 1, x1))
                y1 = max(0, min(h_img - 1, y1))
                x2 = max(x1 + 1, min(w_img - 1, x2))
                y2 = max(y1 + 1, min(h_img - 1, y2))

                # Bold red box + corner mark improves target locking for VLMs.
                draw.rectangle([(x1, y1), (x2, y2)], outline=(255, 32, 32), width=6)
                draw.line([(x1, y1), (x1 + 26, y1)], fill=(255, 32, 32), width=6)
                draw.line([(x1, y1), (x1, y1 + 26)], fill=(255, 32, 32), width=6)
                draw.text((x1 + 4, max(0, y1 - 18)), f"ID{track_id}", fill=(255, 32, 32))

            tiles = legacy.dynamic_preprocess(img, image_size=input_size, use_thumbnail=True, max_num=1)
            pixel_values = [transform(tile) for tile in tiles]
            stacked = legacy.torch.stack(pixel_values)
            num_patches_list.append(stacked.shape[0])
            pixel_values_list.append(stacked)

        if not pixel_values_list:
            return None, None
        pixel_values = legacy.torch.cat(pixel_values_list)
        return pixel_values, num_patches_list
    except Exception as e:
        legacy.logger.warning("build highlighted tokens failed: %s", e)
        return None, None


def _frame_image_candidates(image_dir: Path, frame_idx: int, frame_min: int) -> List[Path]:
    frame_abs = max(0, int(frame_idx))
    rel = max(0, frame_abs - max(0, int(frame_min)))
    frame_ids = [frame_abs]
    if rel not in frame_ids:
        frame_ids.append(rel)

    exts = ("jpg", "png", "jpeg")
    pads = (8, 6, 5)
    cam_prefix = str(image_dir.parent.name or "").strip().upper()
    if not (cam_prefix.startswith("C") and cam_prefix[1:].isdigit()):
        cam_prefix = ""
    out: List[Path] = []
    seen = set()
    for fid in frame_ids:
        names = [str(fid)]
        for pad in pads:
            s = str(fid).zfill(pad)
            names.append(s)
            names.append(f"img{s}")
            if cam_prefix:
                names.append(f"{cam_prefix}_{s}")
        for name in names:
            for ext in exts:
                p = image_dir / f"{name}.{ext}"
                key = str(p)
                if key in seen:
                    continue
                seen.add(key)
                out.append(p)
    return out


def _resolve_frame_image_path(image_dir: Path, frame_idx: int, frame_min: int) -> Optional[Path]:
    for p in _frame_image_candidates(image_dir, frame_idx, frame_min=frame_min):
        if p.exists():
            return p
    return None


def _pad_frame_indices_from_same_camera(
    frame_indices: List[int],
    lo: int,
    hi: int,
    required_multiple: int,
) -> List[int]:
    out = [int(x) for x in frame_indices]
    if not out:
        out = [int(lo)]

    need = (-len(out)) % max(1, int(required_multiple))
    if need == 0:
        return out

    used = set(out)
    anchor = out[-1]
    radius = 1
    while need > 0 and (anchor - radius >= lo or anchor + radius <= hi):
        right = anchor + radius
        left = anchor - radius
        if right <= hi and right not in used:
            out.append(right)
            used.add(right)
            need -= 1
            if need == 0:
                break
        if left >= lo and left not in used:
            out.append(left)
            used.add(left)
            need -= 1
            if need == 0:
                break
        radius += 1

    while need > 0:
        out.append(out[-1])
        need -= 1
    return out


def _draw_target_box_on_image(
    img: Any,
    boxes: List[Dict[str, float]],
    frame_index: int,
    track_id: int,
    max_gap: int,
) -> Any:
    try:
        from PIL import ImageDraw
    except Exception:
        return img

    draw = ImageDraw.Draw(img)
    box = _nearest_box_for_frame(boxes, frame_index, max_gap=max_gap)
    if box is None:
        return img

    x1 = int(round(_safe_float(box.get("x1"), 0.0)))
    y1 = int(round(_safe_float(box.get("y1"), 0.0)))
    x2 = int(round(_safe_float(box.get("x2"), x1 + 2.0)))
    y2 = int(round(_safe_float(box.get("y2"), y1 + 2.0)))
    w_img, h_img = img.size
    x1 = max(0, min(w_img - 1, x1))
    y1 = max(0, min(h_img - 1, y1))
    x2 = max(x1 + 1, min(w_img - 1, x2))
    y2 = max(y1 + 1, min(h_img - 1, y2))

    draw.rectangle([(x1, y1), (x2, y2)], outline=(255, 32, 32), width=6)
    draw.line([(x1, y1), (x1 + 26, y1)], fill=(255, 32, 32), width=6)
    draw.line([(x1, y1), (x1, y1 + 26)], fill=(255, 32, 32), width=6)
    draw.text((x1 + 4, max(0, y1 - 18)), f"ID{track_id}", fill=(255, 32, 32))
    return img


def _build_highlight_frame_tokens(
    image_dir: Path,
    frame_start: int,
    frame_end: int,
    boxes: List[Dict[str, float]],
    track_id: int,
    num_segments: int = 0,
    input_size: int = 448,
) -> Tuple[Optional[Any], Optional[List[int]]]:
    legacy = _legacy()
    if (
        legacy.Image is None
        or legacy.torch is None
        or legacy.T is None
        or not boxes
        or not image_dir.exists()
        or not image_dir.is_dir()
    ):
        return None, None

    try:
        lo = min(int(frame_start), int(frame_end))
        hi = max(int(frame_start), int(frame_end))
        if hi <= lo:
            hi = lo + 1

        in_range = [b for b in boxes if lo <= int(b.get("frame", -1)) <= hi]
        frame_pool = sorted({int(b.get("frame", lo)) for b in (in_range if in_range else boxes)})
        if not frame_pool:
            frame_pool = [lo, (lo + hi) // 2, hi]

        # Prefer dense frame-sequence (near per-frame) for better target grounding.
        max_frame_tokens = max(1, int(os.environ.get("TRACK_EVENT_MAX_FRAME_TOKENS", "64")))
        target_frames = max_frame_tokens if num_segments <= 0 else min(max_frame_tokens, max(1, num_segments))
        if len(frame_pool) > target_frames:
            step = max(1.0, len(frame_pool) / float(target_frames))
            pick_idx = [int(round(i * step)) for i in range(target_frames)]
            frame_indices = [frame_pool[min(len(frame_pool) - 1, idx)] for idx in pick_idx]
        else:
            frame_indices = frame_pool

        required_multiple = 4
        frame_indices = _pad_frame_indices_from_same_camera(
            frame_indices=frame_indices,
            lo=lo,
            hi=hi,
            required_multiple=required_multiple,
        )

        transform = legacy.build_transform(input_size)
        pixel_values_list = []
        num_patches_list: List[int] = []
        max_gap = max(2, int((hi - lo) / max(1, len(frame_indices))))

        for frame_index in frame_indices:
            img_path = _resolve_frame_image_path(image_dir, frame_index, frame_min=lo)
            if img_path is None:
                continue
            try:
                img = legacy.Image.open(str(img_path)).convert("RGB")
            except Exception:
                continue

            img = _draw_target_box_on_image(
                img=img,
                boxes=boxes,
                frame_index=frame_index,
                track_id=track_id,
                max_gap=max_gap,
            )

            tiles = legacy.dynamic_preprocess(img, image_size=input_size, use_thumbnail=True, max_num=1)
            pixel_values = [transform(tile) for tile in tiles]
            stacked = legacy.torch.stack(pixel_values)
            num_patches_list.append(stacked.shape[0])
            pixel_values_list.append(stacked)

        if pixel_values_list:
            miss = (-len(pixel_values_list)) % required_multiple
            if miss > 0:
                legacy.logger.info(
                    "frame sequence not multiple of %d after loading, filling from same camera: cur=%d add=%d",
                    required_multiple,
                    len(pixel_values_list),
                    miss,
                )
                anchor = frame_indices[-1] if frame_indices else lo
                supplement = _pad_frame_indices_from_same_camera(
                    frame_indices=[anchor],
                    lo=lo,
                    hi=hi,
                    required_multiple=required_multiple,
                )[1:]
                for extra_idx in supplement:
                    if miss <= 0:
                        break
                    img_path = _resolve_frame_image_path(image_dir, extra_idx, frame_min=lo)
                    if img_path is None:
                        continue
                    try:
                        img = legacy.Image.open(str(img_path)).convert("RGB")
                    except Exception:
                        continue
                    img = _draw_target_box_on_image(
                        img=img,
                        boxes=boxes,
                        frame_index=extra_idx,
                        track_id=track_id,
                        max_gap=max_gap,
                    )
                    tiles = legacy.dynamic_preprocess(img, image_size=input_size, use_thumbnail=True, max_num=1)
                    pixel_values = [transform(tile) for tile in tiles]
                    stacked = legacy.torch.stack(pixel_values)
                    num_patches_list.append(stacked.shape[0])
                    pixel_values_list.append(stacked)
                    miss -= 1

                while miss > 0 and pixel_values_list:
                    last = pixel_values_list[-1]
                    pixel_values_list.append(last.clone())
                    num_patches_list.append(int(last.shape[0]))
                    miss -= 1

        if not pixel_values_list:
            return None, None
        pixel_values = legacy.torch.cat(pixel_values_list)
        return pixel_values, num_patches_list
    except Exception as e:
        legacy.logger.warning("build highlighted frame-sequence tokens failed: %s", e)
        return None, None


def _normalize_visual_token_inputs(
    pixel_values: Any,
    num_patches_list: List[int],
    required_multiple: int = 4,
) -> Tuple[Optional[Any], Optional[List[int]], str]:
    legacy = _legacy()
    if pixel_values is None or not isinstance(num_patches_list, list) or not num_patches_list:
        return None, None, "frame_sequence_empty"

    try:
        patch_list = [int(x) for x in num_patches_list if int(x) > 0]
    except Exception:
        return None, None, "invalid_num_patches_list"

    if not patch_list:
        return None, None, "invalid_num_patches_list"

    total_expected = sum(patch_list)
    total_actual = int(getattr(pixel_values, "shape", [0])[0])
    if total_actual <= 0 or total_expected <= 0:
        return None, None, "frame_sequence_empty"

    if total_actual < total_expected:
        return None, None, "pixel_patch_mismatch"
    if total_actual > total_expected:
        pixel_values = pixel_values[:total_expected]

    frame_count = len(patch_list)
    miss = (-frame_count) % max(1, int(required_multiple))
    if miss > 0:
        last_patch = int(patch_list[-1])
        if last_patch <= 0:
            return None, None, "invalid_last_patch"

        start = int(sum(patch_list[:-1]))
        end = start + last_patch
        last_chunk = pixel_values[start:end]
        if int(getattr(last_chunk, "shape", [0])[0]) != last_patch:
            return None, None, "last_chunk_mismatch"

        for _ in range(miss):
            pixel_values = legacy.torch.cat([pixel_values, last_chunk.clone()], dim=0)
            patch_list.append(last_patch)

        legacy.logger.info(
            "padded visual frames for local_num_frames alignment: %d -> %d",
            frame_count,
            len(patch_list),
        )

    if int(getattr(pixel_values, "shape", [0])[0]) != int(sum(patch_list)):
        return None, None, "pixel_patch_mismatch_after_pad"

    return pixel_values, patch_list, "ok"


def _build_track_camera_stats_from_world_csv(
    tracks_path: Path,
) -> Dict[int, Dict[str, Dict[str, float]]]:
    stats: DefaultDict[int, DefaultDict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {"count": 0.0, "min_frame": float("inf"), "max_frame": float("-inf")})
    )
    if tracks_path.suffix.lower() != ".csv" or not tracks_path.exists():
        return {}

    try:
        with tracks_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return {}
            idx = {str(name).strip().lower().lstrip("\ufeff"): i for i, name in enumerate(header)}
            if "obj_id" not in idx or "frame" not in idx or "camera_id" not in idx:
                return {}
            idx_obj = idx["obj_id"]
            idx_frame = idx["frame"]
            idx_cam = idx["camera_id"]
            idx_valid = idx.get("valid")

            for row in reader:
                if not row:
                    continue
                try:
                    if idx_valid is not None and idx_valid < len(row):
                        valid_raw = str(row[idx_valid]).strip().lower()
                        if valid_raw and valid_raw not in {"1", "1.0", "true", "yes", "y"}:
                            continue
                    tid = int(float(str(row[idx_obj]).strip()))
                    frame = int(float(str(row[idx_frame]).strip()))
                    cam_id = _normalize_camera_id(row[idx_cam])
                    if not cam_id:
                        continue
                except Exception:
                    continue

                slot = stats[tid][cam_id]
                slot["count"] += 1.0
                slot["min_frame"] = min(slot["min_frame"], float(frame))
                slot["max_frame"] = max(slot["max_frame"], float(frame))
    except Exception as e:
        _legacy().logger.warning("failed to parse world csv camera stats: %s", e)
        return {}

    return {int(tid): dict(cam_stats) for tid, cam_stats in stats.items()}


def _pick_videos_for_track(
    track_id: int,
    frame_start: int,
    frame_end: int,
    default_video_path: Optional[Path],
    camera_video_map: Dict[str, Path],
    track_camera_stats: Dict[int, Dict[str, Dict[str, float]]],
    camera_limit: int,
) -> List[Tuple[Optional[Path], Optional[str]]]:
    if default_video_path is not None and default_video_path.exists():
        return [(default_video_path, None)]
    if not camera_video_map:
        return []

    camera_stats = track_camera_stats.get(int(track_id), {})
    if camera_stats:
        ranked: List[Tuple[Tuple[float, float], str]] = []
        lo = min(frame_start, frame_end)
        hi = max(frame_start, frame_end)
        for cam_id, stat in camera_stats.items():
            if cam_id not in camera_video_map:
                continue
            c_lo = int(stat.get("min_frame", lo))
            c_hi = int(stat.get("max_frame", hi))
            overlap = max(0, min(hi, c_hi) - max(lo, c_lo) + 1)
            count = float(stat.get("count", 0.0))
            ranked.append(((float(overlap), count), cam_id))
        if ranked:
            ranked.sort(key=lambda x: x[0], reverse=True)
            out: List[Tuple[Optional[Path], Optional[str]]] = []
            for _, cam_id in ranked[: max(1, camera_limit)]:
                out.append((camera_video_map.get(cam_id), cam_id))
            return out

    # Fallback: choose available cameras deterministically.
    out = []
    for cam_id in sorted(camera_video_map.keys())[: max(1, camera_limit)]:
        out.append((camera_video_map.get(cam_id), cam_id))
    return out


def _build_track_context_snippet(
    target_track: Dict[str, Any],
    all_tracks: List[Dict[str, Any]],
    frame_start: int,
    frame_end: int,
    max_neighbors: int = 5,
) -> str:
    """Build nearby-track context so the model can keep the target subject while preserving interactions."""
    if not isinstance(target_track, dict) or not isinstance(all_tracks, list):
        return ""

    target_points = target_track.get("points") if isinstance(target_track.get("points"), list) else []
    if not target_points:
        return ""

    target_sorted = sorted(target_points, key=lambda p: p.get("frame", 0))
    target_first = target_sorted[0]
    target_last = target_sorted[-1]
    target_cls = VIRAT_CLASS_LABELS.get(int(target_track.get("cls", 0)), "目标")

    def _interp_point(points: List[Dict[str, Any]], frame: int) -> Optional[Tuple[float, float]]:
        if not points:
            return None
        sorted_pts = sorted(points, key=lambda p: p.get("frame", 0))
        if frame <= int(sorted_pts[0].get("frame", frame)):
            return float(sorted_pts[0].get("x", 0.0)), float(sorted_pts[0].get("y", 0.0))
        if frame >= int(sorted_pts[-1].get("frame", frame)):
            return float(sorted_pts[-1].get("x", 0.0)), float(sorted_pts[-1].get("y", 0.0))
        for i in range(1, len(sorted_pts)):
            p0 = sorted_pts[i - 1]
            p1 = sorted_pts[i]
            f0 = int(p0.get("frame", frame))
            f1 = int(p1.get("frame", frame))
            if f0 <= frame <= f1 and f1 > f0:
                t = (frame - f0) / max(1e-6, f1 - f0)
                x0 = float(p0.get("x", 0.0))
                y0 = float(p0.get("y", 0.0))
                x1 = float(p1.get("x", 0.0))
                y1 = float(p1.get("y", 0.0))
                return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        return None

    candidates: List[Tuple[float, Dict[str, Any], float, float]] = []
    for track in all_tracks:
        if not isinstance(track, dict):
            continue
        other_id = int(track.get("id", -1))
        if other_id == int(target_track.get("id", -2)):
            continue
        other_points = track.get("points") if isinstance(track.get("points"), list) else []
        if not other_points:
            continue
        other_frames = [int(p.get("frame")) for p in other_points if isinstance(p, dict) and isinstance(p.get("frame"), (int, float))]
        if not other_frames:
            continue
        o_start = min(other_frames)
        o_end = max(other_frames)
        overlap_start = max(min(frame_start, frame_end), o_start)
        overlap_end = min(max(frame_start, frame_end), o_end)
        if overlap_end <= overlap_start:
            continue

        sample_frames = [overlap_start, (overlap_start + overlap_end) // 2, overlap_end]
        min_dist = float("inf")
        for fr in sample_frames:
            tp = _interp_point(target_sorted, fr)
            op = _interp_point(other_points, fr)
            if tp is None or op is None:
                continue
            dist = math.hypot(tp[0] - op[0], tp[1] - op[1])
            min_dist = min(min_dist, dist)
        if not math.isfinite(min_dist):
            continue
        overlap_ratio = (overlap_end - overlap_start) / max(1.0, (frame_end - frame_start + 1))
        score = (1.0 / max(1.0, min_dist)) + overlap_ratio
        candidates.append((score, track, min_dist, overlap_ratio))

    candidates.sort(key=lambda x: x[0], reverse=True)
    top = candidates[:max_neighbors]
    if not top:
        return (
            f"目标轨迹: ID{target_track.get('id')} / {target_cls} / 帧 {frame_start}-{frame_end} / "
            f"起点({float(target_first.get('x', 0.0)):.1f},{float(target_first.get('y', 0.0)):.1f}) -> "
            f"终点({float(target_last.get('x', 0.0)):.1f},{float(target_last.get('y', 0.0)):.1f})。"
        )

    neighbor_lines = []
    for _, track, min_dist, overlap_ratio in top:
        cls_label = VIRAT_CLASS_LABELS.get(int(track.get("cls", 0)), "目标")
        neighbor_lines.append(
            f"ID{track.get('id')}({cls_label}) 距离约{min_dist:.1f}px，时间重叠{overlap_ratio * 100:.0f}%"
        )

    return (
        f"目标轨迹: ID{target_track.get('id')} / {target_cls} / 帧 {frame_start}-{frame_end} / "
        f"起点({float(target_first.get('x', 0.0)):.1f},{float(target_first.get('y', 0.0)):.1f}) -> "
        f"终点({float(target_last.get('x', 0.0)):.1f},{float(target_last.get('y', 0.0)):.1f})。"
        f"\n附近轨迹（只可作为上下文，不可作为主体）: {'；'.join(neighbor_lines)}"
    )


def _fuse_track_camera_descriptions(per_camera: List[Dict[str, Any]], fallback_summary: str) -> str:
    if not per_camera:
        return fallback_summary
    # Prioritize model-generated summaries and then high-confidence camera evidence.
    ordered = sorted(
        per_camera,
        key=lambda x: (
            0 if str(x.get("description_source")) == "internvideo" else 1,
            -_safe_float(x.get("confidence"), 0.0),
            str(x.get("camera_id") or ""),
        ),
    )
    seen = set()
    snippets = []
    for item in ordered:
        cam_id = str(item.get("camera_id") or "")
        summary = str(item.get("summary") or "").strip()
        if not summary:
            continue
        key = summary
        if key in seen:
            continue
        seen.add(key)
        if cam_id:
            snippets.append(f"[{cam_id}] {summary}")
        else:
            snippets.append(summary)
    if not snippets:
        return fallback_summary
    return "；".join(snippets)


def _build_qwen_track_fusion_prompt(
    track_id: int,
    cls_label: str,
    per_camera: List[Dict[str, Any]],
    query_text: str,
) -> str:
    rows: List[str] = []
    for item in per_camera:
        if not isinstance(item, dict):
            continue
        payload = {
            "camera_id": str(item.get("camera_id") or "-"),
            "summary": str(item.get("summary") or ""),
            "self_action": str(item.get("self_action") or ""),
            "interactions": item.get("interactions") if isinstance(item.get("interactions"), list) else [],
            "interaction_class": str(item.get("interaction_class") or ""),
            "interaction_detail": str(item.get("interaction_detail") or ""),
            "interaction_type": str(item.get("interaction_type") or ""),
            "interaction_events": item.get("interaction_events") if isinstance(item.get("interaction_events"), list) else [],
            "description_source": str(item.get("description_source") or ""),
            "confidence": round(_safe_float(item.get("confidence"), 0.0), 4),
            "detection_confidence": round(_safe_float(item.get("detection_confidence"), 0.0), 4),
            "camera_score": round(_safe_float(item.get("camera_score"), 0.0), 4),
        }
        rows.append(json.dumps(payload, ensure_ascii=False))

    user_context = str(query_text or "").strip() or "无"
    camera_blob = "\n".join(f"- {x}" for x in rows) if rows else "- 无"
    return (
        f"请融合同一目标在多摄像头下的描述。目标ID={track_id}，类别={cls_label}。"
        f"\n用户问题上下文：{user_context}"
        "\n输入(每行一个相机观测)："
        f"\n{camera_blob}"
        "\n要求："
        "\n1) 保留多视角一致事实，消除明显冲突和幻觉。"
        "\n2) 输出融合后的交互类别 fused_type，必须从以下枚举中选择："
        "\n   [擦肩而过, 同向跟随, 驻足交谈, 并排行走, 递送物品, 常规肢体接触, 暴力冲突, 异常聚集, none]。"
        "\n   定义提示:"
        "\n   - 擦肩而过: 靠近后各自离开，无停顿。"
        "\n   - 同向跟随: 一前一后保持距离同向移动。"
        "\n   - 驻足交谈: 停下脚步，面对面或侧身持续交流。"
        "\n   - 并排行走: 步伐一致结伴同行。"
        "\n   - 递送物品: 目标之间发生明确物体传递或交换动作。"
        "\n   - 常规肢体接触: 和平的身体接触，如拥抱、握手、拍肩膀。"
        "\n   - 暴力冲突: 具有攻击性的肢体接触，如推搡、殴打、剧烈拉扯。"
        "\n   - 异常聚集: 多人短时间内异常扎堆聚拢。"
        "\n   - none: 多视角下未发现明确交互，只能确认目标自身活动。"
        "\n3) 如果 fused_type 是正交互类型，必须输出 fused_range（交互时间段），与多视角事件一致。"
        "\n4) 如果 fused_type 是正交互类型，必须输出 fused_confidence（0~1），且 fused_confidence > 0。"
        "\n5) 如果 fused_type 是 none，则输出 fused_range = null，fused_confidence = 0。"
        "\n6) 输出融合描述 fused_description（一句话）；若 fused_type 是 none，明确写未发现明确交互。"
        "\n7) 输出 camera_scores：为每个 camera_id 赋 0~1 分数，表示该相机视角的可靠度。"
        "\n仅输出 JSON："
        "\n{"
        "\n  \"fused_type\": \"枚举之一\","
        "\n  \"fused_range\": {\"start_frame\": 0, \"end_frame\": 0} 或 null,"
        "\n  \"fused_confidence\": 0.0,"
        "\n  \"fused_description\": \"融合后的完整描述\","
        "\n  \"camera_scores\": {\"C1\": 0.0, \"C2\": 0.0}"
        "\n}"
    )


def _fuse_track_camera_descriptions_qwen(
    track_id: int,
    cls_label: str,
    per_camera: List[Dict[str, Any]],
    fallback_summary: str,
    query_text: str,
) -> Dict[str, Any]:
    allowed_types = {
        "擦肩而过",
        "同向跟随",
        "驻足交谈",
        "并排行走",
        "递送物品",
        "常规肢体接触",
        "暴力冲突",
        "异常聚集",
        "none",
    }
    positive_types = allowed_types - {"none"}
    result: Dict[str, Any] = {
        "ok": False,
        "short_label": "",
        "full_summary": fallback_summary,
        "fused_type": "",
        "fused_range": None,
        "fused_description": fallback_summary,
        "camera_scores": {},
        "conflict_resolution": "无冲突",
        "reasoning_insights": "",
        "confidence": 0.0,
        "raw": None,
        "model_path": os.environ.get("QWEN_MODEL_PATH", DEFAULT_QWEN_FUSION_MODEL_PATH),
    }
    if not per_camera:
        return result

    prompt = _build_qwen_track_fusion_prompt(
        track_id=track_id,
        cls_label=cls_label,
        per_camera=per_camera,
        query_text=query_text,
    )
    try:
        raw = _legacy().qwen_chat(
            prompt,
            system="你是多视角轨迹描述融合器。严格输出JSON对象。",
            max_new_tokens=GOD_VIEW_QWEN_MAX_NEW_TOKENS,
        )
        result["raw"] = raw
        parsed = _safe_json_loads(raw or "")
        if isinstance(parsed, dict):
            fused_type_raw = str(parsed.get("fused_type") or parsed.get("short_label") or "").strip()
            fused_type = _extract_interaction_type(fused_type_raw)
            if not fused_type and fused_type_raw.lower() == "none":
                fused_type = "none"
            fused_range = _coerce_fused_range(parsed.get("fused_range"))
            if fused_range is None:
                fused_range = _coerce_fused_range({
                    "start_frame": parsed.get("start_frame"),
                    "end_frame": parsed.get("end_frame"),
                })

            fused_description = str(
                parsed.get("fused_description")
                or parsed.get("full_summary")
                or parsed.get("fusion_summary")
                or ""
            ).strip()
            camera_scores_raw = parsed.get("camera_scores")
            camera_scores: Dict[str, float] = {}
            if isinstance(camera_scores_raw, dict):
                for key, val in camera_scores_raw.items():
                    cam_id = str(key or "").strip()
                    if not cam_id:
                        continue
                    camera_scores[cam_id] = _clamp01(_safe_float(val, 0.0))

            if fused_type:
                result["fused_type"] = fused_type
            if fused_description:
                result["fused_description"] = fused_description
                result["full_summary"] = fused_description
            if fused_range is not None:
                result["fused_range"] = fused_range
            if camera_scores:
                result["camera_scores"] = camera_scores

            if fused_type:
                result["short_label"] = fused_type[:15]
            else:
                result["short_label"] = str(parsed.get("short_label") or "").strip()[:15]
            result["conflict_resolution"] = str(parsed.get("conflict_resolution") or "无冲突").strip() or "无冲突"
            result["reasoning_insights"] = str(parsed.get("reasoning_insights") or "").strip()
            conf = _safe_float(parsed.get("fused_confidence"), -1.0)
            if conf < 0:
                conf = _safe_float(parsed.get("confidence"), -1.0)
            if conf >= 0:
                result["confidence"] = _clamp01(conf)
            elif camera_scores:
                result["confidence"] = _clamp01(sum(camera_scores.values()) / max(1, len(camera_scores)))

            if fused_type not in allowed_types:
                result["ok"] = False
            elif fused_type == "none":
                result["fused_type"] = "none"
                result["fused_range"] = None
                result["confidence"] = 0.0
                if not result["fused_description"]:
                    result["fused_description"] = "未发现明确交互。"
                if not result["full_summary"]:
                    result["full_summary"] = result["fused_description"]
                result["ok"] = bool(result["full_summary"])
            else:
                has_valid_range = isinstance(result.get("fused_range"), dict)
                has_valid_conf = _safe_float(result.get("confidence"), 0.0) > 0.0
                if has_valid_range and has_valid_conf:
                    result["ok"] = bool(result.get("full_summary"))
                else:
                    result["fused_type"] = "none"
                    result["fused_range"] = None
                    result["confidence"] = 0.0
                    if not result["fused_description"]:
                        result["fused_description"] = "未发现明确交互。"
                    if not result["full_summary"]:
                        result["full_summary"] = result["fused_description"]
                    result["ok"] = bool(result["full_summary"])
    except Exception as e:
        _legacy().logger.warning("qwen fusion failed for track %s: %s", track_id, e)

    if not result["short_label"]:
        fallback = re.sub(r"\s+", "", str(result["full_summary"] or ""))[:15] or "融合结果"
        result["short_label"] = fallback
    if not result["fused_type"]:
        result["fused_type"] = "none"
    if not result["fused_description"]:
        result["fused_description"] = result["full_summary"]
    return result


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _camera_view_quality(item: Dict[str, Any]) -> float:
    conf = _safe_float(item.get("confidence"), -1.0)
    if conf >= 0:
        return _clamp01(conf)
    score = _safe_float(item.get("camera_score"), 0.0)
    if score > 0:
        return _clamp01(score)
    boxes = item.get("target_boxes") if isinstance(item.get("target_boxes"), list) else []
    series = item.get("target_box_series") if isinstance(item.get("target_box_series"), list) else []
    if series:
        return _clamp01(0.4 + min(0.6, len(series) / 100.0))
    if boxes:
        return _clamp01(0.3 + min(0.5, len(boxes) / 10.0))
    return 0.2


def _build_god_view_full_fusion_prompt(
    track_id: int,
    cls_label: str,
    per_camera: List[Dict[str, Any]],
    query_text: str,
) -> str:
    lines: List[str] = []
    for item in per_camera:
        if not isinstance(item, dict):
            continue
        cam_id = str(item.get("camera_id") or "-")
        quality = round(_camera_view_quality(item), 3)
        payload = {
            "overall_summary": str(item.get("summary") or ""),
            "self_action": str(item.get("self_action") or ""),
            "interactions": item.get("interactions") if isinstance(item.get("interactions"), list) else [],
            "description_source": str(item.get("description_source") or ""),
            "target_boxes": item.get("target_boxes") if isinstance(item.get("target_boxes"), list) else [],
            "target_box_series": item.get("target_box_series") if isinstance(item.get("target_box_series"), list) else [],
            "camera_score": round(_safe_float(item.get("camera_score"), 0.0), 4),
            "camera_score_detail": item.get("camera_score_detail") if isinstance(item.get("camera_score_detail"), dict) else {},
        }
        lines.append(f"- 相机 {cam_id} (视野质量 {quality}): {json.dumps(payload, ensure_ascii=False)}")

    all_inputs = "\n".join(lines) if lines else "- 无可用多视角输入"
    user_context = str(query_text or "").strip() or "无"

    return (
        f"你是高级多视角时空推理 Agent。你的任务是对同一目标（ID: {track_id}, 类别: {cls_label}）在多台相机下的独立行为描述进行【深度融合与异常排查】。"
        "\n\n【全量视角输入与权重】"
        "\n(注：视野质量评分 0-1.0，分数越高代表目标在该相机画面中越清晰、遮挡越少)"
        f"\n{all_inputs}"
        f"\n\n【用户查询上下文】\n{user_context}"
        "\n\n【深度融合法则】"
        "\n1. 交叉验证与除噪：寻找多视角中的共性行为。如果某个低质量视角的描述与多数高质量视角产生严重矛盾（如无中生有的交互对象、颜色误判），请将其视为模型幻觉并剔除。"
        "\n2. 空间拼接：将目标在不同相机中出现的先后顺序或空间动作连贯起来，形成完整行为时间线。"
        "\n3. 意图穿透：不要仅描述动作，要结合动作特征、交互对象推测深层意图（如跟踪、逃离、巡视、会合）。"
        "\n\n【强制输出结构 (JSON)】"
        "\n{"
        "\n  \"short_label\": \"不超过15字的动作概括\","
        "\n  \"full_summary\": \"综合所有有效视角，生成一段连贯行为叙述\","
        "\n  \"conflict_resolution\": \"简述处理了哪些多视角幻觉或冲突（若无填无冲突）\","
        "\n  \"reasoning_insights\": \"基于轨迹和交互行为推测动机或潜在风险\""
        "\n}"
        "\n只输出 JSON，不要输出解释。"
    )


def _fuse_track_camera_descriptions_god_view(
    track_id: int,
    cls_label: str,
    per_camera: List[Dict[str, Any]],
    fallback_summary: str,
    query_text: str,
) -> Dict[str, Any]:
    result = {
        "short_label": "",
        "full_summary": fallback_summary,
        "conflict_resolution": "无冲突",
        "reasoning_insights": "信息不足，无法推断明确动机。",
        "raw": None,
        "ok": False,
    }
    if not per_camera:
        return result

    legacy = _legacy()
    prompt = _build_god_view_full_fusion_prompt(
        track_id=track_id,
        cls_label=cls_label,
        per_camera=per_camera,
        query_text=query_text,
    )
    try:
        raw = legacy.qwen_chat(
            prompt,
            system="你是多视角行为融合专家。必须严格输出JSON对象，不要输出额外文本。",
            max_new_tokens=GOD_VIEW_QWEN_MAX_NEW_TOKENS,
        )
        result["raw"] = raw
        parsed = _safe_json_loads(raw or "")
        if isinstance(parsed, dict):
            short_label = str(parsed.get("short_label") or "").strip()
            full_summary = str(parsed.get("full_summary") or "").strip()
            conflict_resolution = str(parsed.get("conflict_resolution") or "").strip()
            reasoning_insights = str(parsed.get("reasoning_insights") or "").strip()

            if short_label:
                result["short_label"] = short_label[:15]
            if full_summary:
                result["full_summary"] = full_summary
            if conflict_resolution:
                result["conflict_resolution"] = conflict_resolution
            if reasoning_insights:
                result["reasoning_insights"] = reasoning_insights
            result["ok"] = bool(full_summary)
    except Exception as e:
        _legacy().logger.warning("god_view qwen fusion failed for track %s: %s", track_id, e)

    if not result["short_label"]:
        # Fallback short label from full summary for 3D floating text.
        normalized = re.sub(r"\s+", "", str(result["full_summary"] or ""))
        result["short_label"] = normalized[:15] if normalized else "行为融合结果"
    return result


def _summarize_visual_prompt_stats(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        "events": len(events),
        "camera_items": 0,
        "visual_prompt_attempted": 0,
        "visual_prompt_applied": 0,
        "visual_prompt_succeeded": 0,
        "has_target_boxes": 0,
        "reasons": {},
    }
    reason_counter: DefaultDict[str, int] = defaultdict(int)
    for ev in events:
        per_camera = ev.get("multi_camera_descriptions") if isinstance(ev, dict) else []
        if not isinstance(per_camera, list):
            continue
        for item in per_camera:
            if not isinstance(item, dict):
                continue
            stats["camera_items"] += 1
            if bool(item.get("visual_prompt_attempted")):
                stats["visual_prompt_attempted"] += 1
            if bool(item.get("visual_prompt_applied")):
                stats["visual_prompt_applied"] += 1
            if bool(item.get("visual_prompt_succeeded")):
                stats["visual_prompt_succeeded"] += 1
            boxes = item.get("target_boxes")
            if isinstance(boxes, list) and len(boxes) > 0:
                stats["has_target_boxes"] += 1
            reason = str(item.get("visual_prompt_reason") or "unknown")
            reason_counter[reason] += 1
    stats["reasons"] = dict(sorted(reason_counter.items(), key=lambda kv: kv[0]))
    return stats


def _build_track_text_events(
    resp: Dict[str, Any],
    tracks: List[Dict[str, Any]],
    query_text: str,
    fps: float,
    video_path: Optional[Path] = None,
    camera_video_map: Optional[Dict[str, Path]] = None,
    camera_image_dir_map: Optional[Dict[str, Path]] = None,
    track_camera_stats: Optional[Dict[int, Dict[str, Dict[str, float]]]] = None,
    camera_tracks_map: Optional[Dict[str, Path]] = None,
    dataset_hint: str = "",
    tracks_path: Optional[Path] = None,
    context: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    highlights_raw = resp.get("highlights")
    highlights = [int(x) for x in highlights_raw if isinstance(x, (int, float))] if isinstance(highlights_raw, list) else []
    if not highlights:
        highlights = _extract_fallback_ids_from_evidence(resp)

    # Default behavior: generate for all filtered track ids when available.
    track_ids: List[int] = []
    if highlights:
        track_ids = [int(x) for x in highlights]
    else:
        track_ids = [int(tid) for tid in [t.get("id") for t in tracks] if isinstance(tid, (int, float))]
    if not track_ids:
        return []

    fps_safe = max(1e-6, _safe_float(fps, 10.0))
    track_index: Dict[int, Dict[str, Any]] = {}
    for t in tracks:
        tid = t.get("id")
        if isinstance(tid, (int, float)):
            track_index[int(tid)] = t

    base_conf = 0.7
    conf_obj = resp.get("confidence")
    if isinstance(conf_obj, dict):
        base_conf = _safe_float(conf_obj.get("trajectory"), 0.7)
    base_conf = max(0.05, min(1.0, base_conf))

    camera_video_map = camera_video_map or {}
    camera_image_dir_map = camera_image_dir_map or {}
    track_camera_stats = track_camera_stats or {}
    camera_tracks_map = camera_tracks_map or {}
    camera_tracks_cache: Dict[str, Dict[int, List[Dict[str, float]]]] = {}
    iv_max_calls = int(os.environ.get("TRACK_EVENT_IV_MAX", "80"))
    frame_only_when_available = os.environ.get("TRACK_EVENT_FRAME_ONLY_WHEN_AVAILABLE", "1").strip() != "0"
    realtime_box_stride = max(1, int(os.environ.get("TRACK_EVENT_REALTIME_BOX_STRIDE", "1")))
    realtime_box_max = max(1, int(os.environ.get("TRACK_EVENT_REALTIME_BOX_MAX", "1200")))
    iv_calls = 0
    fusion_mode = DEFAULT_FUSION_MODE
    god_view_full_fusion = fusion_mode == GOD_VIEW_FULL_FUSION_MODE
    camera_limit = DEFAULT_CAMERA_LIMIT
    event_limit = DEFAULT_EVENT_LIMIT

    if god_view_full_fusion:
        # In god-view mode, remove call-budget restrictions so every camera can contribute.
        iv_max_calls = 10 ** 9

    # Global all-camera mode: if camera exists, generate description (no top-k pruning).
    if not god_view_full_fusion:
        iv_max_calls = max(iv_max_calls, 10 ** 9)

    legacy_desc_index = _build_legacy_track_camera_desc_index(
        tracks_path=tracks_path,
        dataset_type=dataset_hint,
        context=context,
    )
    legacy_fusion_index = _build_legacy_track_fusion_index(
        tracks_path=tracks_path,
        dataset_type=dataset_hint,
        context=context,
    ) if fusion_mode == "all_cameras+fusion" else {}

    def _camera_score(
        tid: int,
        cam_id: Optional[str],
        frame_start: int,
        frame_end: int,
        box_series: List[Dict[str, float]],
    ) -> Tuple[float, Dict[str, float]]:
        lo = min(frame_start, frame_end)
        hi = max(frame_start, frame_end)
        total_span = max(1, hi - lo + 1)
        overlap_ratio = 0.0
        count_ratio = 0.0

        if cam_id and int(tid) in track_camera_stats:
            stat = (track_camera_stats.get(int(tid), {}) or {}).get(str(cam_id), {})
            if isinstance(stat, dict) and stat:
                c_lo = int(stat.get("min_frame", lo))
                c_hi = int(stat.get("max_frame", hi))
                overlap = max(0, min(hi, c_hi) - max(lo, c_lo) + 1)
                overlap_ratio = overlap / float(total_span)
                count = float(stat.get("count", 0.0))
                count_ratio = min(1.0, count / float(total_span))

        in_range = [b for b in box_series if lo <= int(b.get("frame", -1)) <= hi]
        boxes_for_score = in_range if in_range else box_series
        avg_area = 0.0
        box_density = 0.0
        if boxes_for_score:
            areas = [max(1.0, _safe_float(b.get("w"), 1.0) * _safe_float(b.get("h"), 1.0)) for b in boxes_for_score]
            avg_area = sum(areas) / max(1, len(areas))
            box_density = min(1.0, len(boxes_for_score) / float(total_span))

        area_score = min(1.0, avg_area / 6000.0)
        score = (0.55 * overlap_ratio) + (0.2 * count_ratio) + (0.2 * area_score) + (0.05 * box_density)
        return score, {
            "overlap_ratio": round(overlap_ratio, 4),
            "count_ratio": round(count_ratio, 4),
            "avg_area": round(avg_area, 2),
            "area_score": round(area_score, 4),
            "box_density": round(box_density, 4),
        }

    def _camera_detection_confidence(
        frame_start: int,
        frame_end: int,
        box_series: List[Dict[str, float]],
    ) -> Tuple[float, Dict[str, Any]]:
        lo = min(frame_start, frame_end)
        hi = max(frame_start, frame_end)
        span = max(1, hi - lo + 1)
        in_range = [b for b in box_series if lo <= int(b.get("frame", -1)) <= hi]
        pool = in_range if in_range else box_series
        frame_count = len(pool)
        frame_ratio = min(1.0, frame_count / float(span)) if frame_count > 0 else 0.0
        avg_area = 0.0
        if frame_count > 0:
            areas = [max(1.0, _safe_float(b.get("w"), 1.0) * _safe_float(b.get("h"), 1.0)) for b in pool]
            avg_area = sum(areas) / float(frame_count)
        # Area normalization is heuristic and can be tuned per dataset.
        area_ratio = min(1.0, avg_area / 6000.0)
        conf = (0.6 * area_ratio) + (0.4 * frame_ratio)
        return _clamp01(conf), {
            "box_frame_count": int(frame_count),
            "frame_ratio": round(frame_ratio, 4),
            "avg_box_area": round(avg_area, 2),
            "area_ratio": round(area_ratio, 4),
        }

    def _build_lightweight_camera_summary(
        track_id: int,
        cls_label: str,
        cam_id: Optional[str],
        frame_start: int,
        frame_end: int,
        boxes: List[Dict[str, Any]],
        fallback: str,
    ) -> str:
        if not boxes:
            return fallback
        first = boxes[0]
        last = boxes[-1]
        dx = _safe_float(last.get("x"), 0.0) - _safe_float(first.get("x"), 0.0)
        dy = _safe_float(last.get("y"), 0.0) - _safe_float(first.get("y"), 0.0)
        if abs(dx) > abs(dy) * 1.2:
            trend = "横向移动"
        elif abs(dy) > abs(dx) * 1.2:
            trend = "纵向移动"
        else:
            trend = "缓慢位移"
        avg_area = sum(max(1.0, _safe_float(b.get("w"), 1.0) * _safe_float(b.get("h"), 1.0)) for b in boxes) / max(1, len(boxes))
        cam = str(cam_id or "-")
        return (
            f"[{cam}] 轨迹{track_id}（{cls_label}）在该视角 f{frame_start}-f{frame_end} 内持续可见，"
            f"目标框平均面积约{avg_area:.0f}px²，整体呈{trend}。"
        )

    def build_rule_summary(
        track_id: int,
        cls_label: str,
        pattern_label: str,
        start_sec: float,
        end_sec: float,
        duration_sec: float,
    ) -> str:
        query_prefix = ""
        if query_text and query_text.strip():
            query_prefix = "与当前查询相关，"
        return (
            f"轨迹{track_id}（{cls_label}）呈现{pattern_label}，{query_prefix}在 {start_sec:.1f}s 到 {end_sec:.1f}s 活动"
            f"，持续约 {duration_sec:.1f}s。"
        )

    def build_internvideo_prompt(
        track_id: int,
        cls_label: str,
        start_sec: float,
        end_sec: float,
        duration_sec: float,
        displacement_px: float,
        avg_speed_px_sec: float,
        fallback_pattern: str,
        context_snippet: str,
    ) -> str:
        query_hint = query_text.strip() if isinstance(query_text, str) else ""
        safe_context = _sanitize_context_for_vlm(context_snippet)
        return (
            "请根据给定视频片段，为被红色边界框标注的核心目标生成客观中文描述，并判断该红框目标的交互类型。"
            "你只能描述红框目标，不得把其它行人当作主体。"
            "\n【绝对禁忌】"
            "\n1. 严禁描述全局风景、天气或无关背景人群。"
            "\n2. 如果在所有帧都找不到红框目标，overall_summary 必须输出“目标不可见”，self_action 输出空字符串，interaction_type=none，severity_level=0，short_description=\"\"，confidence=0，interaction_frame=null。"
            "\n3. 严禁主观臆测和过度脑补。"
            "\n4. 严禁根据文本猜测交互对象身份，尤其不要编造或复述他人ID。"
            "\n【输入信息】"
            f"\n目标轨迹ID(仅用于你识别当前任务): {track_id}"
            f"\n目标类别: {cls_label}"
            f"\n时间段(秒): {start_sec:.2f} - {end_sec:.2f}"
            f"\n持续时长(秒): {duration_sec:.2f}"
            f"\n位移(像素): {displacement_px:.2f}"
            f"\n平均速度(像素/秒): {avg_speed_px_sec:.2f}"
            f"\n运动先验: {fallback_pattern}"
            f"\n目标轨迹概况: {safe_context}"
            f"\n用户查询上下文: {query_hint or '无'}"
            "\n请优先观察: 红框目标的动作细节、衣着颜色、携带物，以及与近邻是否存在明确互动。"
            "\n交互类型只能从以下枚举中选择: [擦肩而过, 并排行走, 驻足交谈, 递送物品, 常规肢体接触, 跟随, 异常聚集, 暴力冲突, none]。"
            "\n定义提示:"
            "\n- 擦肩而过: 靠近后各自离开，无停顿。"
            "\n- 跟随: 一前一后保持距离同向移动。"
            "\n- 驻足交谈: 停下脚步，面对面或侧身持续交流。"
            "\n- 并排行走: 步伐一致结伴同行。"
            "\n- 递送物品: 目标之间发生明确物体传递或交换动作。"
            "\n- 常规肢体接触: 和平的身体接触，如拥抱、握手、拍肩膀。"
            "\n- 暴力冲突: 具有攻击性的肢体接触，如推搡、殴打、剧烈拉扯。"
            "\n- 异常聚集: 多人短时间内异常扎堆聚拢。"
            "\n- none: 无交互(只是透视靠近、没有实际互动或视线交流)。"
            "\n如果存在交互，请给出多个交互事件(允许1条或多条)，每条输出交互时间段(start_frame, end_frame)。"
            "\ninteraction_frame 必须取自 interaction_events 中置信度最高的那条事件的帧号，若只给时间段，取该段中点帧。"
            "\n如果没有交互，interaction_type 必须是 none，severity_level=0，short_description 为空字符串，confidence=0，interaction_events 输出空数组。"
            "\n【JSON输出规范】"
            "\n只允许输出纯JSON，且仅包含八个键: overall_summary, self_action, interaction_type, severity_level, short_description, confidence, interaction_frame, interaction_events。"
            "\n- overall_summary: 一句话描述目标轨迹、外观显著特征和核心行为。"
            "\n- self_action: 仅写目标的细微动作或携带物（如看手机、提袋子、推车）。若无特殊动作输出“无特殊动作”。"
            "\n- interaction_type: 必须是枚举列表之一。"
            "\n- severity_level: 交互强度等级，0=无交互，1=常规交互，2=高危交互。"
            "\n- short_description: 15字以内概括交互核心动作；若无交互输出空字符串。"
            "\n- confidence: 0到1之间的小数，表示交互判断置信度；无交互时输出0。"
            "\n- interaction_frame: 绝对帧号或 null。"
            "\n- interaction_events: 交互事件数组，每项包含 start_frame, end_frame, type, detail, confidence。"
            "\n示例: {\"overall_summary\":\"...\",\"self_action\":\"无特殊动作\",\"interaction_type\":\"none\",\"severity_level\":0,\"short_description\":\"\",\"confidence\":0,\"interaction_frame\":null,\"interaction_events\":[] }"
        )

    events: List[Dict[str, Any]] = []
    for rank, tid in enumerate(track_ids[:event_limit]):
        track = track_index.get(tid)
        if not track:
            continue
        points = track.get("points")
        if not isinstance(points, list) or not points:
            continue

        frames = [int(p.get("frame")) for p in points if isinstance(p, dict) and isinstance(p.get("frame"), (int, float))]
        if not frames:
            continue
        frame_start = min(frames)
        frame_end = max(frames)
        frame_mid = frame_start + (frame_end - frame_start) // 2

        if camera_image_dir_map or camera_video_map:
            camera_union = sorted(set(camera_image_dir_map.keys()) | set(camera_video_map.keys()))
            per_track_stats = track_camera_stats.get(int(tid), {}) if isinstance(track_camera_stats, dict) else {}
            if isinstance(per_track_stats, dict) and per_track_stats:
                lo_tmp = min(frame_start, frame_end)
                hi_tmp = max(frame_start, frame_end)
                total_span_tmp = max(1, hi_tmp - lo_tmp + 1)
                ranked_union: List[Tuple[float, float, str]] = []
                for cam_id in camera_union:
                    stat = per_track_stats.get(cam_id, {}) if isinstance(per_track_stats.get(cam_id), dict) else {}
                    c_lo = int(stat.get("min_frame", lo_tmp)) if stat else lo_tmp
                    c_hi = int(stat.get("max_frame", hi_tmp)) if stat else hi_tmp
                    overlap = max(0, min(hi_tmp, c_hi) - max(lo_tmp, c_lo) + 1)
                    overlap_ratio = overlap / float(total_span_tmp)
                    count = float(stat.get("count", 0.0)) if stat else 0.0
                    ranked_union.append((overlap_ratio, count, cam_id))
                ranked_union.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
                camera_union = [x[2] for x in ranked_union]

            selected_videos = [(camera_video_map.get(cam_id), cam_id) for cam_id in camera_union]
        else:
            selected_videos = _pick_videos_for_track(
                track_id=tid,
                frame_start=frame_start,
                frame_end=frame_end,
                default_video_path=video_path,
                camera_video_map=camera_video_map,
                track_camera_stats=track_camera_stats,
                camera_limit=camera_limit,
            )

        if str(dataset_hint or "").strip().lower() == "wildtrack":
            t_start = frame_start / 2.0
            t_end = frame_end / 2.0
        else:
            t_start = frame_start / fps_safe
            t_end = frame_end / fps_safe
        duration = max(0.0, t_end - t_start)

        cls_id = int(track.get("cls", 0))
        cls_label = VIRAT_CLASS_LABELS.get(cls_id, "目标")
        confidence = max(0.05, min(1.0, base_conf - rank * 0.03))
        context_snippet = _build_track_context_snippet(track, tracks, frame_start, frame_end)

        # Infer a coarse behavior pattern from displacement and speed.
        first_point = points[0] if isinstance(points[0], dict) else {}
        last_point = points[-1] if isinstance(points[-1], dict) else {}
        dx = _safe_float(last_point.get("x"), 0.0) - _safe_float(first_point.get("x"), 0.0)
        dy = _safe_float(last_point.get("y"), 0.0) - _safe_float(first_point.get("y"), 0.0)
        displacement = math.hypot(dx, dy)
        avg_speed = displacement / max(1e-6, duration)

        if displacement < 15 or avg_speed < 2.0:
            pattern = "驻留观察"
        elif avg_speed < 6.0:
            pattern = "慢速移动"
        elif abs(dx) > abs(dy) * 1.2:
            pattern = "横向穿越"
        else:
            pattern = "快速通行"

        summary = build_rule_summary(tid, cls_label, pattern, t_start, t_end, duration)
        description_source = "rule_fallback"
        lo = max(0.0, min(t_start, t_end))
        hi = max(lo + 0.6, max(t_start, t_end))
        prompt = build_internvideo_prompt(
            track_id=tid,
            cls_label=cls_label,
            start_sec=lo,
            end_sec=hi,
            duration_sec=max(0.0, hi - lo),
            displacement_px=displacement,
            avg_speed_px_sec=avg_speed,
            fallback_pattern=pattern,
            context_snippet=context_snippet,
        )

        multi_camera_descriptions: List[Dict[str, Any]] = []
        if not selected_videos:
            selected_videos = [(None, None)]

        camera_candidates: List[Dict[str, Any]] = []
        for cand_video, cand_cam in selected_videos:
            item_boxes: List[Dict[str, Any]] = []
            item_box_series: List[Dict[str, float]] = []
            item_box_series_realtime: List[Dict[str, Any]] = []
            item_tracks_path: Optional[str] = None
            item_image_dir: Optional[str] = None
            if cand_cam:
                cam_key = str(cand_cam)
                cam_tracks = camera_tracks_map.get(cam_key)
                if cam_tracks is not None and cam_tracks.exists():
                    item_tracks_path = str(cam_tracks)
                    if cam_key not in camera_tracks_cache:
                        camera_tracks_cache[cam_key] = _parse_camera_track_boxes(cam_tracks, dataset_hint=dataset_hint)
                    cam_track_data = camera_tracks_cache.get(cam_key, {})
                    item_box_series = cam_track_data.get(int(tid), [])
                    item_boxes = _sample_track_boxes(item_box_series, frame_start, frame_end)
                    item_box_series_realtime = _collect_track_boxes_for_realtime(
                        item_box_series,
                        frame_start,
                        frame_end,
                        stride=realtime_box_stride,
                        max_samples=realtime_box_max,
                    )
                cam_image_dir = camera_image_dir_map.get(cam_key)
                if cam_image_dir is not None and cam_image_dir.exists() and cam_image_dir.is_dir():
                    item_image_dir = str(cam_image_dir)
            score, score_detail = _camera_score(tid, cand_cam, frame_start, frame_end, item_box_series)
            det_conf, det_conf_detail = _camera_detection_confidence(frame_start, frame_end, item_box_series)
            camera_candidates.append(
                {
                    "video": cand_video,
                    "cam": cand_cam,
                    "tracks_path": item_tracks_path,
                    "image_dir": item_image_dir,
                    "boxes": item_boxes,
                    "box_series": item_box_series,
                    "box_series_realtime": item_box_series_realtime,
                    "score": score,
                    "score_detail": score_detail,
                    "detection_confidence": det_conf,
                    "detection_confidence_detail": det_conf_detail,
                }
            )

        if camera_candidates:
            camera_candidates = sorted(
                camera_candidates,
                key=lambda c: (
                    _safe_float(c.get("detection_confidence"), 0.0),
                    _safe_float(c.get("score"), 0.0),
                ),
                reverse=True,
            )
            # No top-k truncation: keep all available camera candidates.

        visual_camera_indices: set = set()
        if camera_candidates:
            visual_camera_indices = set(range(len(camera_candidates)))

        for idx, candidate in enumerate(camera_candidates):
            cand_video = candidate.get("video")
            cand_cam = candidate.get("cam")
            item_summary = summary
            item_self_action = summary
            item_interactions: List[Dict[str, Any]] = []
            item_interaction_class = "none"
            item_interaction_frame: Optional[int] = None
            item_interaction_frame_source = "missing"
            item_interaction_detail = ""
            item_interaction_type = ""
            item_interaction_events: List[Dict[str, Any]] = []
            item_source = "rule_fallback"
            item_boxes = candidate.get("boxes") if isinstance(candidate.get("boxes"), list) else []
            item_box_series = candidate.get("box_series") if isinstance(candidate.get("box_series"), list) else []
            item_box_series_realtime = (
                candidate.get("box_series_realtime")
                if isinstance(candidate.get("box_series_realtime"), list)
                else []
            )
            item_tracks_path = candidate.get("tracks_path") if isinstance(candidate.get("tracks_path"), str) else None
            item_image_dir = candidate.get("image_dir") if isinstance(candidate.get("image_dir"), str) else None
            item_detection_confidence = _safe_float(candidate.get("detection_confidence"), 0.0)
            item_detection_detail = (
                candidate.get("detection_confidence_detail")
                if isinstance(candidate.get("detection_confidence_detail"), dict)
                else {}
            )
            visual_prompt_applied = False
            visual_prompt_attempted = False
            visual_prompt_succeeded = False
            visual_prompt_reason = "init"
            visual_candidate = idx in visual_camera_indices
            cache_hit = False

            if cand_cam:
                visual_prompt_reason = "boxes_found" if item_boxes else "no_boxes_for_track"
            else:
                visual_prompt_reason = "no_camera_id"

            cached_desc = _load_track_camera_desc_cache(
                tracks_path=tracks_path,
                dataset_type=dataset_hint,
                track_id=int(tid),
                camera_id=str(cand_cam) if cand_cam is not None else None,
                frame_start=frame_start,
                frame_end=frame_end,
                context=context,
                legacy_index=legacy_desc_index,
            )
            if isinstance(cached_desc, dict):
                item_summary = str(cached_desc.get("summary") or item_summary)
                item_self_action = str(cached_desc.get("self_action") or item_summary)
                cached_interactions = cached_desc.get("interactions")
                item_interactions = cached_interactions if isinstance(cached_interactions, list) else []
                item_interaction_class = _normalize_interaction_class(cached_desc.get("interaction_class"))
                cached_frame = cached_desc.get("interaction_frame")
                item_interaction_frame = int(round(float(cached_frame))) if isinstance(cached_frame, (int, float)) else None
                item_interaction_frame_source = str(cached_desc.get("interaction_frame_source") or "").strip() or (
                    "raw" if item_interaction_frame is not None else "missing"
                )
                item_interaction_detail = str(cached_desc.get("interaction_detail") or "").strip()
                item_interaction_type = ""
                item_interaction_events = _normalize_interaction_events(cached_desc.get("interaction_events"))
                if item_interaction_class == "none":
                    item_interaction_class = _infer_interaction_class_from_events(item_interaction_events)
                if item_interaction_frame is None:
                    item_interaction_frame = _pick_primary_interaction_frame(item_interaction_events)
                    item_interaction_frame_source = "event_primary" if item_interaction_frame is not None else "missing"
                item_source = str(cached_desc.get("description_source") or "internvideo_cache")
                cache_hit = True
                visual_prompt_reason = "cached_track_camera_description"

            prompt_with_boxes = prompt
            if item_boxes:
                box_text = " | ".join(
                    [
                        f"f{b['frame']}:({b['x1']:.0f},{b['y1']:.0f})-({b['x2']:.0f},{b['y2']:.0f})"
                        for b in item_boxes[:4]
                    ]
                )
                prompt_with_boxes = (
                    f"{prompt}\n当前相机: {cand_cam or '-'}"
                    f"\n目标在该相机检测框(像素，按帧): {box_text}"
                    "\n请优先围绕这些框对应的人物生成描述，避免误把其他人当作目标。"
                    "\n如果画面里出现红框，请严格以红框人物为目标进行描述。"
                )

            image_dir_path = Path(item_image_dir) if item_image_dir else None
            has_frame_dir = bool(image_dir_path is not None and image_dir_path.exists() and image_dir_path.is_dir())
            has_video = bool(cand_video is not None and cand_video.exists())
            has_track_boxes = bool(item_box_series)
            can_infer = bool(
                (has_frame_dir or has_video)
                and iv_calls < max(0, iv_max_calls)
                and (cand_cam is None or has_track_boxes)
            )
            if (not cache_hit) and can_infer and visual_candidate:
                try:
                    def _has_valid_event_ranges(events: List[Dict[str, Any]]) -> bool:
                        if not events:
                            return False
                        for ev in events:
                            if not isinstance(ev.get("start_frame"), int):
                                return False
                            if not isinstance(ev.get("end_frame"), int):
                                return False
                        return True

                    pv, npl = (None, None)
                    visual_mode = None
                    if ENABLE_VISUAL_PROMPT and item_box_series:
                        if has_frame_dir and image_dir_path is not None:
                            pv, npl = _build_highlight_frame_tokens(
                                image_dir=image_dir_path,
                                frame_start=frame_start,
                                frame_end=frame_end,
                                boxes=item_box_series,
                                track_id=int(tid),
                                num_segments=48,
                            )
                            visual_mode = "frame_sequence"
                        elif has_video and cand_video is not None:
                            pv, npl = _build_highlight_video_tokens(
                                video_path=cand_video,
                                bound=(lo, hi),
                                boxes=item_box_series,
                                track_id=int(tid),
                                num_segments=48,
                            )
                            visual_mode = "video_tokens"
                        if pv is not None and npl is not None:
                            pv, npl, norm_reason = _normalize_visual_token_inputs(pv, npl, required_multiple=4)
                            if pv is None or npl is None:
                                visual_mode = None
                                visual_prompt_reason = norm_reason
                        else:
                            visual_mode = None
                            visual_prompt_reason = "frame_sequence_build_failed" if has_frame_dir else "highlight_build_failed"
                    elif not ENABLE_VISUAL_PROMPT:
                        visual_prompt_reason = "disabled"
                    elif not item_box_series:
                        visual_prompt_reason = "no_box_series"

                    last_iv_text: Optional[str] = None
                    for attempt in range(3):
                        iv_text = None
                        if visual_mode is not None and pv is not None and npl is not None:
                            visual_prompt_attempted = True
                            if DEBUG_VLM_IO:
                                _legacy().logger.info(
                                    "track_event_vlm request tid=%s cam=%s mode=%s prompt=%s",
                                    tid,
                                    cand_cam or "-",
                                    visual_mode,
                                    _clip_log_text(prompt_with_boxes),
                                )
                            iv_text = _legacy().run_internvideo(prompt_with_boxes, pixel_values=pv, num_patches_list=npl)
                            iv_calls += 1
                            if DEBUG_VLM_IO:
                                _legacy().logger.info(
                                    "track_event_vlm response tid=%s cam=%s mode=%s text=%s",
                                    tid,
                                    cand_cam or "-",
                                    visual_mode,
                                    _clip_log_text(iv_text),
                                )
                            if isinstance(iv_text, str) and iv_text.strip():
                                visual_prompt_applied = True
                                visual_prompt_succeeded = True
                                visual_prompt_reason = "applied_frame_sequence" if visual_mode == "frame_sequence" else "applied_video_tokens"
                            else:
                                visual_prompt_reason = "internvideo_empty_response"
                        if (
                            iv_text is None
                            and has_video
                            and cand_video is not None
                            and (not has_frame_dir or not frame_only_when_available)
                        ):
                            visual_prompt_attempted = True
                            if DEBUG_VLM_IO:
                                _legacy().logger.info(
                                    "track_event_vlm request tid=%s cam=%s mode=%s prompt=%s",
                                    tid,
                                    cand_cam or "-",
                                    "video_fallback",
                                    _clip_log_text(prompt_with_boxes),
                                )
                            iv_text = _legacy().run_internvideo(prompt_with_boxes, video_path=cand_video, bound=(lo, hi))
                            iv_calls += 1
                            if DEBUG_VLM_IO:
                                _legacy().logger.info(
                                    "track_event_vlm response tid=%s cam=%s mode=%s text=%s",
                                    tid,
                                    cand_cam or "-",
                                    "video_fallback",
                                    _clip_log_text(iv_text),
                                )
                            if isinstance(iv_text, str) and iv_text.strip():
                                visual_prompt_applied = True
                                visual_prompt_succeeded = True
                                visual_prompt_reason = "applied_video_fallback"
                        if not isinstance(iv_text, str) or not iv_text.strip():
                            continue
                        last_iv_text = iv_text
                        parsed = _safe_json_loads(iv_text)
                        if not parsed:
                            continue
                        overall = parsed.get("overall_summary")
                        self_action = parsed.get("self_action")
                        interaction_type = parsed.get("interaction_type") or parsed.get("interaction_class")
                        severity_level = parsed.get("severity_level") or parsed.get("severity")
                        short_description = (
                            str(parsed.get("short_description") or parsed.get("interaction_detail") or "").strip()
                        )
                        item_interaction_type = _extract_interaction_type(interaction_type)
                        item_interaction_events = _normalize_interaction_events(parsed.get("interaction_events"))
                        if not item_interaction_type:
                            continue
                        if item_interaction_type != "none" and not _has_valid_event_ranges(item_interaction_events):
                            continue
                        if item_interaction_type == "none" and item_interaction_events:
                            continue
                        if isinstance(overall, str) and overall.strip():
                            item_summary = overall.strip()
                        elif isinstance(self_action, str) and self_action.strip():
                            item_summary = self_action.strip()
                        else:
                            item_summary = iv_text.strip().replace("\n", " ")
                        if isinstance(self_action, str) and self_action.strip():
                            item_self_action = self_action.strip()
                        else:
                            item_self_action = item_summary
                        item_source = "internvideo"
                        item_interactions = parsed.get("interactions") if isinstance(parsed.get("interactions"), list) else []
                        mapped_class = _map_interaction_type_to_class(interaction_type, severity_level)
                        if mapped_class == "none":
                            mapped_class = parsed.get("interaction_class")
                        item_interaction_class = _normalize_interaction_class(mapped_class)
                        if item_interaction_class == "none":
                            item_interaction_class = _infer_interaction_class_from_events(item_interaction_events)
                        item_interaction_frame = parsed.get("interaction_frame")
                        if not isinstance(item_interaction_frame, (int, float)):
                            item_interaction_frame = _pick_primary_interaction_frame(item_interaction_events)
                            item_interaction_frame_source = "event_primary" if item_interaction_frame is not None else "missing"
                        else:
                            item_interaction_frame_source = "raw"
                        item_interaction_detail = short_description or str(interaction_type or "").strip()
                        if _looks_like_structured_text(item_summary) or _looks_like_structured_text(item_self_action):
                            last_iv_text = iv_text
                            continue
                        break

                    if not item_interaction_type and isinstance(last_iv_text, str) and last_iv_text.strip():
                        if _looks_like_structured_text(last_iv_text):
                            item_summary = _build_lightweight_camera_summary(
                                track_id=tid,
                                cls_label=cls_label,
                                cam_id=cand_cam,
                                frame_start=frame_start,
                                frame_end=frame_end,
                                boxes=item_boxes,
                                fallback=summary,
                            )
                            item_self_action = item_summary
                            item_source = "lightweight_rewrite"
                        else:
                            item_summary = last_iv_text.strip().replace("\n", " ")
                            item_self_action = item_summary
                            item_source = "internvideo"
                        item_interactions = []
                        item_interaction_class = "none"
                        item_interaction_events = []
                        item_interaction_frame = None
                        item_interaction_frame_source = "missing"
                        item_interaction_detail = ""
                        item_interaction_type = ""
                    if item_interaction_type and item_interaction_type != "none" and not _has_valid_event_ranges(item_interaction_events):
                        item_interaction_type = "none"
                        item_interaction_class = "none"
                        item_interaction_events = []
                        item_interaction_frame = None
                        item_interaction_frame_source = "missing"
                        item_interaction_detail = ""
                    camera_item_payload = {
                        "interaction_class": item_interaction_class,
                        "interaction_frame": item_interaction_frame,
                        "interaction_detail": item_interaction_detail,
                        "interaction_events": item_interaction_events,
                        "target_box_series": item_box_series,
                        "target_boxes": item_boxes,
                    }
                    _rectify_interaction_fields(
                        camera_item_payload,
                        frame_start=frame_start,
                        frame_end=frame_end,
                    )
                    item_interaction_class = str(camera_item_payload.get("interaction_class") or "none")
                    item_interaction_frame = camera_item_payload.get("interaction_frame")
                    item_interaction_frame_source = str(camera_item_payload.get("interaction_frame_source") or "missing")
                    item_interaction_detail = str(camera_item_payload.get("interaction_detail") or "").strip()
                    item_interaction_events = (
                        camera_item_payload.get("interaction_events")
                        if isinstance(camera_item_payload.get("interaction_events"), list)
                        else []
                    )
                    if not item_interaction_type:
                        item_interaction_type = ""
                    _save_track_camera_desc_cache(
                        tracks_path=tracks_path,
                        dataset_type=dataset_hint,
                        track_id=int(tid),
                        camera_id=str(cand_cam) if cand_cam is not None else None,
                        frame_start=frame_start,
                        frame_end=frame_end,
                        summary=item_summary,
                        self_action=item_self_action,
                        interactions=item_interactions,
                        interaction_class=item_interaction_class,
                        interaction_frame=item_interaction_frame,
                        interaction_frame_source=item_interaction_frame_source,
                        interaction_detail=item_interaction_detail,
                        interaction_events=item_interaction_events,
                        description_source=item_source,
                        context=context,
                    ) if not (_looks_like_structured_text(item_summary) or _looks_like_structured_text(item_self_action)) else None
                except Exception as e:
                    visual_prompt_reason = "infer_exception"
                    _legacy().logger.warning("internvideo track event summary failed: %s", e)
            elif (not cache_hit) and can_infer and not visual_candidate:
                visual_prompt_reason = "topk_non_primary"
                item_summary = _build_lightweight_camera_summary(
                    track_id=tid,
                    cls_label=cls_label,
                    cam_id=cand_cam,
                    frame_start=frame_start,
                    frame_end=frame_end,
                    boxes=item_boxes,
                    fallback=summary,
                )
                item_self_action = item_summary
                item_source = "lightweight"
            else:
                if cache_hit:
                    visual_prompt_reason = "cached_track_camera_description"
                elif has_frame_dir or has_video:
                    visual_prompt_reason = "iv_call_budget_exhausted"
                elif cand_video is not None and not cand_video.exists():
                    visual_prompt_reason = "video_not_exists"
                else:
                    visual_prompt_reason = "no_frame_dir_or_video"

            camera_item_payload = {
                "interaction_class": item_interaction_class,
                "interaction_frame": item_interaction_frame,
                "interaction_detail": item_interaction_detail,
                "interaction_events": item_interaction_events,
                "target_box_series": item_box_series,
                "target_boxes": item_boxes,
            }
            _rectify_interaction_fields(
                camera_item_payload,
                frame_start=frame_start,
                frame_end=frame_end,
            )
            item_interaction_class = str(camera_item_payload.get("interaction_class") or "none")
            item_interaction_frame = camera_item_payload.get("interaction_frame")
            item_interaction_frame_source = str(camera_item_payload.get("interaction_frame_source") or "missing")
            item_interaction_detail = str(camera_item_payload.get("interaction_detail") or "").strip()
            item_interaction_events = (
                camera_item_payload.get("interaction_events")
                if isinstance(camera_item_payload.get("interaction_events"), list)
                else []
            )
            item_interaction_events_dropped = int(camera_item_payload.get("interaction_events_dropped") or 0)

            multi_camera_descriptions.append(
                {
                    "camera_id": cand_cam,
                    "video_path": str(cand_video) if cand_video is not None else None,
                    "image_dir": item_image_dir,
                    "tracks_path": item_tracks_path,
                    "target_boxes": item_boxes,
                    "target_box_series": item_box_series_realtime,
                    "visual_prompt_applied": visual_prompt_applied,
                    "visual_prompt_attempted": visual_prompt_attempted,
                    "visual_prompt_succeeded": visual_prompt_succeeded,
                    "visual_prompt_reason": visual_prompt_reason,
                    "camera_score": round(_safe_float(candidate.get("score"), 0.0), 4),
                    "camera_score_detail": candidate.get("score_detail") if isinstance(candidate.get("score_detail"), dict) else {},
                    "detection_confidence": round(item_detection_confidence, 4),
                    "detection_confidence_detail": item_detection_detail,
                    "primary_visual_camera": bool(idx == 0),
                    "description_cache_hit": cache_hit,
                    "summary": item_summary,
                    "self_action": item_self_action,
                    "interactions": item_interactions,
                    "interaction_class": item_interaction_class,
                    "interaction_frame": item_interaction_frame,
                    "interaction_frame_source": item_interaction_frame_source,
                    "interaction_detail": item_interaction_detail,
                    "interaction_type": item_interaction_type,
                    "interaction_events": item_interaction_events,
                    "interaction_events_dropped": item_interaction_events_dropped,
                    "description_source": item_source,
                    "confidence": round(item_detection_confidence, 3),
                }
            )

        fusion_summary = summary
        god_view_result: Optional[Dict[str, Any]] = None
        qwen_track_fusion_result: Optional[Dict[str, Any]] = None
        if fusion_mode == "all_cameras+fusion":
            fusion_camera_signature = _build_fusion_camera_signature(multi_camera_descriptions)
            qwen_track_fusion_result = _load_track_fusion_cache(
                tracks_path=tracks_path,
                dataset_type=dataset_hint,
                track_id=int(tid),
                frame_start=frame_start,
                frame_end=frame_end,
                fusion_mode=fusion_mode,
                camera_signature=fusion_camera_signature,
                context=context,
                legacy_index=legacy_fusion_index,
            )
            if isinstance(qwen_track_fusion_result, dict) and bool(qwen_track_fusion_result.get("ok")):
                fusion_summary = str(qwen_track_fusion_result.get("full_summary") or summary)
            elif TRACK_EVENT_QWEN_FUSION_ENABLED:
                _legacy().logger.info(
                    "fusion fallback to qwen: tid=%s frame=%s-%s mode=%s cams=%s",
                    tid,
                    frame_start,
                    frame_end,
                    fusion_mode,
                    fusion_camera_signature,
                )
                qwen_track_fusion_result = _fuse_track_camera_descriptions_qwen(
                    track_id=tid,
                    cls_label=cls_label,
                    per_camera=multi_camera_descriptions,
                    fallback_summary=summary,
                    query_text=query_text,
                )
                if bool(qwen_track_fusion_result.get("ok")):
                    fusion_summary = str(qwen_track_fusion_result.get("full_summary") or summary)
                    saved_path = _save_track_fusion_cache(
                        tracks_path=tracks_path,
                        dataset_type=dataset_hint,
                        track_id=int(tid),
                        frame_start=frame_start,
                        frame_end=frame_end,
                        fusion_mode=fusion_mode,
                        camera_signature=fusion_camera_signature,
                        fusion_result=qwen_track_fusion_result,
                        context=context,
                    )
                    if saved_path is not None:
                        _legacy().logger.info(
                            "fusion cache write: tid=%s frame=%s-%s mode=%s cams=%s path=%s",
                            tid,
                            frame_start,
                            frame_end,
                            fusion_mode,
                            fusion_camera_signature,
                            str(saved_path),
                        )
                else:
                    fusion_summary = _fuse_track_camera_descriptions(multi_camera_descriptions, summary)
            else:
                fusion_summary = _fuse_track_camera_descriptions(multi_camera_descriptions, summary)
        elif fusion_mode == GOD_VIEW_FULL_FUSION_MODE:
            god_view_result = _fuse_track_camera_descriptions_god_view(
                track_id=tid,
                cls_label=cls_label,
                per_camera=multi_camera_descriptions,
                fallback_summary=summary,
                query_text=query_text,
            )
            fusion_summary = str(god_view_result.get("full_summary") or summary)
        elif multi_camera_descriptions:
            fusion_summary = str(multi_camera_descriptions[0].get("summary") or summary)

        model_items = [x for x in multi_camera_descriptions if str(x.get("description_source")) == "internvideo"]
        if model_items:
            chosen = max(model_items, key=lambda x: _safe_float(x.get("confidence"), 0.0))
        elif multi_camera_descriptions:
            chosen = max(multi_camera_descriptions, key=lambda x: _safe_float(x.get("confidence"), 0.0))
        else:
            chosen = None
        if model_items:
            description_source = "internvideo"
        if god_view_full_fusion and isinstance(god_view_result, dict) and bool(god_view_result.get("ok")):
            description_source = "qwen_god_view"
        if fusion_mode == "all_cameras+fusion" and isinstance(qwen_track_fusion_result, dict) and bool(qwen_track_fusion_result.get("ok")):
            description_source = "qwen_track_fusion_cache" if bool(qwen_track_fusion_result.get("cache_hit")) else "qwen_track_fusion"
        selected_camera_id = chosen.get("camera_id") if isinstance(chosen, dict) else None
        selected_video_path = chosen.get("video_path") if isinstance(chosen, dict) else None
        summary = fusion_summary

        short_label = None
        full_summary = None
        conflict_resolution = None
        reasoning_insights = None
        fusion_details: Dict[str, Any] = {}
        if god_view_full_fusion and isinstance(god_view_result, dict):
            short_label = str(god_view_result.get("short_label") or "").strip() or None
            full_summary = str(god_view_result.get("full_summary") or "").strip() or None
            conflict_resolution = str(god_view_result.get("conflict_resolution") or "").strip() or "无冲突"
            reasoning_insights = str(god_view_result.get("reasoning_insights") or "").strip() or None
            fusion_details = {
                "source": "qwen_god_view",
                "raw": god_view_result,
            }
        elif fusion_mode == "all_cameras+fusion" and isinstance(qwen_track_fusion_result, dict):
            short_label = str(qwen_track_fusion_result.get("short_label") or "").strip() or None
            full_summary = str(qwen_track_fusion_result.get("full_summary") or "").strip() or None
            conflict_resolution = str(qwen_track_fusion_result.get("conflict_resolution") or "").strip() or "无冲突"
            reasoning_insights = str(qwen_track_fusion_result.get("reasoning_insights") or "").strip() or None
            fusion_details = {
                "source": "qwen_track_fusion_cache" if bool(qwen_track_fusion_result.get("cache_hit")) else "qwen_track_fusion",
                "cache_hit": bool(qwen_track_fusion_result.get("cache_hit")),
                "cache_path": str(qwen_track_fusion_result.get("cache_path")) if qwen_track_fusion_result.get("cache_path") is not None else None,
                "raw": qwen_track_fusion_result,
            }

        self_action = None
        interactions: List[Dict[str, Any]] = []
        for item in multi_camera_descriptions:
            if not self_action and isinstance(item.get("self_action"), str) and item.get("self_action"):
                self_action = str(item.get("self_action"))
            if isinstance(item.get("interactions"), list):
                interactions.extend([x for x in item.get("interactions") if isinstance(x, dict)])
        if self_action is None:
            self_action = fusion_summary

        dedup_interactions: List[Dict[str, Any]] = []
        seen_interactions = set()
        for item in interactions:
            key = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if key in seen_interactions:
                continue
            seen_interactions.add(key)
            dedup_interactions.append(item)

        evidence_frames = sorted({frame_start, frame_mid, frame_end})
        interaction_type = ""
        if isinstance(chosen, dict):
            interaction_type = str(chosen.get("interaction_type") or "").strip()
        if not interaction_type:
            for item in multi_camera_descriptions:
                cand = str(item.get("interaction_type") or "").strip()
                if cand:
                    interaction_type = cand
                    break
        if not interaction_type:
            interaction_type = "none"
        fusion_confidence = _safe_float(chosen.get("confidence"), 0.0) if isinstance(chosen, dict) else 0.0
        fused_range = None
        if isinstance(qwen_track_fusion_result, dict) and bool(qwen_track_fusion_result.get("ok")):
            fusion_confidence = _safe_float(qwen_track_fusion_result.get("confidence"), fusion_confidence)
            fused_range = qwen_track_fusion_result.get("fused_range")
        elif isinstance(god_view_result, dict) and bool(god_view_result.get("ok")):
            fusion_confidence = _safe_float(god_view_result.get("confidence"), fusion_confidence)
        events.append(
            {
                "track_id": tid,
                "class_label": cls_label,
                "frame_start": frame_start,
                "frame_end": frame_end,
                "t_start": round(t_start, 3),
                "t_end": round(t_end, 3),
                "summary": summary,
                "overall_summary": fusion_summary,
                "self_action": self_action,
                "interactions": dedup_interactions,
                "description_source": description_source,
                "description_camera_id": selected_camera_id,
                "description_video_path": selected_video_path,
                "multi_camera_descriptions": multi_camera_descriptions,
                "fusion_mode": fusion_mode,
                "fusion_summary": fusion_summary,
                "fusion_confidence": round(fusion_confidence, 3),
                "short_label": short_label,
                "full_summary": full_summary,
                "conflict_resolution": conflict_resolution,
                "reasoning_insights": reasoning_insights,
                "fusion_details": fusion_details,
                "fused_range": fused_range,
                "god_view_full_fusion": bool(god_view_full_fusion),
                "interaction_type": interaction_type,
                "confidence": round(fusion_confidence, 3),
                "evidence_frames": evidence_frames,
            }
        )
    # 填充顶层的融合交互字段
    for event in events:
        _fill_fused_interaction_fields(event)
    
    return events


def _attach_track_text_events(
    resp: Dict[str, Any],
    tracks_path: Path,
    dataset_type: str,
    fps: float,
    query_text: str,
    video_path: Optional[Path] = None,
    context: Optional[Dict[str, Any]] = None,
) -> None:
    if not isinstance(resp, dict):
        return
    try:
        cache_payload = _load_track_text_events_json(
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            query_text=query_text,
            video_path=video_path,
            context=context,
        )
        if isinstance(cache_payload, dict):
            cached_events = cache_payload.get("track_text_events")
            if isinstance(cached_events, list):
                cached_events = _rectify_track_text_events_interactions(cached_events, dataset_type=dataset_type)
            resp["track_text_events"] = cached_events
            if isinstance(cache_payload.get("track_text_generation_stats"), dict):
                resp["track_text_generation_stats"] = cache_payload.get("track_text_generation_stats")
            else:
                vp_stats = _summarize_visual_prompt_stats(
                    resp.get("track_text_events") if isinstance(resp.get("track_text_events"), list) else []
                )
                resp["track_text_generation_stats"] = {
                    "visual_prompt": vp_stats,
                    "camera_sources": 0,
                    "camera_image_dirs": 0,
                    "camera_tracks": 0,
                }
            cached_path = cache_payload.get("path")
            if isinstance(cached_path, Path):
                resp["track_text_events_json_path"] = str(cached_path)
            cached_fusion_export = _export_track_fusion_results_json(
                resp=resp,
                tracks_path=tracks_path,
                dataset_type=dataset_type,
                query_text=query_text,
                video_path=video_path,
                context=context,
            )
            if cached_fusion_export is not None:
                resp["track_fusion_results_json_path"] = str(cached_fusion_export)
            resp["track_text_cache_hit"] = True
            _legacy().logger.info("track_text events cache hit: %s", resp.get("track_text_events_json_path"))
            return

        tracks, _ = parse_tracks(tracks_path, dataset_type=dataset_type)
        camera_video_map = _collect_camera_videos_from_context(context)
        camera_image_dir_map = _collect_camera_image_dirs_from_context(context)
        camera_tracks_map = _collect_camera_tracks_from_context(context)
        track_camera_stats = _build_track_camera_stats_from_world_csv(tracks_path) if (camera_video_map or camera_image_dir_map) else {}
        resp["track_text_events"] = _build_track_text_events(
            resp,
            tracks,
            query_text,
            fps,
            video_path=video_path,
            camera_video_map=camera_video_map,
            camera_image_dir_map=camera_image_dir_map,
            track_camera_stats=track_camera_stats,
            camera_tracks_map=camera_tracks_map,
            dataset_hint=dataset_type,
            tracks_path=tracks_path,
            context=context,
        )
        if isinstance(resp.get("track_text_events"), list):
            resp["track_text_events"] = _rectify_track_text_events_interactions(resp.get("track_text_events"))
        vp_stats = _summarize_visual_prompt_stats(resp.get("track_text_events") if isinstance(resp.get("track_text_events"), list) else [])
        resp["track_text_generation_stats"] = {
            "visual_prompt": vp_stats,
            "camera_sources": len(camera_video_map),
            "camera_image_dirs": len(camera_image_dir_map),
            "camera_tracks": len(camera_tracks_map),
        }
        _legacy().logger.info(
            "track_text visual_prompt stats: events=%s camera_items=%s applied=%s has_boxes=%s reasons=%s",
            vp_stats.get("events"),
            vp_stats.get("camera_items"),
            vp_stats.get("visual_prompt_applied"),
            vp_stats.get("has_target_boxes"),
            vp_stats.get("reasons"),
        )

        exported_path = _export_track_text_events_json(
            resp=resp,
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            query_text=query_text,
            video_path=video_path,
            context=context,
        )
        if exported_path is not None:
            resp["track_text_events_json_path"] = str(exported_path)
            _legacy().logger.info("track_text events json exported: %s", exported_path)
        fusion_exported_path = _export_track_fusion_results_json(
            resp=resp,
            tracks_path=tracks_path,
            dataset_type=dataset_type,
            query_text=query_text,
            video_path=video_path,
            context=context,
        )
        if fusion_exported_path is not None:
            resp["track_fusion_results_json_path"] = str(fusion_exported_path)
            _legacy().logger.info("track fusion results json exported: %s", fusion_exported_path)
        resp["track_text_cache_hit"] = False
    except Exception as e:
        _legacy().logger.warning("failed to build track_text_events: %s", e)
        resp["track_text_events"] = []


def handle_query(payload: Dict[str, Any]) -> Dict[str, Any]:
    legacy = _legacy()
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

    unified_plan = legacy.generate_unified_plan(text, ctx)
    ctx_with_plan = dict(ctx)
    if unified_plan is not None:
        ctx_with_plan["qwenPlan"] = unified_plan

    resp = legacy.assemble_response(
        text,
        resolved_tracks,
        resolved_video,
        screenshot=screenshot,
        context=ctx_with_plan,
    )

    resp["qwenPlan"] = unified_plan or {}
    if resolved_video is not None and resolved_video.exists():
        iv_answer = legacy.run_internvideo_from_qwen_plan(
            text,
            resolved_video,
            unified_plan,
            tracks_path=resolved_tracks,
            context=ctx_with_plan,
        )
        if iv_answer:
            resp["internvideoAnswer"] = iv_answer
            resp["message"] = iv_answer

    dataset_type = str(ctx_with_plan.get("dataset_type") or ctx_with_plan.get("datasetType") or "")
    inferred_fps = derive_fps(resolved_video) if resolved_video is not None else _safe_float(ctx_with_plan.get("fps"), 10.0)
    _attach_track_text_events(
        resp,
        resolved_tracks,
        dataset_type,
        inferred_fps,
        text,
        video_path=resolved_video,
        context=ctx_with_plan,
    )

    return resp

def handle_analyze_video(payload: Dict[str, Any]) -> Dict[str, Any]:
    legacy = _legacy()
    text = payload.get("text", "")
    tracks_path = payload.get("tracksPath")
    video_path = payload.get("videoPath")
    if not tracks_path or not video_path:
        return {"message": "缺少视频或轨迹路径", "highlights": []}

    resolved_tracks = resolve_path(tracks_path)
    resolved_video = resolve_path(video_path)
    resp = legacy.assemble_response(
        text,
        resolved_tracks,
        resolved_video,
        context=payload.get("context") or {},
    )
    track_facts = resp.get("objectiveFacts") if isinstance(resp.get("objectiveFacts"), dict) else {"interactions": []}
    video_facts = legacy.extract_objective_facts_via_internvideo(text, resolved_video)
    merged_facts = legacy.merge_objective_facts(track_facts, video_facts)
    report = legacy.build_chinese_report_from_objective_facts(text, merged_facts)

    resp["objectiveFacts"] = merged_facts
    resp["message"] = "全视频分析完成: " + report
    inferred_fps = derive_fps(resolved_video)
    _attach_track_text_events(
        resp,
        resolved_tracks,
        str((payload.get("context") or {}).get("dataset_type") or ""),
        inferred_fps,
        text,
        video_path=resolved_video,
        context=payload.get("context") if isinstance(payload.get("context"), dict) else None,
    )
    return resp


def health_status() -> Dict[str, Any]:
    legacy = _legacy()
    qwen_loaded = legacy._qwen_model is not None and legacy._qwen_tokenizer is not None
    return {
        "status": "ok",
        "internvideo_loaded": legacy._model is not None and legacy._tokenizer is not None,
        "internvideo_path": str(legacy.MODEL_DIR),
        "qwen_loaded": qwen_loaded,
        "qwen_path": legacy.QWEN_MODEL_PATH,
    }


def list_scenes() -> Dict[str, Any]:
    legacy = _legacy()
    scenes = scan_all_scenes()
    return {
        "scenes": scenes,
        "total": len(scenes),
        "dataset_path": str(legacy.VIRAT_DATASET_DIR),
    }


def get_scene(scene_id: str) -> Dict[str, Any]:
    legacy = _legacy()
    scenes = scan_all_scenes()
    scene = next((s for s in scenes if s.get("scene_id") == scene_id), None)
    if not scene:
        return {"error": f"Scene {scene_id} not found", "scene_id": scene_id}

    tracks_path = resolve_path(scene["tracks_path"])
    object_stats: Dict[str, Any] = {"total_objects": 0, "object_types": {}, "frame_range": None}

    if tracks_path.exists():
        try:
            tracks, frame_range = parse_tracks(tracks_path, dataset_type=scene.get("dataset_type"))
            object_stats["total_objects"] = len(tracks)
            object_stats["frame_range"] = frame_range
            for track in tracks:
                cls_id = track.get("cls", 0)
                cls_name = VIRAT_CLASS_LABELS.get(cls_id, f"unknown_{cls_id}")
                object_stats["object_types"][cls_name] = object_stats["object_types"].get(cls_name, 0) + 1
        except Exception as e:
            legacy.logger.warning("Error parsing tracks for %s: %s", scene_id, e)

    scene = dict(scene)
    scene["object_stats"] = object_stats
    return scene


def analyze_scene(payload: Dict[str, Any]) -> Dict[str, Any]:
    legacy = _legacy()
    scene_id = payload.get("scene_id")
    text = payload.get("text", "")
    if not scene_id:
        return {"error": "scene_id is required", "message": "缺少场景ID"}

    scenes = scan_all_scenes()
    scene = next((s for s in scenes if s.get("scene_id") == scene_id), None)
    if not scene:
        return {"error": f"Scene {scene_id} not found", "message": f"场景 {scene_id} 不存在"}

    if scene.get("dataset_type") in {"virat", "meva"} and not scene.get("video_exists"):
        return {"error": f"Video file not found for scene {scene_id}", "message": f"场景 {scene_id} 的视频文件不存在"}
    if not scene.get("tracks_exists"):
        return {"error": f"Tracks file not found for scene {scene_id}", "message": f"场景 {scene_id} 的标注文件不存在"}

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

    resp = legacy.assemble_response(text, tracks_path, video_path, context=context)

    full_video_mode = bool(payload.get("full_video")) or not user_context
    if full_video_mode:
        track_facts = resp.get("objectiveFacts") if isinstance(resp.get("objectiveFacts"), dict) else {"interactions": []}
        is_video_file = video_path is not None and Path(video_path).suffix.lower() in VIDEO_EXTS
        video_facts = legacy.extract_objective_facts_via_internvideo(text, video_path) if is_video_file else {"interactions": []}
        merged_facts = legacy.merge_objective_facts(track_facts, video_facts)
        report = legacy.build_chinese_report_from_objective_facts(text, merged_facts)
        resp["objectiveFacts"] = merged_facts
        resp["message"] = report

    scene_fps = _safe_float(scene.get("fps"), 0.0)
    inferred_fps = scene_fps if scene_fps > 0 else derive_fps(video_path) if video_path is not None else 10.0
    _attach_track_text_events(
        resp,
        tracks_path,
        str(scene.get("dataset_type") or ""),
        inferred_fps,
        text,
        video_path=video_path,
        context=context,
    )

    resp["scene_id"] = scene_id
    resp["message"] = f"场景 {scene_id} 分析完成: " + resp.get("message", "")
    return resp
