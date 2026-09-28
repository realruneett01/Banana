import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  isLayerActive,
  isLayerSolo,
  getLayerOpacity,
  getScreenCoordsFromSvg,
  findDiffDomRect
} from './utils/diffLayerUtils.js';
import { drawFocusRing } from './utils/focusRingUtils.js';
import { useCanvasTransform } from './useCanvasTransform.js';
import { CanvasTopToolbar, SliderSplitHandle } from './components/CanvasControls.jsx';

const RED_FILTER = 'invert(24%) sepia(93%) saturate(7355%) hue-rotate(356deg) brightness(94%) contrast(119%)';
const GREEN_FILTER = 'invert(57%) sepia(74%) saturate(2256%) hue-rotate(84deg) brightness(119%) contrast(118%)';
const DIMMED_FILTER = 'grayscale(1) opacity(0.12) contrast(0.5) brightness(0.6)';

const SvgLayer = React.memo(({ content, filterStyle, opacityStyle, mixBlendMode }) => {
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
}, (prev, next) => (
  prev.content === next.content &&
  prev.filterStyle === next.filterStyle &&
  prev.opacityStyle === next.opacityStyle &&
  prev.mixBlendMode === next.mixBlendMode
));

function resolveLayerVisuals({ filename, isBase, isSlider, soloLayer, layerOpacities }) {
  const isSolo = isLayerSolo(filename, soloLayer);
  const isDimmed = Boolean(soloLayer && !isSolo);
  const layerOp = getLayerOpacity(filename, layerOpacities);
  const filterStyle = isDimmed ? DIMMED_FILTER : (isSlider ? 'none' : (isBase ? RED_FILTER : GREEN_FILTER));
  const opacity = isDimmed ? 0.12 : layerOp;
  const mixBlend = (isSlider || isDimmed) ? 'normal' : 'difference';
  return { filterStyle, opacity, mixBlend };
}

function LayerStack({ svgs, isBase, isSlider, soloLayer, layerOpacities }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {svgs.map((svg) => {
        const visuals = resolveLayerVisuals({
          filename: svg.filename,
          isBase,
          isSlider,
          soloLayer,
          layerOpacities
        });
        return (
          <SvgLayer
            key={`${isBase ? 'base' : 'target'}-${svg.filename}`}
            content={svg.content}
            filterStyle={visuals.filterStyle}
            opacityStyle={visuals.opacity}
            mixBlendMode={visuals.mixBlend}
          />
        );
      })}
    </div>
  );
}

function resolveTargetRect(contentRef, options) {
  const { diffIdx, baseCoords, targetCoords, bbox } = options;
  const coords = targetCoords || baseCoords || (bbox ? { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 } : null);
  const root = contentRef.current;
  const elRect = (coords && getScreenCoordsFromSvg(root, coords)) || findDiffDomRect(root, diffIdx);
  const target = (diffIdx != null && root) ? root.querySelector(`[data-diff-idx="${diffIdx}"]`) : null;
  return { elRect, target, coords };
}

function useDiffCanvasApi(ref, apiOptions) {
  const { outerRef, contentRef, transformRef, animateTo, isSlider, onSliderChange } = apiOptions;

  useImperativeHandle(ref, () => ({
    focusElement(options) {
      if (!outerRef.current || !contentRef.current) return;
      const vpRect = outerRef.current.getBoundingClientRect();
      const targetScale = 2.4;
      const { elRect, target, coords } = resolveTargetRect(contentRef, options);

      if (elRect) {
        const elCX = (elRect.left + elRect.width / 2) - vpRect.left;
        const elCY = (elRect.top + elRect.height / 2) - vpRect.top;
        const current = transformRef.current;
        const contentX = (elCX - current.x) / current.scale;
        const contentY = (elCY - current.y) / current.scale;

        const nextTransform = {
          scale: targetScale,
          x: vpRect.width / 2 - contentX * targetScale,
          y: vpRect.height / 2 - contentY * targetScale
        };
        animateTo(nextTransform, 450);

        contentRef.current.querySelectorAll('[data-diff-selected="true"]').forEach((el) => {
          el.removeAttribute('data-diff-selected');
          el.classList.remove('diff-highlight-active');
        });
        if (target) {
          target.setAttribute('data-diff-selected', 'true');
          target.classList.add('diff-highlight-active');
        }

        if (isSlider && onSliderChange) {
          const split = options.diffType === 'add' ? 42 : (options.diffType === 'delete' ? 58 : 50);
          onSliderChange(split);
        }

        const ringClass = options.diffType === 'delete' ? 'diff-deleted' : (options.diffType === 'add' ? 'diff-added' : 'diff-changed');
        drawFocusRing(contentRef.current, target || elRect, ringClass, coords);
      }
    },

    setHoveredDiff(diffIdx) {
      if (!contentRef.current) return;
      contentRef.current.querySelectorAll('[data-diff-hovered="true"]').forEach((el) => {
        el.removeAttribute('data-diff-hovered');
      });
      if (diffIdx !== undefined && diffIdx !== null) {
        contentRef.current.querySelectorAll(`[data-diff-idx="${diffIdx}"]`).forEach((el) => {
          el.setAttribute('data-diff-hovered', 'true');
        });
      }
    },

    resetView() {
      animateTo({ scale: 1, x: 0, y: 0 }, 300);
    }
  }), [animateTo, contentRef, isSlider, onSliderChange, outerRef, transformRef]);
}

function useCanvasEscapeKey(activeAuditIdx, resetView, setActiveAuditIdx) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && activeAuditIdx !== null) {
        if (setActiveAuditIdx) setActiveAuditIdx(null);
        resetView();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeAuditIdx, resetView, setActiveAuditIdx]);
}

function useActiveDiffDomHighlight(contentRef, activeAuditIdx) {
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root.querySelectorAll('[data-diff-selected="true"]').forEach((el) => {
      el.removeAttribute('data-diff-selected');
      el.classList.remove('diff-highlight-active');
    });
    if (activeAuditIdx != null) {
      const el = root.querySelector(`[data-diff-idx="${activeAuditIdx}"]`);
      if (el) {
        el.setAttribute('data-diff-selected', 'true');
        el.classList.add('diff-highlight-active');
      }
    }
  }, [contentRef, activeAuditIdx]);
}

function DiffCanvasSurface({
  outerRef,
  contentRef,
  transform,
  mouseHandlers,
  activeBaseSvgs,
  activeTargetSvgs,
  isSlider,
  soloLayer,
  layerOpacities,
  sliderValue
}) {
  return (
    <div
      ref={outerRef}
      onMouseDown={mouseHandlers.onMouseDown}
      onMouseMove={mouseHandlers.onMouseMove}
      onMouseUp={mouseHandlers.onMouseUp}
      onDoubleClick={mouseHandlers.onDoubleClick}
      style={{
        position: 'relative', flex: 1, width: '100%', height: '100%',
        overflow: 'hidden', cursor: 'grab', userSelect: 'none', touchAction: 'none'
      }}
    >
      <div
        ref={contentRef}
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          transformOrigin: '0 0',
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
        }}
      >
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <LayerStack
            svgs={activeBaseSvgs}
            isBase={true}
            isSlider={isSlider}
            soloLayer={soloLayer}
            layerOpacities={layerOpacities}
          />
        </div>

        <div
          style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            clipPath: isSlider ? `inset(0 0 0 ${sliderValue}%)` : 'none',
            pointerEvents: 'none', transform: 'translate3d(0px, 0px, 0px)',
            willChange: 'transform, clip-path', backfaceVisibility: 'hidden'
          }}
        >
          <LayerStack
            svgs={activeTargetSvgs}
            isBase={false}
            isSlider={isSlider}
            soloLayer={soloLayer}
            layerOpacities={layerOpacities}
          />
        </div>
      </div>

      {isSlider && <SliderSplitHandle sliderValue={sliderValue} />}
    </div>
  );
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
  activeAuditIdx,
  setActiveAuditIdx
}, ref) {
  const outerRef = useRef(null);
  const contentRef = useRef(null);
  const isSlider = diffMode === 'Overlay Slider';

  const {
    transform,
    transformRef,
    animateTo,
    zoomIn,
    zoomOut,
    resetView,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick
  } = useCanvasTransform({ outerRef, contentRef, isSlider, onSliderChange });

  useDiffCanvasApi(ref, {
    outerRef,
    contentRef,
    transformRef,
    animateTo,
    isSlider,
    onSliderChange,
    setActiveAuditIdx
  });

  useActiveDiffDomHighlight(contentRef, activeAuditIdx);
  useCanvasEscapeKey(activeAuditIdx, resetView, setActiveAuditIdx);

  const activeBaseSvgs = (baseSvgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));
  const activeTargetSvgs = (targetSvgs || []).filter((svg) => isLayerActive(svg.filename, activeLayers));

  return (
    <div
      style={{
        position: 'relative', width: '100%', height: '100%', minHeight: '450px',
        overflow: 'hidden', background: '#0d0f18', borderRadius: '8px',
        border: '1px solid #232738', display: 'flex', flexDirection: 'column'
      }}
    >
      <CanvasTopToolbar
        isSlider={isSlider}
        currentZoomPercent={Math.round(transform.scale * 100)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={resetView}
      />

      <DiffCanvasSurface
        outerRef={outerRef}
        contentRef={contentRef}
        transform={transform}
        mouseHandlers={{ onMouseDown, onMouseMove, onMouseUp, onDoubleClick }}
        activeBaseSvgs={activeBaseSvgs}
        activeTargetSvgs={activeTargetSvgs}
        isSlider={isSlider}
        soloLayer={soloLayer}
        layerOpacities={layerOpacities}
        sliderValue={sliderValue}
      />
    </div>
  );
});

export default DiffCanvas;
