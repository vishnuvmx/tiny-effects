import React from 'react';
import { EffectDefinition, ParamDef, ParamMap, ParamValue } from '../../shared/types';
import {
  Checkbox,
  ColorField,
  PropertyRow,
  ScrubRow,
  Segmented,
  SliderField,
} from '../components/Controls';
import { Section } from '../components/Section';

interface PropertiesPanelProps {
  effect: EffectDefinition<ParamMap>;
  params: ParamMap;
  onChangeParam: (key: string, value: ParamValue) => void;
  onResetSection: (sectionKeys: string[]) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  effect,
  params,
  onChangeParam,
  onResetSection,
}) => {
  // Group schema parameters by section while preserving declaration order
  const sections: Array<{ name: string; items: ParamDef[] }> = [];
  for (const def of effect.schema) {
    if (def.showWhen && !def.showWhen(params)) {
      continue;
    }
    let group = sections.find((s) => s.name === def.section);
    if (!group) {
      group = { name: def.section, items: [] };
      sections.push(group);
    }
    group.items.push(def);
  }

  return (
    <div className="te-scroll-body">
      {sections.map((section) => (
        <Section
          key={section.name}
          title={section.name}
          onResetSection={() =>
            onResetSection(section.items.map((item) => item.key))
          }
        >
          {section.items.map((def) => {
            const rawVal = params[def.key] ?? def.defaultValue;

            switch (def.type) {
              case 'slider':
                return (
                  <SliderField
                    key={def.key}
                    label={def.label}
                    value={Number(rawVal)}
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    defaultValue={def.defaultValue}
                    unit={def.unit}
                    onChange={(v) => onChangeParam(def.key, v)}
                  />
                );
              case 'scrub':
                return (
                  <ScrubRow
                    key={def.key}
                    label={def.label}
                    value={Number(rawVal)}
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    unit={def.unit}
                    onChange={(v) => onChangeParam(def.key, v)}
                  />
                );
              case 'segmented':
                return (
                  <PropertyRow key={def.key} label={def.label}>
                    <Segmented
                      options={def.options}
                      value={String(rawVal)}
                      onChange={(v) => onChangeParam(def.key, v)}
                    />
                  </PropertyRow>
                );
              case 'select':
                return (
                  <PropertyRow key={def.key} label={def.label}>
                    <select
                      className="te-select"
                      value={String(rawVal)}
                      onChange={(e) => onChangeParam(def.key, e.target.value)}
                    >
                      {def.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </PropertyRow>
                );
              case 'color':
                return (
                  <PropertyRow key={def.key} label={def.label}>
                    <ColorField
                      value={String(rawVal)}
                      presets={def.presets}
                      onChange={(hex) => onChangeParam(def.key, hex)}
                    />
                  </PropertyRow>
                );
              case 'checkbox':
                return (
                  <PropertyRow key={def.key} label={def.label}>
                    <Checkbox
                      checked={Boolean(rawVal)}
                      onChange={(checked) => onChangeParam(def.key, checked)}
                    />
                  </PropertyRow>
                );
              case 'text':
                return (
                  <PropertyRow key={def.key} label={def.label}>
                    <input
                      type="text"
                      className="te-text-input"
                      value={String(rawVal)}
                      placeholder={def.placeholder}
                      onChange={(e) => onChangeParam(def.key, e.target.value)}
                    />
                  </PropertyRow>
                );
            }
          })}
        </Section>
      ))}
    </div>
  );
};

