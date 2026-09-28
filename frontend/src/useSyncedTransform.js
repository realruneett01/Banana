import { useRef, useEffect, useCallback } from 'react';
import { applyTransformToDom } from './utils/diffLayerUtils.js';

export function computeFocusTarget(params, startTransform) {
  if (!params || !startTransform) return null;
  const { elRect, viewportRect, targetScale } = params;
  const elCX = (elRect.left + elRect.width / 2) - viewportRect.left;
  const elCY = (elRect.top + elRect.height / 2) - viewportRect.top;
  const contentX = (elCX - startTransform.x) / startTransform.scale;
  const contentY = (elCY - startTransform.y) / startTransform.scale;
  return {
    scale: targetScale,
    x: viewportRect.width / 2 - contentX * targetScale,
    y: viewportRect.height / 2 - contentY * targetScale
  };
}

export function interpolateTransform(start, target, progress) {
  if (!start || !target) return null;
  return {
    scale: start.scale + (target.scale - start.scale) * progress,
    x: start.x + (target.x - start.x) * progress,
    y: start.y + (target.y - start.y) * progress
  };
}

export function calcWheelZoomStep(state, mouseX, mouseY, factor) {
  const newScale = Math.min(80, Math.max(0.02, state.scale * factor));
  const newX = mouseX - (mouseX - state.x) * (newScale / state.scale);
  const newY = mouseY - (mouseY - state.y) * (newScale / state.scale);
  return { scale: newScale, x: newX, y: newY };
}

function updateSideTransform(ref, domRef, setter, nextVal) {
  ref.current = nextVal;
  applyTransformToDom(domRef.current, nextVal);
  setter(nextVal);
}

function handleSyncedWheel(ctx) {
  const { e, outerRef, synced, baseRef, targetRef, leftRef, rightRef, setBase, setTarget } = ctx;
  const rect = outerRef.current.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const isLeft = mouseX < rect.width / 2;
  const factor = e.deltaY < 0 ? 1.12 : 0.90;

  if (synced) {
    const nextVal = calcWheelZoomStep(baseRef.current, mouseX, e.clientY - rect.top, factor);
    updateSideTransform(baseRef, leftRef, setBase, nextVal);
    updateSideTransform(targetRef, rightRef, setTarget, nextVal);
  } else if (isLeft) {
    const nextVal = calcWheelZoomStep(baseRef.current, mouseX, e.clientY - rect.top, factor);
    updateSideTransform(baseRef, leftRef, setBase, nextVal);
  } else {
    const nextVal = calcWheelZoomStep(targetRef.current, mouseX - rect.width / 2, e.clientY - rect.top, factor);
    updateSideTransform(targetRef, rightRef, setTarget, nextVal);
  }
}

function applyDragDelta(opts) {
  const { scale, origin, delta, ref, domRef } = opts;
  const updated = {
    scale,
    x: origin.x + delta.x,
    y: origin.y + delta.y
  };
  ref.current = updated;
  applyTransformToDom(domRef.current, updated);
}

function handleSyncedMouseMove(ctx) {
  const { delta, drag, synced, baseRef, targetRef, leftRef, rightRef } = ctx;
  const leftOrigin = { x: drag.originLeftX, y: drag.originLeftY };
  const rightOrigin = { x: drag.originRightX, y: drag.originRightY };

  if (synced) {
    applyDragDelta({ scale: baseRef.current.scale, origin: leftOrigin, delta, ref: baseRef, domRef: leftRef });
    applyDragDelta({ scale: baseRef.current.scale, origin: rightOrigin, delta, ref: targetRef, domRef: rightRef });
  } else if (drag.isLeft) {
    applyDragDelta({ scale: baseRef.current.scale, origin: leftOrigin, delta, ref: baseRef, domRef: leftRef });
  } else {
    applyDragDelta({ scale: targetRef.current.scale, origin: rightOrigin, delta, ref: targetRef, domRef: rightRef });
  }
}

function applyAnimStep(opts) {
  const { start, target, progress, ref, domRef } = opts;
  if (!start || !target) return;
  const next = interpolateTransform(start, target, progress);
  ref.current = next;
  applyTransformToDom(domRef.current, next);
}

function finalizeAnimation(leftOk, rightOk, setters, refs) {
  if (leftOk) setters.setBaseTransform(refs.baseTransformRef.current);
  if (rightOk) setters.setTargetTransform(refs.targetTransformRef.current);
}

function runDualViewportAnimation(params, refs, setters) {
  const { leftParams, rightParams, durationMs = 550 } = params;
  const { baseTransformRef, targetTransformRef, leftContentRef, rightContentRef } = refs;

  const startTime = performance.now();
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

  const leftStart = leftParams ? { ...baseTransformRef.current } : null;
  const rightStart = rightParams ? { ...targetTransformRef.current } : null;
  const leftTarget = computeFocusTarget(leftParams, leftStart);
  const rightTarget = computeFocusTarget(rightParams, rightStart);

  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / durationMs);
    const progress = easeInOut(t);

    applyAnimStep({ start: leftStart, target: leftTarget, progress, ref: baseTransformRef, domRef: leftContentRef });
    applyAnimStep({ start: rightStart, target: rightTarget, progress, ref: targetTransformRef, domRef: rightContentRef });

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      finalizeAnimation(Boolean(leftStart && leftTarget), Boolean(rightStart && rightTarget), setters, refs);
    }
  };
  requestAnimationFrame(tick);
}

function useSyncedDragHandlers({ dragRef, outerRef, synced, baseTransformRef, targetTransformRef, leftContentRef, rightContentRef, setBaseTransform, setTargetTransform }) {
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || !outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    const isLeft = (e.clientX - rect.left) < rect.width / 2;

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
  }, [outerRef, baseTransformRef, targetTransformRef, dragRef]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    const delta = { x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY };
    handleSyncedMouseMove({
      delta, drag: dragRef.current, synced, baseRef: baseTransformRef,
      targetRef: targetTransformRef, leftRef: leftContentRef, rightRef: rightContentRef
    });
  }, [synced, leftContentRef, rightContentRef, baseTransformRef, targetTransformRef, dragRef]);

  const onMouseUp = useCallback((e) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (e?.currentTarget) e.currentTarget.style.cursor = 'grab';
    if (outerRef.current) outerRef.current.style.cursor = 'grab';
    setBaseTransform({ ...baseTransformRef.current });
    setTargetTransform({ ...targetTransformRef.current });
  }, [setBaseTransform, setTargetTransform, outerRef, baseTransformRef, targetTransformRef, dragRef]);

  return { onMouseDown, onMouseMove, onMouseUp };
}

export function useSyncedTransform(options) {
  const {
    baseTransform,
    setBaseTransform,
    targetTransform,
    setTargetTransform,
    leftContentRef,
    rightContentRef,
    outerRef,
    synced
  } = options;

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
    handleSyncedWheel({
      e, outerRef, synced, baseRef: baseTransformRef, targetRef: targetTransformRef,
      leftRef: leftContentRef, rightRef: rightContentRef, setBase: setBaseTransform, setTarget: setTargetTransform
    });
  }, [outerRef, synced, setBaseTransform, setTargetTransform, leftContentRef, rightContentRef]);

  const { onMouseDown, onMouseMove, onMouseUp } = useSyncedDragHandlers({
    dragRef, outerRef, synced, baseTransformRef, targetTransformRef,
    leftContentRef, rightContentRef, setBaseTransform, setTargetTransform
  });

  const resetTransform = useCallback(() => {
    const defaultVal = { scale: 1, x: 0, y: 0 };
    setBaseTransform(defaultVal);
    setTargetTransform(defaultVal);
  }, [setBaseTransform, setTargetTransform]);

  const animateTo = useCallback((leftParams, rightParams, durationMs = 550) => {
    runDualViewportAnimation(
      { leftParams, rightParams, durationMs },
      { baseTransformRef, targetTransformRef, leftContentRef, rightContentRef },
      { setBaseTransform, setTargetTransform }
    );
  }, [leftContentRef, rightContentRef, setBaseTransform, setTargetTransform]);

  return {
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    resetTransform,
    animateTo,
    baseTransformRef,
    targetTransformRef
  };
}
