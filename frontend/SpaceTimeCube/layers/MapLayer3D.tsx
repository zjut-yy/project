// 3D地图图层组件
// 在Z=0平面绘制地图元素

import { PathLayer, PolygonLayer } from '@deck.gl/layers';
import type { STCMapElement } from '../types';
import { LAYER_STYLES, rgbaToArray } from '../config';

interface MapLayer3DProps {
  mapElements: STCMapElement[];
  layers: {
    divider: boolean;
    ped_crossing: boolean;
    drivable_area: boolean;
    boundary: boolean;
    boundaryMode?: '2d' | '3d';
  };
}

/**
 * 将线段路径转换为带宽度的多边形
 * @param points - 线段点数组 [[x, y, z], ...]
 * @param width - 多边形宽度（米）
 * @returns 多边形点数组（顺时针闭合）
 */
function pathToPolygon(points: [number, number, number][], width: number): [number, number, number][] {
  if (points.length < 2) return [];
  
  const halfWidth = width / 2;
  const leftSide: [number, number, number][] = [];
  const rightSide: [number, number, number][] = [];
  
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i];
    
    // 计算该点的法向量（垂直于线段方向）
    let normalX = 0, normalY = 0;
    
    if (i === 0) {
      // 第一个点：使用与下一个点的方向
      const dx = points[i + 1][0] - x;
      const dy = points[i + 1][1] - y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        normalX = -dy / len;
        normalY = dx / len;
      }
    } else if (i === points.length - 1) {
      // 最后一个点：使用与前一个点的方向
      const dx = x - points[i - 1][0];
      const dy = y - points[i - 1][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        normalX = -dy / len;
        normalY = dx / len;
      }
    } else {
      // 中间点：平均前后两个方向的法向量
      const dx1 = x - points[i - 1][0];
      const dy1 = y - points[i - 1][1];
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      
      const dx2 = points[i + 1][0] - x;
      const dy2 = points[i + 1][1] - y;
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      if (len1 > 0 && len2 > 0) {
        const n1x = -dy1 / len1;
        const n1y = dx1 / len1;
        const n2x = -dy2 / len2;
        const n2y = dx2 / len2;
        
        normalX = (n1x + n2x) / 2;
        normalY = (n1y + n2y) / 2;
        
        const nlen = Math.sqrt(normalX * normalX + normalY * normalY);
        if (nlen > 0) {
          normalX /= nlen;
          normalY /= nlen;
        }
      }
    }
    
    // 沿法向量两侧扩展
    leftSide.push([x + normalX * halfWidth, y + normalY * halfWidth, z]);
    rightSide.push([x - normalX * halfWidth, y - normalY * halfWidth, z]);
  }
  
  // 组合成闭合多边形：左侧正向 + 右侧反向
  return [...leftSide, ...rightSide.reverse()];
}

/**
 * 创建3D地图图层
 */
export function createMapLayers(props: MapLayer3DProps) {
  const { mapElements, layers } = props;
  const deckLayers = [];

  // 可驾驶区域（多边形，最底层）
  if (layers.drivable_area) {
    const drivableAreaElements = mapElements.filter(el => el.type === 'drivable_area');
    if (drivableAreaElements.length > 0) {
      deckLayers.push(
        new PolygonLayer({
          id: 'map-drivable-area',
          data: drivableAreaElements,
          getPolygon: (d: STCMapElement) => d.points,
          getFillColor: rgbaToArray(LAYER_STYLES.map.drivable_area.fill),
          getLineColor: rgbaToArray(LAYER_STYLES.map.drivable_area.stroke),
          getLineWidth: LAYER_STYLES.map.drivable_area.strokeWidth,
          filled: true,
          stroked: false,
          pickable: false,
        })
      );
    }
  }

  // 人行横道（多边形）
  if (layers.ped_crossing) {
    const pedCrossingElements = mapElements.filter(el => el.type === 'ped_crossing');
    if (pedCrossingElements.length > 0) {
      deckLayers.push(
        new PolygonLayer({
          id: 'map-ped-crossing',
          data: pedCrossingElements,
          getPolygon: (d: STCMapElement) => d.points,
          getFillColor: rgbaToArray(LAYER_STYLES.map.ped_crossing.fill),
          getLineColor: rgbaToArray(LAYER_STYLES.map.ped_crossing.stroke),
          getLineWidth: LAYER_STYLES.map.ped_crossing.strokeWidth,
          filled: true,
          stroked: true,
          pickable: false,
        })
      );
    }
  }

  // 车道分隔线（线段）
  if (layers.divider) {
    const dividerElements = mapElements.filter(el => el.type === 'divider');
    if (dividerElements.length > 0) {
      deckLayers.push(
        new PathLayer({
          id: 'map-divider',
          data: dividerElements,
          getPath: (d: STCMapElement) => d.points,
          getColor: rgbaToArray(LAYER_STYLES.map.divider.stroke),
          getWidth: LAYER_STYLES.map.divider.strokeWidth,
          widthUnits: 'pixels',
          pickable: false,
        })
      );
    }
  }

  // 道路边界（线段或立体）
  if (layers.boundary) {
    const boundaryElements = mapElements.filter(el => el.type === 'boundary');
    const boundaryMode = layers.boundaryMode || '2d';
    
    if (boundaryElements.length > 0) {
      if (boundaryMode === '3d') {
        // 3D模式：使用PolygonLayer创建立体边界
        const boundaryPolygons = boundaryElements.map(el => ({
          polygon: pathToPolygon(el.points, LAYER_STYLES.map.boundary.width3d),
        }));
        
        deckLayers.push(
          new PolygonLayer({
            id: 'map-boundary-3d',
            data: boundaryPolygons,
            getPolygon: (d: { polygon: [number, number, number][] }) => d.polygon,
            getFillColor: rgbaToArray(LAYER_STYLES.map.boundary.stroke),
            getLineColor: [0, 0, 0, 100],
            getLineWidth: 0.2,
            getElevation: LAYER_STYLES.map.boundary.height3d,
            filled: true,
            stroked: true,
            extruded: true,
            wireframe: false,
            pickable: false,
          })
        );
      } else {
        // 2D模式：使用PathLayer绘制线段
        deckLayers.push(
          new PathLayer({
            id: 'map-boundary-2d',
            data: boundaryElements,
            getPath: (d: STCMapElement) => d.points,
            getColor: rgbaToArray(LAYER_STYLES.map.boundary.stroke),
            getWidth: LAYER_STYLES.map.boundary.strokeWidth,
            widthUnits: 'pixels',
            pickable: false,
          })
        );
      }
    }
  }

  return deckLayers;
}

