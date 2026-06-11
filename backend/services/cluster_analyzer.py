from typing import Any, Dict, List, Optional, Tuple

from ..models.dataclasses import ClusterResult

try:
    import numpy as np
    from sklearn.cluster import DBSCAN
    from sklearn.preprocessing import StandardScaler
except Exception:  # pragma: no cover
    np = None
    DBSCAN = None
    StandardScaler = None


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
    _ = fps
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
    _ = (w_shape, w_behavior)
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
