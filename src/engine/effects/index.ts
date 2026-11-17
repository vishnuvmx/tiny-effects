import { EffectDefinition, EffectId, ParamMap } from '../../shared/types';
import { halftoneEffect } from './halftone';
import { asciiEffect } from './ascii';
import { ditherEffect } from './dither';
import { pixelateEffect } from './pixelate';
import { glitchEffect } from './glitch';
import { risographEffect } from './risograph';
import { stipplingEffect } from './stippling';
import { crosshatchEffect } from './crosshatch';

export const EFFECTS_LIST: readonly EffectDefinition<ParamMap>[] = [
  halftoneEffect as unknown as EffectDefinition<ParamMap>,
  asciiEffect as unknown as EffectDefinition<ParamMap>,
  ditherEffect as unknown as EffectDefinition<ParamMap>,
  pixelateEffect as unknown as EffectDefinition<ParamMap>,
  glitchEffect as unknown as EffectDefinition<ParamMap>,
  risographEffect as unknown as EffectDefinition<ParamMap>,
  stipplingEffect as unknown as EffectDefinition<ParamMap>,
  crosshatchEffect as unknown as EffectDefinition<ParamMap>,
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
};

export function getEffectById(id: EffectId): EffectDefinition<ParamMap> {
  return EFFECTS_BY_ID[id];
}

