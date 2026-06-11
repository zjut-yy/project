// 前视相机墙数据处理 Hook
// 处理所有帧的前视相机数据，计算对象投影和连接几何体

import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import type { GTStream, CameraStream, Pose, Extrinsic, Intrinsic, BoundingBox } from '@/types';
import type {
  FrontCameraWallNode,
  ProjectedObjectOnCamera,
  ObjectConnectionGeometry,
  Point3D,
  Point2D,
  STCCameraImage,
} from '../types';
import { FRONT_CAMERA_WALL_CONFIG, CAMERA_IMAGE_CONFIG } from '../config';
import {
  projectToCamera,
  isPointInImage,
  imageToPlane3D,
  distance3D,
} from '@/utils/coordinateTransform';
import {
  quaternionToRotationMatrix,
  matrixVectorMultiply,
  matrixMultiply,
  rotationMatrixToEuler,
} from '@/utils/math';
import { calculateFOV } from '../utils/cameraFrustum';

/**
 * 计算3D边界框的8个角点
 */
function getBoundingBoxCorners(box: BoundingBox): Point3D[] {
  const [cx, cy, cz, width, length, height, yaw] = box;
  
  // 计算旋转矩阵
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  
  // 半尺寸
  const halfW = width / 2;
  const halfL = length / 2;
  const halfH = height / 2;
  
  // 局部坐标系的8个角点（未旋转）
  const localCorners: Point3D[] = [
    [-halfW, -halfL, -halfH], // 0: 左后下
    [halfW, -halfL, -halfH],  // 1: 右后下
    [halfW, halfL, -halfH],   // 2: 右前下
    [-halfW, halfL, -halfH],  // 3: 左前下
    [-halfW, -halfL, halfH],  // 4: 左后上
    [halfW, -halfL, halfH],   // 5: 右后上
    [halfW, halfL, halfH],    // 6: 右前上
    [-halfW, halfL, halfH],   // 7: 左前上
  ];
  
  // 应用旋转和平移
  return localCorners.map(([lx, ly, lz]) => {
    const rx = cosYaw * lx - sinYaw * ly;
    const ry = sinYaw * lx + cosYaw * ly;
    return [cx + rx, cy + ry, cz + lz] as Point3D;
  });
}

/**
 * 计算相机在全局坐标系的位置
 */
function getCameraGlobalPosition(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): Point3D {
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
 * 计算相机前向向量
 */
function getCameraForwardVector(
  egoPose: Pose,
  cameraExtrinsic: Extrinsic
): Point3D {
  const egoRotMatrix = quaternionToRotationMatrix(egoPose.rotation);
  const cameraRotMatrix = quaternionToRotationMatrix(cameraExtrinsic.rotation);
  const globalRotMatrix = matrixMultiply(egoRotMatrix, cameraRotMatrix);
  
  // 相机坐标系的前向是Z轴正方向
  const forward = matrixVectorMultiply(globalRotMatrix, [0, 0, 1]);
  return forward as Point3D;
}

/**
 * 根据距离和FOV计算平面尺寸
 */
function calculatePlaneSizeByFOV(
  distance: number,
  fovHorizontal: number,
  fovVertical: number,
  fillRatio = 1.0
): { width: number; height: number } {
  const width = 2 * distance * Math.tan(fovHorizontal / 2) * fillRatio;
  const height = 2 * distance * Math.tan(fovVertical / 2) * fillRatio;
  
  return { width, height };
}

/**
 * 投影对象到相机平面
 */
function projectObjectToCamera(
  box: BoundingBox,
  instanceId: string | number,
  category: string,
  frameIndex: number,
  egoPose: Pose,
  cameraExtrinsic: Extrinsic,
  cameraIntrinsic: Intrinsic,
  imageWidth: number,
  imageHeight: number,
  planeDistance: number
): ProjectedObjectOnCamera | null {
  // 获取边界框的8个角点
  const corners3D = getBoundingBoxCorners(box);
  
  // 投影到2D图像
  const corners2D: (Point2D | null)[] = corners3D.map(corner =>
    projectToCamera(corner, egoPose, cameraExtrinsic, cameraIntrinsic)
  );
  
  // 检查哪些角点在视野内
  const cornersInView = corners2D.map(corner =>
    corner !== null && isPointInImage(corner, imageWidth, imageHeight)
  );
  
  // 计算在视野内的角点比例
  const inViewCount = cornersInView.filter(Boolean).length;
  const inViewRatio = inViewCount / 8;
  
  // 如果没有足够的角点在视野内，跳过
  if (inViewRatio < FRONT_CAMERA_WALL_CONFIG.MIN_PROJECTION_RATIO) {
    return null;
  }
  
  // 计算中心点投影
  const center3D: Point3D = [box[0], box[1], box[2]];
  const center2D = projectToCamera(center3D, egoPose, cameraExtrinsic, cameraIntrinsic);
  
  // 计算相机位置
  const cameraPos = getCameraGlobalPosition(egoPose, cameraExtrinsic);
  
  // 检查对象距离
  const objectDistance = distance3D(cameraPos, center3D);
  if (objectDistance > FRONT_CAMERA_WALL_CONFIG.MAX_OBJECT_DISTANCE) {
    return null;
  }
  
  // 计算相机墙的统一Z坐标
  const wallZPosition = FRONT_CAMERA_WALL_CONFIG.BASE_Z_OFFSET;
  
  // 将底面4个角点（索引0-3）反投影到3D相机平面
  const bottomCorners3D: Point3D[] = [];
  for (let i = 0; i < 4; i++) {
    const corner2D = corners2D[i];
    if (corner2D) {
      const corner3D = imageToPlane3D(
        corner2D,
        cameraIntrinsic,
        planeDistance,
        egoPose,
        cameraExtrinsic
      );
      // 强制使用相机墙的统一Z坐标
      bottomCorners3D.push([corner3D[0], corner3D[1], wallZPosition]);
    } else {
      // 如果角点不在视野内，使用边界框底面角点的XY坐标，但Z坐标使用墙高度
      bottomCorners3D.push([corners3D[i][0], corners3D[i][1], wallZPosition]);
    }
  }
  
  return {
    instance_id: String(instanceId),
    category,
    frameIndex,
    box3D: box,
    corners2D,
    cornersInView,
    center2D,
    bottomCorners3D,
  };
}

/**
 * 构建对象连接几何体
 */
function buildObjectConnections(
  nodes: FrontCameraWallNode[]
): ObjectConnectionGeometry[] {
  // 按instance_id分组对象
  const objectsByInstance = new Map<string, ProjectedObjectOnCamera[]>();
  
  nodes.forEach(node => {
    node.projectedObjects.forEach(obj => {
      if (!objectsByInstance.has(obj.instance_id)) {
        objectsByInstance.set(obj.instance_id, []);
      }
      objectsByInstance.get(obj.instance_id)!.push(obj);
    });
  });
  
  // 构建连接
  const connections: ObjectConnectionGeometry[] = [];
  
  objectsByInstance.forEach((objects, instanceId) => {
    // 按帧索引排序
    objects.sort((a, b) => a.frameIndex - b.frameIndex);
    
    // 构建连续帧之间的连接
    const connectionSegments: ObjectConnectionGeometry['connections'] = [];
    
    for (let i = 0; i < objects.length - 1; i++) {
      const fromObj = objects[i];
      const toObj = objects[i + 1];
      
      // 检查是否连续帧
      if (FRONT_CAMERA_WALL_CONFIG.SHOW_ONLY_CONTINUOUS) {
        if (toObj.frameIndex - fromObj.frameIndex !== 1) {
          continue;
        }
      }
      
      // 确保两个对象都有足够的底面角点
      if (fromObj.bottomCorners3D.length >= 4 && toObj.bottomCorners3D.length >= 4) {
        connectionSegments.push({
          fromFrame: fromObj.frameIndex,
          toFrame: toObj.frameIndex,
          fromCorners3D: fromObj.bottomCorners3D,
          toCorners3D: toObj.bottomCorners3D,
        });
      }
    }
    
    if (connectionSegments.length > 0) {
      connections.push({
        instance_id: instanceId,
        category: objects[0].category,
        connections: connectionSegments,
      });
    }
  });
  
  return connections;
}

/**
 * 前视相机墙数据处理Hook
 */
export function useFrontCameraWall(enabled: boolean = true) {
  const cameraStream = useAppSelector((state) => state.currentScene.cameraStream);
  const gtStream = useAppSelector((state) => state.currentScene.gtStream);
  const imageCache = useAppSelector((state) => state.camera.imageCache);
  
  return useMemo(() => {
    if (!enabled || !cameraStream?.frames || !gtStream?.frames) {
      return {
        nodes: [],
        connections: [],
        config: {
          imageScale: FRONT_CAMERA_WALL_CONFIG.IMAGE_SCALE,
          frameSpacing: FRONT_CAMERA_WALL_CONFIG.FRAME_Z_SPACING,
          baseZOffset: FRONT_CAMERA_WALL_CONFIG.BASE_Z_OFFSET,
        },
      };
    }
    
    const nodes: FrontCameraWallNode[] = [];
    const planeDistance = FRONT_CAMERA_WALL_CONFIG.IMAGE_PLANE_DISTANCE;
    
    // 遍历所有帧
    for (let frameIndex = 0; frameIndex < cameraStream.frames.length; frameIndex++) {
      const cameraFrame = cameraStream.frames[frameIndex];
      const gtFrame = gtStream.frames[frameIndex];
      
      if (!cameraFrame || !gtFrame) continue;
      
      // 找到前视相机
      const frontCamera = cameraFrame.cameras.find(cam => cam.channel === 'CAM_FRONT');
      if (!frontCamera) continue;
      
      const egoPose = gtFrame.ego_pose;
      
      // 计算相机图片信息
      const cameraPosition = getCameraGlobalPosition(egoPose, frontCamera.extrinsic);
      const cameraOrientation = getCameraGlobalOrientation(egoPose, frontCamera.extrinsic);
      const forwardVector = getCameraForwardVector(egoPose, frontCamera.extrinsic);
      
      // 计算视场角
      const fov = calculateFOV(frontCamera.intrinsic, frontCamera.width, frontCamera.height);
      
      // 计算平面尺寸（放大）
      const planeSize = calculatePlaneSizeByFOV(
        planeDistance,
        fov.horizontal,
        fov.vertical,
        FRONT_CAMERA_WALL_CONFIG.IMAGE_SCALE
      );
      
      // 计算图片平面位置（沿Z轴排列）
      const zPosition = FRONT_CAMERA_WALL_CONFIG.BASE_Z_OFFSET;
      
      const imagePosition: Point3D = [
        cameraPosition[0] + forwardVector[0] * planeDistance,
        cameraPosition[1] + forwardVector[1] * planeDistance,
        zPosition,
      ];
      
      const cameraImage: STCCameraImage = {
        channel: frontCamera.channel,
        frameIndex,
        position: imagePosition,
        orientation: cameraOrientation,
        imagePath: frontCamera.image_path,
        imageUrl: imageCache[frontCamera.image_path],
        width: frontCamera.width,
        height: frontCamera.height,
        planeWidth: planeSize.width,
        planeHeight: planeSize.height,
      };
      
      // 投影对象
      const projectedObjects: ProjectedObjectOnCamera[] = [];
      
      gtFrame.objects.boxes.forEach((box, objIndex) => {
        const instanceId = gtFrame.objects.instance_ids[objIndex];
        const category = gtFrame.objects.categories[objIndex];
        
        const projected = projectObjectToCamera(
          box,
          instanceId,
          category,
          frameIndex,
          egoPose,
          frontCamera.extrinsic,
          frontCamera.intrinsic,
          frontCamera.width,
          frontCamera.height,
          planeDistance
        );
        
        if (projected) {
          projectedObjects.push(projected);
        }
      });
      
      nodes.push({
        frameIndex,
        cameraImage,
        projectedObjects,
      });
    }
    
    // 构建连接几何体
    const connections = buildObjectConnections(nodes);
    
    return {
      nodes,
      connections,
      config: {
        imageScale: FRONT_CAMERA_WALL_CONFIG.IMAGE_SCALE,
        frameSpacing: FRONT_CAMERA_WALL_CONFIG.FRAME_Z_SPACING,
        baseZOffset: FRONT_CAMERA_WALL_CONFIG.BASE_Z_OFFSET,
      },
    };
  }, [enabled, cameraStream, gtStream, imageCache]);
}



