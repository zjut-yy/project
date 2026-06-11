// 预测对象数据处理 Hook

import { useMemo } from 'react';
import type { PredictionStream } from '@/types';
import type { STCPredictionObject, Point3D } from '../types';
import { swapHeadingForSwappedXY, swapPointXY } from '../utils/axisSwap';

/**
 * 获取当前帧的预测对象数据
 * 
 * 注意：预测模型输出的box格式与GT数据一致
 * box的z坐标表示底面中心的高度，需要转换为立方体中心坐标
 */
export function useSTCCurrentFramePredictions(
  predictionStream: PredictionStream | null,
  currentFrameIndex: number,
): STCPredictionObject[] {
  return useMemo(() => {
    if (!predictionStream?.frames || currentFrameIndex < 0 || currentFrameIndex >= predictionStream.frames.length) {
      return [];
    }
    
    const frame = predictionStream.frames[currentFrameIndex];
    const { detection } = frame;
    const objects: STCPredictionObject[] = [];
    
    detection.boxes.forEach((box, objIndex) => {
      const height = box[5]; // height
      // 预测box格式：[x, y, z_bottom_center, width, length, height, yaw]
      // 3D渲染需要立方体中心坐标：centerZ = bottomZ + height/2
      const centerZ = box[2] + height / 2;
      
      objects.push({
        token: `pred_frame_${currentFrameIndex}_obj_${objIndex}`,
        track_id: detection.track_ids[objIndex],
        category: detection.classes[objIndex],
        position: swapPointXY([
          box[0], // x
          box[1], // y
          centerZ // z (立方体中心)
        ] as Point3D),
        heading: swapHeadingForSwappedXY(box[6]), // yaw after XY swap
        size: [box[3], box[4], box[5]], // [width, length, height]
        frameIndex: currentFrameIndex,
        score: detection.scores[objIndex],
      });
    });
    
    return objects;
  }, [predictionStream, currentFrameIndex]);
}
