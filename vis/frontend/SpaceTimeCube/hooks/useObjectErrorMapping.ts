// 对象误差映射处理 Hook

import { useMemo } from 'react';
import type { AssociationsData } from '@/types';

export interface ObjectErrorInfo {
  isDetected: boolean;
  error?: number;
}

/**
 * 从关联数据中提取GT对象的误差映射
 * @param associations - 关联数据
 * @param currentFrameIndex - 当前帧索引
 * @returns Map<instance_id, ObjectErrorInfo>
 */
export function useObjectErrorMapping(
  associations: AssociationsData | null,
  currentFrameIndex: number
): Map<string, ObjectErrorInfo> {
  return useMemo(() => {
    const errorMap = new Map<string, ObjectErrorInfo>();
    
    if (!associations?.object_associations) {
      return errorMap;
    }
    
    // 过滤当前帧的关联数据
    const frameAssociations = associations.object_associations.filter(
      (assoc) => assoc.frame_index === currentFrameIndex
    );
    
    // 构建 pred_instance_id 到关联数据的映射（用于查找 GT）
    const predToAssocMap = new Map(
      frameAssociations.map((assoc) => [assoc.pred_instance_id, assoc])
    );
    
    // 遍历当前帧的所有关联，提取误差信息
    frameAssociations.forEach((assoc) => {
      // 只处理有 GT 的预测（即 TP）
      if (assoc.gt_instance_id && assoc.is_tp) {
        const gtToken = String(assoc.gt_instance_id);
        const translationError = assoc.errors?.translation_error;
        
        errorMap.set(gtToken, {
          isDetected: true,
          error: translationError,
        });
      }
    });
    
    return errorMap;
  }, [associations, currentFrameIndex]);
}

