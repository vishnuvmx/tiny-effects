import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import {
  applyToneByte,
  clampByte,
  findNearestColor,
  hexToRgb,
  RETRO_PALETTES,
  RGB,
  rgbToHex,
  rgbToLuma01,
} from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface DitherParams extends ParamMap {
  algorithm: string;
  scale: number;
  threshold: number;
  serpentine: boolean;
  contrast: number;
  brightness: number;
  palette: string;
  inkColor: string;
  paperColor: string;
}

const BAYER_2 = [
  [0, 2],
  [3, 1],
];

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

function getPaletteColors(params: DitherParams): RGB[] {
  if (params.palette === '1bit' || params.palette === '2color') {
    return [hexToRgb(params.inkColor), hexToRgb(params.paperColor)];
  }
  return (
    RETRO_PALETTES[params.palette] ?? [
      hexToRgb(params.inkColor),
      hexToRgb(params.paperColor),
    ]
  );
}

interface DitherGridResult {
  cols: number;
  rows: number;
  scale: number;
  grid: RGB[];
}

function computeDitherGrid(source: PixelBuffer, params: DitherParams): DitherGridResult {
  const scale = Math.max(1, Math.min(16, Math.round(params.scale)));
  const cols = Math.max(1, Math.ceil(source.width / scale));
  const rows = Math.max(1, Math.ceil(source.height / scale));
  const isMono = params.palette === '1bit' || params.palette === '2color';
  const palette = getPaletteColors(params);
  const ink = palette[0] ?? { r: 17, g: 17, b: 17 };
  const paper = palette[1] ?? { r: 255, g: 255, b: 255 };

  // Working float buffers for R, G, B (or Luma in R channel)
  const bufR = new Float32Array(cols * rows);
  const bufG = new Float32Array(cols * rows);
  const bufB = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const sy = Math.min(source.height - 1, Math.floor((r + 0.5) * scale));
    for (let c = 0; c < cols; c++) {
      const sx = Math.min(source.width - 1, Math.floor((c + 0.5) * scale));
      const idx = (sy * source.width + sx) * 4;
      const tr = applyToneByte(source.data[idx] ?? 0, params.brightness, params.contrast);
      const tg = applyToneByte(
        source.data[idx + 1] ?? 0,
        params.brightness,
        params.contrast
      );
      const tb = applyToneByte(
        source.data[idx + 2] ?? 0,
        params.brightness,
        params.contrast
      );
      const cellIdx = r * cols + c;
      if (isMono) {
        bufR[cellIdx] = rgbToLuma01(tr, tg, tb) * 255;
      } else {
        bufR[cellIdx] = tr;
        bufG[cellIdx] = tg;
        bufB[cellIdx] = tb;
      }
    }
  }

  const grid: RGB[] = new Array<RGB>(cols * rows);
  const isBayer =
    params.algorithm === 'bayer2' ||
    params.algorithm === 'bayer4' ||
    params.algorithm === 'bayer8';

  if (isBayer) {
    const matrix =
      params.algorithm === 'bayer2'
        ? BAYER_2
        : params.algorithm === 'bayer4'
        ? BAYER_4
        : BAYER_8;
    const dim = matrix.length;
    const denom = dim * dim;
    const spread = 96;
    const threshShift = params.threshold - 128;

    for (let r = 0; r < rows; r++) {
      const mRow = matrix[r % dim] ?? [0];
      for (let c = 0; c < cols; c++) {
        const cellIdx = r * cols + c;
        const bayerVal = (mRow[c % dim] ?? 0) / denom - 0.5;
        if (isMono) {
          const val = (bufR[cellIdx] ?? 0) + bayerVal * spread - threshShift;
          grid[cellIdx] = val < 128 ? ink : paper;
        } else {
          const nr = clampByte((bufR[cellIdx] ?? 0) + bayerVal * spread - threshShift);
          const ng = clampByte((bufG[cellIdx] ?? 0) + bayerVal * spread - threshShift);
          const nb = clampByte((bufB[cellIdx] ?? 0) + bayerVal * spread - threshShift);
          grid[cellIdx] = findNearestColor(nr, ng, nb, palette);
        }
      }
    }
  } else {
    const isAtkinson = params.algorithm === 'atkinson';
    const thresh = params.threshold;

    const addError = (c: number, r: number, er: number, eg: number, eb: number, w: number) => {
      if (c < 0 || c >= cols || r < 0 || r >= rows) return;
      const idx = r * cols + c;
      bufR[idx] = (bufR[idx] ?? 0) + er * w;
      if (!isMono) {
        bufG[idx] = (bufG[idx] ?? 0) + eg * w;
        bufB[idx] = (bufB[idx] ?? 0) + eb * w;
      }
    };

    for (let r = 0; r < rows; r++) {
      const reverse = params.serpentine && (r & 1) === 1;
      const startC = reverse ? cols - 1 : 0;
      const endC = reverse ? -1 : cols;
      const step = reverse ? -1 : 1;

      for (let c = startC; c !== endC; c += step) {
        const idx = r * cols + c;
        const oldR = bufR[idx] ?? 0;
        const oldG = bufG[idx] ?? 0;
        const oldB = bufB[idx] ?? 0;

        let errR = 0;
        let errG = 0;
        let errB = 0;

        if (isMono) {
          const isLight = oldR >= thresh;
          const newLuma = isLight ? 255 : 0;
          grid[idx] = isLight ? paper : ink;
          errR = oldR - newLuma;
        } else {
          const chosen = findNearestColor(
            clampByte(oldR),
            clampByte(oldG),
            clampByte(oldB),
            palette
          );
          grid[idx] = chosen;
          errR = oldR - chosen.r;
          errG = oldG - chosen.g;
          errB = oldB - chosen.b;
        }

        if (isAtkinson) {
          const w = 1 / 8;
          addError(c + step, r, errR, errG, errB, w);
          addError(c + 2 * step, r, errR, errG, errB, w);
          addError(c - step, r + 1, errR, errG, errB, w);
          addError(c, r + 1, errR, errG, errB, w);
          addError(c + step, r + 1, errR, errG, errB, w);
          addError(c, r + 2, errR, errG, errB, w);
        } else {
          // Floyd-Steinberg
          addError(c + step, r, errR, errG, errB, 7 / 16);
          addError(c - step, r + 1, errR, errG, errB, 3 / 16);
          addError(c, r + 1, errR, errG, errB, 5 / 16);
          addError(c + step, r + 1, errR, errG, errB, 1 / 16);
        }
      }
    }
  }

  return { cols, rows, scale, grid };
}

export const ditherEffect: EffectDefinition<DitherParams> = {
  id: 'dither',
  name: 'Dithering',
  category: 'retro',
  supportsSvg: true,
  defaults: {
    algorithm: 'atkinson',
    scale: 2,
    threshold: 128,
    serpentine: true,
    contrast: 15,
    brightness: 0,
    palette: '1bit',
    inkColor: '#111111',
    paperColor: '#F5F3EE',
  },
  schema: [
    {
      key: 'algorithm',
      label: 'Algorithm',
      section: 'Algorithm',
      type: 'select',
      defaultValue: 'atkinson',
      options: [
        { value: 'atkinson', label: 'Atkinson' },
        { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
        { value: 'bayer2', label: 'Bayer 2×2' },
        { value: 'bayer4', label: 'Bayer 4×4' },
        { value: 'bayer8', label: 'Bayer 8×8' },
      ],
    },
    {
      key: 'scale',
      label: 'Pixel scale',
      section: 'Algorithm',
      type: 'slider',
      min: 1,
      max: 12,
      step: 1,
      unit: 'px',
      defaultValue: 2,
    },
    {
      key: 'threshold',
      label: 'Threshold',
      section: 'Algorithm',
      type: 'slider',
      min: 16,
      max: 240,
      step: 1,
      defaultValue: 128,
    },
    {
      key: 'serpentine',
      label: 'Serpentine',
      section: 'Algorithm',
      type: 'checkbox',
      defaultValue: true,
      showWhen: (p) => p.algorithm === 'floyd-steinberg' || p.algorithm === 'atkinson',
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone',
      type: 'slider',
      min: -100,
      max: 100,
      step: 1,
      defaultValue: 15,
    },
    {
      key: 'brightness',
      label: 'Brightness',
      section: 'Tone',
      type: 'slider',
      min: -100,
      max: 100,
      step: 1,
      defaultValue: 0,
    },
    {
      key: 'palette',
      label: 'Palette',
      section: 'Palette',
      type: 'select',
      defaultValue: '1bit',
      options: [
        { value: '1bit', label: '1-Bit Custom' },
        { value: 'gameboy', label: 'Game Boy (4-col)' },
        { value: 'newspaper', label: 'Newsprint (4-col)' },
        { value: 'cga', label: 'CGA Cyan/Magenta' },
        { value: 'cgaWarm', label: 'CGA Red/Green' },
        { value: 'pico8', label: 'Retro 8-Colour' },
        { value: 'sweetie16', label: 'Retro 16-Colour' },
      ],
    },
    {
      key: 'inkColor',
      label: 'Dark',
      section: 'Palette',
      type: 'color',
      defaultValue: '#111111',
      showWhen: (p) => p.palette === '1bit',
    },
    {
      key: 'paperColor',
      label: 'Light',
      section: 'Palette',
      type: 'color',
      defaultValue: '#F5F3EE',
      showWhen: (p) => p.palette === '1bit',
    },
  ],

  renderRaster(source: PixelBuffer, params: DitherParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const { cols, rows, scale, grid } = computeDitherGrid(source, params);

    for (let y = 0; y < height; y++) {
      const r = Math.min(rows - 1, Math.floor(y / scale));
      for (let x = 0; x < width; x++) {
        const c = Math.min(cols - 1, Math.floor(x / scale));
        const col = grid[r * cols + c] ?? { r: 0, g: 0, b: 0 };
        const idx = (y * width + x) * 4;
        out[idx] = col.r;
        out[idx + 1] = col.g;
        out[idx + 2] = col.b;
        out[idx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: DitherParams): string {
    const { width, height } = source;
    const { cols, rows, scale, grid } = computeDitherGrid(source, params);
    const palette = getPaletteColors(params);
    const bgRgb = palette[palette.length - 1] ?? { r: 255, g: 255, b: 255 };
    const bgHex = rgbToHex(bgRgb.r, bgRgb.g, bgRgb.b);

    const groupsByColor = new Map<string, string[]>();

    for (let r = 0; r < rows; r++) {
      let c = 0;
      const y = round2(r * scale);
      const h = round2(Math.min(scale, height - r * scale));
      while (c < cols) {
        const col = grid[r * cols + c] ?? bgRgb;
        const hex = rgbToHex(col.r, col.g, col.b);
        let runEnd = c + 1;
        while (runEnd < cols) {
          const nextCol = grid[r * cols + runEnd] ?? bgRgb;
          if (
            nextCol.r !== col.r ||
            nextCol.g !== col.g ||
            nextCol.b !== col.b
          ) {
            break;
          }
          runEnd++;
        }
        if (hex !== bgHex) {
          const x = round2(c * scale);
          const w = round2(Math.min((runEnd - c) * scale, width - c * scale));
          let list = groupsByColor.get(hex);
          if (!list) {
            list = [];
            groupsByColor.set(hex, list);
          }
          list.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`);
        }
        c = runEnd;
      }
    }

    const groupElements: string[] = [];
    for (const [hex, rects] of groupsByColor.entries()) {
      groupElements.push(`<g fill="${hex}">${rects.join('')}</g>`);
    }

    return svgDocument(width, height, bgHex, groupElements.join(''));
  },

  randomize(current: DitherParams, seed: number): DitherParams {
    const rng = createPrng(seed);
    return {
      ...current,
      algorithm: randPick(rng, [
        'atkinson',
        'floyd-steinberg',
        'bayer2',
        'bayer4',
        'bayer8',
      ]),
      scale: randInt(rng, 1, 6),
      threshold: randInt(rng, 88, 168),
      palette: randPick(rng, [
        '1bit',
        'gameboy',
        'newspaper',
        'cga',
        'cgaWarm',
        'pico8',
        'sweetie16',
      ]),
    };
  },
};

