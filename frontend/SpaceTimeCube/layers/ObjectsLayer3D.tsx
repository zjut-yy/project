// 3D对象图层组件
// 在3D空间中绘制对象（立方体box、边框和朝向箭头）

import { PolygonLayer, PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { STCObject, Point3D } from '../types';
import { getCategoryColor, RENDER_CONFIG, rgbaToArray, getErrorBasedColor } from '../config';
import type { ObjectErrorInfo } from '../hooks/useObjectErrorMapping';

interface ObjectsLayer3DProps {
  objects: STCObject[];
  showWireframe?: boolean; // 是否显示边框
  showHeading?: boolean; // 是否显示朝向箭头
  errorMode?: boolean; // 是否启用误差着色模式
  errorMapping?: Map<string, ObjectErrorInfo>; // GT对象的误差映射
}

/**
 * 计算3D box的8个顶点坐标（考虑旋转）
 */
function calculateBoxVertices(
  centerX: number,
  centerY: number,
  centerZ: number,
  width: number,
  length: number,
  height: number,
  yaw: number
): Point3D[] {
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const halfHeight = height / 2;
  
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  
  // 定义局部坐标系下的8个顶点（未旋转）
  // 底面4个顶点（z = -halfHeight）
  // 顶面4个顶点（z = +halfHeight）
  const localVertices: [number, number, number][] = [
    // 底面
    [-halfLength, -halfWidth, -halfHeight], // 0: 后左
    [halfLength, -halfWidth, -halfHeight],  // 1: 前左
    [halfLength, halfWidth, -halfHeight],   // 2: 前右
    [-halfLength, halfWidth, -halfHeight],  // 3: 后右
    // 顶面
    [-halfLength, -halfWidth, halfHeight],  // 4: 后左
    [halfLength, -halfWidth, halfHeight],   // 5: 前左
    [halfLength, halfWidth, halfHeight],    // 6: 前右
    [-halfLength, halfWidth, halfHeight],   // 7: 后右
  ];
  
  // 应用旋转变换和平移
  return localVertices.map(([lx, ly, lz]) => {
    const rotatedX = lx * cosYaw - ly * sinYaw;
    const rotatedY = lx * sinYaw + ly * cosYaw;
    return [
      centerX + rotatedX,
      centerY + rotatedY,
      centerZ + lz
    ] as Point3D;
  });
}

/**
 * 计算box的边框路径（12条边）
 */
function calculateBoxWireframe(vertices: Point3D[]): Point3D[][] {
  return [
    // 底面4条边
    [vertices[0], vertices[1]],
    [vertices[1], vertices[2]],
    [vertices[2], vertices[3]],
    [vertices[3], vertices[0]],
    // 顶面4条边
    [vertices[4], vertices[5]],
    [vertices[5], vertices[6]],
    [vertices[6], vertices[7]],
    [vertices[7], vertices[4]],
    // 竖边4条
    [vertices[0], vertices[4]],
    [vertices[1], vertices[5]],
    [vertices[2], vertices[6]],
    [vertices[3], vertices[7]],
  ];
}

/**
 * 计算朝向箭头路径
 */
function calculateHeadingArrow(
  centerX: number,
  centerY: number,
  centerZ: number,
  length: number,
  height: number,
  yaw: number
): Point3D[][] {
  const arrowLength = length * 0.5; // 箭头长度为box长度的60%
  const arrowHeightOffset = height/2; // 箭头在box顶部上方
  
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  
  // 箭头起点（box中心）
  const startX = centerX;
  const startY = centerY;
  const arrowZ = centerZ + arrowHeightOffset;
  
  // 箭头终点（沿heading方向）
  const endX = startX + arrowLength * cosYaw;
  const endY = startY + arrowLength * sinYaw;

  return [[[startX, startY, arrowZ], [endX, endY, arrowZ]],];
}

/**
 * 为每个对象生成数据结构
 */
interface ObjectBoxData {
  object: STCObject;
  vertices: Point3D[];
  wireframe: Point3D[][];
  heading: Point3D[][];
  color: [number, number, number, number];
}

function prepareObjectsData(
  objects: STCObject[],
  errorMode = false,
  errorMapping?: Map<string, ObjectErrorInfo>
): ObjectBoxData[] {
  return objects.map(obj => {
    const [x, y, z] = obj.position;
    const [width, length, height] = obj.size;
    const vertices = calculateBoxVertices(x, y, z, width, length, height, obj.heading);
    const wireframe = calculateBoxWireframe(vertices);
    const heading = calculateHeadingArrow(x, y, z, length, height, obj.heading);
    
    let color: [number, number, number, number];
    
    // 根据模式选择颜色
    if (errorMode && errorMapping) {
      const errorInfo = errorMapping.get(obj.instance_id);
      color = getErrorBasedColor(errorInfo?.error, errorInfo?.isDetected ?? false);
    } else {
      const colorRgba = getCategoryColor(obj.category);
      color = rgbaToArray(colorRgba);
    }
    
    return {
      object: obj,
      vertices,
      wireframe,
      heading,
      color,
    };
  });
}

/**
 * 创建3D对象图层
 */
export function createObjectsLayers(props: ObjectsLayer3DProps): Layer[] {
  const { objects, showWireframe = true, showHeading = true, errorMode = false, errorMapping } = props;
  const deckLayers: Layer[] = [];

  if (objects.length === 0) {
    return deckLayers;
  }

  const objectsData = prepareObjectsData(objects, errorMode, errorMapping);

  // 1. 绘制立方体box（使用PolygonLayer的extruded模式）
  deckLayers.push(
    new PolygonLayer({
      id: 'objects-boxes',
      data: objectsData,
      getPolygon: (d: ObjectBoxData) => {
        // 底面4个顶点
        return [d.vertices[0], d.vertices[1], d.vertices[2], d.vertices[3]];
      },
      getElevation: (d: ObjectBoxData) => d.object.size[2], // height
      getFillColor: (d: ObjectBoxData) => {
        return [d.color[0], d.color[1], d.color[2], 255];
      },
      getLineColor: [0, 0, 0, 0],
      getLineWidth: 0,
      extruded: true,
      wireframe: false,
      pickable: RENDER_CONFIG.PICKABLE,
      filled: true,
    })
  );

  // 2. 绘制边框线（可选）
  if (showWireframe) {
    const allWireframes: Array<{ path: Point3D[]; color: [number, number, number, number] }> = [];
    objectsData.forEach(d => {
      d.wireframe.forEach(edge => {
        allWireframes.push({
          path: edge,
          color: [d.color[0], d.color[1], d.color[2], 255],
        });
      });
    });

    deckLayers.push(
      new PathLayer({
        id: 'objects-wireframe',
        data: allWireframes,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: 1,
        widthUnits: 'pixels',
        pickable: false,
      })
    );
  }

  // 3. 绘制朝向箭头（可选）
  if (showHeading) {
    const allHeadings: Array<{ path: Point3D[]; color: [number, number, number, number] }> = [];
    objectsData.forEach(d => {
      d.heading.forEach(segment => {
        allHeadings.push({
          path: segment,
          color: [d.color[0], d.color[1], d.color[2], 255],
        });
      });
    });

    deckLayers.push(
      new PathLayer({
        id: 'objects-heading',
        data: allHeadings,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: 1,
        widthUnits: 'pixels',
        pickable: false,
      })
    );
  }

  return deckLayers;
}
