// 时空立方体数据处理 Hooks

import { useMemo } from 'react';
import type {  GTStream, StaticMap } from '@/types';
import type {
  STCTrajectoryPoint,
  STCObject,
  STCObjectTrack,
  STCMapElement,
  TimeRange,
  Point3D,
} from '../types';
import { swapHeadingForSwappedXY, swapPointXY } from '../utils/axisSwap';

// 内部类型定义
interface TrajectoryPoint {
  index: number;
  timestamp: number;
  position: Point3D;
  heading: number;
}

/**
 * 将2D轨迹点转换为3D轨迹点
 */
export function useSTCTrajectoryPoints(
  trajectoryPoints: TrajectoryPoint[]
): STCTrajectoryPoint[] {
  return useMemo(() => {
    const TRAJECTORY_Z_HEIGHT = 0; // 固定高度0.5米
    return trajectoryPoints.map(point => ({
      index: point.index,
      timestamp: point.timestamp,
      position: swapPointXY([
        point.position[0],
        point.position[1],
        TRAJECTORY_Z_HEIGHT
      ] as Point3D),
      heading: swapHeadingForSwappedXY(point.heading),
    }));
  }, [trajectoryPoints]);
}

/**
 * 处理所有帧的对象数据，转换为3D对象
 */
export function useSTCObjects(
  gtStream: GTStream | null,
): STCObject[] {
  return useMemo(() => {
    if (!gtStream?.frames) return [];
    
    const objects: STCObject[] = [];
    
    gtStream.frames.forEach((frame, frameIndex) => {
      const { objects: frameObjects } = frame;
      frameObjects.boxes.forEach((box, objIndex) => {
        objects.push({
          token: `frame_${frameIndex}_obj_${objIndex}`,
          instance_id: String(frameObjects.instance_ids[objIndex]),
          category: frameObjects.categories[objIndex],
          position: swapPointXY([
            box[0], // x
            box[1], // y
            box[2]
          ] as Point3D),
          heading: swapHeadingForSwappedXY(box[6]), // yaw after XY swap
          size: [box[3], box[4], box[5]], // [width, length, height]
          frameIndex,
        });
      });
    });
    
    return objects;
  }, [gtStream]);
}

/**
 * 获取当前帧的对象数据
 */
export function useSTCCurrentFrameObjects(
  gtStream: GTStream | null,
  currentFrameIndex: number,
): STCObject[] {
  return useMemo(() => {
    if (!gtStream?.frames || currentFrameIndex < 0 || currentFrameIndex >= gtStream.frames.length) {
      return [];
    }
    
    const frame = gtStream.frames[currentFrameIndex];
    const { objects: frameObjects } = frame;
    const objects: STCObject[] = [];
    
    frameObjects.boxes.forEach((box, objIndex) => {
      objects.push({
        token: `frame_${currentFrameIndex}_obj_${objIndex}`,
        instance_id: String(frameObjects.instance_ids[objIndex]),
        category: frameObjects.categories[objIndex],
        position: swapPointXY([
          box[0], // x
          box[1], // y
          box[2]
        ] as Point3D),
        heading: swapHeadingForSwappedXY(box[6]), // yaw after XY swap
        size: [box[3], box[4], box[5]], // [width, length, height]
        frameIndex: currentFrameIndex,
      });
    });
    
    return objects;
  }, [gtStream, currentFrameIndex]);
}

/**
 * 计算对象的时空轨迹
 * 连接同一对象在不同帧的3D位置
 */
export function useSTCObjectTracks(
  gtStream: GTStream | null,
): STCObjectTrack[] {
  return useMemo(() => {
    if (!gtStream?.frames) return [];
    
    // 按 instance_id 分组
    const tracksByInstance = new Map<string, {
      category: string;
      positions: Array<{ frameIndex: number; position: Point3D }>;
    }>();

    // 收集所有对象位置
    gtStream.frames.forEach((frame, frameIndex) => {
      const { objects: frameObjects } = frame;
      frameObjects.boxes.forEach((box, objIndex) => {
        const instanceId = String(frameObjects.instance_ids[objIndex]);
        const category = frameObjects.categories[objIndex];
        const position: Point3D = swapPointXY([box[0], box[1], box[2]] as Point3D);
        
        if (!tracksByInstance.has(instanceId)) {
          tracksByInstance.set(instanceId, {
            category,
            positions: [],
          });
        }
        tracksByInstance.get(instanceId)!.positions.push({
          frameIndex,
          position
        });
      });
    });

    // 转换为3D轨迹数组
    const tracks: STCObjectTrack[] = [];
    tracksByInstance.forEach((data, instance_id) => {
      // 只保留至少有2个位置点的轨迹
      if (data.positions.length >= 2) {
        // 按帧索引排序
        data.positions.sort((a, b) => a.frameIndex - b.frameIndex);
        
        tracks.push({
          instance_id,
          category: data.category,
          positions: data.positions.map(p => [
            p.position[0],
            p.position[1],
            p.position[2]
          ] as Point3D),
        });
      }
    });

    return tracks;
  }, [gtStream]);
}

/**
 * 处理地图数据，转换为3D地图元素
 * 地图元素绘制在Z=0平面
 */
export function useSTCMapData(
  staticMap: StaticMap | null
): STCMapElement[] {
  return useMemo(() => {
    if (!staticMap) return [];

    const elements: STCMapElement[] = [];
    const z = 0; // 地图绘制在底部平面

    // 可驾驶区域（多边形）
    if (staticMap.drivable_area) {
      staticMap.drivable_area.forEach(polygon => {
        elements.push({
          type: 'drivable_area',
          points: polygon.map(([x, y]) => swapPointXY([x, y, z] as Point3D)),
        });
      });
    }

    // 车道分隔线
    if (staticMap.divider) {
      staticMap.divider.forEach(lineString => {
        elements.push({
          type: 'divider',
          points: lineString.map(([x, y]) => swapPointXY([x, y, z] as Point3D)),
        });
      });
    }

    // 人行横道
    if (staticMap.ped_crossing) {
      staticMap.ped_crossing.forEach(polygon => {
        elements.push({
          type: 'ped_crossing',
          points: polygon.map(([x, y]) => swapPointXY([x, y, z] as Point3D)),
        });
      });
    }

    // 道路边界
    if (staticMap.boundary) {
      staticMap.boundary.forEach(lineString => {
        elements.push({
          type: 'boundary',
          points: lineString.map(([x, y]) => swapPointXY([x, y, z] as Point3D)),
        });
      });
    }

    return elements;
  }, [staticMap]);
}

/**
 * 计算时间范围和Z轴边界
 */
export function useTimeRange(
  trajectoryPoints: STCTrajectoryPoint[]
): TimeRange | null {
  return useMemo(() => {
    if (trajectoryPoints.length === 0) return null;

    const frameIndices = trajectoryPoints.map(p => p.index);
    const minFrame = Math.min(...frameIndices);
    const maxFrame = Math.max(...frameIndices);

    const zValues = trajectoryPoints.map(p => p.position[2]);
    const zMin = Math.min(...zValues);
    const zMax = Math.max(...zValues);

    return {
      minFrame,
      maxFrame,
      zMin,
      zMax,
    };
  }, [trajectoryPoints]);
}

/**
 * 计算场景边界（用于视图定位）
 * 仅基于轨迹点计算
 */
export function useSceneBounds(
  trajectoryPoints: STCTrajectoryPoint[]
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} | null {
  return useMemo(() => {
    if (trajectoryPoints.length === 0) return null;

    const xs = trajectoryPoints.map(p => p.position[0]);
    const ys = trajectoryPoints.map(p => p.position[1]);
    const zs = trajectoryPoints.map(p => p.position[2]);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
  }, [trajectoryPoints]);
}
