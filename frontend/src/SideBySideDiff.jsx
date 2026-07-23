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

  /* Unchanged components and text ('sch-text-glyph') must map to #7a828a at opacity: 0.3 */
  .mode-side-by-side .diff-unchanged,
  .mode-side-by-side .sch-text-glyph {
    opacity: 0.3 !important;
    filter:  none !important;
  }

  .mode-side-by-side svg .diff-open.diff-unchanged,
  .mode-side-by-side svg .diff-open.sch-text-glyph {
    stroke: #7a828a !important;
    fill:   none    !important;
  }

  .mode-side-by-side svg .diff-closed.diff-unchanged,
  .mode-side-by-side svg .diff-closed.sch-text-glyph {
    fill:   #7a828a !important;
    stroke: none    !important;
  }

  .mode-side-by-side svg text.diff-unchanged,
  .mode-side-by-side svg text.diff-unchanged tspan,
  .mode-side-by-side svg text.sch-text-glyph,
  .mode-side-by-side svg text.sch-text-glyph tspan,
  .mode-side-by-side svg use.diff-unchanged,
  .mode-side-by-side svg use.sch-text-glyph {
    fill:   #7a828a !important;
    stroke: none    !important;
  }

  /* Component Container Group cascading styles */
  .mode-side-by-side .diff-changed *,
  .mode-side-by-side [class*="diff-changed"] * {
    stroke: #ffff00 !important;
  }
  .mode-side-by-side .diff-added *,
  .mode-side-by-side [class*="diff-added"] * {
    stroke: #00ff66 !important;
  }
  .mode-side-by-side .diff-deleted *,
  .mode-side-by-side [class*="diff-deleted"] * {
    stroke: #ff3366 !important;
  }

  /* Fills for closed shapes inside highlighted component groups */
  .mode-side-by-side .diff-changed .diff-closed,
  .mode-side-by-side .diff-changed circle,
  .mode-side-by-side .diff-changed rect,
  .mode-side-by-side .diff-changed polygon {
    fill: rgba(255, 255, 0, 0.2) !important;
  }
  .mode-side-by-side .diff-added .diff-closed,
  .mode-side-by-side .diff-added circle,
  .mode-side-by-side .diff-added rect,
  .mode-side-by-side .diff-added polygon {
    fill: rgba(0, 255, 102, 0.2) !important;
  }
  .mode-side-by-side .diff-deleted .diff-closed,
  .mode-side-by-side .diff-deleted circle,
  .mode-side-by-side .diff-deleted rect,
  .mode-side-by-side .diff-deleted polygon {
    fill: rgba(255, 51, 102, 0.2) !important;
  }

  /* Text inside highlighted component groups */
  .mode-side-by-side .diff-changed text,
  .mode-side-by-side .diff-changed tspan {
    fill: #ffff00 !important;
    stroke: none !important;
  }
  .mode-side-by-side .diff-added text,
  .mode-side-by-side .diff-added tspan {
    fill: #00ff66 !important;
    stroke: none !important;
  }
  .mode-side-by-side .diff-deleted text,
  .mode-side-by-side .diff-deleted tspan {
    fill: #ff3366 !important;
    stroke: none !important;
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
  }, [baseTransform]);

  useEffect(() => {
    targetTransformRef.current = targetTransform;
  }, [targetTransform]);

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

        setBaseTransform({ scale: newScale, x: newX, y: newY });
      } else {
        const state = targetTransformRef.current;
        const newScale = Math.min(80, Math.max(0.02, state.scale * factor));

        const relMouseX = mouseX - rect.width / 2;
        const relMouseY = e.clientY - rect.top;

        const newX = relMouseX - (relMouseX - state.x) * (newScale / state.scale);
        const newY = relMouseY - (relMouseY - state.y) * (newScale / state.scale);

        setTargetTransform({ scale: newScale, x: newX, y: newY });
      }
    }
  }, [outerRef, synced, setBaseTransform, setTargetTransform]);

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

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    if (synced) {
      setBaseTransform({
        scale: baseTransformRef.current.scale,
        x: dragRef.current.originLeftX + deltaX,
        y: dragRef.current.originLeftY + deltaY
      });
      setTargetTransform({
        scale: targetTransformRef.current.scale,
        x: dragRef.current.originRightX + deltaX,
        y: dragRef.current.originRightY + deltaY
      });
    } else {
      if (dragRef.current.isLeft) {
        setBaseTransform({
          scale: baseTransformRef.current.scale,
          x: dragRef.current.originLeftX + deltaX,
          y: dragRef.current.originLeftY + deltaY
        });
      } else {
        setTargetTransform({
          scale: targetTransformRef.current.scale,
          x: dragRef.current.originRightX + deltaX,
          y: dragRef.current.originRightY + deltaY
        });
      }
    }
  }, [synced, setBaseTransform, setTargetTransform]);

  const onMouseUp = useCallback((e) => {
    dragRef.current.active = false;
    if (e.currentTarget) e.currentTarget.style.cursor = 'grab';
  }, []);

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
        setBaseTransform(nextBase);
      }

      if (rightStart && rightTarget) {
        const nextTarget = {
          scale: rightStart.scale + (rightTarget.scale - rightStart.scale) * e,
          x: rightStart.x + (rightTarget.x - rightStart.x) * e,
          y: rightStart.y + (rightTarget.y - rightStart.y) * e,
        };
        targetTransformRef.current = nextTarget;
        setTargetTransform(nextTarget);
      }

      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  }, [setBaseTransform, setTargetTransform]);

  return { onWheel, onMouseDown, onMouseMove, onMouseUp, resetTransform, animateTo };
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
  const leftContentRef = useRef(null);
  const rightContentRef = useRef(null);
  const outerRef = useRef(null);
  const [synced, setSynced] = useState(true);

  const [baseTransform, setBaseTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [targetTransform, setTargetTransform] = useState({ scale: 1, x: 0, y: 0 });

  const { onWheel, onMouseDown, onMouseMove, onMouseUp, resetTransform, animateTo } =
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

  const drawFocusRing = (contentEl, idx, ringColorClass) => {
    const target = contentEl.querySelector(`[data-diff-idx="${idx}"]`);
    if (!target) return;

    const elRect = target.getBoundingClientRect();
    const hostSvg = target.closest('svg');
    if (!hostSvg) return;

    const svgRect = hostSvg.getBoundingClientRect();
    const cx = elRect.left + elRect.width / 2 - svgRect.left;
    const cy = elRect.top + elRect.height / 2 - svgRect.top;
    const rBase = Math.max(elRect.width, elRect.height) / 2 + 4;

    const ns = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', cx);
    ring.setAttribute('cy', cy);
    ring.setAttribute('r', rBase);
    ring.setAttribute('class', `diff-focus-ring ${ringColorClass}`);
    hostSvg.appendChild(ring);

    setTimeout(() => { ring.remove(); }, 2200);
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
    focusElement({ diffIdx, side, diffType, baseCoords, targetCoords }) {
      if (!leftContentRef.current || !rightContentRef.current) return;

      const leftViewport = leftContentRef.current.parentElement;
      const rightViewport = rightContentRef.current.parentElement;
      if (!leftViewport || !rightViewport) return;

      let leftParams = null;
      let rightParams = null;
      
      const targetScale = 4.0; // scale = 4.0 as per architectural rules

      const normalizedType = diffType === 'delete_layer' ? 'delete'
                           : diffType === 'add_layer' ? 'add'
                           : diffType;

      if (normalizedType === 'delete') {
        let elRect = getScreenCoordsFromSvg(leftContentRef.current, baseCoords);
        if (!elRect) {
          const target = leftContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
          if (target) elRect = target.getBoundingClientRect();
        }
        if (elRect) {
          leftParams = {
            elRect,
            viewportRect: leftViewport.getBoundingClientRect(),
            targetScale
          };
          drawFocusRing(leftContentRef.current, diffIdx, 'diff-deleted');
        }
      }
      else if (normalizedType === 'add') {
        let elRect = getScreenCoordsFromSvg(rightContentRef.current, targetCoords);
        if (!elRect) {
          const target = rightContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
          if (target) elRect = target.getBoundingClientRect();
        }
        if (elRect) {
          rightParams = {
            elRect,
            viewportRect: rightViewport.getBoundingClientRect(),
            targetScale
          };
          drawFocusRing(rightContentRef.current, diffIdx, 'diff-added');
        }
      }
      else if (normalizedType === 'modify') {
        let leftRect = getScreenCoordsFromSvg(leftContentRef.current, baseCoords);
        if (!leftRect) {
          const leftTarget = leftContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
          if (leftTarget) leftRect = leftTarget.getBoundingClientRect();
        }

        let rightRect = getScreenCoordsFromSvg(rightContentRef.current, targetCoords);
        if (!rightRect) {
          const rightTarget = rightContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
          if (rightTarget) rightRect = rightTarget.getBoundingClientRect();
        }

        if (leftRect) {
          leftParams = {
            elRect: leftRect,
            viewportRect: leftViewport.getBoundingClientRect(),
            targetScale
          };
          drawFocusRing(leftContentRef.current, diffIdx, 'diff-changed');
        }
        if (rightRect) {
          rightParams = {
            elRect: rightRect,
            viewportRect: rightViewport.getBoundingClientRect(),
            targetScale
          };
          drawFocusRing(rightContentRef.current, diffIdx, 'diff-changed');
        }
      }

      animateTo(leftParams, rightParams, 550);
    }
  }), [animateTo]);

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
        className={`mode-side-by-side ${activeAuditIdx !== null ? 'has-focus' : ''}`}
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
