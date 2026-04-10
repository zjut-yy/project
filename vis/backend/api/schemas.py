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
