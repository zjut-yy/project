// 相机视锥体计算工具函数
// 根据相机内参和外参计算视锥体的几何形状

import type { Intrinsic, Extrinsic, Pose, Vector3 } from '@/types';
import type { Point3D } from '../types';
import { quaternionToRotationMatrix, matrixVectorMultiply, matrixMultiply } from '@/utils/math';

/**
 * 相机视锥体数据
 */
export interface CameraFrustum {
  /** 相机位置 */
  position: Point3D;
  /** 视锥体边线（从相机原点到远平面四角） */
  lines: Point3D[][];
  /** 视场角 */
  fov: {
    horizontal: number; // 弧度
    vertical: number;   // 弧度
  };
}

/**
 * 从相机内参矩阵计算视场角
 * @param intrinsic 相机内参矩阵
 * @param width 图像宽度
 * @param height 图像高度
 */
export function calculateFOV(
  intrinsic: Intrinsic,
  width: number,
  height: number
): { horizontal: number; vertical: number } {
  // 提取焦距
  const fx = intrinsic[0][0];
  const fy = intrinsic[1][1];
  
  // 计算视场角（弧度）
  const fovX = 2 * Math.atan(width / (2 * fx));
  const fovY = 2 * Math.atan(height / (2 * fy));
  
  return {
    horizontal: fovX,
    vertical: fovY,
  };
}

/**
 * 计算相机在全局坐标系的位置
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
 * 计算相机在全局坐标系的旋转矩阵
 */
function getCameraGlobalRotationMatrix(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): number[][] {
  const egoRotMatrix = quaternionToRotationMatrix(egoPose.rotation);
  const cameraRotMatrix = quaternionToRotationMatrix(cameraExtrinsic.rotation);
  return matrixMultiply(egoRotMatrix, cameraRotMatrix);
}

/**
 * 创建相机视锥体
 * @param egoPose ego车辆位姿
 * @param cameraExtrinsic 相机外参
 * @param intrinsic 相机内参
 * @param width 图像宽度
 * @param height 图像高度
 * @param frustumLength 视锥体长度（米）
 */
export function createCameraFrustum(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic,
  intrinsic: Intrinsic,
  width: number,
  height: number,
  frustumLength = 5.0
): CameraFrustum {
  // 计算相机在全局坐标系的位置
  const cameraPosition = getCameraGlobalPosition(egoPose, cameraExtrinsic);
  
  // 计算视场角
  const fov = calculateFOV(intrinsic, width, height);
  
  // 计算相机在全局坐标系的旋转矩阵
  const rotMatrix = getCameraGlobalRotationMatrix(egoPose, cameraExtrinsic);
  
  // 在相机坐标系中定义远平面的四个角点
  // nuScenes 相机坐标系: X右 Y下 Z前（朝向视线方向）
  const halfFovX = fov.horizontal / 2;
  const halfFovY = fov.vertical / 2;
  
  const farPlaneHalfWidth = frustumLength * Math.tan(halfFovX);
  const farPlaneHalfHeight = frustumLength * Math.tan(halfFovY);
  
  // 远平面四个角点（相机坐标系）
  const farCorners: Vector3[] = [
    [farPlaneHalfWidth, farPlaneHalfHeight, frustumLength],    // 右下
    [-farPlaneHalfWidth, farPlaneHalfHeight, frustumLength],   // 左下
    [-farPlaneHalfWidth, -farPlaneHalfHeight, frustumLength],  // 左上
    [farPlaneHalfWidth, -farPlaneHalfHeight, frustumLength],   // 右上
  ];
  
  // 转换到全局坐标系
  const globalFarCorners: Point3D[] = farCorners.map(corner => {
    const rotated = matrixVectorMultiply(rotMatrix, corner);
    return [
      cameraPosition[0] + rotated[0],
      cameraPosition[1] + rotated[1],
      cameraPosition[2] + rotated[2],
    ];
  });
  
  // 创建视锥体边线（从相机位置到远平面四角）
  const lines: Point3D[][] = globalFarCorners.map(corner => [
    cameraPosition as Point3D,
    corner,
  ]);
  
  // 添加远平面的四条边
  for (let i = 0; i < 4; i++) {
    const nextI = (i + 1) % 4;
    lines.push([globalFarCorners[i], globalFarCorners[nextI]]);
  }
  
  return {
    position: cameraPosition as Point3D,
    lines,
    fov,
  };
}

/**
 * 计算相机朝向的前向向量（全局坐标系）
 * @returns 归一化的前向向量
 */
export function getCameraForwardVector(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): Vector3 {
  const rotMatrix = getCameraGlobalRotationMatrix(egoPose, cameraExtrinsic);
  
  // 相机坐标系的Z轴（前向）在全局坐标系中的方向
  // 旋转矩阵的第三列表示Z轴方向
  return [rotMatrix[0][2], rotMatrix[1][2], rotMatrix[2][2]];
}

/**
 * 计算相机朝向的上向向量（全局坐标系）
 * @returns 归一化的上向向量
 */
export function getCameraUpVector(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): Vector3 {
  const rotMatrix = getCameraGlobalRotationMatrix(egoPose, cameraExtrinsic);
  
  // 相机坐标系的Y轴（下向）取负号得到上向
  // 旋转矩阵的第二列表示Y轴方向
  return [-rotMatrix[0][1], -rotMatrix[1][1], -rotMatrix[2][1]];
}

