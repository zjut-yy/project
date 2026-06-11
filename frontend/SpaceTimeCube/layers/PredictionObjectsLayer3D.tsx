// 3D预测对象图层组件
// 在3D空间中绘制预测对象（立方体box、边框和朝向箭头）
// 使用类别颜色 + 基于置信度的透明度

import { PolygonLayer, PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { STCPredictionObject, Point3D } from '../types';
import { getCategoryColor, RENDER_CONFIG, rgbaToArray } from '../config';

interface PredictionObjectsLayer3DProps {
  objects: STCPredictionObject[];
  showWireframe?: boolean;
  showHeading?: boolean;
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
  
  const localVertices: [number, number, number][] = [
    // 底面
    [-halfLength, -halfWidth, -halfHeight],
    [halfLength, -halfWidth, -halfHeight],
    [halfLength, halfWidth, -halfHeight],
    [-halfLength, halfWidth, -halfHeight],
    // 顶面
    [-halfLength, -halfWidth, halfHeight],
    [halfLength, -halfWidth, halfHeight],
    [halfLength, halfWidth, halfHeight],
    [-halfLength, halfWidth, halfHeight],
  ];
  
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
  const arrowLength = length * 0.5;
  const arrowHeightOffset = height/2;
  
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  
  const startX = centerX;
  const startY = centerY;
  const arrowZ = centerZ + arrowHeightOffset;
  
  const endX = startX + arrowLength * cosYaw;
  const endY = startY + arrowLength * sinYaw;

  return [[[startX, startY, arrowZ], [endX, endY, arrowZ]]];
}

interface PredictionObjectBoxData {
  object: STCPredictionObject;
  vertices: Point3D[];
  wireframe: Point3D[][];
  heading: Point3D[][];
  color: [number, number, number, number];
}

function preparePredictionObjectsData(objects: STCPredictionObject[]): PredictionObjectBoxData[] {
  return objects.map(obj => {
    const [x, y, z] = obj.position;
    const [width, length, height] = obj.size;
    const vertices = calculateBoxVertices(x, y, z, width, length, height, obj.heading);
    const wireframe = calculateBoxWireframe(vertices);
    const heading = calculateHeadingArrow(x, y, z, length, height, obj.heading);
    
    // 使用类别颜色 + 基于置信度的透明度
    const colorRgba = getCategoryColor(obj.category);
    const baseColor = rgbaToArray(colorRgba);
    const alpha = Math.round(obj.score * 255); // 置信度映射到透明度
    const color: [number, number, number, number] = [baseColor[0], baseColor[1], baseColor[2], alpha];
    
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
 * 创建3D预测对象图层
 */
export function createPredictionObjectsLayers(props: PredictionObjectsLayer3DProps): Layer[] {
  const { objects, showWireframe = true, showHeading = true } = props;
  const deckLayers: Layer[] = [];

  if (objects.length === 0) {
    return deckLayers;
  }

  const objectsData = preparePredictionObjectsData(objects);

  // 1. 绘制立方体box
  deckLayers.push(
    new PolygonLayer({
      id: 'prediction-objects-boxes',
      data: objectsData,
      getPolygon: (d: PredictionObjectBoxData) => {
        return [d.vertices[0], d.vertices[1], d.vertices[2], d.vertices[3]];
      },
      getElevation: (d: PredictionObjectBoxData) => d.object.size[2],
      getFillColor: (d: PredictionObjectBoxData) => d.color,
      getLineColor: [0, 0, 0, 0],
      getLineWidth: 0,
      extruded: true,
      wireframe: false,
      pickable: RENDER_CONFIG.PICKABLE,
      filled: true,
    })
  );

  // 2. 绘制边框线
  if (showWireframe) {
    const allWireframes: Array<{ path: Point3D[]; color: [number, number, number, number] }> = [];
    objectsData.forEach(d => {
      d.wireframe.forEach(edge => {
        allWireframes.push({
          path: edge,
          color: d.color,
        });
      });
    });

    deckLayers.push(
      new PathLayer({
        id: 'prediction-objects-wireframe',
        data: allWireframes,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: 1,
        widthUnits: 'pixels',
        pickable: false,
      })
    );
  }

  // 3. 绘制朝向箭头
  if (showHeading) {
    const allHeadings: Array<{ path: Point3D[]; color: [number, number, number, number] }> = [];
    objectsData.forEach(d => {
      d.heading.forEach(segment => {
        allHeadings.push({
          path: segment,
          color: d.color,
        });
      });
    });

    deckLayers.push(
      new PathLayer({
        id: 'prediction-objects-heading',
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
















