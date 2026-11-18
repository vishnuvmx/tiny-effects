import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { applyToneByte, clampByte } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface RgbSplitParams extends ParamMap {
  mode: string;
  amount: number;
  angle: number;
  redX: number;
  redY: number;
  blueX: number;
  blueY: number;
  contrast: number;
}

export const rgbSplitEffect: EffectDefinition<RgbSplitParams> = {
  id: 'rgb-split',
  name: 'RGB Split',
  category: 'distort',
  supportsSvg: false,
  defaults: {
    mode: 'angle',
    amount: 12,
    angle: 25,
    redX: 10,
    redY: -4,
    blueX: -10,
    blueY: 4,
    contrast: 10,
  },
  schema: [
    {
      key: 'mode',
      label: 'Mode',
      section: 'Chromatic Split',
      type: 'segmented',
      defaultValue: 'angle',
      options: [
        { value: 'angle', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
        { value: 'manual', label: 'XY' },
      ],
    },
    {
      key: 'amount',
      label: 'Distance',
      section: 'Chromatic Split',
      type: 'slider',
      min: 0,
      max: 64,
      step: 1,
      unit: 'px',
      defaultValue: 12,
      showWhen: (p) => p.mode !== 'manual',
    },
    {
      key: 'angle',
      label: 'Angle',
      section: 'Chromatic Split',
      type: 'slider',
      min: 0,
      max: 360,
      step: 1,
      unit: '°',
      defaultValue: 25,
      showWhen: (p) => p.mode === 'angle',
    },
    {
      key: 'redX',
      label: 'Red X',
      section: 'Chromatic Split',
      type: 'slider',
      min: -48,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: 10,
      showWhen: (p) => p.mode === 'manual',
    },
    {
      key: 'redY',
      label: 'Red Y',
      section: 'Chromatic Split',
      type: 'slider',
      min: -48,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: -4,
      showWhen: (p) => p.mode === 'manual',
    },
    {
      key: 'blueX',
      label: 'Blue X',
      section: 'Chromatic Split',
      type: 'slider',
      min: -48,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: -10,
      showWhen: (p) => p.mode === 'manual',
    },
    {
      key: 'blueY',
      label: 'Blue Y',
      section: 'Chromatic Split',
      type: 'slider',
      min: -48,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: 4,
      showWhen: (p) => p.mode === 'manual',
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone',
      type: 'slider',
      min: -60,
      max: 60,
      step: 1,
      defaultValue: 10,
    },
  ],

  renderRaster(source: PixelBuffer, params: RgbSplitParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const rad = (params.angle * Math.PI) / 180;
    const dxLin = Math.cos(rad) * params.amount;
    const dyLin = Math.sin(rad) * params.amount;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const invMaxDist = 1 / Math.max(1, Math.hypot(cx, cy));

    const sampleCh = (x: number, y: number, ch: number): number => {
      const ix = x < 0 ? 0 : x >= width ? width - 1 : x | 0;
      const iy = y < 0 ? 0 : y >= height ? height - 1 : y | 0;
      return data[((iy * width + ix) << 2) + ch] ?? 0;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let rx = x;
        let ry = y;
        let bx = x;
        let by = y;

        if (params.mode === 'radial') {
          const vx = x - cx;
          const vy = y - cy;
          const factor = Math.hypot(vx, vy) * invMaxDist * params.amount * 0.08;
          rx = x - vx * factor;
          ry = y - vy * factor;
          bx = x + vx * factor;
          by = y + vy * factor;
        } else if (params.mode === 'manual') {
          rx = x - params.redX;
          ry = y - params.redY;
          bx = x - params.blueX;
          by = y - params.blueY;
        } else {
          rx = x - dxLin;
          ry = y - dyLin;
          bx = x + dxLin;
          by = y + dyLin;
        }

        const r = applyToneByte(sampleCh(rx, ry, 0), 0, params.contrast);
        const g = applyToneByte(sampleCh(x, y, 1), 0, params.contrast);
        const b = applyToneByte(sampleCh(bx, by, 2), 0, params.contrast);

        const dstIdx = (y * width + x) << 2;
        out[dstIdx] = clampByte(r);
        out[dstIdx + 1] = clampByte(g);
        out[dstIdx + 2] = clampByte(b);
        out[dstIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: RgbSplitParams, seed: number): RgbSplitParams {
    const rng = createPrng(seed);
    return {
      ...current,
      mode: randPick(rng, ['angle', 'radial', 'manual']),
      amount: randInt(rng, 6, 32),
      angle: randInt(rng, 0, 359),
      redX: randInt(rng, -24, 24),
      redY: randInt(rng, -16, 16),
      blueX: randInt(rng, -24, 24),
      blueY: randInt(rng, -16, 16),
    };
  },
};
