import { useState, useRef, useEffect, useCallback } from 'react';
import { applyTransformToDom } from './utils/diffLayerUtils.js';

export function computeWheelTransform(current, mouseX, mouseY, factor) {
  const newScale = Math.min(80, Math.max(0.02, current.scale * factor));
  const newX = mouseX - (mouseX - current.x) * (newScale / current.scale);
  const newY = mouseY - (mouseY - current.y) * (newScale / current.scale);
  return { scale: newScale, x: newX, y: newY };
}

export function computePanTransform(currentScale, origin, delta) {
  return {
    scale: currentScale,
    x: origin.x + delta.x,
    y: origin.y + delta.y
  };
}

export function computeCenteredZoom(current, cx, cy, newScale) {
  const newX = cx - (cx - current.x) * (newScale / current.scale);
  const newY = cy - (cy - current.y) * (newScale / current.scale);
  return { scale: newScale, x: newX, y: newY };
}

export function runTransformAnimation(options) {
  const { start, target, durationMs = 450, onUpdate, onComplete } = options;
  const startTime = performance.now();
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / durationMs);
    const e = easeInOut(t);
    const next = {
      scale: start.scale + (target.scale - start.scale) * e,
      x: start.x + (target.x - start.x) * e,
      y: start.y + (target.y - start.y) * e
    };
    onUpdate(next);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      onComplete(next);
    }
  };
  requestAnimationFrame(tick);
}

function handleSliderDrag(e, outerRef, onSliderChange) {
  const rect = outerRef.current?.getBoundingClientRect();
  if (!rect || !onSliderChange) return;
  const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  onSliderChange(Math.round(pct));
}

function useCanvasZoom({ outerRef, contentRef, transformRef, setTransform }) {
  const zoomToScale = useCallback((calcScale) => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    const newScale = calcScale(transformRef.current.scale);
    const nextVal = computeCenteredZoom(transformRef.current, rect.width / 2, rect.height / 2, newScale);
    transformRef.current = nextVal;
    applyTransformToDom(contentRef.current, nextVal);
    setTransform(nextVal);
  }, [outerRef, contentRef, transformRef, setTransform]);

  const zoomIn = useCallback(() => zoomToScale((s) => Math.min(80, s * 1.25)), [zoomToScale]);
  const zoomOut = useCallback(() => zoomToScale((s) => Math.max(0.02, s * 0.8)), [zoomToScale]);

  const resetView = useCallback(() => {
    const defaultVal = { scale: 1, x: 0, y: 0 };
    transformRef.current = defaultVal;
    applyTransformToDom(contentRef.current, defaultVal);
    setTransform(defaultVal);
  }, [contentRef, transformRef, setTransform]);

  const onDoubleClick = useCallback((e) => {
    if (e.target.closest('button')) return;
    resetView();
  }, [resetView]);

  return { zoomIn, zoomOut, resetView, onDoubleClick };
}

function useCanvasWheel({ outerRef, contentRef, transformRef, setTransform }) {
  const onWheel = useCallback((e) => {
    e.preventDefault();
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.14 : 0.88;
    const nextVal = computeWheelTransform(
      transformRef.current,
      e.clientX - rect.left,
      e.clientY - rect.top,
      factor
    );
    transformRef.current = nextVal;
    applyTransformToDom(contentRef.current, nextVal);
    setTransform(nextVal);
  }, [outerRef, contentRef, transformRef, setTransform]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel, outerRef]);
}

function handlePanMouseMove(e, dragRef, transformRef, contentRef) {
  const delta = { x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY };
  const origin = { x: dragRef.current.originX, y: dragRef.current.originY };
  const nextVal = computePanTransform(transformRef.current.scale, origin, delta);
  transformRef.current = nextVal;
  applyTransformToDom(contentRef.current, nextVal);
}

function resetDragState(dragRef, outerRef, transformRef, setTransform) {
  if (dragRef.current.active) {
    dragRef.current.active = false;
    if (outerRef.current) outerRef.current.style.cursor = 'grab';
    setTransform({ ...transformRef.current });
  }
  dragRef.current.isSlider = false;
}

function useCanvasDrag({ outerRef, contentRef, transformRef, setTransform, isSlider, onSliderChange }) {
  const dragRef = useRef({ active: false, isSlider: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || !outerRef.current) return;
    if (e.target.closest('.diff-slider-handle')) {
      dragRef.current = { active: false, isSlider: true, startX: e.clientX, startY: 0, originX: 0, originY: 0 };
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
    outerRef.current.style.cursor = 'grabbing';
  }, [outerRef, transformRef]);

  const onMouseMove = useCallback((e) => {
    if (dragRef.current.isSlider && isSlider) {
      handleSliderDrag(e, outerRef, onSliderChange);
      return;
    }
    if (dragRef.current.active) {
      handlePanMouseMove(e, dragRef, transformRef, contentRef);
    }
  }, [isSlider, onSliderChange, outerRef, contentRef, transformRef]);

  const onMouseUp = useCallback(() => {
    resetDragState(dragRef, outerRef, transformRef, setTransform);
  }, [outerRef, transformRef, setTransform]);

  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseUp]);

  return { onMouseDown, onMouseMove, onMouseUp };
}

export function useCanvasTransform({ outerRef, contentRef, isSlider, onSliderChange }) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const transformRef = useRef(transform);

  useEffect(() => {
    transformRef.current = transform;
    applyTransformToDom(contentRef.current, transform);
  }, [transform, contentRef]);

  const animateTo = useCallback((targetTransform, durationMs = 450) => {
    runTransformAnimation({
      start: transformRef.current,
      target: targetTransform,
      durationMs,
      onUpdate: (next) => {
        transformRef.current = next;
        applyTransformToDom(contentRef.current, next);
      },
      onComplete: (finalTransform) => setTransform(finalTransform)
    });
  }, [contentRef]);

  const { zoomIn, zoomOut, resetView, onDoubleClick } = useCanvasZoom({
    outerRef,
    contentRef,
    transformRef,
    setTransform
  });

  useCanvasWheel({ outerRef, contentRef, transformRef, setTransform });

  const { onMouseDown, onMouseMove, onMouseUp } = useCanvasDrag({
    outerRef,
    contentRef,
    transformRef,
    setTransform,
    isSlider,
    onSliderChange
  });

  return {
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
  };
}
