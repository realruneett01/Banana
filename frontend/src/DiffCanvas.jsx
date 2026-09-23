import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Typography } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined
} from '@ant-design/icons';

const { Text } = Typography;

/**
 * Normalizes backslashes to forward slashes and matches the filename
 * against the selected active layers checklist.
 */
const isLayerActive = (filename, activeLayers) => {
  const name = filename.toLowerCase();

  // If it's a schematic export (usually single SVG like "analogins.svg"),
  // show it regardless of PCB layer filters.
  if (
    !name.includes('_cu') &&
    !name.includes('silkscreen') &&
    !name.includes('edge_cuts') &&
    !name.includes('silks') &&
    !name.includes('mask') &&
    !name.includes('paste') &&
    !name.includes('courtyard')
  ) {
    return true;
  }

  return activeLayers.some((layer) => {
    const normalizedLayer = layer.replace('.', '_').toLowerCase();

    // Special mappings for silkscreen layers
    if (normalizedLayer === 'f_silks') {
      return name.includes('f_silkscreen') || name.includes('f_silks');
    }
    if (normalizedLayer === 'b_silks') {
      return name.includes('b_silkscreen') || name.includes('b_silks');
    }

    return name.includes(normalizedLayer);
  });
};

/**
 * Checks if a specific SVG filename matches the currently soloed layer.
 */
const isLayerSolo = (filename, soloLayer) => {
  if (!soloLayer) return true;
  const name = filename.toLowerCase();
  const normalizedLayer = soloLayer.replace('.', '_').toLowerCase();

  if (normalizedLayer === 'f_silks') {
    return name.includes('f_silkscreen') || name.includes('f_silks');
  }
  if (normalizedLayer === 'b_silks') {
    return name.includes('b_silkscreen') || name.includes('b_silks');
  }

  return name.includes(normalizedLayer);
};

// Helper to match layer filename and return configured opacity (0-1)
const getLayerOpacity = (filename, layerOpacities) => {
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
};

// Direct 2D transform update avoiding 3D layer raster freeze
const applyTransformToDom = (element, transform) => {
  if (element) {
    element.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  }
};

const SvgLayer = React.memo(({ filename, content, isBase, filterStyle, opacityStyle, mixBlendMode }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        filter: filterStyle,
        opacity: opacityStyle,
        mixBlendMode,
        transition: 'filter 0.25s ease, opacity 0.25s ease',
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{
        __html: content.replace(/<svg/, '<svg style="width:100%; height:100%; position:absolute;"')
      }}
    />
  );
}, (prev, next) => {
  return prev.content === next.content &&
         prev.filterStyle === next.filterStyle &&
         prev.opacityStyle === next.opacityStyle &&
         prev.mixBlendMode === next.mixBlendMode;
});

// Helper to map SVG coordinates to screen pixel positions
function getScreenCoordsFromSvg(viewportContentEl, coords) {
  if (!coords || !viewportContentEl) return null;
  const svg = viewportContentEl.querySelector('svg');
  if (!svg) return null;

  const svgRect = svg.getBoundingClientRect();
  const viewBoxStr = svg.getAttribute('viewBox');
  if (!viewBoxStr) return null;

  const vb = viewBoxStr.split(/[\s,]+/).map(parseFloat);
  if (vb.length < 4 || vb[2] <= 0 || vb[3] <= 0) return null;

  const vbW = vb[2];
  const vbH = vb[3];

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

const DiffCanvas = forwardRef(function DiffCanvas({
  baseSvgs,
  targetSvgs,
  diffMode,
  activeLayers,
  sliderValue,
  onSliderChange,
  soloLayer,
  layerOpacities,
  baseCommit,
  targetCommit,
  activeAuditIdx,
  setActiveAuditIdx
}, ref) {
  const outerRef = useRef(null);
  const contentRef = useRef(null);

  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);

  const dragRef = useRef({
    active: false,
    isSlider: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  });

  const isSlider = diffMode === 'Overlay Slider';

  // Filter base and target svgs based on active layers
  const activeBaseSvgs = (baseSvgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));
  const activeTargetSvgs = (targetSvgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));

  // Direct sync from state to ref & DOM on transform change
  useEffect(() => {
    transformRef.current = transform;
    applyTransformToDom(contentRef.current, transform);
  }, [transform]);

  // Sync selected diff highlight when activeAuditIdx changes
  useEffect(() => {
    if (!contentRef.current) return;
    contentRef.current.querySelectorAll('[data-diff-selected="true"]').forEach(el => {
      el.removeAttribute('data-diff-selected');
      el.classList.remove('diff-highlight-active');
    });
    if (activeAuditIdx !== null && activeAuditIdx !== undefined) {
      const el = contentRef.current.querySelector(`[data-diff-idx="${activeAuditIdx}"]`);
      if (el) {
        el.setAttribute('data-diff-selected', 'true');
        el.classList.add('diff-highlight-active');
      }
    }
  }, [activeAuditIdx]);

  // Smooth animation helper
  const animateTo = useCallback((targetTransform, durationMs = 450) => {
    const startTime = performance.now();
    const startTransform = { ...transformRef.current };
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const tick = (now) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const e = easeInOut(t);

      const next = {
        scale: startTransform.scale + (targetTransform.scale - startTransform.scale) * e,
        x: startTransform.x + (targetTransform.x - startTransform.x) * e,
        y: startTransform.y + (targetTransform.y - startTransform.y) * e
      };

      transformRef.current = next;
      applyTransformToDom(contentRef.current, next);

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        setTransform(next);
      }
    };

    requestAnimationFrame(tick);
  }, []);

  // Draw glowing focus ring on modified element using native SVG coordinates
  const drawFocusRing = useCallback((targetElOrRect, ringClass) => {
    if (!contentRef.current) return;
    const isEl = targetElOrRect instanceof Element;
    const elRect = isEl ? targetElOrRect.getBoundingClientRect() : targetElOrRect;
    if (!elRect) return;

    const hostSvg = isEl ? targetElOrRect.closest('svg') : contentRef.current.querySelector('svg');
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
        ring.setAttribute('class', `diff-focus-ring ${ringClass || 'diff-changed'}`);
        ring.setAttribute('style', `stroke-width: ${Math.max(0.4, r_vb * 0.08)}mm; pointer-events: none;`);
        hostSvg.appendChild(ring);

        setTimeout(() => { ring.remove(); }, 2500);
      }
    }
  }, []);

  // Expose imperative API for zooming to diff elements and hover highlights
  useImperativeHandle(ref, () => ({
    focusElement({ diffIdx, diffType, baseCoords, targetCoords, bbox }) {
      if (!outerRef.current || !contentRef.current) return;

      const vpRect = outerRef.current.getBoundingClientRect();
      const targetScale = 3.5;

      // 1. Locate DOM element with data-diff-idx
      let target = contentRef.current.querySelector(`[data-diff-idx="${diffIdx}"]`);
      let elRect = target ? target.getBoundingClientRect() : null;

      // 2. Fallback to coordinate mapping if element is not in DOM
      if (!elRect) {
        const coords = targetCoords || baseCoords || (bbox ? { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 } : null);
        if (coords) {
          elRect = getScreenCoordsFromSvg(contentRef.current, coords);
        }
      }

      // 3. If target element or coordinates resolved, smoothly zoom to it
      if (elRect) {
        const elCX = (elRect.left + elRect.width / 2) - vpRect.left;
        const elCY = (elRect.top + elRect.height / 2) - vpRect.top;
        const current = transformRef.current;
        const contentX = (elCX - current.x) / current.scale;
        const contentY = (elCY - current.y) / current.scale;

        const vpCX = vpRect.width / 2;
        const vpCY = vpRect.height / 2;

        const nextTransform = {
          scale: targetScale,
          x: vpCX - contentX * targetScale,
          y: vpCY - contentY * targetScale
        };

        animateTo(nextTransform, 450);

        // Highlight targeted element
        contentRef.current.querySelectorAll('[data-diff-selected="true"]').forEach(el => {
          el.removeAttribute('data-diff-selected');
          el.classList.remove('diff-highlight-active');
        });
        if (target) {
          target.setAttribute('data-diff-selected', 'true');
          target.classList.add('diff-highlight-active');
        }

        // In Overlay Slider mode, position split slider right beside the diff
        if (isSlider && onSliderChange) {
          const idealSplit = diffType === 'add' ? 42 : (diffType === 'delete' ? 58 : 50);
          onSliderChange(idealSplit);
        }

        drawFocusRing(target || elRect, diffType === 'delete' ? 'diff-deleted' : (diffType === 'add' ? 'diff-added' : 'diff-changed'));
      }
    },

    setHoveredDiff(diffIdx) {
      if (!contentRef.current) return;
      contentRef.current.querySelectorAll('[data-diff-hovered="true"]').forEach(el => {
        el.removeAttribute('data-diff-hovered');
      });
      if (diffIdx !== undefined && diffIdx !== null) {
        contentRef.current.querySelectorAll(`[data-diff-idx="${diffIdx}"]`).forEach(el => {
          el.setAttribute('data-diff-hovered', 'true');
        });
      }
    },

    resetView() {
      const defaultVal = { scale: 1, x: 0, y: 0 };
      transformRef.current = defaultVal;
      applyTransformToDom(contentRef.current, defaultVal);
      setTransform(defaultVal);
      if (setActiveAuditIdx) setActiveAuditIdx(null);
    }
  }), [animateTo, drawFocusRing, isSlider, onSliderChange, setActiveAuditIdx]);

  // Allow pressing Escape to clear active modification focus in Overlay mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeAuditIdx !== null) {
        if (setActiveAuditIdx) setActiveAuditIdx(null);
        const defaultVal = { scale: 1, x: 0, y: 0 };
        transformRef.current = defaultVal;
        applyTransformToDom(contentRef.current, defaultVal);
        setTransform(defaultVal);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeAuditIdx, setActiveAuditIdx]);

  // Wheel zoom anchored to cursor
  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!outerRef.current) return;

    const rect = outerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.14 : 0.88;
    const current = transformRef.current;
    const newScale = Math.min(80, Math.max(0.02, current.scale * factor));

    const newX = mouseX - (mouseX - current.x) * (newScale / current.scale);
    const newY = mouseY - (mouseY - current.y) * (newScale / current.scale);

    const nextVal = { scale: newScale, x: newX, y: newY };
    transformRef.current = nextVal;
    applyTransformToDom(contentRef.current, nextVal);
    setTransform(nextVal);
  }, []);

  // Mouse pan & slider split drag
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || !outerRef.current) return;

    // Check if user clicked on or near the slider line
    if (e.target.closest('.diff-slider-handle')) {
      dragRef.current = {
        active: false,
        isSlider: true,
        startX: e.clientX
      };
      return;
    }

    dragRef.current = {
      active: true,
      isSlider: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y
    };
    if (outerRef.current) outerRef.current.style.cursor = 'grabbing';
  }, []);

  const onMouseMove = useCallback((e) => {
    // 1. Slider handle drag
    if (dragRef.current.isSlider && isSlider && onSliderChange && outerRef.current) {
      const rect = outerRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      onSliderChange(Math.round(pct));
      return;
    }

    // 2. Viewport pan drag
    if (!dragRef.current.active) return;

    const deltaX = e.clientX - dragRef.current.startX;
    const deltaY = e.clientY - dragRef.current.startY;

    const nextVal = {
      scale: transformRef.current.scale,
      x: dragRef.current.originX + deltaX,
      y: dragRef.current.originY + deltaY
    };

    transformRef.current = nextVal;
    applyTransformToDom(contentRef.current, nextVal);
  }, [isSlider, onSliderChange]);

  const onMouseUp = useCallback(() => {
    if (dragRef.current.active) {
      dragRef.current.active = false;
      if (outerRef.current) outerRef.current.style.cursor = 'grab';
      setTransform({ ...transformRef.current });
    }
    dragRef.current.isSlider = false;
  }, []);

  // Zoom control helpers
  const zoomIn = useCallback(() => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const current = transformRef.current;
    const newScale = Math.min(80, current.scale * 1.25);
    const newX = cx - (cx - current.x) * (newScale / current.scale);
    const newY = cy - (cy - current.y) * (newScale / current.scale);
    const nextVal = { scale: newScale, x: newX, y: newY };
    transformRef.current = nextVal;
    applyTransformToDom(contentRef.current, nextVal);
    setTransform(nextVal);
  }, []);

  const zoomOut = useCallback(() => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const current = transformRef.current;
    const newScale = Math.max(0.02, current.scale * 0.8);
    const newX = cx - (cx - current.x) * (newScale / current.scale);
    const newY = cy - (cy - current.y) * (newScale / current.scale);
    const nextVal = { scale: newScale, x: newX, y: newY };
    transformRef.current = nextVal;
    applyTransformToDom(contentRef.current, nextVal);
    setTransform(nextVal);
  }, []);

  const resetView = useCallback(() => {
    const defaultVal = { scale: 1, x: 0, y: 0 };
    transformRef.current = defaultVal;
    applyTransformToDom(contentRef.current, defaultVal);
    setTransform(defaultVal);
  }, []);

  const onDoubleClick = useCallback((e) => {
    if (e.target.closest('button')) return;
    resetView();
  }, [resetView]);

  // Bind wheel listener with non-passive flag to prevent page scroll
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Window mouseup listener
  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseUp]);

  // CSS filter to turn SVGs pure red:
  const redFilter = 'invert(24%) sepia(93%) saturate(7355%) hue-rotate(356deg) brightness(94%) contrast(119%)';
  // CSS filter to turn SVGs pure green:
  const greenFilter = 'invert(57%) sepia(74%) saturate(2256%) hue-rotate(84deg) brightness(119%) contrast(118%)';

  const renderSvgElement = (svg, isBase) => {
    const isSolo = !soloLayer || isLayerSolo(svg.filename, soloLayer);
    const layerOp = getLayerOpacity(svg.filename, layerOpacities);

    let filterStyle = 'none';
    if (!isSlider) {
      filterStyle = isBase ? redFilter : greenFilter;
    }

    if (soloLayer && !isSolo) {
      filterStyle = 'grayscale(1) opacity(0.12) contrast(0.5) brightness(0.6)';
    }

    const elementOpacity = (soloLayer && !isSolo) ? 0.12 : layerOp;
    const blendMode = (isSlider || (soloLayer && !isSolo)) ? 'normal' : 'difference';

    return (
      <SvgLayer
        key={`${isBase ? 'base' : 'target'}-${svg.filename}`}
        filename={svg.filename}
        content={svg.content}
        isBase={isBase}
        filterStyle={filterStyle}
        opacityStyle={elementOpacity}
        mixBlendMode={blendMode}
      />
    );
  };

  const currentZoomPercent = Math.round(transform.scale * 100);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '450px',
        overflow: 'hidden',
        background: '#0d0f18',
        borderRadius: '8px',
        border: '1px solid #232738',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ─── Top Control Toolbar ────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          background: '#0e1017',
          borderBottom: '1px solid #1e2230',
          zIndex: 20,
          flexShrink: 0,
          userSelect: 'none'
        }}
      >
        {/* Mode Indicator & Hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isSlider ? '#fadb14' : '#10b981',
              boxShadow: isSlider ? '0 0 6px #fadb14' : '0 0 6px #10b981'
            }}
          />
          <Text style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 500 }}>
            {isSlider ? 'Overlay Slider Diff' : 'Color Delta Map'}
          </Text>
          <Text style={{ color: '#64748b', fontSize: '11px', marginLeft: '6px' }}>
            {isSlider
              ? '· Drag canvas to pan · Scroll to zoom · Drag yellow line to wipe'
              : '· Red = Base | Green = Target · Drag to pan · Scroll to zoom'}
          </Text>
        </div>

        {/* Quick Zoom & Reset Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={zoomOut}
            title="Zoom Out (Scroll Down)"
            style={{
              background: '#1e2230',
              border: '1px solid #333a4d',
              color: '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background 0.15s'
            }}
          >
            <ZoomOutOutlined />
          </button>

          <button
            onClick={resetView}
            title="Click to reset to 100%"
            style={{
              background: '#1e2230',
              border: '1px solid #333a4d',
              color: '#fadb14',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              fontFamily: 'monospace',
              cursor: 'pointer',
              minWidth: '50px',
              textAlign: 'center'
            }}
          >
            {currentZoomPercent}%
          </button>

          <button
            onClick={zoomIn}
            title="Zoom In (Scroll Up)"
            style={{
              background: '#1e2230',
              border: '1px solid #333a4d',
              color: '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'background 0.15s'
            }}
          >
            <ZoomInOutlined />
          </button>

          <button
            onClick={resetView}
            title="Reset to Center (Double-click canvas)"
            style={{
              background: '#1e2230',
              border: '1px solid #333a4d',
              color: '#cbd5e1',
              borderRadius: '4px',
              padding: '3px 10px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginLeft: '4px',
              transition: 'background 0.15s'
            }}
          >
            <UndoOutlined /> Reset
          </button>
        </div>
      </div>

      {/* ─── Interactive Viewport ────────────────────────────────────────── */}
      <div
        ref={outerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none'
        }}
      >
        {/* Transformed Content Wrapper (Direct GPU Transform) */}
        <div
          ref={contentRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            transformOrigin: '0 0',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {/* Base Layer */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              {activeBaseSvgs.map((svg) => renderSvgElement(svg, true))}
            </div>
          </div>

          {/* Target Layer (Clipped by sliderValue in Overlay Slider mode) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              clipPath: isSlider ? `inset(0 0 0 ${sliderValue}%)` : 'none',
              pointerEvents: 'none',
              transform: 'translate3d(0px, 0px, 0px)',
              willChange: 'transform, clip-path',
              backfaceVisibility: 'hidden',
            }}
          >
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              {activeTargetSvgs.map((svg) => renderSvgElement(svg, false))}
            </div>
          </div>
        </div>

        {/* ─── Overlay Slider Vertical Guide Line & Handle ────────────────── */}
        {isSlider && (
          <div
            className="diff-slider-handle"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${sliderValue}%`,
              width: '14px',
              marginLeft: '-7px',
              cursor: 'ew-resize',
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Split line */}
            <div
              style={{
                width: '2px',
                height: '100%',
                backgroundColor: '#fadb14',
                boxShadow: '0 0 8px rgba(250, 219, 20, 0.9)',
                pointerEvents: 'none',
              }}
            />
            {/* Circular grab pill */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: '#161821',
                border: '2px solid #fadb14',
                boxShadow: '0 0 10px rgba(0,0,0,0.5), 0 0 8px rgba(250, 219, 20, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fadb14',
                fontSize: '11px',
                cursor: 'ew-resize',
                userSelect: 'none'
              }}
            >
              ↔
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default DiffCanvas;
