import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { applyTone01, hexToRgb, rgbToHex, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { escapeXml, round2, svgDocument } from '../svg';

export interface AsciiParams extends ParamMap {
  preset: string;
  customChars: string;
  columns: number;
  charSpacing: number;
  lineHeight: number;
  density: number;
  invert: boolean;
  colorMode: string;
  inkColor: string;
  secondaryColor: string;
  paperColor: string;
  fontFamily: string;
}

const CHAR_PRESETS: Record<string, string> = {
  standard: '@%#*+=-:. ',
  blocks: '█▓▒░ ',
  binary: '10 ',
  minimal: '#+. ',
  matrix: 'MWNXK0Okdlo;:,. ',
};

/**
 * 5x7 crisp bitmap font (each entry is 7 rows of 5-bit integers, MSB on left)
 */
const GLYPH_5X7: Record<string, readonly number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b00100, 0b00100],
  ',': [0, 0, 0, 0, 0b00100, 0b00100, 0b01000],
  ':': [0, 0b00100, 0b00100, 0, 0b00100, 0b00100, 0],
  ';': [0, 0b00100, 0b00100, 0, 0b00100, 0b00100, 0b01000],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '+': [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  '=': [0, 0, 0b11111, 0, 0b11111, 0, 0],
  '*': [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
  '#': [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0],
  '%': [0b11001, 0b11010, 0b00100, 0b01000, 0b10110, 0b00110, 0],
  '@': [0b01110, 0b10001, 0b10111, 0b10101, 0b10110, 0b10000, 0b01110],
  '0': [0b01110, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110, 0],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110, 0],
  'M': [0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001, 0],
  'W': [0b10001, 0b10001, 0b10001, 0b10101, 0b11011, 0b10001, 0],
  'N': [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0],
  'X': [0b10001, 0b01010, 0b00100, 0b00100, 0b01010, 0b10001, 0],
  'K': [0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001, 0],
  'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110, 0],
  'k': [0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0],
  'd': [0b00001, 0b00001, 0b01101, 0b10011, 0b10001, 0b01111, 0],
  'l': [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110, 0],
  'o': [0, 0, 0b01110, 0b10001, 0b10001, 0b01110, 0],
  '/': [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
  '\\': [0b10000, 0b01000, 0b00100, 0b00010, 0b00001, 0, 0],
  '|': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0],
  '█': [0b11111, 0b11111, 0b11111, 0b11111, 0b11111, 0b11111, 0b11111],
  '▓': [0b11101, 0b10111, 0b11101, 0b01111, 0b11101, 0b10111, 0b11101],
  '▒': [0b10101, 0b01010, 0b10101, 0b01010, 0b10101, 0b01010, 0b10101],
  '░': [0b10001, 0b00100, 0b00000, 0b10001, 0b00100, 0b00000, 0b10001],
};

function getGlyphBitmap(ch: string): readonly number[] {
  const exact = GLYPH_5X7[ch];
  if (exact) return exact;
  const upper = GLYPH_5X7[ch.toUpperCase()];
  if (upper) return upper;
  const code = ch.charCodeAt(0) || 42;
  return [
    (code * 13) & 31,
    (code * 7) & 31,
    31,
    (code * 17) & 31,
    (code * 11) & 31,
    (code * 5) & 31,
    0,
  ];
}

function resolveCharset(params: AsciiParams): string {
  if (params.preset === 'custom') {
    return params.customChars.length >= 2 ? params.customChars : '@#+. ';
  }
  return CHAR_PRESETS[params.preset] ?? CHAR_PRESETS.standard ?? '@%#*+=-:. ';
}

export const asciiEffect: EffectDefinition<AsciiParams> = {
  id: 'ascii',
  name: 'ASCII',
  category: 'retro',
  supportsSvg: true,
  defaults: {
    preset: 'standard',
    customChars: '@#S%?*+;:,. ',
    columns: 60,
    charSpacing: 0,
    lineHeight: 1.15,
    density: 0,
    invert: false,
    colorMode: 'mono',
    inkColor: '#111111',
    secondaryColor: '#0066FF',
    paperColor: '#F6F5F2',
    fontFamily: 'monospace',
  },
  schema: [
    {
      key: 'preset',
      label: 'Preset',
      section: 'Characters',
      type: 'select',
      defaultValue: 'standard',
      options: [
        { value: 'standard', label: 'Standard (@%#*+=-:.)' },
        { value: 'blocks', label: 'Blocks (█▓▒░)' },
        { value: 'binary', label: 'Binary (10)' },
        { value: 'minimal', label: 'Minimal (#+.)' },
        { value: 'matrix', label: 'Dense (MWNXK0...)' },
        { value: 'custom', label: 'Custom set' },
      ],
    },
    {
      key: 'customChars',
      label: 'Charset',
      section: 'Characters',
      type: 'text',
      defaultValue: '@#S%?*+;:,. ',
      placeholder: 'Dark to light...',
      showWhen: (p) => p.preset === 'custom',
    },
    {
      key: 'fontFamily',
      label: 'Font',
      section: 'Characters',
      type: 'select',
      defaultValue: 'monospace',
      options: [
        { value: 'monospace', label: 'JetBrains / System Mono' },
        { value: 'Courier New, monospace', label: 'Courier New' },
        { value: 'Consolas, monospace', label: 'Consolas' },
      ],
    },
    {
      key: 'columns',
      label: 'Columns',
      section: 'Layout',
      type: 'slider',
      min: 20,
      max: 120,
      step: 2,
      defaultValue: 60,
    },
    {
      key: 'charSpacing',
      label: 'Tracking',
      section: 'Layout',
      type: 'slider',
      min: -2,
      max: 6,
      step: 0.5,
      defaultValue: 0,
    },
    {
      key: 'lineHeight',
      label: 'Line height',
      section: 'Layout',
      type: 'slider',
      min: 0.8,
      max: 2.0,
      step: 0.05,
      defaultValue: 1.15,
    },
    {
      key: 'density',
      label: 'Density',
      section: 'Tone',
      type: 'slider',
      min: -80,
      max: 80,
      step: 1,
      defaultValue: 0,
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
        { value: 'twotone', label: '2-Tone' },
      ],
    },
    {
      key: 'inkColor',
      label: 'Ink',
      section: 'Colour',
      type: 'color',
      defaultValue: '#111111',
      showWhen: (p) => p.colorMode !== 'source',
    },
    {
      key: 'secondaryColor',
      label: 'Highlight',
      section: 'Colour',
      type: 'color',
      defaultValue: '#0066FF',
      showWhen: (p) => p.colorMode === 'twotone',
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Colour',
      type: 'color',
      defaultValue: '#F6F5F2',
    },
  ],

  renderRaster(source: PixelBuffer, params: AsciiParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const paper = hexToRgb(params.paperColor);
    const ink = hexToRgb(params.inkColor);
    const secondary = hexToRgb(params.secondaryColor);

    for (let i = 0; i < out.length; i += 4) {
      out[i] = paper.r;
      out[i + 1] = paper.g;
      out[i + 2] = paper.b;
      out[i + 3] = 255;
    }

    const charset = resolveCharset(params);
    const cols = Math.max(8, Math.min(200, Math.round(params.columns)));
    const cellW = Math.max(4, width / cols);
    const cellH = Math.max(5, cellW * 1.35 * params.lineHeight);
    const rows = Math.max(4, Math.floor(height / cellH));

    const padX = Math.max(0, Math.round(params.charSpacing * 0.5));

    for (let r = 0; r < rows; r++) {
      const y0 = Math.floor(r * cellH);
      const y1 = Math.min(height, Math.floor((r + 1) * cellH));
      const cy = Math.min(height - 1, Math.floor((y0 + y1) * 0.5));

      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * cellW);
        const x1 = Math.min(width, Math.floor((c + 1) * cellW));
        const cx = Math.min(width - 1, Math.floor((x0 + x1) * 0.5));

        const srcIdx = (cy * width + cx) * 4;
        const sr = source.data[srcIdx] ?? 0;
        const sg = source.data[srcIdx + 1] ?? 0;
        const sb = source.data[srcIdx + 2] ?? 0;

        let luma = applyTone01(rgbToLuma01(sr, sg, sb), params.density, 15);
        if (params.invert) {
          luma = 1 - luma;
        }

        const charIndex = Math.min(
          charset.length - 1,
          Math.max(0, Math.floor(luma * (charset.length - 0.001)))
        );
        const ch = charset[charIndex] ?? ' ';
        if (ch === ' ') continue;

        const glyph = getGlyphBitmap(ch);

        let fg = ink;
        if (params.colorMode === 'source') {
          fg = { r: sr, g: sg, b: sb };
        } else if (params.colorMode === 'twotone') {
          fg = luma > 0.45 ? secondary : ink;
        }

        const drawW = Math.max(2, x1 - x0 - padX);
        const drawH = Math.max(2, y1 - y0);

        for (let py = y0; py < y0 + drawH && py < height; py++) {
          const gy = Math.min(6, Math.floor(((py - y0) / drawH) * 7));
          const rowBits = glyph[gy] ?? 0;
          if (rowBits === 0) continue;

          for (let px = x0; px < x0 + drawW && px < width; px++) {
            const gx = Math.min(4, Math.floor(((px - x0) / drawW) * 5));
            const bit = (rowBits >> (4 - gx)) & 1;
            if (bit) {
              const dstIdx = (py * width + px) * 4;
              out[dstIdx] = fg.r;
              out[dstIdx + 1] = fg.g;
              out[dstIdx + 2] = fg.b;
            }
          }
        }
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: AsciiParams): string {
    const { width, height } = source;
    const charset = resolveCharset(params);
    const cols = Math.max(8, Math.min(160, Math.round(params.columns)));
    const cellW = width / cols;
    const cellH = cellW * 1.35 * params.lineHeight;
    const rows = Math.max(4, Math.floor(height / cellH));
    const fontSize = round2(cellW * 1.45);
    const letterSpacing = round2(params.charSpacing);

    const textNodes: string[] = [];

    for (let r = 0; r < rows; r++) {
      const cy = Math.min(height - 1, Math.floor((r + 0.5) * cellH));
      const yPos = round2((r + 0.82) * cellH);

      if (params.colorMode === 'mono') {
        let rowStr = '';
        for (let c = 0; c < cols; c++) {
          const cx = Math.min(width - 1, Math.floor((c + 0.5) * cellW));
          const idx = (cy * width + cx) * 4;
          let luma = applyTone01(
            rgbToLuma01(
              source.data[idx] ?? 0,
              source.data[idx + 1] ?? 0,
              source.data[idx + 2] ?? 0
            ),
            params.density,
            15
          );
          if (params.invert) luma = 1 - luma;
          const charIndex = Math.min(
            charset.length - 1,
            Math.max(0, Math.floor(luma * (charset.length - 0.001)))
          );
          rowStr += charset[charIndex] ?? ' ';
        }
        textNodes.push(
          `<text x="0" y="${yPos}" xml:space="preserve">${escapeXml(rowStr)}</text>`
        );
      } else {
        for (let c = 0; c < cols; c++) {
          const cx = Math.min(width - 1, Math.floor((c + 0.5) * cellW));
          const idx = (cy * width + cx) * 4;
          const sr = source.data[idx] ?? 0;
          const sg = source.data[idx + 1] ?? 0;
          const sb = source.data[idx + 2] ?? 0;
          let luma = applyTone01(rgbToLuma01(sr, sg, sb), params.density, 15);
          if (params.invert) luma = 1 - luma;
          const charIndex = Math.min(
            charset.length - 1,
            Math.max(0, Math.floor(luma * (charset.length - 0.001)))
          );
          const ch = charset[charIndex] ?? ' ';
          if (ch === ' ') continue;
          const fill =
            params.colorMode === 'source'
              ? rgbToHex(sr, sg, sb)
              : luma > 0.45
              ? params.secondaryColor
              : params.inkColor;
          textNodes.push(
            `<text x="${round2(c * cellW)}" y="${yPos}" fill="${fill}">${escapeXml(
              ch
            )}</text>`
          );
        }
      }
    }

    const body = `<g id="ascii-text" font-family="${escapeXml(
      params.fontFamily
    )}" font-size="${fontSize}" fill="${
      params.inkColor
    }" letter-spacing="${letterSpacing}">${textNodes.join('')}</g>`;

    return svgDocument(width, height, params.paperColor, body);
  },

  randomize(current: AsciiParams, seed: number): AsciiParams {
    const rng = createPrng(seed);
    return {
      ...current,
      preset: randPick(rng, ['standard', 'blocks', 'binary', 'minimal', 'matrix']),
      columns: randInt(rng, 32, 96),
      density: randInt(rng, -35, 35),
      invert: rng() > 0.5,
      colorMode: randPick(rng, ['mono', 'source', 'twotone']),
    };
  },
};
