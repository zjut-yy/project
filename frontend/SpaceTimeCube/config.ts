
import type { STCLayers } from './types';

/** 默认图层配置 */
export const DEFAULT_LAYERS: STCLayers = {
  map: {
    divider: true,
    ped_crossing: true,
    drivable_area: true,
    boundary: true,
    boundaryMode: '3d',
  },
  trajectory: true,
  objects: true,
  predictionObjects: true,
  objectErrorMode: true,
  objectTracks: true,
  timeGrid: false,
  cameraImages: true,
  cameraFrustums: true,
  egoStateWall: false,
  metricsWall: false,
  detectionTimelineWall: false,
  frontCameraWall: false,
};


/** 相机配置 */
export const CAMERA_CONFIG = {
  /** 3D视角配置 */
  VIEW_3D: {
    target: [0, 0, 0] as [number, number, number],
    zoom: 5,
    minZoom: 3,
    maxZoom: 16,
    rotationX: 45, // X轴旋转（俯仰角，0度水平，90度正上方）
    rotationOrbit: 0, // 轨道旋转（方位角）
    transitionDuration: 300,
  },
  /** 2D鸟瞰视角配置 */
  VIEW_2D: {
    target: [0, 0, 0] as [number, number, number],
    zoom: 3,
    minZoom: 0.1,
    maxZoom: 8,
    rotationX: 90, // 90度正上方俯视
    rotationOrbit: 0, // 固定方向
    transitionDuration: 300,
  },
  /** 第一视角配置 */
  VIEW_FPS: {
    zoom: 8,
    minZoom: 3,
    maxZoom: 12,
    rotationX: 0, // 水平视角（将根据车辆实际俯仰角实时调整）
    heightOffset: 1.6, // 相机高度偏移（米），模拟驾驶员视角高度
    forwardOffset: 2.5, // 相机前后偏移（米），正值向车头前方
    transitionDuration: 150, // 降低过渡时间，使视角更跟手
  },
  /** 控制器配置 - 3D模式 */
  CONTROLLER_3D: {
    scrollZoom: true,
    dragPan: true,
    dragRotate: true,
    doubleClickZoom: false,
    touchZoom: true,
    touchRotate: true,
    keyboard: true,
    inertia: true,
  },
  /** 控制器配置 - 2D模式 */
  CONTROLLER_2D: {
    scrollZoom: true,
    dragPan: true,
    dragRotate: false,
    doubleClickZoom: true,
    touchZoom: true,
    touchRotate: false,
    keyboard: true,
    inertia: true,
  },
  /** 控制器配置 - 第一视角模式 */
  CONTROLLER_FPS: {
    scrollZoom: true,
    dragPan: false, // 禁用平移，相机位置完全跟随自车
    dragRotate: true, // 允许旋转观察
    doubleClickZoom: false,
    touchZoom: true,
    touchRotate: true,
    keyboard: false,
    inertia: false, // 禁用惯性，使视角变化更精确
  },
};

export const LAYER_STYLES = {
  map: {
    drivable_area: {
      fill: 'rgb(212, 212, 212)',
      stroke: 'rgba(118, 118, 118, 1)',
      strokeWidth: 1,
    },
    divider: {
      stroke: 'rgb(70, 159, 227)',
      strokeWidth: 2,
    },
    boundary: {
      stroke: 'rgb(87, 86, 86)',
      strokeWidth: 2,
      height3d: 0.2,
      width3d: 0.2,
    },
    ped_crossing: {
      fill: 'rgb(237, 166, 94)',
      stroke: 'rgb(161, 159, 159)',
      strokeWidth: 0.1,
    },
  },
  trajectory: {
    stroke: 'rgba(65, 105, 225, 0.9)',
    width: 3,
  },
  objects: {
    fill: 'rgba(118, 118, 118, 1)',
    stroke: 'rgba(118, 118, 118, 1)',
    lineColor: 'rgba(0, 0, 0, 0.39)',
  },
  objectTracks: {
    stroke: 'rgba(136, 136, 136, 0.4)',
    strokeWidth: 2,
  },

  // 相机图片样式
  cameraImages: {
    color: 'rgba(255, 255, 255, 0.9)',
    borderColor: 'rgba(255, 255, 255, 1)',
    borderWidth: 0.05,
    highlightColor: 'rgba(255, 255, 0, 0.39)',
  },
};

/** 渲染配置 */
export const RENDER_CONFIG = {
  /** 边界填充比例 */
  PADDING_RATIO: 0.1,
  /** 性能优化：是否启用拾取（hover/click） */
  PICKABLE: false,
  /** 性能优化：对象数量阈值（超过此值使用简化渲染） */
  OBJECT_COUNT_THRESHOLD: 1000,
};

/** 颜色配置 */
export const COLOR_CONFIG = {
  /** 轨迹渐变色（从早到晚） */
  TRAJECTORY_GRADIENT: {
    start: 'rgba(65, 105, 225, 1)', // 蓝色
    end: 'rgba(255, 69, 0, 1)',     // 橙红色
  },
  /** 背景色 */
  BACKGROUND_COLOR: 'rgba(255, 255, 255, 1)', // 白色背景
  /** 默认对象颜色 */
  DEFAULT_OBJECT_COLOR: 'rgba(169, 169, 169, 1)',
};

/** 对象类别到颜色的映射 */
export const CATEGORY_COLORS: Record<string, string> = {
  car: 'rgb(140, 183, 228)',        // 红色
  truck: 'rgba(255, 165, 0, 1)',        // 橙色
  bus: 'rgba(255, 215, 0, 1)',          // 金色
  bicycle: 'rgba(135, 206, 235, 1)',    // 天蓝色
  motorcycle: 'rgba(147, 112, 219, 1)', // 紫色
  pedestrian: 'rgba(255, 105, 180, 1)', // 粉色
  trailer: 'rgba(255, 140, 0, 1)',      // 深橙色
  construction_vehicle: 'rgba(188, 143, 143, 1)', // 玫瑰褐色
  traffic_cone: 'rgba(255, 255, 0, 1)', // 黄色
  barrier: 'rgba(128, 128, 128, 1)',    // 灰色
};

/** 相机图片配置 */
export const CAMERA_IMAGE_CONFIG = {

  DISTANCE_FROM_EGO: {
    CAM_FRONT:2.5,          // 前置相机使用更大距离
    CAM_FRONT_LEFT: 2.0,     // 左前相机默认距离
    CAM_FRONT_RIGHT: 2.0,    // 右前相机默认距离
    CAM_BACK: 1.2,           // 后置相机默认距离
    CAM_BACK_LEFT: 2.0,      // 左后相机默认距离
    CAM_BACK_RIGHT: 2.0,     // 右后相机默认距离
    DEFAULT: 2.0,            // 其他未指定相机的默认距离
  } as Record<string, number>,
  /** 距离调整的最小值（米） */
  MIN_DISTANCE: 0.5,
  /** 距离调整的最大值（米） */
  MAX_DISTANCE: 6.0,
  /**
   * 图片填充视锥体的比例（0-1）
   * 控制图片大小相对于视锥体的占比
   * 1.0 = 完全填充视锥体
   */
  FRUSTUM_FILL_RATIO: 1,
  /** 是否启用拾取（点击交互） */
  PICKABLE: true,
};

/** 相机视锥体配置 */
export const CAMERA_FRUSTUM_CONFIG = {
  /** 视锥体线宽 */
  LINE_WIDTH: 1,
  /** 视锥体颜色（按相机通道） */
  COLORS: {
    CAM_FRONT: 'rgba(86, 239, 72, 0.6)',
    CAM_FRONT_LEFT: 'rgba(86, 239, 72, 0.6)',
    CAM_FRONT_RIGHT: 'rgba(86, 239, 72, 0.6)',
    CAM_BACK: 'rgba(86, 239, 72, 0.6)',
    CAM_BACK_LEFT: 'rgba(86, 239, 72, 0.6)',
    CAM_BACK_RIGHT: 'rgba(86, 239, 72, 0.6)',
  } as Record<string, string>,
};

/**
 * 将 rgba 字符串转换为 deck.gl 需要的 [r, g, b, a] 数组格式
 * @param rgba - rgba 或 rgb 字符串，格式为 'rgba(r, g, b, a)' 或 'rgb(r, g, b)'
 * @returns [r, g, b, a] 数组，其中 alpha 值转换为 0-255
 */
export function rgbaToArray(rgba: string): [number, number, number, number] {
  // 支持 rgba 和 rgb 格式
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) {
    console.warn('无法解析颜色字符串:', rgba);
    return [0, 0, 0, 255];
  }
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  const a = match[4] ? Math.round(parseFloat(match[4]) * 255) : 255;
  
  // 验证值在有效范围内
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255 || a < 0 || a > 255) {
    console.warn('颜色值超出范围:', { rgba, r, g, b, a });
  }
  
  return [r, g, b, a];
}

/** 获取对象类别颜色 */
export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || COLOR_CONFIG.DEFAULT_OBJECT_COLOR;
}

/**
 * 获取基于误差的颜色
 * @param error - 误差值（米）
 * @param isDetected - 是否被检测到
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组格式
 */
export function getErrorBasedColor(
  error: number | undefined,
  isDetected: boolean,
  opacity = 1.0
): [number, number, number, number] {
  // 未检测到的对象显示为灰色
  if (!isDetected) {
    return [128, 128, 128, Math.round(opacity * 255)];
  }
  
  // 如果没有误差数据，也显示为灰色
  if (error === undefined) {
    return [128, 128, 128, Math.round(opacity * 255)];
  }
  
  // 误差颜色映射：绿色（低误差）→ 黄色 → 红色（高误差）
  // 误差阈值：0-0.5m（绿），0.5-1.0m（黄绿→黄），1.0-2.0m（黄→红），>2.0m（红）
  const minError = 0.0;
  const maxError = 2.0;
  
  // 归一化误差值到 [0, 1]
  const normalizedError = Math.max(0, Math.min(1, (error - minError) / (maxError - minError)));
  
  let r: number, g: number, b: number;
  
  if (normalizedError < 0.25) {
    // 0-0.5m: 绿色 (0, 255, 0)
    r = 0;
    g = 255;
    b = 0;
  } else if (normalizedError < 0.5) {
    // 0.5-1.0m: 绿色 → 黄色
    const t = (normalizedError - 0.25) / 0.25;
    r = Math.round(255 * t);
    g = 255;
    b = 0;
  } else if (normalizedError < 0.75) {
    // 1.0-1.5m: 黄色 → 橙色
    const t = (normalizedError - 0.5) / 0.25;
    r = 255;
    g = Math.round(255 * (1 - t * 0.5));
    b = 0;
  } else {
    // 1.5-2.0m+: 橙色 → 红色
    const t = (normalizedError - 0.75) / 0.25;
    r = 255;
    g = Math.round(128 * (1 - t));
    b = 0;
  }
  
  return [r, g, b, Math.round(opacity * 255)];
}

/** 计算轨迹点颜色（基于帧索引的渐变） */
export function getTrajectoryColor(
  frameIndex: number,
  totalFrames: number
): string {
  const t = totalFrames > 1 ? frameIndex / (totalFrames - 1) : 0;
  const startArray = rgbaToArray(COLOR_CONFIG.TRAJECTORY_GRADIENT.start);
  const endArray = rgbaToArray(COLOR_CONFIG.TRAJECTORY_GRADIENT.end);
  
  const r = Math.round(startArray[0] + (endArray[0] - startArray[0]) * t);
  const g = Math.round(startArray[1] + (endArray[1] - startArray[1]) * t);
  const b = Math.round(startArray[2] + (endArray[2] - startArray[2]) * t);
  const a = (startArray[3] + (endArray[3] - endArray[3]) * t) / 255;
  
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
// ==================== 通用属性墙配置 ====================

/** 自车状态墙配置（使用统一的属性墙结构） */
export const EGO_STATE_WALL_CONFIG = {
  /** 墙的总高度（米） */
  HEIGHT: 2.0,
  /** 墙的起始高度（米），相对于轨迹点的 z 坐标 */
  BASE_HEIGHT: 8.0,
  /** 默认透明度 */
  OPACITY: 1,
  /** 速度颜色渐变 */
  VELOCITY_COLORS: {
    min: 'rgb(18, 242, 74)',   // 绿色（低速）
    max: 'rgb(255, 0, 0)',     // 红色（高速）
  },
  /** 加速度颜色渐变 */
  ACCELERATION_COLORS: {
    min: 'rgb(18, 242, 74)',   // 绿色（低加速度）
    max: 'rgb(255, 0, 0)',     // 红色（高加速度）
  },
} as const;

/** 指标墙配置（使用统一的属性墙结构） */
export const METRICS_WALL_CONFIG = {
  /** 墙的总高度（米） */
  HEIGHT: 3.0,
  /** 墙的起始高度（米），相对于轨迹点的 z 坐标加上自车状态墙高度 */
  BASE_HEIGHT: 5.0,
  /** 默认透明度 */
  OPACITY: 1,
  /** Mapping mAP 颜色渐变 */
  MAPPING_COLORS: {
    min: 'rgb(18, 242, 74)',   // 绿色（高质量）
    max: 'rgb(255, 0, 0)',     // 红色（低质量）
  },
  /** Detection NDS 颜色渐变 */
  DETECTION_COLORS: {
    min: 'rgb(18, 242, 74)',   // 绿色（高质量）
    max: 'rgb(255, 0, 0)',     // 红色（低质量）
  },
  /** Planning mean_l2_error 颜色渐变 */
  PLANNING_COLORS: {
    min: 'rgb(18, 242, 74)',   // 绿色（低误差）
    max: 'rgb(255, 0, 0)',     // 红色（高误差）
  },
} as const;

/** 通用属性墙样式配置 */
export const ATTRIBUTE_WALL_STYLE = {
  /** 竖线颜色（从墙顶到地面） */
  VERTICAL_LINE_COLOR: [ 73, 81, 95, 180] as [number, number, number, number],
  /** 竖线宽度（像素） */
  VERTICAL_LINE_WIDTH: 0.1,
  /** 分隔线颜色（各属性分区之间） */
  SEPARATOR_COLOR: [255, 255, 255, 200] as [number, number, number, number],
  /** 分隔线宽度（米） */
  SEPARATOR_WIDTH: 0.1,
  /** 是否显示竖线 */
  SHOW_VERTICAL_LINES: true,
  /** 是否显示分隔线 */
  SHOW_SEPARATORS: true,
  /** 是否显示属性标签 */
  SHOW_LABELS: true,
} as const;

/** 检测时间线墙配置 */
export const DETECTION_TIMELINE_WALL_CONFIG = {
  /** 墙的总高度（米）- 根据对象数量动态计算 */
  HEIGHT_PER_OBJECT: 0.4,
  /** 墙的起始高度（米），相对于轨迹点的 z 坐标 */
  BASE_HEIGHT: 18.0,
  /** 默认透明度 */
  OPACITY: 1.0,
  /** 是否显示分隔线（对象之间） */
  SHOW_SEPARATORS: false,
  /** 是否显示竖线（时间线） */
  SHOW_VERTICAL_LINES: false,
  /** 是否显示对象标签 */
  SHOW_LABELS: false,
} as const;

/**
 * 将数值归一化到 [0, 1] 范围
 */
function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * 获取速度颜色（蓝色到红色渐变）
 * @param value - 速度值
 * @param min - 最小速度值
 * @param max - 最大速度值
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组格式
 */
export function getVelocityColor(
  value: number,
  min: number,
  max: number,
  opacity = 1.0
): [number, number, number, number] {
  const t = normalizeValue(value, min, max);
  const minColor = rgbaToArray(EGO_STATE_WALL_CONFIG.VELOCITY_COLORS.min); // 蓝色 [0, 0, 255]
  const maxColor = rgbaToArray(EGO_STATE_WALL_CONFIG.VELOCITY_COLORS.max); // 红色 [255, 0, 0]
  
  const r = Math.round(minColor[0] + (maxColor[0] - minColor[0]) * t);
  const g = Math.round(minColor[1] + (maxColor[1] - minColor[1]) * t);
  const b = Math.round(minColor[2] + (maxColor[2] - minColor[2]) * t);
  const a = Math.round(opacity * 255);
  
  return [r, g, b, a];
}

/**
 * 获取加速度颜色（绿色到红色渐变，零值为白色）
 * @param value - 加速度值
 * @param min - 最小加速度值
 * @param max - 最大加速度值
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组格式
 */
export function getAccelerationColor(
  value: number,
  min: number,
  max: number,
  opacity = 1.0
): [number, number, number, number] {


    const t = normalizeValue(value, min, max);
    const minColor = rgbaToArray(EGO_STATE_WALL_CONFIG.ACCELERATION_COLORS.min); // 绿色 [0, 255, 0]
    const maxColor = rgbaToArray(EGO_STATE_WALL_CONFIG.ACCELERATION_COLORS.max); // 红色 [255, 0, 0]
    // 从浅橙色（t=0, value=min）到柔和的红色（t=1, value=max）
    const r = Math.round(minColor[0] + (maxColor[0] - minColor[0]) * t);
    const g = Math.round(minColor[1] + (maxColor[1] - minColor[1]) * t);
    const b = Math.round(minColor[2] + (maxColor[2] - minColor[2]) * t);
    const a = Math.round(opacity * 255);
    return [r, g, b, a];
  
}



/**
 * 获取 Mapping mAP 颜色（绿色到蓝色渐变）
 * @param value - mAP 值 (0-1)
 * @param min - 最小 mAP 值
 * @param max - 最大 mAP 值
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组格式
 */
export function getMappingColor(
  value: number,
  min: number,
  max: number,
  opacity = 1.0
): [number, number, number, number] {
  const t = normalizeValue(value, min, max);
  const minColor = rgbaToArray(METRICS_WALL_CONFIG.MAPPING_COLORS.min);
  const maxColor = rgbaToArray(METRICS_WALL_CONFIG.MAPPING_COLORS.max);
  
  const r = Math.round(minColor[0] + (maxColor[0] - minColor[0]) * t);
  const g = Math.round(minColor[1] + (maxColor[1] - minColor[1]) * t);
  const b = Math.round(minColor[2] + (maxColor[2] - minColor[2]) * t);
  const a = Math.round(opacity * 255);
  
  return [r, g, b, a];
}

/**
 * 获取 Detection NDS 颜色（红色到绿色渐变）
 * @param value - NDS 值 (0-1)
 * @param min - 最小 NDS 值
 * @param max - 最大 NDS 值
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组格式
 */
export function getDetectionColor(
  value: number,
  min: number,
  max: number,
  opacity = 1.0
): [number, number, number, number] {
  const t = normalizeValue(value, min, max);
  const minColor = rgbaToArray(METRICS_WALL_CONFIG.DETECTION_COLORS.min);
  const maxColor = rgbaToArray(METRICS_WALL_CONFIG.DETECTION_COLORS.max);
  
  const r = Math.round(minColor[0] + (maxColor[0] - minColor[0]) * t);
  const g = Math.round(minColor[1] + (maxColor[1] - minColor[1]) * t);
  const b = Math.round(minColor[2] + (maxColor[2] - minColor[2]) * t);
  const a = Math.round(opacity * 255);
  
  return [r, g, b, a];
}

/**
 * 获取 Planning mean_l2_error 颜色（绿色到红色渐变）
 * @param value - 误差值
 * @param min - 最小误差值
 * @param max - 最大误差值
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组格式
 */
export function getPlanningColor(
  value: number,
  min: number,
  max: number,
  opacity = 1.0
): [number, number, number, number] {
  // 对于误差值，我们需要反转归一化（低误差对应高t值，高误差对应低t值）
  // 因为误差越小越好，所以低误差应该显示为绿色（maxColor），高误差显示为红色（minColor）
  const t = 1 - normalizeValue(value, min, max); // 反转
  const minColor = rgbaToArray(METRICS_WALL_CONFIG.PLANNING_COLORS.min); // 绿色（低误差）
  const maxColor = rgbaToArray(METRICS_WALL_CONFIG.PLANNING_COLORS.max); // 红色（高误差）
  
  const r = Math.round(minColor[0] + (maxColor[0] - minColor[0]) * t);
  const g = Math.round(minColor[1] + (maxColor[1] - minColor[1]) * t);
  const b = Math.round(minColor[2] + (maxColor[2] - minColor[2]) * t);
  const a = Math.round(opacity * 255);
  
  return [r, g, b, a];
}

/**
 * 将 Hex 颜色字符串转换为 deck.gl 需要的 [r, g, b, a] 数组格式
 * @param hex - hex 字符串，格式为 '#RRGGBB'
 * @param opacity - 透明度（0-1）
 * @returns [r, g, b, a] 数组，alpha 值为 0-255
 */
export function hexToRGBA(hex: string, opacity = 1.0): [number, number, number, number] {
  // 移除 # 前缀
  const cleanHex = hex.replace('#', '');
  
  // 解析 RGB
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  const a = Math.round(opacity * 255);
  
  // 验证值在有效范围内
  if (isNaN(r) || isNaN(g) || isNaN(b) || r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
    console.warn('无效的 Hex 颜色:', hex);
    return [128, 128, 128, 255]; // 返回灰色作为默认值
  }
  
  return [r, g, b, a];
}

// ==================== 前视相机墙配置 ====================

/** 前视相机墙配置 */
export const FRONT_CAMERA_WALL_CONFIG = {
  /** 图片缩放比例 */
  IMAGE_SCALE: 2.5,
  /** 帧在Z轴的间距（米） */
  FRAME_Z_SPACING: 3.0,
  /** 起始Z轴偏移（米） */
  BASE_Z_OFFSET: 10.0,
  /** 连接几何体透明度 */
  CONNECTION_OPACITY: 0.4,
  /** 边界框线宽（像素） */
  BBOX_LINE_WIDTH: 2,
  /** 通道高度（米），即连接通道在Z轴的厚度 */
  CHANNEL_HEIGHT: 0.3,
  /** 只显示连续帧的连接 */
  SHOW_ONLY_CONTINUOUS: true,
  /** 最小投影比例（筛选对象，至少有多少比例的角点在视野内） */
  MIN_PROJECTION_RATIO: 0.1,
  /** 最大对象距离（米，超过此距离的对象不处理） */
  MAX_OBJECT_DISTANCE: 50,
  /** 图片平面距离相机的距离（米） */
  IMAGE_PLANE_DISTANCE: 2.5,
} as const;

