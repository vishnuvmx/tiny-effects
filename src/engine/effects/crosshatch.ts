import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { applyTone01, clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';
import { round2, svgDocument } from '../svg';

export interface CrosshatchParams extends ParamMap {
  layers: string;
  spacing: number;
  lineWeight: number;
  angleOffset: number;
  contrast: number;
  jitter: number;
  inkColor: string;
  paperColor: string;
  seed: number;
}

interface HatchSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const LAYER_THRESHOLDS = [0.75, 0.52, 0.32, 0.16] as const;
const LAYER_BASE_ANGLES = [45, 135, 10, 100] as const;

function generateCrosshatchLayers(
  source: PixelBuffer,
  params: CrosshatchParams
): HatchSegment[][] {
  const { width, height, data } = source;
  const numLayers = Math.max(1, Math.min(4, Number(params.layers) || 3));
  const spacing = Math.max(3, params.spacing);
  const stepAlong = Math.max(3, spacing * 0.85);
  const jitterAmp = (params.jitter / 100) * spacing * 0.45;
  const rng = createPrng(Math.round(params.seed));

  const cx = width * 0.5;
  const cy = height * 0.5;
  const diag = Math.hypot(width, height) * 0.55;
  const lineCount = Math.ceil(diag / spacing);
  const segSteps = Math.ceil(diag / stepAlong);

  const sampleLuma = (x: number, y: number): number => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const idx = (iy * width + ix) * 4;
    return applyTone01(
      rgbToLuma01(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0),
      0,
      params.contrast
    );
  };

  const allLayers: HatchSegment[][] = [];

  for (let l = 0; l < numLayers; l++) {
    const baseAngle = (LAYER_BASE_ANGLES[l] ?? 45) + params.angleOffset;
    const rad = (baseAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const threshold = LAYER_THRESHOLDS[l] ?? 0.5;
    const segments: HatchSegment[] = [];

    for (let row = -lineCount; row <= lineCount; row++) {
      const vBase = row * spacing;
      let active = false;
      let startX = 0;
      let startY = 0;
      let prevX = 0;
      let prevY = 0;

      for (let s = -segSteps; s <= segSteps; s++) {
        const u = s * stepAlong;
        const jv = jitterAmp > 0 ? (rng() - 0.5) * jitterAmp : 0;
        const v = vBase + jv;
        const px = cx + u * cos - v * sin;
        const py = cy + u * sin + v * cos;

        const inside = px >= 0 && px < width && py >= 0 && py < height;
        const darkEnough = inside && sampleLuma(px, py) < threshold;

        if (darkEnough) {
          if (!active) {
            active = true;
            startX = px;
            startY = py;
          }
          prevX = px;
          prevY = py;
        } else if (active) {
          if (Math.hypot(prevX - startX, prevY - startY) >= 1.5) {
            segments.push({ x1: startX, y1: startY, x2: prevX, y2: prevY });
          }
          active = false;
        }
      }

      if (active && Math.hypot(prevX - startX, prevY - startY) >= 1.5) {
        segments.push({ x1: startX, y1: startY, x2: prevX, y2: prevY });
      }
    }

    allLayers.push(segments);
  }

  return allLayers;
}

function drawAntiAliasedSegment(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  seg: HatchSegment,
  halfWeight: number,
  inkR: number,
  inkG: number,
  inkB: number
): void {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.01) return;

  const pad = halfWeight + 1.2;
  const minX = Math.max(0, Math.floor(Math.min(seg.x1, seg.x2) - pad));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(seg.x1, seg.x2) + pad));
  const minY = Math.max(0, Math.floor(Math.min(seg.y1, seg.y2) - pad));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(seg.y1, seg.y2) + pad));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const t = clamp01(((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq);
      const projX = seg.x1 + t * dx;
      const projY = seg.y1 + t * dy;
      const dist = Math.hypot(px - projX, py - projY);
      const cov = clamp01(halfWeight + 0.55 - dist) * 0.9;
      if (cov > 0) {
        const idx = (py * width + px) * 4;
        const cr = out[idx] ?? 255;
        const cg = out[idx + 1] ?? 255;
        const cb = out[idx + 2] ?? 255;
        out[idx] = clampByte(cr + (inkR - cr) * cov);
        out[idx + 1] = clampByte(cg + (inkG - cg) * cov);
        out[idx + 2] = clampByte(cb + (inkB - cb) * cov);
      }
    }
  }
}

export const crosshatchEffect: EffectDefinition<CrosshatchParams> = {
  id: 'crosshatch',
  name: 'Crosshatch',
  category: 'print',
  supportsSvg: true,
  defaults: {
    layers: '3',
    spacing: 6,
    lineWeight: 1.2,
    angleOffset: 0,
    contrast: 20,
    jitter: 25,
    inkColor: '#191816',
    paperColor: '#FAF7F0',
    seed: 77,
  },
  schema: [
    {
      key: 'layers',
      label: 'Passes',
      section: 'Hatching',
      type: 'segmented',
      defaultValue: '3',
      options: [
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
    },
    {
      key: 'spacing',
      label: 'Spacing',
      section: 'Hatching',
      type: 'slider',
      min: 3,
      max: 18,
      step: 0.5,
      unit: 'px',
      defaultValue: 6,
    },
    {
      key: 'lineWeight',
      label: 'Weight',
      section: 'Hatching',
      type: 'slider',
      min: 0.5,
      max: 4,
      step: 0.1,
      unit: 'px',
      defaultValue: 1.2,
    },
    {
      key: 'angleOffset',
      label: 'Angle',
      section: 'Hatching',
      type: 'slider',
      min: 0,
      max: 180,
      step: 1,
      unit: '°',
      defaultValue: 0,
    },
    {
      key: 'jitter',
      label: 'Hand-drawn',
      section: 'Hatching',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 25,
    },
    {
      key: 'contrast',
      label: 'Contrast',
      section: 'Tone & Ink',
      type: 'slider',
      min: -80,
      max: 80,
      step: 1,
      defaultValue: 20,
    },
    {
      key: 'inkColor',
      label: 'Ink',
      section: 'Tone & Ink',
      type: 'color',
      defaultValue: '#191816',
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Tone & Ink',
      type: 'color',
      defaultValue: '#FAF7F0',
    },
  ],

  renderRaster(source: PixelBuffer, params: CrosshatchParams): PixelBuffer {
    const { width, height } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const paper = hexToRgb(params.paperColor);
    const ink = hexToRgb(params.inkColor);

    for (let i = 0; i < out.length; i += 4) {
      out[i] = paper.r;
      out[i + 1] = paper.g;
      out[i + 2] = paper.b;
      out[i + 3] = 255;
    }

    const hatchLayers = generateCrosshatchLayers(source, params);
    const halfWeight = Math.max(0.25, params.lineWeight * 0.5);

    for (const segments of hatchLayers) {
      for (const seg of segments) {
        drawAntiAliasedSegment(
          out,
          width,
          height,
          seg,
          halfWeight,
          ink.r,
          ink.g,
          ink.b
        );
      }
    }

    return { data: out, width, height };
  },

  renderSvg(source: PixelBuffer, params: CrosshatchParams): string {
    const { width, height } = source;
    const hatchLayers = generateCrosshatchLayers(source, params);
    const strokeW = round2(params.lineWeight);

    const groups: string[] = [];
    hatchLayers.forEach((segments, idx) => {
      if (segments.length === 0) return;
      const d = segments
        .map(
          (s) =>
            `M${round2(s.x1)} ${round2(s.y1)}L${round2(s.x2)} ${round2(s.y2)}`
        )
        .join('');
      groups.push(
        `<g id="hatch-pass-${idx + 1}" stroke="${
          params.inkColor
        }" stroke-width="${strokeW}" stroke-linecap="round" fill="none"><path d="${d}"/></g>`
      );
    });

    return svgDocument(width, height, params.paperColor, groups.join(''));
  },

  randomize(current: CrosshatchParams, seed: number): CrosshatchParams {
    const rng = createPrng(seed);
    return {
      ...current,
      layers: randPick(rng, ['2', '3', '4']),
      spacing: randInt(rng, 4, 11),
      lineWeight: randInt(rng, 8, 22) / 10,
      angleOffset: randInt(rng, 0, 175),
      jitter: randInt(rng, 10, 65),
      seed: randInt(rng, 1, 9999),
    };
  },
};

