import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Tag, Typography, Switch } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  SwapOutlined
} from '@ant-design/icons';
import PadLabelOverlay from './PadLabelOverlay.jsx';


const { Text } = Typography;

// ─── Diff class color rules ─────────────────────────────────────────────────
//
// ALL selectors are prefixed with .mode-side-by-side so these rules are
// completely inert when the Overlay Slider component is rendered instead.
// The root <div> in this component always carries that class name.
//
// THREE-TIERED OPACITY ARCHITECTURE:
//   Tier 1 — Modifications (.diff-changed / .diff-added / .diff-deleted)
//             → always 100% solid, regardless of which layer they live on.
//   Tier 2 — Active layer unchanged structure (.layer-active .diff-unchanged)
//             → 85% opacity, crisp mid-grey: fully legible architectural guide.
//   Tier 3 — Background layers unchanged structure (.layer-background .diff-unchanged)
//             → 15% opacity, dark grey: faint ghost blueprint matrix.
//
// ─── Focus highlight animation ───────────────────────────────────────────────
// Injected once alongside DIFF_CSS. Provides the @keyframes used by the
// pulsing ring that appears when the user clicks an audit log item.
const FOCUS_CSS = `
  @keyframes diff-focus-pulse {
    0%   { opacity: 1;   r: 0;  }
    40%  { opacity: 0.9; }
    100% { opacity: 0;   r: 40px; }
  }
  .diff-focus-ring {
    pointer-events: none;
    fill: none;
    stroke-width: 2.5;
    animation: diff-focus-pulse 1.8s ease-out forwards;
  }
  .diff-focus-ring.diff-changed { stroke: #ffff00; }
  .diff-focus-ring.diff-added   { stroke: #00ff66; }
  .diff-focus-ring.diff-deleted { stroke: #ff3366; }
`;

const DIFF_CSS = `
  /* Scoped to .mode-side-by-side — Overlay Slider completely unaffected. */

  .mode-side-by-side .diff-changed,
  .mode-side-by-side .diff-added,
  .mode-side-by-side .diff-deleted {
    opacity: 1 !important;
    filter:  none !important;
  }

  .diff-viewport svg {
    will-change: transform;
    contain: layout paint size;
  }

  /* Unchanged elements preserve native KiCad styling and colors */
  .mode-side-by-side.schematic-mode .diff-unchanged,
  .mode-side-by-side.pcb-mode .diff-unchanged,
  .mode-side-by-side .diff-unchanged {
    pointer-events: none;
  }

  /* ── diff-changed (yellow) ──────────────────────────────────────────────── */
  .mode-side-by-side .diff-changed.diff-open,
  .mode-side-by-side .diff-changed:not(.diff-closed) {
    stroke: #ffff00 !important;
    fill:   none    !important;
  }
  .mode-side-by-side .diff-changed.diff-closed,
  .mode-side-by-side .diff-changed.diff-closed * {
    fill:   #ffff00 !important;
    stroke: #ffff00 !important;
  }
  /* SVG native <text>/<tspan> nodes should be filled with diff color (readable) */
  .mode-side-by-side .diff-changed text,
  .mode-side-by-side .diff-changed tspan {
    fill:   #ffff00 !important;
    stroke: none    !important;
  }

  /* ── diff-added (green) ─────────────────────────────────────────────────── */
  .mode-side-by-side .diff-added.diff-open,
  .mode-side-by-side .diff-added:not(.diff-closed) {
    stroke: #00ff66 !important;
    fill:   none    !important;
  }
  .mode-side-by-side .diff-added.diff-closed,
  .mode-side-by-side .diff-added.diff-closed * {
    fill:   #00ff66 !important;
    stroke: #00ff66 !important;
  }
  .mode-side-by-side .diff-added text,
  .mode-side-by-side .diff-added tspan {
    fill:   #00ff66 !important;
    stroke: none    !important;
  }

  /* ── diff-deleted (red) ─────────────────────────────────────────────────── */
  .mode-side-by-side .diff-deleted.diff-open,
  .mode-side-by-side .diff-deleted:not(.diff-closed) {
    stroke: #ff3366 !important;
    fill:   none    !important;
  }
  .mode-side-by-side .diff-deleted.diff-closed,
  .mode-side-by-side .diff-deleted.diff-closed * {
    fill:   #ff3366 !important;
    stroke: #ff3366 !important;
  }
  .mode-side-by-side .diff-deleted text,
  .mode-side-by-side .diff-deleted tspan {
    fill:   #ff3366 !important;
    stroke: none    !important;
  }

  /* ── Interactive Hover Highlight ───────────────────────────────────────── */
  .mode-side-by-side [data-diff-hovered="true"],
  .mode-side-by-side .diff-highlighted {
    stroke-width: 0.8mm !important;
    filter: drop-shadow(0 0 6px #ffffff) !important;
    opacity: 1 !important;
  }

  /* ── Focus Ring Pulse Animation ────────────────────────────────────────── */
  .diff-focus-ring {
    fill: none;
    animation: pulse-ring 2s infinite ease-in-out;
  }

  @keyframes pulse-ring {
    0% {
      stroke-width: 0.5mm;
      stroke-opacity: 1;
    }
    50% {
      stroke-width: 1.2mm;
      stroke-opacity: 0.6;
    }
    100% {
      stroke-width: 0.5mm;
      stroke-opacity: 1;
    }
  }
`;

// ─── Layer matching helper ────────────────────────────────────────────────────
function isLayerActive(filename, activeLayers) {
  const name = filename.toLowerCase();
  if (
    !name.includes('_cu') &&
    !name.includes('silkscreen') &&
    !name.includes('edge_cuts') &&
    !name.includes('silks') &&
    !name.includes('mask') &&
    !name.includes('paste') &&
    !name.includes('courtyard')
  ) return true;

  return activeLayers.some(layer => {
    const nl = layer.replace('.', '_').toLowerCase();
    if (nl === 'f_silks') return name.includes('f_silkscreen') || name.includes('f_silks');
    if (nl === 'b_silks') return name.includes('b_silkscreen') || name.includes('b_silks');
    return name.includes(nl);
  });
}

// ─── Solo layer check ─────────────────────────────────────────────────────────
function isLayerSolo(filename, soloLayer) {
  if (!soloLayer) return true;
  const name = filename.toLowerCase();
  const nl = soloLayer.replace('.', '_').toLowerCase();
  if (nl === 'f_silks') return name.includes('f_silkscreen') || name.includes('f_silks');
  if (nl === 'b_silks') return name.includes('b_silkscreen') || name.includes('b_silks');
  return name.includes(nl);
}

// ─── Direct GPU transform helper (bypasses React virtual DOM reconciliation) ───
const applyTransformToDom = (element, transform) => {
  if (element) {
    element.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0px) scale(${transform.scale})`;
  }
};

// ─── Synchronized Pan/Zoom Engine ────────────────────────────────────────────
// Supports two independent viewports.
// Panning and zooming can be locked together (synced === true) or decoupled (synced === false).
function useSyncedTransform(
  baseTransform,
  setBaseTransform,
  targetTransform,
  setTargetTransform,
  leftContentRef,
  rightContentRef,
  outerRef,
  synced
) {
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originLeftX: 0,
    originLeftY: 0,
    originRightX: 0,
    originRightY: 0,
    isLeft: true
  });

  const baseTransformRef = useRef(baseTransform);
  const targetTransformRef = useRef(targetTransform);

  useEffect(() => {
    baseTransformRef.current = baseTransform;
    applyTransformToDom(leftContentRef.current, baseTransform);
  }, [baseTransform, leftContentRef]);

  useEffect(() => {
    targetTransformRef.current = targetTransform;
    applyTransformToDom(rightContentRef.current, targetTransform);
  }, [targetTransform, rightContentRef]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!outerRef.current) return;

    const rect = outerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isLeft = mouseX < rect.width / 2;

    const factor = e.deltaY < 0 ? 1.12 : 0.90;

    if (synced) {
      const leftState = baseTransformRef.current;
      const newScale = Math.min(80, Math.max(0.02, leftState.scale * factor));

      const newLeftX = mouseX - (mouseX - leftState.x) * (newScale / leftState.scale);
      const newLeftY = e.clientY - rect.top - (e.clientY - rect.top - leftState.y) * (newScale / leftState.scale);

      const nextVal = { scale: newScale, x: newLeftX, y: newLeftY };
      baseTransformRef.current = nextVal;
      targetTransformRef.current = nextVal;
      applyTransformToDom(leftContentRef.current, nextVal);
      applyTransformToDom(rightContentRef.current, nextVal);
      setBaseTransform(nextVal);
      setTargetTransform(nextVal);
    } else {
      if (isLeft) {
        const state = baseTransformRef.current;
        const newScale = Math.min(80, Math.max(0.02, state.scale * factor));

        const relMouseX = mouseX;
        const relMouseY = e.clientY - rect.top;

        const newX = relMouseX - (relMouseX - state.x) * (newScale / state.scale);
        const newY = relMouseY - (relMouseY - state.y) * (newScale / state.scale);

        const nextVal = { scale: newScale, x: newX, y: newY };
        baseTransformRef.current = nextVal;
        applyTransformToDom(leftContentRef.current, nextVal);
        setBaseTransform(nextVal);
      } else {
        const state = targetTransformRef.current;
        const newScale = Math.min(80, Math.max(0.02, state.scale * factor));

        const relMouseX = mouseX - rect.width / 2;
        const relMouseY = e.clientY - rect.top;

        const newX = relMouseX - (relMouseX - state.x) * (newScale / state.scale);
        const newY = relMouseY - (relMouseY - state.y) * (newScale / state.scale);

        const nextVal = { scale: newScale, x: newX, y: newY };
        targetTransformRef.current = nextVal;
        applyTransformToDom(rightContentRef.current, nextVal);
        setTargetTransform(nextVal);
      }
    }
  }, [outerRef, synced, setBaseTransform, setTargetTransform, leftContentRef, rightContentRef]);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || !outerRef.current) return;

    const rect = outerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isLeft = clickX < rect.width / 2;

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originLeftX: baseTransformRef.current.x,
      originLeftY: baseTransformRef.current.y,
      originRightX: targetTransformRef.current.x,
      originRightY: targetTransformRef.current.y,
      isLeft
    };
    e.currentTarget.style.cursor = 'grabbing';
  }, [outerRef]);

  // 2. Ref-driven pointer move handler (bypasses React virtual DOM reconciliation during drag)
  const onMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    if (synced) {
      const updated = {
        scale: baseTransformRef.current.scale,
        x: dragRef.current.originLeftX + deltaX,
        y: dragRef.current.originLeftY + deltaY
      };
      baseTransformRef.current = updated;
      targetTransformRef.current = updated;

      applyTransformToDom(leftContentRef.current, updated);
      applyTransformToDom(rightContentRef.current, updated);
    } else {
      if (dragRef.current.isLeft) {
        const updated = {
          scale: baseTransformRef.current.scale,
          x: dragRef.current.originLeftX + deltaX,
          y: dragRef.current.originLeftY + deltaY
        };
        baseTransformRef.current = updated;
        applyTransformToDom(leftContentRef.current, updated);
      } else {
        const updated = {
          scale: targetTransformRef.current.scale,
          x: dragRef.current.originRightX + deltaX,
          y: dragRef.current.originRightY + deltaY
        };
        targetTransformRef.current = updated;
        applyTransformToDom(rightContentRef.current, updated);
      }
    }
  }, [synced, leftContentRef, rightContentRef]);

  // 3. Sync to React state on mouse up
  const onMouseUp = useCallback((e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (e && e.currentTarget) e.currentTarget.style.cursor = 'grab';
    if (outerRef.current) outerRef.current.style.cursor = 'grab';
    setBaseTransform({ ...baseTransformRef.current });
    setTargetTransform({ ...targetTransformRef.current });
  }, [setBaseTransform, setTargetTransform, outerRef]);

  const resetTransform = useCallback(() => {
    const defaultVal = { scale: 1, x: 0, y: 0 };
    setBaseTransform(defaultVal);
    setTargetTransform(defaultVal);
  }, [setBaseTransform, setTargetTransform]);

  const animateTo = useCallback((leftParams, rightParams, durationMs = 550) => {
    const startTime = performance.now();
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const leftStart = leftParams ? { ...baseTransformRef.current } : null;
    const rightStart = rightParams ? { ...targetTransformRef.current } : null;

    let leftTarget = null;
    if (leftParams) {
      const { elRect, viewportRect, targetScale } = leftParams;
      const elCX = (elRect.left + elRect.width / 2) - viewportRect.left;
      const elCY = (elRect.top + elRect.height / 2) - viewportRect.top;
      const vpCX = viewportRect.width / 2;
      const vpCY = viewportRect.height / 2;
      const contentX = (elCX - leftStart.x) / leftStart.scale;
      const contentY = (elCY - leftStart.y) / leftStart.scale;
      leftTarget = {
        scale: targetScale,
        x: vpCX - contentX * targetScale,
        y: vpCY - contentY * targetScale
      };
    }

    let rightTarget = null;
    if (rightParams) {
      const { elRect, viewportRect, targetScale } = rightParams;
      const elCX = (elRect.left + elRect.width / 2) - viewportRect.left;
      const elCY = (elRect.top + elRect.height / 2) - viewportRect.top;
      const vpCX = viewportRect.width / 2;
      const vpCY = viewportRect.height / 2;
      const contentX = (elCX - rightStart.x) / rightStart.scale;
      const contentY = (elCY - rightStart.y) / rightStart.scale;
      rightTarget = {
        scale: targetScale,
        x: vpCX - contentX * targetScale,
        y: vpCY - contentY * targetScale
      };
    }

    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const e = easeInOut(t);

      if (leftStart && leftTarget) {
        const nextBase = {
          scale: leftStart.scale + (leftTarget.scale - leftStart.scale) * e,
          x: leftStart.x + (leftTarget.x - leftStart.x) * e,
          y: leftStart.y + (leftTarget.y - leftStart.y) * e,
        };
        baseTransformRef.current = nextBase;
        applyTransformToDom(leftContentRef.current, nextBase);
      }

      if (rightStart && rightTarget) {
        const nextTarget = {
          scale: rightStart.scale + (rightTarget.scale - rightStart.scale) * e,
          x: rightStart.x + (rightTarget.x - rightStart.x) * e,
          y: rightStart.y + (rightTarget.y - rightStart.y) * e,
        };
        targetTransformRef.current = nextTarget;
        applyTransformToDom(rightContentRef.current, nextTarget);
      }

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        if (leftStart && leftTarget) {
          setBaseTransform(baseTransformRef.current);
        }
        if (rightStart && rightTarget) {
          setTargetTransform(targetTransformRef.current);
        }
      }
    };

    requestAnimationFrame(tick);
  }, [leftContentRef, rightContentRef, setBaseTransform, setTargetTransform]);

  return { onWheel, onMouseDown, onMouseMove, onMouseUp, resetTransform, animateTo, baseTransformRef, targetTransformRef };
}

// ─── Per-layer opacity helper ─────────────────────────────────────────────────
function getLayerOpacity(filename, layerOpacities) {
  if (!layerOpacities || Object.keys(layerOpacities).length === 0) return 1;
  const name = filename.toLowerCase();
  for (const [layerValue, opacity] of Object.entries(layerOpacities)) {
    const nl = layerValue.replace('.', '_').toLowerCase();
    if (nl === 'f_silks') {
      if (name.includes('f_silkscreen') || name.includes('f_silks')) return opacity;
    } else if (nl === 'b_silks') {
      if (name.includes('b_silkscreen') || name.includes('b_silks')) return opacity;
    } else if (name.includes(nl)) {
      return opacity;
    }
  }
  return 1;
}

// ─── SideBySideSvgLayer ───────────────────────────────────────────────────────
const SideBySideSvgLayer = React.memo(({ filename, content, side, layerTier, opacityStyle, filterStyle }) => {
  return (
    <div
      className={layerTier}
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: '100%', height: '100%',
        opacity: opacityStyle,
        filter: filterStyle,
        transition: 'opacity 0.15s, filter 0.2s',
        pointerEvents: 'none',
        transform: 'translate3d(0px, 0px, 0px)',
        willChange: 'transform, opacity, filter',
        backfaceVisibility: 'hidden',
      }}
      dangerouslySetInnerHTML={{
        __html: content.replace(/<svg/, '<svg style="width:100%;height:100%;position:absolute;"')
      }}
    />
  );
}, (prev, next) => {
  return prev.content === next.content &&
    prev.layerTier === next.layerTier &&
    prev.opacityStyle === next.opacityStyle &&
    prev.filterStyle === next.filterStyle;
});

// ─── SvgPanel ────────────────────────────────────────────────────────────────
function SvgPanel({ svgs, activeLayers, soloLayer, layerOpacities, contentRef, side, commitLabel, transform }) {
  const filtered = (svgs || []).filter(svg => isLayerActive(svg.filename, activeLayers));

  const panelLabel = side === 'base'
    ? <><ArrowLeftOutlined /> BASE</>
    : <>TARGET <ArrowRightOutlined /></>;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      overflow: 'hidden',
      borderRadius: '6px',
      border: `1px solid ${side === 'base' ? '#3d1f1f' : '#1f3d2a'}`,
      background: '#12131e',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        background: side === 'base' ? 'rgba(192,57,43,0.12)' : 'rgba(39,174,96,0.12)',
        borderBottom: `1px solid ${side === 'base' ? '#3d1f1f' : '#1f3d2a'}`,
        flexShrink: 0,
        gap: '8px',
      }}>
        <Tag color={side === 'base' ? 'red' : 'green'} style={{ margin: 0, fontWeight: 700, letterSpacing: '0.05em' }}>
          {panelLabel}
        </Tag>
        <Text style={{ fontSize: '11px', color: '#a6adbb', fontFamily: 'monospace', flex: 1, textAlign: 'center' }}>
          {commitLabel}
        </Text>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {side === 'base' && (
            <span style={{ fontSize: '10px', color: '#e74c3c', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e74c3c', display: 'inline-block' }} />
              Deleted
            </span>
          )}
          {side === 'target' && (
            <span style={{ fontSize: '10px', color: '#2ecc71', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2ecc71', display: 'inline-block' }} />
              Added
            </span>
          )}
          <span style={{ fontSize: '10px', color: '#f39c12', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f39c12', display: 'inline-block' }} />
            Changed
          </span>
          <span style={{ fontSize: '10px', color: '#44445a', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#44445a', display: 'inline-block' }} />
            Unchanged
          </span>
        </div>
      </div>

      <div
        className="diff-viewport"
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <div
          ref={contentRef}
          style={{
            width: '100%',
            height: '100%',
            transformOrigin: '0 0',
            position: 'relative',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0px) scale(${transform.scale})`
          }}
        >
          {filtered.length === 0 ? (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#444', fontSize: 14
            }}>
              No layers selected
            </div>
          ) : (
            filtered.map((svg) => {
              const solo = isLayerSolo(svg.filename, soloLayer);
              const greyOut = soloLayer && !solo;
              const layerOp = getLayerOpacity(svg.filename, layerOpacities);
              const layerTier = (soloLayer && !solo) ? 'layer-background' : 'layer-active';

              const opacityVal = greyOut ? 0.6 : layerOp;
              const filterVal = greyOut ? 'grayscale(1) contrast(0.5)' : 'none';

              return (
                <SideBySideSvgLayer
                  key={`${side}-${svg.filename}`}
                  filename={svg.filename}
                  content={svg.content}
                  side={side}
                  layerTier={layerTier}
                  opacityStyle={opacityVal}
                  filterStyle={filterVal}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
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
  padLabelProps,   // { repoPath, baseCommit, targetCommit, relativeFilePath } | null
}, ref) {
  const isSchematicMode = isSchematic ?? (!padLabelProps?.relativeFilePath?.endsWith('.kicad_pcb'));
  const leftContentRef = useRef(null);
  const rightContentRef = useRef(null);
  const outerRef = useRef(null);
  const [synced, setSynced] = useState(true);

  const [baseTransform, setBaseTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [targetTransform, setTargetTransform] = useState({ scale: 1, x: 0, y: 0 });

  const { onWheel, onMouseDown, onMouseMove, onMouseUp, resetTransform, animateTo, baseTransformRef, targetTransformRef } =
    useSyncedTransform(
      baseTransform,
      setBaseTransform,
      targetTransform,
      setTargetTransform,
      leftContentRef,
      rightContentRef,
      outerRef,
      synced
    );

  /**
   * Smoothly centers and zooms the viewport on a specific element's bounding box.
   */
  const focusOnBoundingBox = useCallback((bbox, containerWidth, containerHeight) => {
    if (!bbox) return;

    const targetScale = 2.5; // Zoom in for detail
    const centerX = (bbox.x1 + bbox.x2) / 2;
    const centerY = (bbox.y1 + bbox.y2) / 2;

    // Convert SVG coordinates to viewport transform offsets
    const newX = containerWidth / 2 - centerX * targetScale;
    const newY = containerHeight / 2 - centerY * targetScale;

    const newTransform = { scale: targetScale, x: newX, y: newY };

    baseTransformRef.current = newTransform;
    targetTransformRef.current = newTransform;

    setBaseTransform(newTransform);
    setTargetTransform(newTransform);

    applyTransformToDom(leftContentRef.current, newTransform);
    applyTransformToDom(rightContentRef.current, newTransform);
  }, [leftContentRef, rightContentRef, setBaseTransform, setTargetTransform, baseTransformRef, targetTransformRef]);

  const drawFocusRing = (contentEl, idx, ringColorClass) => {
    const target = contentEl.querySelector(`[data-diff-idx="${idx}"]`);
    if (!target) return;

    const elRect = target.getBoundingClientRect();
    const hostSvg = target.closest('svg');
    if (!hostSvg) return;

    const viewBoxStr = hostSvg.getAttribute('viewBox');
    if (viewBoxStr) {
      const vb = viewBoxStr.split(/[\s,]+/).map(parseFloat);
      if (vb.length >= 4 && vb[2] > 0 && vb[3] > 0) {
        const svgRect = hostSvg.getBoundingClientRect();
        const scale = Math.min(svgRect.width / vb[2], svgRect.height / vb[3]);
        const offsetX = (svgRect.width - vb[2] * scale) / 2;
        const offsetY = (svgRect.height - vb[3] * scale) / 2;

        const cx_px = (elRect.left + elRect.width / 2) - svgRect.left;
        const cy_px = (elRect.top + elRect.height / 2) - svgRect.top;

        const cx_vb = vb[0] + (cx_px - offsetX) / scale;
        const cy_vb = vb[1] + (cy_px - offsetY) / scale;
        const r_vb = Math.max(3, Math.max(elRect.width, elRect.height) / (2 * scale) + 2.5);

        const ns = 'http://www.w3.org/2000/svg';
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('cx', cx_vb);
        ring.setAttribute('cy', cy_vb);
        ring.setAttribute('r', r_vb);
        ring.setAttribute('class', `diff-focus-ring ${ringColorClass || 'diff-changed'}`);
        ring.setAttribute('style', `stroke-width: ${Math.max(0.4, r_vb * 0.08)}mm; pointer-events: none;`);
        hostSvg.appendChild(ring);

        setTimeout(() => { ring.remove(); }, 2500);
      }
    }
  };

function getScreenCoordsFromSvg(viewportContentEl, coords) {
  if (!coords) return null;
  const svg = viewportContentEl.querySelector('svg');
  if (!svg) return null;

  const svgRect = svg.getBoundingClientRect();
  const viewBoxStr = svg.getAttribute('viewBox');
  if (!viewBoxStr) return null;

  const vb = viewBoxStr.split(/[\s,]+/).map(parseFloat);
  if (vb.length < 4 || vb[2] <= 0 || vb[3] <= 0) return null;

  const vbW = vb[2];
  const vbH = vb[3];

  // KiCad SVGs preserve aspect ratio (xMidYMid meet)
  const scale = Math.min(svgRect.width / vbW, svgRect.height / vbH);
  const offsetX = (svgRect.width - vbW * scale) / 2;
  const offsetY = (svgRect.height - vbH * scale) / 2;

  return {
    left: svgRect.left + offsetX + (coords.x - vb[0]) * scale,
    top: svgRect.top + offsetY + (coords.y - vb[1]) * scale,
    width: 0,
    height: 0
  };
}

  useImperativeHandle(ref, () => ({
    focusElement({ diffIdx, side, diffType, baseCoords, targetCoords, bbox }) {
      if (!leftContentRef.current || !rightContentRef.current) return;

      const leftViewport = leftContentRef.current.parentElement;
      const rightViewport = rightContentRef.current.parentElement;
      if (!leftViewport || !rightViewport) return;

      const targetScale = 3.5;

      // 1. Locate DOM element with data-diff-idx
      let leftTarget = leftContentRef.current ? leftContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`) : null;
      let rightTarget = rightContentRef.current ? rightContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`) : null;

      let leftRect = leftTarget ? leftTarget.getBoundingClientRect() : null;
      let rightRect = rightTarget ? rightTarget.getBoundingClientRect() : null;

      // 2. Fallback to coordinate mapping if not in DOM
      if (!leftRect && baseCoords && leftContentRef.current) {
        leftRect = getScreenCoordsFromSvg(leftContentRef.current, baseCoords);
      }
      if (!rightRect && targetCoords && rightContentRef.current) {
        rightRect = getScreenCoordsFromSvg(rightContentRef.current, targetCoords);
      }

      let leftParams = null;
      let rightParams = null;

      if (leftRect) {
        leftParams = {
          elRect: leftRect,
          viewportRect: leftViewport.getBoundingClientRect(),
          targetScale
        };
        drawFocusRing(leftContentRef.current, diffIdx, diffType === 'delete' ? 'diff-deleted' : 'diff-changed');
      }

      if (rightRect) {
        rightParams = {
          elRect: rightRect,
          viewportRect: rightViewport.getBoundingClientRect(),
          targetScale
        };
        drawFocusRing(rightContentRef.current, diffIdx, diffType === 'add' ? 'diff-added' : 'diff-changed');
      }

      // 3. In synchronized mode, ensure both panels center on the modification
      if (synced) {
        if (leftParams && !rightParams) {
          rightParams = {
            elRect: leftRect,
            viewportRect: rightViewport.getBoundingClientRect(),
            targetScale
          };
        } else if (rightParams && !leftParams) {
          leftParams = {
            elRect: rightRect,
            viewportRect: leftViewport.getBoundingClientRect(),
            targetScale
          };
        }
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
      const clearHover = (rootEl) => {
        if (!rootEl) return;
        rootEl.querySelectorAll('[data-diff-hovered="true"]').forEach(el => {
          el.removeAttribute('data-diff-hovered');
        });
      };

      clearHover(leftContentRef.current);
      clearHover(rightContentRef.current);

      if (diffIdx !== undefined && diffIdx !== null) {
        const applyHover = (rootEl) => {
          if (!rootEl) return;
          rootEl.querySelectorAll(`[data-diff-idx="${diffIdx}"]`).forEach(el => {
            el.setAttribute('data-diff-hovered', 'true');
          });
        };
        applyHover(leftContentRef.current);
        applyHover(rightContentRef.current);
      }
    }
  }), [animateTo, focusOnBoundingBox]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  useEffect(() => {
    const handleGlobalUp = () => {};
    window.addEventListener('mouseup', handleGlobalUp);
    return () => window.removeEventListener('mouseup', handleGlobalUp);
  }, []);

  return (
    <>
      <style>{FOCUS_CSS}</style>
      <style>{DIFF_CSS}</style>
      {activeAuditIdx !== null && (
        <style>{`
          .mode-side-by-side.has-focus svg * {
            opacity: 0.1 !important;
          }
          .mode-side-by-side.has-focus svg [data-diff-idx="${activeAuditIdx}"],
          .mode-side-by-side.has-focus svg [data-diff-idx="${activeAuditIdx}"] * {
            opacity: 1 !important;
            filter: none !important;
          }
        `}</style>
      )}

      <div
        ref={outerRef}
        className={`mode-side-by-side ${isSchematicMode ? 'schematic-mode' : 'pcb-mode'} ${activeAuditIdx !== null ? 'has-focus' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          gap: 0,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '6px 14px',
          background: '#0e0f18',
          borderBottom: '1px solid #232738',
          flexShrink: 0,
        }}>
          <SwapOutlined style={{ color: '#fadb14' }} />
          <Text style={{ color: '#a6adbb', fontSize: '12px' }}>
            Scroll to zoom · Drag to pan {synced ? '(Linked Views)' : '(Independent Views)'}
          </Text>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px' }}>
            <span style={{ color: synced ? '#faad14' : '#6b7280', fontSize: '11px', fontWeight: 600, userSelect: 'none' }}>
              Sync Views
            </span>
            <Switch
              size="small"
              checked={synced}
              onChange={setSynced}
              style={{
                background: synced ? '#faad14' : '#3f3f46',
              }}
            />
          </div>

          <button
            onClick={() => {
              resetTransform();
              if (setActiveAuditIdx) setActiveAuditIdx(null);
            }}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#fadb14',
              borderRadius: 4,
              padding: '2px 10px',
              fontSize: '11px',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            Reset View
          </button>
        </div>

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
            width: '3px',
            background: 'linear-gradient(to bottom, #fadb14 0%, #faad14 50%, #fadb14 100%)',
            borderRadius: '2px',
            flexShrink: 0,
            opacity: 0.7,
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

        {/* Pad/net label overlay — rendered for PCB diffs when padLabelProps is provided */}
        {padLabelProps && (
          <PadLabelOverlay
            repoPath={padLabelProps.repoPath}
            baseCommit={padLabelProps.baseCommit}
            targetCommit={padLabelProps.targetCommit}
            relativeFilePath={padLabelProps.relativeFilePath}
            leftContentRef={leftContentRef}
            rightContentRef={rightContentRef}
            activeLayers={activeLayers}
            soloLayer={soloLayer}
            layerOpacities={layerOpacities}
            baseTransformScale={baseTransform.scale}
            targetTransformScale={targetTransform.scale}
          />
        )}
      </div>
    </>
  );
});
