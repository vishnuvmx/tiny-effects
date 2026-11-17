import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clampByte } from '../color';
import { createPrng, randInt } from '../prng';

export interface GlitchParams extends ParamMap {
  redOffsetX: number;
  redOffsetY: number;
  blueOffsetX: number;
  blueOffsetY: number;
  sliceCount: number;
  maxShift: number;
  blockCorruption: number;
  scanlineOpacity: number;
  scanlineSpacing: number;
  noise: number;
  seed: number;
}

export const glitchEffect: EffectDefinition<GlitchParams> = {
  id: 'glitch',
  name: 'Glitch',
  category: 'distort',
  supportsSvg: false,
  defaults: {
    redOffsetX: 8,
    redOffsetY: -2,
    blueOffsetX: -8,
    blueOffsetY: 2,
    sliceCount: 12,
    maxShift: 28,
    blockCorruption: 15,
    scanlineOpacity: 25,
    scanlineSpacing: 3,
    noise: 12,
    seed: 42,
  },
  schema: [
    {
      key: 'redOffsetX',
      label: 'Red X',
      section: 'RGB Split',
      type: 'slider',
      min: -48,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: 8,
    },
    {
      key: 'redOffsetY',
      label: 'Red Y',
      section: 'RGB Split',
      type: 'slider',
      min: -24,
      max: 24,
      step: 1,
      unit: 'px',
      defaultValue: -2,
    },
    {
      key: 'blueOffsetX',
      label: 'Blue X',
      section: 'RGB Split',
      type: 'slider',
      min: -48,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: -8,
    },
    {
      key: 'blueOffsetY',
      label: 'Blue Y',
      section: 'RGB Split',
      type: 'slider',
      min: -24,
      max: 24,
      step: 1,
      unit: 'px',
      defaultValue: 2,
    },
    {
      key: 'sliceCount',
      label: 'Slices',
      section: 'Displacement',
      type: 'slider',
      min: 0,
      max: 48,
      step: 1,
      defaultValue: 12,
    },
    {
      key: 'maxShift',
      label: 'Max shift',
      section: 'Displacement',
      type: 'slider',
      min: 0,
      max: 120,
      step: 1,
      unit: 'px',
      defaultValue: 28,
    },
    {
      key: 'blockCorruption',
      label: 'Blocks',
      section: 'Displacement',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 15,
    },
    {
      key: 'scanlineOpacity',
      label: 'Scanlines',
      section: 'CRT & Noise',
      type: 'slider',
      min: 0,
      max: 90,
      step: 1,
      unit: '%',
      defaultValue: 25,
    },
    {
      key: 'scanlineSpacing',
      label: 'Line gap',
      section: 'CRT & Noise',
      type: 'slider',
      min: 2,
      max: 10,
      step: 1,
      unit: 'px',
      defaultValue: 3,
    },
    {
      key: 'noise',
      label: 'Static',
      section: 'CRT & Noise',
      type: 'slider',
      min: 0,
      max: 80,
      step: 1,
      defaultValue: 12,
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'CRT & Noise',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 42,
    },
  ],

  renderRaster(source: PixelBuffer, params: GlitchParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const rng = createPrng(Math.round(params.seed));

    // Precompute horizontal slice shifts per row
    const rowShifts = new Int32Array(height);
    const numSlices = Math.max(0, Math.round(params.sliceCount));
    const maxShift = Math.round(params.maxShift);

    for (let s = 0; s < numSlices; s++) {
      const yStart = randInt(rng, 0, height - 1);
      const sliceH = randInt(rng, 2, Math.max(4, Math.floor(height * 0.12)));
      const shift = randInt(rng, -maxShift, maxShift);
      const yEnd = Math.min(height, yStart + sliceH);
      for (let y = yStart; y < yEnd; y++) {
        rowShifts[y] = (rowShifts[y] ?? 0) + shift;
      }
    }

    const rxOff = Math.round(params.redOffsetX);
    const ryOff = Math.round(params.redOffsetY);
    const bxOff = Math.round(params.blueOffsetX);
    const byOff = Math.round(params.blueOffsetY);

    const sampleClamped = (x: number, y: number, ch: number): number => {
      const cx = ((x % width) + width) % width;
      const cy = Math.max(0, Math.min(height - 1, y));
      return data[(cy * width + cx) * 4 + ch] ?? 0;
    };

    const scanFactor = 1 - Math.max(0, Math.min(0.95, params.scanlineOpacity / 100));
    const scanPeriod = Math.max(2, Math.round(params.scanlineSpacing));
    const noiseAmp = params.noise * 1.6;

    for (let y = 0; y < height; y++) {
      const shift = rowShifts[y] ?? 0;
      const isScanline = y % scanPeriod === 0;

      for (let x = 0; x < width; x++) {
        const sx = x + shift;
        let r = sampleClamped(sx - rxOff, y - ryOff, 0);
        let g = sampleClamped(sx, y, 1);
        let b = sampleClamped(sx - bxOff, y - byOff, 2);

        if (isScanline) {
          r *= scanFactor;
          g *= scanFactor;
          b *= scanFactor;
        }

        if (noiseAmp > 0) {
          const n = (rng() - 0.5) * noiseAmp;
          r += n;
          g += n;
          b += n;
        }

        const dstIdx = (y * width + x) * 4;
        out[dstIdx] = clampByte(r);
        out[dstIdx + 1] = clampByte(g);
        out[dstIdx + 2] = clampByte(b);
        out[dstIdx + 3] = 255;
      }
    }

    // Block corruption pass
    const blockCount = Math.floor((params.blockCorruption / 100) * 28);
    for (let i = 0; i < blockCount; i++) {
      const bw = randInt(rng, 8, Math.max(16, Math.floor(width * 0.25)));
      const bh = randInt(rng, 4, Math.max(8, Math.floor(height * 0.08)));
      const bx = randInt(rng, 0, Math.max(0, width - bw));
      const by = randInt(rng, 0, Math.max(0, height - bh));
      const srcX = randInt(rng, 0, Math.max(0, width - bw));
      const srcY = randInt(rng, 0, Math.max(0, height - bh));
      const mode = randInt(rng, 0, 2);

      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const dIdx = ((by + yy) * width + (bx + xx)) * 4;
          const sIdx = ((srcY + yy) * width + (srcX + xx)) * 4;
          if (mode === 0) {
            out[dIdx] = data[sIdx] ?? 0;
            out[dIdx + 1] = data[sIdx + 1] ?? 0;
          } else if (mode === 1) {
            out[dIdx + 1] = 255 - (out[dIdx + 1] ?? 0);
            out[dIdx + 2] = data[sIdx + 2] ?? 0;
          } else {
            out[dIdx] = data[sIdx + 2] ?? 0;
            out[dIdx + 2] = data[sIdx] ?? 0;
          }
        }
      }
    }

    return { data: out, width, height };
  },

  randomize(current: GlitchParams, seed: number): GlitchParams {
    const rng = createPrng(seed);
    return {
      ...current,
      redOffsetX: randInt(rng, -24, 24),
      redOffsetY: randInt(rng, -6, 6),
      blueOffsetX: randInt(rng, -24, 24),
      blueOffsetY: randInt(rng, -6, 6),
      sliceCount: randInt(rng, 4, 28),
      maxShift: randInt(rng, 12, 64),
      blockCorruption: randInt(rng, 0, 45),
      scanlineOpacity: randInt(rng, 10, 45),
      noise: randInt(rng, 4, 28),
      seed: randInt(rng, 1, 9999),
    };
  },
};

