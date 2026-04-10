import type { Quaternion, Vector3 } from '@/types/nuscenes';
import type { Point3D } from '../types';

/**
 * 从四元数计算欧拉角
 * nuScenes 坐标系：全局坐标系为 ENU（东-北-上），车辆坐标系为前-左-上
 * @param quaternion 四元数 [w, x, y, z]
 * @returns 欧拉角 { roll, pitch, yaw } 单位：弧度
 */
export function quaternionToEuler(quaternion: Quaternion): {
  roll: number;
  pitch: number;
  yaw: number;
} {
  const [w, x, y, z] = quaternion;
  
  // Roll (x-axis rotation)
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  
  // Pitch (y-axis rotation)
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1
    ? Math.sign(sinp) * Math.PI / 2 // use 90 degrees if out of range
    : Math.asin(sinp);
  
  // Yaw (z-axis rotation) - 绕Z轴的旋转角度
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);
  
  return { roll, pitch, yaw };
}

/**
 * 从四元数计算yaw角（简化版本）
 * @param quaternion 四元数 [w, x, y, z]
 * @returns yaw角度（弧度）
 */
export function quaternionToYaw(quaternion: Quaternion): number {
  const [w, x, y, z] = quaternion;
  // 计算yaw角（绕Z轴旋转）
  return Math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z));
}

/**
 * 计算第一视角相机参数
 * @param egoPosition 自车位置 [x, y, z]
 * @param egoRotation 自车旋转（四元数）[w, x, y, z]
 * @param heightOffset 相机高度偏移（米），模拟驾驶员视角高度
 * @param forwardOffset 相机前后偏移（米），正值向前，负值向后
 * @returns 第一视角相机参数
 */
export function calculateFPSCamera(
  egoPosition: Vector3,
  egoRotation: Quaternion,
  heightOffset = 1.5,
  forwardOffset = 0
): {
  target: Point3D;
  rotationX: number;
  rotationOrbit: number;
} {
  const [x, y, z] = egoPosition;
  
  // 从四元数计算欧拉角
  const { yaw, pitch } = quaternionToEuler(egoRotation);
  
  // 计算相机位置（考虑高度偏移和前后偏移）
  // nuScenes 全局坐标系：X-东，Y-北，Z-上
  const cameraX = x + forwardOffset * Math.cos(yaw);
  const cameraY = y + forwardOffset * Math.sin(yaw);
  const cameraZ = z + heightOffset;
  
  // 将yaw转换为度数，用于deck.gl的rotationOrbit
  // deck.gl OrbitView: rotationOrbit是围绕Z轴的旋转
  // 0度指向正X方向（东），逆时针为正
  // nuScenes的yaw: 0度也指向正X方向（东），逆时针为正
  // 需要转换为相机朝向：相机看向前方（yaw方向）
  const rotationOrbitDeg = (yaw * 180 / Math.PI) + 90;
  
  // 俯仰角转换为度数
  // deck.gl rotationX: 0度水平，正值向下俯视，90度正下方
  // 第一人称视角通常是水平的，但可以根据车辆pitch微调
  const rotationXDeg = -pitch * 180 / Math.PI;
  
  return {
    target: [cameraX, cameraY, cameraZ],
    rotationX: rotationXDeg,
    rotationOrbit: rotationOrbitDeg,
  };
}

