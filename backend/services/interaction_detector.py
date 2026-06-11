import math
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple

from .track_processor import PERSON_CLASSES, VEHICLE_CLASSES


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
    subject_classes: Optional[Set[int]] = None,
    partner_classes: Optional[Set[int]] = None,
    event_labels: Optional[Dict[Tuple[int, int], str]] = None,
    event_scores: Optional[Dict[Tuple[int, int], Any]] = None,
    max_events: int = 5,
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

        for p in t.get("points", []):
            if is_subject:
                frames[p["frame"]]["subjects"].append((t["id"], p))
            if is_partner:
                frames[p["frame"]]["partners"].append((t["id"], p))

    interaction_frames: Dict[int, List[int]] = defaultdict(list)
    partners_map: Dict[int, Set[int]] = defaultdict(set)

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
    highlights = set()
    min_f, _ = frame_range

    def collapse_frames(frames_list: List[int]) -> List[Tuple[int, int]]:
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
        segs = collapse_frames(frames_list)
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
            events.append(
                {
                    "person_id": pid,
                    "partner_id": oid,
                    "start_frame": seg[0],
                    "end_frame": seg[1],
                    "event": label or "交互",
                    "score": score,
                }
            )

    if max_events and len(events) > max_events:
        events = sorted(events, key=lambda e: (e.get("start_frame", 0), e.get("end_frame", 0)))[:max_events]

    return {
        "highlights": sorted(list(highlights)),
        "segments": segments,
        "partners": {pid: sorted(list(vs)) for pid, vs in partners_map.items()},
        "timeSecRange": [round(start_sec, 2), round(end_sec, 2)] if segments else None,
        "events": events,
        "pairSegments": {f"{pid}-{oid}": segs for (pid, oid), segs in pair_segments.items()},
    }
