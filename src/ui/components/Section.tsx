import React, { useState } from 'react';
import { IconChevronDown, IconChevronRight, IconReset } from './Icons';

interface SectionProps {
  title: string;
  onResetSection?: () => void;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({
  title,
  onResetSection,
  children,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <div className="te-section">
      <div
        className="te-section-header"
        onClick={() => setOpen((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
      >
        <div className="te-section-title-wrap">
          {open ? <IconChevronDown /> : <IconChevronRight />}
          <span>{title}</span>
        </div>
        {onResetSection && (
          <button
            type="button"
            className="te-icon-btn te-section-reset"
            title={`Reset ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onResetSection();
            }}
          >
            <IconReset />
          </button>
        )}
      </div>
      {open && <div className="te-section-body">{children}</div>}
    </div>
  );
};

