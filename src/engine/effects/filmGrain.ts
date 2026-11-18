import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clamp01, clampByte, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface FilmGrainParams extends ParamMap {
  amount: number;
  grainSize: number;
  filmStock: string;
  fade: number;
  vignette: number;
  scratches: number;
  seed: number;
}

export const filmGrainEffect: EffectDefinition<FilmGrainParams> = {
  id: 'film-grain',
  name: 'Film Grain',
  category: 'retro',
  supportsSvg: false,
  defaults: {
    amount: 42,
    grainSize: 1.5,
    filmStock: 'kodak',
    fade: 16,
    vignette: 28,
    scratches: 15,
    seed: 1974,
  },
  schema: [
    {
      key: 'amount',
      label: 'Grain',
      section: 'Emulsion',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 42,
    },
    {
      key: 'grainSize',
      label: 'Grain size',
      section: 'Emulsion',
      type: 'slider',
      min: 1,
      max: 4,
      step: 0.5,
      unit: 'px',
      defaultValue: 1.5,
    },
    {
      key: 'filmStock',
      label: 'Film stock',
      section: 'Emulsion',
      type: 'select',
      defaultValue: 'kodak',
      options: [
        { value: 'kodak', label: 'Warm Gold 400' },
        { value: 'fuji', label: 'Cool Superia' },
        { value: 'ilford', label: 'Silver B&W Pan' },
        { value: 'neutral', label: 'Neutral 35mm' },
      ],
    },
    {
      key: 'fade',
      label: 'Matte fade',
      section: 'Age & Optics',
      type: 'slider',
      min: 0,
      max: 60,
      step: 1,
      unit: '%',
      defaultValue: 16,
    },
    {
      key: 'vignette',
      label: 'Vignette',
      section: 'Age & Optics',
      type: 'slider',
      min: 0,
      max: 80,
      step: 1,
      unit: '%',
      defaultValue: 28,
    },
    {
      key: 'scratches',
      label: 'Dust & hair',
      section: 'Age & Optics',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 15,
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'Age & Optics',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 1974,
    },
  ],

  renderRaster(source: PixelBuffer, params: FilmGrainParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const rng = createPrng(Math.round(params.seed));

    const gSize = Math.max(1, params.grainSize);
    const gCols = Math.ceil(width / gSize);
    const gRows = Math.ceil(height / gSize);
    const grainGrid = new Float32Array(gCols * gRows);
    for (let i = 0; i < grainGrid.length; i++) {
      // Approximate Gaussian via 2-uniform sum
      grainGrid[i] = rng() + rng() - 1;
    }

    const grainAmp = (params.amount / 100) * 95;
    const fadeLift = (params.fade / 100) * 48;
    const fadeScale = 1 - (params.fade / 100) * 0.25;
    const vigStrength = (params.vignette / 100) * 0.85;

    for (let y = 0; y < height; y++) {
      const ny = (y / height) * 2 - 1;
      const ny2 = ny * ny;
      const gr = Math.min(gRows - 1, (y / gSize) | 0);

      for (let x = 0; x < width; x++) {
        const nx = (x / width) * 2 - 1;
        const r2 = nx * nx + ny2;
        const gc = Math.min(gCols - 1, (x / gSize) | 0);

        const idx = (y * width + x) << 2;
        let r = data[idx] ?? 0;
        let g = data[idx + 1] ?? 0;
        let b = data[idx + 2] ?? 0;
        const luma = rgbToLuma01(r, g, b);

        if (params.filmStock === 'ilford') {
          const bw = luma * 255;
          r = bw;
          g = bw;
          b = bw;
        } else if (params.filmStock === 'kodak') {
          r = r * 1.06 + 6;
          g = g * 1.01 + 2;
          b = b * 0.92;
        } else if (params.filmStock === 'fuji') {
          r = r * 0.96;
          g = g * 1.04 + 3;
          b = b * 1.05 + 5;
        }

        // Midtone-weighted organic silver halide grain
        const midtoneWeight = 1 - Math.abs(luma - 0.5) * 1.35;
        const gVal = (grainGrid[gr * gCols + gc] ?? 0) * grainAmp * Math.max(0.25, midtoneWeight);

        const vig = clamp01(1 - r2 * vigStrength * 0.6);

        r = (r * fadeScale + fadeLift + gVal) * vig;
        g = (g * fadeScale + fadeLift + gVal) * vig;
        b = (b * fadeScale + fadeLift + gVal) * vig;

        out[idx] = clampByte(r);
        out[idx + 1] = clampByte(g);
        out[idx + 2] = clampByte(b);
        out[idx + 3] = 255;
      }
    }

    // Film dust specks and vertical scratches
    const scratchCount = Math.floor((params.scratches / 100) * 6);
    for (let s = 0; s < scratchCount; s++) {
      let sx = randInt(rng, 4, width - 5);
      const yStart = randInt(rng, 0, Math.floor(height * 0.4));
      const yEnd = randInt(rng, Math.floor(height * 0.5), height - 1);
      for (let y = yStart; y < yEnd; y++) {
        if (rng() > 0.85) sx += randInt(rng, -1, 1);
        const cx = Math.max(0, Math.min(width - 1, sx));
        const idx = (y * width + cx) << 2;
        out[idx] = clampByte((out[idx] ?? 0) + 90);
        out[idx + 1] = clampByte((out[idx + 1] ?? 0) + 88);
        out[idx + 2] = clampByte((out[idx + 2] ?? 0) + 82);
      }
    }

    return { data: out, width, height };
  },

  randomize(current: FilmGrainParams, seed: number): FilmGrainParams {
    const rng = createPrng(seed);
    return {
      ...current,
      amount: randInt(rng, 25, 75),
      grainSize: randPick(rng, [1, 1.5, 2, 2.5]),
      filmStock: randPick(rng, ['kodak', 'fuji', 'ilford', 'neutral']),
      fade: randInt(rng, 5, 35),
      vignette: randInt(rng, 15, 50),
      seed: randInt(rng, 1, 9999),
    };
  },
};
