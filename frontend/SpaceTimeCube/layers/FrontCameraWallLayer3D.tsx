// 前视相机墙3D图层组件
// 渲染前视相机图片墙和对象连接几何体

import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { PlaneGeometry } from '@luma.gl/engine';
import type {
  FrontCameraWallNode,
  ObjectConnectionGeometry,
  ProjectedObjectOnCamera,
  Point3D,
} from '../types';
import {
  FRONT_CAMERA_WALL_CONFIG,
  LAYER_STYLES,
  rgbaToArray,
  getCategoryColor,
} from '../config';

interface FrontCameraWallLayer3DProps {
  nodes: FrontCameraWallNode[];
  connections: ObjectConnectionGeometry[];
  config: {
    imageScale: number;
    frameSpacing: number;
    baseZOffset: number;
  };
}

/**
 * 创建平面几何体
 */
function createPlaneMesh(width: number, height: number) {
  return new PlaneGeometry({
    type: 'x,y',
    xlen: width,
    ylen: height,
    nx: 1,
    ny: 1,
    offset: 0,
  } as any);
}

/**
 * 创建相机图片层
 */
function createCameraImageLayers(nodes: FrontCameraWallNode[]) {
  const layers: SimpleMeshLayer<FrontCameraWallNode>[] = [];
  
  nodes.forEach(node => {
    const { cameraImage } = node;
    
    // 只显示已加载图片的相机
    if (!cameraImage.imageUrl) {
      return;
    }
    
    const mesh = createPlaneMesh(cameraImage.planeWidth, cameraImage.planeHeight);
    
    layers.push(
      new SimpleMeshLayer({
        id: `front-camera-wall-image-${node.frameIndex}`,
        data: [node],
        mesh,
        texture: cameraImage.imageUrl,
        getPosition: (d: FrontCameraWallNode) => d.cameraImage.position,
        getOrientation: (d: FrontCameraWallNode) => d.cameraImage.orientation,
        getColor: rgbaToArray(LAYER_STYLES.cameraImages.color),
        sizeScale: 1,
        pickable: false,
        updateTriggers: {
          getPosition: [cameraImage.position],
          getOrientation: [cameraImage.orientation],
          texture: cameraImage.imageUrl,
        },
        parameters: {
          depthTest: true,
          depthMask: true,
        },
      })
    );
  });
  
  return layers;
}

/**
 * 创建2D边界框层（在相机平面上）
 */
function createBoundingBoxLayers(nodes: FrontCameraWallNode[]) {
  // 收集所有投影对象的边界框路径
  const boxPaths: {
    path: Point3D[];
    color: [number, number, number, number];
  }[] = [];
  
  nodes.forEach(node => {
    node.projectedObjects.forEach(obj => {
      // 使用底面4个角点构建边界框
      if (obj.bottomCorners3D.length >= 4) {
        const path = [
          obj.bottomCorners3D[0],
          obj.bottomCorners3D[1],
          obj.bottomCorners3D[2],
          obj.bottomCorners3D[3],
          obj.bottomCorners3D[0], // 闭合路径
        ];
        
        const categoryColor = getCategoryColor(obj.category);
        const color = rgbaToArray(categoryColor);
        
        boxPaths.push({ path, color });
      }
    });
  });
  
  if (boxPaths.length === 0) {
    return [];
  }
  
  return [
    new PathLayer({
      id: 'front-camera-wall-bboxes',
      data: boxPaths,
      getPath: (d: typeof boxPaths[0]) => d.path,
      getColor: (d: typeof boxPaths[0]) => d.color,
      getWidth: FRONT_CAMERA_WALL_CONFIG.BBOX_LINE_WIDTH,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      widthMaxPixels: 4,
      pickable: false,
      parameters: {
        depthTest: true,
      },
    }),
  ];
}

/**
 * 创建连接几何体层（封闭的通道）
 */
function createConnectionLayers(connections: ObjectConnectionGeometry[]) {
  // 收集所有连接面
  const polygons: {
    polygon: Point3D[];
    color: [number, number, number, number];
  }[] = [];
  
  connections.forEach(conn => {
    const categoryColor = getCategoryColor(conn.category);
    const baseColor = rgbaToArray(categoryColor);
    const color: [number, number, number, number] = [
      baseColor[0],
      baseColor[1],
      baseColor[2],
      Math.round(FRONT_CAMERA_WALL_CONFIG.CONNECTION_OPACITY * 255),
    ];
    
    conn.connections.forEach(segment => {
      const { fromCorners3D, toCorners3D } = segment;
      
      // 确保有足够的角点
      if (fromCorners3D.length < 4 || toCorners3D.length < 4) {
        return;
      }
      
      // 为每个连接段创建一个高度（通道深度）
      const channelHeight = FRONT_CAMERA_WALL_CONFIG.CHANNEL_HEIGHT || 0.5;
      
      // 计算顶面角点（在底面基础上增加Z坐标）
      const fromTopCorners3D: Point3D[] = fromCorners3D.map(corner => [
        corner[0],
        corner[1],
        corner[2] + channelHeight,
      ]);
      const toTopCorners3D: Point3D[] = toCorners3D.map(corner => [
        corner[0],
        corner[1],
        corner[2] + channelHeight,
      ]);
      
      // ===== 创建4个侧面（外壁） =====
      // 面1: 前边 (fromCorners[0-1] -> toCorners[0-1])
      polygons.push({
        polygon: [
          fromCorners3D[0],
          fromCorners3D[1],
          toCorners3D[1],
          toCorners3D[0],
        ],
        color,
      });
      
      // 面2: 右边 (fromCorners[1-2] -> toCorners[1-2])
      polygons.push({
        polygon: [
          fromCorners3D[1],
          fromCorners3D[2],
          toCorners3D[2],
          toCorners3D[1],
        ],
        color,
      });
      
      // 面3: 后边 (fromCorners[2-3] -> toCorners[2-3])
      polygons.push({
        polygon: [
          fromCorners3D[2],
          fromCorners3D[3],
          toCorners3D[3],
          toCorners3D[2],
        ],
        color,
      });
      
      // 面4: 左边 (fromCorners[3-0] -> toCorners[3-0])
      polygons.push({
        polygon: [
          fromCorners3D[3],
          fromCorners3D[0],
          toCorners3D[0],
          toCorners3D[3],
        ],
        color,
      });
      
      // ===== 创建4个侧面（内壁，顶部） =====
      // 顶面1: 前边
      polygons.push({
        polygon: [
          fromTopCorners3D[0],
          toTopCorners3D[0],
          toTopCorners3D[1],
          fromTopCorners3D[1],
        ],
        color,
      });
      
      // 顶面2: 右边
      polygons.push({
        polygon: [
          fromTopCorners3D[1],
          toTopCorners3D[1],
          toTopCorners3D[2],
          fromTopCorners3D[2],
        ],
        color,
      });
      
      // 顶面3: 后边
      polygons.push({
        polygon: [
          fromTopCorners3D[2],
          toTopCorners3D[2],
          toTopCorners3D[3],
          fromTopCorners3D[3],
        ],
        color,
      });
      
      // 顶面4: 左边
      polygons.push({
        polygon: [
          fromTopCorners3D[3],
          toTopCorners3D[3],
          toTopCorners3D[0],
          fromTopCorners3D[0],
        ],
        color,
      });
      
      // ===== 创建封口面 =====
      // 起始端封口（fromCorners底面和顶面之间的4个侧面）
      polygons.push({
        polygon: [
          fromCorners3D[0],
          fromCorners3D[1],
          fromTopCorners3D[1],
          fromTopCorners3D[0],
        ],
        color,
      });
      
      polygons.push({
        polygon: [
          fromCorners3D[1],
          fromCorners3D[2],
          fromTopCorners3D[2],
          fromTopCorners3D[1],
        ],
        color,
      });
      
      polygons.push({
        polygon: [
          fromCorners3D[2],
          fromCorners3D[3],
          fromTopCorners3D[3],
          fromTopCorners3D[2],
        ],
        color,
      });
      
      polygons.push({
        polygon: [
          fromCorners3D[3],
          fromCorners3D[0],
          fromTopCorners3D[0],
          fromTopCorners3D[3],
        ],
        color,
      });
      
      // 结束端封口（toCorners底面和顶面之间的4个侧面）
      polygons.push({
        polygon: [
          toCorners3D[0],
          toTopCorners3D[0],
          toTopCorners3D[1],
          toCorners3D[1],
        ],
        color,
      });
      
      polygons.push({
        polygon: [
          toCorners3D[1],
          toTopCorners3D[1],
          toTopCorners3D[2],
          toCorners3D[2],
        ],
        color,
      });
      
      polygons.push({
        polygon: [
          toCorners3D[2],
          toTopCorners3D[2],
          toTopCorners3D[3],
          toCorners3D[3],
        ],
        color,
      });
      
      polygons.push({
        polygon: [
          toCorners3D[3],
          toTopCorners3D[3],
          toTopCorners3D[0],
          toCorners3D[0],
        ],
        color,
      });
    });
  });
  
  if (polygons.length === 0) {
    return [];
  }
  
  return [
    new SolidPolygonLayer({
      id: 'front-camera-wall-connections',
      data: polygons,
      getPolygon: (d: typeof polygons[0]) => d.polygon,
      getFillColor: (d: typeof polygons[0]) => d.color,
      filled: true,
      extruded: false,
      pickable: false,
      parameters: {
        depthTest: true,
        blend: true,
        blendFunc: ['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA'],
      },
    }),
  ];
}

/**
 * 创建前视相机墙图层
 */
export function createFrontCameraWallLayers(props: FrontCameraWallLayer3DProps) {
  const { nodes, connections } = props;
  const allLayers: any[] = [];
  
  // 1. 相机图片层
  allLayers.push(...createCameraImageLayers(nodes));
  
  // 2. 2D边界框层
  allLayers.push(...createBoundingBoxLayers(nodes));
  
  // 3. 连接几何体层
  allLayers.push(...createConnectionLayers(connections));
  
  return allLayers;
}







