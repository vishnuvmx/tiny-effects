import React, { useEffect, useRef, useState } from 'react';
import { EFFECTS_LIST } from '../../engine/effects';
import { EffectId } from '../../shared/types';
import { IconCheck, IconChevronDown } from '../components/Icons';

interface EffectPickerProps {
  selectedEffectId: EffectId;
  onSelectEffect: (id: EffectId) => void;
}

export const EffectPicker: React.FC<EffectPickerProps> = ({
  selectedEffectId,
  onSelectEffect,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeEffect =
    EFFECTS_LIST.find((e) => e.id === selectedEffectId) ?? EFFECTS_LIST[0];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="te-effect-bar" ref={containerRef}>
      <div className="te-effect-bar-header">
        <span className="te-effect-bar-label">Effect</span>
        <span className="te-preview-meta">
          {activeEffect?.supportsSvg ? 'PNG · SVG' : 'PNG'}
        </span>
      </div>

      <button
        type="button"
        className="te-effect-trigger"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const idx = EFFECTS_LIST.findIndex((item) => item.id === selectedEffectId);
            const next = EFFECTS_LIST[(idx + 1) % EFFECTS_LIST.length];
            if (next) onSelectEffect(next.id);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const idx = EFFECTS_LIST.findIndex((item) => item.id === selectedEffectId);
            const prev =
              EFFECTS_LIST[(idx - 1 + EFFECTS_LIST.length) % EFFECTS_LIST.length];
            if (prev) onSelectEffect(prev.id);
          }
        }}
      >
        <span style={{ fontWeight: 500 }}>{activeEffect?.name}</span>
        <IconChevronDown />
      </button>

      {open && (
        <div className="te-effect-menu" role="listbox">
          {EFFECTS_LIST.map((eff) => {
            const active = eff.id === selectedEffectId;
            return (
              <button
                key={eff.id}
                type="button"
                role="option"
                aria-selected={active}
                className="te-effect-menu-item"
                data-active={active}
                onClick={() => {
                  onSelectEffect(eff.id);
                  setOpen(false);
                }}
              >
                <span className="te-effect-menu-check">
                  {active ? <IconCheck /> : null}
                </span>
                <span>{eff.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
