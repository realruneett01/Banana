import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef
} from 'react';
import {
  sanitizeAndNormalizeKiCadSvg,
  calculateZoomToFit,
  screenToSvgCoords,
  svgToScreenCoords
} from '../utils/kicadSvgEngine';
import './KiCadViewport.css';

/**
 * Standard KiCad PCB layer stack order (bottom-to-top rendering)
 */
const DEFAULT_LAYER_ORDER = [
  'edge_cuts',
  'b_courtyard',
  'b_silks',
  'b_silkscreen',
  'b_mask',
  'b_cu',
  'in1_cu',
  'in2_cu',
  'in3_cu',
  'in4_cu',
  'f_cu',
  'f_mask',
  'f_silks',
  'f_silkscreen',
  'f_courtyard'
];

/**
 * KiCadViewport
 *
 * Senior Frontend Graphics & WebGL/SVG Engineering Viewport for KiCad PCB layouts and schematics.
 * Features:
 * - Responsive coordinate normalization and viewBox auto-correction.
 * - Hardware-accelerated infinite canvas with cursor-anchored zoom (10% to 10,000%).
 * - Multi-layer compositing with independent opacity and blend modes (mix-blend-mode: screen).
 * - Automatic drawing sheet / title-block filter to focus directly on board outline.
 * - Sub-millimeter and mil coordinate inspector HUD.
 */
const KiCadViewport = forwardRef(function KiCadViewport({
  svgContent,                     // Single raw SVG string or null
  layers = [],                    // Multi-layer array: [{ id, name, filename, content, opacity, visible, blendMode }]
  stripDrawingSheetDefault = true,// Default to filtering out drawing sheet to zoom to board outline
  initialBlendMode = 'screen',    // Default layer compositing blend mode
  paddingRatio = 0.05,            // Padding ratio for Zoom-to-Fit (5%)
  onCoordinateHover,              // Optional callback on mouse move: ({ mmX, mmY, milsX, milsY, svgX, svgY })
  className = '',
  style = {}
}, ref) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);

  // Transform state: { scale, x, y }
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Viewport toggles & HUD state
  const [stripDrawingSheet, setStripDrawingSheet] = useState(stripDrawingSheetDefault);
  const [globalBlendMode, setGlobalBlendMode] = useState(initialBlendMode);
  const [showLayerDrawer, setShowLayerDrawer] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Live telemetry HUD
  const [telemetry, setTelemetry] = useState({
    mmX: 0,
    mmY: 0,
    milsX: 0,
    milsY: 0,
    zoomPercent: 100
  });

  // Layer settings map (id -> { visible: boolean, opacity: number })
  const [layerStates, setLayerStates] = useState({});

  // 1. Normalize layers or single SVG
  const normalizedLayers = useMemo(() => {
    // If multiple layers provided, map them
    if (layers && layers.length > 0) {
      return layers.map((l, idx) => {
        const raw = l.content || '';
        const norm = sanitizeAndNormalizeKiCadSvg(raw, {
          stripDrawingSheet,
          sheetPaddingMm: 4.0
        });
        return {
          id: l.id || l.filename || `layer-${idx}`,
          name: l.name || l.filename || `Layer ${idx + 1}`,
          filename: l.filename || '',
          content: norm.sanitizedSvg,
          viewBox: norm.viewBox,
          isNormalized: norm.isNormalized,
          opacity: l.opacity !== undefined ? l.opacity : 1.0,
          visible: l.visible !== undefined ? l.visible : true,
          blendMode: l.blendMode || globalBlendMode
        };
      });
    }

    // Single SVG content provided
    if (svgContent) {
      const norm = sanitizeAndNormalizeKiCadSvg(svgContent, {
        stripDrawingSheet,
        sheetPaddingMm: 4.0
      });
      return [{
        id: 'main-svg',
        name: 'Main Vector Layer',
        filename: 'main.svg',
        content: norm.sanitizedSvg,
        viewBox: norm.viewBox,
        isNormalized: norm.isNormalized,
        opacity: 1.0,
        visible: true,
        blendMode: 'normal'
      }];
    }

    return [];
  }, [svgContent, layers, stripDrawingSheet, globalBlendMode]);

  // Combined master viewBox covering all active layers
  const masterViewBox = useMemo(() => {
    if (normalizedLayers.length === 0) {
      return { minX: 0, minY: 0, width: 297, height: 210 };
    }
    // Prioritize the first valid layer's viewBox (or board outline)
    const firstValid = normalizedLayers.find(l => l.viewBox && l.viewBox.width > 0);
    return firstValid ? firstValid.viewBox : { minX: 0, minY: 0, width: 297, height: 210 };
  }, [normalizedLayers]);

  // Synchronize layerStates with incoming layers
  useEffect(() => {
    setLayerStates((prev) => {
      const next = { ...prev };
      normalizedLayers.forEach(l => {
        if (next[l.id] === undefined) {
          next[l.id] = { visible: l.visible, opacity: l.opacity };
        }
      });
      return next;
    });
  }, [normalizedLayers]);

  // 2. Hardware-accelerated DOM transform application
  const applyTransform = useCallback((t) => {
    if (stageRef.current) {
      stageRef.current.style.transform = `translate3d(${t.x.toFixed(3)}px, ${t.y.toFixed(3)}px, 0px) scale(${t.scale.toFixed(5)})`;
    }
  }, []);

  // Update transform with state sync
  const updateTransform = useCallback((newTransform) => {
    transformRef.current = newTransform;
    setTransform(newTransform);
    applyTransform(newTransform);
    setTelemetry(prev => ({
      ...prev,
      zoomPercent: Math.round(newTransform.scale * 100)
    }));
  }, [applyTransform]);

  // 3. Zoom-to-Fit function
  const zoomToFit = useCallback(() => {
    if (!containerRef.current) return;
    const containerDims = {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    };
    if (containerDims.width <= 0 || containerDims.height <= 0) return;

    const fit = calculateZoomToFit(containerDims, masterViewBox, paddingRatio);
    updateTransform(fit);
  }, [masterViewBox, paddingRatio, updateTransform]);

  // Initial Auto-Fit on Mount or when Layer Data changes
  useEffect(() => {
    const timer = setTimeout(() => {
      zoomToFit();
    }, 50);
    return () => clearTimeout(timer);
  }, [masterViewBox, zoomToFit]);

  // Window resize observer to maintain relative view center
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      // Keep within reasonable bounds on resize
      if (transformRef.current.scale <= 0) {
        zoomToFit();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [zoomToFit]);

  // 4. Pointer-centered scroll-to-zoom (anchored zoom)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const current = transformRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const MIN_SCALE = 0.05;   // 5%
    const MAX_SCALE = 100.0;  // 10,000%

    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * zoomFactor));
    if (newScale === current.scale) return;

    // Center zoom strictly around mouse pointer position
    const newX = mouseX - (mouseX - current.x) * (newScale / current.scale);
    const newY = mouseY - (mouseY - current.y) * (newScale / current.scale);

    updateTransform({ scale: newScale, x: newX, y: newY });
  }, [updateTransform]);

  // 5. Drag Pan handlers
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  });

  const handleMouseDown = useCallback((e) => {
    // Pan with left click (button 0) or middle click (button 1)
    if (e.button !== 0 && e.button !== 1) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y
    };
    setIsPanning(true);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();

    // Pan tracking
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = dragRef.current.originX + dx;
      const newY = dragRef.current.originY + dy;

      transformRef.current = { ...transformRef.current, x: newX, y: newY };
      applyTransform(transformRef.current);
    }

    // Telemetry tracking: map screen pixels to board coordinates (mm and mils)
    const coords = screenToSvgCoords(e.clientX, e.clientY, containerRect, transformRef.current);
    setTelemetry({
      mmX: coords.mmX,
      mmY: coords.mmY,
      milsX: coords.milsX,
      milsY: coords.milsY,
      zoomPercent: Math.round(transformRef.current.scale * 100)
    });

    if (onCoordinateHover) {
      onCoordinateHover(coords);
    }
  }, [applyTransform, onCoordinateHover]);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current.active) {
      dragRef.current.active = false;
      setIsPanning(false);
      setTransform(transformRef.current);
    }
  }, []);

  // 6. Touch pinch-to-zoom & touch-drag pan support
  const touchRef = useRef({
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  });

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      // Single finger drag
      touchRef.current = {
        ...touchRef.current,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y
      };
      setIsPanning(true);
    } else if (e.touches.length === 2) {
      // Two finger pinch
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current.startDistance = Math.hypot(dx, dy);
      touchRef.current.startScale = transformRef.current.scale;
      touchRef.current.originX = transformRef.current.x;
      touchRef.current.originY = transformRef.current.y;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!containerRef.current) return;
    if (e.touches.length === 1 && isPanning) {
      const dx = e.touches[0].clientX - touchRef.current.startX;
      const dy = e.touches[0].clientY - touchRef.current.startY;
      const newX = touchRef.current.originX + dx;
      const newY = touchRef.current.originY + dy;
      transformRef.current = { ...transformRef.current, x: newX, y: newY };
      applyTransform(transformRef.current);
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      if (touchRef.current.startDistance > 0) {
        const factor = currentDist / touchRef.current.startDistance;
        const newScale = Math.min(100.0, Math.max(0.05, touchRef.current.startScale * factor));

        const containerRect = containerRef.current.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - containerRect.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - containerRect.top;

        const current = transformRef.current;
        const newX = midX - (midX - current.x) * (newScale / current.scale);
        const newY = midY - (midY - current.y) * (newScale / current.scale);

        transformRef.current = { scale: newScale, x: newX, y: newY };
        applyTransform(transformRef.current);
      }
    }
  }, [applyTransform, isPanning]);

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
    setTransform(transformRef.current);
  }, []);

  // 7. Imperative Ref API for parent controls
  useImperativeHandle(ref, () => ({
    zoomToFit,
    zoomIn: () => {
      const nextScale = Math.min(100.0, transformRef.current.scale * 1.25);
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const nextX = cx - (cx - transformRef.current.x) * (nextScale / transformRef.current.scale);
      const nextY = cy - (cy - transformRef.current.y) * (nextScale / transformRef.current.scale);
      updateTransform({ scale: nextScale, x: nextX, y: nextY });
    },
    zoomOut: () => {
      const nextScale = Math.max(0.05, transformRef.current.scale / 1.25);
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const nextX = cx - (cx - transformRef.current.x) * (nextScale / transformRef.current.scale);
      const nextY = cy - (cy - transformRef.current.y) * (nextScale / transformRef.current.scale);
      updateTransform({ scale: nextScale, x: nextX, y: nextY });
    },
    reset: () => {
      zoomToFit();
    },
    setTransform: (t) => {
      updateTransform(t);
    },
    getTransform: () => ({ ...transformRef.current }),
    focusCoordinate: (svgX, svgY, targetScale = 5.0) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newX = cx - svgX * targetScale;
      const newY = cy - svgY * targetScale;
      updateTransform({ scale: targetScale, x: newX, y: newY });
    },
    screenToSvg: (x, y) => {
      if (!containerRef.current) return { svgX: 0, svgY: 0, mmX: 0, mmY: 0, milsX: 0, milsY: 0 };
      return screenToSvgCoords(x, y, containerRef.current.getBoundingClientRect(), transformRef.current);
    },
    svgToScreen: (x, y) => {
      return svgToScreenCoords(x, y, transformRef.current);
    }
  }), [zoomToFit, updateTransform]);

  return (
    <div
      ref={containerRef}
      className={`kicad-viewport-root ${isPanning ? 'is-panning' : ''} ${className}`}
      style={style}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── Top Floating HUD Controls ────────────────────────────────────────── */}
      <div className="kicad-viewport-hud-top">
        <button
          className="kicad-viewport-btn"
          onClick={() => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const nextScale = Math.min(100.0, transformRef.current.scale * 1.25);
            const nextX = cx - (cx - transformRef.current.x) * (nextScale / transformRef.current.scale);
            const nextY = cy - (cy - transformRef.current.y) * (nextScale / transformRef.current.scale);
            updateTransform({ scale: nextScale, x: nextX, y: nextY });
          }}
          title="Zoom In"
        >
          ＋
        </button>

        <button
          className="kicad-viewport-btn"
          onClick={() => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const nextScale = Math.max(0.05, transformRef.current.scale / 1.25);
            const nextX = cx - (cx - transformRef.current.x) * (nextScale / transformRef.current.scale);
            const nextY = cy - (cy - transformRef.current.y) * (nextScale / transformRef.current.scale);
            updateTransform({ scale: nextScale, x: nextX, y: nextY });
          }}
          title="Zoom Out"
        >
          －
        </button>

        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8', minWidth: '45px', textAlign: 'center' }}>
          {telemetry.zoomPercent}%
        </span>

        <button
          className="kicad-viewport-btn"
          onClick={zoomToFit}
          title="Reset View and Zoom-to-Fit content boundary"
        >
          ⛶ Fit Board
        </button>

        <div className="kicad-viewport-divider" />

        <button
          className={`kicad-viewport-btn ${stripDrawingSheet ? 'is-active' : ''}`}
          onClick={() => setStripDrawingSheet(!stripDrawingSheet)}
          title="Toggle Drawing Sheet & Page Margins"
        >
          📐 {stripDrawingSheet ? 'Board Focus' : 'Full Sheet'}
        </button>

        {normalizedLayers.length > 1 && (
          <>
            <div className="kicad-viewport-divider" />
            <button
              className={`kicad-viewport-btn ${showLayerDrawer ? 'is-active' : ''}`}
              onClick={() => setShowLayerDrawer(!showLayerDrawer)}
              title="Inspect Stacked Layers & Blending"
            >
              🥞 Layers ({normalizedLayers.length})
            </button>
          </>
        )}
      </div>

      {/* ── Multi-Layer Stack Compositing Panel ─────────────────────────────── */}
      {showLayerDrawer && normalizedLayers.length > 1 && (
        <div className="kicad-viewport-layers-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Stack Compositing
            </span>
            <button
              onClick={() => setShowLayerDrawer(false)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
              Global Blend Mode:
            </label>
            <select
              value={globalBlendMode}
              onChange={(e) => setGlobalBlendMode(e.target.value)}
              style={{
                width: '100%',
                background: '#161823',
                border: '1px solid #2e334d',
                color: '#f8fafc',
                fontSize: '11px',
                padding: '4px 8px',
                borderRadius: '4px',
                outline: 'none'
              }}
            >
              <option value="screen">Screen (PCB Copper Standard)</option>
              <option value="normal">Normal (Opaque Stack)</option>
              <option value="lighten">Lighten</option>
              <option value="color-dodge">Color Dodge</option>
              <option value="difference">Difference</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {normalizedLayers.map((l) => {
              const state = layerStates[l.id] || { visible: true, opacity: 1.0 };
              return (
                <div key={l.id} className="kicad-viewport-layer-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={state.visible}
                      onChange={(e) => {
                        const nextVisible = e.target.checked;
                        setLayerStates(prev => ({
                          ...prev,
                          [l.id]: { ...prev[l.id], visible: nextVisible }
                        }));
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>
                      {l.name}
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={state.opacity}
                    onChange={(e) => {
                      const nextOp = parseFloat(e.target.value);
                      setLayerStates(prev => ({
                        ...prev,
                        [l.id]: { ...prev[l.id], opacity: nextOp }
                      }));
                    }}
                    style={{ width: '60px', accentColor: '#fadb14' }}
                    title={`Opacity: ${Math.round(state.opacity * 100)}%`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Hardware Accelerated Viewport Canvas Stage ─────────────────────── */}
      <div ref={stageRef} className="kicad-viewport-stage">
        {normalizedLayers.map((l) => {
          const state = layerStates[l.id] || { visible: true, opacity: 1.0 };
          if (!state.visible) return null;

          return (
            <div
              key={l.id}
              className="kicad-viewport-layer"
              style={{
                opacity: state.opacity,
                mixBlendMode: globalBlendMode,
              }}
              dangerouslySetInnerHTML={{ __html: l.content }}
            />
          );
        })}
      </div>

      {/* ── Bottom Telemetry & Coordinate Readout HUD ──────────────────────── */}
      <div className="kicad-viewport-telemetry">
        <span>X: <span className="val">{telemetry.mmX.toFixed(2)} mm</span> ({Math.round(telemetry.milsX)} mils)</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>Y: <span className="val">{telemetry.mmY.toFixed(2)} mm</span> ({Math.round(telemetry.milsY)} mils)</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>Zoom: <span className="val">{telemetry.zoomPercent}%</span></span>
      </div>
    </div>
  );
});

export default KiCadViewport;
