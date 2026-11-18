import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clamp01, clampByte, hexToRgb, RGB, rgbToHex } from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface MosaicParams extends ParamMap {
  tileType: string;
  cellSize: number;
  jitter: number;
  groutWidth: number;
  bevel: number;
  groutColor: string;
  seed: number;
}

interface VoronoiSeed {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

function buildVoronoiGrid(
  source: PixelBuffer,
  cellSize: number,
  jitter01: number,
  seed: number
): { cols: number; rows: number; seeds: VoronoiSeed[] } {
  const { width, height, data } = source;
  const cols = Math.max(2, Math.ceil(width / cellSize) + 2);
  const rows = Math.max(2, Math.ceil(height / cellSize) + 2);
  const rng = createPrng(Math.round(seed));
  const seeds: VoronoiSeed[] = new Array<VoronoiSeed>(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (rng() - 0.5) * cellSize * jitter01 * 0.88;
      const jy = (rng() - 0.5) * cellSize * jitter01 * 0.88;
      const sx = (c - 0.5) * cellSize + jx;
      const sy = (r - 0.5) * cellSize + jy;
      const ix = Math.max(0, Math.min(width - 1, Math.round(sx)));
      const iy = Math.max(0, Math.min(height - 1, Math.round(sy)));
      const idx = (iy * width + ix) << 2;
      seeds[r * cols + c] = {
        x: sx,
        y: sy,
        r: data[idx] ?? 0,
        g: data[idx + 1] ?? 0,
        b: data[idx + 2] ?? 0,
      };
    }
  }

  return { cols, rows, seeds };
}

export const mosaicEffect: EffectDefinition<MosaicParams> = {
  id: 'mosaic',
  name: 'Mosaic',
  category: 'stylise',
  supportsSvg: true,
  defaults: {
    tileType: 'voronoi',
    cellSize: 16,
    jitter: 75,
    groutWidth: 1.5,
    bevel: 25,
    groutColor: '#1E1E1E',
    seed: 512,
  },
  schema: [
    {
      key: 'tileType',
      label: 'Pattern',
      section: 'Tiles',
      type: 'segmented',
      defaultValue: 'voronoi',
      options: [
        { value: 'voronoi', label: 'Stained' },
        { value: 'hex', label: 'Hex' },
        { value: 'brick', label: 'Brick' },
      ],
    },
    {
      key: 'cellSize',
      label: 'Tile size',
      section: 'Tiles',
      type: 'slider',
      min: 6,
      max: 48,
      step: 1,
      unit: 'px',
      defaultValue: 16,
    },
    {
      key: 'jitter',
      label: 'Irregularity',
      section: 'Tiles',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 75,
      showWhen: (p) => p.tileType === 'voronoi',
    },
    {
      key: 'bevel',
      label: 'Tile bevel',
      section: 'Tiles',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 25,
    },
    {
      key: 'seed',
      label: 'Seed',
      section: 'Tiles',
      type: 'scrub',
      min: 1,
      max: 9999,
      step: 1,
      defaultValue: 512,
      showWhen: (p) => p.tileType === 'voronoi',
    },
    {
      key: 'groutWidth',
      label: 'Grout width',
      section: 'Grout',
      type: 'slider',
      min: 0,
      max: 6,
      step: 0.5,
      unit: 'px',
      defaultValue: 1.5,
    },
    {
      key: 'groutColor',
      label: 'Grout',
      section: 'Grout',
      type: 'color',
      defaultValue: '#1E1E1E',
    },
  ],

  renderRaster(source: PixelBuffer, params: MosaicParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const cellSize = Math.max(4, params.cellSize);
    const groutW = Math.max(0, params.groutWidth);
    const grout = hexToRgb(params.groutColor);
    const bevel01 = (params.bevel / 100) * 0.45;

    const jitter01 =
      params.tileType === 'hex' ? 0 : clamp01(params.jitter / 100);

    if (params.tileType === 'brick') {
      const bw = cellSize * 1.4;
      const bh = cellSize * 0.75;
      const halfGrout = groutW * 0.5;

      for (let y = 0; y < height; y++) {
        const row = Math.floor(y / bh);
        const shiftX = (row & 1) !== 0 ? bw * 0.5 : 0;
        const localY = y - row * bh;

        for (let x = 0; x < width; x++) {
          const shiftedX = x + shiftX;
          const col = Math.floor(shiftedX / bw);
          const localX = shiftedX - col * bw;

          const edgeDist = Math.min(
            localX,
            bw - localX,
            localY,
            bh - localY
          );

          const cx = Math.max(
            0,
            Math.min(width - 1, Math.round((col + 0.5) * bw - shiftX))
          );
          const cy = Math.max(0, Math.min(height - 1, Math.round((row + 0.5) * bh)));
          const sIdx = (cy * width + cx) << 2;

          let r = data[sIdx] ?? 0;
          let g = data[sIdx + 1] ?? 0;
          let b = data[sIdx + 2] ?? 0;

          if (bevel01 > 0) {
            const light =
              ((bw * 0.5 - localX) / bw + (bh * 0.5 - localY) / bh) * bevel01 * 90;
            r += light;
            g += light;
            b += light;
          }

          const groutMix =
            groutW > 0 ? clamp01(halfGrout + 0.5 - edgeDist) : 0;
          const dstIdx = (y * width + x) << 2;
          out[dstIdx] = clampByte(r + (grout.r - r) * groutMix);
          out[dstIdx + 1] = clampByte(g + (grout.g - g) * groutMix);
          out[dstIdx + 2] = clampByte(b + (grout.b - b) * groutMix);
          out[dstIdx + 3] = 255;
        }
      }
      return { data: out, width, height };
    }

    // Voronoi or Hex cellular search over 3x3 neighborhood
    const { cols, rows, seeds } = buildVoronoiGrid(
      source,
      cellSize,
      jitter01,
      params.seed
    );

    if (params.tileType === 'hex') {
      // Arrange seeds in exact hexagonal lattice
      for (let r = 0; r < rows; r++) {
        const shift = (r & 1) !== 0 ? cellSize * 0.5 : 0;
        for (let c = 0; c < cols; c++) {
          const sx = (c - 0.5) * cellSize + shift;
          const sy = (r - 0.5) * cellSize * 0.866;
          const ix = Math.max(0, Math.min(width - 1, Math.round(sx)));
          const iy = Math.max(0, Math.min(height - 1, Math.round(sy)));
          const idx = (iy * width + ix) << 2;
          seeds[r * cols + c] = {
            x: sx,
            y: sy,
            r: data[idx] ?? 0,
            g: data[idx + 1] ?? 0,
            b: data[idx + 2] ?? 0,
          };
        }
      }
    }

    const rowPitch = params.tileType === 'hex' ? cellSize * 0.866 : cellSize;

    for (let y = 0; y < height; y++) {
      const baseR = Math.floor(y / rowPitch) + 1;
      for (let x = 0; x < width; x++) {
        const baseC = Math.floor(x / cellSize) + 1;

        let d1 = Infinity;
        let d2 = Infinity;
        let bestSeed = seeds[0]!;

        for (let dr = -1; dr <= 1; dr++) {
          const rr = baseR + dr;
          if (rr < 0 || rr >= rows) continue;
          const rowOff = rr * cols;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = baseC + dc;
            if (cc < 0 || cc >= cols) continue;
            const s = seeds[rowOff + cc]!;
            const dist = Math.hypot(x - s.x, y - s.y);
            if (dist < d1) {
              d2 = d1;
              d1 = dist;
              bestSeed = s;
            } else if (dist < d2) {
              d2 = dist;
            }
          }
        }

        const borderDist = (d2 - d1) * 0.5;
        let r: number = bestSeed.r;
        let g: number = bestSeed.g;
        let b: number = bestSeed.b;

        if (bevel01 > 0) {
          const shade =
            ((bestSeed.x - x) + (bestSeed.y - y)) / cellSize * bevel01 * 55;
          r += shade;
          g += shade;
          b += shade;
        }

        const groutMix =
          groutW > 0 ? clamp01(groutW * 0.5 + 0.5 - borderDist) : 0;

        const dstIdx = (y * width + x) << 2;
        out[dstIdx] = clampByte(r + (grout.r - r) * groutMix);
        out[dstIdx + 1] = clampByte(g + (grout.g - g) * groutMix);
        out[dstIdx + 2] = clampByte(b + (grout.b - b) * groutMix);
        out[dstIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: MosaicParams): string {
    const { width, height, data } = source;
    const cellSize = Math.max(8, params.cellSize);
    const groutW = round2(params.groutWidth);
    const shapes: string[] = [];

    if (params.tileType === 'brick') {
      const bw = cellSize * 1.4;
      const bh = cellSize * 0.75;
      const rows = Math.ceil(height / bh);
      const cols = Math.ceil(width / bw) + 1;

      for (let r = 0; r < rows; r++) {
        const shiftX = (r & 1) !== 0 ? -bw * 0.5 : 0;
        for (let c = 0; c < cols; c++) {
          const x = c * bw + shiftX;
          const y = r * bh;
          const cx = Math.max(0, Math.min(width - 1, Math.round(x + bw * 0.5)));
          const cy = Math.max(0, Math.min(height - 1, Math.round(y + bh * 0.5)));
          const idx = (cy * width + cx) << 2;
          const fill = rgbToHex(
            data[idx] ?? 0,
            data[idx + 1] ?? 0,
            data[idx + 2] ?? 0
          );
          shapes.push(
            `<rect x="${round2(x)}" y="${round2(y)}" width="${round2(
              bw
            )}" height="${round2(bh)}" fill="${fill}"/>`
          );
        }
      }
    } else {
      // Hexagonal / polygon tile SVG export
      const rad = cellSize * 0.58;
      const rowH = cellSize * 0.866;
      const rows = Math.ceil(height / rowH) + 1;
      const cols = Math.ceil(width / cellSize) + 1;
      const rng = createPrng(Math.round(params.seed));
      const jit = params.tileType === 'voronoi' ? (params.jitter / 100) * 0.25 : 0;

      for (let r = 0; r < rows; r++) {
        const shiftX = (r & 1) !== 0 ? cellSize * 0.5 : 0;
        for (let c = 0; c < cols; c++) {
          const cx = c * cellSize + shiftX;
          const cy = r * rowH;
          const ix = Math.max(0, Math.min(width - 1, Math.round(cx)));
          const iy = Math.max(0, Math.min(height - 1, Math.round(cy)));
          const idx = (iy * width + ix) << 2;
          const fill: RGB = {
            r: data[idx] ?? 0,
            g: data[idx + 1] ?? 0,
            b: data[idx + 2] ?? 0,
          };

          const pts: string[] = [];
          for (let k = 0; k < 6; k++) {
            const a = ((60 * k - 30) * Math.PI) / 180;
            const rMod = rad * (1 + (rng() - 0.5) * jit);
            pts.push(
              `${round2(cx + rMod * Math.cos(a))},${round2(cy + rMod * Math.sin(a))}`
            );
          }
          shapes.push(
            `<polygon points="${pts.join(' ')}" fill="${rgbToHex(
              fill.r,
              fill.g,
              fill.b
            )}"/>`
          );
        }
      }
    }

    const strokeAttr =
      params.groutWidth > 0
        ? ` stroke="${params.groutColor}" stroke-width="${groutW}" stroke-linejoin="round"`
        : '';
    return svgDocument(
      width,
      height,
      params.groutColor,
      `<g id="mosaic-tiles"${strokeAttr}>${shapes.join('')}</g>`
    );
  },

  randomize(current: MosaicParams, seed: number): MosaicParams {
    const rng = createPrng(seed);
    return {
      ...current,
      tileType: randPick(rng, ['voronoi', 'hex', 'brick']),
      cellSize: randInt(rng, 10, 32),
      jitter: randInt(rng, 40, 95),
      groutWidth: randPick(rng, [1, 1.5, 2, 3]),
      bevel: randInt(rng, 10, 60),
      seed: randInt(rng, 1, 9999),
    };
  },
};
