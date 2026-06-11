    function renderSemanticBoundaryOverlay(overlayData) {
      if (!semanticOverlayEl) return;
      const useBoundaryRing = semanticLayoutMode === SEMANTIC_LAYOUTS.BOUNDARY_RING;
      if (!useBoundaryRing) {
        semanticOverlayEl.classList.remove('is-boundary-v1', 'is-boundary-ring');
        semanticOverlayEl.style.display = 'none';
        semanticOverlayEl.innerHTML = '';
        return;
      }

      const items = (overlayData && Array.isArray(overlayData.boundary_items))
        ? overlayData.boundary_items
        : [];
      if (!items.length) {
        semanticOverlayEl.classList.remove('is-boundary-v1');
        semanticOverlayEl.classList.add('is-boundary-ring');
        semanticOverlayEl.style.display = 'none';
        semanticOverlayEl.innerHTML = '';
        return;
      }

      const buckets = { top: [], right: [], bottom: [], left: [] };
      items.forEach((item) => {
        const side = String(item.side || '').toLowerCase();
        if (side === 'top' || side === 'right' || side === 'bottom' || side === 'left') {
          buckets[side].push(item);
        } else {
          buckets.right.push(item);
        }
      });
      Object.keys(buckets).forEach((k) => {
        buckets[k].sort((a, b) => {
          const oa = Number(a.order_key);
          const ob = Number(b.order_key);
          if (Number.isFinite(oa) && Number.isFinite(ob)) return oa - ob;
          return String(a.key || '').localeCompare(String(b.key || ''));
        });
      });

      const renderCards = (arr, sideLabel) => arr.map((item) => {
        const conf = Number(item.confidence);
        const confPct = Number.isFinite(conf) ? Math.round(Math.max(0, Math.min(1, conf)) * 100) : 70;
        const activeCls = activeTrackTextEventKey === item.key ? ' is-active' : '';
        const tStart = Number(item.t_start);
        const tEnd = Number(item.t_end);
        const rangeText = (Number.isFinite(tStart) && Number.isFinite(tEnd))
          ? `${Math.min(tStart, tEnd).toFixed(1)}s-${Math.max(tStart, tEnd).toFixed(1)}s`
          : '-';
        const pairingRows = Array.isArray(item.pairings) && item.pairings.length
          ? item.pairings.map((p) => {
              const kindCls = p.kind === 'consistent' ? 'consistent' : (p.kind === 'conflict' ? 'conflict' : (p.kind === 'incomplete' ? 'incomplete' : 'none'));
              const kindLabel = p.kind === 'consistent' ? '双向一致' : (p.kind === 'conflict' ? '双向冲突' : (p.kind === 'incomplete' ? '单侧交互' : '强接近候选'));
              const scoreText = Number.isFinite(Number(p.score)) ? Math.round(Math.max(0, Math.min(1.5, Number(p.score))) * 100) : 0;
              return `<div class="pairing-row">
                <span class="pairing-kind ${kindCls}">${escapeHtml(kindLabel)}</span>
                <span class="pairing-node is-seed">ID ${escapeHtml(item.track_id)}</span>
                <span class="pairing-arrow">→</span>
                <span class="pairing-node is-candidate">ID ${escapeHtml(p.track_id)}</span>
                <span style="color:#8faece;">${escapeHtml(scoreText + '%')}</span>
              </div>`;
            }).join('')
          : '<div class="pairing-row"><span class="pairing-kind weak">未找到候选对象</span></div>';
        return `<div class="semantic-overlay-item${activeCls}" data-event-key="${escapeHtml(item.key || '')}">
          <div class="row1">
            <span>轨迹 ${escapeHtml(item.track_id)} · ${escapeHtml(item.class_label || '目标')}</span>
            <span>${escapeHtml(rangeText)} · ${confPct}%</span>
          </div>
          <div class="summary">${escapeHtml(item.text || '')}</div>
          <div class="pairing-block">
            ${pairingRows}
          </div>
        </div>`;
      }).join('');

      semanticOverlayEl.classList.remove('is-boundary-v1');
      semanticOverlayEl.classList.add('is-boundary-ring');
      semanticOverlayEl.style.display = 'block';
      semanticOverlayEl.innerHTML = `
        <div class="semantic-overlay-title semantic-ring-title">轨迹语义标签 · 方案B（四边外排文本环）</div>
        <div class="semantic-ring-rail top">${renderCards(buckets.top, '上边')}</div>
        <div class="semantic-ring-rail left">${renderCards(buckets.left, '左边')}</div>
        <div class="semantic-ring-rail right">${renderCards(buckets.right, '右边')}</div>
        <div class="semantic-ring-rail bottom">${renderCards(buckets.bottom, '下边')}</div>
      `;
    }

    function renderStorylineOverview() {
      if (!storylineOverviewPanelEl || !storylineOverviewRowsEl || !storylineOverviewAxisEl) return;
      const enableStoryline = semanticLayoutMode === SEMANTIC_LAYOUTS.STORYLINE_GLOBAL;
      storylineOverviewPanelEl.hidden = !enableStoryline;
      if (!enableStoryline) {
        storylineOverviewRowsEl.innerHTML = '';
        storylineOverviewAxisEl.innerHTML = '';
        if (storylineOverviewMetaEl) storylineOverviewMetaEl.textContent = '-';
        return;
      }

      const rowsSource = (Array.isArray(filteredTracks) && filteredTracks.length)
        ? filteredTracks
        : (Array.isArray(cachedTracks) ? cachedTracks : []);
      const events = Array.isArray(trackTextEvents) ? trackTextEvents.slice() : [];
      const maxTime = Number.isFinite(maxSec) && maxSec > 0 ? maxSec : 1;

      storylineOverviewAxisEl.innerHTML = [0, 25, 50, 75, 100].map((p) => {
        const sec = (p / 100) * maxTime;
        return `<span class="storyline-tick" style="left:${p}%;"></span><span class="storyline-tick-label" style="left:${p}%;">${sec.toFixed(0)}s</span>`;
      }).join('');

      if (!rowsSource.length) {
        storylineOverviewRowsEl.innerHTML = '<div class="storyline-empty">暂无轨迹数据。</div>';
        if (storylineOverviewMetaEl) storylineOverviewMetaEl.textContent = '0 条轨迹';
        return;
      }

      const eventByTrack = new Map();
      events.forEach((ev) => {
        const tid = Number(ev && ev.track_id);
        if (!Number.isFinite(tid)) return;
        if (!eventByTrack.has(tid)) eventByTrack.set(tid, []);
        eventByTrack.get(tid).push(ev);
      });

      const rowHtml = rowsSource.map((track) => {
        const tid = Number(track.id);
        const trackEvents = (eventByTrack.get(tid) || []).slice().sort((a, b) => Number(a.t_start) - Number(b.t_start));
        const laneEnds = [];
        const placed = [];
        const laneGap = 0.25;
        for (const ev of trackEvents) {
          const s0 = Number(ev.t_start);
          const e0 = Number(ev.t_end);
          const start = Number.isFinite(s0) ? Math.max(0, Math.min(maxTime, Math.min(s0, e0))) : 0;
          const endRaw = Number.isFinite(e0) ? Math.max(start, Math.min(maxTime, Math.max(s0, e0))) : start;
          const end = Math.max(start + 0.3, endRaw);
          let lane = 0;
          while (lane < laneEnds.length && start < laneEnds[lane] + laneGap) lane += 1;
          laneEnds[lane] = end;
          placed.push({ ev, lane, start, end });
        }

        const laneCount = Math.max(1, laneEnds.length || 1);
        const rowHeight = Math.max(52, laneCount * 58 + 8);
        const cards = placed.map((p) => {
          const leftPct = (p.start / maxTime) * 100;
          const widthPct = Math.max(8, ((p.end - p.start) / maxTime) * 100);
          const conf = Number(p.ev.confidence);
          const confPct = Number.isFinite(conf) ? Math.round(Math.max(0, Math.min(1, conf)) * 100) : 70;
          const activeCls = activeTrackTextEventKey === p.ev.key ? ' is-active' : '';
          const tRange = `${p.start.toFixed(1)}s-${p.end.toFixed(1)}s`;
          return `<div class="storyline-card${activeCls}" data-event-key="${escapeHtml(p.ev.key || '')}" style="left:${leftPct.toFixed(3)}%; width:${widthPct.toFixed(3)}%; top:${6 + p.lane * 58}px; min-height:52px;">
            <div class="title">${escapeHtml(tRange)} · ${confPct}%</div>
            <div class="text">${escapeHtml(p.ev.summary || p.ev.fusion_summary || p.ev.overall_summary || '')}</div>
          </div>`;
        }).join('');

        const classText = classLabels.get(Number(track.cls)) || `类${track.cls}`;
        return `<div class="storyline-row">
          <div class="storyline-label">ID ${escapeHtml(tid)}<br/>${escapeHtml(classText)}<br/>文本 ${placed.length}</div>
          <div class="storyline-track" style="height:${rowHeight}px;">${cards || ''}</div>
        </div>`;
      }).join('');

      storylineOverviewRowsEl.innerHTML = rowHtml || '<div class="storyline-empty">暂无文本事件。</div>';
      if (storylineOverviewMetaEl) {
        storylineOverviewMetaEl.textContent = `${rowsSource.length} 条轨迹 · ${events.length} 条文本`;
      }
    }

    function refreshSemanticOverviewPanels() {
      renderSemanticBoundaryOverlay(latestSemanticOverlayCache);
      renderStorylineOverview();
    }

    function buildCameraRadarData(ev) {
      if (!ev || typeof ev !== 'object') return [];
      const normalizeCameraId = (raw) => {
        const text = String(raw || '').trim().toUpperCase();
        if (!text) return '';
        if (/^C\d+$/.test(text)) return text;
        if (/^\d+$/.test(text)) return `C${text}`;
        return text;
      };

      const scores = {};
      const detail = ev.fusion_details && typeof ev.fusion_details === 'object' ? ev.fusion_details : null;
      const rawScores = (detail && typeof detail.camera_scores === 'object')
        ? detail.camera_scores
        : ((detail && detail.raw && typeof detail.raw.camera_scores === 'object') ? detail.raw.camera_scores : (ev.camera_scores || null));
      if (rawScores) {
        Object.keys(rawScores).forEach((key) => {
          const camId = normalizeCameraId(key);
          if (!camId) return;
          const val = Number(rawScores[key]);
          if (Number.isFinite(val)) scores[camId] = Math.max(0, Math.min(1, val));
        });
      }

      const list = Array.isArray(ev.multi_camera_descriptions) ? ev.multi_camera_descriptions : [];
      const cameras = list.map((mc, idx) => {
        if (!mc || typeof mc !== 'object') return null;
        const camId = normalizeCameraId(mc.camera_id || `CAM-${idx + 1}`) || `CAM-${idx + 1}`;
        let score = scores[camId];
        if (!Number.isFinite(score)) {
          const fallback = Number(mc.camera_score);
          score = Number.isFinite(fallback) ? Math.max(0, Math.min(1, fallback)) : null;
        }
        if (!Number.isFinite(score)) return null;
        return {
          key: `${camId}-${idx}`,
          camera_id: camId,
          score,
        };
      }).filter(Boolean);
      return cameras.sort((a, b) => b.score - a.score);
    }

    function buildCameraRadarSvg(cameras) {
      if (!Array.isArray(cameras) || cameras.length < 2) return '';
      const used = cameras.slice(0, 7);
      const n = used.length;
      const width = 250;
      const height = 196;
      const cx = 98;
      const cy = 100;
      const radius = 64;
      const rings = [0.25, 0.5, 0.75, 1.0];

      const getPoint = (ratio, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / n;
        const rr = radius * ratio;
        return [cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr];
      };

      const ringPolygons = rings.map((r) => {
        const pts = Array.from({ length: n }, (_, i) => getPoint(r, i))
          .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`)
          .join(' ');
        return `<polygon points="${pts}" fill="none" stroke="rgba(151,185,214,0.34)" stroke-width="1" />`;
      }).join('');

      const axisLines = used.map((_, i) => {
        const p = getPoint(1, i);
        return `<line x1="${cx}" y1="${cy}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="rgba(151,185,214,0.28)" stroke-width="1" />`;
      }).join('');

      const dataPoly = used.map((cam, i) => {
        const p = getPoint(Math.max(0.03, Math.min(1, Number(cam.score) || 0)), i);
        return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      }).join(' ');

      const labels = used.map((cam, i) => {
        const p = getPoint(1.18, i);
        const tx = p[0].toFixed(1);
        const ty = p[1].toFixed(1);
        const scorePct = Math.round((Number(cam.score) || 0) * 100);
        return `<text x="${tx}" y="${ty}" fill="#dceefe" font-size="10" text-anchor="middle" dominant-baseline="middle">${escapeHtml(cam.camera_id)} ${scorePct}%</text>`;
      }).join('');

      return `<svg class="track-text-radar-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="相机可靠度雷达图">
        <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="8" ry="8" fill="rgba(10,20,32,0.35)" stroke="rgba(116,164,204,0.36)" />
        ${ringPolygons}
        ${axisLines}
        <polygon points="${dataPoly}" fill="rgba(29,186,180,0.3)" stroke="rgba(123,226,255,0.92)" stroke-width="2" />
        ${used.map((cam, i) => {
          const p = getPoint(Math.max(0.03, Math.min(1, Number(cam.score) || 0)), i);
          return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="#dbffff" stroke="rgba(10,40,60,0.85)" stroke-width="1" />`;
        }).join('')}
        ${labels}
      </svg>`;
    }

    function markTextWithDiff(rawText, keepPhrases, removePhrases) {
      const src = String(rawText || '');
      if (!src) return '';
      const marks = new Array(src.length).fill(null);

      const applyPhrases = (phrases, markType, overwrite = false) => {
        const uniq = Array.from(new Set((Array.isArray(phrases) ? phrases : [])
          .map((p) => String(p || '').trim())
          .filter((p) => p.length >= 2)))
          .sort((a, b) => b.length - a.length);
        uniq.forEach((phrase) => {
          let pos = 0;
          while (pos < src.length) {
            const idx = src.indexOf(phrase, pos);
            if (idx < 0) break;
            const end = idx + phrase.length;
            for (let i = idx; i < end; i += 1) {
              if (overwrite || marks[i] === null) marks[i] = markType;
            }
            pos = idx + Math.max(1, phrase.length);
          }
        });
      };

      applyPhrases(keepPhrases, 'keep', false);
      applyPhrases(removePhrases, 'remove', true);

      let out = '';
      let i = 0;
      while (i < src.length) {
        const mark = marks[i];
        let j = i + 1;
        while (j < src.length && marks[j] === mark) j += 1;
        const chunk = escapeHtml(src.slice(i, j));
        if (mark === 'keep') {
          out += `<span class="diff-keep">${chunk}</span>`;
        } else if (mark === 'remove') {
          out += `<span class="diff-remove">${chunk}</span>`;
        } else {
          out += chunk;
        }
        i = j;
      }
      return out;
    }

    function buildSemanticDiffHtml(ev, cameras) {
      const fusedText = String((ev && (ev.fusion_summary || ev.overall_summary || ev.summary)) || '').trim();
      if (!fusedText && (!Array.isArray(cameras) || !cameras.length)) return '';

      const fusedTokens = Array.from(new Set((fusedText.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [])))
        .sort((a, b) => b.length - a.length)
        .slice(0, 14);

      const cameraItems = (Array.isArray(cameras) ? cameras : []).slice(0, 6).map((cam) => {
        const rawText = String(cam.raw_text || '').trim();
        const hallucination = Array.isArray(cam.hallucination) ? cam.hallucination : [];
        const keep = fusedTokens.filter((t) => rawText.includes(t) && !hallucination.some((h) => String(h).includes(t)));
        const diffHtml = rawText
          ? markTextWithDiff(rawText, keep, hallucination)
          : '<span style="opacity:0.72;">无单摄描述</span>';
        return `<div class="track-text-diff-item">
          <div class="track-text-diff-cam">${escapeHtml(cam.camera_id)}</div>
          <div class="track-text-diff-text">${diffHtml}</div>
        </div>`;
      }).join('');

      return `<div class="track-text-diff">
        <div class="track-text-diff-head">语义差异印证（Fusion vs 单摄）</div>
        <div class="track-text-diff-global">${escapeHtml(fusedText || '无融合描述')}</div>
        ${cameraItems || '<div class="track-text-radar-empty">暂无可用于差异对比的单摄描述。</div>'}
      </div>`;
    }

    function renderTrackTextEvents() {
      if (!trackTextPanelEl) return;
      const hasTrackText = Array.isArray(getVisibleTrackTextEvents()) && getVisibleTrackTextEvents().length > 0;
      const hideTextPanels = semanticLayoutMode === SEMANTIC_LAYOUTS.AGENT_ADAPTIVE_COLOR
        && !hasAgentInteraction
        && !hasTrackText;
      trackTextPanelEl.style.display = hideTextPanels ? 'none' : '';
      if (hideTextPanels) {
        refreshSemanticOverviewPanels();
        return;
      }
      if (!Array.isArray(getVisibleTrackTextEvents()) || getVisibleTrackTextEvents().length === 0) {
        trackTextPanelEl.innerHTML = '<div class="track-text-title">交互段（轨迹直显）</div><div class="track-text-empty">等待 Agent 返回交互段...</div>';
        refreshSemanticOverviewPanels();
        return;
      }
      const formatDescriptionSourceLabel = (raw) => {
        const v = String(raw || '').trim().toLowerCase();
        if (!v) return '未标注';
        if (v === 'rule_fallback') return '规则回退';
        if (v === 'agent_fusion' || v === 'agent') return 'Agent';
        if (v === 'multi_camera') return '多相机融合';
        if (v === 'single_camera') return '单相机';
        return v;
      };

      const formatFusionModeLabel = (raw) => {
        const v = String(raw || '').trim().toLowerCase();
        if (!v) return '未标注';
        if (v === 'multi_camera') return '多相机';
        if (v === 'single_camera') return '单相机';
        if (v === 'agent_fusion') return 'Agent融合';
        return v;
      };

      const getCameraHue = (cameraId, idx) => {
        const m = String(cameraId || '').match(/(\d+)/);
        const n = m ? Number(m[1]) : NaN;
        const palette = [188, 206, 168, 34, 18, 214, 96];
        if (Number.isFinite(n) && n > 0) return palette[(n - 1) % palette.length];
        return palette[Math.abs(Number(idx) || 0) % palette.length];
      };

      const visibleTrackTextEvents = getVisibleTrackTextEvents();
      const listHtml = visibleTrackTextEvents.map((ev, evIdx) => {
        const confPct = Math.max(0, Math.min(100, Math.round((Number(ev.confidence) || 0) * 100)));
        const activeCls = activeTrackTextEventKey === ev.key ? ' is-active' : '';
        const fusedText = ev.fusion_summary || ev.overall_summary || ev.summary || '';
        const t0 = Number(ev.t_start);
        const t1 = Number(ev.t_end);
        const lo = Number.isFinite(t0) && Number.isFinite(t1) ? Math.min(t0, t1) : 0;
        const hi = Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(t0, t1) : lo;
        const durationSec = Math.max(0, hi - lo);
        const timeText = `${lo.toFixed(1)}s-${hi.toFixed(1)}s`;
        const interactionCategoryText = formatInteractionCategoryText(
          ev.interaction_type || ev.interaction_detail || ev.behavior,
          ev.interaction_class
        );
        const warningLevel = getInteractionWarningLevel(interactionCategoryText);
        const warningText = formatInteractionWarningLevelLabel(warningLevel);
        const interactionOpacity = getInteractionOpacity(ev.confidence);
        const interactionBgAlpha = Math.max(0.12, Math.min(0.55, interactionOpacity * 0.55));
        const interactionBorderAlpha = Math.max(0.18, Math.min(0.7, interactionOpacity * 0.7));
        const classText = ev.class_label || '目标';
        const radarCameras = buildCameraRadarData(ev);
        const radarSvg = buildCameraRadarSvg(radarCameras);
        const warningTagClass = warningLevel >= 3
          ? ' is-warning-high'
          : (warningLevel === 2 ? ' is-warning-mid' : (warningLevel === 1 ? ' is-warning-low' : ''));
        const warningItemClass = warningLevel >= 3
          ? ' is-warning-high'
          : (warningLevel === 2 ? ' is-warning-mid' : (warningLevel === 1 ? ' is-warning-low' : ''));
        const collapsedCls = activeTrackTextEventKey === ev.key ? '' : ' is-collapsed';

        return `<div class="track-text-item${activeCls}${collapsedCls}${warningItemClass}" data-event-key="${escapeHtml(ev.key)}">
          <div class="track-text-head">
            <div class="track-text-head-main">
              <div class="track-text-event-title">轨迹 ID${escapeHtml(ev.track_id)} · ${escapeHtml(classText)}</div>
              <div class="track-text-event-meta">
                <span>${escapeHtml(timeText)}</span>
                <span class="track-text-meta-dot"></span>
                <span>${escapeHtml(durationSec.toFixed(1) + 's')}</span>
              </div>
            </div>
            <div class="track-text-confidence">
              <span class="track-text-confidence-value">${confPct}%</span>
              <span class="track-text-confidence-label">置信度</span>
            </div>
          </div>
          <div class="track-text-toggle">点击展开详情</div>
          <div class="track-text-chip-row">
            <span class="track-text-tag is-soft" style="opacity:${interactionOpacity}; background:rgba(44,108,151,${interactionBgAlpha}); border-color:rgba(100,172,222,${interactionBorderAlpha});">${escapeHtml(interactionCategoryText)}</span>
            <span class="track-text-tag${warningTagClass}">${escapeHtml(warningText)}</span>
          </div>
          <div class="track-text-summary-card">
            <div class="track-text-summary-label">事件摘要</div>
            <div class="track-text-summary">${escapeHtml(fusedText)}</div>
          </div>
          <div class="track-text-xai">
            <div class="track-text-xai-head">
              <div class="track-text-xai-title">多摄视角可靠度雷达</div>
              <div class="track-text-xai-subtitle">用于比较不同摄像头对该事件的支持强度</div>
            </div>
            <div class="track-text-radar-wrap">
              ${radarSvg || '<div class="track-text-radar-empty">相机数量不足，暂不绘制雷达图（至少需要 2 个相机评分）。</div>'}
            </div>
          </div>
        </div>`;
      }).join('');
      trackTextPanelEl.innerHTML = `<div class="track-text-title">交互段（轨迹直显）</div><div class="track-text-list">${listHtml}</div>`;
      updateRailEventOverlays(secToSnappedFrame(currentSec));
      refreshSemanticOverviewPanels();
    }

    function setTrackTextEvents(events) {
      const normalized = Array.isArray(events) ? events : [];
      const trackMap = new Map((Array.isArray(cachedTracks) ? cachedTracks : []).map((t) => [Number(t.id), t]));
      trackTextEvents = normalized.map((ev) => {
        const track = trackMap.get(Number(ev.track_id));
        const resolved = resolveEventSecRangeForTrack(ev, track);
        if (!resolved) return ev;
        return {
          ...ev,
          t_start: resolved[0],
          t_end: resolved[1],
        };
      });
      activeTrackTextEventKey = null;
      renderTrackTextEvents();
      updateRailEventOverlays(secToSnappedFrame(currentSec));
    }


    function scrollTrackTextEventIntoView(eventKey) {
      if (!trackTextPanelEl || !eventKey) return;
      const target = trackTextPanelEl.querySelector(`[data-event-key="${CSS.escape(String(eventKey))}"]`);
      if (!target || !target.scrollIntoView) return;
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function focusTrackTextEvent(eventKey) {
      const target = trackTextEvents.find((ev) => ev.key === eventKey);
      if (!target) return;

      activeTrackTextEventKey = target.key;
      const trackId = Number(target.track_id);
      const track = Array.isArray(cachedTracks) ? cachedTracks.find((t) => Number(t.id) === trackId) : null;
      const resolvedRange = resolveEventSecRangeForTrack(target, track);
      const isBoxScoped = boxSelectionActive && boxSelectedTrackIds.size > 0;
      if (Number.isFinite(trackId)) {
        if (isBoxScoped) {
          highlightTrackIds = new Set(boxSelectedTrackIds);
          anomalyTrackIds.forEach((id) => highlightTrackIds.add(id));
        } else {
          baseHighlightTrackIds = new Set([trackId]);
          highlightTrackIds = new Set([trackId]);
          anomalyTrackIds.forEach((id) => highlightTrackIds.add(id));
        }
      }

      const lo = resolvedRange ? resolvedRange[0] : Math.max(0, Math.min(maxSec, Number(target.t_start) || 0));
      const hi = resolvedRange ? resolvedRange[1] : Math.max(0, Math.min(maxSec, Number(target.t_end) || 0));
      const center = (lo + hi) * 0.5;
      if (isBoxScoped) {
        clusterFocusTimeRange = Array.isArray(boxSelectedTimeRange) ? boxSelectedTimeRange : [Math.min(lo, hi), Math.max(lo, hi)];
        setAgentSummaryOverlay(clusterFocusTimeRange, Array.from(boxSelectedTrackIds));
      } else {
        clusterFocusTimeRange = [Math.min(lo, hi), Math.max(lo, hi)];
        setAgentSummaryOverlay(clusterFocusTimeRange, [trackId]);
      }

      const snappedFrame = secToSnappedFrame(center);
      const snappedSec = snappedFrameToSec(snappedFrame);
      currentSec = snappedSec;
      if (timeSlider) timeSlider.value = String(snappedSec);
      updateTimeLabel(snappedSec);
      performSeek(snappedSec);

      setAgentStatus(`已定位轨迹 ${trackId}（${Math.min(lo, hi).toFixed(1)}s-${Math.max(lo, hi).toFixed(1)}s）`);
      applyFiltersAndRender();
      renderTrackTextEvents();
      scrollTrackTextEventIntoView(target.key);
    }

    function normalizeTrajectoryEvidence(data) {
      if (!data || !Array.isArray(data.trajectoryEvidence)) return [];
      return data.trajectoryEvidence
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const ids = Array.isArray(item.ids)
            ? item.ids.map(Number).filter(Number.isFinite)
            : [];
          const score = Number(item.score);
          const scoreValue = Number.isFinite(score) ? score : null;
          const type = typeof item.type === 'string' ? item.type : 'evidence';
          const label = typeof item.label === 'string' && item.label.trim()
            ? item.label.trim()
            : type;
          const rawRange = Array.isArray(item.timeSecRange) && item.timeSecRange.length === 2
            ? item.timeSecRange
            : null;
          let timeSecRange = null;
          if (rawRange) {
            const t0 = Number(rawRange[0]);
            const t1 = Number(rawRange[1]);
            if (Number.isFinite(t0) && Number.isFinite(t1)) {
              timeSecRange = [Math.min(t0, t1), Math.max(t0, t1)];
            }
          }
          return { type, label, ids, score: scoreValue, timeSecRange };
        })
        .filter(Boolean)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    function pickBestTrajectoryEvidence(evidenceList) {
      if (!Array.isArray(evidenceList) || !evidenceList.length) return null;
      for (const item of evidenceList) {
        if (item && item.ids && item.ids.length) return item;
      }
      return evidenceList[0] || null;
    }

    function buildTrajectoryEvidenceSummaryText(data) {
      const evidenceList = normalizeTrajectoryEvidence(data);
      if (!evidenceList.length) return '';
      const topItems = evidenceList.slice(0, 4);
      const lines = ['轨迹证据(Top):'];
      topItems.forEach((ev, i) => {
        const scoreText = Number.isFinite(ev.score) ? ev.score.toFixed(2) : '--';
        const idText = ev.ids.length ? ev.ids.slice(0, 8).join(',') : '-';
        const rangeText = (ev.timeSecRange && ev.timeSecRange.length === 2)
          ? `${ev.timeSecRange[0].toFixed(1)}s~${ev.timeSecRange[1].toFixed(1)}s`
          : '-';
        lines.push(`${i + 1}. ${ev.label} | score=${scoreText} | ids=${idText} | t=${rangeText}`);
      });
      return lines.join('\n');
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function appendAgentResponseToChat(data) {
      if (!data || typeof data !== 'object') return;
      const confidenceText = (data.confidence && typeof data.confidence === 'object')
        ? `轨迹置信度: ${Number.isFinite(Number(data.confidence.trajectory)) ? Number(data.confidence.trajectory).toFixed(3) : '--'}，最终置信度: ${Number.isFinite(Number(data.confidence.final)) ? Number(data.confidence.final).toFixed(3) : '--'}，模式: ${data.reasoningMode || 'unknown'}`
        : '';
      if (confidenceText) {
        chatMessages.push({ role: 'agent', text: confidenceText });
      }
      const evidenceText = buildTrajectoryEvidenceSummaryText(data);
      if (evidenceText) {
        chatMessages.push({ role: 'agent', text: evidenceText });
      }
      if (data.objectiveFacts && typeof data.objectiveFacts === 'object') {
        const jsonText = JSON.stringify(data.objectiveFacts, null, 2);
        chatMessages.push({ role: 'agent', text: `提取事实(JSON):
${jsonText}` });
      }
      if (data.message) {
        chatMessages.push({ role: 'agent', text: data.message });
      }
      if (Array.isArray(data.track_text_events) && data.track_text_events.length) {
        chatMessages.push({ role: 'agent', text: `已生成 ${data.track_text_events.length} 条交互段，可在下方面板点击联动。` });
      }
      renderChat();
    }

    async function captureScreenshot() {

      if (!chkScreenshot || !chkScreenshot.checked) return null;
      const v = await loadVideo();
      if (!v || !v.videoWidth || !v.videoHeight) return null;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    }

    async function captureSceneEvidence() {
      if (!chkScreenshot || !chkScreenshot.checked) return null;
      const primary = await captureScreenshot();
      if (primary) return primary;

      // Fused multi-camera scenes may not have VIDEO_SRC; fallback to XY/deck canvas snapshot.
      try {
        if (frameXYCanvasEl && frameXYCanvasEl.width > 0 && frameXYCanvasEl.height > 0) {
          return frameXYCanvasEl.toDataURL('image/png');
        }
      } catch (e) {
        console.warn('capture frameXYCanvas failed', e);
      }

      try {
        const deckCanvas = document.querySelector('#deck-canvas canvas');
        if (deckCanvas && deckCanvas.width > 0 && deckCanvas.height > 0) {
          return deckCanvas.toDataURL('image/png');
        }
      } catch (e) {
        console.warn('capture deck canvas failed', e);
      }
      return null;
    }

    function buildFusedCameraContext() {
      if (!currentScene || getSceneMode(currentScene) !== 'fused_multi_camera') return [];
      return getSceneCameraSources(currentScene).map((scene) => {
        const camNum = extractWildtrackCameraNum(scene);
        return {
          sceneId: scene.sceneId || scene.scene_id || null,
          cameraId: String(scene.cameraId || scene.camera_id || (camNum ? ('C' + camNum) : '') || '').trim().toUpperCase() || null,
          videoPath: toWebAssetPath(scene.videoPath || scene.video_path || getWildtrackRebuiltVideoPath(scene) || '') || null,
          tracksPath: toWebAssetPath(scene.tracksPath || scene.tracks_path || '') || null,
          imageDir: toWebAssetPath(scene.imageDir || scene.image_dir || '') || null,
          fps: Number(scene.fps) || ACTIVE_FPS,
          frameCount: Number(scene.frameCount != null ? scene.frameCount : scene.frame_count) || null,
          duration: Number(scene.duration) || null,
          frameOffset: Number(scene.frameOffset != null ? scene.frameOffset : scene.frame_offset) || 0,
        };
      }).filter(x => !!x.sceneId || !!x.cameraId);
    }

    function normalizeBoxRect(rect) {
      if (!rect) return null;
      const x0 = Number(rect.startX);
      const y0 = Number(rect.startY);
      const x1 = Number(rect.endX);
      const y1 = Number(rect.endY);
      if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
      return {
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        right: Math.max(x0, x1),
        bottom: Math.max(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      };
    }

    function getDeckViewportProjector() {
      if (!deckgl || !deckgl.viewManager || typeof deckgl.viewManager.getViewports !== 'function') return null;
      const viewports = deckgl.viewManager.getViewports();
      if (!Array.isArray(viewports) || !viewports.length) return null;
      const viewport = viewports[0];
      if (!viewport || typeof viewport.project !== 'function') return null;
      return viewport;
    }

    function getSelectionWorldTransform() {
      if (!filteredTracks.length) return null;
      const { minX, maxX, minY, maxY } = computeBounds();
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      return {
        toWorldX: (v) => v - centerX,
        toWorldY: (v) => centerY - v,
        toWorldT: (sec) => sec * TIME_STRETCH,
      };
    }

    function collectTrackIdsInBox(rect) {
      const box = normalizeBoxRect(rect);
      const viewport = getDeckViewportProjector();
      const transform = getSelectionWorldTransform();
      if (!box || !viewport || !transform || !Array.isArray(filteredTracks) || !filteredTracks.length) return new Set();
      const { toWorldX, toWorldY, toWorldT } = transform;
      const selected = new Set();
      filteredTracks.forEach((track) => {
        const pts = Array.isArray(track.points) ? track.points : [];
        if (!pts.length) return;
        const step = Math.max(1, Math.floor(pts.length / 32));
        const sampleIdx = new Set([0, pts.length - 1]);
        for (let i = 0; i < pts.length; i += step) sampleIdx.add(i);
        for (const idx of sampleIdx) {
          const p = pts[idx];
          if (!p) continue;
          const sec = Math.max(0, (Number(p.frame) - (frameRange.min || 0)) / Math.max(1e-6, ACTIVE_FPS));
          const pos = [toWorldX(Number(p.x) || 0), toWorldY(Number(p.y) || 0), toWorldT(sec) + 0.8];
          const projected = viewport.project(pos);
          const sx = Array.isArray(projected) ? Number(projected[0]) : NaN;
          const sy = Array.isArray(projected) ? Number(projected[1]) : NaN;
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
          if (sx >= box.left && sx <= box.right && sy >= box.top && sy <= box.bottom) {
            selected.add(Number(track.id));
            break;
          }
        }
      });
      return selected;
    }

    function updateBoxSelectionFromTracks(selectedSet) {
      const selected = new Set(Array.from(selectedSet || []).map(Number).filter(Number.isFinite));
      boxSelectedTrackIds = selected;
      boxSelectionActive = selected.size > 0;
      const visibleTrackIds = new Set((Array.isArray(filteredTracks) ? filteredTracks : []).map((t) => Number(t.id)).filter(Number.isFinite));
      dimmedTrackIds = new Set(Array.from(visibleTrackIds).filter((id) => !selected.has(id)));
      highlightTrackIds = new Set(selected);
      anomalyTrackIds.forEach((id) => highlightTrackIds.add(id));

      const visibleEvents = Array.isArray(trackTextEvents)
        ? trackTextEvents.filter((ev) => selected.has(Number(ev && ev.track_id)))
        : [];
      boxSelectedEventKeys = new Set(visibleEvents.map((ev) => ev && ev.key).filter(Boolean));
      if (activeTrackTextEventKey && !boxSelectedEventKeys.has(activeTrackTextEventKey)) {
        activeTrackTextEventKey = null;
      }
      if (visibleEvents.length) {
        let minT = Number.POSITIVE_INFINITY;
        let maxT = Number.NEGATIVE_INFINITY;
        visibleEvents.forEach((ev) => {
          const t0 = Number(ev && ev.t_start);
          const t1 = Number(ev && ev.t_end);
          if (Number.isFinite(t0) && Number.isFinite(t1)) {
            minT = Math.min(minT, t0, t1);
            maxT = Math.max(maxT, t0, t1);
          }
        });
        boxSelectedTimeRange = Number.isFinite(minT) && Number.isFinite(maxT) ? [Math.max(0, minT), Math.max(0, maxT)] : null;
      } else {
        boxSelectedTimeRange = null;
      }
      clusterFocusTimeRange = boxSelectionActive ? boxSelectedTimeRange : null;
      setAgentSummaryOverlay(boxSelectionActive ? boxSelectedTimeRange : null, boxSelectionActive ? Array.from(selected) : []);
      updateBoxSelectStatus();
      applyFiltersAndRender();
      renderTrackTextEvents();
    }

    function buildTrajectoryDigest(limitTracks = 80) {
      const sourceTracks = (Array.isArray(filteredTracks) && filteredTracks.length)
        ? filteredTracks
        : (Array.isArray(cachedTracks) ? cachedTracks : []);
      const sorted = sourceTracks
        .slice()
        .sort((a, b) => ((b.points && b.points.length) || 0) - ((a.points && a.points.length) || 0));

      const samples = sorted.slice(0, Math.max(1, limitTracks)).map((t) => {
        const points = (t.points || []).slice().sort((a, b) => a.frame - b.frame);
        const first = points[0] || null;
        const last = points[points.length - 1] || null;
        const secSpan = (first && last)
          ? Math.max(1e-6, (last.frame - first.frame) / Math.max(1e-6, ACTIVE_FPS))
          : 0;
        const displacement = (first && last)
          ? Math.hypot((last.x || 0) - (first.x || 0), (last.y || 0) - (first.y || 0))
          : 0;
        return {
          id: t.id,
          cls: t.cls,
          pointCount: points.length,
          startFrame: first ? first.frame : null,
          endFrame: last ? last.frame : null,
          startXY: first ? [Number(first.x) || 0, Number(first.y) || 0] : null,
          endXY: last ? [Number(last.x) || 0, Number(last.y) || 0] : null,
          displacement: Number(displacement.toFixed(3)),
          speedPxPerSec: secSpan > 0 ? Number((displacement / secSpan).toFixed(3)) : 0,
          clusterId: getTrackClusterId(t.id),
        };
      });

      return {
        totalTracks: Array.isArray(cachedTracks) ? cachedTracks.length : 0,
        visibleTracks: Array.isArray(filteredTracks) ? filteredTracks.length : 0,
        sampleTrackCount: samples.length,
        frameRange: {
          min: Number.isFinite(frameRange.min) ? frameRange.min : null,
          max: Number.isFinite(frameRange.max) ? frameRange.max : null,
        },
        focusTimeSecRange: Array.isArray(clusterFocusTimeRange) ? clusterFocusTimeRange : null,
        samples,
      };
    }

    function buildAgentContext() {
      const sceneMode = getSceneMode(currentScene);
      const fused = sceneMode === 'fused_multi_camera';
      const coordinateSpace = getSceneCoordinateSpace(currentScene);
      return {
        frameRange,
        currentSec,
        activeFps: ACTIVE_FPS,
        selectedClasses: Array.from(selectedClasses),
        videoPath: VIDEO_SRC,
        tracksPath: DATA_FILE,
        sceneId: currentScene ? currentScene.scene_id : null,
        datasetType: currentScene ? (currentScene.dataset_type || 'virat') : 'virat',
        sceneMode,
        coordinateSpace,
        isFusedMultiCamera: fused,
        worldTracksPath: WORLD_DATA_FILE,
        cameraSources: buildFusedCameraContext(),
        trajectoryDigest: buildTrajectoryDigest(80),
        temporalControls: {
          useTemporalWindow,
          temporalWindowSec,
          temporalWeight,
          clusterFocusTimeRange: Array.isArray(clusterFocusTimeRange) ? clusterFocusTimeRange : null,
        },
      };
    }

    function loadVideo() {
      if (!VIDEO_SRC) return Promise.resolve(null);
      if (videoEl) return Promise.resolve(videoEl);
      return new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.preload = 'auto';
        v.playsInline = true;
        v.onloadedmetadata = () => {
          videoEl = v;
          resolve(v);
        };
        v.onerror = () => reject(new Error('无法加载视频 ' + VIDEO_SRC));
        v.src = VIDEO_SRC;
      });
    }

    function clearMultiVideoRail() {
      if (railFramePlayTimer) {
        clearInterval(railFramePlayTimer);
        railFramePlayTimer = null;
      }
      railFrameCursor = null;
      railFrameEls = [];
      railVideoTiles = [];
      if (multiVideoTrack) multiVideoTrack.innerHTML = '';
      if (multiVideoRail) multiVideoRail.hidden = true;
    }

    function getActiveTrackEvent() {
      if (!activeTrackTextEventKey || !Array.isArray(trackTextEvents)) return null;
      return trackTextEvents.find((ev) => ev && ev.key === activeTrackTextEventKey) || null;
    }

    function pickNearestCameraBox(boxes, frameAbs, maxGap = 12) {
      if (!Array.isArray(boxes) || !boxes.length || !Number.isFinite(frameAbs)) return null;
      let best = null;
      let bestGap = Infinity;
      boxes.forEach((b) => {
        if (!b || typeof b !== 'object') return;
        const f = Number(b.frame);
        if (!Number.isFinite(f)) return;
        const gap = Math.abs(Math.round(f) - Math.round(frameAbs));
        if (gap < bestGap) {
          bestGap = gap;
          best = b;
        }
      });
      if (!best || bestGap > Math.max(1, maxGap)) return null;
      return best;
    }

    function drawRailOverlayForTile(tileMeta, frameAbs) {
      if (!tileMeta || !tileMeta.overlay || !tileMeta.imageEl) return;
      const canvas = tileMeta.overlay;
      const imageEl = tileMeta.imageEl;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cw = Math.max(1, Math.round(imageEl.clientWidth || 0));
      const ch = Math.max(1, Math.round(imageEl.clientHeight || 0));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const ev = getActiveTrackEvent();
      if (!ev) return;
      const mcList = Array.isArray(ev.multi_camera_descriptions) ? ev.multi_camera_descriptions : [];
      const mc = mcList.find((x) => String((x && x.camera_id) || '').toUpperCase() === tileMeta.cameraId);
      if (!mc) return;
      const denseBoxes = Array.isArray(mc.target_box_series) && mc.target_box_series.length
        ? mc.target_box_series
        : mc.target_boxes;
      const box = pickNearestCameraBox(denseBoxes, frameAbs, Math.max(12, ANNOTATED_FRAME_STEP * 4));
      if (!box) return;

      const x1 = Number(box.x1);
      const y1 = Number(box.y1);
      const x2 = Number(box.x2);
      const y2 = Number(box.y2);
      if (![x1, y1, x2, y2].every(Number.isFinite)) return;

      const vw = Math.max(1, Number(imageEl.naturalWidth) || cw);
      const vh = Math.max(1, Number(imageEl.naturalHeight) || ch);
      const sx = canvas.width / vw;
      const sy = canvas.height / vh;

      const rx1 = Math.max(0, Math.min(canvas.width - 1, Math.round(x1 * sx)));
      const ry1 = Math.max(0, Math.min(canvas.height - 1, Math.round(y1 * sy)));
      const rx2 = Math.max(rx1 + 1, Math.min(canvas.width - 1, Math.round(x2 * sx)));
      const ry2 = Math.max(ry1 + 1, Math.min(canvas.height - 1, Math.round(y2 * sy)));

      ctx.strokeStyle = '#ff3030';
      ctx.lineWidth = 3;
      ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
      ctx.beginPath();
      ctx.lineWidth = 4;
      ctx.moveTo(rx1, ry1);
      ctx.lineTo(rx1 + 14, ry1);
      ctx.moveTo(rx1, ry1);
      ctx.lineTo(rx1, ry1 + 14);
      ctx.stroke();

      const label = `${tileMeta.cameraId} · f${Number.isFinite(Number(box.frame)) ? Math.round(Number(box.frame)) : '-'}`;
      ctx.fillStyle = 'rgba(6, 12, 20, 0.75)';
      ctx.fillRect(rx1 + 2, Math.max(0, ry1 - 18), 78, 15);
      ctx.fillStyle = '#ffb0b0';
      ctx.font = '10px Space Grotesk, sans-serif';
      ctx.fillText(label, rx1 + 6, Math.max(10, ry1 - 7));
    }

    function updateRailEventOverlays(frameAbs) {
      if (!Array.isArray(railVideoTiles) || !railVideoTiles.length) return;
      const frameVal = Number.isFinite(frameAbs) ? frameAbs : secToSnappedFrame(currentSec);
      railVideoTiles.forEach((tileMeta) => drawRailOverlayForTile(tileMeta, frameVal));
    }

    function bindRailHorizontalWheel() {
      if (!multiVideoTrack || multiVideoTrack.dataset.wheelBound === '1') return;
      multiVideoTrack.addEventListener('wheel', (ev) => {
        if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
        ev.preventDefault();
        multiVideoTrack.scrollLeft += ev.deltaY;
      }, { passive: false });
      multiVideoTrack.dataset.wheelBound = '1';
    }

    function normalizeImageDir(path) {
      const raw = String(path || '').trim();
      if (!raw) return '';
      const noQuery = raw.split('?')[0].split('#')[0];
      return toWebAssetPath(noQuery).replace(/\/+$/, '');
    }

    function getRailLocalFrame(tileMeta, frameAbs) {
      const frameBase = Math.max(0, Math.round(Number(frameAbs) || 0));
      const frameOffset = Math.max(0, Math.round(Number(tileMeta && tileMeta.frameOffset) || 0));
      return Math.max(0, frameBase - frameOffset);
    }

    function buildRailFrameCandidates(tileMeta, frameAbs) {
      const dir = normalizeImageDir(tileMeta && tileMeta.imageDir);
      if (!dir || !Number.isFinite(frameAbs)) return [];
      const frameBase = Math.max(0, Math.round(frameAbs));
      const localFrame = getRailLocalFrame(tileMeta, frameBase);
      const frameOffset = Math.max(0, Math.round(Number(tileMeta && tileMeta.frameOffset) || 0));
      const relFrame = Number.isFinite(frameRange.min) ? Math.max(0, frameBase - Math.round(frameRange.min) - frameOffset) : localFrame;
      const frameIds = Array.from(new Set([localFrame, relFrame]));
      const camPrefix = String((tileMeta && tileMeta.cameraId) || '').trim().toUpperCase();
      const candidates = [];
      frameIds.forEach((fid) => {
        const plain = String(fid);
        RAIL_FRAME_EXTS.forEach((ext) => {
          candidates.push(`${dir}/${plain}.${ext}`);
        });
        RAIL_FRAME_PADS.forEach((pad) => {
          const padded = String(fid).padStart(pad, '0');
          RAIL_FRAME_EXTS.forEach((ext) => {
            candidates.push(`${dir}/${padded}.${ext}`);
            candidates.push(`${dir}/img${padded}.${ext}`);
            if (camPrefix) {
              candidates.push(`${dir}/${camPrefix}_${padded}.${ext}`);
            }
          });
        });
      });
      return Array.from(new Set(candidates));
    }

    function loadRailFrameForTile(tileMeta, frameAbs) {
      if (!tileMeta || !tileMeta.imageEl) return Promise.resolve();
      const frameInt = Math.max(0, Math.round(frameAbs));
      if (tileMeta.lastFrame === frameInt && tileMeta.lastResolvedSrc) {
        return Promise.resolve();
      }
      const candidates = tileMeta.lastPatternBuilder
        ? [tileMeta.lastPatternBuilder(frameInt), ...buildRailFrameCandidates(tileMeta, frameInt)]
        : buildRailFrameCandidates(tileMeta, frameInt);
      if (!candidates.length) return Promise.resolve();

      tileMeta.loadToken = (tileMeta.loadToken || 0) + 1;
      const token = tileMeta.loadToken;

      return new Promise((resolve) => {
        let idx = 0;
        const imageEl = tileMeta.imageEl;
        const tryNext = () => {
          if (token !== tileMeta.loadToken) {
            resolve();
            return;
          }
          if (idx >= candidates.length) {
            resolve();
            return;
          }
          const src = candidates[idx++];
          imageEl.onload = () => {
            if (token !== tileMeta.loadToken) {
              resolve();
              return;
            }
            tileMeta.lastFrame = frameInt;
            tileMeta.lastResolvedSrc = src;
            const m = src.match(/^(.*\/)([^\/]*?)(\d+)\.(jpg|png|jpeg)$/i);
            if (m) {
              const prefix = m[1] || '';
              const stemPrefix = m[2] || '';
              const digits = m[3] || '';
              const width = digits.length;
              const ext = (m[4] || 'jpg').toLowerCase();
              tileMeta.lastPatternBuilder = (f) => {
                const n = getRailLocalFrame(tileMeta, f);
                const body = String(n).padStart(width, '0');
                const stem = `${stemPrefix}${body}`;
                return `${prefix}${stem}.${ext}`;
              };
            }
            resolve();
          };
          imageEl.onerror = () => tryNext();
          imageEl.src = src;
        };
        tryNext();
      });
    }

    function setupMultiVideoRail(scenes) {
      clearMultiVideoRail();
      if (!multiVideoRail || !multiVideoTrack || !Array.isArray(scenes) || !scenes.length) return;
      bindRailHorizontalWheel();
      scenes.forEach(scene => {
        const normalized = normalizeCameraSource(scene);
        if (!normalized) return;
        const camNum = extractWildtrackCameraNum(normalized);
        const cameraId = String(normalized.cameraId || (camNum ? ('C' + camNum) : 'C?')).trim().toUpperCase();
        const imageDir = normalizeImageDir(normalized.imageDir || normalized.image_dir);
        if (!imageDir) return;

        const tile = document.createElement('div');
        tile.className = 'video-tile';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = '相机 ' + cameraId;

        const stage = document.createElement('div');
        stage.className = 'video-stage';

        const img = document.createElement('img');
        img.className = 'rail-frame';
        img.alt = 'camera frame';
        img.loading = 'lazy';
        img.decoding = 'async';

        const overlay = document.createElement('canvas');
        overlay.className = 'rail-box-overlay';

        img.addEventListener('load', () => {
          updateRailEventOverlays(secToSnappedFrame(currentSec));
        });
        img.addEventListener('error', () => {
          console.warn('rail frame load failed', cameraId, imageDir);
        });

        tile.appendChild(title);
        stage.appendChild(img);
        stage.appendChild(overlay);
        tile.appendChild(stage);
        multiVideoTrack.appendChild(tile);
        railFrameEls.push(img);
        railVideoTiles.push({
          imageEl: img,
          overlay,
          cameraId,
          imageDir,
          frameOffset: Number(normalized.frameOffset) || 0,
          lastFrame: null,
          lastResolvedSrc: '',
          lastPatternBuilder: null,
          loadToken: 0,
        });
      });
      if (railFrameEls.length) multiVideoRail.hidden = false;
      syncRailVideosToFrame(secToSnappedFrame(currentSec));
    }

    async function playAllRailVideos() {
      if (!railVideoTiles.length || !Number.isFinite(frameRange.min) || !Number.isFinite(frameRange.max)) return;
      if (railFramePlayTimer) clearInterval(railFramePlayTimer);
      if (!Number.isFinite(railFrameCursor)) {
        railFrameCursor = secToSnappedFrame(currentSec);
      }
      railFramePlayTimer = setInterval(() => {
        const step = Math.max(1, ANNOTATED_FRAME_STEP);
        const next = Number.isFinite(railFrameCursor) ? railFrameCursor + step : secToSnappedFrame(currentSec);
        railFrameCursor = next > frameRange.max ? frameRange.min : next;
        syncRailVideosToFrame(railFrameCursor);
      }, 260);
    }

    function pauseAllRailVideos() {
      if (railFramePlayTimer) {
        clearInterval(railFramePlayTimer);
        railFramePlayTimer = null;
      }
    }

    async function syncRailVideosToFrame(frameAbs) {
      if (!railVideoTiles.length || !Number.isFinite(frameAbs) || !Number.isFinite(frameRange.min)) return;
      const frameInt = clampFrameToRange(frameAbs);
      railFrameCursor = frameInt;
      await Promise.all(railVideoTiles.map((tileMeta) => loadRailFrameForTile(tileMeta, frameInt)));
      updateRailEventOverlays(frameInt);
    }

    async function grabVideoFrame(frameIdx) {
      const v = await loadVideo();
      if (!v) return null;
      if (v.readyState < 1) {
        await new Promise(res => v.addEventListener('loadedmetadata', res, { once: true }));
      }
      const relativeFrame = frameIdx - frameRange.min;
      const targetTime = Math.max(0, relativeFrame / ACTIVE_FPS);
      const safeDuration = Number.isFinite(v.duration) ? v.duration - 0.1 : 9999;
      const clampedTime = Math.min(targetTime, safeDuration);
      v.currentTime = clampedTime;
      await new Promise(resolve => {
        const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
        v.addEventListener('seeked', onSeeked);
        setTimeout(resolve, 500);
      });
      await new Promise(r => setTimeout(r, 50));
      try { return downsampleSource(v, FRAME_SAMPLE); } catch { return null; }
    }

    function downsampleSource(src, targetSize) {
      const w = src.videoWidth || src.naturalWidth;
      const h = src.videoHeight || src.naturalHeight;
      const sampleW = Math.min(targetSize, w);
      const sampleH = Math.min(targetSize, h);
      const canvas = document.createElement('canvas');
      canvas.width = sampleW; canvas.height = sampleH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(src, 0, 0, sampleW, sampleH);
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
      const pixelXs = []; const pixelYs = []; const pixelZs = []; const pixelColors = [];
      for (let r = 0; r < sampleH; r++) {
    // 行号映射到像素Y，保持与原始图像坐标同向（不做镜像翻转）
    const yVal = (r * h) / sampleH;
    
    for (let c = 0; c < sampleW; c++) {
      const idx = (r * sampleW + c) * 4;
      const rv = data[idx], gv = data[idx+1], bv = data[idx+2];
      
      // X坐标：从左到右
      const xVal = (c * w) / sampleW;
      
      pixelXs.push(xVal);
      pixelYs.push(yVal); // 保留像素Y，供XY平面映射
      pixelZs.push(yVal); // 兼容旧字段命名（仍用于视频平面）
      pixelColors.push([rv, gv, bv, 255]);
    }
  }
  
  return { 
    pixelXs, pixelYs, pixelZs, pixelColors, 
    w, h, sampleW, sampleH 
  };
    }

    async function maybeLoadFrameTexture(frameIdx) {
      if (frameTexture && lastFrameTextureFrame === frameIdx) return frameTexture;
      try {
        const tex = await grabVideoFrame(frameIdx);
        if (tex) {
          frameTexture = tex;
          lastFrameTextureFrame = frameIdx;
        }
        return frameTexture;
      } catch (e) {
        console.warn(e);
        return frameTexture;
      }
    }

    function parseWorldObjects(text) {
      const lines = text.split(/\n+/).filter(Boolean);
      totalLines = Math.max(0, lines.length - 1);
      if (!lines.length) return [];

      const header = lines[0].split(',').map(x => x.trim());
      const idx = new Map(header.map((h, i) => [h, i]));
      const need = ['obj_id', 'frame', 'x_world', 'y_world', 'cls'];
      if (!need.every(k => idx.has(k))) {
        throw new Error('世界坐标CSV缺少必要列');
      }

      // 关键要求: 聚合时保持人物ID不变。
      // 做法: 仅在“同一帧 + 同一obj_id”维度跨相机融合，不重建新的轨迹ID。
      const frameObjAgg = new Map();
      const clsSet = new Set();
      let minFrame = Infinity;
      let maxFrame = -Infinity;

      for (let i = 1; i < lines.length; i += 1) {
        const cols = lines[i].split(',');
        if (cols.length < header.length) continue;

        const validIdx = idx.has('valid') ? idx.get('valid') : -1;
        if (validIdx >= 0) {
          const v = Number(cols[validIdx]);
          if (Number.isFinite(v) && v === 0) continue;
        }

        const objectId = Number(cols[idx.get('obj_id')]);
        const frame = Number(cols[idx.get('frame')]);
        const xw = Number(cols[idx.get('x_world')]);
        const yw = Number(cols[idx.get('y_world')]);
        const clsRaw = Number(cols[idx.get('cls')]);
        const cls = clsRaw === 0 ? 1 : clsRaw;
        const camCol = idx.has('camera_id') ? String(cols[idx.get('camera_id')] || '').trim() : '';

        if (!Number.isFinite(objectId) || !Number.isFinite(frame) || !Number.isFinite(xw) || !Number.isFinite(yw)) continue;

        const key = `${frame}::${objectId}::${cls}`;
        if (!frameObjAgg.has(key)) {
          frameObjAgg.set(key, {
            frame,
            objectId,
            cls,
            sumX: 0,
            sumY: 0,
            count: 0,
            cameras: new Set(),
          });
        }

        const agg = frameObjAgg.get(key);
        agg.sumX += xw;
        agg.sumY += yw;
        agg.count += 1;
        if (camCol) agg.cameras.add(camCol);

        minFrame = Math.min(minFrame, frame);
        maxFrame = Math.max(maxFrame, frame);
        if (Number.isFinite(cls)) clsSet.add(cls);
      }

      const tracks = new Map();
      const fusedRows = Array.from(frameObjAgg.values()).sort((a, b) => {
        if (a.objectId !== b.objectId) return a.objectId - b.objectId;
        return a.frame - b.frame;
      });

      for (const row of fusedRows) {
        const tid = row.objectId;
        if (!tracks.has(tid)) {
          tracks.set(tid, {
            id: tid,
            cls: row.cls,
            cameraId: 'FUSED',
            localId: tid,
            cameraCountMax: 1,
            points: [],
          });
        }

        const tr = tracks.get(tid);
        tr.cls = row.cls;
        tr.cameraCountMax = Math.max(tr.cameraCountMax || 1, row.cameras.size || 1);
        tr.points.push({
          frame: row.frame,
          x: row.sumX / Math.max(1, row.count),
          y: row.sumY / Math.max(1, row.count),
          w: 20,
          h: 20,
        });
      }

      for (const tr of tracks.values()) {
        tr.points.sort((a, b) => a.frame - b.frame);
      }

      frameRange = { min: minFrame, max: maxFrame };
      availableClasses = Array.from(clsSet).sort((a, b) => a - b);
      selectedClasses = new Set(ALL_VIRAT_CLASSES.filter(c => c !== 0));
      renderClassFilters();
      return Array.from(tracks.values());
    }

    function parseObjects(text) {
      const lines = text.split(/\n+/).filter(Boolean);
      totalLines = lines.length;
      const tracks = new Map();
      let minFrame = Infinity, maxFrame = -Infinity;
      const clsSet = new Set();
      const isWildTrack = currentScene && currentScene.dataset_type === 'wildtrack';
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 8) continue;

        let objectId, frame, cx, cy, w, h, cls;

        if (isWildTrack) {
          // WildTrack raw format: obj_id frame x1 y1 x2 y2 conf cls
          const x1 = Number(parts[2]);
          const y1 = Number(parts[3]);
          const x2 = Number(parts[4]);
          const y2 = Number(parts[5]);
          objectId = Number(parts[0]);
          frame = Number(parts[1]);
          w = Math.max(1, x2 - x1);
          h = Math.max(1, y2 - y1);
          cx = x1 + w / 2;
          cy = y1 + h / 2;
          const clsRaw = Number(parts[7]);
          cls = clsRaw === 0 ? 1 : clsRaw;
        } else {
          // VIRAT format: seq_id obj_id frame x y w h cls
          const [, objectIdStr, frameStr, xStr, yStr, wStr, hStr, clsStr] = parts;
          objectId = Number(objectIdStr);
          frame = Number(frameStr);
          const x = Number(xStr);
          const y = Number(yStr);
          w = Number(wStr);
          h = Number(hStr);
          cx = x + w / 2;
          cy = y + h / 2;
          cls = Number(clsStr);
        }

        if (!Number.isFinite(frame) || !Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        if (!tracks.has(objectId)) tracks.set(objectId, { id: objectId, cls, points: [] });
        tracks.get(objectId).points.push({ frame, x: cx, y: cy, w, h });
        minFrame = Math.min(minFrame, frame);
        maxFrame = Math.max(maxFrame, frame);
        if (Number.isFinite(cls)) clsSet.add(cls);
      }
      frameRange = { min: minFrame, max: maxFrame };
      // Derive FPS from video metadata duration if available
      if (videoEl && Number.isFinite(videoEl.duration)) {
        const spanFrames = Math.max(1, maxFrame - minFrame);
        const derivedFps = spanFrames / videoEl.duration;
        if (Number.isFinite(derivedFps) && derivedFps > 1) {
          ACTIVE_FPS = derivedFps;
        }
      }
      // 记录当前场景中实际存在的类别
      availableClasses = Array.from(clsSet).sort((a,b)=>a-b);
      // 初始化选中类别：默认选中所有类别（1-5），但不选中背景（0）
      selectedClasses = new Set(ALL_VIRAT_CLASSES.filter(c => c !== 0));
      for (const tr of tracks.values()) {
        tr.points.sort((a, b) => a.frame - b.frame);
      }
      renderClassFilters();
      return Array.from(tracks.values());
    }

    function renderClassFilters() {
      if (!classFiltersEl) return;
      classFiltersEl.innerHTML = '';

      const totalCounts = new Map();
      cachedTracks.forEach((t) => totalCounts.set(t.cls, (totalCounts.get(t.cls) || 0) + 1));
      const shownCounts = new Map();
      filteredTracks.forEach((t) => shownCounts.set(t.cls, (shownCounts.get(t.cls) || 0) + 1));

      ALL_VIRAT_CLASSES.forEach((cls) => {
        const existsInScene = availableClasses.includes(cls);
        if (!existsInScene) selectedClasses.delete(cls);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'class-filter-btn';
        if (selectedClasses.has(cls)) btn.classList.add('is-active');
        if (!existsInScene) {
          btn.classList.add('is-disabled');
          btn.disabled = true;
        }

        const icon = document.createElement('span');
        icon.className = 'class-icon';
        icon.textContent = classIcons.get(cls) || String(cls);
        icon.style.background = colors[cls % colors.length];

        const meta = document.createElement('span');
        meta.className = 'class-meta';
        const name = document.createElement('span');
        name.className = 'class-name';
        const labelText = classLabels.get(cls) || `Class ${cls}`;
        name.textContent = labelText.split('(')[0].trim() || labelText;

        const count = document.createElement('span');
        count.className = 'class-count';
        const shownCount = shownCounts.get(cls) || 0;
        const totalCount = totalCounts.get(cls) || 0;
        count.textContent = `${shownCount}/${totalCount}`;

        meta.appendChild(name);
        meta.appendChild(count);
        btn.appendChild(icon);
        btn.appendChild(meta);

        if (existsInScene) {
          btn.addEventListener('click', () => {
            if (selectedClasses.has(cls)) selectedClasses.delete(cls); else selectedClasses.add(cls);
            renderClassFilters();
            applyFiltersAndRender();
          });
        }

        classFiltersEl.appendChild(btn);
      });
    }

    function normalizeModelResults(list) {
      if (!Array.isArray(list)) return [];
      return list.map((item, idx) => {
        const key = String(item.key || item.model || item.label || `model_${idx}`);
        const label = String(item.label || item.model || item.key || key);
        const color = item.color || colors[idx % colors.length];
        const highlights = Array.isArray(item.highlights) ? item.highlights.map(Number).filter(Number.isFinite) : [];
        return { key, label, color, highlights };
      });
    }

    function renderModelFilters() {
      if (!modelFiltersEl) return;
      modelFiltersEl.innerHTML = '';
      if (!modelResults.length) {
        modelFiltersEl.innerHTML = '<span class="status">暂无模型结果</span>';
        return;
      }
      modelResults.forEach((m) => {
        const label = document.createElement('label');
        label.className = 'chip';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = m.key;
        input.checked = modelVisible.has(m.key);
        input.addEventListener('change', () => {
          if (input.checked) modelVisible.add(m.key); else modelVisible.delete(m.key);
          updateHighlightTrackIdsFromModel();
          updateHiddenTrackIdsFromModelFilter();
          applyFiltersAndRender();
        });
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = m.color;
        const span = document.createElement('span');
        span.textContent = m.label;
        label.appendChild(input);
        label.appendChild(swatch);
        label.appendChild(span);
        modelFiltersEl.appendChild(label);
      });
    }

    function setModelResults(results) {
      modelResults = normalizeModelResults(results || []);
      modelHighlightMap.clear();
      modelColorMap.clear();
      modelVisible.clear();

      if (!modelResults.length) {
        modelFilterOnly = false;
        if (modelOnlyCheckbox) modelOnlyCheckbox.checked = false;
        renderModelFilters();
        updateHighlightTrackIdsFromModel();
        updateHiddenTrackIdsFromModelFilter();
        return;
      }

      modelResults.forEach((m) => {
        modelHighlightMap.set(m.key, new Set(m.highlights || []));
        modelColorMap.set(m.key, m.color);
        modelVisible.add(m.key);
      });

      // 默认开启全部模型，用户可手动切换
      renderModelFilters();
      updateHighlightTrackIdsFromModel();
      updateHiddenTrackIdsFromModelFilter();
    }

    function getActiveModelHighlights() {
      if (!modelResults.length || !modelVisible.size) return null;
      const union = new Set();
      modelVisible.forEach((key) => {
        const set = modelHighlightMap.get(key);
        if (!set) return;
        set.forEach((id) => union.add(id));
      });
      return union;
    }

    function applyClusterPayload(data) {
      clusterTrackMap.clear();
      clusterColorMap.clear();
      interactionClusterMap.clear();
      anomalyTrackIds = new Set();

      const clusters = data && typeof data === 'object' ? data.clusters : null;
      if (!clusters || typeof clusters !== 'object') {
        updateInteractionTimeline(data);
        return;
      }

      const rawTrackClusters = (clusters.trackClusters && typeof clusters.trackClusters === 'object')
        ? clusters.trackClusters
        : {};
      Object.entries(rawTrackClusters).forEach(([k, v]) => {
        const tid = Number(k);
        const cid = Number(v);
        if (Number.isFinite(tid) && Number.isFinite(cid)) {
          clusterTrackMap.set(tid, cid);
        }
      });

      const anomalyIds = Array.isArray(clusters.anomalyIds)
        ? clusters.anomalyIds.map(Number).filter(Number.isFinite)
        : [];
      anomalyTrackIds = new Set(anomalyIds);

      const rawInteractionClusters = (clusters.interactionClusters && typeof clusters.interactionClusters === 'object')
        ? clusters.interactionClusters
        : {};
      Object.entries(rawInteractionClusters).forEach(([pairKey, cidRaw]) => {
        const cid = Number(cidRaw);
        if (Number.isFinite(cid)) {
          interactionClusterMap.set(String(pairKey), cid);
        }
      });

      const sortedClusterIds = Array.from(new Set(
        Array.from(clusterTrackMap.values()).filter(cid => Number.isFinite(cid) && cid >= 0)
      )).sort((a, b) => a - b);
      sortedClusterIds.forEach((cid, idx) => {
        clusterColorMap.set(cid, colors[idx % colors.length]);
      });

      updateInteractionTimeline(data);
    }

    function updateInteractionTimeline(data) {
      if (!interactionTimelineEl) return;
      if (!interactionClusterMap.size) {
        interactionTimelineEl.textContent = '暂无';
        return;
      }

      const groups = new Map();
      interactionClusterMap.forEach((cid, pairKey) => {
        if (!groups.has(cid)) {
          groups.set(cid, {
            cid,
            pairs: new Set(),
            start: Infinity,
            end: -Infinity,
            segCount: 0,
          });
        }
        groups.get(cid).pairs.add(pairKey);
      });

      const interactions = data && data.objectiveFacts && Array.isArray(data.objectiveFacts.interactions)
        ? data.objectiveFacts.interactions
        : [];
      interactions.forEach((it) => {
        const personId = Number(it.person_id);
        const vehicleId = Number(it.vehicle_id);
        if (!Number.isFinite(personId) || !Number.isFinite(vehicleId)) return;
        const pairKey = `${personId}-${vehicleId}`;
        const cid = interactionClusterMap.get(pairKey);
        if (!Number.isFinite(cid)) return;
        const group = groups.get(cid);
        if (!group) return;
        const interval = Array.isArray(it.time_interval) ? it.time_interval : null;
        if (interval && interval.length === 2) {
          const s = Number(interval[0]);
          const e = Number(interval[1]);
          if (Number.isFinite(s) && Number.isFinite(e)) {
            group.start = Math.min(group.start, s);
            group.end = Math.max(group.end, e);
            group.segCount += 1;
          }
        }
      });

      const ordered = Array.from(groups.values()).sort((a, b) => {
        const av = Number.isFinite(a.start) ? a.start : Number.POSITIVE_INFINITY;
        const bv = Number.isFinite(b.start) ? b.start : Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;
        return a.cid - b.cid;
      });

      const chips = ordered.map((g) => {
        const color = clusterColorMap.get(g.cid) || colors[Math.abs(g.cid) % colors.length];
        const hasTime = Number.isFinite(g.start) && Number.isFinite(g.end);
        const title = hasTime
          ? `C${g.cid}: ${g.start.toFixed(1)}-${g.end.toFixed(1)}s (${g.segCount || g.pairs.size}段)`
          : `C${g.cid}: ${g.pairs.size}对`;
        return `<span style="display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,0.18); margin:2px;">
          <span style="width:10px; height:10px; border-radius:50%; background:${color};"></span>
          <span>${title}</span>
        </span>`;
      });

      interactionTimelineEl.innerHTML = chips.join('');
    }

    function updateHighlightTrackIdsFromModel() {
      const active = getActiveModelHighlights();
      if (active && active.size) {
        highlightTrackIds = new Set(active);
        anomalyTrackIds.forEach((id) => highlightTrackIds.add(id));
      } else {
        highlightTrackIds = new Set(baseHighlightTrackIds);
        anomalyTrackIds.forEach((id) => highlightTrackIds.add(id));
      }
    }

    function updateHiddenTrackIdsFromModelFilter() {
      const baseHidden = new Set(baseHiddenTrackIds);
      if (modelFilterOnly) {
        const active = getActiveModelHighlights();
        if (active && active.size) {
          cachedTracks.forEach((t) => {
            if (!active.has(t.id) && !anomalyTrackIds.has(t.id)) baseHidden.add(t.id);
          });
        }
      }
      hiddenTrackIds = baseHidden;
    }

    function getTrackClusterId(trackId) {
      if (clusterTrackMap.has(trackId)) return clusterTrackMap.get(trackId);
      if (vizTrackClusterMap.has(trackId)) return vizTrackClusterMap.get(trackId);
      return null;
    }

    function getClusterColorById(cid) {
      if (clusterColorMap.has(cid)) return clusterColorMap.get(cid);
      if (vizClusterColorMap.has(cid)) return vizClusterColorMap.get(cid);
      return null;
    }

    function clearVisualizationClusters() {
      vizTrackClusterMap.clear();
      vizClusterColorMap.clear();
      vizClusterRepresentatives = [];
    }

    function resampleTrackPoints(points, sampleCount = 16) {
      if (!Array.isArray(points) || !points.length) return [];
      if (points.length === 1) return Array.from({ length: sampleCount }, () => ({ x: points[0].x, y: points[0].y }));
      const out = [];
      for (let i = 0; i < sampleCount; i += 1) {
        const pos = (i * (points.length - 1)) / Math.max(1, sampleCount - 1);
        const lo = Math.floor(pos);
        const hi = Math.min(points.length - 1, Math.ceil(pos));
        const t = pos - lo;
        const p1 = points[lo];
        const p2 = points[hi];
        out.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
        });
      }
      return out;
    }

    function dtwDistance(seqA, seqB, normScale) {
      const n = seqA.length;
      const m = seqB.length;
      if (!n || !m) return Number.POSITIVE_INFINITY;
      const scale = Math.max(1e-6, normScale || 1);
      const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Number.POSITIVE_INFINITY));
      dp[0][0] = 0;
      for (let i = 1; i <= n; i += 1) {
        for (let j = 1; j <= m; j += 1) {
          const dx = seqA[i - 1].x - seqB[j - 1].x;
          const dy = seqA[i - 1].y - seqB[j - 1].y;
          const cost = Math.hypot(dx, dy) / scale;
          dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
      return dp[n][m] / (n + m);
    }

    function getTrackTimeSpan(points) {
      if (!Array.isArray(points) || !points.length) return null;
      const sorted = points.slice().sort((a, b) => a.frame - b.frame);
      const start = sorted[0].frame;
      const end = sorted[sorted.length - 1].frame;
      return {
        start,
        end,
        center: (start + end) / 2,
      };
    }

    function computeTemporalDistance(spanA, spanB) {
      if (!spanA || !spanB) return 1;
      const inter = Math.max(0, Math.min(spanA.end, spanB.end) - Math.max(spanA.start, spanB.start));
      const union = Math.max(1, Math.max(spanA.end, spanB.end) - Math.min(spanA.start, spanB.start));
      const iou = inter / union;
      const sceneSpan = Math.max(1, (frameRange.max || 0) - (frameRange.min || 0));
      const centerGapNorm = Math.min(1, Math.abs(spanA.center - spanB.center) / sceneSpan);
      return 0.7 * (1 - iou) + 0.3 * centerGapNorm;
    }

    function computePatternDistance(a, b, normScale) {
      const dShape = dtwDistance(a.seq, b.seq, normScale);
      const sA = a.seq[0], sB = b.seq[0], eA = a.seq[a.seq.length - 1], eB = b.seq[b.seq.length - 1];
      const dStart = Math.hypot(sA.x - sB.x, sA.y - sB.y) / Math.max(1e-6, normScale || 1);
      const dEnd = Math.hypot(eA.x - eB.x, eA.y - eB.y) / Math.max(1e-6, normScale || 1);
      const lenRatio = Math.abs(a.clusterPoints.length - b.clusterPoints.length) / Math.max(1, Math.max(a.clusterPoints.length, b.clusterPoints.length));
      const dSpatial = 0.65 * dShape + 0.2 * dStart + 0.1 * dEnd + 0.05 * lenRatio;

      if (!useTemporalWindow || !a.timeSpan || !b.timeSpan) return dSpatial;
      const gapSec = Math.abs(a.timeSpan.center - b.timeSpan.center) / Math.max(1e-6, ACTIVE_FPS);
      if (gapSec > Math.max(0.5, temporalWindowSec)) return Number.POSITIVE_INFINITY;
      const dTime = computeTemporalDistance(a.timeSpan, b.timeSpan);
      const wt = Math.max(0, Math.min(0.95, temporalWeight));
      return (1 - wt) * dSpatial + wt * dTime;
    }

    function getClusteringPoints(points) {
      const sorted = (points || []).slice().sort((a, b) => a.frame - b.frame);
      if (!sorted.length) return sorted;
      if (!useTemporalWindow || !Array.isArray(clusterFocusTimeRange) || clusterFocusTimeRange.length !== 2) return sorted;

      const secStart = Math.max(0, Math.min(clusterFocusTimeRange[0], clusterFocusTimeRange[1]));
      const secEnd = Math.max(clusterFocusTimeRange[0], clusterFocusTimeRange[1]);
      const padSec = Math.max(0, temporalWindowSec * 0.5);
      const frameStart = (frameRange.min || 0) + Math.floor((secStart - padSec) * ACTIVE_FPS);
      const frameEnd = (frameRange.min || 0) + Math.ceil((secEnd + padSec) * ACTIVE_FPS);
      const clipped = sorted.filter(p => p.frame >= frameStart && p.frame <= frameEnd);
      return clipped.length >= 2 ? clipped : sorted;
    }

    function buildConvexHull(points) {
      if (!Array.isArray(points) || points.length < 3) return [];
      const dedup = [];
      const seen = new Set();
      for (const p of points) {
        const k = `${p.x.toFixed(3)}:${p.y.toFixed(3)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        dedup.push({ x: p.x, y: p.y });
      }
      dedup.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
      if (dedup.length < 3) return dedup;

      function cross(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
      }

      const lower = [];
      for (const p of dedup) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
          lower.pop();
        }
        lower.push(p);
      }

      const upper = [];
      for (let i = dedup.length - 1; i >= 0; i -= 1) {
        const p = dedup[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
          upper.pop();
        }
        upper.push(p);
      }

      lower.pop();
      upper.pop();
      return lower.concat(upper);
    }

    function buildEllipsePolygon(bounds, extraPad = 0, segments = 18) {
      if (!bounds) return [];
      const minX = Number(bounds.minX);
      const maxX = Number(bounds.maxX);
      const minY = Number(bounds.minY);
      const maxY = Number(bounds.maxY);
      if (![minX, maxX, minY, maxY].every(Number.isFinite)) return [];
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const rx = Math.max(10, (maxX - minX) * 0.5 + extraPad);
      const ry = Math.max(10, (maxY - minY) * 0.5 + extraPad);
      const pts = [];
      const count = Math.max(10, Math.min(36, Number(segments) || 18));
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      }
      return pts;
    }

    function smoothClosedPolygon(points, iterations = 2) {
      if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
      let current = points
        .map((pt) => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x), Number(pt.y)])
        .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
      if (current.length < 3) return current;
      const rounds = Math.max(1, Math.min(4, Number(iterations) || 2));
      for (let iter = 0; iter < rounds; iter += 1) {
        const next = [];
        for (let i = 0; i < current.length; i += 1) {
          const p0 = current[i];
          const p1 = current[(i + 1) % current.length];
          next.push([
            p0[0] * 0.78 + p1[0] * 0.22,
            p0[1] * 0.78 + p1[1] * 0.22,
          ]);
          next.push([
            p0[0] * 0.22 + p1[0] * 0.78,
            p0[1] * 0.22 + p1[1] * 0.78,
          ]);
        }
        current = next;
      }
      return current;
    }

    function traceBubblePath(ctx, points) {
      if (!ctx || !Array.isArray(points) || points.length < 2) return;
      if (points.length === 2) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        ctx.lineTo(points[1][0], points[1][1]);
        return;
      }
      const last = points[points.length - 1];
      const first = points[0];
      ctx.beginPath();
      ctx.moveTo((last[0] + first[0]) * 0.5, (last[1] + first[1]) * 0.5);
      for (let i = 0; i < points.length; i += 1) {
        const cur = points[i];
        const next = points[(i + 1) % points.length];
        const midX = (cur[0] + next[0]) * 0.5;
        const midY = (cur[1] + next[1]) * 0.5;
        ctx.quadraticCurveTo(cur[0], cur[1], midX, midY);
      }
      ctx.closePath();
    }

    function computeVisualizationClusters(tracks) {
      clearVisualizationClusters();
      if (!Array.isArray(tracks) || tracks.length < 2) return;

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      tracks.forEach((t) => {
        (t.points || []).forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      });
      const diag = Math.max(1.0, Math.hypot(maxX - minX, maxY - minY));

      const prepared = tracks.map((track) => {
        const clusterPoints = getClusteringPoints(track.points || []);
        return {
          track,
          clusterPoints,
          seq: resampleTrackPoints(clusterPoints, 16),
          timeSpan: getTrackTimeSpan(clusterPoints),
        };
      }).filter(x => x.seq.length >= 2);

      prepared.sort((a, b) => (b.clusterPoints.length - a.clusterPoints.length));
      if (!prepared.length) return;

      const clusters = [];
      const threshold = Number.isFinite(vizClusterThreshold) ? vizClusterThreshold : 0.09;

      for (const item of prepared) {
        let bestCluster = null;
        let bestDist = Number.POSITIVE_INFINITY;

        for (const c of clusters) {
          if (c.cls !== item.track.cls) continue;

          // 时间窗口预剪枝：先过时间门，再做更昂贵的DTW
          if (useTemporalWindow && item.timeSpan && c.medoid.timeSpan) {
            const centerGapSec = Math.abs(item.timeSpan.center - c.medoid.timeSpan.center) / Math.max(1e-6, ACTIVE_FPS);
            if (centerGapSec > Math.max(0.5, temporalWindowSec)) continue;
          }

          const d = computePatternDistance(item, c.medoid, diag);
          if (d < bestDist) {
            bestDist = d;
            bestCluster = c;
          }
        }

        if (!bestCluster || bestDist > threshold) {
          clusters.push({
            id: clusters.length,
            cls: item.track.cls,
            medoid: item,
            members: [item],
          });
        } else {
          bestCluster.members.push(item);
        }
      }

      clusters.sort((a, b) => b.members.length - a.members.length);
      clusters.forEach((c, rank) => {
        vizClusterColorMap.set(c.id, colors[rank % colors.length]);
        c.members.forEach((m) => vizTrackClusterMap.set(m.track.id, c.id));
      });

      vizClusterRepresentatives = clusters.map((c) => ({
        cid: c.id,
        size: c.members.length,
        cls: c.cls,
        trackId: c.medoid.track.id,
        points: (c.medoid.clusterPoints || c.medoid.track.points || []).slice().sort((a, b) => a.frame - b.frame),
      })).filter(r => r.points.length >= 2);
    }

    function applyFiltersAndRender() {
      if (!cachedTracks.length) return;
      const byClass = selectedClasses.size
        ? cachedTracks.filter(t => selectedClasses.has(t.cls))
        : cachedTracks.filter(t => t.cls !== 0);

      filteredTracks = byClass
        .map(t => ({ ...t, points: t.points.slice().sort((a, b) => a.frame - b.frame) }))
        .filter(t => !hiddenTrackIds.has(t.id))
        .sort((a, b) => b.points.length - a.points.length);

      if (getSceneMode(currentScene) === 'fused_multi_camera') {
        computeVisualizationClusters(filteredTracks);
      } else {
        clearVisualizationClusters();
      }

      trackColorMap.clear();
      filteredTracks.forEach((t, idx) => {
        let hex = colors[idx % colors.length];
        if (anomalyTrackIds.has(t.id)) {
          hex = '#ff4d4f';
        } else {
          const cid = getTrackClusterId(t.id);
          if (Number.isFinite(cid) && cid >= 0) {
            hex = getClusterColorById(cid) || colors[cid % colors.length];
          }
        }
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        trackColorMap.set(t.id, { hex, rgba: [r, g, b, 220] });
      });

      renderClassFilters();
      updateStats();
      drawDeck();
      updateHighlightList();
    }

      function clampFrameToRange(frameAbs) {
        if (!Number.isFinite(frameAbs)) return Number.isFinite(frameRange.min) ? frameRange.min : 0;
        if (!Number.isFinite(frameRange.min) || !Number.isFinite(frameRange.max)) return Math.round(frameAbs);
        return Math.max(frameRange.min, Math.min(frameRange.max, Math.round(frameAbs)));
      }

      function snapFrameToAnnotatedStep(frameAbs) {
        const snapped = Math.round(frameAbs / ANNOTATED_FRAME_STEP) * ANNOTATED_FRAME_STEP;
        return clampFrameToRange(snapped);
      }

      function secToSnappedFrame(sec) {
        const base = Number.isFinite(frameRange.min) ? frameRange.min : 0;
        const frameAbs = Math.round((Number(sec) || 0) * ACTIVE_FPS) + base;
        return snapFrameToAnnotatedStep(frameAbs);
      }

      function snappedFrameToSec(frameAbs) {
        const base = Number.isFinite(frameRange.min) ? frameRange.min : 0;
        const safeFps = Math.max(1e-6, ACTIVE_FPS);
        return Math.max(0, (clampFrameToRange(frameAbs) - base) / safeFps);
      }

    function updateStats() {
      const total = cachedTracks.length;
      const shown = filteredTracks.length;
      const shownRatio = total > 0 ? shown / total : 0;
      const classesShown = new Set(filteredTracks.map(t => t.cls));
      const classDenominator = Math.max(1, availableClasses.length || ALL_VIRAT_CLASSES.length);

      statSummary.textContent = `可见率 ${(shownRatio * 100).toFixed(1)}% · 轨迹 ${shown}/${total} · 类别 ${classesShown.size}/${classDenominator}`;
      statFrames.textContent = `${frameRange.min} – ${frameRange.max}`;
      statTracks.textContent = `${total}`;
      statShown.textContent = `${shown}`;
      statLines.textContent = `${totalLines}`;

      if (statCoverageText) {
        statCoverageText.textContent = `${shown}/${total} (${(shownRatio * 100).toFixed(1)}%)`;
      }
      if (statCoverageBar) {
        const width = Math.max(0, Math.min(100, shownRatio * 100));
        statCoverageBar.style.width = `${width}%`;
      }

      const counts = new Map();
      filteredTracks.forEach(t => counts.set(t.cls, (counts.get(t.cls) || 0) + 1));

      if (classSparklineEl) {
        classSparklineEl.innerHTML = '';
        const maxCount = Math.max(1, ...ALL_VIRAT_CLASSES.map(c => counts.get(c) || 0));
        ALL_VIRAT_CLASSES.forEach((cls) => {
          const col = document.createElement('div');
          col.className = 'spark-col';
          const n = counts.get(cls) || 0;
          const ratio = n / maxCount;

          const bar = document.createElement('span');
          bar.className = 'spark-bar';
          bar.style.height = `${Math.max(6, Math.round(ratio * 52))}px`;
          bar.style.background = colors[cls % colors.length];
          if (!availableClasses.includes(cls)) bar.style.opacity = '0.25';

          const tag = document.createElement('span');
          tag.className = 'spark-tag';
          tag.textContent = classIcons.get(cls) || String(cls);

          const label = classLabels.get(cls) || `Class ${cls}`;
          col.title = `${label}: ${n}`;
          col.appendChild(bar);
          col.appendChild(tag);
          classSparklineEl.appendChild(col);
        });
      }

      const legend = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]).map(([c, n]) => {
        const label = classLabels.get(c) || `类${c}`;
        return `${label}:${n}`;
      }).join('  |  ');

      const clusterCounts = new Map();
      filteredTracks.forEach((t) => {
        const cid = getTrackClusterId(t.id);
        if (Number.isFinite(cid) && cid >= 0) {
          clusterCounts.set(cid, (clusterCounts.get(cid) || 0) + 1);
        }
      });
      const clusterLegend = Array.from(clusterCounts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([cid, n]) => `C${cid}:${n}`)
        .join('  |  ');

      const anomalyShown = filteredTracks.filter(t => anomalyTrackIds.has(t.id)).length;
      const temporalLegend = getSceneMode(currentScene) === 'fused_multi_camera'
        ? (useTemporalWindow ? ('时间窗 ' + Math.round(temporalWindowSec) + 's · wt=' + temporalWeight.toFixed(2)) : '时间窗 关闭')
        : '';
      const adaptiveColorMode = semanticLayoutMode === SEMANTIC_LAYOUTS.AGENT_ADAPTIVE_COLOR;
      const speedLegend = adaptiveColorMode
        ? (hasAgentInteraction
          ? `配色: Agent后局部瞬时速度色(停<=${SPEED_STOP_MAX.toFixed(1)} 走@${SPEED_WALK_REF.toFixed(1)} 跑>=${SPEED_RUN_REF.toFixed(1)} px/s)`
          : '配色: Agent前聚类色（交互后自动切换速度色）')
        : `速度: 停<=${SPEED_STOP_MAX.toFixed(1)} 走@${SPEED_WALK_REF.toFixed(1)} 跑>=${SPEED_RUN_REF.toFixed(1)} px/s`;
      const suffix = [
        clusterLegend ? `簇 ${clusterLegend}` : '',
        anomalyShown ? `异常 ${anomalyShown}` : '',
        temporalLegend,
        speedLegend,
      ].filter(Boolean).join('  |  ');

      statLegend.textContent = suffix ? `${legend || '-'}  |  ${suffix}` : (legend || '-');
      maxSec = (frameRange.max - frameRange.min) / ACTIVE_FPS;
      timeSlider.min = 0;
      timeSlider.max = maxSec;
      timeSlider.step = ANNOTATED_FRAME_STEP / ACTIVE_FPS;
      timeSlider.disabled = false;
        const snappedCurrentFrame = secToSnappedFrame(currentSec);
        currentSec = snappedFrameToSec(snappedCurrentFrame);
        timeSlider.value = String(currentSec);
      updateTimeLabel(currentSec);
    }

      function updateTimeLabel(sec) {
        const frameAbs = secToSnappedFrame(sec);
        const snappedSec = snappedFrameToSec(frameAbs);
        timeLabel.textContent = `Time ${snappedSec.toFixed(2)}s`;
        timeValue.textContent = `Frame ${frameAbs}`;
        updateCurrentFrameDistribution(snappedSec);
      }

    function updateCurrentFrameDistribution(sec) {
      if (!frameDistSummaryEl || !frameXYCanvasEl) return;
      const canvas = frameXYCanvasEl;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const viewW = Math.max(120, canvas.clientWidth || 240);
      const viewH = Math.max(100, canvas.clientHeight || 170);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const pixelW = Math.round(viewW * dpr);
      const pixelH = Math.round(viewH * dpr);
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, viewW, viewH);
      ctx.fillStyle = 'rgba(8, 20, 32, 0.95)';
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.strokeStyle = 'rgba(154, 184, 212, 0.28)';
      ctx.strokeRect(0.5, 0.5, viewW - 1, viewH - 1);
      ctx.strokeStyle = 'rgba(154, 184, 212, 0.16)';
      ctx.beginPath();
      ctx.moveTo(viewW / 2, 0);
      ctx.lineTo(viewW / 2, viewH);
      ctx.moveTo(0, viewH / 2);
      ctx.lineTo(viewW, viewH / 2);
      ctx.stroke();

      if (!Number.isFinite(frameRange.min) || !Number.isFinite(frameRange.max)) {
        frameDistSummaryEl.textContent = '等待加载...';
        if (frameDistLegendEl) frameDistLegendEl.textContent = '-';
        return;
      }

      const frameAbs = secToSnappedFrame(sec);
      const detections = [];
      const clsCount = new Map();
      const detectionTracks = boxSelectionActive && boxSelectedTrackIds.size
        ? filteredTracks.filter((t) => boxSelectedTrackIds.has(Number(t.id)))
        : filteredTracks;

      detectionTracks.forEach((t) => {
        const points = t.points || [];
        let hit = null;
        for (let i = 0; i < points.length; i += 1) {
          if (points[i].frame === frameAbs) {
            hit = points[i];
            break;
          }
        }
        if (!hit) return;
        const colorInfo = trackColorMap.get(t.id);
        const hex = (colorInfo && colorInfo.hex) ? colorInfo.hex : (colors[Math.abs(t.cls) % colors.length] || '#9ad6ff');
        detections.push({ id: t.id, cls: t.cls, p: hit, hex });
        clsCount.set(t.cls, (clsCount.get(t.cls) || 0) + 1);
      });

      const overlayEnabled = !!(agentSummaryOverlay && agentSummaryOverlay.enabled);
      const overlayIdSet = overlayEnabled && agentSummaryOverlay.highlightIds && agentSummaryOverlay.highlightIds.size
        ? agentSummaryOverlay.highlightIds
        : null;

      const rawRange = (overlayEnabled && Array.isArray(agentSummaryOverlay.timeSecRange) && agentSummaryOverlay.timeSecRange.length === 2)
        ? agentSummaryOverlay.timeSecRange
        : [0, maxSec];
      const summaryStartSec = Math.max(0, Math.min(maxSec, Number(rawRange[0]) || 0));
      const summaryEndSec = Math.max(0, Math.min(maxSec, Number(rawRange[1]) || 0));
      const summaryLoSec = Math.min(summaryStartSec, summaryEndSec);
      const summaryHiSec = Math.max(summaryStartSec, summaryEndSec);
      const summaryStartFrame = secToSnappedFrame(summaryLoSec);
      const summaryEndFrame = secToSnappedFrame(summaryHiSec);
      const summaryFrameSpan = Math.max(1, summaryEndFrame - summaryStartFrame);

      const boundsTrackList = (overlayIdSet && overlayIdSet.size)
        ? filteredTracks.filter((t) => overlayIdSet.has(t.id))
        : filteredTracks;
      const tracksForBounds = boundsTrackList.length ? boundsTrackList : filteredTracks;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      tracksForBounds.forEach((t) => {
        (t.points || []).forEach((pt) => {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        });
      });
      if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
        detections.forEach((d) => {
          const pt = d.p;
          minX = Math.min(minX, pt.x);
          maxX = Math.max(maxX, pt.x);
          minY = Math.min(minY, pt.y);
          maxY = Math.max(maxY, pt.y);
        });
      }

      const dx = Math.max(1, maxX - minX);
      const dy = Math.max(1, maxY - minY);
      const padX = dx * 0.06;
      const padY = dy * 0.06;
      minX -= padX;
      maxX += padX;
      minY -= padY;
      maxY += padY;

      const rangeX = Math.max(1e-6, maxX - minX);
      const rangeY = Math.max(1e-6, maxY - minY);
      const panelPad = 6;
      const usableW = Math.max(1, viewW - panelPad * 2);
      const usableH = Math.max(1, viewH - panelPad * 2);
      const uniformScale = Math.min(usableW / rangeX, usableH / rangeY);
      const offsetX = (viewW - rangeX * uniformScale) / 2;
      const offsetY = (viewH - rangeY * uniformScale) / 2;

      const mapX = (x) => offsetX + (x - minX) * uniformScale;
      const mapY = (y) => offsetY + (y - minY) * uniformScale;

      const summaryTracks = new Map();
      const summaryTrackIds = new Set();
      const pairingVisuals = [];
      let interactionBubbleGroups = [];
      if (overlayEnabled) {
        const visibleEvents = getInteractionFocusEventsForCurrentSelection();
        const trackMap = new Map((Array.isArray(filteredTracks) ? filteredTracks : []).map((t) => [Number(t.id), t]));
        const addedPairKey = new Set();
        const bubbleGroupKeySet = new Set();
        const bubblePalette = {
          consistent: {
            stroke: 'rgba(88, 238, 175, 0.96)',
            fill: 'rgba(88, 238, 175, 0.085)',
            linkFill: 'rgba(88, 238, 175, 0.115)',
            badgeFill: 'rgba(18, 52, 40, 0.90)',
            badgeStroke: 'rgba(88, 238, 175, 0.84)',
            badgeText: 'rgba(236, 255, 247, 0.98)',
          },
          conflict: {
            stroke: 'rgba(241, 98, 98, 0.98)',
            fill: 'rgba(241, 98, 98, 0.095)',
            linkFill: 'rgba(241, 98, 98, 0.130)',
            badgeFill: 'rgba(64, 26, 26, 0.92)',
            badgeStroke: 'rgba(241, 98, 98, 0.84)',
            badgeText: 'rgba(255, 235, 235, 0.98)',
          },
          incomplete: {
            stroke: 'rgba(255, 196, 108, 0.94)',
            fill: 'rgba(255, 196, 108, 0.085)',
            linkFill: 'rgba(255, 196, 108, 0.110)',
            badgeFill: 'rgba(67, 47, 19, 0.90)',
            badgeStroke: 'rgba(255, 196, 108, 0.80)',
            badgeText: 'rgba(255, 243, 215, 0.98)',
          },
          none: {
            stroke: 'rgba(175, 192, 210, 0.68)',
            fill: 'rgba(175, 192, 210, 0.060)',
            linkFill: 'rgba(175, 192, 210, 0.080)',
            badgeFill: 'rgba(24, 36, 48, 0.84)',
            badgeStroke: 'rgba(175, 192, 210, 0.58)',
            badgeText: 'rgba(236, 245, 255, 0.98)',
          },
        };
        const getPairingBucket = (pair) => {
          if (pair.kind === 'consistent') return 'consistent';
          if (pair.kind === 'conflict') return 'conflict';
          if (pair.kind === 'incomplete') return 'incomplete';
          return 'none';
        };
        const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
        const normalizeConfidence = (value, fallback = 0.7) => {
          const n = Number(value);
          return Number.isFinite(n) ? clamp01(n) : clamp01(fallback);
        };
        const buildPairStrength = (pair, seedRange, candidateRange, seedConfidence, candidateConfidence) => {
          const seedDuration = Array.isArray(seedRange) ? Math.max(0, Number(seedRange[1]) - Number(seedRange[0])) : 0;
          const candidateDuration = Array.isArray(candidateRange) ? Math.max(0, Number(candidateRange[1]) - Number(candidateRange[0])) : seedDuration;
          const durationBase = Math.max(0.8, Math.min(seedDuration || candidateDuration || 0.8, candidateDuration || seedDuration || 0.8));
          const overlapRaw = Number(pair && pair.overlap);
          const normDistanceRaw = Number(pair && pair.norm_distance);
          const overlapRatio = clamp01((Number.isFinite(overlapRaw) ? overlapRaw : 0) / durationBase);
          const proximity = clamp01(1 - (Number.isFinite(normDistanceRaw) ? normDistanceRaw : 0.18) / 0.18);
          const confidenceAvg = clamp01((seedConfidence + candidateConfidence) * 0.5);
          return clamp01(0.34 * overlapRatio + 0.33 * proximity + 0.33 * confidenceAvg);
        };
        const buildInteractionBubbleGroups = () => {
          const pairings = [];
          visibleEvents.forEach((ev) => {
            if (!ev || !Number.isFinite(Number(ev.track_id))) return;
            const seedTrack = trackMap.get(Number(ev.track_id));
            if (!seedTrack) return;
            const seedRange = resolveEventSecRangeForTrack(ev, seedTrack);
            if (!seedRange) return;
            const seedMid = 0.5 * (seedRange[0] + seedRange[1]);
            const seedPt = getTrackPointAtSec(seedTrack, seedMid);
            if (!seedPt) return;
            const seedType = getCanonicalInteractionToken(ev);
            const pairingsForSeed = buildPairingCandidatesForEvent(ev, trackMap, 3);
            pairingsForSeed.forEach((p) => {
              const candidateTrack = trackMap.get(Number(p.track_id));
              if (!candidateTrack) return;
              const candidateRange = Array.isArray(p.candidate_range) && p.candidate_range.length === 2
                ? [Number(p.candidate_range[0]), Number(p.candidate_range[1])]
                : resolveEventSecRangeForTrack(p.candidate_event_key ? visibleEvents.find((item) => item && item.key === p.candidate_event_key) : null, candidateTrack);
              const rawPairRange = Array.isArray(p.pair_range) && p.pair_range.length === 2
                ? [Number(p.pair_range[0]), Number(p.pair_range[1])]
                : [Math.min(seedRange[0], candidateRange ? candidateRange[0] : seedRange[0]), Math.max(seedRange[1], candidateRange ? candidateRange[1] : seedRange[1])];
              const candidateEvent = p.candidate_event_key
                ? visibleEvents.find((item) => item && item.key === p.candidate_event_key)
                : null;
              const candidateType = getCanonicalInteractionToken(candidateEvent);
              const seedConfidence = normalizeConfidence(ev.confidence, 0.7);
              const candidateConfidence = candidateEvent
                ? normalizeConfidence(candidateEvent.confidence, 0.7)
                : seedConfidence;
              const alignedSingleSidedRange = p.kind === 'incomplete'
                ? (seedType
                  ? [seedRange[0], seedRange[1]]
                  : (candidateRange
                    ? [candidateRange[0], candidateRange[1]]
                    : [rawPairRange[0], rawPairRange[1]]))
                : null;
              const pairRange = alignedSingleSidedRange || rawPairRange;
              const pairKey = `${Number(ev.track_id)}->${Number(p.track_id)}:${p.kind}:${pairRange[0].toFixed(2)}:${pairRange[1].toFixed(2)}`;
              if (bubbleGroupKeySet.has(pairKey)) return;
              bubbleGroupKeySet.add(pairKey);
              const candMid = (p.kind === 'incomplete' ? pairRange : (candidateRange || pairRange))
                ? 0.5 * ((p.kind === 'incomplete' ? pairRange : (candidateRange || pairRange))[0] + (p.kind === 'incomplete' ? pairRange : (candidateRange || pairRange))[1])
                : 0.5 * (pairRange[0] + pairRange[1]);
              const candidateMidPt = getTrackPointAtSec(candidateTrack, candMid) || getTrackPointAtSec(candidateTrack, seedMid);
              const sampleTrackSegment = (track, range) => {
                if (!track || !Array.isArray(range) || range.length !== 2) return [];
                const t0 = Number(range[0]);
                const t1 = Number(range[1]);
                if (!Number.isFinite(t0) || !Number.isFinite(t1)) return [];
                const lo = Math.min(t0, t1);
                const hi = Math.max(t0, t1);
                const sampleCount = Math.max(6, Math.min(18, Math.round(Math.max(0.3, hi - lo) * ACTIVE_FPS / Math.max(1, ANNOTATED_FRAME_STEP)) + 2));
                const points = [];
                for (let i = 0; i < sampleCount; i += 1) {
                  const ratio = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
                  const sec = lo + (hi - lo) * ratio;
                  const sample = getTrackPointAtSec(track, sec);
                  if (!sample || !Number.isFinite(Number(sample.x)) || !Number.isFinite(Number(sample.y))) continue;
                  const x = mapX(Number(sample.x) || 0);
                  const y = mapY(Number(sample.y) || 0);
                  const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
                  if (!points.length || points[points.length - 1].key !== key) {
                    points.push({ x, y, key });
                  }
                }
                return points;
              };
              const seedSampleRange = p.kind === 'incomplete' ? pairRange : seedRange;
              const candidateSampleRange = p.kind === 'incomplete' ? pairRange : (candidateRange || pairRange);
              const pairStrength = buildPairStrength(p, seedRange, candidateRange || seedRange, seedConfidence, candidateConfidence);
              const seedSegmentPoints = sampleTrackSegment(seedTrack, seedSampleRange);
              const candidateSegmentPoints = sampleTrackSegment(candidateTrack, candidateSampleRange);
              if (seedSegmentPoints.length < 2 && candidateSegmentPoints.length < 2) return;
              const allPoints = [];
              seedSegmentPoints.forEach((pt) => allPoints.push({ x: pt.x, y: pt.y }));
              candidateSegmentPoints.forEach((pt) => allPoints.push({ x: pt.x, y: pt.y }));
              const pad = getPairingBucket(p) === 'consistent' ? 14 : (getPairingBucket(p) === 'conflict' ? 12 : (getPairingBucket(p) === 'incomplete' ? 10 : 8));
              const bounds = {
                minX: Math.min(...allPoints.map((pt) => pt.x)) - pad,
                maxX: Math.max(...allPoints.map((pt) => pt.x)) + pad,
                minY: Math.min(...allPoints.map((pt) => pt.y)) - pad,
                maxY: Math.max(...allPoints.map((pt) => pt.y)) + pad,
              };
              pairings.push({
                key: pairKey,
                seedId: Number(ev.track_id),
                candidateId: Number(p.track_id),
                kind: p.kind,
                bucket: getPairingBucket(p),
                score: Number(p.score) || 0,
                overlap: Number(p.overlap) || 0,
                normDistance: Number(p.norm_distance) || 0,
                seedConfidence,
                candidateConfidence,
                strength: pairStrength,
                seedType,
                candidateType,
                seedRange,
                candidateRange: candidateRange || seedRange,
                pairRange,
                seedSegmentPoints,
                candidateSegmentPoints,
                seedMidX: mapX(Number(seedPt.x) || 0),
                seedMidY: mapY(Number(seedPt.y) || 0),
                candidateMidX: candidateMidPt ? mapX(Number(candidateMidPt.x) || 0) : null,
                candidateMidY: candidateMidPt ? mapY(Number(candidateMidPt.y) || 0) : null,
                bounds,
              });
            });
          });

          const groups = [];
          const temporalGapSec = 0.9;
          const spatialGapPx = 96;
          const boundsGapPx = 28;
          pairings
            .sort((a, b) => {
              const order = { consistent: 0, conflict: 1, incomplete: 2, none: 3 };
              if (order[a.bucket] !== order[b.bucket]) return order[a.bucket] - order[b.bucket];
              if (a.pairRange[0] !== b.pairRange[0]) return a.pairRange[0] - b.pairRange[0];
              if (a.pairRange[1] !== b.pairRange[1]) return a.pairRange[1] - b.pairRange[1];
              return a.score - b.score;
            })
            .forEach((item) => {
              const group = groups[groups.length - 1];
              const sameKind = !!group && group.bucket === item.bucket;
              const timeGap = group ? Math.max(0, item.pairRange[0] - group.endSec) : Number.POSITIVE_INFINITY;
              const centerGap = group ? Math.hypot(item.seedMidX - group.centerX, item.seedMidY - group.centerY) : Number.POSITIVE_INFINITY;
              const closeBounds = group
                ? !(item.bounds.minX > group.bounds.maxX + boundsGapPx
                  || item.bounds.maxX < group.bounds.minX - boundsGapPx
                  || item.bounds.minY > group.bounds.maxY + boundsGapPx
                  || item.bounds.maxY < group.bounds.minY - boundsGapPx)
                : false;
              if (!sameKind || (timeGap > temporalGapSec && centerGap > spatialGapPx && !closeBounds)) {
                groups.push({
                  bucket: item.bucket,
                  kind: item.kind,
                  items: [item],
                  startSec: item.pairRange[0],
                  endSec: item.pairRange[1],
                  centerX: item.seedMidX,
                  centerY: item.seedMidY,
                  bounds: { ...item.bounds },
                });
                return;
              }

              group.items.push(item);
              group.startSec = Math.min(group.startSec, item.pairRange[0]);
              group.endSec = Math.max(group.endSec, item.pairRange[1]);
              const n = group.items.length;
              group.centerX = ((group.centerX * (n - 1)) + item.seedMidX) / n;
              group.centerY = ((group.centerY * (n - 1)) + item.seedMidY) / n;
              group.bounds.minX = Math.min(group.bounds.minX, item.bounds.minX);
              group.bounds.maxX = Math.max(group.bounds.maxX, item.bounds.maxX);
              group.bounds.minY = Math.min(group.bounds.minY, item.bounds.minY);
              group.bounds.maxY = Math.max(group.bounds.maxY, item.bounds.maxY);
            });

          return groups
            .filter((group) => group.items.length >= 1)
            .map((group, groupIdx) => {
              const segmentOutlines = [];
              const segmentKeySet = new Set();
              const pairBubbles = [];
              const allPoints = [];
              const addSegmentOutline = (points, trackId, range) => {
                if (!Array.isArray(points) || points.length < 2) return;
                const safeRange = Array.isArray(range) && range.length === 2 ? range : [group.startSec, group.endSec];
                const key = `${trackId}:${safeRange[0].toFixed(2)}:${safeRange[1].toFixed(2)}:${group.bucket}`;
                if (segmentKeySet.has(key)) return;
                segmentKeySet.add(key);
                points.forEach((pt) => allPoints.push({ x: pt.x, y: pt.y }));
                const mid = points[Math.floor(points.length / 2)];
                segmentOutlines.push({
                  key,
                  trackId,
                  points: points.map((pt) => [pt.x, pt.y]),
                  midX: mid ? mid.x : group.centerX,
                  midY: mid ? mid.y : group.centerY,
                });
              };
              group.items.forEach((item) => {
                addSegmentOutline(item.seedSegmentPoints, item.seedId, item.seedRange);
                addSegmentOutline(item.candidateSegmentPoints, item.candidateId, item.candidateRange);
                if (Array.isArray(item.seedSegmentPoints) && item.seedSegmentPoints.length >= 2
                  && Array.isArray(item.candidateSegmentPoints) && item.candidateSegmentPoints.length >= 2) {
                  pairBubbles.push({
                    key: `${item.key}:bubble`,
                    seedId: item.seedId,
                    candidateId: item.candidateId,
                    score: Number(item.score) || 0,
                    overlap: Number(item.overlap) || 0,
                    normDistance: Number(item.normDistance) || 0,
                    seedConfidence: Number.isFinite(Number(item.seedConfidence)) ? Number(item.seedConfidence) : 0.7,
                    candidateConfidence: Number.isFinite(Number(item.candidateConfidence)) ? Number(item.candidateConfidence) : 0.7,
                    seedType: String(item.seedType || '').trim(),
                    candidateType: String(item.candidateType || '').trim(),
                    strength: Number.isFinite(Number(item.strength)) ? Math.max(0, Math.min(1, Number(item.strength))) : 0,
                    seedPoints: item.seedSegmentPoints.map((pt) => [pt.x, pt.y]),
                    candidatePoints: item.candidateSegmentPoints.map((pt) => [pt.x, pt.y]),
                  });
                }
              });
              const palette = bubblePalette[group.bucket] || bubblePalette.none;
              const pad = group.bucket === 'consistent' ? 18 : (group.bucket === 'conflict' ? 16 : (group.bucket === 'incomplete' ? 13 : 10));
              const bounds = allPoints.length
                ? {
                    minX: Math.min(...allPoints.map((pt) => pt.x)) - pad,
                    maxX: Math.max(...allPoints.map((pt) => pt.x)) + pad,
                    minY: Math.min(...allPoints.map((pt) => pt.y)) - pad,
                    maxY: Math.max(...allPoints.map((pt) => pt.y)) + pad,
                  }
                : {
                    minX: group.bounds.minX - pad,
                    maxX: group.bounds.maxX + pad,
                    minY: group.bounds.minY - pad,
                    maxY: group.bounds.maxY + pad,
                  };
              const labelText = group.bucket === 'consistent'
                ? `一致${segmentOutlines.length}`
                : (group.bucket === 'conflict'
                  ? `冲突${segmentOutlines.length}`
                  : (group.bucket === 'incomplete' ? `单侧${segmentOutlines.length}` : `近邻${segmentOutlines.length}`));
              return {
                key: `bubble-${groupIdx}-${group.bucket}`,
                kind: group.kind,
                bucket: group.bucket,
                count: group.items.length,
                segmentOutlines,
                pairBubbles,
                bounds,
                labelText,
                stroke: palette.stroke,
                fill: palette.fill,
                badgeFill: palette.badgeFill,
                badgeStroke: palette.badgeStroke,
                badgeText: palette.badgeText,
                opacity: group.bucket === 'consistent' ? 0.84 : (group.bucket === 'conflict' ? 0.72 : (group.bucket === 'incomplete' ? 0.56 : 0.36)),
              };
            });
        };
        interactionBubbleGroups = buildInteractionBubbleGroups();
        visibleEvents.forEach((ev) => {
          if (!ev || !Number.isFinite(Number(ev.track_id))) return;
          const seedTrack = trackMap.get(Number(ev.track_id));
          if (!seedTrack) return;
          const pairings = buildPairingCandidatesForEvent(ev, trackMap, 3);
          const seedRange = resolveEventSecRangeForTrack(ev, seedTrack);
          if (!seedRange) return;
          const seedMid = 0.5 * (seedRange[0] + seedRange[1]);
          const seedPt = getTrackPointAtSec(seedTrack, seedMid);
          if (!seedPt) return;
          pairings.forEach((p) => {
            const candidateTrack = trackMap.get(Number(p.track_id));
            if (!candidateTrack) return;
            const candPt = getTrackPointAtSec(candidateTrack, seedMid);
            if (!candPt) return;
            const pairKey = `${Number(ev.track_id)}->${Number(p.track_id)}:${p.kind}`;
            if (addedPairKey.has(pairKey)) return;
            addedPairKey.add(pairKey);
            pairingVisuals.push({
              seedId: Number(ev.track_id),
              candidateId: Number(p.track_id),
              kind: p.kind,
              score: Number(p.score) || 0,
              distance: Number(p.distance) || 0,
              normDistance: Number(p.norm_distance) || 0,
              seedX: seedPt.x,
              seedY: seedPt.y,
              candidateX: candPt.x,
              candidateY: candPt.y,
              interactionType: String(ev.interaction_type || ev.interaction_detail || ev.behavior || '').trim() || '交互',
            });
          });
        });

        const keepFullSelectedTracks = boxSelectionActive && boxSelectedTrackIds.size > 0;
        filteredTracks.forEach((t) => {
          if (overlayIdSet && !overlayIdSet.has(t.id)) return;
          const points = (t.points || []).filter((p) => {
            const pf = Number(p.frame);
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
            if (keepFullSelectedTracks && boxSelectedTrackIds.has(Number(t.id))) return true;
            return pf >= summaryStartFrame && pf <= summaryEndFrame;
          });
          if (!points.length) return;
          summaryTrackIds.add(t.id);
          const stride = Math.max(1, Math.floor(points.length / 26));
          const sampled = [];
          for (let i = 0; i < points.length; i += stride) sampled.push(points[i]);
          if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
          const trackFrameStart = keepFullSelectedTracks && boxSelectedTrackIds.has(Number(t.id))
            ? Number(sampled[0].frame)
            : summaryStartFrame;
          const trackFrameEnd = keepFullSelectedTracks && boxSelectedTrackIds.has(Number(t.id))
            ? Number(sampled[sampled.length - 1].frame)
            : summaryEndFrame;
          const trackFrameSpan = Math.max(1, trackFrameEnd - trackFrameStart);
          const mapped = sampled.map((p) => ({
            id: t.id,
            frame: Number(p.frame),
            x: p.x,
            y: p.y,
            tNorm: Math.max(0, Math.min(1, (Number(p.frame) - trackFrameStart) / trackFrameSpan)),
          }));
          summaryTracks.set(t.id, mapped);
        });

        if (summaryTracks.size) {
          ctx.save();
          summaryTracks.forEach((samples, trackId) => {
            if (!Array.isArray(samples) || samples.length < 2) return;
            const colorInfo = trackColorMap.get(trackId);
            const hex = (colorInfo && colorInfo.hex) ? colorInfo.hex : '#9ad6ff';
            const rgba = hexToRgba(hex, 255);
            for (let i = 1; i < samples.length; i += 1) {
              const p0 = samples[i - 1];
              const p1 = samples[i];
              const alpha = 0.12 + p1.tNorm * 0.48;
              ctx.strokeStyle = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${alpha.toFixed(3)})`;
              ctx.lineWidth = 1.4 + p1.tNorm * 1.6;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(mapX(p0.x), mapY(p0.y));
              ctx.lineTo(mapX(p1.x), mapY(p1.y));
              ctx.stroke();
            }
          });
          ctx.restore();
        }

        ctx.save();
        ctx.fillStyle = 'rgba(180, 220, 255, 0.95)';
        ctx.font = '11px "Space Grotesk", sans-serif';
        ctx.fillText('摘要层: 时间由淡到实 · 外轮廓=关系 · 横梁=强度 · 内色=类型', 10, 16);
        ctx.restore();
      }

      if (overlayEnabled && interactionBubbleGroups.length) {
        ctx.save();
        const typeColorPalette = [
          { keys: ['驻足交谈', 'conversation', 'talk', 'chat'], color: [45, 226, 184] },
          { keys: ['同行', 'walking together', 'walk together', 'group', 'together'], color: [77, 171, 255] },
          { keys: ['冲突', 'conflict', 'alert'], color: [255, 111, 82] },
          { keys: ['跟随', 'following', 'follow'], color: [177, 132, 255] },
          { keys: ['接近', 'proximity', 'near', 'approach'], color: [174, 238, 91] },
        ];
        const getTypeColor = (rawType, alpha = 0.92) => {
          const text = String(rawType || '').trim().toLowerCase();
          const match = typeColorPalette.find((entry) => entry.keys.some((key) => text.includes(String(key).toLowerCase())));
          const rgb = match ? match.color : [180, 214, 236];
          return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
        };
        const buildDropletPath = (points, radius) => {
          if (!Array.isArray(points) || points.length < 2) return [];
          const cleaned = [];
          points.forEach((pt) => {
            if (!Array.isArray(pt) || pt.length < 2) return;
            const x = Number(pt[0]);
            const y = Number(pt[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const prev = cleaned[cleaned.length - 1];
            if (!prev || Math.hypot(prev[0] - x, prev[1] - y) > 1.5) cleaned.push([x, y]);
          });
          if (cleaned.length < 2) return [];
          const left = [];
          const right = [];
          const n = cleaned.length;
          for (let i = 0; i < n; i += 1) {
            const prev = cleaned[Math.max(0, i - 1)];
            const next = cleaned[Math.min(n - 1, i + 1)];
            const dx = next[0] - prev[0];
            const dy = next[1] - prev[1];
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const t = n <= 1 ? 0 : i / (n - 1);
            const taper = 0.76 + 0.32 * Math.sin(Math.PI * t);
            const bulb = (i === 0 || i === n - 1) ? 1.18 : 1.0;
            const r = radius * taper * bulb;
            left.push([cleaned[i][0] + nx * r, cleaned[i][1] + ny * r]);
            right.push([cleaned[i][0] - nx * r, cleaned[i][1] - ny * r]);
          }
          return smoothClosedPolygon(left.concat(right.reverse()), 2);
        };
        const fillClosedPath = (path) => {
          if (!Array.isArray(path) || path.length < 3) return;
          traceBubblePath(ctx, path);
          ctx.fill();
          ctx.stroke();
        };
        const resampleScreenPolyline = (points, count) => {
          const src = (Array.isArray(points) ? points : [])
            .map((pt) => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x), Number(pt.y)])
            .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
          if (src.length < 2) return src;
          const distances = [0];
          for (let i = 1; i < src.length; i += 1) {
            const prev = src[i - 1];
            const cur = src[i];
            distances.push(distances[distances.length - 1] + Math.hypot(cur[0] - prev[0], cur[1] - prev[1]));
          }
          const total = distances[distances.length - 1];
          if (total <= 1e-6) return src.slice(0, 1);
          const n = Math.max(2, Math.min(32, Math.round(count) || 12));
          const out = [];
          let seg = 1;
          for (let i = 0; i < n; i += 1) {
            const target = (i / Math.max(1, n - 1)) * total;
            while (seg < distances.length - 1 && distances[seg] < target) seg += 1;
            const d0 = distances[seg - 1];
            const d1 = distances[seg];
            const p0 = src[seg - 1];
            const p1 = src[seg];
            const t = d1 <= d0 ? 0 : (target - d0) / (d1 - d0);
            out.push([
              p0[0] + (p1[0] - p0[0]) * t,
              p0[1] + (p1[1] - p0[1]) * t,
            ]);
          }
          return out;
        };
        const buildUnifiedPairDropletPath = (seedPoints, candidatePoints, radius, strength = 0.5) => {
          const seed = Array.isArray(seedPoints) ? seedPoints : [];
          const candRaw = Array.isArray(candidatePoints) ? candidatePoints : [];
          if (seed.length < 2 || candRaw.length < 2) return [];
          const strengthValue = Math.max(0, Math.min(1, Number(strength) || 0));
          const endpointSame = Math.hypot(seed[0][0] - candRaw[0][0], seed[0][1] - candRaw[0][1])
            + Math.hypot(seed[seed.length - 1][0] - candRaw[candRaw.length - 1][0], seed[seed.length - 1][1] - candRaw[candRaw.length - 1][1]);
          const endpointReverse = Math.hypot(seed[0][0] - candRaw[candRaw.length - 1][0], seed[0][1] - candRaw[candRaw.length - 1][1])
            + Math.hypot(seed[seed.length - 1][0] - candRaw[0][0], seed[seed.length - 1][1] - candRaw[0][1]);
          const cand = endpointReverse < endpointSame ? candRaw.slice().reverse() : candRaw.slice();
          const count = Math.max(12, Math.min(30, Math.max(seed.length, cand.length) * 2));
          const a = resampleScreenPolyline(seed, count);
          const b = resampleScreenPolyline(cand, count);
          if (a.length < 2 || b.length < 2) return [];
          const n = Math.min(a.length, b.length);
          const distances = [];
          let closestIdx = 0;
          let closestDist = Infinity;
          for (let i = 0; i < n; i += 1) {
            const d = Math.hypot(b[i][0] - a[i][0], b[i][1] - a[i][1]);
            distances.push(d);
            if (d < closestDist) {
              closestDist = d;
              closestIdx = i;
            }
          }
          const localThreshold = Math.max(radius * 6.5, 42);
          let startIdx = closestIdx;
          let endIdx = closestIdx;
          while (startIdx > 0 && distances[startIdx - 1] <= localThreshold) startIdx -= 1;
          while (endIdx < n - 1 && distances[endIdx + 1] <= localThreshold) endIdx += 1;
          const minWindow = Math.max(6, Math.round(n * 0.28));
          while ((endIdx - startIdx + 1) < minWindow && (startIdx > 0 || endIdx < n - 1)) {
            const prevDist = startIdx > 0 ? distances[startIdx - 1] : Infinity;
            const nextDist = endIdx < n - 1 ? distances[endIdx + 1] : Infinity;
            if (prevDist <= nextDist && startIdx > 0) startIdx -= 1;
            else if (endIdx < n - 1) endIdx += 1;
            else break;
          }
          if (closestDist > Math.max(radius * 12.0, 96)) return [];
          const span = Math.max(1, endIdx - startIdx);
          const bridgeHalf = Math.max(1, Math.round(span * (0.08 + strengthValue * 0.22)));
          const bridgeStartIdx = Math.max(startIdx + 1, Math.min(endIdx - 1, closestIdx - bridgeHalf));
          const bridgeEndIdx = Math.max(bridgeStartIdx + 1, Math.min(endIdx - 1, closestIdx + bridgeHalf));
          const aOuter = [];
          const aInner = [];
          const bInner = [];
          const bOuter = [];
          for (let i = startIdx; i <= endIdx; i += 1) {
            const ax = a[i][0];
            const ay = a[i][1];
            const bx = b[i][0];
            const by = b[i][1];
            const vx = bx - ax;
            const vy = by - ay;
            let len = Math.hypot(vx, vy);
            let ux = len > 1e-6 ? vx / len : 0;
            let uy = len > 1e-6 ? vy / len : 1;
            if (len <= 1e-6) {
              const prev = a[Math.max(0, i - 1)];
              const next = a[Math.min(n - 1, i + 1)];
              const tx = next[0] - prev[0];
              const ty = next[1] - prev[1];
              const tl = Math.hypot(tx, ty) || 1;
              ux = -ty / tl;
              uy = tx / tl;
              len = 0;
            }
            const t = (i - startIdx) / span;
            const waist = 0.70 + 0.36 * Math.sin(Math.PI * t);
            const closeness = Math.max(0, 1 - Math.min(1, len / localThreshold));
            const inBridge = i >= bridgeStartIdx && i <= bridgeEndIdx;
            const bridgeBoost = inBridge ? 1 + strengthValue * 0.22 : 1;
            const r = radius * waist * (0.96 + closeness * 0.14) * bridgeBoost;
            aOuter.push([ax - ux * r, ay - uy * r, i]);
            aInner.push([ax + ux * r, ay + uy * r, i]);
            bInner.push([bx - ux * r, by - uy * r, i]);
            bOuter.push([bx + ux * r, by + uy * r, i]);
          }
          const indexOffset = (idx) => Math.max(0, Math.min(idx - startIdx, aOuter.length - 1));
          const bridgeStart = indexOffset(bridgeStartIdx);
          const bridgeEnd = indexOffset(bridgeEndIdx);
          const path = [];
          const pushPoint = (pt) => {
            if (!pt) return;
            path.push([pt[0], pt[1]]);
          };
          for (let i = 0; i < aOuter.length; i += 1) pushPoint(aOuter[i]);
          for (let i = aInner.length - 1; i >= bridgeEnd; i -= 1) pushPoint(aInner[i]);
          pushPoint(bInner[bridgeEnd]);
          for (let i = bridgeEnd + 1; i < bInner.length; i += 1) pushPoint(bInner[i]);
          for (let i = bOuter.length - 1; i >= 0; i -= 1) pushPoint(bOuter[i]);
          for (let i = 0; i <= bridgeStart; i += 1) pushPoint(bInner[i]);
          pushPoint(aInner[bridgeStart]);
          for (let i = bridgeStart - 1; i >= 0; i -= 1) pushPoint(aInner[i]);
          return smoothClosedPolygon(path, 2);
        };
        const drawTypeHighlight = (points, type, strength) => {
          const src = (Array.isArray(points) ? points : [])
            .map((pt) => Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.x), Number(pt.y)])
            .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
          if (src.length < 2) return;
          const strengthValue = Math.max(0, Math.min(1, Number(strength) || 0));
          ctx.save();
          ctx.strokeStyle = getTypeColor(type, 0.72 + strengthValue * 0.22);
          ctx.lineWidth = 1.2 + strengthValue * 1.9;
          ctx.shadowColor = getTypeColor(type, 0.65);
          ctx.shadowBlur = 4 + strengthValue * 5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(src[0][0], src[0][1]);
          for (let i = 1; i < src.length; i += 1) ctx.lineTo(src[i][0], src[i][1]);
          ctx.stroke();
          ctx.restore();
        };
        const drawBadge = (group) => {
          const label = String(group.labelText || '').trim();
          if (!label || !group.bounds) return;
          ctx.save();
          ctx.font = '11px "Space Grotesk", sans-serif';
          const tw = ctx.measureText(label).width;
          const w = Math.max(34, tw + 16);
          const h = 22;
          const x = Math.max(6, Math.min(viewW - w - 6, Number(group.bounds.maxX) - w));
          const y = Math.max(22, Math.min(viewH - h - 6, Number(group.bounds.minY) - h - 4));
          ctx.globalAlpha = 0.96;
          ctx.fillStyle = group.badgeFill;
          ctx.strokeStyle = group.badgeStroke;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, w, h, 10);
          } else {
            ctx.rect(x, y, w, h);
          }
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = group.badgeText;
          ctx.fillText(label, x + 8, y + 15);
          ctx.restore();
        };
        interactionBubbleGroups.forEach((group) => {
          if (!Array.isArray(group.segmentOutlines) || !group.segmentOutlines.length) return;
          const alpha = Number.isFinite(Number(group.opacity)) ? Math.max(0.70, Math.min(0.98, Number(group.opacity) + 0.08)) : 0.86;
          ctx.globalAlpha = alpha;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = group.stroke;
          ctx.shadowBlur = group.bucket === 'consistent' ? 12 : (group.bucket === 'conflict' ? 11 : (group.bucket === 'incomplete' ? 9 : 5));
          ctx.setLineDash([]);
          const hasPairBubbles = Array.isArray(group.pairBubbles) && group.pairBubbles.length > 0;
          if (hasPairBubbles) {
            group.pairBubbles.forEach((pairBubble) => {
              const strength = Math.max(0, Math.min(1, Number(pairBubble.strength) || 0));
              const radius = group.bucket === 'consistent' ? 7.4 : (group.bucket === 'conflict' ? 7.2 : (group.bucket === 'incomplete' ? 6.7 : 5.9));
              const path = buildUnifiedPairDropletPath(pairBubble.seedPoints, pairBubble.candidatePoints, radius, strength);
              if (!path.length) return;
              ctx.fillStyle = group.fill;
              ctx.strokeStyle = group.stroke;
              ctx.lineWidth = group.bucket === 'consistent' ? 2.8 : (group.bucket === 'conflict' ? 2.7 : (group.bucket === 'incomplete' ? 2.4 : 1.8));
              ctx.setLineDash([]);
              fillClosedPath(path);
              drawTypeHighlight(pairBubble.seedPoints, pairBubble.seedType || pairBubble.candidateType, strength);
              drawTypeHighlight(pairBubble.candidatePoints, pairBubble.candidateType || pairBubble.seedType, strength);
            });
          } else {
            group.segmentOutlines.forEach((segment) => {
              if (!Array.isArray(segment.points) || segment.points.length < 2) return;
              const radius = group.bucket === 'consistent' ? 6.6 : (group.bucket === 'conflict' ? 6.4 : (group.bucket === 'incomplete' ? 6.0 : 5.4));
              const path = buildDropletPath(segment.points, radius);
              if (!path.length) return;
              ctx.fillStyle = group.fill;
              ctx.strokeStyle = group.stroke;
              ctx.lineWidth = group.bucket === 'consistent' ? 2.0 : (group.bucket === 'conflict' ? 2.0 : (group.bucket === 'incomplete' ? 1.8 : 1.3));
              if (group.bucket === 'conflict') {
                ctx.setLineDash([]);
              } else if (group.bucket === 'incomplete') {
                ctx.setLineDash([5, 3]);
              } else if (group.bucket === 'none') {
                ctx.setLineDash([2, 4]);
              } else {
                ctx.setLineDash([]);
              }
              fillClosedPath(path);
            });
          }
          ctx.setLineDash([]);
        });
        ctx.restore();
      }



      ctx.font = '10px "Space Grotesk", sans-serif';
      ctx.lineWidth = 1.2;
      if (!detections.length) {
        ctx.fillStyle = '#8fa7bf';
        ctx.font = '11px "Space Grotesk", sans-serif';
        ctx.fillText('当前帧无识别目标', 12, 22);
      } else {
        const pairingByTrack = new Map();
        pairingVisuals.forEach((pair) => {
          const listA = pairingByTrack.get(pair.seedId) || [];
          listA.push(pair);
          pairingByTrack.set(pair.seedId, listA);
          const listB = pairingByTrack.get(pair.candidateId) || [];
          listB.push(pair);
          pairingByTrack.set(pair.candidateId, listB);
        });

        detections.forEach((d) => {
          const p = d.p;
          const bw = Math.max(6, Number(p.w) || 20);
          const bh = Math.max(6, Number(p.h) || 20);
          const x0 = mapX(p.x - bw / 2);
          const y0 = mapY(p.y - bh / 2);
          const x1 = mapX(p.x + bw / 2);
          const y1 = mapY(p.y + bh / 2);
          const rw = Math.max(2, x1 - x0);
          const rh = Math.max(2, y1 - y0);

          const hex = d.hex || '#9ad6ff';
          const relatedPairs = pairingByTrack.get(d.id) || [];
          const hasConsistent = relatedPairs.some((pair) => pair.kind === 'consistent');
          const hasConflict = relatedPairs.some((pair) => pair.kind === 'conflict');
          const hasIncomplete = relatedPairs.some((pair) => pair.kind === 'incomplete');
          const hasNone = relatedPairs.some((pair) => pair.kind === 'none');
          const hasStrongNear = hasNone && relatedPairs.some((pair) => (Number(pair.score) || 0) >= 0.82 && (Number(pair.normDistance) || 999) <= 0.035);
          if (hasConsistent) {
            ctx.strokeStyle = '#58eeaf';
            ctx.setLineDash([]);
            ctx.lineWidth = 2.4;
          } else if (hasConflict) {
            ctx.strokeStyle = '#f16262';
            ctx.setLineDash([6, 3]);
            ctx.lineWidth = 2.2;
          } else if (hasIncomplete) {
            ctx.strokeStyle = '#ffc46c';
            ctx.setLineDash([5, 3]);
            ctx.lineWidth = 1.9;
          } else if (hasStrongNear) {
            ctx.strokeStyle = 'rgba(175, 192, 210, 0.64)';
            ctx.setLineDash([2, 4]);
            ctx.lineWidth = 1.3;
          } else {
            ctx.strokeStyle = hex;
            ctx.setLineDash([]);
            ctx.lineWidth = 1.2;
          }
          ctx.globalAlpha = 1;
          ctx.strokeRect(x0, y0, rw, rh);

          const ringEnabled = overlayEnabled && (!overlayIdSet || overlayIdSet.has(d.id));
          if (ringEnabled) {
            const cx = mapX(p.x);
            const cy = mapY(p.y);
            const radius = Math.max(6, Math.max(rw, rh) * 0.50);
            ctx.save();
            ctx.shadowColor = hasConsistent ? '#58eeaf' : (hasConflict ? '#f16262' : (hasIncomplete ? '#ffc46c' : hex));
            ctx.shadowBlur = hasConsistent ? 24 : 16;
            ctx.strokeStyle = hasConsistent ? '#58eeaf' : (hasConflict ? '#f16262' : (hasIncomplete ? '#ffc46c' : hex));
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = hasConsistent ? 2.8 : (hasConflict ? 2.4 : 2.0);
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }

          const label = `ID${d.id}`;
          const tw = ctx.measureText(label).width + 6;
          ctx.fillStyle = hex;
          ctx.fillRect(x0, Math.max(0, y0 - 12), tw, 11);
          ctx.fillStyle = '#08131f';
          ctx.fillText(label, x0 + 3, Math.max(8, y0 - 3));
        });
      }

      if (frameDistLegendEl) {
        const classLegend = Array.from(clsCount.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([cls, n]) => `${(classLabels.get(cls) || `类${cls}`).split('(')[0].trim()}:${n}`)
          .join('  |  ');
        if (overlayEnabled) {
          const consistentCount = pairingVisuals.filter((pair) => pair.kind === 'consistent').length;
          const conflictCount = pairingVisuals.filter((pair) => pair.kind === 'conflict').length;
          const incompleteCount = pairingVisuals.filter((pair) => pair.kind === 'incomplete').length;
          const noneCount = pairingVisuals.filter((pair) => pair.kind === 'none').length;
          const summaryLegend = `摘要 ${summaryLoSec.toFixed(1)}-${summaryHiSec.toFixed(1)}s · 轨迹${summaryTrackIds.size} · 一致${consistentCount} / 冲突${conflictCount} / 单侧${incompleteCount} / 灰${noneCount} · 时间由淡到实`;
          frameDistLegendEl.textContent = classLegend ? `${summaryLegend}  |  ${classLegend}` : summaryLegend;
        } else {
          frameDistLegendEl.textContent = classLegend || '-';
        }
      }
    }
    function updateHighlightList() {
      const box = document.getElementById('highlightList');
      if (!box) return;
      const idSet = new Set(highlightTrackIds);
      const entries = filteredTracks
        .filter(t => idSet.has(t.id))
        .map(t => {
          const info = trackColorMap.get(t.id);
          const hex = (info && info.hex) ? info.hex : '#cccccc';
          const label = classLabels.get(t.cls) || `类 ${t.cls}`;
          const clusterId = getTrackClusterId(t.id);
          const anomaly = anomalyTrackIds.has(t.id);
          return { id: t.id, cls: t.cls, label, hex, clusterId, anomaly };
        });
      if (!entries.length) { box.textContent = '暂无'; return; }
      const groupOrder = [1, 2, 3, 4, 5];
      const groups = new Map();
      for (const e of entries) {
        if (!groups.has(e.cls)) groups.set(e.cls, []);
        groups.get(e.cls).push(e);
      }
      const renderItem = (e) => `
        <div style="display:flex; align-items:center; gap:8px; padding:2px 0;">
          <span style="display:inline-block; width:14px; height:14px; border-radius:3px; background:${e.hex}; border:1px solid rgba(255,255,255,0.25);"></span>
          <span style="font-size:12px; color:#cfe0f3;">ID ${e.id}</span>
          ${Number.isFinite(e.clusterId) && e.clusterId >= 0 ? `<span style="font-size:11px; color:#9ad6ff;">C${e.clusterId}</span>` : ''}
          ${e.anomaly ? '<span style="font-size:11px; color:#ff9a9a;">异常</span>' : ''}
        </div>`;
      const html = [];
      for (const cls of groupOrder) {
        const group = groups.get(cls);
        if (!group || !group.length) continue;
        const headerLabel = classLabels.get(cls) || `类 ${cls}`;
        html.push(`<div style="margin-top:6px; font-weight:600; color:#cfe0f3;">${headerLabel} · ${group.length}</div>`);
        html.push(group.map(renderItem).join(''));
      }
      box.innerHTML = html.join('');
    }

    function computeBounds() {
      // Avoid spread on large arrays to prevent call stack overflow
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const t of filteredTracks) {
        for (const p of t.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      return { minX, maxX, minY, maxY };
    }
