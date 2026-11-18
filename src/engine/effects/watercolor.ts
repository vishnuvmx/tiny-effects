import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt } from '../prng';

export interface WatercolorParams extends ParamMap {
  brushSize: number;
  bleed: number;
  edgePooling: number;
  vibrance: number;
  paperTexture: number;
  paperColor: string;
  seed: number;
}

export const watercolorEffect: EffectDefinition<WatercolorParams> = {
  id: 'watercolor',
  name: 'Watercolor',
  category: 'stylise',
  supportsSvg: false,
  defaults: {
    brushSize: 4,
    bleed: 45,
    edgePooling: 55,
    vibrance: 30,
    paperTexture: 35,
    paperColor: '#FAF7F0',
    seed: 202,
  },
  schema: [
    {
      key: 'brushSize',
      label: 'Brush wash',
      section: 'Wash & Bleed',
      type: 'slider',
      min: 2,
      max: 10,
      step: 1,
      unit: 'px',
      defaultValue: 4,
    },
    {
      key: 'bleed',
      label: 'Wet bleed',
      section: 'Wash & Bleed',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 45,
    },
    {
      key: 'edgePooling',
      label: 'Pigment edge',
      section: 'Wash & Bleed',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 55,
    },
    {
      key: 'vibrance',
      label: 'Vibrance',
      section: 'Paper & Pigment',
      type: 'slider',
      min: -40,
      max: 100,
      step: 1,
      defaultValue: 30,
    },
    {
      key: 'paperTexture',
      label: 'Cold press',
      section: 'Paper & Pigment',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 35,
    },
    {
      key: 'paperColor',
      label: 'Paper tint',
      section: 'Paper & Pigment',
      type: 'color',
      defaultValue: '#FAF7F0',
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'Paper & Pigment',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 202,
    },
  ],

  renderRaster(source: PixelBuffer, params: WatercolorParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const paper = hexToRgb(params.paperColor);
    const rng = createPrng(Math.round(params.seed));

    const radius = Math.max(2, Math.min(10, Math.round(params.brushSize)));
    const bleedAmp = (params.bleed / 100) * radius * 1.4;
    const poolStrength = (params.edgePooling / 100) * 0.9;
    const satBoost = 1 + params.vibrance / 100;
    const texAmp = (params.paperTexture / 100) * 28;

    // Precompute low-frequency trig wave tables for fast wet-edge domain warp
    const sinX = new Float32Array(width);
    const cosY = new Float32Array(height);
    const phase = rng() * 6.28;
    for (let x = 0; x < width; x++) {
      sinX[x] = Math.sin(x * 0.09 + phase) + Math.sin(x * 0.23 - phase) * 0.5;
    }
    for (let y = 0; y < height; y++) {
      cosY[y] = Math.cos(y * 0.09 - phase) + Math.cos(y * 0.23 + phase) * 0.5;
    }

    // Fast 4-quadrant Kuwahara-inspired Painterly simplification
    const step = Math.max(1, Math.floor(radius * 0.5));

    for (let y = 0; y < height; y++) {
      const wy = cosY[y] ?? 0;
      for (let x = 0; x < width; x++) {
        const wx = sinX[x] ?? 0;
        const sx = Math.max(0, Math.min(width - 1, Math.round(x + wy * bleedAmp)));
        const sy = Math.max(0, Math.min(height - 1, Math.round(y + wx * bleedAmp)));

        let bestVar = Infinity;
        let minVar = Infinity;
        let maxVar = 0;
        let bestR = 0;
        let bestG = 0;
        let bestB = 0;

        for (let qy = -1; qy <= 0; qy++) {
          for (let qx = -1; qx <= 0; qx++) {
            const y0 = Math.max(0, sy + qy * radius);
            const y1 = Math.min(height - 1, sy + (qy + 1) * radius);
            const x0 = Math.max(0, sx + qx * radius);
            const x1 = Math.min(width - 1, sx + (qx + 1) * radius);

            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let sumL = 0;
            let sumL2 = 0;
            let cnt = 0;

            for (let py = y0; py <= y1; py += step) {
              const rOff = py * width;
              for (let px = x0; px <= x1; px += step) {
                const idx = (rOff + px) << 2;
                const pr = data[idx] ?? 0;
                const pg = data[idx + 1] ?? 0;
                const pb = data[idx + 2] ?? 0;
                const l = (pr + pg + pg + pb) * 0.25;
                sumR += pr;
                sumG += pg;
                sumB += pb;
                sumL += l;
                sumL2 += l * l;
                cnt++;
              }
            }

            if (cnt > 0) {
              const meanL = sumL / cnt;
              const variance = sumL2 / cnt - meanL * meanL;
              if (variance < bestVar) {
                bestVar = variance;
                bestR = sumR / cnt;
                bestG = sumG / cnt;
                bestB = sumB / cnt;
              }
              if (variance < minVar) minVar = variance;
              if (variance > maxVar) maxVar = variance;
            }
          }
        }

        // Vibrance & saturation boost
        const avg = (bestR + bestG + bestB) / 3;
        let r = avg + (bestR - avg) * satBoost;
        let g = avg + (bestG - avg) * satBoost;
        let b = avg + (bestB - avg) * satBoost;

        // Wet pigment edge pooling (darkens boundaries where quadrant variance jumps)
        const edgeMetric = clamp01(Math.sqrt(Math.max(0, maxVar - minVar)) / 65);
        const poolDarken = 1 - edgeMetric * poolStrength * 0.42;
        r *= poolDarken;
        g *= poolDarken;
        b *= poolDarken;

        // Translucent glaze over cold-press paper tint in highlights
        const luma = rgbToLuma01(r, g, b);
        const paperShow = Math.pow(luma, 1.8) * 0.45;
        r = r * (1 - paperShow) + paper.r * paperShow;
        g = g * (1 - paperShow) + paper.g * paperShow;
        b = b * (1 - paperShow) + paper.b * paperShow;

        // Cold-press paper grain modulation
        if (texAmp > 0) {
          const grain =
            (Math.sin(x * 0.7 + y * 0.5) * Math.cos(x * 0.4 - y * 0.8) +
              (rng() - 0.5)) *
            texAmp *
            (0.4 + 0.6 * (1 - luma));
          r += grain;
          g += grain;
          b += grain;
        }

        const dstIdx = (y * width + x) << 2;
        out[dstIdx] = clampByte(r);
        out[dstIdx + 1] = clampByte(g);
        out[dstIdx + 2] = clampByte(b);
        out[dstIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: WatercolorParams, seed: number): WatercolorParams {
    const rng = createPrng(seed);
    return {
      ...current,
      brushSize: randInt(rng, 3, 7),
      bleed: randInt(rng, 25, 80),
      edgePooling: randInt(rng, 35, 85),
      vibrance: randInt(rng, 15, 70),
      paperTexture: randInt(rng, 20, 65),
      seed: randInt(rng, 1, 9999),
    };
  },
};
