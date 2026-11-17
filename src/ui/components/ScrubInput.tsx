import React, { useEffect, useRef, useState } from 'react';

interface ScrubInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function clampAndSnap(val: number, min: number, max: number, step: number): number {
  const snapped = Math.round(val / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  return Math.round(clamped * 100) / 100;
}

export const ScrubInput: React.FC<ScrubInputProps> = ({
  value,
  min,
  max,
  step,
  unit,
  onChange,
}) => {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const revertValueRef = useRef(value);

  useEffect(() => {
    if (!focused) {
      setText(String(value));
    }
  }, [value, focused]);

  const commitText = () => {
    const parsed = parseFloat(text);
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    const next = clampAndSnap(parsed, min, max, step);
    setText(String(next));
    if (next !== value) {
      onChange(next);
    }
  };

  return (
    <div className="te-scrub-wrap">
      <input
        type="text"
        className="te-scrub-input"
        value={text}
        onFocus={(e) => {
          revertValueRef.current = value;
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          commitText();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitText();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(String(revertValueRef.current));
            onChange(revertValueRef.current);
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            const next = clampAndSnap(value + dir * step * mult, min, max, step);
            setText(String(next));
            onChange(next);
          }
        }}
      />
      {unit && <span className="te-scrub-unit">{unit}</span>}
    </div>
  );
};

export function useLabelScrub(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (next: number) => void
) {
  const startXRef = useRef(0);
  const startValRef = useRef(value);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startValRef.current = value;

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startXRef.current;
      const mult = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
      const deltaSteps = Math.round(dx / 3) * step * mult;
      const next = clampAndSnap(startValRef.current + deltaSteps, min, max, step);
      onChange(next);
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return onMouseDown;
}

