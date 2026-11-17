import { EffectId, ParamMap, PixelBuffer } from '../shared/types';
import { getEffectById } from './effects';
import type { WorkerRenderRequest, WorkerRenderResponse } from './worker';
import RenderWorker from './worker?worker&inline';

const MAX_EXPORT_DIMENSION = 4096;
const PREVIEW_MAX_EDGE = 380;
const INTERACTIVE_MAX_EDGE = 220;

export interface DecodedSourceImage {
  full: PixelBuffer;
  preview: PixelBuffer;
  interactive: PixelBuffer;
  wasDownscaled: boolean;
  originalWidth: number;
  originalHeight: number;
}

export function scalePixelBuffer(
  source: PixelBuffer,
  maxLongEdge: number
): PixelBuffer {
  const { width, height } = source;
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(source.data),
    };
  }

  const ratio = maxLongEdge / longEdge;
  const targetW = Math.max(1, Math.round(width * ratio));
  const targetH = Math.max(1, Math.round(height * ratio));
  const out = new Uint8ClampedArray(targetW * targetH * 4);

  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(height - 1, ((y * height) / targetH) | 0);
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(width - 1, ((x * width) / targetW) | 0);
      const srcIdx = (sy * width + sx) << 2;
      const dstIdx = (y * targetW + x) << 2;
      out[dstIdx] = source.data[srcIdx] ?? 0;
      out[dstIdx + 1] = source.data[srcIdx + 1] ?? 0;
      out[dstIdx + 2] = source.data[srcIdx + 2] ?? 0;
      out[dstIdx + 3] = source.data[srcIdx + 3] ?? 255;
    }
  }

  return { width: targetW, height: targetH, data: out };
}

export async function decodeImageBytes(bytes: Uint8Array): Promise<DecodedSourceImage> {
  const safeBytes = new Uint8Array(bytes.length);
  safeBytes.set(bytes);
  const blob = new Blob([safeBytes]);
  const bitmap = await createImageBitmap(blob);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;

  const longEdge = Math.max(originalWidth, originalHeight);
  const wasDownscaled = longEdge > MAX_EXPORT_DIMENSION;
  const scale = wasDownscaled ? MAX_EXPORT_DIMENSION / longEdge : 1;
  const fullW = Math.max(1, Math.round(originalWidth * scale));
  const fullH = Math.max(1, Math.round(originalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = fullW;
  canvas.height = fullH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not initialize 2D canvas context');
  }
  ctx.drawImage(bitmap, 0, 0, fullW, fullH);
  bitmap.close();

  const imgData = ctx.getImageData(0, 0, fullW, fullH);
  const full: PixelBuffer = {
    data: imgData.data,
    width: fullW,
    height: fullH,
  };

  const preview = scalePixelBuffer(full, PREVIEW_MAX_EDGE);
  const interactive = scalePixelBuffer(preview, INTERACTIVE_MAX_EDGE);

  return {
    full,
    preview,
    interactive,
    wasDownscaled,
    originalWidth,
    originalHeight,
  };
}

export async function pixelBufferToPngBytes(buffer: PixelBuffer): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create export canvas');
  }
  const imageData = new ImageData(
    new Uint8ClampedArray(buffer.data),
    buffer.width,
    buffer.height
  );
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) {
    throw new Error('Failed to encode PNG bytes');
  }
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Scales numerical spatial parameters proportionally so interactive, preview,
 * and full-res export look visually identical.
 */
export function scaleParamsForResolution(
  effectId: EffectId,
  params: ParamMap,
  scaleRatio: number
): ParamMap {
  if (Math.abs(scaleRatio - 1) < 0.02) {
    return params;
  }
  const scaled: ParamMap = { ...params };
  const scaleKey = (key: string, minVal = 1) => {
    const val = scaled[key];
    if (typeof val === 'number') {
      scaled[key] = Math.max(minVal, Math.round(val * scaleRatio * 100) / 100);
    }
  };

  switch (effectId) {
    case 'halftone':
      scaleKey('size', 0.5);
      scaleKey('spacing', 2);
      break;
    case 'dither':
      scaleKey('scale', 1);
      break;
    case 'pixelate':
      scaleKey('cellWidth', 2);
      scaleKey('cellHeight', 2);
      scaleKey('gap', 0);
      scaleKey('cornerRadius', 0);
      break;
    case 'glitch':
      scaleKey('redOffsetX', -200);
      scaleKey('redOffsetY', -200);
      scaleKey('blueOffsetX', -200);
      scaleKey('blueOffsetY', -200);
      scaleKey('maxShift', 0);
      scaleKey('scanlineSpacing', 2);
      break;
    case 'risograph':
      scaleKey('offsetX', -100);
      scaleKey('offsetY', -100);
      scaleKey('dotSpacing', 2);
      break;
    case 'stippling':
      scaleKey('minSize', 0.4);
      scaleKey('maxSize', 1.0);
      break;
    case 'crosshatch':
      scaleKey('spacing', 2);
      scaleKey('lineWeight', 0.4);
      break;
    case 'ascii':
      break;
  }
  return scaled;
}

export class RenderPipeline {
  private worker: Worker | null = null;
  private latestRequestId = 0;
  private rafId: number | null = null;
  private pendingResolve: ((
    res: { buffer: PixelBuffer; durationMs: number } | null
  ) => void) | null = null;

  constructor() {
    try {
      const w = new RenderWorker();
      w.onmessage = (event: MessageEvent<WorkerRenderResponse>) => {
        const { requestId, width, height, data, durationMs } = event.data;
        if (requestId !== this.latestRequestId) {
          return;
        }
        if (this.pendingResolve) {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          resolve({
            buffer: { data, width, height },
            durationMs,
          });
        }
      };
      w.onerror = () => {
        this.worker = null;
      };
      this.worker = w;
    } catch {
      this.worker = null;
    }
  }

  public renderBuffer(
    source: PixelBuffer,
    referencePreview: PixelBuffer,
    effectId: EffectId,
    params: ParamMap
  ): Promise<{ buffer: PixelBuffer; durationMs: number } | null> {
    const requestId = ++this.latestRequestId;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.pendingResolve) {
      this.pendingResolve(null);
      this.pendingResolve = null;
    }

    const scaleRatio =
      Math.max(source.width, source.height) /
      Math.max(1, Math.max(referencePreview.width, referencePreview.height));
    const effectiveParams = scaleParamsForResolution(effectId, params, scaleRatio);

    if (this.worker) {
      return new Promise((resolve) => {
        this.pendingResolve = resolve;
        const copy = new Uint8ClampedArray(source.data);
        const req: WorkerRenderRequest = {
          requestId,
          effectId,
          params: effectiveParams,
          width: source.width,
          height: source.height,
          data: copy,
        };
        this.worker?.postMessage(req, [copy.buffer]);
      });
    }

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (requestId !== this.latestRequestId) {
          resolve(null);
          return;
        }
        const start = performance.now();
        const effect = getEffectById(effectId);
        const buffer = effect.renderRaster(source, effectiveParams);
        const durationMs = Math.round(performance.now() - start);
        if (this.pendingResolve === resolve) {
          this.pendingResolve = null;
        }
        resolve({ buffer, durationMs });
      });
    });
  }

  public renderFullRaster(
    fullSource: PixelBuffer,
    previewSource: PixelBuffer,
    effectId: EffectId,
    params: ParamMap
  ): PixelBuffer {
    const scaleRatio =
      Math.max(fullSource.width, fullSource.height) /
      Math.max(1, Math.max(previewSource.width, previewSource.height));
    const scaledParams = scaleParamsForResolution(effectId, params, scaleRatio);
    const effect = getEffectById(effectId);
    return effect.renderRaster(fullSource, scaledParams);
  }

  public renderFullSvg(
    fullSource: PixelBuffer,
    previewSource: PixelBuffer,
    effectId: EffectId,
    params: ParamMap
  ): string {
    const effect = getEffectById(effectId);
    if (!effect.renderSvg) {
      throw new Error(`${effect.name} does not support SVG output`);
    }
    const svgSource = scalePixelBuffer(fullSource, 720);
    const scaleRatio =
      Math.max(svgSource.width, svgSource.height) /
      Math.max(1, Math.max(previewSource.width, previewSource.height));
    const scaledParams = scaleParamsForResolution(effectId, params, scaleRatio);
    return effect.renderSvg(svgSource, scaledParams);
  }

  public dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
