// 指标墙数据处理 Hook
// 从场景指标数据提取 mapping、detection 和 planning 指标，生成墙的节点数据

import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import type { FrameMetrics } from '@/types';
import type { STCTrajectoryPoint, AttributeWallNode, AttributeWallConfig } from '../types';
import { METRICS_WALL_CONFIG, getMappingColor, getDetectionColor, getPlanningColor, ATTRIBUTE_WALL_STYLE } from '../config';

interface UseMetricsWallProps {
  trajectoryPoints: STCTrajectoryPoint[];
  config?: Partial<AttributeWallConfig>;
}

/**
 * 构建指标墙配置
 */
function buildMetricsWallConfig(
  config?: Partial<AttributeWallConfig>
): AttributeWallConfig {
  return {
    height: config?.height ?? METRICS_WALL_CONFIG.HEIGHT,
    baseHeight: config?.baseHeight ?? METRICS_WALL_CONFIG.BASE_HEIGHT,
    opacity: config?.opacity ?? METRICS_WALL_CONFIG.OPACITY,
    showSeparators: config?.showSeparators ?? ATTRIBUTE_WALL_STYLE.SHOW_SEPARATORS,
    showVerticalLines: config?.showVerticalLines ?? ATTRIBUTE_WALL_STYLE.SHOW_VERTICAL_LINES,
    showLabels: config?.showLabels ?? ATTRIBUTE_WALL_STYLE.SHOW_LABELS,
    verticalLineColor: config?.verticalLineColor ?? ATTRIBUTE_WALL_STYLE.VERTICAL_LINE_COLOR,
    verticalLineWidth: config?.verticalLineWidth ?? ATTRIBUTE_WALL_STYLE.VERTICAL_LINE_WIDTH,
    separatorColor: config?.separatorColor ?? ATTRIBUTE_WALL_STYLE.SEPARATOR_COLOR,
    separatorWidth: config?.separatorWidth ?? ATTRIBUTE_WALL_STYLE.SEPARATOR_WIDTH,
    bands: config?.bands ?? [
      {
        id: 'mapping',
        label: 'Mapping',
        show: true,
        heightRatio: 1 / 3,
      },
      {
        id: 'detection',
        label: 'Detection',
        show: true,
        heightRatio: 1 / 3,
      },
      {
        id: 'planning',
        label: 'Planning',
        show: true,
        heightRatio: 1 / 3,
      },
    ],
  };
}

/**
 * 提取和处理指标数据，生成墙的节点数据
 */
export function useMetricsWall({
  trajectoryPoints,
  config,
}: UseMetricsWallProps): {
  nodes: AttributeWallNode[];
  wallConfig: AttributeWallConfig;
  mappingRange: { min: number; max: number };
  detectionRange: { min: number; max: number };
  planningRange: { min: number; max: number };
} {
  const metrics = useAppSelector((state) => state.currentScene.metrics);

  return useMemo(() => {
    if (!metrics?.frame_metrics || trajectoryPoints.length < 2) {
      return {
        nodes: [],
        wallConfig: buildMetricsWallConfig(config),
        mappingRange: { min: 0, max: 0 },
        detectionRange: { min: 0, max: 0 },
        planningRange: { min: 0, max: 0 },
      };
    }

    // 构建配置
    const wallConfig = buildMetricsWallConfig(config);

    // 创建帧索引到 frame_metrics 的映射
    const metricsMap = new Map<number, FrameMetrics>();
    metrics.frame_metrics.forEach((frameMetric) => {
      metricsMap.set(frameMetric.frame_index, frameMetric);
    });

    // 提取所有指标值，计算范围
    const mappingMAPs: number[] = [];
    const detectionNDSs: number[] = [];
    const planningErrors: number[] = [];

    metrics.frame_metrics.forEach((frameMetric) => {
      if (frameMetric.mapping?.mAP !== undefined) {
        mappingMAPs.push(frameMetric.mapping.mAP);
      }
      if (frameMetric.detection?.NDS !== undefined) {
        detectionNDSs.push(frameMetric.detection.NDS);
      }
      if (frameMetric.planning?.mean_l2_error !== undefined) {
        planningErrors.push(frameMetric.planning.mean_l2_error);
      }
    });

    const mappingMin = 0;
    const mappingMax = 1;
    const detectionMin = 0;
    const detectionMax = 1;
    const planningMin = 0;
    const planningMax = 2;

    // 生成节点数据
    const nodes: AttributeWallNode[] = [];

    for (let i = 0; i < trajectoryPoints.length; i++) {
      const p = trajectoryPoints[i];
      const frameMetric = metricsMap.get(p.index);

      // 如果没有对应指标，尝试使用前一帧的指标
      const metricToUse = frameMetric || (i > 0 ? metricsMap.get(trajectoryPoints[i - 1].index) : null);

      if (!metricToUse) continue;

      // 提取指标值
      const mappingMAP = metricToUse.mapping?.mAP ?? 0;
      const detectionNDS = metricToUse.detection?.NDS ?? 0;
      const planningError = metricToUse.planning?.mean_l2_error ?? 0;

      // 计算颜色
      const mappingColor = getMappingColor(mappingMAP, mappingMin, mappingMax, wallConfig.opacity);
      const detectionColor = getDetectionColor(detectionNDS, detectionMin, detectionMax, wallConfig.opacity);
      const planningColor = getPlanningColor(planningError, planningMin, planningMax, wallConfig.opacity);

      nodes.push({
        index: i,
        frameIndex: p.index,
        position: p.position,
        attributes: {
          mapping: {
            value: mappingMAP,
            color: mappingColor,
          },
          detection: {
            value: detectionNDS,
            color: detectionColor,
          },
          planning: {
            value: planningError,
            color: planningColor,
          },
        },
      });
    }

    return {
      nodes,
      wallConfig,
      mappingRange: { min: mappingMin, max: mappingMax },
      detectionRange: { min: detectionMin, max: detectionMax },
      planningRange: { min: planningMin, max: planningMax },
    };
  }, [metrics, trajectoryPoints, config]);
}


