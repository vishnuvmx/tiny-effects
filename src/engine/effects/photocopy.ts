import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { applyTone01, clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt } from '../prng';

export interface PhotocopyParams extends ParamMap {
  threshold: number;
  contrast: number;
  edgeDetail: number;
  grit: number;
  streaks: number;
  invert: boolean;
  inkColor: string;
  paperColor: string;
  seed: number;
}

export const photocopyEffect: EffectDefinition<PhotocopyParams> = {
  id: 'photocopy',
  name: 'Photocopy',
  category: 'print',
  supportsSvg: false,
  defaults: {
    threshold: 52,
    contrast: 55,
    edgeDetail: 65,
    grit: 28,
    streaks: 20,
    invert: false,
    inkColor: '#141413',
    paperColor: '#F4F1EA',
    seed: 101,
  },
  schema: [
    {
      key: 'threshold',
      label: 'Threshold',
      section: 'Toner',
      type: 'slider',
      min: 10,
      max: 90,
      step: 1,
      unit: '%',
      defaultValue: 52,
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Toner',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 55,
    },
    {
      key: 'edgeDetail',
      label: 'Edge halo',
      section: 'Toner',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 65,
    },
    {
      key: 'grit',
      label: 'Dust & grit',
      section: 'Wear',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 28,
    },
    {
      key: 'streaks',
      label: 'Drum streaks',
      section: 'Wear',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 20,
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'Wear',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 101,
    },
    {
      key: 'invert',
      label: 'Invert',
      section: 'Colour',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      key: 'inkColor',
      label: 'Toner',
      section: 'Colour',
      type: 'color',
      defaultValue: '#141413',
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Colour',
      type: 'color',
      defaultValue: '#F4F1EA',
    },
  ],

  renderRaster(source: PixelBuffer, params: PhotocopyParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const ink = hexToRgb(params.inkColor);
    const paper = hexToRgb(params.paperColor);
    const rng = createPrng(Math.round(params.seed));

    // Precompute luminance buffer
    const lumaBuf = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      lumaBuf[p] = rgbToLuma01(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    }

    // Precompute vertical drum roller streak profile per column
    const colStreaks = new Float32Array(width);
    const streakStrength = (params.streaks / 100) * 0.35;
    let runVal = 0;
    for (let x = 0; x < width; x++) {
      runVal = runVal * 0.75 + (rng() - 0.48) * 0.5;
      colStreaks[x] = runVal * streakStrength;
    }

    const thresh01 = params.threshold / 100;
    const edgeGain = (params.edgeDetail / 100) * 1.8;
    const gritAmp = (params.grit / 100) * 0.55;
    const sharpness = 2 + (params.contrast / 100) * 18;
    const radius = Math.max(1, Math.round(Math.min(width, height) / 140));

    for (let y = 0; y < height; y++) {
      const yUp = Math.max(0, y - radius) * width;
      const yDown = Math.min(height - 1, y + radius) * width;
      const yRow = y * width;

      for (let x = 0; x < width; x++) {
        const xLeft = Math.max(0, x - radius);
        const xRight = Math.min(width - 1, x + radius);

        const center = lumaBuf[yRow + x] ?? 0;
        // Local 4-tap neighborhood average for xerox high-pass edge accentuation
        const localAvg =
          ((lumaBuf[yUp + x] ?? center) +
            (lumaBuf[yDown + x] ?? center) +
            (lumaBuf[yRow + xLeft] ?? center) +
            (lumaBuf[yRow + xRight] ?? center)) *
          0.25;

        const highPass = (center - localAvg) * edgeGain;
        let tone = applyTone01(center + highPass, 0, params.contrast * 0.6);

        // Add toner dust & roller streaks
        const noise = (rng() - 0.5) * gritAmp + (colStreaks[x] ?? 0);
        tone = tone + noise;

        // Soft sigmoid around threshold for realistic toner grain falloff
        let inkDensity = clamp01(0.5 + (thresh01 - tone) * sharpness);
        if (params.invert) {
          inkDensity = 1 - inkDensity;
        }

        const dstIdx = (yRow + x) << 2;
        out[dstIdx] = clampByte(paper.r + (ink.r - paper.r) * inkDensity);
        out[dstIdx + 1] = clampByte(paper.g + (ink.g - paper.g) * inkDensity);
        out[dstIdx + 2] = clampByte(paper.b + (ink.b - paper.b) * inkDensity);
        out[dstIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: PhotocopyParams, seed: number): PhotocopyParams {
    const rng = createPrng(seed);
    return {
      ...current,
      threshold: randInt(rng, 35, 68),
      contrast: randInt(rng, 35, 85),
      edgeDetail: randInt(rng, 30, 90),
      grit: randInt(rng, 10, 60),
      streaks: randInt(rng, 5, 50),
      seed: randInt(rng, 1, 9999),
    };
  },
};
