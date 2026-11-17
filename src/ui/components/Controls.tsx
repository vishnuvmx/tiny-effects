import React from 'react';
import { SegmentedOption } from '../../shared/types';
import { IconCheck } from './Icons';
import { ScrubInput, useLabelScrub } from './ScrubInput';

interface PropertyRowProps {
  label: string;
  onLabelMouseDown?: (e: React.MouseEvent) => void;
  title?: string;
  children: React.ReactNode;
}

export const PropertyRow: React.FC<PropertyRowProps> = ({
  label,
  onLabelMouseDown,
  title,
  children,
}) => (
  <div className="te-prop-row">
    <div
      className="te-prop-label"
      data-scrubbable={Boolean(onLabelMouseDown)}
      onMouseDown={onLabelMouseDown}
      title={
        onLabelMouseDown
          ? `${title ?? label} (Drag to scrub, Shift ×10, Alt ×0.1)`
          : title ?? label
      }
    >
      {label}
    </div>
    <div className="te-prop-control">{children}</div>
  </div>
);

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  onChange: (value: number) => void;
}

export const SliderField: React.FC<SliderFieldProps> = ({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  unit,
  onChange,
}) => {
  const onLabelMouseDown = useLabelScrub(value, min, max, step, onChange);

  return (
    <PropertyRow label={label} onLabelMouseDown={onLabelMouseDown}>
      <div
        className="te-slider-track-wrap"
        onDoubleClick={() => onChange(defaultValue)}
        title="Double-click to reset to default"
      >
        <input
          type="range"
          className="te-slider-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </div>
      <ScrubInput
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        onChange={onChange}
      />
    </PropertyRow>
  );
};

interface ScrubRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

export const ScrubRow: React.FC<ScrubRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}) => {
  const onLabelMouseDown = useLabelScrub(value, min, max, step, onChange);

  return (
    <PropertyRow label={label} onLabelMouseDown={onLabelMouseDown}>
      <ScrubInput
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        onChange={onChange}
      />
    </PropertyRow>
  );
};

interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
}

export const Segmented: React.FC<SegmentedProps> = ({
  options,
  value,
  onChange,
}) => (
  <div className="te-segmented" role="group">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        className="te-segmented-btn"
        data-active={opt.value === value}
        title={opt.title ?? opt.label}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

interface ColorFieldProps {
  value: string;
  presets?: { label: string; hex: string }[];
  onChange: (hex: string) => void;
}

export const ColorField: React.FC<ColorFieldProps> = ({
  value,
  presets,
  onChange,
}) => {
  const normalizedHex = value.startsWith('#') ? value : `#${value}`;

  return (
    <div className="te-color-field">
      <div
        className="te-color-swatch-wrap"
        style={{ backgroundColor: normalizedHex }}
        title="Pick colour"
      >
        <input
          type="color"
          className="te-color-native-input"
          value={normalizedHex.length === 7 ? normalizedHex : '#111111'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      </div>
      <input
        type="text"
        className="te-color-hex-input"
        value={normalizedHex.replace(/^#/, '')}
        maxLength={6}
        onChange={(e) => {
          const clean = e.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
          if (clean.length === 6) {
            onChange(`#${clean}`);
          }
        }}
      />
      {presets && presets.length > 0 && (
        <div className="te-color-presets">
          {presets.slice(0, 5).map((p) => (
            <button
              key={p.hex}
              type="button"
              className="te-color-preset-dot"
              style={{ backgroundColor: p.hex }}
              title={p.label}
              onClick={() => onChange(p.hex)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface CheckboxProps {
  checked: boolean;
  label?: string;
  onChange: (checked: boolean) => void;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  label,
  onChange,
}) => (
  <label className="te-checkbox-label">
    <span
      className="te-checkbox-box"
      data-checked={checked}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      {checked && <IconCheck />}
    </span>
    {label && <span>{label}</span>}
  </label>
);

