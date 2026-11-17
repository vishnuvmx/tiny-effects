import React from 'react';

interface FooterProps {
  hasImage: boolean;
  supportsSvg: boolean;
  isApplying: boolean;
  onRandomize: () => void;
  onResetAll: () => void;
  onApplyRaster: () => void;
  onApplySvg: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  hasImage,
  supportsSvg,
  isApplying,
  onRandomize,
  onResetAll,
  onApplyRaster,
  onApplySvg,
}) => {
  return (
    <div className="te-footer">
      <div className="te-footer-row">
        <button
          type="button"
          className="te-btn te-btn-secondary"
          onClick={onRandomize}
          title="Randomise parameters (R)"
        >
          Randomise
        </button>
        <button
          type="button"
          className="te-btn te-btn-secondary"
          onClick={onResetAll}
          title="Reset all parameters to defaults"
        >
          Reset
        </button>
      </div>
      <div className="te-footer-row">
        <button
          type="button"
          className="te-btn te-btn-secondary"
          disabled={!hasImage || !supportsSvg || isApplying}
          onClick={onApplySvg}
          title={
            supportsSvg
              ? 'Apply as editable SVG vectors (Shift+Enter)'
              : 'SVG output is not available for this effect'
          }
        >
          Apply as SVG
        </button>
        <button
          type="button"
          className="te-btn te-btn-primary"
          disabled={!hasImage || isApplying}
          onClick={onApplyRaster}
          title="Apply as new raster layer (Enter)"
        >
          {isApplying ? 'Applying...' : 'Apply'}
        </button>
      </div>
    </div>
  );
};

