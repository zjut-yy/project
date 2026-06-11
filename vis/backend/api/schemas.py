from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    text: str = ""
    context: Dict[str, Any] = Field(default_factory=dict)
    tracksPath: Optional[str] = None
    videoPath: Optional[str] = None
    screenshot: Optional[str] = None


class AnalyzeVideoRequest(BaseModel):
    text: str = ""
    tracksPath: Optional[str] = None
    videoPath: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)


class AnalyzeSceneRequest(BaseModel):
    scene_id: str
    text: str = ""
    context: Dict[str, Any] = Field(default_factory=dict)
    full_video: bool = False


class TrackTextEvent(BaseModel):
    track_id: int
    class_label: str = "目标"
    frame_start: int
    frame_end: int
    t_start: float
    t_end: float
    summary: str
    overall_summary: Optional[str] = None
    self_action: Optional[str] = None
    interactions: list[Dict[str, Any]] = Field(default_factory=list)
    interaction_class: Optional[str] = None
    interaction_frame: Optional[int] = None
    interaction_frame_source: Optional[str] = None
    interaction_detail: Optional[str] = None
    interaction_events: list[Dict[str, Any]] = Field(default_factory=list)
    interaction_events_dropped: Optional[int] = None
    description_source: str = "rule_fallback"
    description_camera_id: Optional[str] = None
    description_video_path: Optional[str] = None
    multi_camera_descriptions: list[Dict[str, Any]] = Field(default_factory=list)
    fusion_mode: Optional[str] = None
    fusion_summary: Optional[str] = None
    fusion_confidence: Optional[float] = None
    confidence: float = 0.7
    evidence_frames: list[int] = Field(default_factory=list)
