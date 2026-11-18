import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface EmbossParams extends ParamMap {
  angle: number;
  elevation: number;
  depth: number;
  stepRadius: number;
  blendMode: string;
  shadowColor: string;
  midColor: string;
  highlightColor: string;
}

export const embossEffect: EffectDefinition<EmbossParams> = {
  id: 'emboss',
  name: 'Emboss',
  category: 'stylise',
  supportsSvg: false,
  defaults: {
    angle: 135,
    elevation: 35,
    depth: 6,
    stepRadius: 2,
    blendMode: 'relief',
    shadowColor: '#1E1F24',
    midColor: '#8A8D96',
    highlightColor: '#F7F8FA',
  },
  schema: [
    {
      key: 'angle',
      label: 'Light angle',
      section: 'Relief Lighting',
      type: 'slider',
      min: 0,
      max: 360,
      step: 1,
      unit: '°',
      defaultValue: 135,
    },
    {
      key: 'elevation',
      label: 'Elevation',
      section: 'Relief Lighting',
      type: 'slider',
      min: 5,
      max: 85,
      step: 1,
      unit: '°',
      defaultValue: 35,
    },
    {
      key: 'depth',
      label: 'Height',
      section: 'Relief Lighting',
      type: 'slider',
      min: 1,
      max: 20,
      step: 0.5,
      defaultValue: 6,
    },
    {
      key: 'stepRadius',
      label: 'Bevel width',
      section: 'Relief Lighting',
      type: 'slider',
      min: 1,
      max: 6,
      step: 1,
      unit: 'px',
      defaultValue: 2,
    },
    {
      key: 'blendMode',
      label: 'Surface',
      section: 'Surface & Tint',
      type: 'segmented',
      defaultValue: 'relief',
      options: [
        { value: 'relief', label: 'Stone' },
        { value: 'foil', label: 'Foil' },
        { value: 'color', label: 'Colour' },
      ],
    },
    {
      key: 'shadowColor',
      label: 'Shadow',
      section: 'Surface & Tint',
      type: 'color',
      defaultValue: '#1E1F24',
      showWhen: (p) => p.blendMode !== 'color',
    },
    {
      key: 'midColor',
      label: 'Midtone',
      section: 'Surface & Tint',
      type: 'color',
      defaultValue: '#8A8D96',
      showWhen: (p) => p.blendMode !== 'color',
    },
    {
      key: 'highlightColor',
      label: 'Specular',
      section: 'Surface & Tint',
      type: 'color',
      defaultValue: '#F7F8FA',
      showWhen: (p) => p.blendMode !== 'color',
    },
  ],

  renderRaster(source: PixelBuffer, params: EmbossParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const shadow = hexToRgb(params.shadowColor);
    const mid = hexToRgb(params.midColor);
    const highlight = hexToRgb(params.highlightColor);

    const luma = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = rgbToLuma01(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    }

    const az = (params.angle * Math.PI) / 180;
    const el = (params.elevation * Math.PI) / 180;
    const lx = Math.cos(az) * Math.cos(el);
    const ly = Math.sin(az) * Math.cos(el);
    const lz = Math.sin(el);

    const step = Math.max(1, Math.min(6, Math.round(params.stepRadius)));
    const depth = params.depth;

    for (let y = 0; y < height; y++) {
      const yUp = Math.max(0, y - step) * width;
      const yDown = Math.min(height - 1, y + step) * width;
      const yRow = y * width;

      for (let x = 0; x < width; x++) {
        const xLeft = Math.max(0, x - step);
        const xRight = Math.min(width - 1, x + step);

        const dzdx =
          ((luma[yRow + xRight] ?? 0) - (luma[yRow + xLeft] ?? 0)) * depth;
        const dzdy =
          ((luma[yDown + x] ?? 0) - (luma[yUp + x] ?? 0)) * depth;

        const nx = -dzdx;
        const ny = -dzdy;
        const nz = 1;
        const invLen = 1 / Math.hypot(nx, ny, nz);

        const dot = clamp01((nx * lx + ny * ly + nz * lz) * invLen);
        const idx = (yRow + x) << 2;

        if (params.blendMode === 'color') {
          const reliefDelta = (dot - lz) * 255 * 1.3;
          out[idx] = clampByte((data[idx] ?? 0) + reliefDelta);
          out[idx + 1] = clampByte((data[idx + 1] ?? 0) + reliefDelta);
          out[idx + 2] = clampByte((data[idx + 2] ?? 0) + reliefDelta);
          out[idx + 3] = 255;
        } else {
          // Map dot product across shadow -> mid -> specular highlight
          let shade = dot;
          if (params.blendMode === 'foil') {
            // Metallic specular curve
            shade = clamp01(Math.pow(dot, 1.6) + Math.pow(dot, 8) * 0.45);
          }

          let r = 0;
          let g = 0;
          let b = 0;
          if (shade < 0.5) {
            const t = shade * 2;
            r = shadow.r + (mid.r - shadow.r) * t;
            g = shadow.g + (mid.g - shadow.g) * t;
            b = shadow.b + (mid.b - shadow.b) * t;
          } else {
            const t = (shade - 0.5) * 2;
            r = mid.r + (highlight.r - mid.r) * t;
            g = mid.g + (highlight.g - mid.g) * t;
            b = mid.b + (highlight.b - mid.b) * t;
          }

          out[idx] = clampByte(r);
          out[idx + 1] = clampByte(g);
          out[idx + 2] = clampByte(b);
          out[idx + 3] = 255;
        }
      }
    }

    return { data: out, width, height };
  },

  randomize(current: EmbossParams, seed: number): EmbossParams {
    const rng = createPrng(seed);
    return {
      ...current,
      angle: randInt(rng, 0, 359),
      elevation: randInt(rng, 20, 65),
      depth: randInt(rng, 4, 14),
      blendMode: randPick(rng, ['relief', 'foil', 'color']),
    };
  },
};
