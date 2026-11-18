import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { applyTone01, clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt } from '../prng';
import { round2, svgDocument } from '../svg';

export interface EngravingParams extends ParamMap {
  lineSpacing: number;
  maxWeight: number;
  angle: number;
  waveAmp: number;
  waveFreq: number;
  contrast: number;
  invert: boolean;
  inkColor: string;
  paperColor: string;
}

export const engravingEffect: EffectDefinition<EngravingParams> = {
  id: 'engraving',
  name: 'Engraving',
  category: 'print',
  supportsSvg: true,
  defaults: {
    lineSpacing: 6,
    maxWeight: 4.8,
    angle: 20,
    waveAmp: 2.2,
    waveFreq: 35,
    contrast: 25,
    invert: false,
    inkColor: '#161B24',
    paperColor: '#F7F4EB',
  },
  schema: [
    {
      key: 'lineSpacing',
      label: 'Line pitch',
      section: 'Guilloché Lines',
      type: 'slider',
      min: 3,
      max: 16,
      step: 0.5,
      unit: 'px',
      defaultValue: 6,
    },
    {
      key: 'maxWeight',
      label: 'Max weight',
      section: 'Guilloché Lines',
      type: 'slider',
      min: 1,
      max: 12,
      step: 0.5,
      unit: 'px',
      defaultValue: 4.8,
    },
    {
      key: 'angle',
      label: 'Angle',
      section: 'Guilloché Lines',
      type: 'slider',
      min: 0,
      max: 180,
      step: 1,
      unit: '°',
      defaultValue: 20,
    },
    {
      key: 'waveAmp',
      label: 'Wave amp',
      section: 'Guilloché Lines',
      type: 'slider',
      min: 0,
      max: 10,
      step: 0.2,
      unit: 'px',
      defaultValue: 2.2,
    },
    {
      key: 'waveFreq',
      label: 'Wave freq',
      section: 'Guilloché Lines',
      type: 'slider',
      min: 5,
      max: 100,
      step: 1,
      defaultValue: 35,
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone & Ink',
      type: 'slider',
      min: -80,
      max: 80,
      step: 1,
      defaultValue: 25,
    },
    {
      key: 'invert',
      label: 'Invert',
      section: 'Tone & Ink',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      key: 'inkColor',
      label: 'Ink',
      section: 'Tone & Ink',
      type: 'color',
      defaultValue: '#161B24',
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Tone & Ink',
      type: 'color',
      defaultValue: '#F7F4EB',
    },
  ],

  renderRaster(source: PixelBuffer, params: EngravingParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const ink = hexToRgb(params.inkColor);
    const paper = hexToRgb(params.paperColor);

    const spacing = Math.max(2.5, params.lineSpacing);
    const invSpacing = 1 / spacing;
    const halfMaxW = Math.max(0.4, params.maxWeight * 0.5);
    const rad = (params.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const freq = (params.waveFreq / 1000) * 1.4;
    const amp = params.waveAmp;

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos + Math.sin(u * freq) * amp;

        const distToLine = Math.abs(v - Math.round(v * invSpacing) * spacing);

        const idx = (y * width + x) << 2;
        const luma = applyTone01(
          rgbToLuma01(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0),
          0,
          params.contrast
        );
        const darkness = params.invert ? luma : 1 - luma;
        const targetHalfW = darkness * halfMaxW;

        const cov = clamp01(targetHalfW + 0.55 - distToLine);
        out[idx] = clampByte(paper.r + (ink.r - paper.r) * cov);
        out[idx + 1] = clampByte(paper.g + (ink.g - paper.g) * cov);
        out[idx + 2] = clampByte(paper.b + (ink.b - paper.b) * cov);
        out[idx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: EngravingParams): string {
    const { width, height, data } = source;
    const spacing = Math.max(3, params.lineSpacing);
    const halfMaxW = Math.max(0.4, params.maxWeight * 0.5);
    const rad = (params.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const diag = Math.hypot(width, height) * 0.55;
    const lineCount = Math.ceil(diag / spacing);
    const stepU = 4;
    const uCount = Math.ceil(diag / stepU);
    const freq = (params.waveFreq / 1000) * 1.4;
    const amp = params.waveAmp;

    const polygons: string[] = [];

    for (let row = -lineCount; row <= lineCount; row++) {
      const baseV = row * spacing;
      const topPts: string[] = [];
      const botPts: string[] = [];

      for (let s = -uCount; s <= uCount; s++) {
        const u = s * stepU;
        const vCenter = baseV - Math.sin(u * freq) * amp;
        const px = cx + u * cos - vCenter * sin;
        const py = cy + u * sin + vCenter * cos;

        if (px < 0 || px >= width || py < 0 || py >= height) {
          if (topPts.length > 2) {
            polygons.push(
              `<polygon points="${topPts.join(' ')} ${botPts.reverse().join(' ')}"/>`
            );
          }
          topPts.length = 0;
          botPts.length = 0;
          continue;
        }

        const ix = px | 0;
        const iy = py | 0;
        const idx = (iy * width + ix) << 2;
        const luma = applyTone01(
          rgbToLuma01(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0),
          0,
          params.contrast
        );
        const darkness = params.invert ? luma : 1 - luma;
        const hw = darkness * halfMaxW;

        if (hw < 0.2) {
          if (topPts.length > 2) {
            polygons.push(
              `<polygon points="${topPts.join(' ')} ${botPts.reverse().join(' ')}"/>`
            );
          }
          topPts.length = 0;
          botPts.length = 0;
          continue;
        }

        const tx = px + hw * sin;
        const ty = py - hw * cos;
        const bx = px - hw * sin;
        const by = py + hw * cos;
        topPts.push(`${round2(tx)},${round2(ty)}`);
        botPts.push(`${round2(bx)},${round2(by)}`);
      }

      if (topPts.length > 2) {
        polygons.push(
          `<polygon points="${topPts.join(' ')} ${botPts.reverse().join(' ')}"/>`
        );
      }
    }

    const body = `<g id="engraving-lines" fill="${params.inkColor}">${polygons.join(
      ''
    )}</g>`;
    return svgDocument(width, height, params.paperColor, body);
  },

  randomize(current: EngravingParams, seed: number): EngravingParams {
    const rng = createPrng(seed);
    return {
      ...current,
      lineSpacing: randInt(rng, 4, 10),
      maxWeight: randInt(rng, 3, 8),
      angle: randInt(rng, 0, 175),
      waveAmp: randInt(rng, 0, 6),
      waveFreq: randInt(rng, 15, 75),
    };
  },
};
