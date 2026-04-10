// 通用属性墙图层组件
// 使用 SimpleMeshLayer 绘制连续的渐变网格墙，支持任意数量的属性分区
// 使用 PathLayer 绘制分隔线和竖线（从墙顶到地面）
// 使用 TextLayer 绘制属性名称标签

import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { PathLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { AttributeWallNode, AttributeWallConfig } from '../types';
import { Geometry } from '@luma.gl/engine';

interface AttributeWallLayerProps {
  /** 节点数据 */
  nodes?: AttributeWallNode[];
  /** 城墙配置 */
  config: AttributeWallConfig;
  /** 是否启用拾取 */
  pickable?: boolean;
  /** 图层 ID 前缀 */
  layerIdPrefix?: string;
}

/**
 * 创建通用属性墙图层
 */
export function createAttributeWallLayers(props: AttributeWallLayerProps): Layer[] {
  const {
    nodes = [],
    config,
    pickable = false,
    layerIdPrefix = 'attribute-wall',
  } = props;

  const deckLayers: Layer[] = [];

  // 如果没有 nodes，返回空
  if (nodes.length < 2) {
    return deckLayers;
  }

  const {
    height,
    baseHeight,
    bands,
    showSeparators = true,
    showVerticalLines = true,
    showLabels = true,
    verticalLineColor = [200, 200, 200, 180],
    verticalLineWidth = 0.8,
    separatorColor = [255, 255, 255, 200],
    separatorWidth = 1,
  } = config;

  // 过滤出需要显示的 bands
  const visibleBands = bands.filter((band) => band.show);

  if (visibleBands.length === 0) {
    return deckLayers;
  }

  // 计算每个 band 的 z 偏移和高度
  const bandConfigs = visibleBands.map((band, index) => {
    // 计算前面所有 band 的总高度占比
    const prevHeightRatio = visibleBands
      .slice(0, index)
      .reduce((sum, b) => sum + b.heightRatio, 0);

    const bandHeight = height * band.heightRatio;
    const zOffset = height * prevHeightRatio;

    return {
      band,
      height: bandHeight,
      zOffset,
    };
  });

  // 为每个 band 创建网格数据
  const bandMeshData = bandConfigs.map((bandConfig) => ({
    bandId: bandConfig.band.id,
    positions: [] as number[],
    colors: [] as number[],
    indices: [] as number[],
  }));

  // 分隔线路径数据（多条分隔线）
  const separatorPaths: [number, number, number][][] = [];

  // 竖线路径数据（从墙顶到地面 z=0）
  const verticalLines: [number, number, number][][] = [];

  // 文本标签数据
  const textLabels: Array<{
    position: [number, number, number];
    text: string;
  }> = [];

  // 遍历所有节点，构建网格和线条
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    const x = node.position[0];
    const y = node.position[1];
    const baseZ = node.position[2] + baseHeight;

    // 为每个 band 添加顶点
    bandConfigs.forEach((bandConfig, bandIndex) => {
      const { band, height: bandHeight, zOffset } = bandConfig;
      const meshData = bandMeshData[bandIndex];

      const bandBaseZ = baseZ + zOffset;
      const bandTopZ = baseZ + zOffset + bandHeight;

      // 添加两个顶点：底部和顶部
      meshData.positions.push(x, y, bandBaseZ); // 偶数索引
      meshData.positions.push(x, y, bandTopZ); // 奇数索引

      // 获取颜色
      const attribute = node.attributes[band.id];
      const color = attribute ? attribute.color : [128, 128, 128, 255];

      // 两个顶点共用颜色
      meshData.colors.push(color[0], color[1], color[2], color[3]);
      meshData.colors.push(color[0], color[1], color[2], color[3]);

      // 构建索引（连接 i 和 i-1）
      if (i > 0) {
        const currBase = i * 2;
        const prevBase = (i - 1) * 2;

        // 构建两个三角形形成一个矩形面
        // Tri 1: prevBase, currBase, prevBase+1
        meshData.indices.push(prevBase, currBase, prevBase + 1);
        // Tri 2: prevBase+1, currBase, currBase+1
        meshData.indices.push(prevBase + 1, currBase, currBase + 1);
      }

      // 记录分隔线路径（在每个 band 的顶部，除了最后一个 band）
      if (bandIndex < bandConfigs.length - 1) {
        // 为每条分隔线初始化路径
        if (i === 0) {
          separatorPaths[bandIndex] = [];
        }
        separatorPaths[bandIndex].push([x, y, bandTopZ]);
      }
    });

    // 绘制竖线（从墙顶到地面 z=0）
    const wallTopZ = baseZ + height;
    const verticalLine: [number, number, number][] = [
      [x, y, 0], // 地面
      [x, y, wallTopZ], // 墙顶
    ];
    verticalLines.push(verticalLine);

    // 在起点处添加文本标签
    if (i === 0) {
      bandConfigs.forEach((bandConfig) => {
        const { band, height: bandHeight, zOffset } = bandConfig;
        const labelZ = baseZ + zOffset + bandHeight * 0.5; // 中间位置
        textLabels.push({
          position: [x, y, labelZ],
          text: band.label,
        });
      });
    }
  }

  // 创建网格图层（每个 band 一个）
  bandMeshData.forEach((meshData) => {
    if (meshData.positions.length === 0) return;

    deckLayers.push(
      new SimpleMeshLayer({
        id: `${layerIdPrefix}-mesh-${meshData.bandId}`,
        data: [1],
        mesh: new Geometry({
          attributes: {
            positions: new Float32Array(meshData.positions),
            colors: {
              size: 4,
              value: new Uint8Array(meshData.colors),
              normalized: true,
            },
          },
          indices: { size: 1, value: new Uint32Array(meshData.indices) },
          topology: 'triangle-list',
        }),
        getColor: [255, 255, 255], // 使用顶点颜色
        parameters: {
          depthTest: true,
          cull: false, // 禁用剔除，使双面可见
        },
        pickable,
      })
    );
  });

  // 创建分隔线图层
  if (showSeparators && separatorPaths.length > 0) {
    deckLayers.push(
      new PathLayer({
        id: `${layerIdPrefix}-separators`,
        data: separatorPaths,
        getPath: (d) => d,
        getColor: separatorColor,
        widthScale: 1,
        widthMinPixels: 2,
        getWidth: separatorWidth,
        parameters: {
          depthTest: true,
        },
      })
    );
  }

  // 创建竖线图层（从墙顶到地面）
  if (showVerticalLines && verticalLines.length > 0) {
    deckLayers.push(
      new PathLayer({
        id: `${layerIdPrefix}-vertical-lines`,
        data: verticalLines,
        getPath: (d) => d,
        getColor: verticalLineColor,
        widthScale: 1,
        widthMinPixels: 1,
        getWidth: verticalLineWidth,
        billboard: true,
        parameters: {
          depthTest: true,
        },
      })
    );
  }

  // 创建文本标签图层
  if (showLabels && textLabels.length > 0) {
    deckLayers.push(
      new TextLayer({
        id: `${layerIdPrefix}-labels`,
        data: textLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: [0, 0, 0, 255], // 黑色文本
        getSize: 16,
        getAngle: 0,
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        parameters: {
          depthTest: true,
        },
      })
    );
  }

  return deckLayers;
}

