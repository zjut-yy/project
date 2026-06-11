// Hook: 获取选中对象在所有帧的位置点数据（简化版）

import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import type { SelectedObjectTrackData, FramePointData } from '../layers/SelectedObjectTrackLayer3D';
import { swapPointXY } from '../utils/axisSwap';

/**
 * 从store中获取选中对象在所有帧的位置点数据
 * 简化版：用点代替立方体，提高性能
 */
export function useSelectedObjectTrack(): SelectedObjectTrackData | null {
  const selectedInstanceId = useAppSelector((state) => state.objectInstance.selectedInstanceId);
  const instanceCategory = useAppSelector((state) => state.objectInstance.instanceCategory);
  const gtFrameStates = useAppSelector((state) => state.objectInstance.gtFrameStates);
  const predictionFrameStates = useAppSelector((state) => state.objectInstance.predictionFrameStates);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);

  return useMemo(() => {
    if (selectedInstanceId === null || !instanceCategory) {
      return null;
    }

    const points: FramePointData[] = [];

    // 遍历所有GT帧，提取GT位置点
    gtFrameStates.forEach((gtState) => {
      if (!gtState.exists || !gtState.box) return;

      const [x, y, z] = gtState.box;
      const predState = predictionFrameStates.find(p => p.frameIndex === gtState.frameIndex);

      // GT点
      points.push({
        frameIndex: gtState.frameIndex,
        position: swapPointXY([x, y, z]),
        type: 'gt',
        score: 1.0,
        error: 0,
      });

      // 预测点
      if (predState?.hasPrediction && predState.boxes && predState.boxes.length > 0) {
        predState.boxes.forEach((box, idx) => {
          const [px, py, pz] = box;
          const error = predState.errors?.[idx]?.translationError || 0;
          const score = predState.scores?.[idx] || 0;

          points.push({
            frameIndex: gtState.frameIndex,
            position: swapPointXY([px, py, pz]),
            type: 'prediction',
            score,
            error,
          });
        });
      }
    });

    // 添加只有预测没有GT的帧
    predictionFrameStates.forEach((predState) => {
      if (!predState.hasPrediction || !predState.boxes) return;

      // 检查该帧是否已经有GT数据
      const hasGT = gtFrameStates.some(g => g.frameIndex === predState.frameIndex && g.exists);
      if (hasGT) return;

      predState.boxes.forEach((box, idx) => {
        const [px, py, pz] = box;
        const error = predState.errors?.[idx]?.translationError || 0;
        const score = predState.scores?.[idx] || 0;

        points.push({
          frameIndex: predState.frameIndex,
          position: swapPointXY([px, py, pz]),
          type: 'prediction',
          score,
          error,
        });
      });
    });

    // 按帧索引和类型排序
    points.sort((a, b) => {
      if (a.frameIndex !== b.frameIndex) {
        return a.frameIndex - b.frameIndex;
      }
      // GT优先
      return a.type === 'gt' ? -1 : 1;
    });

    return {
      instanceId: selectedInstanceId,
      category: instanceCategory,
      currentFrameIndex,
      points,
    };
  }, [selectedInstanceId, instanceCategory, gtFrameStates, predictionFrameStates, currentFrameIndex]);
}
