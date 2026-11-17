import React, { useEffect, useRef, useState } from 'react';
import { PixelBuffer } from '../../shared/types';
import { Segmented } from '../components/Controls';
import { IconImageEmpty, IconRedo, IconUndo } from '../components/Icons';

interface PreviewPanelProps {
  sourceBuffer: PixelBuffer | null;
  resultBuffer: PixelBuffer | null;
  comparing: boolean;
  onToggleCompare: (comparing: boolean) => void;
  isProcessing: boolean;
  nodeName?: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  sourceBuffer,
  resultBuffer,
  comparing,
  onToggleCompare,
  isProcessing,
  nodeName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; px: number; py: number }>({
    x: 0,
    y: 0,
    px: 0,
    py: 0,
  });

  const activeBuffer = comparing ? sourceBuffer : resultBuffer ?? sourceBuffer;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeBuffer) return;
    if (canvas.width !== activeBuffer.width) {
      canvas.width = activeBuffer.width;
    }
    if (canvas.height !== activeBuffer.height) {
      canvas.height = activeBuffer.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = new ImageData(
      new Uint8ClampedArray(
        activeBuffer.data.buffer as ArrayBuffer,
        activeBuffer.data.byteOffset,
        activeBuffer.data.byteLength
      ),
      activeBuffer.width,
      activeBuffer.height
    );
    ctx.putImageData(imgData, 0, 0);
  }, [activeBuffer]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Use sourceBuffer dimensions for stable display sizing across fast/full passes
  const displayDimensions = (() => {
    const refBuf = sourceBuffer ?? activeBuffer;
    if (!refBuf) return { w: 0, h: 0 };
    const frameW = frameRef.current?.clientWidth ?? 274;
    const frameH = frameRef.current?.clientHeight ?? 188;
    const scale = Math.min(
      (frameW - 12) / refBuf.width,
      (frameH - 12) / refBuf.height
    );
    return {
      w: Math.round(refBuf.width * scale),
      h: Math.round(refBuf.height * scale),
    };
  })();

  return (
    <div className="te-preview-section">
      <div className="te-preview-toolbar">
        <div className="te-preview-title">
          <span>Preview</span>
          {nodeName && <span className="te-preview-meta">· {nodeName}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            className="te-icon-btn"
            title="Undo (Ctrl/Cmd+Z)"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <IconUndo />
          </button>
          <button
            type="button"
            className="te-icon-btn"
            title="Redo (Shift+Ctrl/Cmd+Z)"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <IconRedo />
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        className="te-preview-frame"
        onDoubleClick={resetView}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          setZoom((z) =>
            Math.max(0.25, Math.min(8, Math.round(z * factor * 100) / 100))
          );
        }}
        onMouseDown={(e) => {
          if (!activeBuffer) return;
          draggingRef.current = true;
          dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            px: pan.x,
            py: pan.y,
          };
          const handleMove = (me: MouseEvent) => {
            if (!draggingRef.current) return;
            setPan({
              x: dragStartRef.current.px + (me.clientX - dragStartRef.current.x),
              y: dragStartRef.current.py + (me.clientY - dragStartRef.current.y),
            });
          };
          const handleUp = () => {
            draggingRef.current = false;
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
          };
          window.addEventListener('mousemove', handleMove);
          window.addEventListener('mouseup', handleUp);
        }}
      >
        {isProcessing && <div className="te-preview-progress" />}

        {!activeBuffer ? (
          <div className="te-empty-state">
            <IconImageEmpty />
            <span>Select a layer with an image fill</span>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="te-preview-canvas"
            style={{
              width: displayDimensions.w,
              height: displayDimensions.h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          />
        )}
      </div>

      <div className="te-preview-controls">
        <div style={{ width: 148 }}>
          <Segmented
            options={[
              { value: 'original', label: 'Original', title: 'Hold \\ to compare' },
              { value: 'result', label: 'Result' },
            ]}
            value={comparing ? 'original' : 'result'}
            onChange={(v) => onToggleCompare(v === 'original')}
          />
        </div>
        <select
          className="te-select"
          style={{ width: 76 }}
          value={String(zoom)}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setZoom(val);
            if (val === 1) setPan({ x: 0, y: 0 });
          }}
        >
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
          <option value="4">400%</option>
        </select>
      </div>
    </div>
  );
};
