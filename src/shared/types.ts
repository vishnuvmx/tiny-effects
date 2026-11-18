export type EffectCategory = 'print' | 'retro' | 'distort' | 'stylise';

export type EffectId =
  | 'halftone'
  | 'ascii'
  | 'dither'
  | 'pixelate'
  | 'glitch'
  | 'risograph'
  | 'stippling'
  | 'crosshatch'
  | 'photocopy'
  | 'pixel-sorting'
  | 'rgb-split'
  | 'crt-scanlines'
  | 'cutout'
  | 'neon-glow'
  | 'film-grain'
  | 'engraving'
  | 'mosaic'
  | 'watercolor'
  | 'emboss'
  | 'duotone';

export type ParamValue = number | string | boolean;

export type ParamMap = Record<string, ParamValue>;

export interface BaseParamDef {
  key: string;
  label: string;
  section: string;
  showWhen?: (params: ParamMap) => boolean;
}

export interface SliderParamDef extends BaseParamDef {
  type: 'slider';
  min: number;
  max: number;
  step: number;
  unit?: string;
  defaultValue: number;
}

export interface ScrubParamDef extends BaseParamDef {
  type: 'scrub';
  min: number;
  max: number;
  step: number;
  unit?: string;
  defaultValue: number;
}

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: string;
  title?: string;
}

export interface SegmentedParamDef extends BaseParamDef {
  type: 'segmented';
  options: SegmentedOption[];
  defaultValue: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectParamDef extends BaseParamDef {
  type: 'select';
  options: SelectOption[];
  defaultValue: string;
}

export interface ColorParamDef extends BaseParamDef {
  type: 'color';
  defaultValue: string;
  presets?: { label: string; hex: string }[];
}

export interface CheckboxParamDef extends BaseParamDef {
  type: 'checkbox';
  defaultValue: boolean;
}

export interface TextParamDef extends BaseParamDef {
  type: 'text';
  defaultValue: string;
  placeholder?: string;
}

export type ParamDef =
  | SliderParamDef
  | ScrubParamDef
  | SegmentedParamDef
  | SelectParamDef
  | ColorParamDef
  | CheckboxParamDef
  | TextParamDef;

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface EffectDefinition<P extends ParamMap = ParamMap> {
  id: EffectId;
  name: string;
  category: EffectCategory;
  supportsSvg: boolean;
  defaults: P;
  schema: ParamDef[];
  renderRaster: (source: PixelBuffer, params: P) => PixelBuffer;
  renderSvg?: (source: PixelBuffer, params: P) => string;
  randomize: (current: P, seed: number) => P;
}
