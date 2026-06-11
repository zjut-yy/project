

/** 3D坐标点 [x, y, z] */
export type Point3D = [number, number, number];

/** 2D坐标点 [x, y] */
export type Point2D = [number, number];

/** 时空立方体显示模式 */
export type STCMode = 'full' | 'windowed';

/** 视角模式 */
export type ViewMode = '2d' | '3d' | 'fps';

/** 图层配置 */
export interface STCLayers {
  /** 地图图层 */
  map: {
    divider: boolean;       // 车道分隔线
    ped_crossing: boolean;  // 人行横道
    drivable_area: boolean; // 可驾驶区域
    boundary: boolean;      // 道路边界
    boundaryMode?: '2d' | '3d'; // 道路边界显示模式
  };
  /** 轨迹图层 */
  trajectory: boolean;
  /** 对象图层 */
  objects: boolean;
  /** 预测对象图层 */
  predictionObjects: boolean;
  /** 对象误差着色模式 */
  objectErrorMode: boolean;
  /** 对象轨迹图层 */
  objectTracks: boolean;
  /** 时间网格图层 */
  timeGrid: boolean;
  /** 相机图片图层 */
  cameraImages: boolean;
  /** 相机视锥体图层 */
  cameraFrustums: boolean;
  /** 自车状态墙图层 */
  egoStateWall: boolean;
  /** 指标墙图层 */
  metricsWall: boolean;
  /** 检测时间线墙图层 */
  detectionTimelineWall: boolean;
  /** 前视相机墙图层 */
  frontCameraWall: boolean;
}

/** 时空立方体配置 */
export interface STCConfig {
  /** 显示模式 */
  mode: STCMode;
  /** 图层配置 */
  layers: STCLayers;
  /** Z轴缩放因子（每帧的Z轴间距，单位：米） */
  zScale: number;
  /** 时间窗口大小（仅在windowed模式下使用） */
  timeWindowSize?: number;
}

/** 时间范围 */
export interface TimeRange {
  minFrame: number;
  maxFrame: number;
  zMin: number;
  zMax: number;
}

/** 3D轨迹点数据 */
export interface STCTrajectoryPoint {
  index: number;
  timestamp: number;
  position: Point3D; // [x, y, z] 其中z = frameIndex * zScale
  heading: number;
}

/** 3D对象数据 */
export interface STCObject {
  token: string;
  instance_id: string;
  category: string;
  position: Point3D;  // [x, y, z] 其中z = frameIndex * zScale
  heading: number;    // 航向角（弧度）
  size: [number, number, number]; // [width, length, height]
  frameIndex: number; // 所属帧索引
}

/** 3D预测对象数据 */
export interface STCPredictionObject {
  token: string;
  track_id: string;
  category: string;
  position: Point3D;  // [x, y, z] 其中z = frameIndex * zScale
  heading: number;    // 航向角（弧度）
  size: [number, number, number]; // [width, length, height]
  frameIndex: number; // 所属帧索引
  score: number;      // 预测置信度 (0-1)
}

/** 对象时空轨迹 */
export interface STCObjectTrack {
  instance_id: string;
  category: string;
  positions: Point3D[]; // 对象在不同帧的3D位置
}

/** 3D地图元素 */
export interface STCMapElement {
  type: 'divider' | 'ped_crossing' | 'drivable_area' | 'boundary';
  points: Point3D[]; // 地图元素的3D坐标（通常z=0）
}

/** 时间网格切片 */
export interface TimeGridSlice {
  frameIndex: number;
  z: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

/** 3D相机图片数据 */
export interface STCCameraImage {
  channel: string;         // 相机通道名称
  frameIndex: number;      // 帧索引
  position: Point3D;       // 图片平面中心在全局坐标系的位置
  orientation: [number, number, number]; // [pitch, yaw, roll] 图片平面的朝向（度）
  imagePath: string;       // 图片路径
  imageUrl?: string;       // 加载后的图片URL（用于纹理）
  width: number;           // 图片宽度（像素）
  height: number;          // 图片高度（像素）
  planeWidth: number;      // 3D平面宽度（米）
  planeHeight: number;     // 3D平面高度（米）
}

/** 3D相机视锥体数据 */
export interface STCCameraFrustum {
  channel: string;         // 相机通道名称
  frameIndex: number;      // 帧索引
  position: Point3D;       // 相机位置
  lines: Point3D[][];      // 视锥体边线
  fov: {
    horizontal: number;    // 水平视场角（弧度）
    vertical: number;      // 垂直视场角（弧度）
  };
}

/** Deck.gl OrbitView 视图状态 */
export interface DeckViewState {
  target?: Point3D;
  zoom?: number;
  rotationX?: number;
  rotationOrbit?: number;
  minZoom?: number;
  maxZoom?: number;
  transitionDuration?: number;
  heightOffset?: number;
  forwardOffset?: number;
}

/** 自车状态墙配置 */
export interface EgoStateWallConfig {
  /** 墙的总高度（米） */
  height: number;
  /** 墙的宽度（米），垂直于轨迹路径 */
  width: number;
  /** 速度颜色方案 */
  velocityColorScheme: 'gradient' | 'discrete' | 'custom';
  /** 加速度颜色方案 */
  accelerationColorScheme: 'gradient' | 'discrete' | 'custom';
  /** 透明度 */
  opacity: number;
}

/** 自车状态墙分段数据 */
export interface EgoStateWallSegment {
  /** 分段索引 */
  index: number;
  /** 帧索引 */
  frameIndex: number;
  /** 速度值 */
  velocity: number;
  /** 加速度值 */
  acceleration: number;
  /** 速度多边形顶点（上半部分） */
  velocityPolygon: Point3D[];
  /** 加速度多边形顶点（下半部分） */
  accelerationPolygon: Point3D[];
  /** 速度颜色 [r, g, b, a] */
  velocityColor: [number, number, number, number];
  /** 加速度颜色 [r, g, b, a] */
  accelerationColor: [number, number, number, number];
}

/** 自车状态墙节点数据 (用于构建连续网格) */
export interface EgoStateWallNode {
  /** 节点索引 */
  index: number;
  /** 帧索引 */
  frameIndex: number;
  /** 3D位置 */
  position: Point3D;
  /** 速度值 */
  velocity: number;
  /** 加速度值 */
  acceleration: number;
  /** 速度颜色 [r, g, b, a] */
  velocityColor: [number, number, number, number];
  /** 加速度颜色 [r, g, b, a] */
  accelerationColor: [number, number, number, number];
}

/** 指标墙配置 */
export interface MetricsWallConfig {
  /** 墙的总高度（米） */
  height: number;
  /** 透明度 */
  opacity: number;
  /** 颜色方案 */
  colorScheme: 'gradient' | 'discrete' | 'custom';
}

/** 指标墙节点数据 (用于构建连续网格) */
export interface MetricsWallNode {
  /** 节点索引 */
  index: number;
  /** 帧索引 */
  frameIndex: number;
  /** 3D位置 */
  position: Point3D;
  /** Mapping mAP 值 */
  mappingMAP: number;
  /** Detection NDS 值 */
  detectionNDS: number;
  /** Planning mean_l2_error 值 */
  planningError: number;
  /** Mapping 颜色 [r, g, b, a] */
  mappingColor: [number, number, number, number];
  /** Detection 颜色 [r, g, b, a] */
  detectionColor: [number, number, number, number];
  /** Planning 颜色 [r, g, b, a] */
  planningColor: [number, number, number, number];
}

/** 指标墙分段数据 */
export interface MetricsWallSegment {
  /** 分段索引 */
  index: number;
  /** 帧索引 */
  frameIndex: number;
  /** Mapping mAP 值 */
  mappingMAP: number;
  /** Detection NDS 值 */
  detectionNDS: number;
  /** Planning mean_l2_error 值 */
  planningError: number;
  /** Mapping 多边形顶点（底部1/3） */
  mappingPolygon: Point3D[];
  /** Detection 多边形顶点（中间1/3） */
  detectionPolygon: Point3D[];
  /** Planning 多边形顶点（顶部1/3） */
  planningPolygon: Point3D[];
  /** Mapping 颜色 [r, g, b, a] */
  mappingColor: [number, number, number, number];
  /** Detection 颜色 [r, g, b, a] */
  detectionColor: [number, number, number, number];
  /** Planning 颜色 [r, g, b, a] */
  planningColor: [number, number, number, number];
}

// ==================== 通用属性墙类型定义 ====================

/** 通用属性墙节点数据 */
export interface AttributeWallNode {
  /** 节点索引 */
  index: number;
  /** 帧索引 */
  frameIndex: number;
  /** 3D位置 */
  position: Point3D;
  /** 属性值和颜色的映射 */
  attributes: Record<string, {
    value: number;
    color: [number, number, number, number];
  }>;
}

/** 属性色带配置 */
export interface AttributeBand {
  /** 唯一标识符（如 'velocity', 'acceleration', 'mapping', 'detection', 'planning'） */
  id: string;
  /** 显示标签（如 '速度', '加速度', 'Mapping', 'Detection', 'Planning'） */
  label: string;
  /** 是否显示 */
  show: boolean;
  /** 高度占比（所有 band 的 heightRatio 总和应为 1.0） */
  heightRatio: number;
}

/** 通用属性墙配置 */
export interface AttributeWallConfig {
  /** 墙的总高度（米） */
  height: number;
  /** 墙的起始高度（米），相对于轨迹点的 z 坐标 */
  baseHeight: number;
  /** 属性色带配置数组（从下到上的顺序） */
  bands: AttributeBand[];
  /** 默认透明度 */
  opacity: number;
  /** 是否显示分隔线 */
  showSeparators: boolean;
  /** 是否显示竖线（从墙顶到地面） */
  showVerticalLines: boolean;
  /** 是否显示属性标签 */
  showLabels: boolean;
  /** 竖线颜色 */
  verticalLineColor?: [number, number, number, number];
  /** 竖线宽度（米） */
  verticalLineWidth?: number;
  /** 分隔线颜色 */
  separatorColor?: [number, number, number, number];
  /** 分隔线宽度（米） */
  separatorWidth?: number;
}

// ==================== 前视相机墙类型定义 ====================

/** 投影到相机平面的对象数据 */
export interface ProjectedObjectOnCamera {
  /** 对象实例ID */
  instance_id: string;
  /** 对象类别 */
  category: string;
  /** 帧索引 */
  frameIndex: number;
  /** 3D边界框（全局坐标） */
  box3D: [number, number, number, number, number, number, number]; // [x, y, z, width, length, height, yaw]
  /** 投影到图像平面的角点（2D图像坐标，像素） */
  corners2D: (Point2D | null)[]; // 8个角点，null表示不在视野内
  /** 各角点是否在视野内 */
  cornersInView: boolean[];
  /** 中心点投影（2D图像坐标） */
  center2D: Point2D | null;
  /** 底面4个角点在3D相机平面上的位置（全局坐标） */
  bottomCorners3D: Point3D[];
}

/** 前视相机墙节点（每一帧的数据） */
export interface FrontCameraWallNode {
  /** 帧索引 */
  frameIndex: number;
  /** 相机图片信息 */
  cameraImage: STCCameraImage;
  /** 该帧在相机上的投影对象 */
  projectedObjects: ProjectedObjectOnCamera[];
}

/** 对象连接几何体（连接前后帧的同一对象） */
export interface ObjectConnectionGeometry {
  /** 对象实例ID */
  instance_id: string;
  /** 对象类别 */
  category: string;
  /** 连接段（每段连接两个连续帧） */
  connections: {
    /** 起始帧索引 */
    fromFrame: number;
    /** 结束帧索引 */
    toFrame: number;
    /** 前一帧在相机平面上的底面角点（全局坐标） */
    fromCorners3D: Point3D[];
    /** 后一帧在相机平面上的底面角点（全局坐标） */
    toCorners3D: Point3D[];
  }[];
}

/** 前视相机墙配置 */
export interface FrontCameraWallConfig {
  /** 图片缩放比例 */
  imageScale: number;
  /** 帧在Z轴的间距（米） */
  frameSpacing: number;
  /** 起始Z轴偏移 */
  baseZOffset: number;
  /** 连接几何体透明度 */
  connectionOpacity: number;
  /** 边界框线宽 */
  bboxLineWidth: number;
  /** 只显示连续帧的连接 */
  showOnlyContinuous: boolean;
  /** 最小投影比例（筛选对象） */
  minProjectionRatio: number;
}

