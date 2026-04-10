// 相机图片加载 Hook
// 自动加载当前帧的相机图片到缓存

import { useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { cacheImage, addLoadingImage, removeLoadingImage, clearImageCache } from '@/store/slices/cameraSlice';
import { loadCameraImage } from '@/services/dataLoader';

/**
 * 自动加载相机图片的Hook
 * 监听当前帧变化，自动加载该帧的所有相机图片
 */
export function useLoadCameraImages() {
  const dispatch = useAppDispatch();
  const sceneName = useAppSelector((state) => state.currentScene.sceneName);
  const cameraStream = useAppSelector((state) => state.currentScene.cameraStream);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);
  const imageCache = useAppSelector((state) => state.camera.imageCache);
  const loadingImages = useAppSelector((state) => state.camera.loadingImages);

  // 使用 ref 追踪是否已经加载过
  const loadedFramesRef = useRef<Set<number>>(new Set());
  const lastSceneNameRef = useRef<string | null>(null);

  // 场景切换时清理缓存
  useEffect(() => {
    if (lastSceneNameRef.current !== null && lastSceneNameRef.current !== sceneName) {
      dispatch(clearImageCache());
      loadedFramesRef.current.clear();
    }
    lastSceneNameRef.current = sceneName;
  }, [sceneName, dispatch]);

  useEffect(() => {
    if (!sceneName || !cameraStream?.frames) return;

    const currentFrame = cameraStream.frames[currentFrameIndex];
    if (!currentFrame) return;

    // 如果该帧已经加载过，跳过
    if (loadedFramesRef.current.has(currentFrameIndex)) {
      return;
    }

    // 标记该帧正在加载
    loadedFramesRef.current.add(currentFrameIndex);

    // 加载当前帧的所有相机图片
    currentFrame.cameras.forEach(async (camera) => {
      const imagePath = camera.image_path;

      // 如果已经缓存或正在加载，跳过
      if (imageCache[imagePath] || loadingImages.includes(imagePath)) {
        return;
      }

      // 标记正在加载
      dispatch(addLoadingImage(imagePath));

      try {
        const imageUrl = await loadCameraImage(sceneName, camera.channel, currentFrameIndex);
        dispatch(cacheImage({ path: imagePath, url: imageUrl }));
      } catch (error) {
        console.error(`加载相机图片失败 (${camera.channel}, 帧 ${currentFrameIndex}):`, error);
      } finally {
        dispatch(removeLoadingImage(imagePath));
      }
    });
  }, [sceneName, cameraStream, currentFrameIndex, imageCache, loadingImages, dispatch]);
}

/**
 * 带预加载的相机图片加载Hook
 * @param preloadRange 预加载范围，前后帧数（如2表示预加载前后各2帧）
 */
export function useLoadCameraImagesWithPreload(preloadRange = 2) {
  const dispatch = useAppDispatch();
  const sceneName = useAppSelector((state) => state.currentScene.sceneName);
  const cameraStream = useAppSelector((state) => state.currentScene.cameraStream);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);
  const imageCache = useAppSelector((state) => state.camera.imageCache);
  const loadingImages = useAppSelector((state) => state.camera.loadingImages);

  // 使用 ref 追踪已加载的帧
  const loadedFramesRef = useRef<Set<number>>(new Set());
  const lastSceneNameRef = useRef<string | null>(null);

  // 场景切换时清理缓存
  useEffect(() => {
    if (lastSceneNameRef.current !== null && lastSceneNameRef.current !== sceneName) {
      dispatch(clearImageCache());
      loadedFramesRef.current.clear();
    }
    lastSceneNameRef.current = sceneName;
  }, [sceneName, dispatch]);

  useEffect(() => {
    if (!sceneName || !cameraStream?.frames) return;

    const totalFrames = cameraStream.frames.length;
    
    // 计算需要加载的帧范围
    const startFrame = Math.max(0, currentFrameIndex - preloadRange);
    const endFrame = Math.min(totalFrames - 1, currentFrameIndex + preloadRange);

    // 加载范围内的所有帧
    for (let frameIndex = startFrame; frameIndex <= endFrame; frameIndex++) {
      // 如果已经加载过，跳过
      if (loadedFramesRef.current.has(frameIndex)) {
        continue;
      }

      const frame = cameraStream.frames[frameIndex];
      if (!frame) continue;

      // 标记该帧正在加载
      loadedFramesRef.current.add(frameIndex);

      // 为当前帧加载图片时优先级更高
      const priority = frameIndex === currentFrameIndex ? 0 : Math.abs(frameIndex - currentFrameIndex);

      // 加载该帧的所有相机图片
      frame.cameras.forEach(async (camera) => {
        const imagePath = camera.image_path;

        // 如果已经缓存或正在加载，跳过
        if (imageCache[imagePath] || loadingImages.includes(imagePath)) {
          return;
        }

        // 对于预加载帧，添加短暂延迟，让当前帧优先
        if (priority > 0) {
          await new Promise(resolve => setTimeout(resolve, priority * 50));
        }

        // 标记正在加载
        dispatch(addLoadingImage(imagePath));

        try {
          const imageUrl = await loadCameraImage(sceneName, camera.channel, frameIndex);
          dispatch(cacheImage({ path: imagePath, url: imageUrl }));
        } catch (error) {
          console.error(`加载相机图片失败 (${camera.channel}, 帧 ${frameIndex}):`, error);
        } finally {
          dispatch(removeLoadingImage(imagePath));
        }
      });
    }
  }, [sceneName, cameraStream, currentFrameIndex, preloadRange, imageCache, loadingImages, dispatch]);
}

/**
 * 加载所有帧的前视相机图片
 * 用于前视相机墙功能
 */
export function useLoadFrontCameraImagesAll() {
  const dispatch = useAppDispatch();
  const sceneName = useAppSelector((state) => state.currentScene.sceneName);
  const cameraStream = useAppSelector((state) => state.currentScene.cameraStream);
  const currentFrameIndex = useAppSelector((state) => state.playback.currentFrameIndex);
  const imageCache = useAppSelector((state) => state.camera.imageCache);
  const loadingImages = useAppSelector((state) => state.camera.loadingImages);
  const frontCameraWallEnabled = useAppSelector((state) => 
    state.currentScene.metadata ? true : false // 简化判断，实际应该检查图层状态
  );

  // 使用 ref 追踪已加载的帧
  const loadedFramesRef = useRef<Set<number>>(new Set());
  const lastSceneNameRef = useRef<string | null>(null);
  const loadingQueueRef = useRef<number[]>([]);
  const isLoadingRef = useRef(false);

  // 场景切换时清理缓存
  useEffect(() => {
    if (lastSceneNameRef.current !== null && lastSceneNameRef.current !== sceneName) {
      dispatch(clearImageCache());
      loadedFramesRef.current.clear();
      loadingQueueRef.current = [];
    }
    lastSceneNameRef.current = sceneName;
  }, [sceneName, dispatch]);

  useEffect(() => {
    if (!sceneName || !cameraStream?.frames || !frontCameraWallEnabled) return;

    const totalFrames = cameraStream.frames.length;

    // 构建加载队列：优先加载当前帧附近的图片
    const queue: number[] = [];
    
    // 先加载当前帧
    queue.push(currentFrameIndex);
    
    // 然后按距离加载其他帧
    for (let distance = 1; distance < totalFrames; distance++) {
      const prevFrame = currentFrameIndex - distance;
      const nextFrame = currentFrameIndex + distance;
      
      if (prevFrame >= 0) {
        queue.push(prevFrame);
      }
      if (nextFrame < totalFrames) {
        queue.push(nextFrame);
      }
    }

    // 过滤已加载的帧
    loadingQueueRef.current = queue.filter(frameIndex => !loadedFramesRef.current.has(frameIndex));

    // 启动加载
    if (!isLoadingRef.current && loadingQueueRef.current.length > 0) {
      loadNextBatch();
    }

    async function loadNextBatch() {
      if (loadingQueueRef.current.length === 0) {
        isLoadingRef.current = false;
        return;
      }

      isLoadingRef.current = true;

      // 每批加载3帧
      const batchSize = 3;
      const batch = loadingQueueRef.current.splice(0, batchSize);

      await Promise.all(
        batch.map(async (frameIndex) => {
          const frame = cameraStream.frames[frameIndex];
          if (!frame) return;

          // 找到前视相机
          const frontCamera = frame.cameras.find(cam => cam.channel === 'CAM_FRONT');
          if (!frontCamera) return;

          const imagePath = frontCamera.image_path;

          // 如果已经缓存或正在加载，跳过
          if (imageCache[imagePath] || loadingImages.includes(imagePath)) {
            loadedFramesRef.current.add(frameIndex);
            return;
          }

          // 标记正在加载
          dispatch(addLoadingImage(imagePath));

          try {
            const imageUrl = await loadCameraImage(sceneName, frontCamera.channel, frameIndex);
            dispatch(cacheImage({ path: imagePath, url: imageUrl }));
            loadedFramesRef.current.add(frameIndex);
          } catch (error) {
            console.error(`加载前视相机图片失败 (帧 ${frameIndex}):`, error);
          } finally {
            dispatch(removeLoadingImage(imagePath));
          }
        })
      );

      // 继续加载下一批
      setTimeout(() => loadNextBatch(), 100);
    }
  }, [sceneName, cameraStream, currentFrameIndex, frontCameraWallEnabled, imageCache, loadingImages, dispatch]);
}

