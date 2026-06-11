// SpaceTimeCube 时空立方体3D可视化主组件

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { OrbitView } from '@deck.gl/core';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFrameRange } from '@/store/slices/playbackSlice';
import {
  useSTCTrajectoryPoints,
  useSTCMapData,
  useSceneBounds,
  useSTCCurrentFrameObjects,
  useSTCObjectTracks,
} from './hooks/useSTCData';
import { useSTCCurrentFramePredictions } from './hooks/useSTCPredictionObjects';
import { useObjectErrorMapping } from './hooks/useObjectErrorMapping';
import { useCameraImages } from './hooks/useCameraImages';
import { useLoadCameraImagesWithPreload, useLoadFrontCameraImagesAll } from './hooks/useLoadCameraImages';
import { useCameraFrustums } from './hooks/useCameraFrustums';
import { useEgoStateWall } from './hooks/useEgoStateWall';
import { useMetricsWall } from './hooks/useMetricsWall';
import { useDetectionTimelineWall } from './hooks/useDetectionTimelineWall';
import { useDetectionTimelineData } from '@/components/DetectionTimeline/hooks/useDetectionTimelineData';
import { useFrontCameraWall } from './hooks/useFrontCameraWall';
import { useSelectedObjectTrack } from './hooks/useSelectedObjectTrack';
import { createMapLayers } from './layers/MapLayer3D';
import { createTrajectoryLayers } from './layers/TrajectoryLayer3D';
import { createCameraImagesLayers } from './layers/CameraImagesLayer3D';
import { createCameraFrustumLayers } from './layers/CameraFrustumLayer3D';
import { createObjectsLayers } from './layers/ObjectsLayer3D';
import { createPredictionObjectsLayers } from './layers/PredictionObjectsLayer3D';
import { createObjectTracksLayers } from './layers/ObjectTracksLayer3D';
import { createAttributeWallLayers } from './layers/AttributeWallLayer3D';
import { createFrontCameraWallLayers } from './layers/FrontCameraWallLayer3D';
import { createSelectedObjectTrackLayers } from './layers/SelectedObjectTrackLayer3D';
import { DEFAULT_LAYERS, CAMERA_CONFIG } from './config';
import type { STCLayers, STCCameraImage, ViewMode, DeckViewState } from './types';
import ImageViewerModal from './components/ImageViewerModal';
import EgoMetricsChart from '@/components/EgoMetrics';
import { calculateFPSCamera } from './utils/fpsCamera';
import { swapPointXY } from './utils/axisSwap';
import styles from './styles/SpaceTimeCube.module.css';

interface SpaceTimeCubeProps {
  /** 容器宽度 */
  width?: number;
  /** 容器高度 */
  height?: number;
  /** 初始图层配置 */
  initialLayers?: Partial<STCLayers>;
  /** 是否显示控制面板 */
  showControls?: boolean;
}

export default function SpaceTimeCube({
  width = 600,
  height = 500,
  initialLayers,
  showControls = true,
}: SpaceTimeCubeProps) {
  const dispatch = useAppDispatch();
  
  // 状态管理
  const [layers, setLayers] = useState<STCLayers>({
    ...DEFAULT_LAYERS,
    ...initialLayers,
  });
  const [viewMode, setViewMode] = useState<ViewMode>('2d'); // 视角模式：2d/3d/fps
  const [viewState, setViewState] = useState<DeckViewState | null>(null); // 追踪当前视图状态
  const [isReady, setIsReady] = useState(false); // WebGL准备状态
  const updateTimerRef = useRef<number | null>(null); // 用于节流更新
  const [selectedCameraImage, setSelectedCameraImage] = useState<STCCameraImage | null>(null); // 选中的相机图片
  const [showEgoMetrics, setShowEgoMetrics] = useState(false); // 是否显示自车状态图表


  // 从Redux store获取数据
  const sceneMetadata = useAppSelector((state) => state.currentScene.metadata);
  const staticMap = useAppSelector((state) => state.currentScene.staticMap);
  const gtStream = useAppSelector((state) => state.currentScene.gtStream);
  const predictionStream = useAppSelector((state) => state.currentScene.predictionStream);
  const associations = useAppSelector((state) => state.currentScene.associations);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);
  
  // 从gtStream提取轨迹点数据
  const trajectoryPoints = useMemo(() => {
    if (!gtStream?.frames) return [];
    return gtStream.frames.map((frame, index) => ({
      index,
      timestamp: frame.timestamp,
      position: [frame.ego_pose.translation[0], frame.ego_pose.translation[1],frame.ego_pose.translation[2]] as [number, number, number],
      heading: 0, // 从四元数计算heading（暂时设为0，在hooks中处理）
    }));
  }, [gtStream]);

  // 转换为3D数据
  const stcTrajectoryPoints = useSTCTrajectoryPoints(trajectoryPoints);
  const stcMapElements = useSTCMapData(staticMap);
  
  // 对象数据
  const stcCurrentFrameObjects = useSTCCurrentFrameObjects(gtStream, currentFrameIndex);
  const stcObjectTracks = useSTCObjectTracks(gtStream);
  
  // 预测对象数据
  const stcPredictionObjects = useSTCCurrentFramePredictions(predictionStream, currentFrameIndex);
  
  // 对象误差映射
  const errorMapping = useObjectErrorMapping(associations, currentFrameIndex);
  
  // 自动加载当前帧及附近帧的相机图片
  useLoadCameraImagesWithPreload(2);
  // 加载所有帧的前视相机图片（用于前视相机墙）
  useLoadFrontCameraImagesAll();
  const stcCameraImages = useCameraImages();
  const stcCameraFrustums = useCameraFrustums();

  // 自车状态墙数据
  const egoStateWall = useEgoStateWall({
    sceneMetadata,
    trajectoryPoints: stcTrajectoryPoints,
  });

  // 指标墙数据
  const metricsWall = useMetricsWall({
    trajectoryPoints: stcTrajectoryPoints,
  });

  // 检测时间线数据
  const { objectLifelines } = useDetectionTimelineData();

  // 检测时间线墙数据
  const detectionTimelineWall = useDetectionTimelineWall({
    objectLifelines,
    trajectoryPoints: stcTrajectoryPoints,
  });

  // 前视相机墙数据
  const frontCameraWall = useFrontCameraWall(layers.frontCameraWall);

  // 选中对象轨迹数据（当前帧的GT和预测立方体）
  const selectedObjectTrack = useSelectedObjectTrack();

  // 计算场景边界
  const sceneBounds = useSceneBounds(stcTrajectoryPoints);

  // 计算初始视图中心
  const initialViewState = useMemo<DeckViewState>(() => {
    let baseConfig;
    
    // 根据视角模式选择基础配置
    if (viewMode === 'fps') {
      baseConfig = CAMERA_CONFIG.VIEW_FPS;
    } else if (viewMode === '3d') {
      baseConfig = CAMERA_CONFIG.VIEW_3D;
    } else {
      baseConfig = CAMERA_CONFIG.VIEW_2D;
    }
    
    // 获取当前帧的自车位置
    const currentFrame = gtStream?.frames?.[currentFrameIndex];
    
    // 第一视角模式：使用当前帧的自车位置并计算相机朝向
    if (viewMode === 'fps' && currentFrame?.ego_pose) {
      const fpsCamera = calculateFPSCamera(
        currentFrame.ego_pose.translation,
        currentFrame.ego_pose.rotation,
        CAMERA_CONFIG.VIEW_FPS.heightOffset,
        CAMERA_CONFIG.VIEW_FPS.forwardOffset
      );
      return {
        ...baseConfig,
        target: fpsCamera.target,
        rotationX: fpsCamera.rotationX,
        rotationOrbit: fpsCamera.rotationOrbit,
      };
    }
    
    // 2D/3D模式：使用当前帧的自车位置作为中心
    if (currentFrame?.ego_pose) {
      const [x, y, z] = currentFrame.ego_pose.translation;
      return {
        ...baseConfig,
        target: swapPointXY([x, y, z]),
      };
    }
    
    // Fallback：使用场景边界中心
    if (sceneBounds) {
      const centerX = (sceneBounds.minX + sceneBounds.maxX) / 2;
      const centerY = (sceneBounds.minY + sceneBounds.maxY) / 2;
      const centerZ = (sceneBounds.minZ + sceneBounds.maxZ) / 2;
      return {
        ...baseConfig,
        target: [centerX, centerY, centerZ] as [number, number, number],
      };
    }

    return baseConfig;
  }, [sceneBounds, viewMode, gtStream, currentFrameIndex]);

  // 自定义控制器配置：根据视角模式决定是否允许交互
  const customController = useMemo(() => {
    if (viewMode === 'fps') return CAMERA_CONFIG.CONTROLLER_FPS;
    if (viewMode === '3d') return CAMERA_CONFIG.CONTROLLER_3D;
    return CAMERA_CONFIG.CONTROLLER_2D;
  }, [viewMode]);

  // 处理视图状态变化（使用requestAnimationFrame避免渲染期间setState）
  const handleViewStateChange = useCallback(({ viewState: newViewState }: { viewState: DeckViewState }) => {
    // 第一视角模式下不响应手动视图变化
    if (viewMode === 'fps') return;
    
    // 清除之前的定时器
    if (updateTimerRef.current !== null) {
      cancelAnimationFrame(updateTimerRef.current);
    }
    
    // 使用requestAnimationFrame在下一帧更新状态
    updateTimerRef.current = requestAnimationFrame(() => {
      setViewState(newViewState as DeckViewState);
      updateTimerRef.current = null;
    });
  }, [viewMode]);

  // 清理：组件卸载时取消pending的动画帧
  useEffect(() => {
    return () => {
      if (updateTimerRef.current !== null) {
        cancelAnimationFrame(updateTimerRef.current);
      }
    };
  }, []);

  // 延迟初始化WebGL，避免上下文初始化错误
  useEffect(() => {
    // 等待DOM准备好后再初始化DeckGL
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // 当场景元数据加载时，设置帧范围
  useEffect(() => {
    if (sceneMetadata?.frame_count) {
      dispatch(setFrameRange([0, sceneMetadata.frame_count - 1]));
    }
  }, [sceneMetadata?.frame_count, dispatch]);

  // 第一视角模式：监听帧变化，更新相机位置和朝向
  useEffect(() => {
    if (viewMode !== 'fps' || !gtStream?.frames) return;
    
    const currentFrame = gtStream.frames[currentFrameIndex];
    if (!currentFrame?.ego_pose) return;
    
    const fpsCamera = calculateFPSCamera(
      currentFrame.ego_pose.translation,
      currentFrame.ego_pose.rotation,
      CAMERA_CONFIG.VIEW_FPS.heightOffset,
      CAMERA_CONFIG.VIEW_FPS.forwardOffset
    );
    
    // 更新相机状态，包括位置和朝向
    setViewState({
      ...CAMERA_CONFIG.VIEW_FPS,
      target: fpsCamera.target,
      rotationX: fpsCamera.rotationX,
      rotationOrbit: fpsCamera.rotationOrbit,
      transitionDuration: CAMERA_CONFIG.VIEW_FPS.transitionDuration,
    });
  }, [viewMode, currentFrameIndex, gtStream]);

  // 2D/3D模式：监听帧变化，更新相机位置（跟随自车）
  useEffect(() => {
    if (viewMode === 'fps' || !gtStream?.frames) return;
    
    const currentFrame = gtStream.frames[currentFrameIndex];
    if (!currentFrame?.ego_pose) return;
    
    const [x, y, z] = currentFrame.ego_pose.translation;
    const baseConfig = viewMode === '3d' ? CAMERA_CONFIG.VIEW_3D : CAMERA_CONFIG.VIEW_2D;
    
    // 更新相机target，保持其他参数不变
    setViewState({
      ...baseConfig,
      target: swapPointXY([x, y, z]),
      transitionDuration: baseConfig.transitionDuration,
    });
  }, [viewMode, currentFrameIndex, gtStream]);

  // 创建图层
  const deckLayers = useMemo(() => {
    const allLayers = [];

    // 地图图层
    if (layers.map) {
      allLayers.push(...createMapLayers({
        mapElements: stcMapElements,
        layers: layers.map,
      }));
    }

    // 轨迹图层
    if (layers.trajectory) {
      allLayers.push(...createTrajectoryLayers({
        trajectoryPoints: stcTrajectoryPoints,
        showPoints: true,
      }));
    }

    // 对象图层
    if (layers.objects) {
      allLayers.push(...createObjectsLayers({
        objects: stcCurrentFrameObjects,
        showWireframe: true,
        showHeading: true,
        errorMode: layers.objectErrorMode,
        errorMapping: errorMapping,
      }));
    }

    // 预测对象图层
    if (layers.predictionObjects) {
      allLayers.push(...createPredictionObjectsLayers({
        objects: stcPredictionObjects,
        showWireframe: true,
        showHeading: true,
      }));
    }

    // 对象轨迹图层
    if (layers.objectTracks) {
      allLayers.push(...createObjectTracksLayers({
        tracks: stcObjectTracks,
        colorByCategory: true,
      }));
    }

    // 相机图片图层
    if (layers.cameraImages) {
      allLayers.push(...createCameraImagesLayers({
        cameraImages: stcCameraImages,
        onClickImage: (cameraImage) => setSelectedCameraImage(cameraImage),
      }));
    }

    // 相机视锥体图层
    if (layers.cameraFrustums) {
      allLayers.push(...createCameraFrustumLayers({
        cameraFrustums: stcCameraFrustums,
      }));
    }

    // 自车状态墙图层（使用通用属性墙）
    if (layers.egoStateWall) {
      allLayers.push(...createAttributeWallLayers({
        nodes: egoStateWall.nodes,
        config: egoStateWall.wallConfig,
        pickable: false,
        layerIdPrefix: 'ego-state-wall',
      }));
    }

    // 指标墙图层（使用通用属性墙）
    if (layers.metricsWall) {
      allLayers.push(...createAttributeWallLayers({
        nodes: metricsWall.nodes,
        config: metricsWall.wallConfig,
        pickable: false,
        layerIdPrefix: 'metrics-wall',
      }));
    }

    // 检测时间线墙图层（使用通用属性墙）
    if (layers.detectionTimelineWall) {
      allLayers.push(...createAttributeWallLayers({
        nodes: detectionTimelineWall.nodes,
        config: detectionTimelineWall.wallConfig,
        pickable: false,
        layerIdPrefix: 'detection-timeline-wall',
      }));
    }

    // 前视相机墙图层
    if (layers.frontCameraWall) {
      allLayers.push(...createFrontCameraWallLayers({
        nodes: frontCameraWall.nodes,
        connections: frontCameraWall.connections,
        config: frontCameraWall.config,
      }));
    }

    // 选中对象GT和预测立方体图层（始终在最上层）
    if (selectedObjectTrack) {
      allLayers.push(...createSelectedObjectTrackLayers({
        selectedTrack: selectedObjectTrack,
      }));
    }

    return allLayers;
  }, [layers, stcMapElements, stcTrajectoryPoints, stcCurrentFrameObjects, stcPredictionObjects, stcObjectTracks, stcCameraImages, stcCameraFrustums, egoStateWall.nodes, egoStateWall.wallConfig, metricsWall.nodes, metricsWall.wallConfig, detectionTimelineWall.nodes, detectionTimelineWall.wallConfig, frontCameraWall.nodes, frontCameraWall.connections, frontCameraWall.config, errorMapping, selectedObjectTrack]);

  // 图层切换处理
  const toggleLayer = (layer: keyof Omit<STCLayers, 'map'>) => {
    setLayers(prev => ({
      ...prev,
      [layer]: !prev[layer],
    }));
  };

  // 如果没有场景数据，显示提示
  if (!sceneMetadata) {
    return (
      <div className={styles.emptyState} style={{ width, height }}>
        <p className={styles.emptyStateText}>请选择一个场景</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* 控制面板 */}
      {showControls && (
        <div className={styles.controlPanel}>
          {/* 图层控制 */}
          <div className={styles.layerControls}>
            <span className={styles.layerLabel}>图层:</span>
            
            {/* <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.map.drivable_area}
                onChange={() => toggleMapLayer('drivable_area')}
              />
              <span>可驾驶区域</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.map.divider}
                onChange={() => toggleMapLayer('divider')}
              />
              <span>车道线</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.map.boundary}
                onChange={() => toggleMapLayer('boundary')}
              />
              <span>边界</span>
            </label> */}

            {/* {layers.map.boundary && (
              <select
                className={styles.boundaryModeSelect}
                value={layers.map.boundaryMode || '2d'}
                onChange={(e) => setBoundaryMode(e.target.value as '2d' | '3d')}
              >
                <option value="2d">2D</option>
                <option value="3d">3D</option>
              </select>
            )} */}

            {/* <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.trajectory}
                onChange={() => toggleLayer('trajectory')}
              />
              <span>轨迹</span>
            </label> */}

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.objects}
                onChange={() => toggleLayer('objects')}
              />
              <span>GT对象</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.objectErrorMode}
                onChange={() => toggleLayer('objectErrorMode')}
                disabled={!layers.objects}
              />
              <span>误差着色</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.predictionObjects}
                onChange={() => toggleLayer('predictionObjects')}
              />
              <span>预测对象</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.objectTracks}
                onChange={() => toggleLayer('objectTracks')}
              />
              <span>对象轨迹</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.cameraImages}
                onChange={() => toggleLayer('cameraImages')}
              />
              <span>相机图片</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.cameraFrustums}
                onChange={() => toggleLayer('cameraFrustums')}
              />
              <span>相机视锥</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.egoStateWall}
                onChange={() => toggleLayer('egoStateWall')}
              />
              <span>自车状态</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.metricsWall}
                onChange={() => toggleLayer('metricsWall')}
              />
              <span>指标</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.detectionTimelineWall}
                onChange={() => toggleLayer('detectionTimelineWall')}
              />
              <span>检测时间线</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={layers.frontCameraWall}
                onChange={() => toggleLayer('frontCameraWall')}
              />
              <span>前视相机墙</span>
            </label>

            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={showEgoMetrics}
                onChange={() => setShowEgoMetrics(!showEgoMetrics)}
              />
              <span>自车状态图表</span>
            </label>

          </div>
        </div>
      )}

      {/* 3D渲染区域 */}
      <div 
        className={styles.renderContainer}
        style={{ width, height }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {!isReady ? (
          <div className={styles.loadingOverlay}>
            初始化3D视图...
          </div>
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <DeckGL
            width={width}
            height={height}
            initialViewState={initialViewState as any}
            viewState={viewMode === 'fps' ? viewState as any : undefined}
            controller={customController}
            layers={deckLayers}
            views={[new OrbitView({ 
              orbitAxis: 'Z',
            })]}
            onViewStateChange={handleViewStateChange as any}
          />
        )}
        
        {/* 右上角：视角模式切换控件 */}
        <div className={styles.viewModeControl}>
          <select
            className={styles.viewModeSelect}
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as ViewMode)}
          >
            <option value="2d">bev</option>
            <option value="3d">3d</option>
            <option value="fps">fps</option>
          </select>
        </div>
      {/* 自车状态图表面板 */}
      {showEgoMetrics && (
        <div className={styles.egoMetricsPanel}>
          <EgoMetricsChart width={width} height={100} />
        </div>
      )}
        {/* 底部：播放控制条
        {frameTimestamps.length > 0 && (
          <div className={styles.playbackControlsContainer}>
            <PlaybackControls
              timestamps={frameTimestamps}
              width={width}
              height={40}
              fps={10}
            />
          </div>
        )} */}

      </div>



      {/* 图片查看弹窗 */}
      <ImageViewerModal
        cameraImage={selectedCameraImage}
        onClose={() => setSelectedCameraImage(null)}
      />
    </div>
  );
}

