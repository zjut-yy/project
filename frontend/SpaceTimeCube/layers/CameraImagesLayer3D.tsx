// 3D相机图片图层组件
// 使用SimpleMeshLayer将相机图片显示为3D平面

import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { PlaneGeometry } from '@luma.gl/engine';
import type { STCCameraImage } from '../types';
import { CAMERA_IMAGE_CONFIG, LAYER_STYLES, rgbaToArray } from '../config';

interface CameraImagesLayer3DProps {
  cameraImages: STCCameraImage[];
  onClickImage?: (cameraImage: STCCameraImage) => void;
}

/**
 * 创建平面几何体
 * 使用真正的2D平面而非极薄立方体
 */
function createPlaneMesh(width: number, height: number) {
  return new PlaneGeometry({
    type: 'x,y',
    xlen: width,
    ylen: height,
    nx: 1,
    ny: 1,
    offset: 0
  } as any);
}

/**
 * 创建3D相机图片图层
 */
export function createCameraImagesLayers(props: CameraImagesLayer3DProps) {
  const { cameraImages, onClickImage } = props;
  const deckLayers: SimpleMeshLayer<STCCameraImage>[] = [];

  if (cameraImages.length === 0) {
    return deckLayers;
  }

  // 为每个相机图片创建一个SimpleMeshLayer
  cameraImages.forEach((cameraImage) => {
    // 只显示已加载图片的相机
    if (!cameraImage.imageUrl) {
      return;
    }

    const mesh = createPlaneMesh(cameraImage.planeWidth, cameraImage.planeHeight);

    deckLayers.push(
      new SimpleMeshLayer({
        id: `camera-image-${cameraImage.channel}-${cameraImage.frameIndex}`,
        data: [cameraImage],
        mesh,
        texture: cameraImage.imageUrl,
        getPosition: (d: STCCameraImage) => d.position,
        getOrientation: (d: STCCameraImage) => d.orientation,
        getColor: rgbaToArray(LAYER_STYLES.cameraImages.color),
        sizeScale: 1,
        pickable: CAMERA_IMAGE_CONFIG.PICKABLE,
        autoHighlight: true,
        highlightColor: rgbaToArray(LAYER_STYLES.cameraImages.highlightColor),
        onClick: (info: any) => {
          if (info.object && onClickImage) {
            onClickImage(info.object);
          }
        },
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

  return deckLayers;
}

