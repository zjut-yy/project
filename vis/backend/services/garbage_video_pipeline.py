from __future__ import annotations

import argparse
import base64
import json
import os
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont


DEFAULT_BASE_URL = "https://aihubmix.com/v1"
DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
DEFAULT_FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
)
GARBAGE_LABELS = ("塑料", "泡沫", "渔业用品", "金属", "玻璃", "木材", "其他")
LABEL_ALIASES = {
    "plastic": "塑料",
    "塑料": "塑料",
    "foam": "泡沫",
    "styrofoam": "泡沫",
    "expanded polystyrene": "泡沫",
    "泡沫": "泡沫",
    "泡沫塑料": "泡沫",
    "fishery supplies": "渔业用品",
    "fishery_supply": "渔业用品",
    "fishery equipment": "渔业用品",
    "fishing gear": "渔业用品",
    "fishing net": "渔业用品",
    "rope": "渔业用品",
    "net": "渔业用品",
    "渔业用品": "渔业用品",
    "渔具": "渔业用品",
    "渔网": "渔业用品",
    "metal": "金属",
    "金属": "金属",
    "glass": "玻璃",
    "玻璃": "玻璃",
    "wood": "木材",
    "timber": "木材",
    "木材": "木材",
    "木头": "木材",
    "other": "其他",
    "others": "其他",
    "unknown": "其他",
    "其他": "其他",
}
LABEL_COLORS = {
    "塑料": (53, 155, 255),
    "泡沫": (255, 191, 0),
    "渔业用品": (123, 104, 238),
    "金属": (192, 192, 192),
    "玻璃": (64, 224, 208),
    "木材": (205, 133, 63),
    "其他": (255, 99, 132),
}


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    bbox: Tuple[int, int, int, int]


class AIHubMixGarbageFrameDetector:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        max_side: int = 1280,
        jpeg_quality: int = 90,
        min_score: float = 0.25,
    ) -> None:
        if not api_key:
            raise ValueError("Missing AIhubmix API key. Set AIHUBMIX_API_KEY or pass --api-key.")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model
        self.max_side = max(256, int(max_side))
        self.jpeg_quality = max(50, min(100, int(jpeg_quality)))
        self.min_score = max(0.0, min(1.0, float(min_score)))

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        resized = self._resize_for_inference(frame_bgr)
        data_url = self._frame_to_data_url(resized)
        prompt = self._build_prompt()
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            max_tokens=900,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
        )
        text = self._extract_response_text(response)
        payload = self._parse_json_payload(text)
        return self._normalize_detections(payload)

    def _resize_for_inference(self, frame_bgr: np.ndarray) -> np.ndarray:
        height, width = frame_bgr.shape[:2]
        longest = max(height, width)
        if longest <= self.max_side:
            return frame_bgr
        scale = self.max_side / float(longest)
        resized = cv2.resize(
            frame_bgr,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
            interpolation=cv2.INTER_AREA,
        )
        return resized

    def _frame_to_data_url(self, frame_bgr: np.ndarray) -> str:
        ok, encoded = cv2.imencode(
            ".jpg",
            frame_bgr,
            [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality],
        )
        if not ok:
            raise RuntimeError("Failed to encode frame to JPEG.")
        image_base64 = base64.b64encode(encoded.tobytes()).decode("utf-8")
        return f"data:image/jpeg;base64,{image_base64}"

    def _build_prompt(self) -> str:
        labels = json.dumps(list(GARBAGE_LABELS), ensure_ascii=False)
        return (
            "你是无人机视角垃圾检测器。请检测图中所有清晰可见的垃圾目标，只关注垃圾本体。"
            "不要检测人、船、车辆、建筑、海浪、阴影、反光、水面纹理或自然背景。"
            "\n"
            f"类别只能从以下 7 类中选择：{labels}。"
            "如果不确定具体类别，也只能归到‘其他’。"
            "\n"
            "返回纯 JSON，不要 markdown，不要额外解释。"
            "如果没有检测到垃圾，返回 {\"objects\": []}。"
            "\n"
            "JSON 格式固定为："
            "\n"
            "{"
            "\n  \"objects\": ["
            "\n    {"
            "\n      \"label\": \"塑料\","
            "\n      \"score\": 0.93,"
            "\n      \"bbox\": [120, 85, 420, 360]"
            "\n    }"
            "\n  ]"
            "\n}"
            "\n"
            "其中 bbox 必须是 [x1, y1, x2, y2]，使用 0-1000 归一化坐标整数。"
        )

    def _extract_response_text(self, response: Any) -> str:
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise RuntimeError("Model response did not contain choices.")
        message = getattr(choices[0], "message", None)
        if message is None:
            raise RuntimeError("Model response did not contain a message.")

        content = getattr(message, "content", None)
        text = self._content_to_text(content)
        if text:
            return text

        multi_mod_content = getattr(message, "multi_mod_content", None)
        text = self._content_to_text(multi_mod_content)
        if text:
            return text

        raise RuntimeError("Model response did not contain text content.")

    def _content_to_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if not isinstance(content, Sequence) or isinstance(content, (bytes, bytearray, str)):
            return ""
        parts: List[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue
            if isinstance(part, dict):
                part_text = part.get("text")
                if isinstance(part_text, str) and part_text.strip():
                    parts.append(part_text.strip())
                continue
            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text.strip():
                parts.append(part_text.strip())
        return "\n".join(parts).strip()

    def _parse_json_payload(self, raw_text: str) -> Dict[str, Any]:
        text = raw_text.strip()
        fence_match = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", text, flags=re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()
        try:
            payload = json.loads(text)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            snippet = text[start : end + 1]
            payload = json.loads(snippet)
            if isinstance(payload, dict):
                return payload

        raise RuntimeError(f"Failed to parse JSON from model response: {raw_text}")

    def _normalize_detections(self, payload: Dict[str, Any]) -> List[Detection]:
        raw_objects = payload.get("objects")
        if not isinstance(raw_objects, list):
            return []

        detections: List[Detection] = []
        for item in raw_objects:
            if not isinstance(item, dict):
                continue
            label = self._normalize_label(item.get("label") or item.get("category") or item.get("class"))
            if not label:
                continue
            score = self._normalize_score(item.get("score", item.get("confidence", 0.0)))
            if score < self.min_score:
                continue
            bbox = self._normalize_bbox(item)
            if bbox is None:
                continue
            detections.append(Detection(label=label, score=score, bbox=bbox))
        return detections

    def _normalize_label(self, raw_label: Any) -> Optional[str]:
        text = str(raw_label or "").strip()
        if not text:
            return None
        lowered = text.lower()
        if lowered in LABEL_ALIASES:
            return LABEL_ALIASES[lowered]
        if text in LABEL_ALIASES:
            return LABEL_ALIASES[text]
        for alias, canonical in LABEL_ALIASES.items():
            if alias and alias in lowered:
                return canonical
        for label in GARBAGE_LABELS:
            if label in text:
                return label
        return None

    def _normalize_score(self, raw_score: Any) -> float:
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            return 0.0
        if score > 1.0 and score <= 100.0:
            score = score / 100.0
        return max(0.0, min(1.0, score))

    def _normalize_bbox(self, item: Dict[str, Any]) -> Optional[Tuple[int, int, int, int]]:
        raw_bbox = item.get("bbox")
        if not isinstance(raw_bbox, list):
            raw_bbox = [item.get("x1"), item.get("y1"), item.get("x2"), item.get("y2")]
        if len(raw_bbox) != 4:
            return None

        try:
            coords = [float(v) for v in raw_bbox]
        except (TypeError, ValueError):
            return None

        scale = 1000.0 if max(abs(v) for v in coords) <= 1.5 else 1.0
        x1, y1, x2, y2 = [int(round(v * scale)) for v in coords]
        x1, x2 = sorted((max(0, min(1000, x1)), max(0, min(1000, x2))))
        y1, y2 = sorted((max(0, min(1000, y1)), max(0, min(1000, y2))))
        if x2 <= x1 or y2 <= y1:
            return None
        return (x1, y1, x2, y2)


class VideoAnnotationRenderer:
    def __init__(self, font_candidates: Iterable[str] = DEFAULT_FONT_CANDIDATES) -> None:
        self.font_candidates = tuple(font_candidates)
        self._font_cache: Dict[int, ImageFont.ImageFont] = {}

    def draw(self, frame_bgr: np.ndarray, detections: Sequence[Detection]) -> np.ndarray:
        if not detections:
            return frame_bgr

        image = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(image)
        width, height = image.size
        line_width = max(2, int(round(min(width, height) * 0.004)))
        font = self._load_font(max(18, int(round(min(width, height) * 0.028))))

        for detection in detections:
            x1, y1, x2, y2 = self._scale_bbox(detection.bbox, width, height)
            color = LABEL_COLORS.get(detection.label, LABEL_COLORS["其他"])
            draw.rectangle((x1, y1, x2, y2), outline=color, width=line_width)

            text = f"{detection.label} {detection.score:.2f}"
            text_box = draw.textbbox((0, 0), text, font=font)
            text_width = text_box[2] - text_box[0]
            text_height = text_box[3] - text_box[1]
            bg_left = x1
            bg_top = max(0, y1 - text_height - 10)
            bg_right = min(width, bg_left + text_width + 14)
            bg_bottom = min(height, bg_top + text_height + 10)
            draw.rectangle((bg_left, bg_top, bg_right, bg_bottom), fill=color)
            draw.text((bg_left + 7, bg_top + 4), text, font=font, fill=(0, 0, 0))

        annotated = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
        return annotated

    def _scale_bbox(self, bbox: Tuple[int, int, int, int], width: int, height: int) -> Tuple[int, int, int, int]:
        x1, y1, x2, y2 = bbox
        px1 = max(0, min(width - 1, int(round(x1 * width / 1000.0))))
        py1 = max(0, min(height - 1, int(round(y1 * height / 1000.0))))
        px2 = max(0, min(width - 1, int(round(x2 * width / 1000.0))))
        py2 = max(0, min(height - 1, int(round(y2 * height / 1000.0))))
        return px1, py1, px2, py2

    def _load_font(self, size: int) -> ImageFont.ImageFont:
        if size in self._font_cache:
            return self._font_cache[size]
        for font_path in self.font_candidates:
            if Path(font_path).exists():
                font = ImageFont.truetype(font_path, size=size)
                self._font_cache[size] = font
                return font
        font = ImageFont.load_default()
        self._font_cache[size] = font
        return font


class GarbageVideoPipeline:
    def __init__(
        self,
        detector: AIHubMixGarbageFrameDetector,
        *,
        renderer: Optional[VideoAnnotationRenderer] = None,
        sample_fps: float = 2.0,
        draw_skipped_frames: bool = True,
    ) -> None:
        self.detector = detector
        self.renderer = renderer or VideoAnnotationRenderer()
        self.sample_fps = float(sample_fps)
        self.draw_skipped_frames = draw_skipped_frames

    def process_video(
        self,
        input_video_path: str | Path,
        output_video_path: str | Path,
        *,
        sidecar_json_path: Optional[str | Path] = None,
        max_frames: Optional[int] = None,
    ) -> Dict[str, Any]:
        input_path = Path(input_video_path).expanduser().resolve()
        output_path = Path(output_video_path).expanduser().resolve()
        if not input_path.exists():
            raise FileNotFoundError(f"Input video not found: {input_path}")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if sidecar_json_path is None:
            sidecar_path = output_path.with_suffix(output_path.suffix + ".detections.json")
        else:
            sidecar_path = Path(sidecar_json_path).expanduser().resolve()
            sidecar_path.parent.mkdir(parents=True, exist_ok=True)

        capture = cv2.VideoCapture(str(input_path))
        if not capture.isOpened():
            raise RuntimeError(f"Failed to open video: {input_path}")

        native_fps = capture.get(cv2.CAP_PROP_FPS) or 0.0
        frame_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        frame_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if native_fps <= 0:
            native_fps = 25.0
        if frame_width <= 0 or frame_height <= 0:
            capture.release()
            raise RuntimeError(f"Failed to read video metadata: {input_path}")

        writer = cv2.VideoWriter(
            str(output_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            native_fps,
            (frame_width, frame_height),
        )
        if not writer.isOpened():
            capture.release()
            raise RuntimeError(f"Failed to create output video: {output_path}")

        frame_stride = self._compute_frame_stride(native_fps, self.sample_fps)
        analyzed_frames = 0
        written_frames = 0
        frame_index = 0
        last_detections: List[Detection] = []
        sampled_frames: List[Dict[str, Any]] = []

        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if max_frames is not None and frame_index >= max_frames:
                    break

                should_analyze = frame_index == 0 or frame_stride == 1 or frame_index % frame_stride == 0
                if should_analyze:
                    last_detections = self.detector.detect(frame)
                    analyzed_frames += 1
                    sampled_frames.append(
                        {
                            "frame_index": frame_index,
                            "timestamp_sec": round(frame_index / native_fps, 3),
                            "objects": [
                                {
                                    "label": det.label,
                                    "score": round(det.score, 4),
                                    "bbox": list(det.bbox),
                                }
                                for det in last_detections
                            ],
                        }
                    )

                detections_to_draw = last_detections if self.draw_skipped_frames else (last_detections if should_analyze else [])
                annotated_frame = self.renderer.draw(frame, detections_to_draw)
                writer.write(annotated_frame)

                frame_index += 1
                written_frames += 1
                if should_analyze and analyzed_frames % 10 == 0:
                    print(
                        f"Processed {written_frames} / {total_frames or '?'} frames, "
                        f"analyzed {analyzed_frames} frames..."
                    )
        finally:
            capture.release()
            writer.release()

        sidecar_payload = {
            "input_video_path": str(input_path),
            "output_video_path": str(output_path),
            "model": self.detector.model,
            "labels": list(GARBAGE_LABELS),
            "native_fps": native_fps,
            "sample_fps": self.sample_fps,
            "frame_stride": frame_stride,
            "total_frames_in_source": total_frames,
            "written_frames": written_frames,
            "analyzed_frames": analyzed_frames,
            "draw_skipped_frames": self.draw_skipped_frames,
            "frames": sampled_frames,
        }
        sidecar_path.write_text(json.dumps(sidecar_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return sidecar_payload

    def _compute_frame_stride(self, native_fps: float, sample_fps: float) -> int:
        if sample_fps <= 0 or sample_fps >= native_fps:
            return 1
        return max(1, int(round(native_fps / sample_fps)))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect garbage in a video with AIhubmix and render labels back into an output video.")
    parser.add_argument("--input-video", required=True, help="Path to the input video.")
    parser.add_argument("--output-video", required=True, help="Path to the rendered output video.")
    parser.add_argument("--sidecar-json", default=None, help="Optional JSON path for sampled frame detections.")
    parser.add_argument("--api-key", default=os.environ.get("AIHUBMIX_API_KEY") or os.environ.get("OPENAI_API_KEY"), help="AIhubmix API key. Defaults to AIHUBMIX_API_KEY.")
    parser.add_argument("--base-url", default=os.environ.get("AIHUBMIX_BASE_URL", DEFAULT_BASE_URL), help="AIhubmix-compatible OpenAI base URL.")
    parser.add_argument("--model", default=os.environ.get("AIHUBMIX_MODEL", DEFAULT_MODEL), help="Vision model name.")
    parser.add_argument("--sample-fps", type=float, default=2.0, help="How many frames per second to send to the model. Use 0 or a value >= source fps to analyze every frame.")
    parser.add_argument("--max-frames", type=int, default=None, help="Optional frame limit for quick testing.")
    parser.add_argument("--max-side", type=int, default=1280, help="Resize longer image side before API upload.")
    parser.add_argument("--jpeg-quality", type=int, default=90, help="JPEG quality used for uploaded frames.")
    parser.add_argument("--min-score", type=float, default=0.25, help="Minimum confidence required to render a detection.")
    parser.add_argument("--no-hold-last-detections", action="store_true", help="Only draw boxes on analyzed frames instead of carrying them across skipped frames.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    detector = AIHubMixGarbageFrameDetector(
        api_key=args.api_key,
        base_url=args.base_url,
        model=args.model,
        max_side=args.max_side,
        jpeg_quality=args.jpeg_quality,
        min_score=args.min_score,
    )
    pipeline = GarbageVideoPipeline(
        detector,
        sample_fps=args.sample_fps,
        draw_skipped_frames=not args.no_hold_last_detections,
    )
    summary = pipeline.process_video(
        args.input_video,
        args.output_video,
        sidecar_json_path=args.sidecar_json,
        max_frames=args.max_frames,
    )
    print(json.dumps({
        "output_video_path": summary["output_video_path"],
        "sidecar_json_path": args.sidecar_json or str(Path(summary["output_video_path"]).with_suffix(Path(summary["output_video_path"]).suffix + ".detections.json")),
        "analyzed_frames": summary["analyzed_frames"],
        "written_frames": summary["written_frames"],
        "frame_stride": summary["frame_stride"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

# Example:
#   export AIHUBMIX_API_KEY="your-new-key"
#   python backend/services/garbage_video_pipeline.py \
#     --input-video /path/to/input.mp4 \
#     --output-video /path/to/output_annotated.mp4 \
#     --sample-fps 2
