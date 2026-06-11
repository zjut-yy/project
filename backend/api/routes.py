from typing import Any, Dict

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..services.query_service import (
    analyze_scene,
    get_scene,
    handle_analyze_video,
    handle_query,
    health_status,
    list_scenes,
)
from .schemas import AnalyzeSceneRequest, AnalyzeVideoRequest, QueryRequest


router = APIRouter()


@router.post("/query")
async def query(payload: QueryRequest) -> Dict[str, Any]:
    return handle_query(payload.model_dump(exclude_none=True))


@router.post("/analyze_video")
async def analyze_video(payload: AnalyzeVideoRequest) -> Dict[str, Any]:
    return handle_analyze_video(payload.model_dump(exclude_none=True))


@router.get("/health")
async def health() -> Dict[str, Any]:
    return health_status()


@router.get("/virat/scenes")
async def list_virat_scenes() -> Dict[str, Any]:
    return list_scenes()


@router.get("/virat/scenes/{scene_id}")
async def get_virat_scene(scene_id: str) -> Dict[str, Any]:
    return get_scene(scene_id)


@router.post("/virat/analyze")
async def analyze_virat_scene(payload: AnalyzeSceneRequest) -> Dict[str, Any]:
    return analyze_scene(payload.model_dump(exclude_none=True))


def create_app() -> FastAPI:
    app = FastAPI(title="Agent InternVideo API", version="2.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app
