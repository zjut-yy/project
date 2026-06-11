// 相机视锥体数据处理 Hook
// 为每个相机生成视锥体可视化数据

import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import type { STCCameraFrustum } from '../types';
import { createCameraFrustum } from '../utils/cameraFrustum';
import { CAMERA_IMAGE_CONFIG } from '../config';

/**
 * 使用相机视锥体数据的Hook
 * 从Redux获取当前帧的相机数据，并生成视锥体几何数据
 */
export function useCameraFrustums(): STCCameraFrustum[] {
  const cameraStream = useAppSelector((state) => state.currentScene.cameraStream);
  const gtStream = useAppSelector((state) => state.currentScene.gtStream);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);

  return useMemo(() => {
    if (!cameraStream?.frames || !gtStream?.frames) return [];
    
    const currentFrame = cameraStream.frames[currentFrameIndex];
    const gtFrame = gtStream.frames[currentFrameIndex];
    
    if (!currentFrame || !gtFrame) return [];
    
    const egoPose = gtFrame.ego_pose;
    const cameraFrustums: STCCameraFrustum[] = [];
    
    currentFrame.cameras.forEach((camera) => {
      // 根据相机通道获取视锥体长度（与图片距离保持一致）
      const frustumLength = CAMERA_IMAGE_CONFIG.DISTANCE_FROM_EGO[camera.channel] || 
                            CAMERA_IMAGE_CONFIG.DISTANCE_FROM_EGO.DEFAULT;
      
      // 创建视锥体
      const frustum = createCameraFrustum(
        egoPose,
        camera.extrinsic,
        camera.intrinsic,
        camera.width,
        camera.height,
        frustumLength
      );
      
      cameraFrustums.push({
        channel: camera.channel,
        frameIndex: currentFrameIndex,
        position: frustum.position,
        lines: frustum.lines,
        fov: frustum.fov,
      });
    });
    
    return cameraFrustums;
  }, [cameraStream, gtStream, currentFrameIndex]);
}

