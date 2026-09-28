import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import PadLabelOverlay from './PadLabelOverlay.jsx';
import { FOCUS_CSS, DIFF_CSS, DIFF_CONFIG } from './sideBySideStyles.js';
import { applyTransformToDom, getScreenCoordsFromSvg, findDiffDomRect } from './utils/diffLayerUtils.js';
import { drawFocusRing } from './utils/focusRingUtils.js';
import { useSyncedTransform } from './useSyncedTransform.js';
import { SvgPanel } from './components/SvgPanel.jsx';
import { SideBySideToolbar } from './components/SideBySideToolbar.jsx';

function resolveSideParams(contentRef, coords, diffIdx) {
  const root = contentRef?.current;
  const viewport = root?.parentElement;
  if (!root || !viewport) return null;

  const elRect = (coords && getScreenCoordsFromSvg(root, coords)) || findDiffDomRect(root, diffIdx);
  if (!elRect) return null;

  return {
    elRect,
    viewportRect: viewport.getBoundingClientRect(),
    targetScale: 2.4,
  };
}

function useSideBySideApi(ref, apiConfig) {
  const {
    leftContentRef, rightContentRef, outerRef, synced,
    baseTransformRef, targetTransformRef, setBaseTransform,
    setTargetTransform, animateTo, resetTransform, setActiveAuditIdx
  } = apiConfig;

  const focusOnBoundingBox = useCallback((bbox, containerWidth, containerHeight) => {
    if (!bbox) return;
    const targetScale = 2.5;
    const centerX = (bbox.x1 + bbox.x2) / 2;
    const centerY = (bbox.y1 + bbox.y2) / 2;
    const newTransform = {
      scale: targetScale,
      x: containerWidth / 2 - centerX * targetScale,
      y: containerHeight / 2 - centerY * targetScale
    };
    baseTransformRef.current = newTransform;
    targetTransformRef.current = newTransform;
    setBaseTransform(newTransform);
    setTargetTransform(newTransform);
    applyTransformToDom(leftContentRef.current, newTransform);
    applyTransformToDom(rightContentRef.current, newTransform);
  }, [leftContentRef, rightContentRef, setBaseTransform, setTargetTransform, baseTransformRef, targetTransformRef]);

  useImperativeHandle(ref, () => ({
    focusElement(options) {
      const { diffIdx, diffType, baseCoords, targetCoords, bbox } = options;
      let leftParams = resolveSideParams(leftContentRef, baseCoords, diffIdx);
      let rightParams = resolveSideParams(rightContentRef, targetCoords, diffIdx);

      if (leftParams) {
        drawFocusRing(leftContentRef.current, leftParams.elRect, diffType === 'delete' ? 'diff-deleted' : 'diff-changed', baseCoords);
      }
      if (rightParams) {
        drawFocusRing(rightContentRef.current, rightParams.elRect, diffType === 'add' ? 'diff-added' : 'diff-changed', targetCoords);
      }

      if (synced) {
        if (leftParams && !rightParams) rightParams = { ...leftParams };
        else if (rightParams && !leftParams) leftParams = { ...rightParams };
      }

      if (leftParams || rightParams) {
        animateTo(leftParams, rightParams, 450);
      } else if (bbox && outerRef.current) {
        const rect = outerRef.current.getBoundingClientRect();
        focusOnBoundingBox(bbox, rect.width / 2, rect.height);
      }
    },

    focusOnBoundingBox(bbox) {
      if (!outerRef.current) return;
      const rect = outerRef.current.getBoundingClientRect();
      focusOnBoundingBox(bbox, rect.width / 2, rect.height);
    },

    setHoveredDiff(diffIdx) {
      [leftContentRef.current, rightContentRef.current].forEach((root) => {
        if (!root) return;
        root.querySelectorAll('[data-diff-hovered="true"]').forEach((el) => el.removeAttribute('data-diff-hovered'));
        if (diffIdx !== undefined && diffIdx !== null) {
          root.querySelectorAll(`[data-diff-idx="${diffIdx}"]`).forEach((el) => el.setAttribute('data-diff-hovered', 'true'));
        }
      });
    },

    resetView() {
      resetTransform();
      if (setActiveAuditIdx) setActiveAuditIdx(null);
    }
  }), [animateTo, focusOnBoundingBox, leftContentRef, outerRef, resetTransform, rightContentRef, setActiveAuditIdx, synced]);
}

function FocusedDiffStyle({ activeAuditIdx }) {
  if (activeAuditIdx == null) return null;
  return (
    <style>{`
      .mode-side-by-side.has-focus svg [data-diff-idx="${activeAuditIdx}"],
      .mode-side-by-side.has-focus svg [data-diff-idx="${activeAuditIdx}"] * {
        filter: drop-shadow(0 0 3px rgba(250, 219, 20, 0.85)) !important;
      }
    `}</style>
  );
}

function SideBySideSplitView({
  baseSvgs,
  targetSvgs,
  activeLayers,
  soloLayer,
  layerOpacities,
  leftContentRef,
  rightContentRef,
  baseCommit,
  targetCommit,
  baseTransform,
  targetTransform,
}) {
  return (
    <div style={{ display: 'flex', flex: 1, gap: '4px', minHeight: 0 }}>
      <SvgPanel
        svgs={baseSvgs}
        activeLayers={activeLayers}
        soloLayer={soloLayer}
        layerOpacities={layerOpacities}
        contentRef={leftContentRef}
        side="base"
        commitLabel={baseCommit ? `Commit: ${String(baseCommit).substring(0, 10)}` : 'Base'}
        transform={baseTransform}
      />

      <div style={{
        width: '3px', background: 'linear-gradient(to bottom, #fadb14 0%, #faad14 50%, #fadb14 100%)',
        borderRadius: '2px', flexShrink: 0, opacity: 0.7,
      }} />

      <SvgPanel
        svgs={targetSvgs}
        activeLayers={activeLayers}
        soloLayer={soloLayer}
        layerOpacities={layerOpacities}
        contentRef={rightContentRef}
        side="target"
        commitLabel={targetCommit ? `Commit: ${String(targetCommit).substring(0, 10)}` : 'Target'}
        transform={targetTransform}
      />
    </div>
  );
}

function useSideBySideListeners({ outerRef, onWheel, activeAuditIdx, onReset }) {
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [outerRef, onWheel]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeAuditIdx !== null) {
        onReset();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeAuditIdx, onReset]);
}

function SideBySidePadOverlay({ padLabelProps, leftContentRef, rightContentRef, activeLayers, soloLayer, layerOpacities, baseTransform, targetTransform }) {
  if (!padLabelProps) return null;
  return (
    <PadLabelOverlay
      {...padLabelProps}
      leftContentRef={leftContentRef}
      rightContentRef={rightContentRef}
      activeLayers={activeLayers}
      soloLayer={soloLayer}
      layerOpacities={layerOpacities}
      baseTransformScale={baseTransform.scale}
      targetTransformScale={targetTransform.scale}
    />
  );
}

export default forwardRef(function SideBySideDiff({
  isSchematic,
  baseSvgs,
  targetSvgs,
  activeLayers,
  soloLayer,
  layerOpacities,
  baseCommit,
  targetCommit,
  activeAuditIdx,
  setActiveAuditIdx,
  padLabelProps,
  traceWidth = DIFF_CONFIG.DEFAULT_TRACE_WIDTH,
}, ref) {
  const isSchematicMode = isSchematic ?? (!padLabelProps?.relativeFilePath?.endsWith('.kicad_pcb'));
  const [selectedTraceWidth, setSelectedTraceWidth] = useState(traceWidth || DIFF_CONFIG.DEFAULT_TRACE_WIDTH);

  useEffect(() => {
    if (traceWidth) setSelectedTraceWidth(traceWidth);
  }, [traceWidth]);

  const leftContentRef = useRef(null);
  const rightContentRef = useRef(null);
  const outerRef = useRef(null);
  const [synced, setSynced] = useState(true);

  const [baseTransform, setBaseTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [targetTransform, setTargetTransform] = useState({ scale: 1, x: 0, y: 0 });

  const {
    onWheel, onMouseDown, onMouseMove, onMouseUp,
    resetTransform, animateTo, baseTransformRef, targetTransformRef
  } = useSyncedTransform({
    baseTransform, setBaseTransform, targetTransform, setTargetTransform,
    leftContentRef, rightContentRef, outerRef, synced
  });

  const handleReset = useCallback(() => {
    resetTransform();
    if (setActiveAuditIdx) setActiveAuditIdx(null);
  }, [resetTransform, setActiveAuditIdx]);

  useSideBySideApi(ref, {
    leftContentRef, rightContentRef, outerRef, synced,
    baseTransformRef, targetTransformRef, setBaseTransform,
    setTargetTransform, animateTo, resetTransform, setActiveAuditIdx
  });

  useSideBySideListeners({ outerRef, onWheel, activeAuditIdx, onReset: handleReset });

  return (
    <>
      <style>{FOCUS_CSS}</style>
      <style>{DIFF_CSS}</style>
      <FocusedDiffStyle activeAuditIdx={activeAuditIdx} />

      <div
        ref={outerRef}
        className={`mode-side-by-side ${isSchematicMode ? 'schematic-mode' : 'pcb-mode'} ${activeAuditIdx !== null ? 'has-focus' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{
          display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
          gap: 0, '--diff-trace-width': selectedTraceWidth,
        }}
      >
        <SideBySideToolbar
          synced={synced}
          setSynced={setSynced}
          selectedTraceWidth={selectedTraceWidth}
          setSelectedTraceWidth={setSelectedTraceWidth}
          activeAuditIdx={activeAuditIdx}
          onReset={handleReset}
        />

        <SideBySideSplitView
          baseSvgs={baseSvgs}
          targetSvgs={targetSvgs}
          activeLayers={activeLayers}
          soloLayer={soloLayer}
          layerOpacities={layerOpacities}
          leftContentRef={leftContentRef}
          rightContentRef={rightContentRef}
          baseCommit={baseCommit}
          targetCommit={targetCommit}
          baseTransform={baseTransform}
          targetTransform={targetTransform}
        />

        <SideBySidePadOverlay
          padLabelProps={padLabelProps}
          leftContentRef={leftContentRef}
          rightContentRef={rightContentRef}
          activeLayers={activeLayers}
          soloLayer={soloLayer}
          layerOpacities={layerOpacities}
          baseTransform={baseTransform}
          targetTransform={targetTransform}
        />
      </div>
    </>
  );
});
