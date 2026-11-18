import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { applyTone01, clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface DuotoneParams extends ParamMap {
  preset: string;
  useMidtone: boolean;
  shadowColor: string;
  midColor: string;
  highlightColor: string;
  contrast: number;
  midtoneShift: number;
  intensity: number;
}

const DUOTONE_PRESETS: Record<
  string,
  { shadow: string; mid: string; highlight: string }
> = {
  cobalt: { shadow: '#0B1354', mid: '#165BAA', highlight: '#F765A3' },
  cyber: { shadow: '#120458', mid: '#FF007F', highlight: '#00F0FF' },
  sunset: { shadow: '#1F1135', mid: '#D93829', highlight: '#FFB800' },
  emerald: { shadow: '#072227', mid: '#148F77', highlight: '#D4EFDF' },
  amber: { shadow: '#1C140D', mid: '#B85D19', highlight: '#FCEBB6' },
  berry: { shadow: '#1A0933', mid: '#8E1B54', highlight: '#F9D5E5' },
  sepia: { shadow: '#1E1712', mid: '#7D634A', highlight: '#F4ECE1' },
};

export const duotoneEffect: EffectDefinition<DuotoneParams> = {
  id: 'duotone',
  name: 'Duotone',
  category: 'stylise',
  supportsSvg: false,
  defaults: {
    preset: 'cobalt',
    useMidtone: false,
    shadowColor: '#0B1354',
    midColor: '#165BAA',
    highlightColor: '#F765A3',
    contrast: 20,
    midtoneShift: 0,
    intensity: 100,
  },
  schema: [
    {
      key: 'preset',
      label: 'Preset',
      section: 'Gradient Map',
      type: 'select',
      defaultValue: 'cobalt',
      options: [
        { value: 'cobalt', label: 'Cobalt & Pink' },
        { value: 'cyber', label: 'Indigo & Cyan' },
        { value: 'sunset', label: 'Crimson & Gold' },
        { value: 'emerald', label: 'Deep Emerald' },
        { value: 'amber', label: 'Warm Amber' },
        { value: 'berry', label: 'Plum & Rose' },
        { value: 'sepia', label: 'Silver Sepia' },
        { value: 'custom', label: 'Custom Colours' },
      ],
    },
    {
      key: 'useMidtone',
      label: '3-stop tritone',
      section: 'Gradient Map',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      key: 'shadowColor',
      label: 'Shadows',
      section: 'Gradient Map',
      type: 'color',
      defaultValue: '#0B1354',
      showWhen: (p) => p.preset === 'custom',
    },
    {
      key: 'midColor',
      label: 'Midtones',
      section: 'Gradient Map',
      type: 'color',
      defaultValue: '#165BAA',
      showWhen: (p) => p.preset === 'custom' && Boolean(p.useMidtone),
    },
    {
      key: 'highlightColor',
      label: 'Highlights',
      section: 'Gradient Map',
      type: 'color',
      defaultValue: '#F765A3',
      showWhen: (p) => p.preset === 'custom',
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone & Mix',
      type: 'slider',
      min: -80,
      max: 80,
      step: 1,
      defaultValue: 20,
    },
    {
      key: 'midtoneShift',
      label: 'Midpoint',
      section: 'Tone & Mix',
      type: 'slider',
      min: -50,
      max: 50,
      step: 1,
      defaultValue: 0,
    },
    {
      key: 'intensity',
      label: 'Mix',
      section: 'Tone & Mix',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 100,
    },
  ],

  renderRaster(source: PixelBuffer, params: DuotoneParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);

    const activePreset =
      params.preset !== 'custom' ? DUOTONE_PRESETS[params.preset] : undefined;
    const shadow = hexToRgb(activePreset ? activePreset.shadow : params.shadowColor);
    const mid = hexToRgb(activePreset ? activePreset.mid : params.midColor);
    const highlight = hexToRgb(
      activePreset ? activePreset.highlight : params.highlightColor
    );

    const mix = clamp01(params.intensity / 100);
    const gamma = Math.pow(2, -params.midtoneShift / 50);

    // Precompute 256-entry LUT for ultra-fast gradient mapping
    const lutR = new Uint8Array(256);
    const lutG = new Uint8Array(256);
    const lutB = new Uint8Array(256);

    for (let i = 0; i < 256; i++) {
      let t = applyTone01(i / 255, 0, params.contrast);
      t = Math.pow(clamp01(t), gamma);

      let r = 0;
      let g = 0;
      let b = 0;
      if (params.useMidtone) {
        if (t < 0.5) {
          const u = t * 2;
          r = shadow.r + (mid.r - shadow.r) * u;
          g = shadow.g + (mid.g - shadow.g) * u;
          b = shadow.b + (mid.b - shadow.b) * u;
        } else {
          const u = (t - 0.5) * 2;
          r = mid.r + (highlight.r - mid.r) * u;
          g = mid.g + (highlight.g - mid.g) * u;
          b = mid.b + (highlight.b - mid.b) * u;
        }
      } else {
        r = shadow.r + (highlight.r - shadow.r) * t;
        g = shadow.g + (highlight.g - shadow.g) * t;
        b = shadow.b + (highlight.b - shadow.b) * t;
      }

      lutR[i] = clampByte(r);
      lutG[i] = clampByte(g);
      lutB[i] = clampByte(b);
    }

    for (let i = 0; i < data.length; i += 4) {
      const sr = data[i] ?? 0;
      const sg = data[i + 1] ?? 0;
      const sb = data[i + 2] ?? 0;
      const lIdx = clampByte(rgbToLuma01(sr, sg, sb) * 255);

      const dr = lutR[lIdx] ?? 0;
      const dg = lutG[lIdx] ?? 0;
      const db = lutB[lIdx] ?? 0;

      out[i] = clampByte(sr + (dr - sr) * mix);
      out[i + 1] = clampByte(sg + (dg - sg) * mix);
      out[i + 2] = clampByte(sb + (db - sb) * mix);
      out[i + 3] = 255;
    }

    return { data: out, width, height };
  },

  randomize(current: DuotoneParams, seed: number): DuotoneParams {
    const rng = createPrng(seed);
    return {
      ...current,
      preset: randPick(rng, [
        'cobalt',
        'cyber',
        'sunset',
        'emerald',
        'amber',
        'berry',
        'sepia',
      ]),
      useMidtone: rng() > 0.45,
      contrast: randInt(rng, 0, 50),
      midtoneShift: randInt(rng, -25, 25),
    };
  },
};
