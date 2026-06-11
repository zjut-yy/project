// 图片查看弹窗组件
// 用于显示点击的相机图片大图

import { useEffect, useRef } from 'react';
import type { STCCameraImage } from '../types';

interface ImageViewerModalProps {
  cameraImage: STCCameraImage | null;
  onClose: () => void;
}

export default function ImageViewerModal({ cameraImage, onClose }: ImageViewerModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // ESC键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (cameraImage) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [cameraImage, onClose]);

  if (!cameraImage) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '90vh',
          background: '#fff',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部信息 */}
        <div
          style={{
            padding: '12px 16px',
            background: '#f5f5f5',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: '20px', fontSize: '14px' }}>
            <span>
              <strong>相机:</strong> {cameraImage.channel}
            </span>
            <span>
              <strong>帧索引:</strong> {cameraImage.frameIndex}
            </span>
            <span>
              <strong>尺寸:</strong> {cameraImage.width} × {cameraImage.height}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 8px',
              color: '#666',
              lineHeight: '1',
            }}
            title="关闭 (ESC)"
          >
            ×
          </button>
        </div>

        {/* 图片内容 */}
        <div
          style={{
            maxWidth: '90vw',
            maxHeight: 'calc(90vh - 50px)',
            overflow: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
          }}
        >
          {cameraImage.imageUrl ? (
            <img
              src={cameraImage.imageUrl}
              alt={`${cameraImage.channel} - Frame ${cameraImage.frameIndex}`}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                padding: '40px',
                color: '#999',
                fontSize: '16px',
              }}
            >
              图片加载中...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

