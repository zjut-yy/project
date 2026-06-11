    const deckNS = window.deck || window.deckgl;
      if (!deckNS) {
        throw new Error('deck.gl 全局对象未找到，请检查 CDN 是否可访问');
      }
      const {DeckGL, OrbitView, OrbitController, COORDINATE_SYSTEM, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer, IconLayer, AmbientLight, LightingEffect} = deckNS;
    // 使用站点根路径，便于 http-server 从仓库根目录提供静态文件
    let DATA_FILE = '/backend/dataset/VIRAT/VIRAT_S_000102.viratdata.objects.txt';
    let WORLD_DATA_FILE = null;
    let VIDEO_SRC = '/backend/dataset/VIRAT/VIRAT_S_000102.mp4';
    const VIDEO_FPS_HINT = 30; // fallback
    let ACTIVE_FPS = VIDEO_FPS_HINT;
    let currentScene = null;
    let availableScenes = [];
    const colors = ['#1dbab4','#5a9bff','#ff8e5a','#c4ff61','#f9418f','#4ee7ff','#e1b7ff','#ffd166','#52ffa8','#ff6b6b','#9ad6ff','#7af0ff','#ffb3d1','#b6ff7e'];
    // VIRAT官方类别定义
    const classLabels = new Map([
      [0, 'Background (背景)'],
      [1, 'Person (人)'],
      [2, 'Car (小汽车)'],
      [3, 'Vehicle (其他车辆)'],
      [4, 'Object (物体)'],
      [5, 'Bike/Motorcycle (自行车/摩托车)'],
    ]);
    // 所有VIRAT类别（固定列表，无论场景中是否存在）
    const ALL_VIRAT_CLASSES = [0, 1, 2, 3, 4, 5];
    const classIcons = new Map([
      [0, 'BG'],
      [1, 'P'],
      [2, 'C'],
      [3, 'V'],
      [4, 'O'],
      [5, 'B'],
    ]);

    const statusEl = document.getElementById('status');
    const statSummary = document.getElementById('statSummary');
    const statLegend = document.getElementById('statLegend');
    const interactionTimelineEl = document.getElementById('interactionTimeline');
    const statFrames = document.getElementById('statFrames');
    const statTracks = document.getElementById('statTracks');
    const statShown = document.getElementById('statShown');
    const statLines = document.getElementById('statLines');
    const statCoverageText = document.getElementById('statCoverageText');
    const statCoverageBar = document.getElementById('statCoverageBar');
    const classSparklineEl = document.getElementById('classSparkline');
    const timeSlider = document.getElementById('timeSlider');
    const timeLabel = document.getElementById('timeLabel');
    const timeValue = document.getElementById('timeValue');
    const frameDistSummaryEl = document.getElementById('frameDistSummary');
    const frameXYCanvasEl = document.getElementById('frameXYCanvas');
    const frameDistLegendEl = document.getElementById('frameDistLegend');
    const semanticOverlayEl = document.getElementById('semanticOverlay');
    const storylineOverviewPanelEl = document.getElementById('storylineOverviewPanel');
    const storylineOverviewMetaEl = document.getElementById('storylineOverviewMeta');
    const storylineOverviewAxisEl = document.getElementById('storylineOverviewAxis');
    const storylineOverviewRowsEl = document.getElementById('storylineOverviewRows');
    const semanticLayoutSelect = document.getElementById('semanticLayoutMode');
    const classFiltersEl = document.getElementById('classFilters');
    const modelFiltersEl = document.getElementById('modelFilters');
    const modelOnlyCheckbox = document.getElementById('modelOnly');
    const btnClassAll = document.getElementById('btnClassAll');
    const btnClassNone = document.getElementById('btnClassNone');
    const temporalWindowSliderEl = document.getElementById('timeWindowSec');
    const temporalWindowValEl = document.getElementById('timeWindowSecVal');
    const temporalWeightSliderEl = document.getElementById('timeWeight');
    const temporalWeightValEl = document.getElementById('timeWeightVal');
    const temporalWindowCheckboxEl = document.getElementById('useTemporalWindow');
    const boxSelectEnabledEl = document.getElementById('boxSelectEnabled');
    const btnClearBoxSelect = document.getElementById('btnClearBoxSelect');
    const boxSelectStatusEl = document.getElementById('boxSelectStatus');
    const boxSelectOverlayEl = document.getElementById('boxSelectOverlay');
    const multiVideoRail = document.getElementById('multiVideoRail');
    const multiVideoTrack = document.getElementById('multiVideoTrack');
    const btnRailPlayAll = document.getElementById('btnRailPlayAll');
    const btnRailPauseAll = document.getElementById('btnRailPauseAll');
    const btnRailSync = document.getElementById('btnRailSync');
    const chatMessagesEl = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const btnSendAgent = document.getElementById('btnSendAgent');
    const btnSaveDraft = document.getElementById('btnSaveDraft');
    const agentStatus = document.getElementById('agentStatus');
    const chkScreenshot = document.getElementById('chkScreenshot');
    const trackTextPanelEl = document.getElementById('trackTextPanel');
    const sceneSelect = document.getElementById('sceneSelect');
    const sceneInfo = document.getElementById('sceneInfo');
    const PAGE_HOST = window.location.hostname || '127.0.0.1';
    const DEFAULT_AGENT_BASE = `${window.location.protocol}//${PAGE_HOST}:8010`;
    function normalizeAgentBase(rawBase) {
      if (!rawBase || !String(rawBase).trim()) return DEFAULT_AGENT_BASE;
      try {
        const u = new URL(String(rawBase).trim());
        const isLocalHost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
        const pageIsLocalHost = PAGE_HOST === 'localhost' || PAGE_HOST === '127.0.0.1';
        if (isLocalHost && pageIsLocalHost) {
          u.hostname = PAGE_HOST;
        }
        return u.origin;
      } catch (_) {
        return DEFAULT_AGENT_BASE;
      }
    }
    const AGENT_BASE = normalizeAgentBase(localStorage.getItem('agentBase'));
    localStorage.setItem('agentBase', AGENT_BASE);
    const AGENT_ENDPOINT = `${AGENT_BASE}/query`;
    const AGENT_ANALYZE_ENDPOINT = `${AGENT_BASE}/analyze_video`;
    const VIRAT_SCENES_ENDPOINT = `${AGENT_BASE}/virat/scenes`;
    const VIRAT_ANALYZE_ENDPOINT = `${AGENT_BASE}/virat/analyze`;
    const WORLD_COORDS_BASE = '/backend/dataset/WildTrack/world_coords';
    const WORLD_FUSED_FILE = `${WORLD_COORDS_BASE}/wildtrack_7cams_world.csv`;
    const RAIL_FRAME_EXTS = ['jpg', 'png', 'jpeg'];
    const RAIL_FRAME_PADS = [8, 6, 5];

    let deckgl = null;
    let currentOrbitZoom = -0.25;
    let cachedTracks = [];
    let filteredTracks = [];
    let frameRange = { min: null, max: null };
    let availableClasses = []; // 当前场景中实际存在的类别
    let selectedClasses = new Set(); // 用户选中的类别
    let currentSec = 0;
    let maxSec = 1;
    let spatialOffset = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let videoEl = null;
    let frameTexture = null;
    let lastFrameTextureFrame = null;
    const FRAME_SAMPLE = 200; // 降低采样减少拖动时视频解码压力
    const SEEK_THROTTLE_MS = 120;
    const TIME_STRETCH = 30; // 拉长时间轴比例，贴近旧版效果
      const ANNOTATED_FRAME_STEP = 5;
    // 速度语义阈值（单位：px/s）
    const SPEED_STOP_MAX = 2.0;
    const SPEED_WALK_REF = 18.0;
    const SPEED_RUN_REF = 45.0;
    const SPEED_COLOR_GRAY = [148, 156, 166];
    const SPEED_COLOR_GREEN = [52, 210, 116];
    const SPEED_COLOR_RED = [232, 74, 74];
    let totalLines = 0;
    let highlightTrackIds = new Set();
    let hiddenTrackIds = new Set();
    let baseHighlightTrackIds = new Set();
    let baseHiddenTrackIds = new Set();
    let modelResults = [];
    let modelVisible = new Set();
    const modelHighlightMap = new Map();
    const modelColorMap = new Map();
    let modelFilterOnly = false;
    const FUSED_WILDTACK_SCENE_ID = 'wildtrack_fused_7cams';
    let fusedCameraSourceScenes = [];
    let railFrameEls = [];
    let railVideoTiles = [];
    let railFramePlayTimer = null;
    let railFrameCursor = null;
    let opacityTracks = 0.25;
    let opacityVideo = 1.0;
    const trackColorMap = new Map();
    const clusterTrackMap = new Map();
    const clusterColorMap = new Map();
    const interactionClusterMap = new Map();
    const vizTrackClusterMap = new Map();
    const vizClusterColorMap = new Map();
    let vizClusterRepresentatives = [];
    let vizClusterThreshold = 0.0;
    let temporalWindowSec = 20;
    let temporalWeight = 0.35;
    let useTemporalWindow = true;
    let clusterFocusTimeRange = null;
    let showClusterCenter = false;
    let anomalyTrackIds = new Set();
    let agentSummaryOverlay = { enabled: false, timeSecRange: null, highlightIds: new Set() };
    let hasAgentInteraction = false;
    let trackTextEvents = [];
    let activeTrackTextEventKey = null;
    let boxSelectEnabled = false;
    let boxSelectionActive = false;
    let boxSelectDraft = null;
    let boxSelectedTrackIds = new Set();
    let dimmedTrackIds = new Set();
    let boxSelectedEventKeys = new Set();
    let boxSelectedTimeRange = null;
    const SEMANTIC_LAYOUTS = {
      AGENT_ADAPTIVE_COLOR: 'agent_adaptive_color',
      INLINE_STC: 'inline_stc',
      BOUNDARY_RING: 'boundary_ring',
      STORYLINE_GLOBAL: 'storyline_global',
      BOUNDARY_V1: 'boundary_v1',
    };
    function normalizeSemanticLayoutMode(raw) {
      const mode = String(raw || '').trim().toLowerCase();
      if (mode === SEMANTIC_LAYOUTS.AGENT_ADAPTIVE_COLOR) return mode;
      if (mode === SEMANTIC_LAYOUTS.INLINE_STC) return mode;
      if (mode === SEMANTIC_LAYOUTS.BOUNDARY_RING || mode === SEMANTIC_LAYOUTS.STORYLINE_GLOBAL) return mode;
      if (mode === SEMANTIC_LAYOUTS.BOUNDARY_V1) return SEMANTIC_LAYOUTS.BOUNDARY_RING;
      return SEMANTIC_LAYOUTS.BOUNDARY_RING;
    }
    let semanticLayoutMode = normalizeSemanticLayoutMode((() => {
      try {
        return localStorage.getItem('semanticLayoutMode');
      } catch (_) {
        return null;
      }
    })());
    let latestSemanticOverlayCache = { ribbons: [], connectors: [], labels: [], boundary_items: [] };
    const chatMessages = [];

    function getSemanticLabelZoomScale() {
      const z = Number.isFinite(currentOrbitZoom) ? currentOrbitZoom : -0.25;
      // Keep default visual size at initial zoom -0.25, enlarge on zoom-in, shrink on zoom-out.
      return Math.max(0.7, Math.min(2.4, Math.pow(2, z + 0.25)));
    }

    function setStatus(text, isError=false) {
      statusEl.textContent = text;
      statusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }

    function setAgentStatus(text, isError=false) {
      if (!agentStatus) return;
      agentStatus.textContent = text;
      agentStatus.style.color = isError ? 'var(--danger)' : 'var(--muted)';
    }


    function updateBoxSelectStatus() {
      if (!boxSelectStatusEl) return;
      if (!boxSelectEnabled) {
        boxSelectStatusEl.textContent = '框选关闭';
        return;
      }
      const trackCount = boxSelectedTrackIds.size;
      const eventCount = boxSelectedEventKeys.size;
      if (!boxSelectionActive) {
        boxSelectStatusEl.textContent = '框选已开启：在时空立方体上拖拽矩形以选择轨迹';
        return;
      }
      boxSelectStatusEl.textContent = `框选完成：已选 ${trackCount} 条轨迹，关联 ${eventCount} 条事件`;
    }

    function renderBoxSelectOverlay() {
      if (!boxSelectOverlayEl) return;
      boxSelectOverlayEl.classList.toggle('is-enabled', !!boxSelectEnabled);
      if (!boxSelectEnabled || !boxSelectDraft) {
        boxSelectOverlayEl.innerHTML = '';
        return;
      }
      const x0 = Math.min(boxSelectDraft.startX, boxSelectDraft.endX);
      const y0 = Math.min(boxSelectDraft.startY, boxSelectDraft.endY);
      const x1 = Math.max(boxSelectDraft.startX, boxSelectDraft.endX);
      const y1 = Math.max(boxSelectDraft.startY, boxSelectDraft.endY);
      boxSelectOverlayEl.innerHTML = `<div class="box-select-rect" style="left:${x0}px; top:${y0}px; width:${Math.max(1, x1 - x0)}px; height:${Math.max(1, y1 - y0)}px;"></div>`;
    }

    function clearBoxSelection({ keepMode = false, restoreActive = false } = {}) {
      boxSelectionActive = false;
      boxSelectDraft = null;
      boxSelectedTrackIds = new Set();
      dimmedTrackIds = new Set();
      boxSelectedEventKeys = new Set();
      boxSelectedTimeRange = null;
      if (!keepMode) boxSelectEnabled = false;
      if (boxSelectEnabledEl) boxSelectEnabledEl.checked = !!boxSelectEnabled;
      renderBoxSelectOverlay();
      updateBoxSelectStatus();
      clusterFocusTimeRange = null;
      setAgentSummaryOverlay(null, []);
      updateHighlightTrackIdsFromModel();
      updateHiddenTrackIdsFromModelFilter();
      if (restoreActive && activeTrackTextEventKey) {
        focusTrackTextEvent(activeTrackTextEventKey);
      }
    }

    function getVisibleTrackTextEvents() {
      if (!Array.isArray(trackTextEvents)) return [];
      if (!boxSelectionActive || !boxSelectedTrackIds.size) return trackTextEvents;
      return trackTextEvents.filter((ev) => boxSelectedTrackIds.has(Number(ev && ev.track_id)));
    }

    function getOverlayEventsForCurrentSelection() {
      const visibleEvents = getVisibleTrackTextEvents();
      if (!Array.isArray(visibleEvents) || !visibleEvents.length) return [];
      if (boxSelectionActive) return visibleEvents;
      return visibleEvents;
    }

    function getInteractionFocusEventsForCurrentSelection() {
      const visibleEvents = getVisibleTrackTextEvents();
      if (!Array.isArray(visibleEvents) || !visibleEvents.length) return [];
      if (boxSelectionActive && activeTrackTextEventKey) {
        return visibleEvents.filter((ev) => ev && ev.key === activeTrackTextEventKey);
      }
      return visibleEvents;
    }


    function setAgentSummaryOverlay(timeSecRange, highlightIds) {
      const ids = new Set((Array.isArray(highlightIds) ? highlightIds : []).map(Number).filter(Number.isFinite));
      let range = null;
      if (Array.isArray(timeSecRange) && timeSecRange.length === 2) {
        const t0 = Number(timeSecRange[0]);
        const t1 = Number(timeSecRange[1]);
        if (Number.isFinite(t0) && Number.isFinite(t1)) {
          range = [Math.max(0, Math.min(t0, t1)), Math.max(0, Math.max(t0, t1))];
        }
      }
      agentSummaryOverlay = {
        enabled: ids.size > 0 || !!range,
        timeSecRange: range,
        highlightIds: ids,
      };
    }
    function getTrackPointAtSec(track, sec) {
      if (!track || !Array.isArray(track.points) || !track.points.length) return null;
      const targetFrame = (frameRange.min || 0) + sec * ACTIVE_FPS;
      const pts = track.points;
      if (pts.length === 1) return pts[0];
      if (targetFrame <= pts[0].frame) return pts[0];
      if (targetFrame >= pts[pts.length - 1].frame) return pts[pts.length - 1];
      for (let i = 1; i < pts.length; i += 1) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        if (targetFrame <= p1.frame) {
          const denom = Math.max(1e-6, p1.frame - p0.frame);
          const t = (targetFrame - p0.frame) / denom;
          return {
            frame: targetFrame,
            x: p0.x + (p1.x - p0.x) * t,
            y: p0.y + (p1.y - p0.y) * t,
            w: p0.w || p1.w || 0,
            h: p0.h || p1.h || 0,
          };
        }
      }
      return pts[pts.length - 1];
    }

    function getTrackSpeedPxPerSecAtSec(track, sec) {
      if (!track || !Array.isArray(track.points) || track.points.length < 2) return 0;
      const pts = track.points;
      const safeFps = Math.max(1e-6, ACTIVE_FPS);
      const minSec = Math.max(0, (Number(pts[0].frame) - (frameRange.min || 0)) / safeFps);
      const maxSec = Math.max(minSec, (Number(pts[pts.length - 1].frame) - (frameRange.min || 0)) / safeFps);
      const curSec = Math.max(minSec, Math.min(maxSec, Number(sec) || 0));
      const targetFrame = (frameRange.min || 0) + curSec * safeFps;

      // Estimate instantaneous speed at current frame by centered finite difference.
      let halfWindowSec = 0.5 / safeFps;
      for (let i = 1; i < pts.length; i += 1) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        if (targetFrame <= p1.frame) {
          const localSpanSec = Math.max(1e-6, (Number(p1.frame) - Number(p0.frame)) / safeFps);
          halfWindowSec = Math.max(halfWindowSec, 0.5 * localSpanSec);
          break;
        }
      }

      const t0 = Math.max(minSec, curSec - halfWindowSec);
      const t1 = Math.min(maxSec, curSec + halfWindowSec);
      if (t1 <= t0 + 1e-6) return 0;

      const pPrev = getTrackPointAtSec(track, t0);
      const pNext = getTrackPointAtSec(track, t1);
      if (!pPrev || !pNext) return 0;

      const dx = (Number(pNext.x) || 0) - (Number(pPrev.x) || 0);
      const dy = (Number(pNext.y) || 0) - (Number(pPrev.y) || 0);
      const dtSec = Math.max(1e-6, t1 - t0);
      return Math.hypot(dx, dy) / dtSec;
    }

    function buildContinuousRibbonOverlayData(toWorldX, toWorldY, toWorldT, colorResolver, segmentColorResolver = null) {
      const ribbons = [];
      filteredTracks.forEach((t) => {
        const pts = Array.isArray(t.points) ? t.points : [];
        if (pts.length < 2) return;

        if (typeof segmentColorResolver === 'function') {
          for (let i = 1; i < pts.length; i += 1) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const f0 = Number(p0 && p0.frame);
            const f1 = Number(p1 && p1.frame);
            if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) continue;
            const sec0 = Math.max(0, (f0 - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
            const sec1 = Math.max(0, (f1 - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
            const rgbaRaw = segmentColorResolver(Number(t.id), 0.5 * (sec0 + sec1), p0, p1, i);
            const rgba = (Array.isArray(rgbaRaw) && rgbaRaw.length >= 3) ? rgbaRaw : [150, 210, 255, 220];
            const alphaBase = Math.max(88, Math.min(240, Number(rgba[3]) || 220));
            const alpha = boxSelectionActive && dimmedTrackIds.has(Number(t.id)) ? Math.max(22, Math.round(alphaBase * 0.18)) : alphaBase;
            ribbons.push({
              path: [
                [toWorldX(Number(p0.x) || 0), toWorldY(Number(p0.y) || 0), toWorldT(sec0) + 0.8],
                [toWorldX(Number(p1.x) || 0), toWorldY(Number(p1.y) || 0), toWorldT(sec1) + 0.8],
              ],
              color: [rgba[0], rgba[1], rgba[2], alpha],
              width: boxSelectionActive && highlightTrackIds.has(Number(t.id)) ? 4.8 : 4.2,
            });
          }
          return;
        }

        const path = [];
        let lastKey = null;
        pts.forEach((p) => {
          const sec = Math.max(0, (Number(p.frame) - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
          const k = `${Math.round((Number(p.x) || 0) * 100)}:${Math.round((Number(p.y) || 0) * 100)}:${Math.round(sec * 1000)}`;
          if (k === lastKey) return;
          path.push([
            toWorldX(Number(p.x) || 0),
            toWorldY(Number(p.y) || 0),
            toWorldT(sec) + 0.8,
          ]);
          lastKey = k;
        });
        if (path.length < 2) return;
        const rgbaRaw = (typeof colorResolver === 'function') ? colorResolver(Number(t.id)) : null;
        const rgba = (Array.isArray(rgbaRaw) && rgbaRaw.length >= 3) ? rgbaRaw : [150, 210, 255, 220];
        const alphaBase = Math.max(88, Math.min(240, Number(rgba[3]) || 220));
        const alpha = boxSelectionActive && dimmedTrackIds.has(Number(t.id)) ? Math.max(22, Math.round(alphaBase * 0.18)) : alphaBase;
        ribbons.push({
          path,
          color: [rgba[0], rgba[1], rgba[2], alpha],
          width: boxSelectionActive && highlightTrackIds.has(Number(t.id)) ? 4.8 : 4.2,
        });
      });
      return { ribbons, connectors: [], labels: [], boundary_items: [] };
    }

    function resolveEventSecRangeForTrack(ev, track) {
      const trackHasPoints = !!track && Array.isArray(track.points) && track.points.length > 0;
      if (!trackHasPoints) return null;

      const sorted = track.points.slice().sort((a, b) => a.frame - b.frame);
      const fpsSafe = Math.max(1e-6, ACTIVE_FPS);
      const sceneMinSec = 0;
      const sceneMaxSec = Number.isFinite(maxSec) ? Math.max(0, maxSec) : Number.POSITIVE_INFINITY;
      const trackStartSec = Math.max(0, (sorted[0].frame - (frameRange.min || 0)) / fpsSafe);
      const trackEndSec = Math.max(trackStartSec, (sorted[sorted.length - 1].frame - (frameRange.min || 0)) / fpsSafe);

      const normalizeRange = (startFrame, endFrame) => {
        const s = Number(startFrame);
        const e = Number(endFrame);
        if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
        const startAbs = Math.min(s, e);
        const endAbs = Math.max(s, e);
        let tStart = Math.max(sceneMinSec, Math.min(sceneMaxSec, (startAbs - (frameRange.min || 0)) / fpsSafe));
        let tEnd = Math.max(sceneMinSec, Math.min(sceneMaxSec, (endAbs - (frameRange.min || 0)) / fpsSafe));
        if (tEnd < tStart) {
          const tmp = tStart;
          tStart = tEnd;
          tEnd = tmp;
        }
        tStart = Math.max(trackStartSec, Math.min(trackEndSec, tStart));
        tEnd = Math.max(trackStartSec, Math.min(trackEndSec, tEnd));
        if (tEnd < tStart) {
          const tmp = tStart;
          tStart = tEnd;
          tEnd = tmp;
        }
        if (tEnd - tStart < 0.35) {
          const mid = (tStart + tEnd) * 0.5;
          tStart = Math.max(trackStartSec, mid - 0.175);
          tEnd = Math.min(trackEndSec, mid + 0.175);
        }
        return [tStart, tEnd];
      };

      const normalizedEvents = Array.isArray(ev && ev.interaction_events) ? ev.interaction_events : [];
      for (const ie of normalizedEvents) {
        const range = normalizeRange(ie && ie.start_frame, ie && ie.end_frame);
        if (range) return range;
      }

      const fusedRange = ev && ev.fused_range && typeof ev.fused_range === 'object'
        ? normalizeRange(ev.fused_range.start_frame, ev.fused_range.end_frame)
        : null;
      if (fusedRange) return fusedRange;

      const rawStart = Number(ev && ev.t_start);
      const rawEnd = Number(ev && ev.t_end);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

      let tStart = Math.max(sceneMinSec, Math.min(sceneMaxSec, Math.min(rawStart, rawEnd)));
      let tEnd = Math.max(sceneMinSec, Math.min(sceneMaxSec, Math.max(rawStart, rawEnd)));
      if (tEnd < tStart) {
        const tmp = tStart;
        tStart = tEnd;
        tEnd = tmp;
      }

      tStart = Math.max(trackStartSec, Math.min(trackEndSec, tStart));
      tEnd = Math.max(trackStartSec, Math.min(trackEndSec, tEnd));
      if (tEnd < tStart) {
        const tmp = tStart;
        tStart = tEnd;
        tEnd = tmp;
      }

      const minSpanSec = 0.35;
      if (tEnd - tStart < minSpanSec) {
        const mid = (tStart + tEnd) * 0.5;
        tStart = Math.max(trackStartSec, mid - minSpanSec * 0.5);
        tEnd = Math.min(trackEndSec, mid + minSpanSec * 0.5);
      }

      return [tStart, tEnd];
    }

    function toFusionCubeLabel(text, trackId) {
      const tid = Number.isFinite(Number(trackId)) ? Math.round(Number(trackId)) : 0;
      let s = String(text || '').trim();
      if (!s) return `轨迹${tid}`;

      s = s
        .replace(/^\[[^\]]+\]\s*/g, '')
        .replace(/\s+/g, ' ')
        .replace(/。+$/g, '')
        .trim();

      const compact = s.replace(/[\r\n\t]/g, ' ').trim();
      if (!compact) return `轨迹${tid}`;
      return compact;
    }

    function getCanonicalInteractionToken(ev) {
      if (!ev || typeof ev !== 'object') return '';
      const rawType = String(ev.interaction_type || '').trim();
      const rawDetail = String(ev.interaction_detail || '').trim();
      const rawClass = String(ev.interaction_class || '').trim().toLowerCase();
      const typeText = formatInteractionCategoryText(rawType || rawDetail || '');
      if (typeText && typeText !== '无') return typeText;
      if (rawClass === 'routine') return 'routine';
      if (rawClass === 'alert') return 'alert';
      return '';
    }


    function classifyPairingKind(seedEvent, candidateEvent) {
      const seedType = getCanonicalInteractionToken(seedEvent);
      const candType = getCanonicalInteractionToken(candidateEvent);
      if (seedType && candType && seedType === candType) return 'consistent';
      if (seedType && candType && seedType !== candType) return 'conflict';
      if ((seedType && !candType) || (!seedType && candType)) return 'incomplete';
      return 'none';
    }

    function buildPairingCandidatesForEvent(seedEvent, trackMap, limit = 3) {
      if (!seedEvent || !trackMap || !trackMap.size) return [];
      const seedTrack = trackMap.get(Number(seedEvent.track_id));
      if (!seedTrack || !Array.isArray(seedTrack.points) || !seedTrack.points.length) return [];
      const seedRange = resolveEventSecRangeForTrack(seedEvent, seedTrack);
      if (!seedRange) return [];
      const [seedStart, seedEnd] = seedRange;
      const seedMid = 0.5 * (seedStart + seedEnd);
      const seedMidPt = getTrackPointAtSec(seedTrack, seedMid);
      if (!seedMidPt) return [];
      const seedType = getCanonicalInteractionToken(seedEvent);
      const candidates = [];
      const events = Array.isArray(getVisibleTrackTextEvents()) ? getVisibleTrackTextEvents() : [];
      const eventByTrack = new Map();
      events.forEach((ev) => {
        const tid = Number(ev && ev.track_id);
        if (!Number.isFinite(tid)) return;
        if (!eventByTrack.has(tid)) eventByTrack.set(tid, []);
        eventByTrack.get(tid).push(ev);
      });

      const candidateTracks = boxSelectionActive && boxSelectedTrackIds.size
        ? filteredTracks.filter((track) => boxSelectedTrackIds.has(Number(track && track.id)))
        : filteredTracks;

      candidateTracks.forEach((track) => {
        const tid = Number(track && track.id);
        if (!Number.isFinite(tid) || tid === Number(seedEvent.track_id)) return;
        const pts = Array.isArray(track.points) ? track.points : [];
        if (!pts.length) return;
        const trackStart = Math.max(0, (pts[0].frame - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
        const trackEnd = Math.max(trackStart, (pts[pts.length - 1].frame - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
        const overlap = Math.max(0, Math.min(seedEnd, trackEnd) - Math.max(seedStart, trackStart));
        if (overlap <= 0) return;
        const candMid = Math.max(trackStart, Math.min(trackEnd, seedMid));
        const candMidPt = getTrackPointAtSec(track, candMid);
        if (!candMidPt) return;
        const dx = (Number(seedMidPt.x) || 0) - (Number(candMidPt.x) || 0);
        const dy = (Number(seedMidPt.y) || 0) - (Number(candMidPt.y) || 0);
        const dist = Math.hypot(dx, dy);
        const normDist = dist / Math.max(1, Math.max(spatialOffset.maxX - spatialOffset.minX, spatialOffset.maxY - spatialOffset.minY, 1));
        if (normDist > 0.18) return;
        const candidateEvents = eventByTrack.get(tid) || [];
        let matchedEvent = null;
        let bestEventScore = Number.NEGATIVE_INFINITY;
        candidateEvents.forEach((ev) => {
          const range = resolveEventSecRangeForTrack(ev, track);
          if (!range) return;
          const evOverlap = Math.max(0, Math.min(seedEnd, range[1]) - Math.max(seedStart, range[0]));
          if (evOverlap <= 0) return;
          const evType = getCanonicalInteractionToken(ev);
          if (!seedType && !evType) return;
          const overlapScore = evOverlap / Math.max(0.8, seedEnd - seedStart);
          const typeBonus = seedType && evType && evType === seedType ? 0.2 : 0;
          const score = overlapScore + typeBonus;
          if (score > bestEventScore) {
            bestEventScore = score;
            matchedEvent = ev;
          }
        });
        const matchedRange = matchedEvent ? resolveEventSecRangeForTrack(matchedEvent, track) : null;
        const candidateRange = matchedRange || [seedStart, seedEnd];
        const pairStart = Math.min(seedStart, candidateRange[0]);
        const pairEnd = Math.max(seedEnd, candidateRange[1]);
        const pairingKind = classifyPairingKind(seedEvent, matchedEvent);
        if (pairingKind === 'none') {
          const strongSpatialMatch = normDist <= 0.035;
          const strongTemporalMatch = overlap / Math.max(0.8, seedEnd - seedStart) >= 0.78;
          if (!(strongSpatialMatch && strongTemporalMatch)) return;
        }
        const score = (overlap / Math.max(0.8, seedEnd - seedStart)) * 0.55 + Math.max(0, 1 - normDist / 0.18) * 0.45 + (pairingKind === 'consistent' ? 0.25 : (pairingKind === 'incomplete' ? 0.08 : 0));
        candidates.push({
          track_id: tid,
          kind: pairingKind,
          score,
          distance: dist,
          norm_distance: normDist,
          overlap,
          matched_event_key: matchedEvent && matchedEvent.key ? matchedEvent.key : null,
          has_model_event: !!matchedEvent,
          seed_range: [seedStart, seedEnd],
          candidate_range: [candidateRange[0], candidateRange[1]],
          pair_range: [pairStart, pairEnd],
          seed_event_key: seedEvent && seedEvent.key ? seedEvent.key : null,
          candidate_event_key: matchedEvent && matchedEvent.key ? matchedEvent.key : null,
        });
      });

      return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, limit));
    }

    function buildTrackTextOverlayData(toWorldX, toWorldY, toWorldT) {
      const selectionEvents = getOverlayEventsForCurrentSelection();
      if (!Array.isArray(selectionEvents) || !selectionEvents.length || !Array.isArray(cachedTracks) || !cachedTracks.length) {
        return { ribbons: [], connectors: [], labels: [], boundary_items: [] };
      }
      const activeEvents = activeTrackTextEventKey
        ? selectionEvents.filter((ev) => ev && ev.key === activeTrackTextEventKey)
        : [];

      let overlayEvents = activeEvents;
      if (!overlayEvents.length) {
        const allEvents = selectionEvents.filter((ev) => ev && Number.isFinite(Number(ev.track_id)));
        const perTrackBest = new Map();
        allEvents.forEach((ev) => {
          const tid = Number(ev.track_id);
          const prev = perTrackBest.get(tid);
          const score = Number.isFinite(Number(ev.confidence)) ? Number(ev.confidence) : 0;
          if (!prev || score > prev._score) {
            perTrackBest.set(tid, { ...ev, _score: score });
          }
        });
        overlayEvents = Array.from(perTrackBest.values()).sort((a, b) => {
          const ta = Number(a.track_id);
          const tb = Number(b.track_id);
          if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
          return (Number(b._score) || 0) - (Number(a._score) || 0);
        });
      }
      if (!overlayEvents.length) {
        return { ribbons: [], connectors: [], labels: [], boundary_items: [] };
      }

      const trackMap = new Map(cachedTracks.map((t) => [Number(t.id), t]));
      const trackOrderCount = new Map();
      const ribbons = [];
      const connectors = [];
      const labels = [];
      const boundaryItems = [];

      for (const ev of overlayEvents) {
        const trackId = Number(ev.track_id);
        if (!Number.isFinite(trackId)) continue;
        const track = trackMap.get(trackId);
        if (!track || !Array.isArray(track.points) || !track.points.length) continue;

        const sortedPoints = track.points.slice().sort((a, b) => a.frame - b.frame);
        const trackSafe = { ...track, points: sortedPoints };
        const resolvedRange = resolveEventSecRangeForTrack(ev, trackSafe);
        if (!resolvedRange) continue;
        const [tStart, tEnd] = resolvedRange;

        const tMid = (tStart + tEnd) * 0.5;
        const anchorPt = getTrackPointAtSec(trackSafe, tMid);
        if (!anchorPt) continue;

        const idx = trackOrderCount.get(trackId) || 0;
        trackOrderCount.set(trackId, idx + 1);
        const anchor = [toWorldX(anchorPt.x), toWorldY(anchorPt.y), toWorldT(tMid)];
        const labelPos = [anchor[0], anchor[1], anchor[2] + 0.95 + idx * 0.24];

        const conf = Math.max(0.05, Math.min(1, Number(ev.confidence) || 0.7));
        const alpha = Math.round(80 + conf * 150);
        const baseColor = (trackColorMap.get(trackId) && trackColorMap.get(trackId).rgba)
          ? trackColorMap.get(trackId).rgba
          : [150, 210, 255, 220];
        const color = [baseColor[0], baseColor[1], baseColor[2], alpha];

        const spanSec = Math.max(0, tEnd - tStart);
        const sampleCount = Math.max(8, Math.min(120, Math.round((spanSec * ACTIVE_FPS) / Math.max(1, ANNOTATED_FRAME_STEP))));
        const dedupSegment = [];
        let lastKey = null;
        for (let i = 0; i < sampleCount; i += 1) {
          const ratio = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
          const sec = tStart + (tEnd - tStart) * ratio;
          const p = getTrackPointAtSec(trackSafe, sec);
          if (!p) continue;
          const k = `${Math.round(p.x * 100)}:${Math.round(p.y * 100)}:${Math.round(sec * 1000)}`;
          if (k === lastKey) continue;
          dedupSegment.push({ ...p, _sec: sec });
          lastKey = k;
        }

        if (dedupSegment.length >= 2) {
          ribbons.push({
            path: dedupSegment.map((p) => [
              toWorldX(p.x),
              toWorldY(p.y),
              toWorldT(p._sec) + 0.8,
            ]),
            color,
            width: 3 + conf * 4,
          });
        }

        const shortTextRaw = String(
          ev.full_summary
          || ev.fusion_summary
          || ev.overall_summary
          || ev.summary
          || ev.short_label
          || ev.behavior
          || ''
        ).trim();
        const fullText = shortTextRaw || `轨迹${trackId}`;
        const shortLabel = toFusionCubeLabel(fullText, trackId);
        const pairings = buildPairingCandidatesForEvent(ev, trackMap, 3);
        const side = (() => {
          const spanX = Math.max(1e-6, (spatialOffset.maxX - spatialOffset.minX) || 1);
          const spanY = Math.max(1e-6, (spatialOffset.maxY - spatialOffset.minY) || 1);
          const nx = ((anchorPt.x - spatialOffset.minX) / spanX) * 2 - 1;
          const ny = ((anchorPt.y - spatialOffset.minY) / spanY) * 2 - 1;
          if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'right' : 'left';
          return ny >= 0 ? 'bottom' : 'top';
        })();
        const orderKey = (side === 'top' || side === 'bottom') ? Number(anchorPt.x) : Number(anchorPt.y);

        labels.push({
          key: ev.key || `${trackId}-${tMid}`,
          text: `${shortLabel}`,
          position: labelPos,
          color: [245, 252, 255, 255],
          bgColor: [baseColor[0], baseColor[1], baseColor[2], Math.max(86, Math.round(alpha * 0.62))],
          size: 9.5 + conf * 2.0,
        });
        boundaryItems.push({
          key: ev.key || `${trackId}-${tMid}`,
          track_id: trackId,
          class_label: ev.class_label || '目标',
          confidence: Number.isFinite(Number(ev.confidence)) ? Number(ev.confidence) : conf,
          t_start: tStart,
          t_end: tEnd,
          text: fullText,
          side,
          order_key: Number.isFinite(orderKey) ? orderKey : 0,
          pairings,
        });
      }

      return { ribbons, connectors, labels, boundary_items: boundaryItems };
    }

    function buildInteractionVisualData(toWorldX, toWorldY, toWorldT) {
      const selectionEvents = getOverlayEventsForCurrentSelection();
      if (!Array.isArray(selectionEvents) || !selectionEvents.length || !Array.isArray(cachedTracks) || !cachedTracks.length) {
        return { routinePoints: [], alertPoints: [] };
      }

      const trackMap = new Map(cachedTracks.map((t) => [Number(t.id), t]));
      const routinePoints = [];
      const alertPoints = [];
      const seen = new Set();

      const pushNode = (eventType, ev, track, frameVal, detailText, sourceTag) => {
        const frame = Number(frameVal);
        if (!Number.isFinite(frame)) return;
        const sec = Math.max(0, (Math.round(frame) - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
        const p = getTrackPointAtSec(track, sec);
        if (!p) return;
        const key = `${eventType}:${Number(ev.track_id)}:${Math.round(frame)}:${Math.round((p.x || 0) * 10)}:${Math.round((p.y || 0) * 10)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const detail = formatInteractionCategoryText(detailText, eventType);
        const confRaw = Number(ev.confidence);
        const globalConfidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.62;
        const cameraCount = Array.isArray(ev.multi_camera_descriptions)
          ? ev.multi_camera_descriptions.filter((mc) => mc && (mc.camera_id || mc.summary)).length
          : 0;
        const certainty = Math.max(0.1, Math.min(1, globalConfidence * (0.66 + 0.34 * Math.min(1, cameraCount / 3))));
        const hoverText = detail || `${eventType === 'alert' ? '高危预警' : '常规交互'} · 轨迹${Number(ev.track_id)}`;
        const payload = {
          key,
          track_id: Number(ev.track_id),
          event_key: ev.key,
          type: eventType,
          frame: Math.round(frame),
          sec,
          detail,
          hover_text: hoverText,
          global_confidence: globalConfidence,
          camera_count: cameraCount,
          certainty,
          category: detail,
          opacity: getInteractionOpacity(globalConfidence),
          source: sourceTag,
          position: [toWorldX(p.x), toWorldY(p.y), toWorldT(sec) + 1.02],
        };
        if (eventType === 'alert') {
          alertPoints.push(payload);
        } else if (eventType === 'routine') {
          routinePoints.push(payload);
        }
      };

      selectionEvents.forEach((ev) => {
        const track = trackMap.get(Number(ev.track_id));
        if (!track || !Array.isArray(track.points) || !track.points.length) return;

        const pickMidFrame = (item) => {
          if (!item || typeof item !== 'object') return null;
          const s = Number(item.start_frame);
          const e = Number(item.end_frame);
          if (Number.isFinite(s) && Number.isFinite(e)) {
            return Math.round((s + e) / 2);
          }
          const f = Number(item.frame);
          return Number.isFinite(f) ? Math.round(f) : null;
        };

        const cameraEvents = [];
        if (Array.isArray(ev.multi_camera_descriptions)) {
          ev.multi_camera_descriptions.forEach((mc) => {
            if (!mc || typeof mc !== 'object') return;
            const mcType = String(mc.interaction_class || '').trim().toLowerCase();
            const mcFrame = Number(mc.interaction_frame);
            const mcDetail = String(mc.interaction_detail || '').trim();
            const mcEvents = Array.isArray(mc.interaction_events) ? mc.interaction_events : [];
            if (mcEvents.length) {
              mcEvents.forEach((ie) => cameraEvents.push({
                type: String((ie && ie.type) || mcType || 'none').toLowerCase(),
                frame: pickMidFrame(ie),
                start_frame: ie && ie.start_frame,
                end_frame: ie && ie.end_frame,
                detail: String((ie && ie.detail) || mcDetail || '').trim(),
                source: mc.camera_id || 'camera',
              }));
            } else if (mcType === 'routine' || mcType === 'alert') {
              cameraEvents.push({
                type: mcType,
                frame: mcFrame,
                detail: mcDetail,
                source: mc.camera_id || 'camera',
              });
            }
          });
        }

        const rootEvents = Array.isArray(ev.interaction_events) ? ev.interaction_events : [];
        if (rootEvents.length) {
          rootEvents.forEach((ie) => cameraEvents.push({
            type: String((ie && ie.type) || ev.interaction_class || 'none').toLowerCase(),
            frame: pickMidFrame(ie),
            start_frame: ie && ie.start_frame,
            end_frame: ie && ie.end_frame,
            detail: String((ie && ie.detail) || ev.interaction_detail || '').trim(),
            source: 'root',
          }));
        } else {
          const rootType = String(ev.interaction_class || '').trim().toLowerCase();
          const rootFrame = Number(ev.interaction_frame);
          if (rootType === 'routine' || rootType === 'alert') {
            cameraEvents.push({
              type: rootType,
              frame: rootFrame,
              detail: String(ev.interaction_detail || '').trim(),
              source: 'root',
            });
          }
        }

        cameraEvents.forEach((ie) => {
          const t = String(ie.type || '').toLowerCase();
          if (t !== 'routine' && t !== 'alert') return;
          let f = Number(ie.frame);
          if (!Number.isFinite(f)) {
            const midSec = 0.5 * (Number(ev.t_start) + Number(ev.t_end));
            f = (frameRange.min || 0) + midSec * ACTIVE_FPS;
          }
          pushNode(t, ev, track, f, ie.detail, ie.source);
        });
      });

      return { routinePoints, alertPoints };
    }

    function buildInteractionSegmentOverlayData(toWorldX, toWorldY, toWorldT) {
      const selectionEvents = getOverlayEventsForCurrentSelection();
      if (!Array.isArray(selectionEvents) || !selectionEvents.length || !Array.isArray(cachedTracks) || !cachedTracks.length) {
        return { ribbons: [], glowRibbons: [], labels: [] };
      }

      const trackMap = new Map(cachedTracks.map((t) => [Number(t.id), t]));
      const ribbons = [];
      const glowRibbons = [];
      const labels = [];
      const trackLabelOrder = new Map();
      const warningColors = {
        1: [90, 204, 255, 220],
        2: [255, 186, 92, 220],
        3: [255, 88, 88, 235],
      };

      const getCategoryText = (ev) => {
        const raw = [ev && ev.interaction_type, ev && ev.interaction_detail, ev && ev.behavior]
          .map((v) => String(v || '').trim())
          .find((v) => v);
        return formatInteractionCategoryText(raw || '');
      };

      const orderedEvents = selectionEvents
        .filter((ev) => ev && Number.isFinite(Number(ev.track_id)))
        .slice()
        .sort((a, b) => {
          const ta = Number(a.track_id);
          const tb = Number(b.track_id);
          if (ta !== tb) return ta - tb;
          const sa = Number(a.t_start);
          const sb = Number(b.t_start);
          if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
          return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
        });

      orderedEvents.forEach((ev) => {
        const trackId = Number(ev.track_id);
        const track = trackMap.get(trackId);
        if (!track || !Array.isArray(track.points) || track.points.length < 2) return;

        const sortedPoints = track.points.slice().sort((a, b) => a.frame - b.frame);
        const trackSafe = { ...track, points: sortedPoints };
        const resolvedRange = resolveEventSecRangeForTrack(ev, trackSafe);
        if (!resolvedRange) return;

        const tStart = resolvedRange[0];
        const tEnd = resolvedRange[1];
        if (!Number.isFinite(tStart) || !Number.isFinite(tEnd) || tEnd <= tStart) return;

        const categoryText = getCategoryText(ev);
        if (categoryText === '无') return;

        const warningLevel = getInteractionWarningLevel(categoryText);
        const conf = Math.max(0.05, Math.min(1, Number(ev.confidence) || 0.7));
        const alpha = Math.round(56 + conf * 72);
        const baseColor = warningColors[warningLevel] || [160, 210, 255, 220];
        const color = [baseColor[0], baseColor[1], baseColor[2], alpha];

        const spanSec = Math.max(0, tEnd - tStart);
        const sampleCount = Math.max(8, Math.min(160, Math.round((spanSec * ACTIVE_FPS) / Math.max(1, ANNOTATED_FRAME_STEP))));
        const segmentPoints = [];
        let lastKey = null;
        for (let i = 0; i < sampleCount; i += 1) {
          const ratio = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
          const sec = tStart + (tEnd - tStart) * ratio;
          const p = getTrackPointAtSec(trackSafe, sec);
          if (!p) continue;
          const key = `${Math.round((Number(p.x) || 0) * 100)}:${Math.round((Number(p.y) || 0) * 100)}:${Math.round(sec * 1000)}`;
          if (key === lastKey) continue;
          segmentPoints.push({ ...p, _sec: sec });
          lastKey = key;
        }
        if (segmentPoints.length < 2) return;

        const midSec = 0.5 * (tStart + tEnd);
        const midPt = getTrackPointAtSec(trackSafe, midSec) || segmentPoints[Math.floor(segmentPoints.length / 2)];
        if (!midPt) return;
        const labelIdx = trackLabelOrder.get(trackId) || 0;
        trackLabelOrder.set(trackId, labelIdx + 1);

        const ribbonPath = segmentPoints.map((p) => [
          toWorldX(Number(p.x) || 0),
          toWorldY(Number(p.y) || 0),
          toWorldT(p._sec) + 0.86,
        ]);

        glowRibbons.push({
          key: `glow-${ev.key || `${trackId}-${midSec}`}`,
          event_key: ev.key || `${trackId}-${midSec}`,
          track_id: trackId,
          path: ribbonPath,
          color: glowColorFromRgba(color, 0.58),
          width: 10.6 + conf * 4.0 + (warningLevel === 3 ? 1.8 : 0),
        });

        ribbons.push({
          key: ev.key || `${trackId}-${midSec}`,
          event_key: ev.key || `${trackId}-${midSec}`,
          track_id: trackId,
          category_text: categoryText,
          warning_level: warningLevel,
          confidence: conf,
          t_start: tStart,
          t_end: tEnd,
          time_text: `${tStart.toFixed(1)}s-${tEnd.toFixed(1)}s`,
          path: ribbonPath,
          color,
          width: 1.2 + conf * 1.6 + (warningLevel === 3 ? 0.4 : 0),
        });

        labels.push({
          key: ev.key || `${trackId}-${midSec}`,
          event_key: ev.key || `${trackId}-${midSec}`,
          track_id: trackId,
          category_text: categoryText,
          warning_level: warningLevel,
          confidence: conf,
          time_text: `${tStart.toFixed(1)}s-${tEnd.toFixed(1)}s`,
          text: `${categoryText}`,
          position: [
            toWorldX(Number(midPt.x) || 0),
            toWorldY(Number(midPt.y) || 0),
            toWorldT(midSec) + 1.12 + labelIdx * 0.08,
          ],
          color: [246, 252, 255, 255],
          bgColor: [baseColor[0], baseColor[1], baseColor[2], Math.max(96, Math.round(alpha * 0.55))],
          size: 9.8 + conf * 1.8,
        });
      });

      return { ribbons, glowRibbons, labels };
    }

    function makeLayers() {
      if (!filteredTracks.length) return [];
      const { minX, maxX, minY, maxY } = computeBounds();
      spatialOffset = { minX, maxX, minY, maxY };
      const zScale = TIME_STRETCH;
      // 使用 x-y-t 坐标：y 轴向上、x 轴向右、t 轴向右前，贴近左上角XY框的方向
      const centerX = (spatialOffset.minX + spatialOffset.maxX) / 2;
      const centerY = (spatialOffset.minY + spatialOffset.maxY) / 2;
      const toWorldX = v => v - centerX;
      const toWorldY = v => centerY - v;
      const toWorldT = sec => sec * zScale;
      const useDeclutter = getSceneMode(currentScene) === 'fused_multi_camera' && vizClusterRepresentatives.length > 0;
      const adaptiveColorMode = semanticLayoutMode === SEMANTIC_LAYOUTS.AGENT_ADAPTIVE_COLOR;
      const colorFromSpeed = !adaptiveColorMode || hasAgentInteraction;
      const speedColorMap = new Map();
      if (colorFromSpeed) {
        filteredTracks.forEach((t) => {
          const speed = getTrackSpeedPxPerSecAtSec(t, currentSec);
          speedColorMap.set(Number(t.id), {
            speed,
            rgba: speedToSemanticColor(speed, 220),
          });
        });
      }
      const resolveTrackRgba = (trackId) => {
        const speedInfo = speedColorMap.get(Number(trackId));
        const baseInfo = trackColorMap.get(trackId);
        const rgba = (colorFromSpeed && speedInfo && Array.isArray(speedInfo.rgba))
          ? speedInfo.rgba.slice()
          : ((baseInfo && Array.isArray(baseInfo.rgba)) ? baseInfo.rgba.slice() : [200, 200, 200, 220]);
        if (boxSelectionActive && dimmedTrackIds.has(Number(trackId))) {
          rgba[3] = Math.max(36, Math.round((Number(rgba[3]) || 220) * 0.22));
        }
        if (boxSelectionActive && boxSelectedTrackIds.has(Number(trackId))) {
          rgba[3] = Math.max(220, Number(rgba[3]) || 220);
        }
        return rgba;
      };
      const resolveSegmentRgba = (trackId, _secMid, p0, p1) => {
        if (!colorFromSpeed) return resolveTrackRgba(trackId);
        const f0 = Number(p0 && p0.frame);
        const f1 = Number(p1 && p1.frame);
        const dtFrame = f1 - f0;
        if (!Number.isFinite(dtFrame) || dtFrame <= 0) return resolveTrackRgba(trackId);
        const dtSec = dtFrame / Math.max(1e-6, ACTIVE_FPS);
        const dx = (Number(p1 && p1.x) || 0) - (Number(p0 && p0.x) || 0);
        const dy = (Number(p1 && p1.y) || 0) - (Number(p0 && p0.y) || 0);
        const speed = Math.hypot(dx, dy) / Math.max(1e-6, dtSec);
        return speedToSemanticColor(speed, 220);
      };
      const disableSemanticText = adaptiveColorMode;
      const semanticOverlay = disableSemanticText
        ? buildContinuousRibbonOverlayData(
            toWorldX,
            toWorldY,
            toWorldT,
            resolveTrackRgba,
            colorFromSpeed ? resolveSegmentRgba : null,
          )
        : buildTrackTextOverlayData(toWorldX, toWorldY, toWorldT);
      latestSemanticOverlayCache = semanticOverlay;
      const useInlineLabelLayout = !disableSemanticText && semanticLayoutMode === SEMANTIC_LAYOUTS.INLINE_STC;

      const rectsData = [];
      filteredTracks.forEach((t) => {
        const colorSrc = resolveTrackRgba(Number(t.id));
        const r = colorSrc[0];
        const g = colorSrc[1];
        const b = colorSrc[2];
        t.points.forEach(p => {
          const halfW = (p.w || 0) / 2;
          const halfH = (p.h || 0) / 2;
          const tVal = toWorldT((p.frame - frameRange.min) / ACTIVE_FPS);
          const corners = [
            [toWorldX(p.x - halfW), toWorldY(p.y - halfH), tVal],
            [toWorldX(p.x + halfW), toWorldY(p.y - halfH), tVal],
            [toWorldX(p.x + halfW), toWorldY(p.y + halfH), tVal],
            [toWorldX(p.x - halfW), toWorldY(p.y + halfH), tVal],
          ];
          rectsData.push({ corners, path: [...corners, corners[0]], color: [r, g, b, 40], trackId: t.id });
        });
      });

      const rectPathLayer = new PathLayer({
        id: 'rect-paths',
        data: rectsData,
        getPath: d => d.path,
        getColor: d => d.color,
        widthUnits: 'pixels',
        getWidth: d => highlightTrackIds.has(d.trackId) ? 3.4 : 2,
        widthMinPixels: 2.5,
        billboard: true,
        capRounded: true,
        jointRounded: true,
        opacity: useDeclutter ? Math.min(opacityTracks, 0.12) : opacityTracks,
        parameters: { depthTest: true, depthMask: false, blend: true },
      });

      let centerLayer = null;
      if (useDeclutter && showClusterCenter) {
        const centerData = vizClusterRepresentatives.map((rep) => {
          const hex = vizClusterColorMap.get(rep.cid) || colors[Math.abs(rep.cid) % colors.length];
          const color = hexToRgba(hex, 245);
          const path = rep.points.map((p) => ([
            toWorldX(p.x),
            toWorldY(p.y),
            toWorldT((p.frame - frameRange.min) / ACTIVE_FPS),
          ]));
          return {
            cid: rep.cid,
            size: rep.size,
            path,
            color,
          };
        }).filter(d => Array.isArray(d.path) && d.path.length >= 2);

        centerLayer = new PathLayer({
          id: 'cluster-centers',
          data: centerData,
          getPath: d => d.path,
          getColor: d => d.color,
          widthUnits: 'pixels',
          getWidth: d => 3 + Math.min(10, Math.sqrt(Math.max(1, d.size)) * 2),
          widthMinPixels: 3,
          billboard: true,
          capRounded: true,
          jointRounded: true,
          opacity: 0.98,
          parameters: { depthTest: false, blend: true },
        });
      }

      const headLayer = new ScatterplotLayer({
        id: 'heads',
        data: filteredTracks.map(t => {
          const pt = t.points.findLast(p => (p.frame - frameRange.min) / ACTIVE_FPS <= currentSec) || t.points[0];
          return { cls: t.cls, pt, trackId: t.id, track_id: t.id, frame: pt && Number.isFinite(Number(pt.frame)) ? Number(pt.frame) : null };
        }),
        pickable: true,
        getPosition: d => {
          const p = d.pt;
          return [toWorldX(p.x), toWorldY(p.y), toWorldT((p.frame - frameRange.min) / ACTIVE_FPS)];
        },
        getRadius: () => 0.1,
        radiusUnits: 'pixels',
        getFillColor: () => [0, 0, 0, 0],
        opacity: 0.01,
      });

      const interactionSegmentOverlay = buildInteractionSegmentOverlayData(toWorldX, toWorldY, toWorldT);
      const interactionSegmentGlowLayer = interactionSegmentOverlay.glowRibbons && interactionSegmentOverlay.glowRibbons.length
        ? new PathLayer({
            id: 'interaction-segment-glow-ribbons',
            data: interactionSegmentOverlay.glowRibbons,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            widthUnits: 'pixels',
            getWidth: (d) => d.width,
            widthMinPixels: 6,
            billboard: true,
            capRounded: true,
            jointRounded: true,
            opacity: 0.92,
            parameters: { depthTest: false, depthMask: false, blend: true },
          })
        : null;

      const semanticRibbonLayer = semanticOverlay.ribbons.length
        ? new PathLayer({
            id: 'semantic-ribbons',
            data: semanticOverlay.ribbons,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            widthUnits: 'pixels',
            getWidth: (d) => d.width,
            widthMinPixels: 2.5,
            billboard: true,
            capRounded: true,
            jointRounded: true,
            opacity: 0.96,
            parameters: { depthTest: false, depthMask: false, blend: true },
          })
        : null;

      const segmentCharacterSet = Array.from(new Set(
        interactionSegmentOverlay.labels
          .map((d) => String(d.text || ''))
          .join('')
          .split('')
          .concat(['轨', '迹', '时', '间', '段', '预', '警', '置信', '度', '%', '·', ' '])
      ));

      const interactionSegmentRibbonLayer = interactionSegmentOverlay.ribbons.length
        ? new PathLayer({
            id: 'interaction-segment-ribbons',
            data: interactionSegmentOverlay.ribbons,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            widthUnits: 'pixels',
            getWidth: (d) => d.width,
            widthMinPixels: 2.8,
            billboard: true,
            capRounded: true,
            jointRounded: true,
            opacity: 0.42,
            parameters: { depthTest: false, depthMask: false, blend: true },
          })
        : null;

      const interactionSegmentTextLayer = interactionSegmentOverlay.labels.length
        ? new TextLayer({
            id: 'interaction-segment-labels',
            data: interactionSegmentOverlay.labels,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getColor: (d) => d.color,
            background: true,
            getBackgroundColor: (d) => d.bgColor || [28, 40, 56, 180],
            getBorderColor: (d) => {
              const warningLevel = Number(d.warning_level) || 0;
              if (warningLevel === 3) return [255, 112, 112, 180];
              if (warningLevel === 2) return [255, 196, 108, 180];
              return [130, 210, 255, 160];
            },
            getBorderWidth: 0.6,
            backgroundPadding: [4, 2],
            getSize: (d) => d.size * getSemanticLabelZoomScale(),
            sizeUnits: 'pixels',
            sizeMinPixels: 8,
            sizeMaxPixels: 20,
            maxWidth: 22,
            lineHeight: 1.08,
            wordBreak: 'break-word',
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            getAngle: 0,
            billboard: true,
            fontFamily: 'Noto Sans SC, Microsoft YaHei, PingFang SC, Heiti SC, Arial Unicode MS, sans-serif',
            characterSet: segmentCharacterSet,
            fontWeight: 'bold',
            pickable: true,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const interactionVisuals = { routinePoints: [], alertPoints: [] };
      const interactionCharacterSet = Array.from(new Set(
        interactionVisuals.routinePoints
          .concat(interactionVisuals.alertPoints)
          .map((d) => String(d.category || ''))
          .join('')
          .split('')
          .concat(['常', '规', '交', '互', '高', '危', '预', '警', ' '])
      ));
      const alertPulse = 1 + 0.35 * Math.sin((currentSec || 0) * 5.2);

      const routinePointLayer = interactionVisuals.routinePoints.length
        ? new ScatterplotLayer({
            id: 'routine-points',
            data: interactionVisuals.routinePoints,
            pickable: true,
            getPosition: (d) => d.position,
            getRadius: (d) => 5.5 + Math.max(0, Math.min(1, Number(d.global_confidence) || 0.5)) * 16,
            radiusUnits: 'pixels',
            radiusMinPixels: 4,
            radiusMaxPixels: 22,
            stroked: true,
            filled: true,
            getFillColor: (d) => {
              const conf = Math.max(0, Math.min(1, Number(d.global_confidence) || 0));
              return [141, 239, 255, Math.round(50 + 205 * conf)];
            },
            getLineColor: (d) => {
              const conf = Math.max(0, Math.min(1, Number(d.global_confidence) || 0));
              return [240, 250, 255, Math.round(70 + 185 * conf)];
            },
            getLineWidth: (d) => 1.1 + 2.2 * Math.max(0, Math.min(1, Number(d.global_confidence) || 0.5)),
            lineWidthUnits: 'pixels',
            opacity: 0.95,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const alertHaloLayer = interactionVisuals.alertPoints.length
        ? new ScatterplotLayer({
            id: 'alert-halo-points',
            data: interactionVisuals.alertPoints,
            getPosition: (d) => d.position,
            getRadius: (d) => (9 + 15 * Math.max(0, Math.min(1, Number(d.global_confidence) || 0.5))) * alertPulse,
            radiusUnits: 'pixels',
            radiusMinPixels: 8,
            radiusMaxPixels: 32,
            getFillColor: (d) => {
              const conf = Math.max(0, Math.min(1, Number(d.global_confidence) || 0));
              return [255, 72, 72, Math.round(40 + 190 * conf)];
            },
            getLineColor: (d) => {
              const conf = Math.max(0, Math.min(1, Number(d.global_confidence) || 0));
              return [255, 196, 52, Math.round(110 + 140 * conf)];
            },
            lineWidthUnits: 'pixels',
            getLineWidth: (d) => 1.2 + 1.8 * Math.max(0, Math.min(1, Number(d.global_confidence) || 0.5)),
            stroked: true,
            pickable: true,
            opacity: 0.94,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const alertCorePointLayer = interactionVisuals.alertPoints.length
        ? new ScatterplotLayer({
            id: 'alert-core-points',
            data: interactionVisuals.alertPoints,
            pickable: true,
            getPosition: (d) => d.position,
            getRadius: (d) => (6.5 + 10.5 * Math.max(0, Math.min(1, Number(d.global_confidence) || 0.5))) * alertPulse,
            radiusUnits: 'pixels',
            radiusMinPixels: 6,
            radiusMaxPixels: 24,
            stroked: true,
            filled: true,
            getFillColor: (d) => {
              const conf = Math.max(0, Math.min(1, Number(d.global_confidence) || 0));
              return [255, 92, 92, Math.round(80 + 175 * conf)];
            },
            getLineColor: (d) => {
              const conf = Math.max(0, Math.min(1, Number(d.global_confidence) || 0));
              return [255, 226, 154, Math.round(100 + 150 * conf)];
            },
            getLineWidth: (d) => 1.2 + 1.8 * Math.max(0, Math.min(1, Number(d.global_confidence) || 0.5)),
            lineWidthUnits: 'pixels',
            opacity: 0.95,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const alertIconLayer = interactionVisuals.alertPoints.length
        ? new IconLayer({
            id: 'alert-icon-layer',
            data: interactionVisuals.alertPoints,
            pickable: true,
            sizeUnits: 'pixels',
            getPosition: (d) => d.position,
            getIcon: () => ({
              url: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%2064%2064%27%3E%3Ccircle%20cx%3D%2732%27%20cy%3D%2732%27%20r%3D%2730%27%20fill%3D%27%23ff2e2e%27%20stroke%3D%27%23ffd84a%27%20stroke-width%3D%274%27/%3E%3Crect%20x%3D%2729%27%20y%3D%2715%27%20width%3D%276%27%20height%3D%2726%27%20rx%3D%273%27%20fill%3D%27%23fff6c6%27/%3E%3Ccircle%20cx%3D%2732%27%20cy%3D%2749%27%20r%3D%273.2%27%20fill%3D%27%23fff6c6%27/%3E%3C/svg%3E",
              width: 64,
              height: 64,
              anchorY: 32,
            }),
            getSize: 18,
            sizeMinPixels: 14,
            sizeMaxPixels: 24,
            billboard: true,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const alertTextLayer = interactionVisuals.alertPoints.length
        ? new TextLayer({
            id: 'alert-text-layer',
            data: interactionVisuals.alertPoints,
            getPosition: (d) => [d.position[0] + 1.1, d.position[1], d.position[2] + 0.2],
            getText: (d) => String(d.category || '').trim() ? String(d.category) : '高危交互',
            getColor: (d) => {
              const alpha = Math.round(120 + 135 * (Number(d.opacity) || 0.65));
              return [255, 230, 84, alpha];
            },
            getSize: 18,
            sizeUnits: 'pixels',
            sizeMinPixels: 14,
            sizeMaxPixels: 26,
            getTextAnchor: 'start',
            getAlignmentBaseline: 'center',
            billboard: true,
            background: true,
            getBackgroundColor: (d) => [170, 24, 24, Math.round(70 + 140 * (Number(d.opacity) || 0.65))],
            backgroundPadding: [6, 3],
            fontWeight: 'bold',
            fontFamily: 'Noto Sans SC, Microsoft YaHei, PingFang SC, Heiti SC, Arial Unicode MS, sans-serif',
            characterSet: interactionCharacterSet,
            pickable: false,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const routineTextLayer = interactionVisuals.routinePoints.length
        ? new TextLayer({
            id: 'routine-text-layer',
            data: interactionVisuals.routinePoints,
            getPosition: (d) => [d.position[0] + 1.0, d.position[1], d.position[2] + 0.15],
            getText: (d) => String(d.category || '').trim() ? String(d.category) : '常规交互',
            getColor: (d) => {
              const alpha = Math.round(105 + 125 * (Number(d.opacity) || 0.65));
              return [141, 239, 255, alpha];
            },
            getSize: 16,
            sizeUnits: 'pixels',
            sizeMinPixels: 12,
            sizeMaxPixels: 24,
            getTextAnchor: 'start',
            getAlignmentBaseline: 'center',
            billboard: true,
            background: true,
            getBackgroundColor: (d) => [13, 24, 36, Math.round(65 + 135 * (Number(d.opacity) || 0.65))],
            backgroundPadding: [6, 3],
            fontWeight: 'bold',
            fontFamily: 'Noto Sans SC, Microsoft YaHei, PingFang SC, Heiti SC, Arial Unicode MS, sans-serif',
            characterSet: interactionCharacterSet,
            pickable: false,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      const semanticConnectorLayer = (useInlineLabelLayout && semanticOverlay.connectors.length)
        ? new PathLayer({
            id: 'semantic-connectors',
            data: semanticOverlay.connectors,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            widthUnits: 'pixels',
            getWidth: 1.4,
            widthMinPixels: 1,
            billboard: true,
            capRounded: true,
            jointRounded: true,
            opacity: 0.9,
            parameters: { depthTest: false, depthMask: false, blend: true },
          })
        : null;

      const semanticTextLayer = (useInlineLabelLayout && semanticOverlay.labels.length)
        ? new TextLayer({
            id: 'semantic-text-labels',
            data: semanticOverlay.labels,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getColor: (d) => d.color,
            background: true,
            getBackgroundColor: (d) => d.bgColor || [24, 36, 50, 170],
            getBorderColor: () => [170, 210, 245, 140],
            getBorderWidth: 0.4,
            backgroundPadding: [3, 1],
            getSize: (d) => d.size * getSemanticLabelZoomScale(),
            sizeUnits: 'pixels',
            sizeMinPixels: 8,
            sizeMaxPixels: 20,
            maxWidth: 18,
            lineHeight: 1.08,
            wordBreak: 'break-word',
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            getAngle: 0,
            billboard: true,
            fontFamily: 'Noto Sans SC, Microsoft YaHei, PingFang SC, Heiti SC, Arial Unicode MS, sans-serif',
            characterSet: Array.from(new Set(
              semanticOverlay.labels
                .map((d) => String(d.text || ''))
                .join('')
                .split('')
                .concat(['轨', '迹', '。', '，', '、', '：', ' '])
            )),
            fontWeight: 'bold',
            pickable: false,
            parameters: { depthTest: false, blend: true },
          })
        : null;

      let videoLayer = null;
      let videoBorder = null;
      let volumeEdges = null;
      if (frameTexture && frameTexture.pixelXs && Number.isFinite(spatialOffset.maxX) && Number.isFinite(spatialOffset.maxY)) {
        const tVal = toWorldT(currentSec);
        const px = frameTexture.pixelXs;
        const py = frameTexture.pixelYs;
        const pcolors = frameTexture.pixelColors;
        const w = frameTexture.w;
        const h = frameTexture.h;
        videoLayer = new ScatterplotLayer({
          id: 'video-plane',
          data: px.map((xv, i) => ({
            pos: [toWorldX(xv), toWorldY(py[i]), tVal],
            color: pcolors[i],
          })),
          getPosition: d => d.pos,
          getRadius: 0.8,
          radiusUnits: 'pixels',
          getFillColor: d => d.color,
          opacity: opacityVideo,
          pickable: false,
          parameters: { depthTest: false },
        });

        const x0 = 0;
        const x1 = w;
        const y0 = 0;
        const y1 = h;
        videoBorder = new PathLayer({
          id: 'video-border',
          data: [{ path: [[toWorldX(x0), toWorldY(y0), tVal], [toWorldX(x1), toWorldY(y0), tVal], [toWorldX(x1), toWorldY(y1), tVal], [toWorldX(x0), toWorldY(y1), tVal], [toWorldX(x0), toWorldY(y0), tVal]] }],
          getPath: d => d.path,
          getColor: () => [255, 255, 255, 160],
          widthUnits: 'pixels',
          getWidth: 2,
          widthMinPixels: 1.5,
          billboard: true,
          capRounded: true,
          jointRounded: true,
          opacity: opacityVideo * 0.85,
          parameters: { depthTest: false },
        });

        const t0 = 0;
        const t1 = toWorldT(maxSec);
        const corners = [
          [toWorldX(spatialOffset.minX), toWorldY(spatialOffset.minY), t0],
          [toWorldX(spatialOffset.maxX), toWorldY(spatialOffset.minY), t0],
          [toWorldX(spatialOffset.maxX), toWorldY(spatialOffset.maxY), t0],
          [toWorldX(spatialOffset.minX), toWorldY(spatialOffset.maxY), t0],
        ];
        const verticalEdges = [0, 1, 2, 3].map(i => [corners[i], [corners[i][0], corners[i][1], t1]]);
        const topLoop = corners.map(([x, y]) => [x, y, t1]);
        topLoop.push(topLoop[0]);
        const bottomLoop = [...corners, corners[0]];
        const paths = [bottomLoop, topLoop, ...verticalEdges];
        volumeEdges = new PathLayer({
          id: 'volume-edges',
          data: paths.map(path => ({ path })),
          getPath: d => d.path,
          getColor: () => [120, 200, 255, 140],
          widthUnits: 'pixels',
          getWidth: 1.5,
          widthMinPixels: 1,
          billboard: true,
          capRounded: true,
          jointRounded: true,
          opacity: opacityVideo * 0.9,
          parameters: { depthTest: false },
        });
      }

      const core = [
        rectPathLayer,
        interactionSegmentGlowLayer,
        semanticRibbonLayer,
        interactionSegmentRibbonLayer,
        interactionSegmentTextLayer,
        routinePointLayer,
        routineTextLayer,
        alertHaloLayer,
        alertCorePointLayer,
        alertIconLayer,
        alertTextLayer,
        semanticConnectorLayer,
        semanticTextLayer,
        centerLayer,
        headLayer,
      ].filter(Boolean);
      if (videoLayer && videoBorder && volumeEdges) {
        return [videoLayer, videoBorder, volumeEdges, ...core];
      }
      return core;
    }

    function drawDeck() {
      if (!deckgl) return;
      deckgl.setProps({ layers: makeLayers() });
      refreshSemanticOverviewPanels();
    }

    async function fetchClustersForCurrentScene() {
      if (!currentScene || !currentScene.scene_id) return false;
      try {
        const context = {
          frameRange,
          currentSec,
          activeFps: ACTIVE_FPS,
          selectedClasses: Array.from(selectedClasses),
          videoPath: VIDEO_SRC,
          tracksPath: DATA_FILE,
          sceneId: currentScene.scene_id,
        };
        const resp = await fetch(VIRAT_ANALYZE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scene_id: currentScene.scene_id,
            text: '请输出轨迹聚簇结果',
            context,
            full_video: false,
          }),
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        if (!data || typeof data !== 'object') return false;
        applyClusterPayload(data);
        updateHighlightTrackIdsFromModel();
        updateHiddenTrackIdsFromModelFilter();
        applyFiltersAndRender();
        return true;
      } catch (e) {
        console.warn('cluster fetch failed', e);
        return false;
      }
    }

    async function loadAndRender() {
      if (!currentScene) {
        setStatus('请先选择场景', true);
        return;
      }
      if (!currentScene.tracks_exists) {
        setStatus('场景标注文件不存在，请检查', true);
        return;
      }
      try {
        hasAgentInteraction = false;
        clearBoxSelection({ keepMode: true });
        baseHighlightTrackIds = new Set();
        baseHiddenTrackIds = new Set();
        highlightTrackIds = new Set();
        hiddenTrackIds = new Set();
        setModelResults([]);
        applyClusterPayload(null);
        setStatus('读取对象文件中…');
        // WildTrack can be loaded without a video file; only preload when available.
        if (currentScene.video_exists && VIDEO_SRC) {
          await loadVideo();
        }
        let sourceLabel = '原始检测框';
        let loaded = false;

        if (WORLD_DATA_FILE) {
          try {
            const worldResp = await fetch(WORLD_DATA_FILE);
            if (worldResp.ok) {
              const worldText = await worldResp.text();
              setStatus('解析世界坐标轨迹中…');
              cachedTracks = parseWorldObjects(worldText);
              sourceLabel = '世界坐标CSV';
              loaded = true;
            }
          } catch (e) {
            console.warn('world coords load failed', e);
          }
        }

        if (!loaded) {
          const res = await fetch(DATA_FILE);
          if (!res.ok) throw new Error(`无法加载数据文件 (${res.status})`);
          const text = await res.text();
          setStatus('解析轨迹中…');
          cachedTracks = parseObjects(text);
        }
        currentSec = 0;
        setupDeck();
        // Preload first frame texture for video plane
        const firstFrame = frameRange.min;
        await maybeLoadFrameTexture(firstFrame);
        applyFiltersAndRender();

        if (getSceneMode(currentScene) === 'fused_multi_camera') {
          const fusedCameraCount = getSceneCameraSources(currentScene).length;
          setStatus(`完成（${sourceLabel}，融合${fusedCameraCount || '?'}相机）`);
        } else {
          setStatus(`已绘制（${sourceLabel}），正在请求聚类…`);
          const clusterApplied = await fetchClustersForCurrentScene();
          if (clusterApplied) {
            setStatus('完成（已接入聚类）');
          } else {
            setStatus('完成（未获取到聚类，显示基础轨迹）');
          }
        }
      } catch (e) {
        console.error(e);
        setStatus(e.message || '加载失败', true);
      }
    }

    function handleBoxSelectPointerDown(ev) {
      if (!boxSelectEnabled || !boxSelectOverlayEl) return;
      const rect = boxSelectOverlayEl.getBoundingClientRect();
      boxSelectDraft = {
        startX: ev.clientX - rect.left,
        startY: ev.clientY - rect.top,
        endX: ev.clientX - rect.left,
        endY: ev.clientY - rect.top,
      };
      renderBoxSelectOverlay();
      if (typeof boxSelectOverlayEl.setPointerCapture === 'function' && ev.pointerId != null) {
        boxSelectOverlayEl.setPointerCapture(ev.pointerId);
      }
      ev.preventDefault();
    }

    function handleBoxSelectPointerMove(ev) {
      if (!boxSelectEnabled || !boxSelectDraft || !boxSelectOverlayEl) return;
      const rect = boxSelectOverlayEl.getBoundingClientRect();
      boxSelectDraft.endX = ev.clientX - rect.left;
      boxSelectDraft.endY = ev.clientY - rect.top;
      renderBoxSelectOverlay();
      ev.preventDefault();
    }

    function handleBoxSelectPointerEnd(ev) {
      if (!boxSelectOverlayEl) return;
      if (typeof boxSelectOverlayEl.releasePointerCapture === 'function' && ev.pointerId != null) {
        try { boxSelectOverlayEl.releasePointerCapture(ev.pointerId); } catch (_) {}
      }
      const rect = normalizeBoxRect(boxSelectDraft);
      const shouldCommit = !!(rect && rect.width >= 6 && rect.height >= 6);
      const selected = shouldCommit ? collectTrackIdsInBox(boxSelectDraft) : new Set();
      boxSelectDraft = null;
      renderBoxSelectOverlay();
      if (shouldCommit) {
        updateBoxSelectionFromTracks(selected);
      }
      ev.preventDefault();
    }

    function getDeckTooltip(info) {
      if (!info || !info.object || !info.layer) return null;
      const layerId = String(info.layer.id || '');
      const obj = info.object;
      if (layerId === 'interaction-segment-ribbons' || layerId === 'interaction-segment-labels') {
        const trackId = Number(obj.track_id);
        const categoryText = String(obj.category_text || obj.text || obj.detail || '').trim() || '交互';
        const confPct = Math.round(Math.max(0, Math.min(1, Number(obj.confidence) || 0)) * 100);
        const warningText = formatInteractionWarningLevelLabel(obj.warning_level);
        const timeText = String(obj.time_text || obj.range_text || '').trim();
        const text = `[${warningText}] ${categoryText} · 置信度${confPct}%${timeText ? ` · ${timeText}` : ''} · 轨迹 ${Number.isFinite(trackId) ? trackId : '-'}`;
        return { text };
      }
      if (layerId === 'routine-points') {
        const trackId = Number(obj.track_id);
        const detail = String(obj.hover_text || obj.detail || '').trim();
        const confPct = Math.round(Math.max(0, Math.min(1, Number(obj.global_confidence) || 0)) * 100);
        const camCount = Number(obj.camera_count);
        const extra = ` 置信度${confPct}%${Number.isFinite(camCount) && camCount > 0 ? ` · ${camCount}机证据` : ''}`;
        const text = detail
          ? `[常规交互] ${detail}${extra}`
          : `[常规交互] 轨迹 ${Number.isFinite(trackId) ? trackId : '-'} 在当前时空点发生短时社交行为${extra}`;
        return { text };
      }
      if (layerId === 'alert-halo-points' || layerId === 'alert-core-points' || layerId === 'alert-icon-layer') {
        const trackId = Number(obj.track_id);
        const detail = String(obj.hover_text || obj.detail || '').trim();
        const confPct = Math.round(Math.max(0, Math.min(1, Number(obj.global_confidence) || 0)) * 100);
        const camCount = Number(obj.camera_count);
        const extra = ` 置信度${confPct}%${Number.isFinite(camCount) && camCount > 0 ? ` · ${camCount}机证据` : ''}`;
        const text = detail
          ? `[高危预警] ${detail}${extra}`
          : `[高危预警] 轨迹 ${Number.isFinite(trackId) ? trackId : '-'} 出现异常交互${extra}`;
        return { text };
      }
      return null;
    }

    function resolveTrackEventKeyByPoint(trackId, frameVal) {
      const tid = Number(trackId);
      if (!Number.isFinite(tid) || !Array.isArray(trackTextEvents) || !trackTextEvents.length) return null;
      const targetFrame = Number(frameVal);
      const candidates = trackTextEvents.filter((ev) => Number(ev.track_id) === tid);
      if (!candidates.length) return null;
      if (!Number.isFinite(targetFrame)) return candidates[0].key || null;

      const getEventFrame = (ev) => {
        const frameFromInteraction = Number(ev.interaction_frame);
        if (Number.isFinite(frameFromInteraction)) return Math.round(frameFromInteraction);
        const t0 = Number(ev.t_start);
        const t1 = Number(ev.t_end);
        if (Number.isFinite(t0) && Number.isFinite(t1)) {
          const sec = 0.5 * (Math.min(t0, t1) + Math.max(t0, t1));
          return Math.round((frameRange.min || 0) + sec * Math.max(1e-6, ACTIVE_FPS));
        }
        return Number.POSITIVE_INFINITY;
      };

      let best = null;
      let bestGap = Number.POSITIVE_INFINITY;
      candidates.forEach((ev) => {
        const f = getEventFrame(ev);
        const gap = Math.abs(f - targetFrame);
        if (gap < bestGap) {
          bestGap = gap;
          best = ev;
        }
      });
      return best && best.key ? best.key : null;
    }

    function handleDeckClick(info) {
      if (!info || !info.object || !info.layer) return;
      const layerId = String((info.layer && info.layer.id) || '');
      const interactiveLayers = new Set([
        'interaction-segment-ribbons',
        'interaction-segment-labels',
        'routine-points',
        'alert-halo-points',
        'alert-core-points',
        'alert-icon-layer',
        'rect-paths',
        'heads',
      ]);
      if (!interactiveLayers.has(layerId)) return;

      const obj = info.object || {};
      if (boxSelectionActive && !boxSelectedTrackIds.has(Number(obj.track_id))) return;
      const eventKey = String(obj.event_key || '').trim() || resolveTrackEventKeyByPoint(obj.track_id, obj.frame || (obj.pt && obj.pt.frame));
      if (!eventKey) return;
      focusTrackTextEvent(eventKey);
      const modeText = layerId === 'interaction-segment-ribbons' || layerId === 'interaction-segment-labels'
        ? '交互段'
        : (layerId === 'routine-points'
          ? '常规交互'
          : ((layerId === 'alert-halo-points' || layerId === 'alert-core-points' || layerId === 'alert-icon-layer')
            ? '高危预警'
            : '轨迹'));
      setAgentStatus(`已从3D${modeText}定位到对应事件卡片`);
    }

    function setupDeck() {
      const initialViewState = {
        target: [0, 0, (maxSec * TIME_STRETCH) / 2],
        rotationX: 28,
        rotationOrbit: -35,
        zoom: -0.25,
      };
      currentOrbitZoom = initialViewState.zoom;
      if (!deckgl) {
        deckgl = new DeckGL({
          container: 'deck-canvas',
          controller: { type: OrbitController, enablePan: true },
          views: [new OrbitView({ id:'orbit', fovy: 50, orbitAxis: 'Y' })],
          initialViewState,
          getTooltip: getDeckTooltip,
          onClick: handleDeckClick,
          onViewStateChange: ({ viewState }) => {
            if (viewState && Number.isFinite(viewState.zoom)) {
              currentOrbitZoom = viewState.zoom;
            }
            return viewState;
          },
          layerFilter: ({layer}) => true,
          effects: [new LightingEffect({ ambientLight: new AmbientLight({color:[255,255,255], intensity: 1.0}) })],
        });
      } else {
        deckgl.setProps({
          initialViewState,
          getTooltip: getDeckTooltip,
          onClick: handleDeckClick,
          onViewStateChange: ({ viewState }) => {
            if (viewState && Number.isFinite(viewState.zoom)) {
              currentOrbitZoom = viewState.zoom;
            }
            return viewState;
          },
        });
      }
    }

    document.getElementById('btnLoad').addEventListener('click', loadAndRender);
    document.getElementById('btnReset').addEventListener('click', () => {
      if (deckgl) deckgl.setProps({ viewState: null });
      clearBoxSelection({ keepMode: true });
      drawDeck();
    });



    const clusterGranularitySliderEl = document.getElementById('clusterGranularity');
    const clusterGranularityValEl = document.getElementById('clusterGranularityVal');
    if (clusterGranularitySliderEl && clusterGranularityValEl) {
      vizClusterThreshold = Number(clusterGranularitySliderEl.value) || 0;
      clusterGranularityValEl.textContent = vizClusterThreshold.toFixed(3);
      clusterGranularitySliderEl.addEventListener('input', () => {
        vizClusterThreshold = Number(clusterGranularitySliderEl.value) || 0;
        clusterGranularityValEl.textContent = vizClusterThreshold.toFixed(3);
        applyFiltersAndRender();
      });
    }

    const showClusterCenterCheckboxEl = document.getElementById('showClusterCenter');
    if (showClusterCenterCheckboxEl) {
      showClusterCenter = !!showClusterCenterCheckboxEl.checked;
      showClusterCenterCheckboxEl.addEventListener('change', () => {
        showClusterCenter = !!showClusterCenterCheckboxEl.checked;
        drawDeck();
      });
    }

    if (temporalWindowCheckboxEl) {
      useTemporalWindow = !!temporalWindowCheckboxEl.checked;
      temporalWindowCheckboxEl.addEventListener('change', () => {
        useTemporalWindow = !!temporalWindowCheckboxEl.checked;
        applyFiltersAndRender();
      });
    }

    if (temporalWindowSliderEl && temporalWindowValEl) {
      temporalWindowSec = Number(temporalWindowSliderEl.value) || 0;
      temporalWindowValEl.textContent = String(Math.round(temporalWindowSec)) + 's';
      temporalWindowSliderEl.addEventListener('input', () => {
        temporalWindowSec = Number(temporalWindowSliderEl.value) || 0;
        temporalWindowValEl.textContent = String(Math.round(temporalWindowSec)) + 's';
        applyFiltersAndRender();
      });
    }

    if (temporalWeightSliderEl && temporalWeightValEl) {
      temporalWeight = Number(temporalWeightSliderEl.value);
      if (!Number.isFinite(temporalWeight)) temporalWeight = 0.35;
      temporalWeightValEl.textContent = temporalWeight.toFixed(2);
      temporalWeightSliderEl.addEventListener('input', () => {
        temporalWeight = Number(temporalWeightSliderEl.value);
        if (!Number.isFinite(temporalWeight)) temporalWeight = 0.35;
        temporalWeightValEl.textContent = temporalWeight.toFixed(2);
        applyFiltersAndRender();
      });
    }

    if (btnClassAll) btnClassAll.addEventListener('click', () => {
      // 全选：选中所有类别，但不包括背景（0）
      ALL_VIRAT_CLASSES.forEach(c => {
        if (c !== 0) selectedClasses.add(c);
      });
      renderClassFilters();
      applyFiltersAndRender();
    });
    if (btnClassNone) btnClassNone.addEventListener('click', () => {
      // 清空：清除所有选中，包括背景
      selectedClasses.clear();
      renderClassFilters();
      applyFiltersAndRender();
    });

    if (modelOnlyCheckbox) modelOnlyCheckbox.addEventListener('change', () => {
      modelFilterOnly = modelOnlyCheckbox.checked;
      updateHiddenTrackIdsFromModelFilter();
      applyFiltersAndRender();
    });

    let timeSliderSeekTimer = null;
    let pendingSeekSec = null;

    async function performSeek(sec) {
        const currentFrame = secToSnappedFrame(sec);
        currentSec = snappedFrameToSec(currentFrame);
        timeSlider.value = String(currentSec);
      const v = await loadVideo();
      if (v) {
        v.pause();
        const relativeFrame = currentFrame - frameRange.min;
        const targetTime = Math.max(0, relativeFrame / ACTIVE_FPS);
        const safeDuration = Number.isFinite(v.duration) ? v.duration - 0.1 : 9999;
        v.currentTime = Math.min(targetTime, safeDuration);
        if (typeof v.requestVideoFrameCallback === 'function') {
          await new Promise(res => v.requestVideoFrameCallback(() => res()));
        } else {
          await new Promise(res => v.addEventListener('seeked', res, { once: true }));
        }
      }
      await syncRailVideosToFrame(currentFrame);
      await maybeLoadFrameTexture(currentFrame);
      drawDeck();
    }

    timeSlider.addEventListener('input', () => {
        const rawSec = Number(timeSlider.value);
        const snappedFrame = secToSnappedFrame(rawSec);
        const sec = snappedFrameToSec(snappedFrame);
        timeSlider.value = String(sec);
        pendingSeekSec = sec;
        updateTimeLabel(sec);
      if (timeSliderSeekTimer) clearTimeout(timeSliderSeekTimer);
      timeSliderSeekTimer = setTimeout(() => {
        timeSliderSeekTimer = null;
        performSeek(pendingSeekSec);
      }, SEEK_THROTTLE_MS);
    });

    async function postAgentQuery() {
      if (!chatInput || !chatInput.value.trim()) {
        setAgentStatus('请输入要发送的任务');
        return;
      }
      if (!currentScene) {
        setAgentStatus('请先选择场景', true);
        return;
      }

      const userText = chatInput.value.trim();
      chatMessages.push({ role: 'user', text: userText });
      renderChat();
      setAgentStatus('发送中…');

      const screenshot = await captureSceneEvidence();
      const context = buildAgentContext();
      const payload = {
        text: userText,
        scene_id: currentScene.scene_id,
        context,
        screenshot,
      };

      try {
        let resp = null;
        // Fused multi-camera scenes are trajectory-first: try generic /query first.
        if (context.isFusedMultiCamera) {
          resp = await fetch(AGENT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) {
            resp = await fetch(`${AGENT_BASE}/virat/analyze`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scene_id: currentScene.scene_id,
                text: userText,
                context,
                screenshot,
              }),
            });
          }
        } else {
          // Single-camera scenes keep the original priority: /virat/analyze then /query.
          resp = await fetch(`${AGENT_BASE}/virat/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scene_id: currentScene.scene_id,
              text: userText,
              context,
              screenshot,
            }),
          });
          if (!resp.ok) {
            resp = await fetch(AGENT_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
          }
        }

        if (!resp || !resp.ok) throw new Error(`Agent 返回 ${resp ? resp.status : 'N/A'}`);
        const data = await resp.json();
        applyAgentAction(data);
        setAgentStatus(data.message || 'Agent 完成');
        appendAgentResponseToChat(data);
      } catch (e) {
        console.error(e);
        setAgentStatus(e.message || 'Agent 调用失败', true);
        chatMessages.push({ role: 'agent', text: e.message || 'Agent 调用失败' });
        renderChat();
      }
    }

    function applyAgentAction(data) {
      if (!data) return;
      clearBoxSelection({ keepMode: true });
      hasAgentInteraction = true;
      applyClusterPayload(data);
      const trajectoryEvidenceList = normalizeTrajectoryEvidence(data);
      const bestEvidence = pickBestTrajectoryEvidence(trajectoryEvidenceList);
      let overlayRangeSec = null;
      if (data.filter) {
        const { classes, timeSecRange } = data.filter;
        if (Array.isArray(classes) && classes.length) {
          selectedClasses = new Set(classes);
          renderClassFilters();
        }
        if (timeSecRange && Array.isArray(timeSecRange) && timeSecRange.length === 2) {
          const t0 = Math.max(0, Math.min(maxSec, Number(timeSecRange[0]) || 0));
          const t1 = Math.max(0, Math.min(maxSec, Number(timeSecRange[1]) || 0));
          const lo = Math.min(t0, t1);
          const hi = Math.max(t0, t1);
          clusterFocusTimeRange = [lo, hi];
          overlayRangeSec = [lo, hi];
          const clampedFrame = secToSnappedFrame(lo);
          const clamped = snappedFrameToSec(clampedFrame);
          currentSec = clamped;
          timeSlider.value = String(clamped);
          updateTimeLabel(clamped);
        } else {
          // Prevent stale range from previous interaction from suppressing new summary samples.
          if (bestEvidence && Array.isArray(bestEvidence.timeSecRange) && bestEvidence.timeSecRange.length === 2) {
            const t0 = Math.max(0, Math.min(maxSec, Number(bestEvidence.timeSecRange[0]) || 0));
            const t1 = Math.max(0, Math.min(maxSec, Number(bestEvidence.timeSecRange[1]) || 0));
            const lo = Math.min(t0, t1);
            const hi = Math.max(t0, t1);
            clusterFocusTimeRange = [lo, hi];
            overlayRangeSec = [lo, hi];
          } else {
            clusterFocusTimeRange = null;
          }
        }
      } else {
        if (bestEvidence && Array.isArray(bestEvidence.timeSecRange) && bestEvidence.timeSecRange.length === 2) {
          const t0 = Math.max(0, Math.min(maxSec, Number(bestEvidence.timeSecRange[0]) || 0));
          const t1 = Math.max(0, Math.min(maxSec, Number(bestEvidence.timeSecRange[1]) || 0));
          const lo = Math.min(t0, t1);
          const hi = Math.max(t0, t1);
          clusterFocusTimeRange = [lo, hi];
          overlayRangeSec = [lo, hi];
        } else {
          clusterFocusTimeRange = null;
        }
      }
      if (data.highlights && Array.isArray(data.highlights)) {
        baseHighlightTrackIds = new Set(data.highlights.map(Number).filter(Number.isFinite));
      } else {
        baseHighlightTrackIds = new Set();
      }
      if (!baseHighlightTrackIds.size && bestEvidence && Array.isArray(bestEvidence.ids) && bestEvidence.ids.length) {
        baseHighlightTrackIds = new Set(bestEvidence.ids.map(Number).filter(Number.isFinite));
      }
      highlightTrackIds = new Set(baseHighlightTrackIds);
      anomalyTrackIds.forEach((id) => highlightTrackIds.add(id));

      if (data.dim && Array.isArray(data.dim.trackIds)) {
        baseHiddenTrackIds = new Set(data.dim.trackIds.map(Number).filter(Number.isFinite));
      } else {
        baseHiddenTrackIds = new Set();
      }
      hiddenTrackIds = new Set(baseHiddenTrackIds);

      // 模型级结果：用于交互式过滤/对比
      setModelResults(data.modelResults || []);
      updateHighlightTrackIdsFromModel();
      updateHiddenTrackIdsFromModelFilter();

      if (data.viz) {
        if (Number.isFinite(data.viz.opacityTracks)) opacityTracks = data.viz.opacityTracks;
        if (Number.isFinite(data.viz.opacityVideo)) opacityVideo = data.viz.opacityVideo;
      }

      const overlayIds = baseHighlightTrackIds.size
        ? Array.from(baseHighlightTrackIds)
        : Array.from(highlightTrackIds);
      setAgentSummaryOverlay(overlayRangeSec, overlayIds);
      setTrackTextEvents(normalizeTrackTextEvents(data));

      if (data.confidence && typeof data.confidence === "object") {
        const c = Number(data.confidence.trajectory);
        if (Number.isFinite(c)) {
          setAgentStatus(`Agent 已应用（轨迹置信度 ${c.toFixed(3)}）`);
        }
      }

      applyFiltersAndRender();
      updateCurrentFrameDistribution(currentSec);
    }

    if (btnSendAgent) btnSendAgent.addEventListener('click', postAgentQuery);
    if (btnSaveDraft) btnSaveDraft.addEventListener('click', () => {
      if (!chatInput) return;
      try {
        localStorage.setItem('agentDraft', chatInput.value);
        setAgentStatus('草稿已保存');
      } catch {
        setAgentStatus('草稿保存失败', true);
      }
    });

    if (boxSelectEnabledEl) {
      boxSelectEnabledEl.addEventListener('change', () => {
        boxSelectEnabled = !!boxSelectEnabledEl.checked;
        if (!boxSelectEnabled) {
          clearBoxSelection({ keepMode: false, restoreActive: true });
          drawDeck();
        } else {
          updateBoxSelectStatus();
          renderBoxSelectOverlay();
        }
      });
    }

    if (btnClearBoxSelect) {
      btnClearBoxSelect.addEventListener('click', () => {
        clearBoxSelection({ keepMode: true, restoreActive: true });
        drawDeck();
      });
    }

    if (boxSelectOverlayEl) {
      boxSelectOverlayEl.addEventListener('pointerdown', handleBoxSelectPointerDown);
      boxSelectOverlayEl.addEventListener('pointermove', handleBoxSelectPointerMove);
      boxSelectOverlayEl.addEventListener('pointerup', handleBoxSelectPointerEnd);
      boxSelectOverlayEl.addEventListener('pointercancel', handleBoxSelectPointerEnd);
    }

    updateBoxSelectStatus();
    renderBoxSelectOverlay();

    if (trackTextPanelEl) {
      trackTextPanelEl.addEventListener('click', (ev) => {
        const target = ev.target && ev.target.closest ? ev.target.closest('[data-event-key]') : null;
        if (!target) return;
        const key = target.getAttribute('data-event-key');
        if (!key) return;
        focusTrackTextEvent(key);
      });
    }

    if (semanticOverlayEl) {
      semanticOverlayEl.addEventListener('click', (ev) => {
        const target = ev.target && ev.target.closest ? ev.target.closest('[data-event-key]') : null;
        if (!target) return;
        const key = target.getAttribute('data-event-key');
        if (!key) return;
        focusTrackTextEvent(key);
      });
    }

    if (storylineOverviewRowsEl) {
      storylineOverviewRowsEl.addEventListener('click', (ev) => {
        const target = ev.target && ev.target.closest ? ev.target.closest('[data-event-key]') : null;
        if (!target) return;
        const key = target.getAttribute('data-event-key');
        if (!key) return;
        focusTrackTextEvent(key);
      });
    }

    if (semanticLayoutSelect) {
      semanticLayoutSelect.value = semanticLayoutMode;
      semanticLayoutSelect.addEventListener('change', () => {
        semanticLayoutMode = normalizeSemanticLayoutMode(semanticLayoutSelect.value);
        try {
          localStorage.setItem('semanticLayoutMode', semanticLayoutMode);
        } catch (_) {
          // ignore storage failures
        }
        drawDeck();
        renderTrackTextEvents();
      });
    }

    async function requestFullVideoAnalysis() {
      if (!currentScene) {
        setAgentStatus('请先选择场景', true);
        return;
      }
      setAgentStatus('全视频分析中…');
      const payload = {
        scene_id: currentScene.scene_id,
        text: (chatInput && chatInput.value) ? chatInput.value : '',
        full_video: true,
      };
      try {
        // 优先使用 /virat/analyze 端点
        let resp = await fetch(`${AGENT_BASE}/virat/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          // 回退到原始端点
          resp = await fetch(AGENT_ANALYZE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: payload.text,
              videoPath: VIDEO_SRC,
              tracksPath: DATA_FILE,
            }),
          });
        }
        if (!resp.ok) throw new Error(`Agent 返回 ${resp.status}`);
        const data = await resp.json();
        applyAgentAction(data);
        setAgentStatus(data.message || '分析完成');
        appendAgentResponseToChat(data);
      } catch (e) {
        console.error(e);
        setAgentStatus(e.message || '全视频分析失败', true);
      }
    }

    // Shift+Enter 快捷键触发全视频分析
    if (chatInput) {
      chatInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.shiftKey) {
          ev.preventDefault();
          requestFullVideoAnalysis();
        }
      });
    }

    // 恢复草稿
    if (chatInput) {
      try {
        const saved = localStorage.getItem('agentDraft');
        if (saved) chatInput.value = saved;
      } catch {}
    }

    // 场景选择事件
    if (sceneSelect) {
      sceneSelect.addEventListener('change', onSceneChange);
    }

    if (btnRailPlayAll) {
      btnRailPlayAll.addEventListener('click', () => {
        playAllRailVideos();
      });
    }

    if (btnRailPauseAll) {
      btnRailPauseAll.addEventListener('click', () => {
        pauseAllRailVideos();
      });
    }

    if (btnRailSync) {
      btnRailSync.addEventListener('click', () => {
        if (!Number.isFinite(frameRange.min)) return;
        const currentFrame = secToSnappedFrame(currentSec);
        syncRailVideosToFrame(currentFrame);
      });
    }

    // 初始欢迎语
    chatMessages.push({ role: 'agent', text: '你好，我是时空立方 Agent，支持时间/空间/行为/交互查询。请先选择场景，然后输入需求即可。' });
    renderChat();

    // 页面加载时自动加载场景列表
    loadScenes();
    setStatus('正在加载场景列表...');
  
