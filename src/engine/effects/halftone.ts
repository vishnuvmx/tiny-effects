import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import {
  applyTone01,
  clamp01,
  clampByte,
  hexToRgb,
  rgbToCmyk,
  rgbToHex,
  rgbToLuma01,
} from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface HalftoneParams extends ParamMap {
  shape: string;
  pattern: string;
  size: number;
  spacing: number;
  angle: number;
  contrast: number;
  brightness: number;
  softness: number;
  colorMode: string;
  inkColor: string;
  paperColor: string;
  invert: boolean;
}

const CMYK_INKS = [
  { id: 'cyan', angleOffset: 15, hex: '#009FE3', r: 0, g: 159, b: 227 },
  { id: 'magenta', angleOffset: 75, hex: '#E6007E', r: 230, g: 0, b: 126 },
  { id: 'yellow', angleOffset: 0, hex: '#FFED00', r: 255, g: 237, b: 0 },
  { id: 'black', angleOffset: 45, hex: '#141414', r: 20, g: 20, b: 20 },
] as const;

const RGB_CHANNELS = [
  { id: 'red', angleOffset: 15, hex: '#FF2A2A', ch: 0 },
  { id: 'green', angleOffset: 75, hex: '#18E64C', ch: 1 },
  { id: 'blue', angleOffset: 45, hex: '#2B6BFF', ch: 2 },
] as const;

function samplePixel(
  src: PixelBuffer,
  x: number,
  y: number
): { r: number; g: number; b: number } {
  const ix = x < 0 ? 0 : x >= src.width ? src.width - 1 : x | 0;
  const iy = y < 0 ? 0 : y >= src.height ? src.height - 1 : y | 0;
  const idx = (iy * src.width + ix) << 2;
  return {
    r: src.data[idx] ?? 0,
    g: src.data[idx + 1] ?? 0,
    b: src.data[idx + 2] ?? 0,
  };
}

/**
 * Fast cell evaluation using precomputed cos/sin and inverse spacing.
 */
function evaluateScreenCellFast(
  px: number,
  py: number,
  cx: number,
  cy: number,
  spacing: number,
  invSpacing: number,
  maxRadius: number,
  edgeWidth: number,
  invEdgeWidth: number,
  rad: number,
  cos: number,
  sin: number,
  shapeCode: number, // 0: circle, 1: square, 2: diamond, 3: line
  patternCode: number, // 0: grid, 1: staggered, 2: radial
  getIntensityAt: (sx: number, sy: number) => number
): { coverage: number; sampleX: number; sampleY: number } {
  const dx = px - cx;
  const dy = py - cy;

  let cellCenterX = px;
  let cellCenterY = py;
  let localX = 0;
  let localY = 0;

  if (patternCode === 2) {
    const dist = Math.hypot(dx, dy);
    const ring = Math.max(1, Math.round(dist * invSpacing));
    const ringRadius = ring * spacing;
    const count = Math.max(6, Math.round(6.2831853 * ring));
    const theta = Math.atan2(dy, dx) + rad;
    const sectorStep = 6.2831853 / count;
    const snappedTheta = Math.round(theta / sectorStep) * sectorStep - rad;
    cellCenterX = cx + ringRadius * Math.cos(snappedTheta);
    cellCenterY = cy + ringRadius * Math.sin(snappedTheta);
    const ldx = px - cellCenterX;
    const ldy = py - cellCenterY;
    localX = ldx * cos + ldy * sin;
    localY = -ldx * sin + ldy * cos;
  } else {
    const u = dx * cos + dy * sin;
    const v = -dx * sin + dy * cos;
    const row = Math.round(v * invSpacing);
    const staggerShift =
      patternCode === 1 && (row & 1) !== 0 ? spacing * 0.5 : 0;
    const col = Math.round((u - staggerShift) * invSpacing);

    const cellU = col * spacing + staggerShift;
    const cellV = row * spacing;
    localX = u - cellU;
    localY = v - cellV;

    cellCenterX = cx + cellU * cos - cellV * sin;
    cellCenterY = cy + cellU * sin + cellV * cos;
  }

  const intensity = clamp01(getIntensityAt(cellCenterX, cellCenterY));
  if (intensity <= 0.005) {
    return { coverage: 0, sampleX: cellCenterX, sampleY: cellCenterY };
  }

  const targetRadius = Math.sqrt(intensity) * maxRadius;
  let distMetric = 0;

  if (shapeCode === 1) {
    distMetric = Math.max(Math.abs(localX), Math.abs(localY));
  } else if (shapeCode === 2) {
    distMetric = (Math.abs(localX) + Math.abs(localY)) * 0.75;
  } else if (shapeCode === 3) {
    distMetric = Math.abs(localY);
  } else {
    distMetric = Math.hypot(localX, localY);
  }

  const coverage = clamp01(
    (targetRadius + edgeWidth * 0.5 - distMetric) * invEdgeWidth
  );

  return { coverage, sampleX: cellCenterX, sampleY: cellCenterY };
}

export const halftoneEffect: EffectDefinition<HalftoneParams> = {
  id: 'halftone',
  name: 'Halftone',
  category: 'print',
  supportsSvg: true,
  defaults: {
    shape: 'circle',
    pattern: 'grid',
    size: 6,
    spacing: 8,
    angle: 45,
    contrast: 20,
    brightness: 0,
    softness: 10,
    colorMode: 'mono',
    inkColor: '#111111',
    paperColor: '#FFFFFF',
    invert: false,
  },
  schema: [
    {
      key: 'shape',
      label: 'Shape',
      section: 'Dots',
      type: 'segmented',
      defaultValue: 'circle',
      options: [
        { value: 'circle', label: '●', title: 'Circle' },
        { value: 'square', label: '■', title: 'Square' },
        { value: 'diamond', label: '◆', title: 'Diamond' },
        { value: 'line', label: '╱', title: 'Line' },
      ],
    },
    {
      key: 'pattern',
      label: 'Pattern',
      section: 'Dots',
      type: 'segmented',
      defaultValue: 'grid',
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'staggered', label: 'Hex' },
        { value: 'radial', label: 'Radial' },
      ],
    },
    {
      key: 'size',
      label: 'Size',
      section: 'Dots',
      type: 'slider',
      min: 1,
      max: 28,
      step: 0.5,
      defaultValue: 6,
    },
    {
      key: 'spacing',
      label: 'Spacing',
      section: 'Dots',
      type: 'slider',
      min: 3,
      max: 32,
      step: 1,
      defaultValue: 8,
    },
    {
      key: 'angle',
      label: 'Angle',
      section: 'Dots',
      type: 'slider',
      min: 0,
      max: 180,
      step: 1,
      unit: '°',
      defaultValue: 45,
    },
    {
      key: 'softness',
      label: 'Softness',
      section: 'Dots',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 10,
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone',
      type: 'slider',
      min: -100,
      max: 100,
      step: 1,
      defaultValue: 20,
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
        { value: 'cmyk', label: 'CMYK' },
        { value: 'rgb', label: 'RGB' },
        { value: 'original', label: 'Source' },
      ],
    },
    {
      key: 'inkColor',
      label: 'Ink',
      section: 'Colour',
      type: 'color',
      defaultValue: '#111111',
      showWhen: (p) => p.colorMode === 'mono',
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Colour',
      type: 'color',
      defaultValue: '#FFFFFF',
    },
  ],

  renderRaster(source: PixelBuffer, params: HalftoneParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const spacing = Math.max(2, params.spacing);
    const invSpacing = 1 / spacing;
    const maxRadius = Math.max(0.5, params.size * 0.65);
    const softness01 = clamp01(params.softness / 100);
    const edgeWidth = Math.max(0.65, softness01 * maxRadius * 0.75 + 0.65);
    const invEdgeWidth = 1 / edgeWidth;

    const ink = hexToRgb(params.inkColor);
    const paper = hexToRgb(params.paperColor);
    const cx = width * 0.5;
    const cy = height * 0.5;

    const shapeCode =
      params.shape === 'square'
        ? 1
        : params.shape === 'diamond'
        ? 2
        : params.shape === 'line'
        ? 3
        : 0;
    const patternCode =
      params.pattern === 'staggered' ? 1 : params.pattern === 'radial' ? 2 : 0;

    // Precompute screen trig tables outside pixel loop
    const baseRad = (params.angle * Math.PI) / 180;
    const baseCos = Math.cos(baseRad);
    const baseSin = Math.sin(baseRad);

    const cmykTrig = CMYK_INKS.map((ch) => {
      const r = ((params.angle + ch.angleOffset) * Math.PI) / 180;
      return { ...ch, rad: r, cos: Math.cos(r), sin: Math.sin(r) };
    });

    const rgbTrig = RGB_CHANNELS.map((ch) => {
      const r = ((params.angle + ch.angleOffset) * Math.PI) / 180;
      return { ...ch, rad: r, cos: Math.cos(r), sin: Math.sin(r) };
    });

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const outIdx = (y * width + x) << 2;

        if (params.colorMode === 'cmyk') {
          let rAcc = paper.r;
          let gAcc = paper.g;
          let bAcc = paper.b;

          for (let cIdx = 0; cIdx < 4; cIdx++) {
            const ch = cmykTrig[cIdx]!;
            const { coverage } = evaluateScreenCellFast(
              x,
              y,
              cx,
              cy,
              spacing,
              invSpacing,
              maxRadius,
              edgeWidth,
              invEdgeWidth,
              ch.rad,
              ch.cos,
              ch.sin,
              shapeCode,
              patternCode,
              (sx, sy) => {
                const px = samplePixel(source, sx, sy);
                const tr =
                  applyTone01(px.r / 255, params.brightness, params.contrast) * 255;
                const tg =
                  applyTone01(px.g / 255, params.brightness, params.contrast) * 255;
                const tb =
                  applyTone01(px.b / 255, params.brightness, params.contrast) * 255;
                const cmyk = rgbToCmyk(tr, tg, tb);
                const val =
                  ch.id === 'cyan'
                    ? cmyk.c
                    : ch.id === 'magenta'
                    ? cmyk.m
                    : ch.id === 'yellow'
                    ? cmyk.y
                    : cmyk.k;
                return params.invert ? 1 - val : val;
              }
            );

            if (coverage > 0) {
              const mr = (rAcc * ch.r) / 255;
              const mg = (gAcc * ch.g) / 255;
              const mb = (bAcc * ch.b) / 255;
              rAcc += (mr - rAcc) * coverage;
              gAcc += (mg - gAcc) * coverage;
              bAcc += (mb - bAcc) * coverage;
            }
          }

          out[outIdx] = clampByte(rAcc);
          out[outIdx + 1] = clampByte(gAcc);
          out[outIdx + 2] = clampByte(bAcc);
          out[outIdx + 3] = 255;
        } else if (params.colorMode === 'rgb') {
          let rOut = 18;
          let gOut = 18;
          let bOut = 18;

          for (let cIdx = 0; cIdx < 3; cIdx++) {
            const ch = rgbTrig[cIdx]!;
            const { coverage } = evaluateScreenCellFast(
              x,
              y,
              cx,
              cy,
              spacing,
              invSpacing,
              maxRadius,
              edgeWidth,
              invEdgeWidth,
              ch.rad,
              ch.cos,
              ch.sin,
              shapeCode,
              patternCode,
              (sx, sy) => {
                const px = samplePixel(source, sx, sy);
                const raw = ch.ch === 0 ? px.r : ch.ch === 1 ? px.g : px.b;
                const toned = applyTone01(
                  raw / 255,
                  params.brightness,
                  params.contrast
                );
                return params.invert ? 1 - toned : toned;
              }
            );

            if (ch.ch === 0) rOut = clampByte(18 + coverage * 237);
            if (ch.ch === 1) gOut = clampByte(18 + coverage * 237);
            if (ch.ch === 2) bOut = clampByte(18 + coverage * 237);
          }

          out[outIdx] = rOut;
          out[outIdx + 1] = gOut;
          out[outIdx + 2] = bOut;
          out[outIdx + 3] = 255;
        } else {
          const { coverage, sampleX, sampleY } = evaluateScreenCellFast(
            x,
            y,
            cx,
            cy,
            spacing,
            invSpacing,
            maxRadius,
            edgeWidth,
            invEdgeWidth,
            baseRad,
            baseCos,
            baseSin,
            shapeCode,
            patternCode,
            (sx, sy) => {
              const px = samplePixel(source, sx, sy);
              const luma = applyTone01(
                rgbToLuma01(px.r, px.g, px.b),
                params.brightness,
                params.contrast
              );
              return params.invert ? luma : 1 - luma;
            }
          );

          const fg =
            params.colorMode === 'original'
              ? samplePixel(source, sampleX, sampleY)
              : ink;

          out[outIdx] = clampByte(paper.r + (fg.r - paper.r) * coverage);
          out[outIdx + 1] = clampByte(paper.g + (fg.g - paper.g) * coverage);
          out[outIdx + 2] = clampByte(paper.b + (fg.b - paper.b) * coverage);
          out[outIdx + 3] = 255;
        }
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: HalftoneParams): string {
    const { width, height } = source;
    const spacing = Math.max(3, params.spacing);
    const maxRadius = Math.max(0.5, params.size * 0.65);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const diag = Math.hypot(width, height) * 0.55;
    const steps = Math.ceil(diag / spacing);

    const renderChannelGroup = (
      id: string,
      angleDeg: number,
      defaultFill: string,
      getSample: (sx: number, sy: number) => { intensity: number; fill: string }
    ): string => {
      const rad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const shapes: string[] = [];

      for (let row = -steps; row <= steps; row++) {
        const staggerShift =
          params.pattern === 'staggered' && (row & 1) !== 0 ? spacing * 0.5 : 0;
        for (let col = -steps; col <= steps; col++) {
          const u = col * spacing + staggerShift;
          const v = row * spacing;
          const sx = cx + u * cos - v * sin;
          const sy = cy + u * sin + v * cos;

          if (
            sx < -spacing ||
            sx > width + spacing ||
            sy < -spacing ||
            sy > height + spacing
          ) {
            continue;
          }

          const { intensity, fill } = getSample(sx, sy);
          if (intensity <= 0.03) continue;

          const r = Math.sqrt(clamp01(intensity)) * maxRadius;
          if (r < 0.35) continue;

          const fillAttr = fill !== defaultFill ? ` fill="${fill}"` : '';

          if (params.shape === 'square') {
            const side = round2(r * 1.8);
            const x = round2(sx - r * 0.9);
            const y = round2(sy - r * 0.9);
            shapes.push(
              `<rect x="${x}" y="${y}" width="${side}" height="${side}" transform="rotate(${round2(
                angleDeg
              )} ${round2(sx)} ${round2(sy)})"${fillAttr}/>`
            );
          } else if (params.shape === 'diamond') {
            const d = r * 1.3;
            const p1 = `${round2(sx)},${round2(sy - d)}`;
            const p2 = `${round2(sx + d)},${round2(sy)}`;
            const p3 = `${round2(sx)},${round2(sy + d)}`;
            const p4 = `${round2(sx - d)},${round2(sy)}`;
            shapes.push(`<polygon points="${p1} ${p2} ${p3} ${p4}"${fillAttr}/>`);
          } else if (params.shape === 'line') {
            const half = spacing * 0.52;
            const x1 = round2(sx - half * cos);
            const y1 = round2(sy - half * sin);
            const x2 = round2(sx + half * cos);
            const y2 = round2(sy + half * sin);
            shapes.push(
              `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${fill}" stroke-width="${round2(
                r * 1.5
              )}" stroke-linecap="round"/>`
            );
          } else {
            shapes.push(
              `<circle cx="${round2(sx)}" cy="${round2(sy)}" r="${round2(r)}"${fillAttr}/>`
            );
          }
        }
      }

      return `<g id="halftone-${id}" fill="${defaultFill}" opacity="0.92">${shapes.join(
        ''
      )}</g>`;
    };

    if (params.colorMode === 'cmyk') {
      const groups = CMYK_INKS.map((ch) =>
        renderChannelGroup(ch.id, params.angle + ch.angleOffset, ch.hex, (sx, sy) => {
          const px = samplePixel(source, sx, sy);
          const tr =
            applyTone01(px.r / 255, params.brightness, params.contrast) * 255;
          const tg =
            applyTone01(px.g / 255, params.brightness, params.contrast) * 255;
          const tb =
            applyTone01(px.b / 255, params.brightness, params.contrast) * 255;
          const cmyk = rgbToCmyk(tr, tg, tb);
          const val =
            ch.id === 'cyan'
              ? cmyk.c
              : ch.id === 'magenta'
              ? cmyk.m
              : ch.id === 'yellow'
              ? cmyk.y
              : cmyk.k;
          return {
            intensity: params.invert ? 1 - val : val,
            fill: ch.hex,
          };
        })
      );
      return svgDocument(width, height, params.paperColor, groups.join(''));
    }

    const group = renderChannelGroup('mono', params.angle, params.inkColor, (sx, sy) => {
      const px = samplePixel(source, sx, sy);
      const luma = applyTone01(
        rgbToLuma01(px.r, px.g, px.b),
        params.brightness,
        params.contrast
      );
      const intensity = params.invert ? luma : 1 - luma;
      const fill =
        params.colorMode === 'original'
          ? rgbToHex(px.r, px.g, px.b)
          : params.inkColor;
      return { intensity, fill };
    });

    return svgDocument(width, height, params.paperColor, group);
  },

  randomize(current: HalftoneParams, seed: number): HalftoneParams {
    const rng = createPrng(seed);
    return {
      ...current,
      shape: randPick(rng, ['circle', 'square', 'diamond', 'line']),
      pattern: randPick(rng, ['grid', 'staggered', 'radial']),
      size: randInt(rng, 4, 14),
      spacing: randInt(rng, 5, 16),
      angle: randInt(rng, 0, 175),
      contrast: randInt(rng, -10, 55),
      colorMode: randPick(rng, ['mono', 'cmyk', 'rgb', 'original']),
    };
  },
};
