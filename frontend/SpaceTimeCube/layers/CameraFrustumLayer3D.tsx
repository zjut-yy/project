// 3D相机视锥体图层组件
// 使用LineLayer绘制相机视锥体

import { LineLayer } from '@deck.gl/layers';
import type { STCCameraFrustum } from '../types';
import { CAMERA_FRUSTUM_CONFIG, rgbaToArray } from '../config';

interface CameraFrustumLayer3DProps {
  cameraFrustums: STCCameraFrustum[];
}

/**
 * 创建3D相机视锥体图层
 */
export function createCameraFrustumLayers(props: CameraFrustumLayer3DProps) {
  const { cameraFrustums } = props;
  const deckLayers: LineLayer<any>[] = [];

  if (cameraFrustums.length === 0) {
    return deckLayers;
  }

  // 为每个相机创建视锥体图层
  cameraFrustums.forEach((frustum) => {
    // 获取该相机通道的颜色
    const colorString = CAMERA_FRUSTUM_CONFIG.COLORS[frustum.channel] || 
                       CAMERA_FRUSTUM_CONFIG.COLORS['CAM_FRONT'];
    const color = rgbaToArray(colorString);

    // 将所有线段展平为LineLayer的数据格式
    const lineData = frustum.lines.map((line, index) => ({
      id: `${frustum.channel}-${frustum.frameIndex}-line-${index}`,
      sourcePosition: line[0],
      targetPosition: line[1],
    }));

    deckLayers.push(
      new LineLayer({
        id: `camera-frustum-${frustum.channel}-${frustum.frameIndex}`,
        data: lineData,
        getSourcePosition: (d: any) => d.sourcePosition,
        getTargetPosition: (d: any) => d.targetPosition,
        getColor: color,
        getWidth: CAMERA_FRUSTUM_CONFIG.LINE_WIDTH,
        widthUnits: 'pixels',
        pickable: false,
        parameters: {
          depthTest: true,
        },
      })
    );
  });

  return deckLayers;
}

