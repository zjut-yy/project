    function hexToRgba(hex, alpha = 220) {
      if (!hex || typeof hex !== 'string') return [200, 200, 200, alpha];
      const cleaned = hex.replace('#', '').trim();
      if (cleaned.length !== 6) return [200, 200, 200, alpha];
      const r = parseInt(cleaned.slice(0, 2), 16);
      const g = parseInt(cleaned.slice(2, 4), 16);
      const b = parseInt(cleaned.slice(4, 6), 16);
      return [r, g, b, alpha];
    }

    function clamp01(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(1, n));
    }

    function lerpColor(c0, c1, t) {
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return [r, g, b];
    }

    function speedToSemanticColor(speedPxPerSec, alpha = 220) {
      const s = Math.max(0, Number(speedPxPerSec) || 0);
      let rgb = SPEED_COLOR_GRAY;
      if (s <= SPEED_STOP_MAX) {
        rgb = SPEED_COLOR_GRAY;
      } else if (s <= SPEED_WALK_REF) {
        const t = clamp01((s - SPEED_STOP_MAX) / Math.max(1e-6, SPEED_WALK_REF - SPEED_STOP_MAX));
        rgb = lerpColor(SPEED_COLOR_GRAY, SPEED_COLOR_GREEN, t);
      } else if (s <= SPEED_RUN_REF) {
        const t = clamp01((s - SPEED_WALK_REF) / Math.max(1e-6, SPEED_RUN_REF - SPEED_WALK_REF));
        rgb = lerpColor(SPEED_COLOR_GREEN, SPEED_COLOR_RED, t);
      } else {
        rgb = SPEED_COLOR_RED;
      }
      return [rgb[0], rgb[1], rgb[2], alpha];
    }

    function glowColorFromRgba(rgba, alphaScale = 0.32) {
      const src = Array.isArray(rgba) && rgba.length >= 3 ? rgba : [150, 210, 255, 220];
      const alpha = Array.isArray(rgba) && rgba.length >= 4 ? Number(rgba[3]) || 220 : 220;
      return [
        Math.round(src[0] + (255 - src[0]) * 0.42),
        Math.round(src[1] + (255 - src[1]) * 0.48),
        Math.round(src[2] + (255 - src[2]) * 0.56),
        Math.max(26, Math.min(110, Math.round(alpha * alphaScale))),
      ];
    }

    function extractWildtrackCameraNum(scene) {
      const rawCamera = String((scene && (scene.camera_id || scene.cameraId)) || '').trim();
      const m0 = rawCamera.match(/C?(\d+)/i);
      const m1 = String((scene && (scene.scene_id || scene.sceneId)) || '').match(/C(\d+)/i);
      const m2 = String((scene && (scene.tracks_path || scene.tracksPath)) || '').match(/\/(C\d+)\//i);
      const cam = (m0 && m0[1]) || (m1 && m1[1]) || (m2 && m2[1] ? m2[1].replace(/^C/i, '') : '0');
      const n = Number(cam);
      return Number.isFinite(n) ? n : 0;
    }

    function getWildtrackRebuiltVideoPath(scene) {
      const camNum = extractWildtrackCameraNum(scene);
      if (!Number.isFinite(camNum) || camNum <= 0) return null;
      return "/backend/dataset/WildTrack/C" + camNum + "/cam" + camNum + ".mp4";
    }

    function toWebAssetPath(rawPath) {
      const raw = String(rawPath || '').trim();
      if (!raw) return '';
      if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
      const normalized = raw.replace(/\\/g, '/');
      const marker = '/MiniCPM-S/vis/backend/';
      const markerIdx = normalized.indexOf(marker);
      if (markerIdx >= 0) {
        return '/backend/' + normalized.slice(markerIdx + marker.length);
      }
      const backendIdx = normalized.indexOf('/vis/backend/');
      if (backendIdx >= 0) {
        return '/backend/' + normalized.slice(backendIdx + '/vis/backend/'.length);
      }
      const directBackendIdx = normalized.indexOf('/backend/');
      if (directBackendIdx >= 0 && normalized.startsWith('/home/')) {
        return normalized.slice(directBackendIdx);
      }
      return normalized;
    }

    function isFusedCameraScene(scene) {
      const mode = String((scene && (scene.scene_mode || scene.sceneMode)) || '').trim().toLowerCase();
      if (mode === 'fused_multi_camera') return true;
      return !!(scene && (scene.fused || (scene.dataset_type === 'wildtrack' && scene.scene_id === FUSED_WILDTACK_SCENE_ID)));
    }

    function getSceneMode(scene) {
      return isFusedCameraScene(scene) ? 'fused_multi_camera' : 'single_camera';
    }

    function getSceneCoordinateSpace(scene) {
      const raw = String((scene && (scene.coordinate_space || scene.coordinateSpace)) || '').trim().toLowerCase();
      if (raw === 'world' || raw === 'image') return raw;
      return getSceneWorldTracksPath(scene) ? 'world' : 'image';
    }

    function getSceneWorldTracksPath(scene) {
      return (scene && (scene.world_tracks_path || scene.worldTracksPath)) || null;
    }

    function normalizeCameraSource(scene) {
      if (!scene || typeof scene !== 'object') return null;
      const sceneId = scene.scene_id || scene.sceneId || null;
      const cameraIdRaw = scene.camera_id || scene.cameraId || null;
      const camNum = extractWildtrackCameraNum(scene);
      const cameraId = String(cameraIdRaw || (Number.isFinite(camNum) && camNum > 0 ? ('C' + camNum) : '') || '').trim().toUpperCase() || null;
      const videoPath = toWebAssetPath(scene.video_path || scene.videoPath || getWildtrackRebuiltVideoPath(scene) || '');
      const tracksPath = toWebAssetPath(scene.tracks_path || scene.tracksPath || '');
      const imageDir = toWebAssetPath(scene.image_dir || scene.imageDir || '');
      const fps = Number(scene.fps);
      const frameCount = Number(scene.frame_count != null ? scene.frame_count : scene.frameCount);
      const duration = Number(scene.duration);
      const frameOffset = Number(scene.frame_offset != null ? scene.frame_offset : scene.frameOffset);
      return {
        sceneId,
        cameraId,
        videoPath: videoPath || null,
        tracksPath: tracksPath || null,
        imageDir: imageDir || null,
        fps: Number.isFinite(fps) && fps > 0 ? fps : ACTIVE_FPS,
        frameCount: Number.isFinite(frameCount) ? frameCount : null,
        duration: Number.isFinite(duration) ? duration : null,
        frameOffset: Number.isFinite(frameOffset) ? Math.max(0, Math.round(frameOffset)) : 0,
      };
    }

    function getSceneCameraSources(scene) {
      const direct = Array.isArray(scene && scene.camera_sources)
        ? scene.camera_sources
        : (Array.isArray(scene && scene.cameraSources) ? scene.cameraSources : []);
      if (direct.length) {
        return direct.map(normalizeCameraSource).filter(x => x && (x.sceneId || x.cameraId || x.imageDir));
      }
      if (isFusedCameraScene(scene) && Array.isArray(fusedCameraSourceScenes) && fusedCameraSourceScenes.length) {
        const datasetType = String((scene && scene.dataset_type) || '').toLowerCase();
        const fallbackSources = fusedCameraSourceScenes
          .filter(item => !datasetType || String((item && item.dataset_type) || '').toLowerCase() === datasetType);
        return fallbackSources.map(normalizeCameraSource).filter(x => x && (x.sceneId || x.cameraId || x.imageDir));
      }
      return [];
    }

    function buildSceneOptionLabel(scene) {
      const duration = Number(scene && scene.duration);
      const frameCount = Number(scene && scene.frame_count);
      const cameraCount = getSceneCameraSources(scene).length;
      const fusedText = getSceneMode(scene) === 'fused_multi_camera' ? `, ${cameraCount || '?'}机融合` : '';
      const coordText = getSceneCoordinateSpace(scene) === 'world' ? ', 世界坐标' : '';
      const durationText = Number.isFinite(duration) ? duration.toFixed(1) : '0.0';
      const frameText = Number.isFinite(frameCount) ? Math.round(frameCount) : 0;
      return `${scene.scene_id}${fusedText}${coordText} (${durationText}s, ${frameText}帧)`;
    }

    async function loadScenes() {
      try {
        sceneSelect.innerHTML = '<option value="">加载中...</option>';
        const resp = await fetch(VIRAT_SCENES_ENDPOINT);
        if (!resp.ok) throw new Error('无法加载场景列表 (' + resp.status + ')');
        const data = await resp.json();
        const allScenes = Array.isArray(data.scenes) ? data.scenes : [];

        availableScenes = allScenes.slice().sort((a, b) => {
          const modeDelta = (getSceneMode(a) === 'fused_multi_camera' ? 0 : 1) - (getSceneMode(b) === 'fused_multi_camera' ? 0 : 1);
          if (modeDelta !== 0) return modeDelta;
          return String((a && a.scene_id) || '').localeCompare(String((b && b.scene_id) || ''));
        });
        fusedCameraSourceScenes = availableScenes
          .filter(scene => scene && getSceneMode(scene) !== 'fused_multi_camera' && (scene.camera_id || scene.cameraId || scene.image_dir || scene.imageDir))
          .sort((a, b) => extractWildtrackCameraNum(a) - extractWildtrackCameraNum(b));

        sceneSelect.innerHTML = '<option value="">请选择场景...</option>';
        availableScenes.forEach(scene => {
          const opt = document.createElement('option');
          opt.value = scene.scene_id;
          opt.textContent = buildSceneOptionLabel(scene);
          sceneSelect.appendChild(opt);
        });

        const preferred = availableScenes.find(s => getSceneMode(s) === 'fused_multi_camera') || availableScenes[0];
        if (preferred) {
          sceneSelect.value = preferred.scene_id;
          onSceneChange();
        }
      } catch (e) {
        console.error('加载场景列表失败:', e);
        sceneSelect.innerHTML = '<option value="">加载失败</option>';
        sceneInfo.textContent = '错误: ' + e.message;
      }
    }

    function onSceneChange() {
      const sceneId = sceneSelect.value;
      if (!sceneId) {
        currentScene = null;
        sceneInfo.textContent = '-';
        return;
      }
      currentScene = availableScenes.find(s => s.scene_id === sceneId);
      if (!currentScene) {
        sceneInfo.textContent = '场景未找到';
        return;
      }
      DATA_FILE = currentScene.tracks_path;
      WORLD_DATA_FILE = null;
      const datasetType = currentScene.dataset_type || 'virat';
      const sceneMode = getSceneMode(currentScene);
      const coordinateSpace = getSceneCoordinateSpace(currentScene);
      const worldTracksPath = getSceneWorldTracksPath(currentScene);
      const cameraSources = getSceneCameraSources(currentScene);
      const fpsHint = Number(currentScene.fps);
      if (Number.isFinite(fpsHint) && fpsHint > 0) ACTIVE_FPS = fpsHint;

      if (worldTracksPath) {
        WORLD_DATA_FILE = worldTracksPath;
      } else if (coordinateSpace === 'world' && /\.csv(?:$|[?#])/.test(String(currentScene.tracks_path || ''))) {
        WORLD_DATA_FILE = currentScene.tracks_path;
      }

      VIDEO_SRC = sceneMode === 'fused_multi_camera' ? null : currentScene.video_path;

      sceneInfo.innerHTML = [
        '数据集: ' + datasetType + '<br>',
        '视频: ' + (VIDEO_SRC && currentScene.video_exists ? '✓' : '✗') + '<br>',
        '标注: ' + (currentScene.tracks_exists ? '✓' : '✗') + '<br>',
        '时长: ' + Number(currentScene.duration || 0).toFixed(1) + '秒<br>',
        '帧数: ' + Math.round(Number(currentScene.frame_count) || 0) + '<br>',
        'FPS: ' + Number(currentScene.fps || 0).toFixed(1) + '<br>',
        '模式: ' + (sceneMode === 'fused_multi_camera' ? `融合${cameraSources.length || '?'}相机` : '单相机') + '<br>',
        '坐标系: ' + (coordinateSpace === 'world' ? '世界坐标' : '图像坐标') + '<br>',
        '坐标源: ' + (WORLD_DATA_FILE ? '优先世界坐标CSV' : '原始检测框')
      ].join('');

      cachedTracks = [];
      filteredTracks = [];
      frameRange = { min: null, max: null };
      availableClasses = [];
      selectedClasses = new Set(ALL_VIRAT_CLASSES.filter(c => c !== 0));
      videoEl = null;
      frameTexture = null;
      lastFrameTextureFrame = null;
      highlightTrackIds.clear();
      hiddenTrackIds.clear();
      baseHighlightTrackIds.clear();
      baseHiddenTrackIds.clear();
      clusterFocusTimeRange = null;
      setAgentSummaryOverlay(null, []);
      hasAgentInteraction = false;
      setTrackTextEvents([]);
      setModelResults([]);
      modelFilterOnly = false;
      if (modelOnlyCheckbox) modelOnlyCheckbox.checked = false;
      renderClassFilters();

      if (sceneMode === 'fused_multi_camera') {
        setupMultiVideoRail(cameraSources);
      } else {
        clearMultiVideoRail();
      }
      setStatus('已选择场景，点击"加载并绘制"开始。');
    }

    function renderChat() {
      if (!chatMessagesEl) return;
      chatMessagesEl.innerHTML = chatMessages.map(msg => {
        const cls = msg.role === 'user' ? 'chat-msg user' : 'chat-msg agent';
        const tag = msg.role === 'user' ? '我' : 'Agent';
        const safeText = escapeHtml(String(msg.text || '')).replace(/\n/g, '<br>');
        return `<div class="${cls}"><span class="tag">${tag}</span><div class="bubble">${safeText}</div></div>`;
      }).join('');
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    function normalizeTrackTextEvents(data) {
      if (!data || !Array.isArray(data.track_text_events)) return [];

      const normalizeInteractionClass = (raw) => {
        const v = String(raw || '').trim().toLowerCase();
        if (v === 'routine' || v === 'alert' || v === 'none') return v;
        if (!v) return 'none';
        if (/alert|高危|危险|风险|扭打|推搡|追逐|尾随|抢夺|跌倒/.test(v)) return 'alert';
        if (/routine|常规|同行|交谈|擦肩|打招呼|递送|并排/.test(v)) return 'routine';
        return 'none';
      };

      const normalizeInteractionEvents = (raw) => {
        if (!Array.isArray(raw)) return [];
        return raw.map((ev, evIdx) => {
          if (!ev || typeof ev !== 'object') return null;
          const frameRaw = Number((ev && ev.frame) || (ev && ev.frame_idx) || (ev && ev.frame_id));
          const startFrameRaw = Number((ev && ev.start_frame) || (ev && ev.start) || (ev && ev.frame_start));
          const endFrameRaw = Number((ev && ev.end_frame) || (ev && ev.end) || (ev && ev.frame_end));
          const type = normalizeInteractionClass((ev && (ev.type || ev.label || ev.interaction_class)) || '');
          const detail = (typeof ev.detail === 'string' && ev.detail.trim())
            ? ev.detail.trim()
            : ((typeof ev.reason === 'string' && ev.reason.trim()) ? ev.reason.trim() : '');
          return {
            key: `ie-${evIdx}`,
            frame: Number.isFinite(frameRaw) ? Math.round(frameRaw) : null,
            start_frame: Number.isFinite(startFrameRaw) ? Math.round(startFrameRaw) : null,
            end_frame: Number.isFinite(endFrameRaw) ? Math.round(endFrameRaw) : null,
            type,
            detail,
          };
        }).filter(Boolean);
      };

      return data.track_text_events
        .map((item, idx) => {
          if (!item || typeof item !== 'object') return null;
          const trackId = Number(item.track_id);
          const tStart = Number(item.t_start);
          const tEnd = Number(item.t_end);
          const confidence = Number(item.confidence);
          const summary = (typeof item.summary === 'string' && item.summary.trim()) ? item.summary.trim() : `轨迹${trackId}文本事件`;
          const overallSummary = (typeof item.overall_summary === 'string' && item.overall_summary.trim())
            ? item.overall_summary.trim()
            : summary;
          const selfAction = (typeof item.self_action === 'string' && item.self_action.trim())
            ? item.self_action.trim()
            : '';
          const rawInteractions = Array.isArray(item.interactions) ? item.interactions : [];
          const interactions = rawInteractions.map((it, itIdx) => {
            if (!it || typeof it !== 'object') return null;
            const withTrackId = Number(it.with_track_id);
            const relation = (typeof it.relation === 'string' && it.relation.trim()) ? it.relation.trim() : '';
            const detail = (typeof it.detail === 'string' && it.detail.trim()) ? it.detail.trim() : '';
            const withClass = (typeof it.with_class === 'string' && it.with_class.trim()) ? it.with_class.trim() : '';
            return {
              key: `${trackId}-${idx}-interaction-${itIdx}`,
              with_track_id: Number.isFinite(withTrackId) ? withTrackId : null,
              with_class: withClass,
              relation,
              detail,
            };
          }).filter(Boolean);
          const fusionSummary = (typeof item.fusion_summary === 'string' && item.fusion_summary.trim())
            ? item.fusion_summary.trim()
            : summary;
          const fusionMode = (typeof item.fusion_mode === 'string' && item.fusion_mode.trim())
            ? item.fusion_mode.trim().toLowerCase()
            : '';
          const descriptionSource = (typeof item.description_source === 'string' && item.description_source.trim())
            ? item.description_source.trim().toLowerCase()
            : 'rule_fallback';
          const descriptionCameraId = (typeof item.description_camera_id === 'string' && item.description_camera_id.trim())
            ? item.description_camera_id.trim()
            : '';
          const descriptionVideoPath = (typeof item.description_video_path === 'string' && item.description_video_path.trim())
            ? item.description_video_path.trim()
            : '';
          const interactionClass = normalizeInteractionClass(item.interaction_class);
          const interactionFrameRaw = Number(item.interaction_frame);
          const interactionFrame = Number.isFinite(interactionFrameRaw) ? Math.round(interactionFrameRaw) : null;
          const interactionDetail = (typeof item.interaction_detail === 'string' && item.interaction_detail.trim())
            ? item.interaction_detail.trim()
            : '';
          const interactionType = (typeof item.interaction_type === 'string' && item.interaction_type.trim())
            ? item.interaction_type.trim()
            : '';
          const interactionEvents = normalizeInteractionEvents(item.interaction_events);
          const classLabel = (typeof item.class_label === 'string' && item.class_label.trim()) ? item.class_label.trim() : '目标';
          const rawMultiCamera = Array.isArray(item.multi_camera_descriptions) ? item.multi_camera_descriptions : [];
          const multiCameraDescriptions = rawMultiCamera.map((mc, mIdx) => {
            if (!mc || typeof mc !== 'object') return null;
            const camId = (typeof mc.camera_id === 'string' && mc.camera_id.trim()) ? mc.camera_id.trim() : '';
            const mcSummary = (typeof mc.summary === 'string' && mc.summary.trim()) ? mc.summary.trim() : '';
            const mcSource = (typeof mc.description_source === 'string' && mc.description_source.trim())
              ? mc.description_source.trim().toLowerCase()
              : 'rule_fallback';
            const mcVideoPath = (typeof mc.video_path === 'string' && mc.video_path.trim()) ? mc.video_path.trim() : '';
            const mcImageDir = (typeof mc.image_dir === 'string' && mc.image_dir.trim()) ? mc.image_dir.trim() : '';
            const mcCameraScore = Number(mc.camera_score);
            const mcInteractionClass = normalizeInteractionClass(mc.interaction_class);
            const mcInteractionFrameRaw = Number(mc.interaction_frame);
            const mcInteractionFrame = Number.isFinite(mcInteractionFrameRaw) ? Math.round(mcInteractionFrameRaw) : null;
            const mcInteractionDetail = (typeof mc.interaction_detail === 'string' && mc.interaction_detail.trim())
              ? mc.interaction_detail.trim()
              : '';
            const mcInteractionEvents = normalizeInteractionEvents(mc.interaction_events);
            const rawBoxes = Array.isArray(mc.target_boxes) ? mc.target_boxes : [];
            const targetBoxes = rawBoxes.map((box, boxIdx) => {
              if (!box || typeof box !== 'object') return null;
              const frame = Number(box.frame);
              const x1 = Number(box.x1);
              const y1 = Number(box.y1);
              const x2 = Number(box.x2);
              const y2 = Number(box.y2);
              return {
                key: `${trackId}-${idx}-cam-${mIdx}-box-${boxIdx}`,
                frame: Number.isFinite(frame) ? Math.round(frame) : null,
                x1: Number.isFinite(x1) ? x1 : null,
                y1: Number.isFinite(y1) ? y1 : null,
                x2: Number.isFinite(x2) ? x2 : null,
                y2: Number.isFinite(y2) ? y2 : null,
              };
            }).filter(Boolean);
            const rawBoxSeries = Array.isArray(mc.target_box_series) ? mc.target_box_series : [];
            const targetBoxSeries = rawBoxSeries.map((box, boxIdx) => {
              if (!box || typeof box !== 'object') return null;
              const frame = Number(box.frame);
              const x1 = Number(box.x1);
              const y1 = Number(box.y1);
              const x2 = Number(box.x2);
              const y2 = Number(box.y2);
              return {
                key: `${trackId}-${idx}-cam-${mIdx}-series-${boxIdx}`,
                frame: Number.isFinite(frame) ? Math.round(frame) : null,
                x1: Number.isFinite(x1) ? x1 : null,
                y1: Number.isFinite(y1) ? y1 : null,
                x2: Number.isFinite(x2) ? x2 : null,
                y2: Number.isFinite(y2) ? y2 : null,
              };
            }).filter(Boolean);
            return {
              key: `${trackId}-${idx}-cam-${mIdx}`,
              camera_id: camId,
              summary: mcSummary,
              description_source: mcSource,
              video_path: mcVideoPath,
              image_dir: mcImageDir,
              interaction_class: mcInteractionClass,
              interaction_frame: mcInteractionFrame,
              interaction_detail: mcInteractionDetail,
              interaction_events: mcInteractionEvents,
              camera_score: Number.isFinite(mcCameraScore) ? Math.max(0, Math.min(1, mcCameraScore)) : null,
              target_boxes: targetBoxes,
              target_box_series: targetBoxSeries,
            };
          }).filter(Boolean);
          const fusionDetails = (item.fusion_details && typeof item.fusion_details === 'object') ? item.fusion_details : {};
          const fusedRangeRaw = item.fused_range
            || (fusionDetails && typeof fusionDetails.fused_range === 'object' ? fusionDetails.fused_range : null)
            || (fusionDetails && fusionDetails.raw && typeof fusionDetails.raw === 'object' && typeof fusionDetails.raw.fused_range === 'object'
              ? fusionDetails.raw.fused_range
              : null);
          const fusedRange = (fusedRangeRaw && typeof fusedRangeRaw === 'object')
            ? {
                start_frame: Number.isFinite(Number(fusedRangeRaw.start_frame)) ? Math.round(Number(fusedRangeRaw.start_frame)) : null,
                end_frame: Number.isFinite(Number(fusedRangeRaw.end_frame)) ? Math.round(Number(fusedRangeRaw.end_frame)) : null,
              }
            : null;
          const cameraScores = (item.camera_scores && typeof item.camera_scores === 'object') ? item.camera_scores : {};
          const behaviorMatch = fusionSummary.match(/呈现([^，,。]+)/);
          const behavior = behaviorMatch && behaviorMatch[1] ? behaviorMatch[1].trim() : classLabel;
          const evidenceFrames = normalizeEvidenceFrames(Array.isArray(item.evidence_frames) ? item.evidence_frames : []);
          if (!Number.isFinite(trackId) || !Number.isFinite(tStart) || !Number.isFinite(tEnd)) return null;
          const lo = Math.min(tStart, tEnd);
          const hi = Math.max(tStart, tEnd);
          return {
            key: `${trackId}-${idx}`,
            track_id: trackId,
            class_label: classLabel,
            behavior,
            t_start: lo,
            t_end: hi,
            summary: overallSummary,
            overall_summary: overallSummary,
            self_action: selfAction,
            interactions,
            fusion_mode: fusionMode,
            fusion_summary: fusionSummary,
            description_source: descriptionSource,
            description_camera_id: descriptionCameraId,
            description_video_path: descriptionVideoPath,
            interaction_class: interactionClass,
            interaction_frame: interactionFrame,
            interaction_detail: interactionDetail,
            interaction_type: interactionType,
            interaction_events: interactionEvents,
            fused_range: fusedRange,
            multi_camera_descriptions: multiCameraDescriptions,
            fusion_details: fusionDetails,
            camera_scores: cameraScores,
            confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
            evidence_frames: evidenceFrames,
          };
        })
        .filter(Boolean);
    }

    function formatInteractionCategoryText(rawText, eventType) {
      const text = String(rawText || '').trim();
      if (!text) return '无';
      if (text.toLowerCase() === 'none' || text === '无' || text === '无交互') return '无';
      return text;
    }

    function getInteractionWarningLevel(rawText) {
      const text = String(rawText || '').trim();
      if (!text || text.toLowerCase() === 'none' || text === '无' || text === '无交互') return 0;
      if (['擦肩而过', '并排行走'].some((label) => text.includes(label))) return 1;
      if (['驻足交谈', '递送物品', '常规肢体接触', '同向跟随', '跟随'].some((label) => text.includes(label))) return 2;
      if (['异常聚集', '暴力冲突'].some((label) => text.includes(label))) return 3;
      return 1;
    }

    function formatInteractionWarningLevelLabel(level) {
      const n = Number(level);
      if (!Number.isFinite(n) || n <= 0) return '无预警';
      if (n === 1) return '一级预警';
      if (n === 2) return '二级预警';
      return '三级预警';
    }

    function getInteractionOpacity(confidence) {
      const conf = Number(confidence);
      if (!Number.isFinite(conf)) return 0.72;
      return Math.max(0.28, Math.min(1, 0.34 + conf * 0.66));
    }

    function normalizeEvidenceFrames(frames) {
      if (!Array.isArray(frames) || !frames.length) return [];
      const snapped = frames
        .map(Number)
        .filter(Number.isFinite)
        .map((f) => Math.round(f / ANNOTATED_FRAME_STEP) * ANNOTATED_FRAME_STEP)
        .map((f) => Math.round(f));
      const unique = Array.from(new Set(snapped));
      unique.sort((a, b) => a - b);
      return unique;
    }
