import { EffectDefinition, ParamMap, PixelBuffer } from '../../shared/types';
import { clamp01, clampByte, hexToRgb, rgbToLuma01 } from '../color';
import { createPrng, randInt, randPick } from '../prng';

export interface NeonGlowParams extends ParamMap {
  threshold: number;
  tubeWidth: number;
  glowRadius: number;
  glowIntensity: number;
  bgBrightness: number;
  colorMode: string;
  primaryColor: string;
  secondaryColor: string;
}

function boxBlurSeparable(
  src: Float32Array,
  temp: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  const rad = Math.max(1, Math.round(radius));
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    let sum = 0;
    let cnt = 0;
    for (let x = -rad; x <= rad; x++) {
      sum += src[rowOff + Math.max(0, Math.min(width - 1, x))] ?? 0;
      cnt++;
    }
    for (let x = 0; x < width; x++) {
      temp[rowOff + x] = sum / cnt;
      sum +=
        (src[rowOff + Math.min(width - 1, x + rad + 1)] ?? 0) -
        (src[rowOff + Math.max(0, x - rad)] ?? 0);
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    let cnt = 0;
    for (let y = -rad; y <= rad; y++) {
      sum += temp[Math.max(0, Math.min(height - 1, y)) * width + x] ?? 0;
      cnt++;
    }
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / cnt;
      sum +=
        (temp[Math.min(height - 1, y + rad + 1) * width + x] ?? 0) -
        (temp[Math.max(0, y - rad) * width + x] ?? 0);
    }
  }
}

export const neonGlowEffect: EffectDefinition<NeonGlowParams> = {
  id: 'neon-glow',
  name: 'Neon Glow',
  category: 'stylise',
  supportsSvg: false,
  defaults: {
    threshold: 32,
    tubeWidth: 2,
    glowRadius: 8,
    glowIntensity: 95,
    bgBrightness: 18,
    colorMode: 'duocolor',
    primaryColor: '#00F0FF',
    secondaryColor: '#FF1E9A',
  },
  schema: [
    {
      key: 'threshold',
      label: 'Edge cutoff',
      section: 'Neon Tubes',
      type: 'slider',
      min: 5,
      max: 80,
      step: 1,
      unit: '%',
      defaultValue: 32,
    },
    {
      key: 'tubeWidth',
      label: 'Tube width',
      section: 'Neon Tubes',
      type: 'slider',
      min: 1,
      max: 5,
      step: 0.5,
      unit: 'px',
      defaultValue: 2,
    },
    {
      key: 'glowRadius',
      label: 'Bloom radius',
      section: 'Neon Tubes',
      type: 'slider',
      min: 2,
      max: 24,
      step: 1,
      unit: 'px',
      defaultValue: 8,
    },
    {
      key: 'glowIntensity',
      label: 'Intensity',
      section: 'Neon Tubes',
      type: 'slider',
      min: 20,
      max: 160,
      step: 1,
      unit: '%',
      defaultValue: 95,
    },
    {
      key: 'bgBrightness',
      label: 'Backdrop',
      section: 'Backdrop & Colour',
      type: 'slider',
      min: 0,
      max: 70,
      step: 1,
      unit: '%',
      defaultValue: 18,
    },
    {
      key: 'colorMode',
      label: 'Mode',
      section: 'Backdrop & Colour',
      type: 'segmented',
      defaultValue: 'duocolor',
      options: [
        { value: 'single', label: 'Single' },
        { value: 'duocolor', label: 'Cyber Duo' },
        { value: 'source', label: 'Vivid Source' },
      ],
    },
    {
      key: 'primaryColor',
      label: 'Neon 1',
      section: 'Backdrop & Colour',
      type: 'color',
      defaultValue: '#00F0FF',
      showWhen: (p) => p.colorMode !== 'source',
    },
    {
      key: 'secondaryColor',
      label: 'Neon 2',
      section: 'Backdrop & Colour',
      type: 'color',
      defaultValue: '#FF1E9A',
      showWhen: (p) => p.colorMode === 'duocolor',
    },
  ],

  renderRaster(source: PixelBuffer, params: NeonGlowParams): PixelBuffer {
    const { width, height, data } = source;
    const total = width * height;
    const out = new Uint8ClampedArray(total * 4);
    const col1 = hexToRgb(params.primaryColor);
    const col2 = hexToRgb(params.secondaryColor);

    const rawLuma = new Float32Array(total);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      rawLuma[p] = rgbToLuma01(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    }

    // 1. Slight pre-smoothing so fine texture noise doesn't trigger false neon fog
    const temp = new Float32Array(total);
    const luma = new Float32Array(total);
    boxBlurSeparable(rawLuma, temp, luma, width, height, 1);

    // 2. Thresholded Sobel edge detector for crisp structural neon tubes
    const edges = new Float32Array(total);
    const cutoff = (params.threshold / 100) * 0.52;
    const invRange = 1 / Math.max(0.05, 0.85 - cutoff);

    for (let y = 1; y < height - 1; y++) {
      const r0 = (y - 1) * width;
      const r1 = y * width;
      const r2 = (y + 1) * width;
      for (let x = 1; x < width - 1; x++) {
        const gx =
          -(luma[r0 + x - 1] ?? 0) +
          (luma[r0 + x + 1] ?? 0) -
          2 * (luma[r1 + x - 1] ?? 0) +
          2 * (luma[r1 + x + 1] ?? 0) -
          (luma[r2 + x - 1] ?? 0) +
          (luma[r2 + x + 1] ?? 0);
        const gy =
          -(luma[r0 + x - 1] ?? 0) -
          2 * (luma[r0 + x] ?? 0) -
          (luma[r0 + x + 1] ?? 0) +
          (luma[r2 + x - 1] ?? 0) +
          2 * (luma[r2 + x] ?? 0) +
          (luma[r2 + x + 1] ?? 0);

        const mag = Math.hypot(gx, gy);
        if (mag > cutoff) {
          const t = clamp01((mag - cutoff) * invRange);
          edges[r1 + x] = t * t * (3 - 2 * t);
        }
      }
    }

    // 3. Multi-stage neon bloom: tight tube corona + wide atmospheric halo
    const tightGlow = new Float32Array(total);
    const wideGlow = new Float32Array(total);
    const tubeRad = Math.max(1, Math.round(params.tubeWidth));
    const haloRad = Math.max(2, Math.round(params.glowRadius));

    boxBlurSeparable(edges, temp, tightGlow, width, height, tubeRad);
    boxBlurSeparable(tightGlow, temp, wideGlow, width, height, haloRad);
    // Second pass on wideGlow for smooth Gaussian-like exponential falloff
    boxBlurSeparable(wideGlow, temp, wideGlow, width, height, Math.max(1, haloRad >> 1));

    const bgKeep = (params.bgBrightness / 100) * 0.65;
    const intensity = params.glowIntensity / 100;

    for (let y = 0; y < height; y++) {
      const ny = y / height;
      const rowOff = y * width;
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const p = rowOff + x;
        const idx = p << 2;

        const sr = data[idx] ?? 0;
        const sg = data[idx + 1] ?? 0;
        const sb = data[idx + 2] ?? 0;
        const pLuma = rawLuma[p] ?? 0;

        let nr = col1.r;
        let ng = col1.g;
        let nb = col1.b;

        if (params.colorMode === 'duocolor') {
          // Angle-and-tone driven neon colour split
          const mixT = clamp01(nx * 0.55 + (1 - ny) * 0.25 + pLuma * 0.2);
          nr = col1.r + (col2.r - col1.r) * mixT;
          ng = col1.g + (col2.g - col1.g) * mixT;
          nb = col1.b + (col2.b - col1.b) * mixT;
        } else if (params.colorMode === 'source') {
          const avg = (sr + sg + sb) / 3;
          const boostedR = avg + (sr - avg) * 2.4;
          const boostedG = avg + (sg - avg) * 2.4;
          const boostedB = avg + (sb - avg) * 2.4;
          const maxCh = Math.max(40, boostedR, boostedG, boostedB);
          nr = clampByte((boostedR / maxCh) * 255);
          ng = clampByte((boostedG / maxCh) * 255);
          nb = clampByte((boostedB / maxCh) * 255);
        }

        // Deep nocturnal tinted backdrop
        const darkLuma = Math.pow(pLuma, 1.6) * bgKeep;
        const baseR = (sr * 0.45 + nr * 0.55) * darkLuma;
        const baseG = (sg * 0.45 + ng * 0.55) * darkLuma;
        const baseB = (sb * 0.45 + nb * 0.55) * darkLuma;

        const edgeCore = edges[p] ?? 0;
        const corona = (tightGlow[p] ?? 0) * 1.65;
        const halo = (wideGlow[p] ?? 0) * 2.35;

        const colorGlow = (corona + halo) * intensity;
        // White-hot gas tube center only on strong edges
        const whiteCore = Math.pow(clamp01(edgeCore + corona * 0.35), 2.1) * 235 * intensity;

        out[idx] = clampByte(baseR + nr * colorGlow + whiteCore);
        out[idx + 1] = clampByte(baseG + ng * colorGlow + whiteCore);
        out[idx + 2] = clampByte(baseB + nb * colorGlow + whiteCore);
        out[idx + 3] = 255;
      }
    }

    return { data: out, width, height };
  },

  randomize(current: NeonGlowParams, seed: number): NeonGlowParams {
    const rng = createPrng(seed);
    const neonHexes = [
      '#00F0FF',
      '#FF1E9A',
      '#39FF14',
      '#FFE600',
      '#FF4D00',
      '#9D4EDD',
    ];
    return {
      ...current,
      threshold: randInt(rng, 22, 48),
      tubeWidth: randPick(rng, [1.5, 2, 2.5, 3]),
      glowRadius: randInt(rng, 5, 14),
      glowIntensity: randInt(rng, 80, 135),
      colorMode: randPick(rng, ['single', 'duocolor', 'source']),
      primaryColor: randPick(rng, neonHexes),
      secondaryColor: randPick(rng, neonHexes),
    };
  },
};
