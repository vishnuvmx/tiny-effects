import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clampByte, hexToRgb, RGB, rgbToHex, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface PixelateParams extends ParamMap {
  cellWidth: number;
  cellHeight: number;
  linkDimensions: boolean;
  sampling: string;
  gap: number;
  cornerRadius: number;
  colorMode: string;
  paletteLevels: number;
  paperColor: string;
}

function sampleCellColor(
  source: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: string,
  colorMode: string,
  paletteLevels: number
): RGB {
  const { width, height, data } = source;
  const sx0 = Math.max(0, Math.min(width - 1, Math.floor(x0)));
  const sy0 = Math.max(0, Math.min(height - 1, Math.floor(y0)));
  const sx1 = Math.max(sx0 + 1, Math.min(width, Math.ceil(x1)));
  const sy1 = Math.max(sy0 + 1, Math.min(height, Math.ceil(y1)));

  let r = 0;
  let g = 0;
  let b = 0;

  if (mode === 'center') {
    const cx = Math.floor((sx0 + sx1) * 0.5);
    const cy = Math.floor((sy0 + sy1) * 0.5);
    const idx = (cy * width + cx) * 4;
    r = data[idx] ?? 0;
    g = data[idx + 1] ?? 0;
    b = data[idx + 2] ?? 0;
  } else if (mode === 'dominant') {
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    let bestCount = 0;
    for (let y = sy0; y < sy1; y++) {
      for (let x = sx0; x < sx1; x++) {
        const idx = (y * width + x) * 4;
        const pr = data[idx] ?? 0;
        const pg = data[idx + 1] ?? 0;
        const pb = data[idx + 2] ?? 0;
        const key = ((pr >> 5) << 6) | ((pg >> 5) << 3) | (pb >> 5);
        const entry = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        entry.count++;
        entry.r += pr;
        entry.g += pg;
        entry.b += pb;
        buckets.set(key, entry);
        if (entry.count > bestCount) {
          bestCount = entry.count;
          r = entry.r / entry.count;
          g = entry.g / entry.count;
          b = entry.b / entry.count;
        }
      }
    }
  } else {
    let count = 0;
    for (let y = sy0; y < sy1; y++) {
      for (let x = sx0; x < sx1; x++) {
        const idx = (y * width + x) * 4;
        r += data[idx] ?? 0;
        g += data[idx + 1] ?? 0;
        b += data[idx + 2] ?? 0;
        count++;
      }
    }
    if (count > 0) {
      r /= count;
      g /= count;
      b /= count;
    }
  }

  if (colorMode === 'mono') {
    const luma = rgbToLuma01(r, g, b) * 255;
    r = luma;
    g = luma;
    b = luma;
  }

  const levels = Math.max(2, Math.min(32, Math.round(paletteLevels)));
  if (levels < 32) {
    const step = 255 / (levels - 1);
    r = Math.round(r / step) * step;
    g = Math.round(g / step) * step;
    b = Math.round(b / step) * step;
  }

  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

export const pixelateEffect: EffectDefinition<PixelateParams> = {
  id: 'pixelate',
  name: 'Pixelate',
  category: 'retro',
  supportsSvg: true,
  defaults: {
    cellWidth: 12,
    cellHeight: 12,
    linkDimensions: true,
    sampling: 'average',
    gap: 1,
    cornerRadius: 2,
    colorMode: 'color',
    paletteLevels: 32,
    paperColor: '#181818',
  },
  schema: [
    {
      key: 'cellWidth',
      label: 'Cell width',
      section: 'Grid',
      type: 'slider',
      min: 3,
      max: 64,
      step: 1,
      unit: 'px',
      defaultValue: 12,
    },
    {
      key: 'linkDimensions',
      label: 'Square cells',
      section: 'Grid',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      key: 'cellHeight',
      label: 'Cell height',
      section: 'Grid',
      type: 'slider',
      min: 3,
      max: 64,
      step: 1,
      unit: 'px',
      defaultValue: 12,
      showWhen: (p) => !p.linkDimensions,
    },
    {
      key: 'gap',
      label: 'Gap',
      section: 'Grid',
      type: 'slider',
      min: 0,
      max: 12,
      step: 1,
      unit: 'px',
      defaultValue: 1,
    },
    {
      key: 'cornerRadius',
      label: 'Radius',
      section: 'Grid',
      type: 'slider',
      min: 0,
      max: 24,
      step: 1,
      unit: 'px',
      defaultValue: 2,
    },
    {
      key: 'sampling',
      label: 'Sampling',
      section: 'Colour',
      type: 'segmented',
      defaultValue: 'average',
      options: [
        { value: 'average', label: 'Avg' },
        { value: 'center', label: 'Center' },
        { value: 'dominant', label: 'Dom' },
      ],
    },
    {
      key: 'colorMode',
      label: 'Mode',
      section: 'Colour',
      type: 'segmented',
      defaultValue: 'color',
      options: [
        { value: 'color', label: 'Colour' },
        { value: 'mono', label: 'Mono' },
      ],
    },
    {
      key: 'paletteLevels',
      label: 'Levels',
      section: 'Colour',
      type: 'slider',
      min: 2,
      max: 32,
      step: 1,
      defaultValue: 32,
    },
    {
      key: 'paperColor',
      label: 'Gap fill',
      section: 'Colour',
      type: 'color',
      defaultValue: '#181818',
      showWhen: (p) => Number(p.gap) > 0 || Number(p.cornerRadius) > 0,
    },
  ],

  renderRaster(source: PixelBuffer, params: PixelateParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const cw = Math.max(2, Math.round(params.cellWidth));
    const ch = params.linkDimensions ? cw : Math.max(2, Math.round(params.cellHeight));
    const gap = Math.max(0, Math.min(cw - 1, ch - 1, Math.round(params.gap)));
    const bg = hexToRgb(params.paperColor);

    for (let i = 0; i < out.length; i += 4) {
      out[i] = bg.r;
      out[i + 1] = bg.g;
      out[i + 2] = bg.b;
      out[i + 3] = 255;
    }

    const cols = Math.ceil(width / cw);
    const rows = Math.ceil(height / ch);
    const halfGap = gap * 0.5;

    for (let r = 0; r < rows; r++) {
      const y0 = r * ch;
      const y1 = Math.min(height, (r + 1) * ch);
      const boxY0 = y0 + halfGap;
      const boxY1 = y1 - halfGap;
      const boxH = boxY1 - boxY0;
      if (boxH <= 0) continue;

      for (let c = 0; c < cols; c++) {
        const x0 = c * cw;
        const x1 = Math.min(width, (c + 1) * cw);
        const boxX0 = x0 + halfGap;
        const boxX1 = x1 - halfGap;
        const boxW = boxX1 - boxX0;
        if (boxW <= 0) continue;

        const col = sampleCellColor(
          source,
          x0,
          y0,
          x1,
          y1,
          params.sampling,
          params.colorMode,
          params.paletteLevels
        );

        const maxRadius = Math.min(boxW, boxH) * 0.5;
        const rad = Math.min(maxRadius, Math.max(0, params.cornerRadius));

        const startY = Math.max(0, Math.floor(boxY0));
        const endY = Math.min(height, Math.ceil(boxY1));
        const startX = Math.max(0, Math.floor(boxX0));
        const endX = Math.min(width, Math.ceil(boxX1));

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            let coverage = 1;
            if (rad > 0.5) {
              const cx = (boxX0 + boxX1) * 0.5;
              const cy = (boxY0 + boxY1) * 0.5;
              const qx = Math.abs(px + 0.5 - cx) - (boxW * 0.5 - rad);
              const qy = Math.abs(py + 0.5 - cy) - (boxH * 0.5 - rad);
              const dist =
                Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
                Math.min(Math.max(qx, qy), 0) -
                rad;
              coverage = dist <= -0.5 ? 1 : dist >= 0.5 ? 0 : 0.5 - dist;
            }
            if (coverage > 0) {
              const dstIdx = (py * width + px) * 4;
              out[dstIdx] = clampByte(bg.r + (col.r - bg.r) * coverage);
              out[dstIdx + 1] = clampByte(bg.g + (col.g - bg.g) * coverage);
              out[dstIdx + 2] = clampByte(bg.b + (col.b - bg.b) * coverage);
            }
          }
        }
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: PixelateParams): string {
    const { width, height } = source;
    const cw = Math.max(2, Math.round(params.cellWidth));
    const ch = params.linkDimensions ? cw : Math.max(2, Math.round(params.cellHeight));
    const gap = Math.max(0, Math.min(cw - 1, ch - 1, Math.round(params.gap)));
    const halfGap = gap * 0.5;
    const cols = Math.ceil(width / cw);
    const rows = Math.ceil(height / ch);
    const rects: string[] = [];

    for (let r = 0; r < rows; r++) {
      const y0 = r * ch;
      const y1 = Math.min(height, (r + 1) * ch);
      const boxY = y0 + halfGap;
      const boxH = y1 - y0 - gap;
      if (boxH <= 0) continue;

      for (let c = 0; c < cols; c++) {
        const x0 = c * cw;
        const x1 = Math.min(width, (c + 1) * cw);
        const boxX = x0 + halfGap;
        const boxW = x1 - x0 - gap;
        if (boxW <= 0) continue;

        const col = sampleCellColor(
          source,
          x0,
          y0,
          x1,
          y1,
          params.sampling,
          params.colorMode,
          params.paletteLevels
        );
        const hex = rgbToHex(col.r, col.g, col.b);
        const rx = Math.min(boxW * 0.5, boxH * 0.5, Math.max(0, params.cornerRadius));
        const rxAttr = rx > 0 ? ` rx="${round2(rx)}"` : '';
        rects.push(
          `<rect x="${round2(boxX)}" y="${round2(boxY)}" width="${round2(
            boxW
          )}" height="${round2(boxH)}"${rxAttr} fill="${hex}"/>`
        );
      }
    }

    const bgHex = gap > 0 || params.cornerRadius > 0 ? params.paperColor : null;
    return svgDocument(width, height, bgHex, `<g id="pixelate-grid">${rects.join('')}</g>`);
  },

  randomize(current: PixelateParams, seed: number): PixelateParams {
    const rng = createPrng(seed);
    const cw = randInt(rng, 6, 28);
    return {
      ...current,
      cellWidth: cw,
      cellHeight: cw,
      gap: randInt(rng, 0, 4),
      cornerRadius: randInt(rng, 0, 8),
      sampling: randPick(rng, ['average', 'center', 'dominant']),
      paletteLevels: randPick(rng, [4, 8, 16, 32]),
    };
  },
};

