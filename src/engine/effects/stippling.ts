import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import {
  applyTone01,
  clamp01,
  clampByte,
  hexToRgb,
  RGB,
  rgbToHex,
  rgbToLuma01,
} from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface StipplingParams extends ParamMap {
  density: number;
  minSize: number;
  maxSize: number;
  jitter: number;
  contrast: number;
  invert: boolean;
  colorMode: string;
  inkColor: string;
  paperColor: string;
  seed: number;
}

interface StippleDot {
  x: number;
  y: number;
  r: number;
  color: RGB;
}

function generateStippleDots(source: PixelBuffer, params: StipplingParams): StippleDot[] {
  const { width, height, data } = source;
  const rng = createPrng(Math.round(params.seed));
  const ink = hexToRgb(params.inkColor);

  // Cell spacing inversely proportional to density (density 10..100 -> step ~14..3.5px)
  const step = Math.max(3, 15 - (params.density / 100) * 11.5);
  const jitter01 = clamp01(params.jitter / 100);
  const minR = Math.max(0.4, params.minSize * 0.5);
  const maxR = Math.max(minR + 0.2, params.maxSize * 0.5);

  const dots: StippleDot[] = [];
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Stratified Poisson-like candidate with local gradient relaxation
      const jx = (rng() - 0.5) * step * jitter01 * 1.35;
      const jy = (rng() - 0.5) * step * jitter01 * 1.35;
      const px = Math.max(0, Math.min(width - 1, (col + 0.5) * step + jx));
      const py = Math.max(0, Math.min(height - 1, (row + 0.5) * step + jy));

      const ix = Math.round(px);
      const iy = Math.round(py);
      const idx = (iy * width + ix) * 4;
      const sr = data[idx] ?? 0;
      const sg = data[idx + 1] ?? 0;
      const sb = data[idx + 2] ?? 0;

      const luma = applyTone01(rgbToLuma01(sr, sg, sb), 0, params.contrast);
      const darkness = params.invert ? luma : 1 - luma;

      // Importance sampling probability driven by tonal weight
      const threshold = rng() * 0.85 + 0.05;
      if (darkness <= threshold * 0.65) {
        continue;
      }

      const normWeight = clamp01((darkness - 0.08) / 0.92);
      const radius = minR + Math.pow(normWeight, 1.2) * (maxR - minR);

      dots.push({
        x: px,
        y: py,
        r: radius,
        color: params.colorMode === 'source' ? { r: sr, g: sg, b: sb } : ink,
      });
    }
  }

  return dots;
}

export const stipplingEffect: EffectDefinition<StipplingParams> = {
  id: 'stippling',
  name: 'Stippling',
  category: 'print',
  supportsSvg: true,
  defaults: {
    density: 62,
    minSize: 1.2,
    maxSize: 5.0,
    jitter: 75,
    contrast: 25,
    invert: false,
    colorMode: 'mono',
    inkColor: '#141414',
    paperColor: '#FAF8F5',
    seed: 303,
  },
  schema: [
    {
      key: 'density',
      label: 'Density',
      section: 'Stipple',
      type: 'slider',
      min: 10,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 62,
    },
    {
      key: 'minSize',
      label: 'Min dot',
      section: 'Stipple',
      type: 'slider',
      min: 0.5,
      max: 6,
      step: 0.2,
      unit: 'px',
      defaultValue: 1.2,
    },
    {
      key: 'maxSize',
      label: 'Max dot',
      section: 'Stipple',
      type: 'slider',
      min: 1.5,
      max: 14,
      step: 0.5,
      unit: 'px',
      defaultValue: 5.0,
    },
    {
      key: 'jitter',
      label: 'Scatter',
      section: 'Stipple',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 75,
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'Stipple',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 303,
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone',
      type: 'slider',
      min: -80,
      max: 80,
      step: 1,
      defaultValue: 25,
    },
    {
      key: 'invert',
      label: 'Invert',
      section: 'Tone',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      key: 'colorMode',
      label: 'Mode',
      section: 'Colour',
      type: 'segmented',
      defaultValue: 'mono',
      options: [
        { value: 'mono', label: 'Mono' },
        { value: 'source', label: 'Source' },
      ],
    },
    {
      key: 'inkColor',
      label: 'Ink',
      section: 'Colour',
      type: 'color',
      defaultValue: '#141414',
      showWhen: (p) => p.colorMode === 'mono',
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Colour',
      type: 'color',
      defaultValue: '#FAF8F5',
    },
  ],

  renderRaster(source: PixelBuffer, params: StipplingParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const paper = hexToRgb(params.paperColor);

    for (let i = 0; i < out.length; i += 4) {
      out[i] = paper.r;
      out[i + 1] = paper.g;
      out[i + 2] = paper.b;
      out[i + 3] = 255;
    }

    const dots = generateStippleDots(source, params);

    for (const dot of dots) {
      const rPad = dot.r + 1;
      const x0 = Math.max(0, Math.floor(dot.x - rPad));
      const x1 = Math.min(width - 1, Math.ceil(dot.x + rPad));
      const y0 = Math.max(0, Math.floor(dot.y - rPad));
      const y1 = Math.min(height - 1, Math.ceil(dot.y + rPad));

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dist = Math.hypot(px - dot.x, py - dot.y);
          const cov = clamp01(dot.r + 0.5 - dist);
          if (cov > 0) {
            const dstIdx = (py * width + px) * 4;
            const curR = out[dstIdx] ?? paper.r;
            const curG = out[dstIdx + 1] ?? paper.g;
            const curB = out[dstIdx + 2] ?? paper.b;
            out[dstIdx] = clampByte(curR + (dot.color.r - curR) * cov);
            out[dstIdx + 1] = clampByte(curG + (dot.color.g - curG) * cov);
            out[dstIdx + 2] = clampByte(curB + (dot.color.b - curB) * cov);
          }
        }
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: StipplingParams): string {
    const { width, height } = source;
    const dots = generateStippleDots(source, params);
    const circles: string[] = [];

    for (const dot of dots) {
      const fillAttr =
        params.colorMode === 'source'
          ? ` fill="${rgbToHex(dot.color.r, dot.color.g, dot.color.b)}"`
          : '';
      circles.push(
        `<circle cx="${round2(dot.x)}" cy="${round2(dot.y)}" r="${round2(
          dot.r
        )}"${fillAttr}/>`
      );
    }

    const body = `<g id="stipple-dots" fill="${params.inkColor}">${circles.join('')}</g>`;
    return svgDocument(width, height, params.paperColor, body);
  },

  randomize(current: StipplingParams, seed: number): StipplingParams {
    const rng = createPrng(seed);
    const minS = randInt(rng, 1, 2);
    return {
      ...current,
      density: randInt(rng, 40, 88),
      minSize: minS,
      maxSize: randInt(rng, minS + 2, 8),
      jitter: randInt(rng, 45, 95),
      colorMode: randPick(rng, ['mono', 'source']),
      seed: randInt(rng, 1, 9999),
    };
  },
};

