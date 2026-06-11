// 相机图片数据处理 Hook
// 将相机数据转换为3D空间中的图片平面

import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import type { Pose, Extrinsic, Vector3 } from '@/types';
import type { STCCameraImage, Point3D } from '../types';
import { CAMERA_IMAGE_CONFIG } from '../config';
import { getCameraForwardVector, calculateFOV } from '../utils/cameraFrustum';
import {
  quaternionToRotationMatrix,
  matrixVectorMultiply,
  matrixMultiply,
  rotationMatrixToEuler,
} from '@/utils/math';

/**
 * 计算相机在全局坐标系的位置
 * camera_global = ego_translation + ego_rotation * camera_translation
 */
function getCameraGlobalPosition(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): Vector3 {
  const egoRotMatrix = quaternionToRotationMatrix(egoPose.rotation);
  const rotatedCameraPos = matrixVectorMultiply(egoRotMatrix, cameraExtrinsic.translation);
  
  return [
    egoPose.translation[0] + rotatedCameraPos[0],
    egoPose.translation[1] + rotatedCameraPos[1],
    egoPose.translation[2] + rotatedCameraPos[2],
  ];
}

/**
 * 计算相机在全局坐标系的朝向
 * camera_orientation = ego_rotation * camera_rotation
 */
function getCameraGlobalOrientation(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): [number, number, number] {
  const egoRotMatrix = quaternionToRotationMatrix(egoPose.rotation);
  const cameraRotMatrix = quaternionToRotationMatrix(cameraExtrinsic.rotation);
  const globalRotMatrix = matrixMultiply(egoRotMatrix, cameraRotMatrix);
  
  return rotationMatrixToEuler(globalRotMatrix);
}

/**
 * 根据距离和FOV计算平面尺寸，使图片填充视锥体范围
 * @param distance 图片距离相机的距离（米）
 * @param fovHorizontal 水平视场角（弧度）
 * @param fovVertical 垂直视场角（弧度）
 * @param fillRatio 填充比例（0-1），控制图片占视锥体的百分比，默认0.8
 */
function calculatePlaneSizeByFOV(
  distance: number,
  fovHorizontal: number,
  fovVertical: number,
  fillRatio = 0.8
): { width: number; height: number } {
  // 根据距离和FOV计算平面尺寸
  // width = 2 * distance * tan(fovH/2) * fillRatio
  const width = 2 * distance * Math.tan(fovHorizontal / 2) * fillRatio;
  const height = 2 * distance * Math.tan(fovVertical / 2) * fillRatio;
  
  return {
    width,
    height,
  };
}

/**
 * 使用相机图片数据的Hook
 * 从Redux获取当前帧的相机数据，并转换为3D空间中的图片平面
 */
export function useCameraImages(): STCCameraImage[] {
  const cameraStream = useAppSelector((state) => state.currentScene.cameraStream);
  const gtStream = useAppSelector((state) => state.currentScene.gtStream);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);
  const imageCache = useAppSelector((state) => state.camera.imageCache);

  return useMemo(() => {
    if (!cameraStream?.frames || !gtStream?.frames) return [];
    
    const currentFrame = cameraStream.frames[currentFrameIndex];
    const gtFrame = gtStream.frames[currentFrameIndex];
    
    if (!currentFrame || !gtFrame) return [];
    
    const egoPose = gtFrame.ego_pose;
    const cameraImages: STCCameraImage[] = [];
    
    currentFrame.cameras.forEach((camera) => {
      // 计算相机在全局坐标系的位置
      const cameraPosition = getCameraGlobalPosition(egoPose, camera.extrinsic);
      
      // 计算相机在全局坐标系的朝向
      const cameraOrientation = getCameraGlobalOrientation(egoPose, camera.extrinsic);
      const [pitch, yaw, roll] = cameraOrientation;
      
      // 计算相机前向向量（视线方向）
      const forwardVector = getCameraForwardVector(egoPose, camera.extrinsic);
      
      // 图片平面位置：沿着视锥体中心轴（相机视线方向）外推一定距离
      const displayDistance = 
        CAMERA_IMAGE_CONFIG.DISTANCE_FROM_EGO[camera.channel] || 
         CAMERA_IMAGE_CONFIG.DISTANCE_FROM_EGO.DEFAULT;
      
      // 计算视场角
      const fov = calculateFOV(camera.intrinsic, camera.width, camera.height);
      
      // 根据距离和FOV计算平面尺寸，使图片填充视锥体
      const planeSize = calculatePlaneSizeByFOV(
        displayDistance,
        fov.horizontal,
        fov.vertical,
        CAMERA_IMAGE_CONFIG.FRUSTUM_FILL_RATIO
      );
      const position: Point3D = [
        cameraPosition[0] + forwardVector[0] * displayDistance,
        cameraPosition[1] + forwardVector[1] * displayDistance,
        cameraPosition[2] + forwardVector[2] * displayDistance,
      ];
      
      // 获取图片URL（如果已缓存）
      const imageUrl = imageCache[camera.image_path];
      
      cameraImages.push({
        channel: camera.channel,
        frameIndex: currentFrameIndex,
        position,
        orientation: [pitch, yaw, roll],
        imagePath: camera.image_path,
        imageUrl,
        width: camera.width,
        height: camera.height,
        planeWidth: planeSize.width,
        planeHeight: planeSize.height,
      });
    });
    
    return cameraImages;
  }, [cameraStream, gtStream, currentFrameIndex, imageCache]);
}

