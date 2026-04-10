import importlib
from pathlib import Path
from typing import Any, Dict

from ..dataset.scene_loader import scan_all_scenes
from ..utils.path_utils import resolve_path
from .track_processor import VIRAT_CLASS_LABELS, parse_tracks


VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


def _legacy():
    return importlib.import_module("vis.backend.agent_internvideo_server")


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

    if scene.get("dataset_type") == "virat" and not scene.get("video_exists"):
        return {"error": f"Video file not found for scene {scene_id}", "message": f"场景 {scene_id} 的视频文件不存在"}
    if not scene.get("tracks_exists"):
        return {"error": f"Tracks file not found for scene {scene_id}", "message": f"场景 {scene_id} 的标注文件不存在"}

    tracks_path = resolve_path(scene["tracks_path"])
    video_path = resolve_path(scene["video_path"]) if scene.get("video_path") else None

    user_context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    context = dict(user_context)
    context["dataset_type"] = scene.get("dataset_type")

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

    resp["scene_id"] = scene_id
    resp["message"] = f"场景 {scene_id} 分析完成: " + resp.get("message", "")
    return resp
