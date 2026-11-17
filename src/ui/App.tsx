import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EFFECTS_LIST, getEffectById } from '../engine/effects';
import {
  DecodedSourceImage,
  decodeImageBytes,
  pixelBufferToPngBytes,
  RenderPipeline,
} from '../engine/pipeline';
import {
  ControllerToUIMessage,
  SelectedNodeMeta,
  UIToControllerMessage,
} from '../shared/messages';
import { EffectId, ParamMap, ParamValue, PixelBuffer } from '../shared/types';
import { EffectPicker } from './panels/EffectPicker';
import { Footer } from './panels/Footer';
import { PreviewPanel } from './panels/PreviewPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';

interface HistoryEntry {
  effectId: EffectId;
  params: ParamMap;
}

function postToController(msg: UIToControllerMessage): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

export const App: React.FC = () => {
  // Selection and decoded image state
  const [decodedImage, setDecodedImage] = useState<DecodedSourceImage | null>(null);
  const [nodeMeta, setNodeMeta] = useState<SelectedNodeMeta | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Effect and per-effect session parameter map
  const [effectId, setEffectId] = useState<EffectId>('halftone');
  const [paramsByEffect, setParamsByEffect] = useState<Record<EffectId, ParamMap>>(() => {
    const init = {} as Record<EffectId, ParamMap>;
    for (const eff of EFFECTS_LIST) {
      init[eff.id] = { ...eff.defaults };
    }
    return init;
  });

  // Undo / Redo history
  const [history, setHistory] = useState<HistoryEntry[]>([
    { effectId: 'halftone', params: { ...getEffectById('halftone').defaults } },
  ]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const historyTimerRef = useRef<number | null>(null);

  // Preview rendering state
  const pipelineRef = useRef<RenderPipeline | null>(null);
  const [resultBuffer, setResultBuffer] = useState<PixelBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [comparing, setComparing] = useState<boolean>(false);
  const [holdCompare, setHoldCompare] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);

  const currentEffect = getEffectById(effectId);
  const currentParams = paramsByEffect[effectId] ?? currentEffect.defaults;

  // Initialize render pipeline
  useEffect(() => {
    const pipeline = new RenderPipeline();
    pipelineRef.current = pipeline;
    return () => {
      pipeline.dispose();
    };
  }, []);

  // Load image bytes helper
  const loadFromBytes = useCallback(
    async (
      bytes: Uint8Array,
      meta?: SelectedNodeMeta,
      selectionNotice?: string
    ) => {
      setIsProcessing(true);
      setErrorMessage(null);
      try {
        const decoded = await decodeImageBytes(bytes);
        setDecodedImage(decoded);
        setNodeMeta(meta);
        if (decoded.wasDownscaled) {
          setNotice(
            `Image exceeds 4096px (${decoded.originalWidth}×${decoded.originalHeight}) — downscaled to ${decoded.full.width}×${decoded.full.height}`
          );
        } else {
          setNotice(selectionNotice);
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to decode image'
        );
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  // Listen to Figma controller messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as ControllerToUIMessage | undefined;
      if (!msg || !msg.type) return;

      if (msg.type === 'selection-changed') {
        if (msg.status === 'empty' || msg.status === 'missing-fill' || !msg.bytes) {
          setDecodedImage(null);
          setResultBuffer(null);
          setNodeMeta(undefined);
          setNotice(undefined);
          setErrorMessage(null);
          return;
        }
        void loadFromBytes(msg.bytes, msg.node, msg.notice);
      } else if (msg.type === 'apply-complete') {
        setIsApplying(false);
      } else if (msg.type === 'error') {
        setIsApplying(false);
        setErrorMessage(msg.message);
      }
    };

    window.addEventListener('message', handleMessage);
    postToController({ type: 'ui-ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, [loadFromBytes]);

  // Two-pass preview render: fast low-res pass immediately, full preview pass when idle
  useEffect(() => {
    if (!decodedImage || !pipelineRef.current) {
      setResultBuffer(null);
      return;
    }

    let cancelled = false;
    let idleTimer: number | null = null;
    const pipeline = pipelineRef.current;

    // 1. Immediate fast pass on `interactive` (220px) for zero-lag slider dragging
    void pipeline
      .renderBuffer(
        decodedImage.interactive,
        decodedImage.preview,
        effectId,
        currentParams
      )
      .then((fastRes) => {
        if (cancelled || !fastRes) return;
        setResultBuffer(fastRes.buffer);

        // 2. Schedule full preview pass (380px) once slider pauses for 110ms
        idleTimer = window.setTimeout(() => {
          if (cancelled) return;
          void pipeline
            .renderBuffer(
              decodedImage.preview,
              decodedImage.preview,
              effectId,
              currentParams
            )
            .then((fullRes) => {
              if (cancelled || !fullRes) return;
              setResultBuffer(fullRes.buffer);
            });
        }, 110);
      });

    return () => {
      cancelled = true;
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
      }
    };
  }, [decodedImage, effectId, currentParams]);

  // Debounced history commit so dragging sliders doesn't flood state updates
  const scheduleCommitHistory = useCallback(
    (nextEffectId: EffectId, nextParams: ParamMap, immediate = false) => {
      if (historyTimerRef.current !== null) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }

      const doCommit = () => {
        setHistory((prev) => {
          const sliced = prev.slice(0, historyIndex + 1);
          const nextStack = [
            ...sliced,
            { effectId: nextEffectId, params: { ...nextParams } },
          ];
          return nextStack.slice(-50);
        });
        setHistoryIndex((prev) => Math.min(49, prev + 1));
      };

      if (immediate) {
        doCommit();
      } else {
        historyTimerRef.current = window.setTimeout(doCommit, 180);
      }
    },
    [historyIndex]
  );

  const handleSelectEffect = useCallback(
    (nextId: EffectId) => {
      setEffectId(nextId);
      const nextParams = paramsByEffect[nextId] ?? {
        ...getEffectById(nextId).defaults,
      };
      scheduleCommitHistory(nextId, nextParams, true);
    },
    [paramsByEffect, scheduleCommitHistory]
  );

  const handleChangeParam = useCallback(
    (key: string, value: ParamValue) => {
      setParamsByEffect((prev) => {
        const updated = {
          ...(prev[effectId] ?? currentEffect.defaults),
          [key]: value,
        };
        scheduleCommitHistory(effectId, updated, false);
        return { ...prev, [effectId]: updated };
      });
    },
    [currentEffect.defaults, effectId, scheduleCommitHistory]
  );

  const handleResetSection = useCallback(
    (sectionKeys: string[]) => {
      setParamsByEffect((prev) => {
        const updated = { ...(prev[effectId] ?? currentEffect.defaults) };
        for (const k of sectionKeys) {
          const defVal = currentEffect.defaults[k];
          if (defVal !== undefined) {
            updated[k] = defVal;
          }
        }
        scheduleCommitHistory(effectId, updated, true);
        return { ...prev, [effectId]: updated };
      });
    },
    [currentEffect.defaults, effectId, scheduleCommitHistory]
  );

  const handleResetAll = useCallback(() => {
    const fresh = { ...currentEffect.defaults };
    setParamsByEffect((prev) => ({ ...prev, [effectId]: fresh }));
    scheduleCommitHistory(effectId, fresh, true);
  }, [currentEffect.defaults, effectId, scheduleCommitHistory]);

  const handleRandomize = useCallback(() => {
    const seed = Math.floor(Math.random() * 9999) + 1;
    const randomized = currentEffect.randomize(currentParams, seed);
    setParamsByEffect((prev) => ({ ...prev, [effectId]: randomized }));
    scheduleCommitHistory(effectId, randomized, true);
  }, [currentEffect, currentParams, effectId, scheduleCommitHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const targetIdx = historyIndex - 1;
    const entry = history[targetIdx];
    if (!entry) return;
    setHistoryIndex(targetIdx);
    setEffectId(entry.effectId);
    setParamsByEffect((prev) => ({
      ...prev,
      [entry.effectId]: { ...entry.params },
    }));
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const targetIdx = historyIndex + 1;
    const entry = history[targetIdx];
    if (!entry) return;
    setHistoryIndex(targetIdx);
    setEffectId(entry.effectId);
    setParamsByEffect((prev) => ({
      ...prev,
      [entry.effectId]: { ...entry.params },
    }));
  }, [history, historyIndex]);

  // Apply Raster (PNG)
  const handleApplyRaster = useCallback(async () => {
    if (!decodedImage || !pipelineRef.current || isApplying) return;
    setIsApplying(true);
    setErrorMessage(null);
    try {
      const fullBuffer = pipelineRef.current.renderFullRaster(
        decodedImage.full,
        decodedImage.preview,
        effectId,
        currentParams
      );
      const pngBytes = await pixelBufferToPngBytes(fullBuffer);

      postToController({
        type: 'apply-raster',
        bytes: pngBytes,
        width: fullBuffer.width,
        height: fullBuffer.height,
        sourceId: nodeMeta?.id ?? '',
        label: currentEffect.name,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to apply raster effect'
      );
      setIsApplying(false);
    }
  }, [
    currentEffect.name,
    currentParams,
    decodedImage,
    effectId,
    isApplying,
    nodeMeta?.id,
  ]);

  // Apply Vector (SVG)
  const handleApplySvg = useCallback(() => {
    if (
      !decodedImage ||
      !pipelineRef.current ||
      !currentEffect.supportsSvg ||
      isApplying
    ) {
      return;
    }
    setIsApplying(true);
    setErrorMessage(null);
    try {
      const svg = pipelineRef.current.renderFullSvg(
        decodedImage.full,
        decodedImage.preview,
        effectId,
        currentParams
      );
      postToController({
        type: 'apply-svg',
        svg,
        sourceId: nodeMeta?.id ?? '',
        label: `${currentEffect.name} (SVG)`,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to generate SVG'
      );
      setIsApplying(false);
    }
  }, [
    currentEffect.name,
    currentEffect.supportsSvg,
    currentParams,
    decodedImage,
    effectId,
    isApplying,
    nodeMeta?.id,
  ]);

  // Global keyboard shortcuts
  useEffect(() => {
    const isInputFocused = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '\\') {
        if (!isInputFocused(e.target)) {
          setHoldCompare(true);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (!isInputFocused(e.target)) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        }
        return;
      }

      if (isInputFocused(e.target)) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          handleApplySvg();
        } else {
          void handleApplyRaster();
        }
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRandomize();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') {
        setHoldCompare(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    handleApplyRaster,
    handleApplySvg,
    handleRandomize,
    handleRedo,
    handleUndo,
  ]);

  return (
    <div className="te-shell">
      {errorMessage && (
        <div className="te-error-banner">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="te-btn te-btn-secondary"
            style={{ height: 20, padding: '0 6px' }}
            onClick={() => setErrorMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div className="te-notice-bar">
          <span>{notice}</span>
        </div>
      )}

      <PreviewPanel
        sourceBuffer={decodedImage?.preview ?? null}
        resultBuffer={resultBuffer}
        comparing={comparing || holdCompare}
        onToggleCompare={setComparing}
        isProcessing={isProcessing}
        nodeName={nodeMeta?.name}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      <EffectPicker
        selectedEffectId={effectId}
        onSelectEffect={handleSelectEffect}
      />

      <PropertiesPanel
        effect={currentEffect}
        params={currentParams}
        onChangeParam={handleChangeParam}
        onResetSection={handleResetSection}
      />

      <Footer
        hasImage={Boolean(decodedImage)}
        supportsSvg={currentEffect.supportsSvg}
        isApplying={isApplying}
        onRandomize={handleRandomize}
        onResetAll={handleResetAll}
        onApplyRaster={() => void handleApplyRaster()}
        onApplySvg={handleApplySvg}
      />
    </div>
  );
};
