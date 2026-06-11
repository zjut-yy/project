// 3D轨迹图层组件
// 绘制自车的3D时空轨迹

import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { STCTrajectoryPoint } from '../types';
import { LAYER_STYLES, getTrajectoryColor, rgbaToArray } from '../config';

interface TrajectoryLayer3DProps {
  trajectoryPoints: STCTrajectoryPoint[];
  showPoints?: boolean; // 是否显示轨迹点
}

/**
 * 创建3D轨迹图层
 */
export function createTrajectoryLayers(props: TrajectoryLayer3DProps) {
  const { trajectoryPoints, showPoints = true } = props;
  const deckLayers: Layer[] = [];

  if (trajectoryPoints.length === 0) {
    return deckLayers;
  }

  // 轨迹线（路径）
  deckLayers.push(
    new PathLayer({
      id: 'trajectory-path',
      data: [{ path: trajectoryPoints.map(p => p.position) }],
      getPath: (d: { path: [number, number, number][] }) => d.path,
      getColor: rgbaToArray(LAYER_STYLES.trajectory.stroke),
      getWidth: LAYER_STYLES.trajectory.width,
      widthUnits: 'pixels',
      pickable: false,
    })
  );

  // 轨迹点（可选，用渐变色表示时间）
  if (showPoints) {
    const totalFrames = trajectoryPoints.length;
    deckLayers.push(
      new ScatterplotLayer({
        id: 'trajectory-points',
        data: trajectoryPoints,
        getPosition: (d: STCTrajectoryPoint) => d.position,
        getRadius: 0.1, // 0.5米半径
        getFillColor: (d: STCTrajectoryPoint) => 
          rgbaToArray(getTrajectoryColor(d.index, totalFrames)),
        pickable: false,
        radiusUnits: 'meters',
      })
    );
  }

  return deckLayers;
}

