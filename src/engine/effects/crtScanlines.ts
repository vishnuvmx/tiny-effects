import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clamp01, clampByte } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface CrtScanlinesParams extends ParamMap {
  lineSpacing: number;
  lineOpacity: number;
  phosphorMask: string;
  curvature: number;
  bloom: number;
  vignette: number;
  brightness: number;
}

export const crtScanlinesEffect: EffectDefinition<CrtScanlinesParams> = {
  id: 'crt-scanlines',
  name: 'CRT Scanlines',
  category: 'retro',
  supportsSvg: false,
  defaults: {
    lineSpacing: 4,
    lineOpacity: 45,
    phosphorMask: 'grille',
    curvature: 22,
    bloom: 25,
    vignette: 35,
    brightness: 10,
  },
  schema: [
    {
      key: 'lineSpacing',
      label: 'Line pitch',
      section: 'Scanlines',
      type: 'slider',
      min: 2,
      max: 12,
      step: 1,
      unit: 'px',
      defaultValue: 4,
    },
    {
      key: 'lineOpacity',
      label: 'Line depth',
      section: 'Scanlines',
      type: 'slider',
      min: 0,
      max: 95,
      step: 1,
      unit: '%',
      defaultValue: 45,
    },
    {
      key: 'phosphorMask',
      label: 'Phosphor',
      section: 'Scanlines',
      type: 'segmented',
      defaultValue: 'grille',
      options: [
        { value: 'none', label: 'None' },
        { value: 'grille', label: 'Grille' },
        { value: 'slot', label: 'Slot' },
      ],
    },
    {
      key: 'curvature',
      label: 'Curvature',
      section: 'Tube Optics',
      type: 'slider',
      min: 0,
      max: 80,
      step: 1,
      defaultValue: 22,
    },
    {
      key: 'bloom',
      label: 'Halation',
      section: 'Tube Optics',
      type: 'slider',
      min: 0,
      max: 80,
      step: 1,
      defaultValue: 25,
    },
    {
      key: 'vignette',
      label: 'Vignette',
      section: 'Tube Optics',
      type: 'slider',
      min: 0,
      max: 80,
      step: 1,
      defaultValue: 35,
    },
    {
      key: 'brightness',
      label: 'Boost',
      section: 'Tube Optics',
      type: 'slider',
      min: -30,
      max: 50,
      step: 1,
      defaultValue: 10,
    },
  ],

  renderRaster(source: PixelBuffer, params: CrtScanlinesParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const pitch = Math.max(2, Math.round(params.lineSpacing));
    const depth01 = clamp01(params.lineOpacity / 100);
    const curveStrength = (params.curvature / 100) * 0.28;
    const vigStrength = (params.vignette / 100) * 0.9;
    const bloomStrength = (params.bloom / 100) * 0.45;
    const boost = 1 + params.brightness / 100;

    // Precompute scanline profile per row
    const rowWave = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      const s = Math.sin((y / pitch) * Math.PI);
      rowWave[y] = 1 - depth01 * (1 - s * s);
    }

    const sampleAt = (sx: number, sy: number, ch: number): number => {
      const ix = sx < 0 ? 0 : sx >= width ? width - 1 : sx | 0;
      const iy = sy < 0 ? 0 : sy >= height ? height - 1 : sy | 0;
      return data[((iy * width + ix) << 2) + ch] ?? 0;
    };

    for (let y = 0; y < height; y++) {
      const ny = (y / height) * 2 - 1;
      const ny2 = ny * ny;
      const scanMult = rowWave[y] ?? 1;

      for (let x = 0; x < width; x++) {
        const nx = (x / width) * 2 - 1;
        const nx2 = nx * nx;
        const r2 = nx2 + ny2;

        // Barrel distortion
        const barrel = 1 + curveStrength * r2;
        const ux = (nx * barrel + 1) * 0.5 * width;
        const uy = (ny * barrel + 1) * 0.5 * height;
        const dstIdx = (y * width + x) << 2;

        if (ux < 0 || ux >= width || uy < 0 || uy >= height) {
          out[dstIdx] = 12;
          out[dstIdx + 1] = 12;
          out[dstIdx + 2] = 14;
          out[dstIdx + 3] = 255;
          continue;
        }

        // Slight subpixel phosphor convergence offset + bloom tap
        let r = sampleAt(ux - 0.6, uy, 0);
        let g = sampleAt(ux, uy, 1);
        let b = sampleAt(ux + 0.6, uy, 2);

        if (bloomStrength > 0) {
          const br =
            (sampleAt(ux - 3, uy, 0) + sampleAt(ux + 3, uy, 0)) * 0.5;
          const bg =
            (sampleAt(ux, uy - 2, 1) + sampleAt(ux, uy + 2, 1)) * 0.5;
          const bb =
            (sampleAt(ux - 3, uy, 2) + sampleAt(ux + 3, uy, 2)) * 0.5;
          r += br * bloomStrength;
          g += bg * bloomStrength;
          b += bb * bloomStrength;
        }

        // Phosphor aperture grille / slot mask
        if (params.phosphorMask === 'grille') {
          const sub = x % 3;
          if (sub === 0) {
            g *= 0.82;
            b *= 0.82;
          } else if (sub === 1) {
            r *= 0.82;
            b *= 0.82;
          } else {
            r *= 0.82;
            g *= 0.82;
          }
        } else if (params.phosphorMask === 'slot') {
          const slotDark = ((x + (y & 1) * 2) % 3 === 0) ? 0.78 : 1.05;
          r *= slotDark;
          g *= slotDark;
          b *= slotDark;
        }

        const vig = clamp01(1 - r2 * vigStrength * 0.65);
        const totalGain = scanMult * vig * boost;

        out[dstIdx] = clampByte(r * totalGain);
        out[dstIdx + 1] = clampByte(g * totalGain);
        out[dstIdx + 2] = clampByte(b * totalGain);
        out[dstIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: CrtScanlinesParams, seed: number): CrtScanlinesParams {
    const rng = createPrng(seed);
    return {
      ...current,
      lineSpacing: randInt(rng, 2, 7),
      lineOpacity: randInt(rng, 25, 75),
      phosphorMask: randPick(rng, ['none', 'grille', 'slot']),
      curvature: randInt(rng, 8, 45),
      bloom: randInt(rng, 10, 50),
    };
  },
};
