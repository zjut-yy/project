// 3D对象轨迹图层组件
// 绘制对象的时空轨迹线

import { PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { STCObjectTrack } from '../types';
import { LAYER_STYLES, getCategoryColor, rgbaToArray } from '../config';

interface ObjectTracksLayer3DProps {
  tracks: STCObjectTrack[];
  colorByCategory?: boolean; // 是否按类别着色
}

/**
 * 创建3D对象轨迹图层
 */
export function createObjectTracksLayers(props: ObjectTracksLayer3DProps) {
  const { tracks, colorByCategory = false } = props;
  const deckLayers: Layer[] = [];

  if (tracks.length === 0) {
    return deckLayers;
  }

  // 对象轨迹线
  deckLayers.push(
    new PathLayer({
      id: 'object-tracks',
      data: tracks,
      getPath: (d: STCObjectTrack) => d.positions,
      getColor: (d: STCObjectTrack) => {
        if (colorByCategory) {
          const categoryColorRgba = getCategoryColor(d.category);
          const categoryColor = rgbaToArray(categoryColorRgba);
          // 使用类别颜色但降低不透明度
          return [categoryColor[0], categoryColor[1], categoryColor[2], 100];
        }
        // 默认灰色半透明
        return rgbaToArray(LAYER_STYLES.objectTracks.stroke);
      },
      getWidth: LAYER_STYLES.objectTracks.strokeWidth,
      widthUnits: 'pixels',
      pickable: false,
    })
  );

  return deckLayers;
}

