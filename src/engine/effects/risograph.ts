import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import {
  applyTone01,
  clamp01,
  clampByte,
  hexToRgb,
  RISO_INK_PRESETS,
  rgbToLuma01,
} from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface RisographParams extends ParamMap {
  inkCount: string;
  ink1: string;
  ink2: string;
  ink3: string;
  ink4: string;
  offsetX: number;
  offsetY: number;
  rotation: number;
  inkDensity: number;
  grain: number;
  halftone: boolean;
  dotSpacing: number;
  paperColor: string;
  seed: number;
}

export const risographEffect: EffectDefinition<RisographParams> = {
  id: 'risograph',
  name: 'Risograph',
  category: 'print',
  supportsSvg: false,
  defaults: {
    inkCount: '2',
    ink1: '#FF48B0',
    ink2: '#0078BF',
    ink3: '#FFE800',
    ink4: '#111111',
    offsetX: 4,
    offsetY: 3,
    rotation: 0.8,
    inkDensity: 85,
    grain: 35,
    halftone: true,
    dotSpacing: 5,
    paperColor: '#FBF7F0',
    seed: 108,
  },
  schema: [
    {
      key: 'inkCount',
      label: 'Inks',
      section: 'Drums',
      type: 'segmented',
      defaultValue: '2',
      options: [
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
    },
    {
      key: 'ink1',
      label: 'Drum 1',
      section: 'Drums',
      type: 'color',
      defaultValue: '#FF48B0',
      presets: RISO_INK_PRESETS,
    },
    {
      key: 'ink2',
      label: 'Drum 2',
      section: 'Drums',
      type: 'color',
      defaultValue: '#0078BF',
      presets: RISO_INK_PRESETS,
      showWhen: (p) => Number(p.inkCount) >= 2,
    },
    {
      key: 'ink3',
      label: 'Drum 3',
      section: 'Drums',
      type: 'color',
      defaultValue: '#FFE800',
      presets: RISO_INK_PRESETS,
      showWhen: (p) => Number(p.inkCount) >= 3,
    },
    {
      key: 'ink4',
      label: 'Drum 4',
      section: 'Drums',
      type: 'color',
      defaultValue: '#111111',
      presets: RISO_INK_PRESETS,
      showWhen: (p) => Number(p.inkCount) >= 4,
    },
    {
      key: 'offsetX',
      label: 'Misalign X',
      section: 'Registration',
      type: 'slider',
      min: -24,
      max: 24,
      step: 1,
      unit: 'px',
      defaultValue: 4,
    },
    {
      key: 'offsetY',
      label: 'Misalign Y',
      section: 'Registration',
      type: 'slider',
      min: -24,
      max: 24,
      step: 1,
      unit: 'px',
      defaultValue: 3,
    },
    {
      key: 'rotation',
      label: 'Skew',
      section: 'Registration',
      type: 'slider',
      min: -5,
      max: 5,
      step: 0.2,
      unit: '°',
      defaultValue: 0.8,
    },
    {
      key: 'inkDensity',
      label: 'Density',
      section: 'Texture',
      type: 'slider',
      min: 25,
      max: 100,
      step: 1,
      unit: '%',
      defaultValue: 85,
    },
    {
      key: 'grain',
      label: 'Grain',
      section: 'Texture',
      type: 'slider',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 35,
    },
    {
      key: 'halftone',
      label: 'Screen dots',
      section: 'Texture',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      key: 'dotSpacing',
      label: 'Screen size',
      section: 'Texture',
      type: 'slider',
      min: 3,
      max: 14,
      step: 1,
      unit: 'px',
      defaultValue: 5,
      showWhen: (p) => Boolean(p.halftone),
    },
    {
      key: 'paperColor',
      label: 'Paper',
      section: 'Texture',
      type: 'color',
      defaultValue: '#FBF7F0',
    },
  ],

  renderRaster(source: PixelBuffer, params: RisographParams): PixelBuffer {
    const { width, height, data } = source;
    const out = new Uint8ClampedArray(width * height * 4);
    const paper = hexToRgb(params.paperColor);
    const numInks = Math.max(1, Math.min(4, Number(params.inkCount) || 2));
    const inks = [
      hexToRgb(params.ink1),
      hexToRgb(params.ink2),
      hexToRgb(params.ink3),
      hexToRgb(params.ink4),
    ].slice(0, numInks);

    const rng = createPrng(Math.round(params.seed));
    const density01 = clamp01(params.inkDensity / 100);
    const grain01 = clamp01(params.grain / 100);
    const spacing = Math.max(3, params.dotSpacing);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const rotRad = (params.rotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);

    const screenAngles = [15, 75, 45, 0];
    const screenTrig = screenAngles.map((deg) => {
      const a = (deg * Math.PI) / 180;
      return { cos: Math.cos(a) / spacing, sin: Math.sin(a) / spacing };
    });

    const sampleAt = (sx: number, sy: number) => {
      const ix = sx < 0 ? 0 : sx >= width ? width - 1 : sx | 0;
      const iy = sy < 0 ? 0 : sy >= height ? height - 1 : sy | 0;
      const idx = (iy * width + ix) << 2;
      return {
        r: data[idx] ?? 0,
        g: data[idx + 1] ?? 0,
        b: data[idx + 2] ?? 0,
      };
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let rAcc = paper.r;
        let gAcc = paper.g;
        let bAcc = paper.b;

        for (let d = 0; d < numInks; d++) {
          const ink = inks[d] ?? { r: 17, g: 17, b: 17 };
          const mult = d === 0 ? 0 : d === 1 ? 1 : d === 2 ? -0.8 : 0.5;
          const dx = x - cx - params.offsetX * mult;
          const dy = y - cy - params.offsetY * mult;
          const sx = d === 0 ? x : cx + dx * cosR - dy * sinR;
          const sy = d === 0 ? y : cy + dx * sinR + dy * cosR;

          const px = sampleAt(sx, sy);
          const luma = rgbToLuma01(px.r, px.g, px.b);

          let strength = 0;
          if (numInks === 1) {
            strength = 1 - applyTone01(luma, 0, 20);
          } else if (d === 0) {
            // Warm/shadow/red-magenta separation
            const warm = (px.r * 0.65 + (255 - px.g) * 0.35) / 255;
            strength = clamp01((1 - luma) * 0.75 + warm * 0.35 - 0.15);
          } else if (d === 1) {
            // Cool/cyan-blue separation
            const cool = ((255 - px.r) * 0.55 + px.b * 0.45) / 255;
            strength = clamp01((1 - luma) * 0.7 + cool * 0.4 - 0.15);
          } else if (d === 2) {
            // Yellow/highlight separation
            const yel = ((px.r + px.g) * 0.5 - px.b * 0.7) / 255;
            strength = clamp01(yel * 1.15);
          } else {
            // Key/deep shadow separation
            strength = clamp01((0.45 - luma) * 2.1);
          }

          if (params.halftone) {
            const trig = screenTrig[d] ?? screenTrig[0]!;
            const u = x * trig.cos + y * trig.sin;
            const v = -x * trig.sin + y * trig.cos;
            const fu = u - Math.round(u);
            const fv = v - Math.round(v);
            const dist = Math.hypot(fu, fv) * 1.414;
            const radius = Math.sqrt(strength) * 0.95;
            strength = clamp01((radius + 0.18 - dist) * 2.777);
          }

          if (grain01 > 0 && strength > 0.01) {
            const noise = (rng() - 0.5) * grain01 * 0.85;
            strength = clamp01(strength + noise * strength);
          }

          const alpha = clamp01(strength * density01);
          if (alpha > 0) {
            // Multiply overprint onto paper
            const mr = (rAcc * ink.r) / 255;
            const mg = (gAcc * ink.g) / 255;
            const mb = (bAcc * ink.b) / 255;
            rAcc = rAcc + (mr - rAcc) * alpha;
            gAcc = gAcc + (mg - gAcc) * alpha;
            bAcc = bAcc + (mb - bAcc) * alpha;
          }
        }

        const outIdx = (y * width + x) * 4;
        out[outIdx] = clampByte(rAcc);
        out[outIdx + 1] = clampByte(gAcc);
        out[outIdx + 2] = clampByte(bAcc);
        out[outIdx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: RisographParams, seed: number): RisographParams {
    const rng = createPrng(seed);
    const p1 = randPick(rng, RISO_INK_PRESETS);
    let p2 = randPick(rng, RISO_INK_PRESETS);
    if (p2.hex === p1.hex) {
      p2 = RISO_INK_PRESETS[1] ?? p1;
    }
    const p3 = randPick(rng, RISO_INK_PRESETS);
    return {
      ...current,
      inkCount: randPick(rng, ['2', '2', '3']),
      ink1: p1.hex,
      ink2: p2.hex,
      ink3: p3.hex,
      offsetX: randInt(rng, -10, 10),
      offsetY: randInt(rng, -10, 10),
      grain: randInt(rng, 20, 65),
      seed: randInt(rng, 1, 9999),
    };
  },
};

