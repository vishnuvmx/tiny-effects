import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import {
  applyToneByte,
  clamp01,
  clampByte,
  hexToRgb,
  RGB,
  rgbToHex,
  rgbToLuma01,
} from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface CutoutParams extends ParamMap {
  levels: number;
  simplification: number;
  fidelity: number;
  shadowDepth: number;
  contrast: number;
  colorMode: string;
  color1: string;
  color2: string;
  color3: string;
  paperColor: string;
}

const CUTOUT_PALETTES: Record<string, string[]> = {
  bauhaus: ['#161618', '#D93829', '#1F5AA6', '#F2C12E', '#F5F2EB'],
  matisse: ['#122A59', '#E84A27', '#1E824C', '#F4B41A', '#FAF5E8'],
  pop: ['#1B0F2E', '#E61C66', '#00B8B8', '#FFE600', '#FFF9F0'],
  earth: ['#2C221E', '#8C4A27', '#C97D3B', '#D9B382', '#F4EFE6'],
  mono: ['#141414', '#4B4B4B', '#8E8E8E', '#C8C8C8', '#F5F5F5'],
};

function buildPaletteColors(params: CutoutParams, levels: number): RGB[] {
  const baseHexes =
    params.colorMode === 'custom'
      ? [params.color1, params.color2, params.color3, params.paperColor]
      : CUTOUT_PALETTES[params.colorMode] ?? CUTOUT_PALETTES.bauhaus!;

  const baseRgbs = baseHexes.map((h) => hexToRgb(h));
  const result: RGB[] = [];

  for (let i = 0; i < levels; i++) {
    const t = levels <= 1 ? 0 : i / (levels - 1);
    const scaled = t * (baseRgbs.length - 1);
    const idx0 = Math.floor(scaled);
    const idx1 = Math.min(baseRgbs.length - 1, idx0 + 1);
    const frac = scaled - idx0;
    const c0 = baseRgbs[idx0] ?? { r: 0, g: 0, b: 0 };
    const c1 = baseRgbs[idx1] ?? c0;
    result.push({
      r: clampByte(c0.r + (c1.r - c0.r) * frac),
      g: clampByte(c0.g + (c1.g - c0.g) * frac),
      b: clampByte(c0.b + (c1.b - c0.b) * frac),
    });
  }

  return result;
}

/**
 * Edge-preserving bilateral/mode simplification followed by majority-vote
 * morphological cleanup so cutouts have sharp flat silhouettes without
 * false intermediate contour rings around high-contrast edges.
 */
function computeCutoutBuffers(
  source: PixelBuffer,
  params: CutoutParams
): {
  levelMap: Uint8Array;
  flatR: Uint8Array;
  flatG: Uint8Array;
  flatB: Uint8Array;
} {
  const { width, height, data } = source;
  const total = width * height;
  const levels = Math.max(2, Math.min(8, Math.round(params.levels)));
  const radius = Math.max(1, Math.min(12, Math.round(params.simplification)));
  const edgeStop = 28 + (100 - params.fidelity) * 1.1;
  const edgeStopSq = edgeStop * edgeStop * 3;

  // 1. Edge-preserving bilateral spatial pass (never blends across strong edges!)
  const smoothR = new Uint8Array(total);
  const smoothG = new Uint8Array(total);
  const smoothB = new Uint8Array(total);
  const step = Math.max(1, Math.floor(radius / 2));

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const cIdx = (rowOff + x) << 2;
      const cr = data[cIdx] ?? 0;
      const cg = data[cIdx + 1] ?? 0;
      const cb = data[cIdx + 2] ?? 0;

      let sumR = cr;
      let sumG = cg;
      let sumB = cb;
      let wSum = 1;

      for (let py = y0; py <= y1; py += step) {
        const pRow = py * width;
        for (let px = x0; px <= x1; px += step) {
          const nIdx = (pRow + px) << 2;
          const nr = data[nIdx] ?? 0;
          const ng = data[nIdx + 1] ?? 0;
          const nb = data[nIdx + 2] ?? 0;
          const dr = nr - cr;
          const dg = ng - cg;
          const db = nb - cb;
          const colorDistSq = dr * dr + dg * dg + db * db;

          if (colorDistSq < edgeStopSq) {
            sumR += nr;
            sumG += ng;
            sumB += nb;
            wSum += 1;
          }
        }
      }

      const p = rowOff + x;
      smoothR[p] = applyToneByte(sumR / wSum, 0, params.contrast);
      smoothG[p] = applyToneByte(sumG / wSum, 0, params.contrast);
      smoothB[p] = applyToneByte(sumB / wSum, 0, params.contrast);
    }
  }

  // 2. Initial level quantization
  const rawLevels = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    const luma = rgbToLuma01(smoothR[p] ?? 0, smoothG[p] ?? 0, smoothB[p] ?? 0);
    rawLevels[p] = Math.min(levels - 1, Math.floor(clamp01(luma) * levels));
  }

  // 3. Majority-vote morphological mode filter (eliminates thin 1-2px halo rings & specks)
  const levelMap = new Uint8Array(total);
  const modeRad = Math.max(1, Math.min(4, Math.round(radius * 0.45)));
  const counts = new Int32Array(levels);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - modeRad);
    const y1 = Math.min(height - 1, y + modeRad);
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - modeRad);
      const x1 = Math.min(width - 1, x + modeRad);
      counts.fill(0);

      let bestLvl = rawLevels[rowOff + x] ?? 0;
      let bestCount = 0;

      for (let py = y0; py <= y1; py++) {
        const pRow = py * width;
        for (let px = x0; px <= x1; px++) {
          const lv = rawLevels[pRow + px] ?? 0;
          const c = (counts[lv] ?? 0) + 1;
          counts[lv] = c;
          if (c > bestCount) {
            bestCount = c;
            bestLvl = lv;
          }
        }
      }
      levelMap[rowOff + x] = bestLvl;
    }
  }

  // 4. Compute flat colour per pixel (either quantized source colour or palette colour)
  const flatR = new Uint8Array(total);
  const flatG = new Uint8Array(total);
  const flatB = new Uint8Array(total);

  if (params.colorMode === 'source') {
    const qStep = 255 / Math.max(1, levels - 1);
    for (let p = 0; p < total; p++) {
      flatR[p] = clampByte(Math.round((smoothR[p] ?? 0) / qStep) * qStep);
      flatG[p] = clampByte(Math.round((smoothG[p] ?? 0) / qStep) * qStep);
      flatB[p] = clampByte(Math.round((smoothB[p] ?? 0) / qStep) * qStep);
    }
  } else {
    const palette = buildPaletteColors(params, levels);
    for (let p = 0; p < total; p++) {
      const col = palette[levelMap[p] ?? 0] ?? { r: 240, g: 240, b: 240 };
      flatR[p] = col.r;
      flatG[p] = col.g;
      flatB[p] = col.b;
    }
  }

  return { levelMap, flatR, flatG, flatB };
}

export const cutoutEffect: EffectDefinition<CutoutParams> = {
  id: 'cutout',
  name: 'Cutout',
  category: 'stylise',
  supportsSvg: true,
  defaults: {
    levels: 4,
    simplification: 5,
    fidelity: 45,
    shadowDepth: 30,
    contrast: 20,
    colorMode: 'source',
    color1: '#161618',
    color2: '#D93829',
    color3: '#F2C12E',
    paperColor: '#F5F2EB',
  },
  schema: [
    {
      key: 'levels',
      label: 'Levels',
      section: 'Paper Cut',
      type: 'slider',
      min: 2,
      max: 8,
      step: 1,
      defaultValue: 4,
    },
    {
      key: 'simplification',
      label: 'Simplicity',
      section: 'Paper Cut',
      type: 'slider',
      min: 1,
      max: 12,
      step: 1,
      defaultValue: 5,
    },
    {
      key: 'fidelity',
      label: 'Edge snap',
      section: 'Paper Cut',
      type: 'slider',
      min: 10,
      max: 90,
      step: 1,
      unit: '%',
      defaultValue: 45,
    },
    {
      key: 'shadowDepth',
      label: 'Cut shadow',
      section: 'Paper Cut',
      type: 'slider',
      min: 0,
      max: 80,
      step: 1,
      unit: '%',
      defaultValue: 30,
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Colour & Palette',
      type: 'slider',
      min: -80,
      max: 80,
      step: 1,
      defaultValue: 20,
    },
    {
      key: 'colorMode',
      label: 'Palette',
      section: 'Colour & Palette',
      type: 'select',
      defaultValue: 'source',
      options: [
        { value: 'source', label: 'Source Colours (Poster)' },
        { value: 'bauhaus', label: 'Bauhaus Primary' },
        { value: 'matisse', label: 'Matisse Collage' },
        { value: 'pop', label: 'Silkscreen Pop' },
        { value: 'earth', label: 'Terracotta Earth' },
        { value: 'mono', label: 'Monochrome Grey' },
        { value: 'custom', label: 'Custom Colours' },
      ],
    },
    {
      key: 'color1',
      label: 'Shadow',
      section: 'Colour & Palette',
      type: 'color',
      defaultValue: '#161618',
      showWhen: (p) => p.colorMode === 'custom',
    },
    {
      key: 'color2',
      label: 'Midtone 1',
      section: 'Colour & Palette',
      type: 'color',
      defaultValue: '#D93829',
      showWhen: (p) => p.colorMode === 'custom',
    },
    {
      key: 'color3',
      label: 'Midtone 2',
      section: 'Colour & Palette',
      type: 'color',
      defaultValue: '#F2C12E',
      showWhen: (p) => p.colorMode === 'custom' && Number(p.levels) >= 3,
    },
    {
      key: 'paperColor',
      label: 'Highlight',
      section: 'Colour & Palette',
      type: 'color',
      defaultValue: '#F5F2EB',
      showWhen: (p) => p.colorMode === 'custom',
    },
  ],

  renderRaster(source: PixelBuffer, params: CutoutParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const { levelMap, flatR, flatG, flatB } = computeCutoutBuffers(source, params);
    const shadowMult = 1 - (params.shadowDepth / 100) * 0.45;

    for (let y = 0; y < height; y++) {
      const yUp = Math.max(0, y - 2) * width;
      const yRow = y * width;
      for (let x = 0; x < width; x++) {
        const xLeft = Math.max(0, x - 2);
        const p = yRow + x;
        const lvl = levelMap[p] ?? 0;
        const upLvl = levelMap[yUp + x] ?? lvl;
        const leftLvl = levelMap[yRow + xLeft] ?? lvl;

        // Cast crisp directional paper shadow where a higher layer steps down
        const inShadow = upLvl > lvl || leftLvl > lvl;
        const m = inShadow ? shadowMult : 1;

        const dstIdx = p << 2;
        out[dstIdx] = clampByte((flatR[p] ?? 0) * m);
        out[dstIdx + 1] = clampByte((flatG[p] ?? 0) * m);
        out[dstIdx + 2] = clampByte((flatB[p] ?? 0) * m);
        out[dstIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: CutoutParams): string {
    const { width, height } = source;
    const step = 2;
    const { flatR, flatG, flatB } = computeCutoutBuffers(source, params);

    const groupsByHex = new Map<string, string[]>();

    for (let y = 0; y < height; y += step) {
      let x = 0;
      while (x < width) {
        const p = y * width + x;
        const hex = rgbToHex(flatR[p] ?? 0, flatG[p] ?? 0, flatB[p] ?? 0);
        let endX = x + step;
        while (endX < width) {
          const np = y * width + endX;
          if (
            flatR[np] !== flatR[p] ||
            flatG[np] !== flatG[p] ||
            flatB[np] !== flatB[p]
          ) {
            break;
          }
          endX += step;
        }
        let rects = groupsByHex.get(hex);
        if (!rects) {
          rects = [];
          groupsByHex.set(hex, rects);
        }
        rects.push(
          `<rect x="${round2(x)}" y="${round2(y)}" width="${round2(
            Math.min(endX - x, width - x)
          )}" height="${round2(Math.min(step, height - y))}"/>`
        );
        x = endX;
      }
    }

    const groups: string[] = [];
    for (const [hex, rects] of groupsByHex.entries()) {
      groups.push(`<g fill="${hex}">${rects.join('')}</g>`);
    }

    return svgDocument(width, height, null, groups.join(''));
  },

  randomize(current: CutoutParams, seed: number): CutoutParams {
    const rng = createPrng(seed);
    return {
      ...current,
      levels: randInt(rng, 3, 6),
      simplification: randInt(rng, 3, 9),
      fidelity: randInt(rng, 30, 75),
      colorMode: randPick(rng, ['source', 'source', 'bauhaus', 'matisse', 'pop', 'earth']),
    };
  },
};
