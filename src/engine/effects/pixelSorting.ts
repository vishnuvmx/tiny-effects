import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface PixelSortingParams extends ParamMap {
  direction: string;
  sortBy: string;
  minThreshold: number;
  maxThreshold: number;
  maxSpan: number;
  jitter: number;
  reverse: boolean;
  seed: number;
}

function computeSortMetric(r: number, g: number, b: number, mode: string): number {
  if (mode === 'red') return r / 255;
  if (mode === 'saturation') {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }
  return rgbToLuma01(r, g, b);
}

export const pixelSortingEffect: EffectDefinition<PixelSortingParams> = {
  id: 'pixel-sorting',
  name: 'Pixel Sorting',
  category: 'distort',
  supportsSvg: false,
  defaults: {
    direction: 'horizontal',
    sortBy: 'luma',
    minThreshold: 22,
    maxThreshold: 82,
    maxSpan: 90,
    jitter: 25,
    reverse: false,
    seed: 404,
  },
  schema: [
    {
      key: 'direction',
      label: 'Direction',
      section: 'Sorting',
      type: 'segmented',
      defaultValue: 'horizontal',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
    },
    {
      key: 'sortBy',
      label: 'Key',
      section: 'Sorting',
      type: 'segmented',
      defaultValue: 'luma',
      options: [
        { value: 'luma', label: 'Luma' },
        { value: 'saturation', label: 'Sat' },
        { value: 'red', label: 'Red' },
      ],
    },
    {
      key: 'reverse',
      label: 'Reverse order',
      section: 'Sorting',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      key: 'minThreshold',
      label: 'Min threshold',
      section: 'Thresholds',
      type: 'slider',
      min: 0,
      max: 95,
      step: 1,
      unit: '%',
      defaultValue: 22,
    },
    {
      key: 'maxThreshold',
      label: 'Max threshold',
      section: 'Thresholds',
      type: 'slider',
      min: 5,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 82,
    },
    {
      key: 'maxSpan',
      label: 'Max span',
      section: 'Intervals',
      type: 'slider',
      min: 8,
      max: 300,
      step: 2,
      unit: 'px',
      defaultValue: 90,
    },
    {
      key: 'jitter',
      label: 'Span jitter',
      section: 'Intervals',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 25,
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'Intervals',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 404,
    },
  ],

  renderRaster(source: PixelBuffer, params: PixelSortingParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(data);
    const rng = createPrng(Math.round(params.seed));

    const low = Math.min(params.minThreshold, params.maxThreshold) / 100;
    const high = Math.max(params.minThreshold, params.maxThreshold) / 100;
    const baseMaxSpan = Math.max(4, Math.round(params.maxSpan));
    const jitter01 = params.jitter / 100;
    const isVert = params.direction === 'vertical';
    const outerCount = isVert ? width : height;
    const innerCount = isVert ? height : width;
    const dirSign = params.reverse ? -1 : 1;

    // Reusable buffers per scanline
    const packedLine = new Uint32Array(innerCount);
    const metricLine = new Float32Array(innerCount);
    const indices = new Int32Array(innerCount);

    for (let o = 0; o < outerCount; o++) {
      for (let i = 0; i < innerCount; i++) {
        const px = isVert ? o : i;
        const py = isVert ? i : o;
        const idx = (py * width + px) << 2;
        const r = out[idx] ?? 0;
        const g = out[idx + 1] ?? 0;
        const b = out[idx + 2] ?? 0;
        const a = out[idx + 3] ?? 255;
        packedLine[i] = (a << 24) | (b << 16) | (g << 8) | r;
        metricLine[i] = computeSortMetric(r, g, b, params.sortBy);
      }

      let cursor = 0;
      while (cursor < innerCount) {
        const m = metricLine[cursor] ?? 0;
        if (m < low || m > high) {
          cursor++;
          continue;
        }

        const spanJitter =
          1 + (rng() - 0.5) * jitter01 * 1.4;
        const spanLimit = Math.max(4, Math.round(baseMaxSpan * spanJitter));
        let end = cursor + 1;
        while (
          end < innerCount &&
          end - cursor < spanLimit &&
          (metricLine[end] ?? 0) >= low &&
          (metricLine[end] ?? 0) <= high
        ) {
          end++;
        }

        const spanLen = end - cursor;
        if (spanLen > 1) {
          for (let k = 0; k < spanLen; k++) {
            indices[k] = cursor + k;
          }
          const subIndices = indices.subarray(0, spanLen);
          subIndices.sort(
            (ia, ib) => ((metricLine[ia] ?? 0) - (metricLine[ib] ?? 0)) * dirSign
          );

          for (let k = 0; k < spanLen; k++) {
            const srcPos = subIndices[k] ?? cursor;
            const packed = packedLine[srcPos] ?? 0;
            const dstI = cursor + k;
            const px = isVert ? o : dstI;
            const py = isVert ? dstI : o;
            const dstIdx = (py * width + px) << 2;
            out[dstIdx] = packed & 255;
            out[dstIdx + 1] = (packed >>> 8) & 255;
            out[dstIdx + 2] = (packed >>> 16) & 255;
            out[dstIdx + 3] = (packed >>> 24) & 255;
          }
        }

        cursor = end;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: PixelSortingParams, seed: number): PixelSortingParams {
    const rng = createPrng(seed);
    const minT = randInt(rng, 10, 45);
    return {
      ...current,
      direction: randPick(rng, ['horizontal', 'vertical']),
      sortBy: randPick(rng, ['luma', 'saturation', 'red']),
      minThreshold: minT,
      maxThreshold: randInt(rng, minT + 25, 95),
      maxSpan: randInt(rng, 30, 180),
      reverse: rng() > 0.5,
      seed: randInt(rng, 1, 9999),
    };
  },
};
