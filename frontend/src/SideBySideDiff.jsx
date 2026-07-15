import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Tag, Typography, Switch } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  SwapOutlined
} from '@ant-design/icons';

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

  /* ==========================================================================
     SIDE-BY-SIDE OPACITY & UNCHANGED-GREY STYLESHEET
     Scoped to .mode-side-by-side — Overlay Slider completely unaffected.

     Color highlights (changed/added/deleted) are now applied via inline style
     in the backend SVG annotator, which beats HTML presentation attributes in
     the CSS cascade without stripping any native KiCad geometry data.

     This stylesheet is responsible for two things only:
       1. Fading unchanged elements to ghost grey (opacity tiers).
       2. Overriding unchanged element paint to a neutral grey so unchanged
          copper/pads don't show in their original bright KiCad colors.
     ========================================================================== */


  /* ── Tier 1: Modifications — block any inherited opacity fade ───────────────
   * Inline style already sets opacity:1 on each element, but adding it here
   * ensures container-level opacity rules cannot cascade downward.            */

  .mode-side-by-side .diff-changed,
  .mode-side-by-side .diff-added,
  .mode-side-by-side .diff-deleted {
    opacity: 1 !important;
    filter:  none !important;
  }


  /* ── Tier 2: Active layer unchanged — 85% opacity crisp grey blueprint ──────
   * The selected/inspected layer structural guide.                            */

  .mode-side-by-side .layer-active .diff-unchanged {
    opacity: 0.85 !important;
    filter:  none  !important;
  }

  /* Grey override for unchanged open geometry on active layer */
  .mode-side-by-side .layer-active svg .diff-open.diff-unchanged {
    stroke: #7a828a !important;
    fill:   none    !important;
  }

  /* Grey override for unchanged closed shapes on active layer */
  .mode-side-by-side .layer-active svg .diff-closed.diff-unchanged {
    fill:   #4a5058 !important;
    stroke: none    !important;
  }

  /* Grey override for text on active layer */
  .mode-side-by-side .layer-active svg text.diff-unchanged,
  .mode-side-by-side .layer-active svg text.diff-unchanged tspan,
  .mode-side-by-side .layer-active svg use.diff-unchanged {
    fill:   #7a828a !important;
    stroke: none    !important;
  }


  /* ── Tier 3: Background layers unchanged — 15% ghost blueprint matrix ───────
   * All non-active layers recede into a barely-visible outline grid.          */

  .mode-side-by-side .layer-background .diff-unchanged {
    opacity: 0.15 !important;
    filter:  none  !important;
  }

  /* Grey override for unchanged open geometry on background layers */
  .mode-side-by-side .layer-background svg .diff-open.diff-unchanged {
    stroke: #555c66 !important;
    fill:   none    !important;
  }

  /* Grey override for unchanged closed shapes on background layers */
  .mode-side-by-side .layer-background svg .diff-closed.diff-unchanged {
    fill:   #333840 !important;
    stroke: none    !important;
  }

  /* Grey override for text on background layers */
  .mode-side-by-side .layer-background svg text.diff-unchanged,
  .mode-side-by-side .layer-background svg text.diff-unchanged tspan,
  .mode-side-by-side .layer-background svg use.diff-unchanged {
    fill:   #555c66 !important;
    stroke: none    !important;
  }


  /* ── Fallback: No tier class present — treat as background ghost ────────────
   * Safety net for any layer wrapper missing a tier class.                   */

  .mode-side-by-side .diff-unchanged {
    opacity: 0.15 !important;
    filter:  none  !important;
  }
  .mode-side-by-side svg .diff-open.diff-unchanged {
    stroke: #7a828a !important;
    fill:   none    !important;
  }
  .mode-side-by-side svg .diff-closed.diff-unchanged {
    fill:   #7a828a !important;
    stroke: none    !important;
  }
  .mode-side-by-side svg text.diff-unchanged,
  .mode-side-by-side svg text.diff-unchanged tspan,
  .mode-side-by-side svg use.diff-unchanged {
    fill:   #7a828a !important;
    stroke: none    !important;
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
    !name.includes('paste')
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
// Supports two independent viewports (leftTransformRef and rightTransformRef).
// Panning and zooming can be locked together (synced === true) or decoupled (synced === false).
function useSyncedTransform(leftContentRef, rightContentRef, outerRef, synced) {
  const leftTransformRef = useRef({ scale: 1, x: 0, y: 0 });
  const rightTransformRef = useRef({ scale: 1, x: 0, y: 0 });
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

  const applyTransform = useCallback(() => {
    const left = leftTransformRef.current;
    const right = rightTransformRef.current;

    if (leftContentRef.current) {
      leftContentRef.current.style.transform = `translate3d(${left.x}px, ${left.y}px, 0px) scale(${left.scale})`;
    }
    if (rightContentRef.current) {
      rightContentRef.current.style.transform = `translate3d(${right.x}px, ${right.y}px, 0px) scale(${right.scale})`;
    }
  }, [leftContentRef, rightContentRef]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!outerRef.current) return;

    const rect = outerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const isLeft = mouseX < rect.width / 2;

    const factor = e.deltaY < 0 ? 1.12 : 0.90;

    if (synced) {
      const leftState = leftTransformRef.current;
      const newScale = Math.min(80, Math.max(0.02, leftState.scale * factor));

      const newLeftX = mouseX - (mouseX - leftState.x) * (newScale / leftState.scale);
      const newLeftY = e.clientY - rect.top - (e.clientY - rect.top - leftState.y) * (newScale / leftState.scale);

      leftTransformRef.current = { scale: newScale, x: newLeftX, y: newLeftY };
      rightTransformRef.current = { scale: newScale, x: newLeftX, y: newLeftY };
    } else {
      const transformRef = isLeft ? leftTransformRef : rightTransformRef;
      const state = transformRef.current;
      const newScale = Math.min(80, Math.max(0.02, state.scale * factor));

      const panelOffset = isLeft ? 0 : rect.width / 2;
      const relMouseX = mouseX - panelOffset;
      const relMouseY = e.clientY - rect.top;

      const newX = relMouseX - (relMouseX - state.x) * (newScale / state.scale);
      const newY = relMouseY - (relMouseY - state.y) * (newScale / state.scale);

      transformRef.current = { scale: newScale, x: newX, y: newY };
    }
    applyTransform();
  }, [applyTransform, outerRef, synced]);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || !outerRef.current) return;

    const rect = outerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const isLeft = clickX < rect.width / 2;

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originLeftX: leftTransformRef.current.x,
      originLeftY: leftTransformRef.current.y,
      originRightX: rightTransformRef.current.x,
      originRightY: rightTransformRef.current.y,
      isLeft
    };
    e.currentTarget.style.cursor = 'grabbing';
  }, [outerRef]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    if (synced) {
      leftTransformRef.current.x = dragRef.current.originLeftX + deltaX;
      leftTransformRef.current.y = dragRef.current.originLeftY + deltaY;
      rightTransformRef.current.x = dragRef.current.originRightX + deltaX;
      rightTransformRef.current.y = dragRef.current.originRightY + deltaY;
    } else {
      if (dragRef.current.isLeft) {
        leftTransformRef.current.x = dragRef.current.originLeftX + deltaX;
        leftTransformRef.current.y = dragRef.current.originLeftY + deltaY;
      } else {
        rightTransformRef.current.x = dragRef.current.originRightX + deltaX;
        rightTransformRef.current.y = dragRef.current.originRightY + deltaY;
      }
    }
    applyTransform();
  }, [applyTransform, synced]);

  const onMouseUp = useCallback((e) => {
    dragRef.current.active = false;
    if (e.currentTarget) e.currentTarget.style.cursor = 'grab';
  }, []);

  const resetTransform = useCallback(() => {
    leftTransformRef.current = { scale: 1, x: 0, y: 0 };
    rightTransformRef.current = { scale: 1, x: 0, y: 0 };
    applyTransform();
  }, [applyTransform]);

  const animateTo = useCallback((leftParams, rightParams, durationMs = 550) => {
    const startTime = performance.now();
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const leftStart = leftParams ? { ...leftTransformRef.current } : null;
    const rightStart = rightParams ? { ...rightTransformRef.current } : null;

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
        leftTransformRef.current = {
          scale: leftStart.scale + (leftTarget.scale - leftStart.scale) * e,
          x: leftStart.x + (leftTarget.x - leftStart.x) * e,
          y: leftStart.y + (leftTarget.y - leftStart.y) * e,
        };
      }

      if (rightStart && rightTarget) {
        rightTransformRef.current = {
          scale: rightStart.scale + (rightTarget.scale - rightStart.scale) * e,
          x: rightStart.x + (rightTarget.x - rightStart.x) * e,
          y: rightStart.y + (rightTarget.y - rightStart.y) * e,
        };
      }

      applyTransform();

      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  }, [applyTransform]);

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
function SvgPanel({ svgs, activeLayers, soloLayer, layerOpacities, contentRef, side, commitLabel }) {
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
}, ref) {
  const leftContentRef = useRef(null);
  const rightContentRef = useRef(null);
  const outerRef = useRef(null);
  const [synced, setSynced] = useState(true);

  const { onWheel, onMouseDown, onMouseMove, onMouseUp, resetTransform, animateTo } =
    useSyncedTransform(leftContentRef, rightContentRef, outerRef, synced);

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

  useImperativeHandle(ref, () => ({
    focusElement({ diffIdx, side, diffType }) {
      if (!leftContentRef.current || !rightContentRef.current) return;

      const leftViewport = leftContentRef.current.parentElement;
      const rightViewport = rightContentRef.current.parentElement;
      if (!leftViewport || !rightViewport) return;

      let leftParams = null;
      let rightParams = null;

      if (diffType === 'delete') {
        const target = leftContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
        if (target) {
          leftParams = {
            elRect: target.getBoundingClientRect(),
            viewportRect: leftViewport.getBoundingClientRect(),
            targetScale: 10
          };
          drawFocusRing(leftContentRef.current, diffIdx, 'diff-deleted');
        }
      }
      else if (diffType === 'add') {
        const target = rightContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
        if (target) {
          rightParams = {
            elRect: target.getBoundingClientRect(),
            viewportRect: rightViewport.getBoundingClientRect(),
            targetScale: 10
          };
          drawFocusRing(rightContentRef.current, diffIdx, 'diff-added');
        }
      }
      else if (diffType === 'modify') {
        const leftTarget = leftContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
        const rightTarget = rightContentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);

        if (leftTarget) {
          leftParams = {
            elRect: leftTarget.getBoundingClientRect(),
            viewportRect: leftViewport.getBoundingClientRect(),
            targetScale: 10
          };
          drawFocusRing(leftContentRef.current, diffIdx, 'diff-changed');
        }
        if (rightTarget) {
          rightParams = {
            elRect: rightTarget.getBoundingClientRect(),
            viewportRect: rightViewport.getBoundingClientRect(),
            targetScale: 10
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

      <div
        ref={outerRef}
        className="mode-side-by-side"
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
            onClick={resetTransform}
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
          />
        </div>
      </div>
    </>
  );
});
