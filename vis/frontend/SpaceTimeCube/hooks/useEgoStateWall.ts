// 自车状态墙数据处理 Hook
// 从场景元数据提取速度和加速度，生成墙的节点数据

import { useMemo } from 'react';
import type { SceneMetadata, EgoState } from '@/types';
import type { STCTrajectoryPoint, AttributeWallNode, AttributeWallConfig } from '../types';
import { EGO_STATE_WALL_CONFIG, getVelocityColor, getAccelerationColor, ATTRIBUTE_WALL_STYLE } from '../config';

interface UseEgoStateWallProps {
  sceneMetadata: SceneMetadata | null;
  trajectoryPoints: STCTrajectoryPoint[];
  config?: Partial<AttributeWallConfig>;
}

/**
 * 构建自车状态墙配置
 */
function buildEgoStateWallConfig(
  config?: Partial<AttributeWallConfig>
): AttributeWallConfig {
  return {
    height: config?.height ?? EGO_STATE_WALL_CONFIG.HEIGHT,
    baseHeight: config?.baseHeight ?? EGO_STATE_WALL_CONFIG.BASE_HEIGHT,
    opacity: config?.opacity ?? EGO_STATE_WALL_CONFIG.OPACITY,
    showSeparators: config?.showSeparators ?? ATTRIBUTE_WALL_STYLE.SHOW_SEPARATORS,
    showVerticalLines: config?.showVerticalLines ?? ATTRIBUTE_WALL_STYLE.SHOW_VERTICAL_LINES,
    showLabels: config?.showLabels ?? ATTRIBUTE_WALL_STYLE.SHOW_LABELS,
    verticalLineColor: config?.verticalLineColor ?? ATTRIBUTE_WALL_STYLE.VERTICAL_LINE_COLOR,
    verticalLineWidth: config?.verticalLineWidth ?? ATTRIBUTE_WALL_STYLE.VERTICAL_LINE_WIDTH,
    separatorColor: config?.separatorColor ?? ATTRIBUTE_WALL_STYLE.SEPARATOR_COLOR,
    separatorWidth: config?.separatorWidth ?? ATTRIBUTE_WALL_STYLE.SEPARATOR_WIDTH,
    bands: config?.bands ?? [
      {
        id: 'acceleration',
        label: '加速度',
        show: true,
        heightRatio: 0.5,
      },
      {
        id: 'velocity',
        label: '速度',
        show: true,
        heightRatio: 0.5,
      },
    ],
  };
}

/**
 * 提取和处理自车状态数据，生成墙的节点数据
 */
export function useEgoStateWall({
  sceneMetadata,
  trajectoryPoints,
  config,
}: UseEgoStateWallProps): {
  nodes: AttributeWallNode[];
  wallConfig: AttributeWallConfig;
  velocityRange: { min: number; max: number };
  accelerationRange: { min: number; max: number };
} {
  return useMemo(() => {
    if (!sceneMetadata?.ego_states || trajectoryPoints.length < 2) {
      return {
        nodes: [],
        wallConfig: buildEgoStateWallConfig(config),
        velocityRange: { min: 0, max: 0 },
        accelerationRange: { min: 0, max: 0 },
      };
    }

    // 构建配置
    const wallConfig = buildEgoStateWallConfig(config);

    // 创建帧索引到 ego_state 的映射
    const egoStateMap = new Map<number, EgoState>();
    sceneMetadata.ego_states.forEach((state) => {
      egoStateMap.set(state.frame_index, state);
    });

    // 提取所有速度和加速度值，计算范围
    const velocities: number[] = [];
    const accelerations: number[] = [];

    sceneMetadata.ego_states.forEach((state) => {
      velocities.push(state.state.velocity);
      accelerations.push(state.state.acceleration);
    });

    const velocityMin = 0;
    const velocityMax = 10;
    const accelerationMin = Math.min(...accelerations);
    const accelerationMax = Math.max(...accelerations);

    // 生成节点数据
    const nodes: AttributeWallNode[] = [];

    for (let i = 0; i < trajectoryPoints.length; i++) {
      const p = trajectoryPoints[i];
      const egoState = egoStateMap.get(p.index);

      // 如果没有对应状态，尝试使用前一个状态
      const stateToUse = egoState || (i > 0 ? egoStateMap.get(trajectoryPoints[i - 1].index) : null);

      if (!stateToUse) continue;

      const velocity = stateToUse.state.velocity;
      const acceleration = stateToUse.state.acceleration;

      // 计算颜色
      const velocityColor = getVelocityColor(velocity, velocityMin, velocityMax, wallConfig.opacity);
      const accelerationColor = getAccelerationColor(acceleration, accelerationMin, accelerationMax, wallConfig.opacity);

      nodes.push({
        index: i,
        frameIndex: p.index,
        position: p.position,
        attributes: {
          velocity: {
            value: velocity,
            color: velocityColor,
          },
          acceleration: {
            value: acceleration,
            color: accelerationColor,
          },
        },
      });
    }

    return {
      nodes,
      wallConfig,
      velocityRange: { min: velocityMin, max: velocityMax },
      accelerationRange: { min: accelerationMin, max: accelerationMax },
    };
  }, [sceneMetadata, trajectoryPoints, config]);
}

