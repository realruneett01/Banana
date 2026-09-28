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
export const DEFAULT_LAYER_ORDER = Object.freeze([
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
]);

function normalizeSingleLayer(l, idx, stripDrawingSheet, globalBlendMode) {
  const norm = sanitizeAndNormalizeKiCadSvg(l.content || '', {
    stripDrawingSheet,
    sheetPaddingMm: 4.0
  });
  return {
    id: l.id ?? l.filename ?? `layer-${idx}`,
    name: l.name ?? l.filename ?? `Layer ${idx + 1}`,
    filename: l.filename ?? '',
    content: norm.sanitizedSvg,
    viewBox: norm.viewBox,
    isNormalized: norm.isNormalized,
    opacity: l.opacity ?? 1.0,
    visible: l.visible ?? true,
    blendMode: l.blendMode ?? globalBlendMode
  };
}

function createMainSvgLayer(svgContent, stripDrawingSheet) {
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

function normalizeKiCadLayers(layers, svgContent, stripDrawingSheet, globalBlendMode) {
  if (layers?.length) {
    return layers.map((l, idx) => normalizeSingleLayer(l, idx, stripDrawingSheet, globalBlendMode));
  }
  if (svgContent) {
    return createMainSvgLayer(svgContent, stripDrawingSheet);
  }
  return [];
}

function stepZoomAtCenter(containerRef, transformRef, updateTransform, zoomFactor) {
  if (!containerRef.current) return;
  const rect = containerRef.current.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const nextScale = Math.min(100.0, Math.max(0.05, transformRef.current.scale * zoomFactor));
  const nextX = cx - (cx - transformRef.current.x) * (nextScale / transformRef.current.scale);
  const nextY = cy - (cy - transformRef.current.y) * (nextScale / transformRef.current.scale);
  updateTransform({ scale: nextScale, x: nextX, y: nextY });
}

function useWheelZoom(containerRef, transformRef, updateTransform) {
  return useCallback((e) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;
    const current = transformRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.min(100.0, Math.max(0.05, current.scale * zoomFactor));
    if (newScale === current.scale) return;
    const newX = mouseX - (mouseX - current.x) * (newScale / current.scale);
    const newY = mouseY - (mouseY - current.y) * (newScale / current.scale);
    updateTransform({ scale: newScale, x: newX, y: newY });
  }, [containerRef, transformRef, updateTransform]);
}

function useMousePan({ containerRef, transformRef, applyTransform, setIsPanning, setTransform, setTelemetry, onCoordinateHover }) {
  const dragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0 && e.button !== 1) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y
    };
    setIsPanning(true);
  }, [setIsPanning, transformRef]);

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = dragRef.current.originX + dx;
      const newY = dragRef.current.originY + dy;
      transformRef.current = { ...transformRef.current, x: newX, y: newY };
      applyTransform(transformRef.current);
    }
    const coords = screenToSvgCoords(e.clientX, e.clientY, containerRect, transformRef.current);
    setTelemetry({
      mmX: coords.mmX,
      mmY: coords.mmY,
      milsX: coords.milsX,
      milsY: coords.milsY,
      zoomPercent: Math.round(transformRef.current.scale * 100)
    });
    if (onCoordinateHover) onCoordinateHover(coords);
  }, [applyTransform, containerRef, onCoordinateHover, setTelemetry, transformRef]);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current.active) {
      dragRef.current.active = false;
      setIsPanning(false);
      setTransform(transformRef.current);
    }
  }, [setIsPanning, setTransform, transformRef]);

  return { handleMouseDown, handleMouseMove, handleMouseUp };
}

function useMouseGestures(params) {
  const handleWheel = useWheelZoom(params.containerRef, params.transformRef, params.updateTransform);
  const pan = useMousePan(params);
  return { handleWheel, ...pan };
}

function useTouchGestures({ containerRef, transformRef, applyTransform, isPanning, setIsPanning, setTransform }) {
  const touchRef = useRef({ startDistance: 0, startScale: 1, startX: 0, startY: 0, originX: 0, originY: 0 });

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      touchRef.current = {
        ...touchRef.current,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y
      };
      setIsPanning(true);
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current.startDistance = Math.hypot(dx, dy);
      touchRef.current.startScale = transformRef.current.scale;
      touchRef.current.originX = transformRef.current.x;
      touchRef.current.originY = transformRef.current.y;
    }
  }, [setIsPanning, transformRef]);

  const handleTouchMove = useCallback((e) => {
    if (!containerRef.current) return;
    if (e.touches.length === 1 && isPanning) {
      const dx = e.touches[0].clientX - touchRef.current.startX;
      const dy = e.touches[0].clientY - touchRef.current.startY;
      transformRef.current = { ...transformRef.current, x: touchRef.current.originX + dx, y: touchRef.current.originY + dy };
      applyTransform(transformRef.current);
    } else if (e.touches.length === 2 && touchRef.current.startDistance > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const factor = Math.hypot(dx, dy) / touchRef.current.startDistance;
      const newScale = Math.min(100.0, Math.max(0.05, touchRef.current.startScale * factor));
      const containerRect = containerRef.current.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - containerRect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - containerRect.top;
      const current = transformRef.current;
      transformRef.current = {
        scale: newScale,
        x: midX - (midX - current.x) * (newScale / current.scale),
        y: midY - (midY - current.y) * (newScale / current.scale)
      };
      applyTransform(transformRef.current);
    }
  }, [applyTransform, containerRef, isPanning, transformRef]);

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
    setTransform(transformRef.current);
  }, [setIsPanning, setTransform, transformRef]);

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}

function useViewportGestures(params) {
  const mouse = useMouseGestures(params);
  const touch = useTouchGestures(params);
  return { ...mouse, ...touch };
}

function TopHudControls({
  containerRef,
  transformRef,
  updateTransform,
  telemetry,
  zoomToFit,
  stripDrawingSheet,
  setStripDrawingSheet,
  layerCount,
  showLayerDrawer,
  setShowLayerDrawer
}) {
  return (
    <div className="kicad-viewport-hud-top">
      <button
        className="kicad-viewport-btn"
        onClick={() => stepZoomAtCenter(containerRef, transformRef, updateTransform, 1.25)}
        title="Zoom In"
      >
        ＋
      </button>

      <button
        className="kicad-viewport-btn"
        onClick={() => stepZoomAtCenter(containerRef, transformRef, updateTransform, 1 / 1.25)}
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

      {layerCount > 1 && (
        <>
          <div className="kicad-viewport-divider" />
          <button
            className={`kicad-viewport-btn ${showLayerDrawer ? 'is-active' : ''}`}
            onClick={() => setShowLayerDrawer(!showLayerDrawer)}
            title="Inspect Stacked Layers & Blending"
          >
            🥞 Layers ({layerCount})
          </button>
        </>
      )}
    </div>
  );
}

function LayersCompositingPanel({
  normalizedLayers,
  globalBlendMode,
  setGlobalBlendMode,
  layerStates,
  setLayerStates,
  onClose
}) {
  return (
    <div className="kicad-viewport-layers-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Stack Compositing
        </span>
        <button
          onClick={onClose}
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
  );
}

function ViewportStage({ stageRef, normalizedLayers, layerStates, globalBlendMode }) {
  return (
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
  );
}

function TelemetryHud({ telemetry }) {
  return (
    <div className="kicad-viewport-telemetry">
      <span>X: <span className="val">{telemetry.mmX.toFixed(2)} mm</span> ({Math.round(telemetry.milsX)} mils)</span>
      <span style={{ opacity: 0.4 }}>|</span>
      <span>Y: <span className="val">{telemetry.mmY.toFixed(2)} mm</span> ({Math.round(telemetry.milsY)} mils)</span>
      <span style={{ opacity: 0.4 }}>|</span>
      <span>Zoom: <span className="val">{telemetry.zoomPercent}%</span></span>
    </div>
  );
}

function useKiCadMasterViewBox(normalizedLayers) {
  return useMemo(() => {
    if (!normalizedLayers.length) return { minX: 0, minY: 0, width: 297, height: 210 };
    const firstValid = normalizedLayers.find(l => l.viewBox && l.viewBox.width > 0);
    return firstValid?.viewBox || { minX: 0, minY: 0, width: 297, height: 210 };
  }, [normalizedLayers]);
}

function useLayerStatesManager(normalizedLayers) {
  const [layerStates, setLayerStates] = useState({});

  useEffect(() => {
    setLayerStates((prev) => {
      const next = { ...prev };
      normalizedLayers.forEach(l => {
        if (next[l.id] === undefined) next[l.id] = { visible: l.visible, opacity: l.opacity };
      });
      return next;
    });
  }, [normalizedLayers]);

  return { layerStates, setLayerStates };
}

function useViewportTransforms({
  containerRef,
  stageRef,
  transformRef,
  setTransform,
  setTelemetry,
  masterViewBox,
  paddingRatio
}) {
  const applyTransform = useCallback((t) => {
    if (stageRef.current) {
      stageRef.current.style.transform = `translate3d(${t.x.toFixed(3)}px, ${t.y.toFixed(3)}px, 0px) scale(${t.scale.toFixed(5)})`;
    }
  }, [stageRef]);

  const updateTransform = useCallback((newTransform) => {
    transformRef.current = newTransform;
    setTransform(newTransform);
    applyTransform(newTransform);
    setTelemetry(prev => ({ ...prev, zoomPercent: Math.round(newTransform.scale * 100) }));
  }, [applyTransform, setTelemetry, setTransform, transformRef]);

  const zoomToFit = useCallback(() => {
    if (!containerRef.current) return;
    const containerDims = { width: containerRef.current.clientWidth, height: containerRef.current.clientHeight };
    if (containerDims.width <= 0 || containerDims.height <= 0) return;
    const fit = calculateZoomToFit(containerDims, masterViewBox, paddingRatio);
    updateTransform(fit);
  }, [containerRef, masterViewBox, paddingRatio, updateTransform]);

  useEffect(() => {
    const timer = setTimeout(() => zoomToFit(), 50);
    return () => clearTimeout(timer);
  }, [zoomToFit]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (transformRef.current.scale <= 0) zoomToFit();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef, transformRef, zoomToFit]);

  return { applyTransform, updateTransform, zoomToFit };
}

function useViewportImperativeApi(ref, { containerRef, transformRef, updateTransform, zoomToFit }) {
  useImperativeHandle(ref, () => ({
    zoomToFit,
    zoomIn: () => stepZoomAtCenter(containerRef, transformRef, updateTransform, 1.25),
    zoomOut: () => stepZoomAtCenter(containerRef, transformRef, updateTransform, 1 / 1.25),
    reset: zoomToFit,
    setTransform: updateTransform,
    getTransform: () => ({ ...transformRef.current }),
    focusCoordinate: (svgX, svgY, targetScale = 5.0) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      updateTransform({ scale: targetScale, x: cx - svgX * targetScale, y: cy - svgY * targetScale });
    },
    screenToSvg: (x, y) => {
      if (!containerRef.current) return { svgX: 0, svgY: 0, mmX: 0, mmY: 0, milsX: 0, milsY: 0 };
      return screenToSvgCoords(x, y, containerRef.current.getBoundingClientRect(), transformRef.current);
    },
    svgToScreen: (x, y) => svgToScreenCoords(x, y, transformRef.current)
  }), [containerRef, transformRef, updateTransform, zoomToFit]);
}

function useKiCadViewportController(props, ref) {
  const {
    svgContent,
    layers = [],
    stripDrawingSheetDefault = true,
    initialBlendMode = 'screen',
    paddingRatio = 0.05,
    onCoordinateHover
  } = props;

  const containerRef = useRef(null);
  const stageRef = useRef(null);

  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const [stripDrawingSheet, setStripDrawingSheet] = useState(stripDrawingSheetDefault);
  const [globalBlendMode, setGlobalBlendMode] = useState(initialBlendMode);
  const [showLayerDrawer, setShowLayerDrawer] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [telemetry, setTelemetry] = useState({ mmX: 0, mmY: 0, milsX: 0, milsY: 0, zoomPercent: 100 });

  const normalizedLayers = useMemo(
    () => normalizeKiCadLayers(layers, svgContent, stripDrawingSheet, globalBlendMode),
    [svgContent, layers, stripDrawingSheet, globalBlendMode]
  );

  const { layerStates, setLayerStates } = useLayerStatesManager(normalizedLayers);
  const masterViewBox = useKiCadMasterViewBox(normalizedLayers);

  const { applyTransform, updateTransform, zoomToFit } = useViewportTransforms({
    containerRef, stageRef, transformRef, setTransform, setTelemetry, masterViewBox, paddingRatio
  });

  const gestures = useViewportGestures({
    containerRef, transformRef, updateTransform, applyTransform,
    isPanning, setIsPanning, setTransform, setTelemetry, onCoordinateHover
  });

  useViewportImperativeApi(ref, { containerRef, transformRef, updateTransform, zoomToFit });

  return {
    containerRef, stageRef, isPanning, stripDrawingSheet, setStripDrawingSheet,
    globalBlendMode, setGlobalBlendMode, showLayerDrawer, setShowLayerDrawer,
    telemetry, layerStates, setLayerStates, normalizedLayers, updateTransform,
    zoomToFit, transformRef, gestures
  };
}

const KiCadViewport = forwardRef(function KiCadViewport(props, ref) {
  const ctrl = useKiCadViewportController(props, ref);
  const { className = '', style = {} } = props;

  return (
    <div
      ref={ctrl.containerRef}
      className={`kicad-viewport-root ${ctrl.isPanning ? 'is-panning' : ''} ${className}`}
      style={style}
      onWheel={ctrl.gestures.handleWheel}
      onMouseDown={ctrl.gestures.handleMouseDown}
      onMouseMove={ctrl.gestures.handleMouseMove}
      onMouseUp={ctrl.gestures.handleMouseUp}
      onTouchStart={ctrl.gestures.handleTouchStart}
      onTouchMove={ctrl.gestures.handleTouchMove}
      onTouchEnd={ctrl.gestures.handleTouchEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TopHudControls
        containerRef={ctrl.containerRef}
        transformRef={ctrl.transformRef}
        updateTransform={ctrl.updateTransform}
        telemetry={ctrl.telemetry}
        zoomToFit={ctrl.zoomToFit}
        stripDrawingSheet={ctrl.stripDrawingSheet}
        setStripDrawingSheet={ctrl.setStripDrawingSheet}
        layerCount={ctrl.normalizedLayers.length}
        showLayerDrawer={ctrl.showLayerDrawer}
        setShowLayerDrawer={ctrl.setShowLayerDrawer}
      />

      {ctrl.showLayerDrawer && ctrl.normalizedLayers.length > 1 && (
        <LayersCompositingPanel
          normalizedLayers={ctrl.normalizedLayers}
          globalBlendMode={ctrl.globalBlendMode}
          setGlobalBlendMode={ctrl.setGlobalBlendMode}
          layerStates={ctrl.layerStates}
          setLayerStates={ctrl.setLayerStates}
          onClose={() => ctrl.setShowLayerDrawer(false)}
        />
      )}

      <ViewportStage
        stageRef={ctrl.stageRef}
        normalizedLayers={ctrl.normalizedLayers}
        layerStates={ctrl.layerStates}
        globalBlendMode={ctrl.globalBlendMode}
      />

      <TelemetryHud telemetry={ctrl.telemetry} />
    </div>
  );
});

export default KiCadViewport;
