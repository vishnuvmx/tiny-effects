import { EffectDefinition, EffectId, ParamMap } from '../../shared/types';
import { halftoneEffect } from './halftone';
import { asciiEffect } from './ascii';
import { ditherEffect } from './dither';
import { pixelateEffect } from './pixelate';
import { glitchEffect } from './glitch';
import { risographEffect } from './risograph';
import { stipplingEffect } from './stippling';
import { crosshatchEffect } from './crosshatch';
import { photocopyEffect } from './photocopy';
import { pixelSortingEffect } from './pixelSorting';
import { rgbSplitEffect } from './rgbSplit';
import { crtScanlinesEffect } from './crtScanlines';
import { cutoutEffect } from './cutout';
import { neonGlowEffect } from './neonGlow';
import { filmGrainEffect } from './filmGrain';
import { engravingEffect } from './engraving';
import { mosaicEffect } from './mosaic';
import { watercolorEffect } from './watercolor';
import { embossEffect } from './emboss';
import { duotoneEffect } from './duotone';

export const EFFECTS_LIST: readonly EffectDefinition<ParamMap>[] = [
  halftoneEffect as unknown as EffectDefinition<ParamMap>,
  asciiEffect as unknown as EffectDefinition<ParamMap>,
  ditherEffect as unknown as EffectDefinition<ParamMap>,
  pixelateEffect as unknown as EffectDefinition<ParamMap>,
  glitchEffect as unknown as EffectDefinition<ParamMap>,
  risographEffect as unknown as EffectDefinition<ParamMap>,
  stipplingEffect as unknown as EffectDefinition<ParamMap>,
  crosshatchEffect as unknown as EffectDefinition<ParamMap>,
  photocopyEffect as unknown as EffectDefinition<ParamMap>,
  pixelSortingEffect as unknown as EffectDefinition<ParamMap>,
  rgbSplitEffect as unknown as EffectDefinition<ParamMap>,
  crtScanlinesEffect as unknown as EffectDefinition<ParamMap>,
  cutoutEffect as unknown as EffectDefinition<ParamMap>,
  neonGlowEffect as unknown as EffectDefinition<ParamMap>,
  filmGrainEffect as unknown as EffectDefinition<ParamMap>,
  engravingEffect as unknown as EffectDefinition<ParamMap>,
  mosaicEffect as unknown as EffectDefinition<ParamMap>,
  watercolorEffect as unknown as EffectDefinition<ParamMap>,
  embossEffect as unknown as EffectDefinition<ParamMap>,
  duotoneEffect as unknown as EffectDefinition<ParamMap>,
];

export const EFFECTS_BY_ID: Record<EffectId, EffectDefinition<ParamMap>> = {
  halftone: halftoneEffect as unknown as EffectDefinition<ParamMap>,
  ascii: asciiEffect as unknown as EffectDefinition<ParamMap>,
  dither: ditherEffect as unknown as EffectDefinition<ParamMap>,
  pixelate: pixelateEffect as unknown as EffectDefinition<ParamMap>,
  glitch: glitchEffect as unknown as EffectDefinition<ParamMap>,
  risograph: risographEffect as unknown as EffectDefinition<ParamMap>,
  stippling: stipplingEffect as unknown as EffectDefinition<ParamMap>,
  crosshatch: crosshatchEffect as unknown as EffectDefinition<ParamMap>,
  photocopy: photocopyEffect as unknown as EffectDefinition<ParamMap>,
  'pixel-sorting': pixelSortingEffect as unknown as EffectDefinition<ParamMap>,
  'rgb-split': rgbSplitEffect as unknown as EffectDefinition<ParamMap>,
  'crt-scanlines': crtScanlinesEffect as unknown as EffectDefinition<ParamMap>,
  cutout: cutoutEffect as unknown as EffectDefinition<ParamMap>,
  'neon-glow': neonGlowEffect as unknown as EffectDefinition<ParamMap>,
  'film-grain': filmGrainEffect as unknown as EffectDefinition<ParamMap>,
  engraving: engravingEffect as unknown as EffectDefinition<ParamMap>,
  mosaic: mosaicEffect as unknown as EffectDefinition<ParamMap>,
  watercolor: watercolorEffect as unknown as EffectDefinition<ParamMap>,
  emboss: embossEffect as unknown as EffectDefinition<ParamMap>,
  duotone: duotoneEffect as unknown as EffectDefinition<ParamMap>,
};

export function getEffectById(id: EffectId): EffectDefinition<ParamMap> {
  return EFFECTS_BY_ID[id];
}
