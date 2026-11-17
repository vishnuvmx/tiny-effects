import { EffectId, ParamMap, PixelBuffer } from '../shared/types';
import { getEffectById } from './effects';

export interface WorkerRenderRequest {
  requestId: number;
  effectId: EffectId;
  params: ParamMap;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface WorkerRenderResponse {
  requestId: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  durationMs: number;
}

self.onmessage = (event: MessageEvent<WorkerRenderRequest>) => {
  const { requestId, effectId, params, width, height, data } = event.data;
  const start = performance.now();
  const effect = getEffectById(effectId);
  const source: PixelBuffer = { data, width, height };
  const result = effect.renderRaster(source, params);
  const durationMs = Math.round(performance.now() - start);

  const response: WorkerRenderResponse = {
    requestId,
    width: result.width,
    height: result.height,
    data: result.data,
    durationMs,
  };

  self.postMessage(response, { transfer: [response.data.buffer] });
};

