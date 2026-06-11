// 检测时间线墙数据处理 Hook
// 将 DetectionTimeline 的 2D 像素矩阵映射为 3D 城墙数据

import { useMemo } from 'react';
import type { ObjectLifeline } from '@/components/DetectionTimeline/types';
import { ObjectState } from '@/components/DetectionTimeline/types';
import type { STCTrajectoryPoint, AttributeWallNode, AttributeWallConfig } from '../types';
import { DETECTION_TIMELINE_WALL_CONFIG, hexToRGBA, ATTRIBUTE_WALL_STYLE } from '../config';

interface UseDetectionTimelineWallProps {
  objectLifelines: ObjectLifeline[];
  trajectoryPoints: STCTrajectoryPoint[];
  config?: Partial<AttributeWallConfig>;
}

/**
 * 构建检测时间线墙配置
 */
function buildDetectionTimelineWallConfig(
  objectCount: number,
  config?: Partial<AttributeWallConfig>
): AttributeWallConfig {
  // 动态计算总高度
  const totalHeight = objectCount * DETECTION_TIMELINE_WALL_CONFIG.HEIGHT_PER_OBJECT;
  
  // 为每个对象创建一个 band
  const bands = Array.from({ length: objectCount }, (_, index) => ({
    id: `object-${index}`,
    label: `Object ${index}`,
    show: true,
    heightRatio: 1 / objectCount, // 均分高度
  }));

  return {
    height: config?.height ?? totalHeight,
    baseHeight: config?.baseHeight ?? DETECTION_TIMELINE_WALL_CONFIG.BASE_HEIGHT,
    opacity: config?.opacity ?? DETECTION_TIMELINE_WALL_CONFIG.OPACITY,
    showSeparators: config?.showSeparators ?? DETECTION_TIMELINE_WALL_CONFIG.SHOW_SEPARATORS,
    showVerticalLines: config?.showVerticalLines ?? DETECTION_TIMELINE_WALL_CONFIG.SHOW_VERTICAL_LINES,
    showLabels: config?.showLabels ?? DETECTION_TIMELINE_WALL_CONFIG.SHOW_LABELS,
    verticalLineColor: config?.verticalLineColor ?? ATTRIBUTE_WALL_STYLE.VERTICAL_LINE_COLOR,
    verticalLineWidth: config?.verticalLineWidth ?? ATTRIBUTE_WALL_STYLE.VERTICAL_LINE_WIDTH,
    separatorColor: config?.separatorColor ?? ATTRIBUTE_WALL_STYLE.SEPARATOR_COLOR,
    separatorWidth: config?.separatorWidth ?? ATTRIBUTE_WALL_STYLE.SEPARATOR_WIDTH,
    bands,
  };
}

/**
 * 提取和处理检测时间线数据，生成墙的节点数据
 */
export function useDetectionTimelineWall({
  objectLifelines,
  trajectoryPoints,
  config,
}: UseDetectionTimelineWallProps): {
  nodes: AttributeWallNode[];
  wallConfig: AttributeWallConfig;
} {
  return useMemo(() => {
    // 如果没有数据，返回空
    if (objectLifelines.length === 0 || trajectoryPoints.length === 0) {
      return {
        nodes: [],
        wallConfig: buildDetectionTimelineWallConfig(0, config),
      };
    }

    // 构建配置
    const wallConfig = buildDetectionTimelineWallConfig(objectLifelines.length, config);

    // 生成节点数据
    const nodes: AttributeWallNode[] = [];

    // 遍历每一帧（沿轨迹）
    for (let i = 0; i < trajectoryPoints.length; i++) {
      const trajectoryPoint = trajectoryPoints[i];
      const frameIndex = trajectoryPoint.index;

      // 为当前帧创建一个节点
      const node: AttributeWallNode = {
        index: i,
        frameIndex: frameIndex,
        position: trajectoryPoint.position,
        attributes: {},
      };

      // 遍历所有对象（垂直堆叠）
      objectLifelines.forEach((lifeline, objectIndex) => {
        const bandId = `object-${objectIndex}`;

        // 获取当前帧的单元格
        const cell = lifeline.cells[frameIndex];

        // 如果单元格存在且不是背景状态
        if (cell && cell.state !== ObjectState.BACKGROUND) {
          // 解析颜色和透明度
          const color = hexToRGBA(cell.color, cell.opacity);

          // 添加到节点的 attributes
          node.attributes[bandId] = {
            value: cell.state, // 状态值（虽然不用于渲染，但可用于调试）
            color: color,
          };
        }
        // 如果是背景状态，不添加属性（保持透明）
      });

      nodes.push(node);
    }

    return {
      nodes,
      wallConfig,
    };
  }, [objectLifelines, trajectoryPoints, config]);
}
















