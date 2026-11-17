export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export function clampByte(val: number): number {
  return val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
}

export function clamp01(val: number): number {
  return val < 0 ? 0 : val > 1 ? 1 : val;
}

export function hexToRgb(hex: string): RGB {
  const cleaned = hex.replace(/^#/, '').trim();
  if (cleaned.length === 3) {
    const r = parseInt((cleaned[0] ?? '0') + (cleaned[0] ?? '0'), 16);
    const g = parseInt((cleaned[1] ?? '0') + (cleaned[1] ?? '0'), 16);
    const b = parseInt((cleaned[2] ?? '0') + (cleaned[2] ?? '0'), 16);
    return {
      r: Number.isNaN(r) ? 0 : r,
      g: Number.isNaN(g) ? 0 : g,
      b: Number.isNaN(b) ? 0 : b,
    };
  }
  const num = parseInt(cleaned.slice(0, 6), 16);
  if (Number.isNaN(num)) {
    return { r: 17, g: 17, b: 17 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hr = clampByte(r).toString(16).padStart(2, '0');
  const hg = clampByte(g).toString(16).padStart(2, '0');
  const hb = clampByte(b).toString(16).padStart(2, '0');
  return `#${hr}${hg}${hb}`.toUpperCase();
}

/**
 * Perceptual luminance in [0, 1]
 */
export function rgbToLuma01(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Applies brightness (-100..100) and contrast (-100..100) to a channel in [0..255]
 */
export function applyToneByte(
  value: number,
  brightness: number,
  contrast: number
): number {
  const bOffset = (brightness / 100) * 255;
  const factor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  return clampByte(factor * (value + bOffset - 128) + 128);
}

/**
 * Applies brightness (-100..100) and contrast (-100..100) to a normalized [0..1] value
 */
export function applyTone01(
  value: number,
  brightness: number,
  contrast: number
): number {
  return applyToneByte(value * 255, brightness, contrast) / 255;
}

export function rgbToCmyk(r: number, g: number, b: number): CMYK {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 0.9999) {
    return { c: 0, m: 0, y: 0, k: 1 };
  }
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return {
    c: clamp01(c),
    m: clamp01(m),
    y: clamp01(y),
    k: clamp01(k),
  };
}

export const RETRO_PALETTES: Record<string, RGB[]> = {
  gameboy: [
    { r: 15, g: 56, b: 15 },
    { r: 48, g: 98, b: 48 },
    { r: 139, g: 172, b: 15 },
    { r: 155, g: 188, b: 15 },
  ],
  newspaper: [
    { r: 24, g: 23, b: 21 },
    { r: 112, g: 108, b: 100 },
    { r: 184, g: 178, b: 166 },
    { r: 244, g: 239, b: 228 },
  ],
  cga: [
    { r: 0, g: 0, b: 0 },
    { r: 85, g: 255, b: 255 },
    { r: 255, g: 85, b: 255 },
    { r: 255, g: 255, b: 255 },
  ],
  cgaWarm: [
    { r: 0, g: 0, b: 0 },
    { r: 85, g: 255, b: 85 },
    { r: 255, g: 85, b: 85 },
    { r: 255, g: 255, b: 85 },
  ],
  pico8: [
    { r: 0, g: 0, b: 0 },
    { r: 29, g: 43, b: 83 },
    { r: 126, g: 37, b: 83 },
    { r: 0, g: 135, b: 81 },
    { r: 171, g: 82, b: 54 },
    { r: 95, g: 87, b: 79 },
    { r: 194, g: 195, b: 199 },
    { r: 255, g: 241, b: 232 },
  ],
  sweetie16: [
    { r: 26, g: 28, b: 44 },
    { r: 93, g: 39, b: 93 },
    { r: 177, g: 62, b: 83 },
    { r: 239, g: 125, b: 87 },
    { r: 255, g: 205, b: 117 },
    { r: 167, g: 240, b: 112 },
    { r: 56, g: 183, b: 100 },
    { r: 37, g: 113, b: 121 },
    { r: 41, g: 54, b: 111 },
    { r: 59, g: 93, b: 201 },
    { r: 65, g: 166, b: 246 },
    { r: 115, g: 239, b: 247 },
    { r: 244, g: 244, b: 244 },
    { r: 148, g: 176, b: 194 },
    { r: 86, g: 108, b: 134 },
    { r: 51, g: 60, b: 87 },
  ],
};

export const RISO_INK_PRESETS: Array<{ label: string; hex: string }> = [
  { label: 'Fluorescent Pink', hex: '#FF48B0' },
  { label: 'Riso Blue', hex: '#0078BF' },
  { label: 'Yellow', hex: '#FFE800' },
  { label: 'Kelly Green', hex: '#00A95C' },
  { label: 'Bright Red', hex: '#F15060' },
  { label: 'Teal', hex: '#00838A' },
  { label: 'Purple', hex: '#765BA7' },
  { label: 'Riso Black', hex: '#111111' },
];

export function findNearestColor(r: number, g: number, b: number, palette: readonly RGB[]): RGB {
  let best = palette[0] ?? { r: 0, g: 0, b: 0 };
  let minDist = Infinity;
  for (const col of palette) {
    const dr = r - col.r;
    const dg = g - col.g;
    const db = b - col.b;
    const dist = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
    if (dist < minDist) {
      minDist = dist;
      best = col;
    }
  }
  return best;
}

