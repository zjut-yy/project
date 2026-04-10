// 选中对象位置点图层（简化版：用点代替立方体）

import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Point3D } from '../types';

/** 帧位置点数据 */
export interface FramePointData {
  frameIndex: number;
  position: Point3D; // [x, y, z]
  type: 'gt' | 'prediction';
  score: number; // GT固定为1.0，预测为实际分数
  error: number; // 位置误差（米），GT固定为0
}

/** 选中对象数据 */
export interface SelectedObjectTrackData {
  instanceId: number;
  category: string;
  currentFrameIndex: number;
  points: FramePointData[];
}

interface CreateSelectedObjectTrackLayersOptions {
  selectedTrack: SelectedObjectTrackData | null;
}

/**
 * 根据误差值获取点的颜色（绿色->黄色->红色）
 */
function getPointColorByError(error: number): [number, number, number, number] {
  // 误差范围：0-2米
  // 0m: 绿色 [0, 255, 0]
  // 1m: 黄色 [255, 255, 0]
  // 2m+: 红色 [255, 0, 0]
  
  if (error <= 1.0) {
    // 0-1米：绿色到黄色
    const ratio = error;
    return [
      Math.round(255 * ratio),
      255,
      0,
      255, // 不透明
    ];
  } else {
    // 1-2米：黄色到红色
    const ratio = Math.min(1, error - 1.0);
    return [
      255,
      Math.round(255 * (1 - ratio)),
      0,
      255, // 不透明
    ];
  }
}


/**
 * 创建选中对象的位置点图层（简化版）
 */
export function createSelectedObjectTrackLayers({
  selectedTrack,
}: CreateSelectedObjectTrackLayersOptions) {
  if (!selectedTrack || selectedTrack.points.length === 0) {
    return [];
  }

  const layers = [];
  const currentFrameIndex = selectedTrack.currentFrameIndex;

  // 1. GT轨迹线（连接所有GT点）
  const gtTrajectory: Point3D[] = selectedTrack.points
    .filter(p => p.type === 'gt')
    .map(p => p.position);

  if (gtTrajectory.length > 1) {
    layers.push(
      new PathLayer({
        id: 'selected-object-gt-trajectory',
        data: [gtTrajectory],
        getPath: (d) => d,
        getColor: [0, 255, 0, 200],
        getWidth: 2,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
        billboard: false,
        pickable: false,
      })
    );
  }

  // 2. 位置点图层（GT和预测）
  const pointsData = selectedTrack.points.map(point => ({
    ...point,
    isCurrent: point.frameIndex === currentFrameIndex,
  }));

  layers.push(
    new ScatterplotLayer({
      id: 'selected-object-points',
      data: pointsData,
      getPosition: (d) => d.position,
      getRadius: (d) => {
        // 当前帧的点更大
        if (d.isCurrent) {
          return d.type === 'gt' ? 0.5 : 0.6; // 预测点稍大
        }
        return d.type === 'gt' ? 0.3 : 0.35;
      },
      radiusUnits: 'meters',
      getFillColor: (d) => {
        if (d.type === 'gt') {
          // GT点：绿色
          return d.isCurrent ? [0, 255, 0, 255] : [0, 255, 0, 200];
        } else {
          // 预测点：根据误差着色
          const color = getPointColorByError(d.error);
          return d.isCurrent ? color : [color[0], color[1], color[2], 200];
        }
      },
      getLineColor: [255, 255, 255, 255], // 白色边框
      lineWidthMinPixels: 1,
      pickable: true,
      onClick: (info) => {
        if (info.object) {
          console.log(
            `Frame: ${info.object.frameIndex}`,
            `Type: ${info.object.type}`,
            `Error: ${info.object.error.toFixed(2)}m`,
            `Score: ${info.object.score.toFixed(2)}`
          );
        }
      },
    })
  );

  // 3. 当前帧的文本标签（简化：只显示关键信息）
  const currentPoints = pointsData.filter(p => p.isCurrent);
  
  if (currentPoints.length > 0) {
    const labelData = currentPoints.map(point => {
      let text = '';
      if (point.type === 'gt') {
        text = `GT [${point.frameIndex}]`;
      } else {
        text = `Pred [${point.frameIndex}]\n${point.error.toFixed(2)}m`;
      }
      
      return {
        position: [point.position[0], point.position[1], point.position[2] + 1.5] as Point3D,
        text,
        color: point.type === 'gt' 
          ? [0, 255, 0, 255]
          : getPointColorByError(point.error),
      };
    });

    layers.push(
      new TextLayer({
        id: 'selected-object-current-labels',
        data: labelData,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: (d) => d.color,
        getSize: 14,
        getAngle: 0,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        pickable: false,
      })
    );
  }

  return layers;
}

