import { useCallback } from 'react';
import { getCleanLayerName } from './utils/auditLogUtils.js';

function resolveDiffItemLayer(item) {
  const raw = item.layer || item.time;
  const clean = getCleanLayerName(raw);
  return (clean && clean !== 'Unknown') ? clean : raw;
}

function resolveDiffItemType(item) {
  const rawAction = (item.action ? item.action.toLowerCase() : (item.type || item.diffType || item.rawType || '')) || 'changed';
  if (rawAction.startsWith('add')) return 'add';
  if (rawAction.startsWith('del')) return 'delete';
  return 'change';
}

function buildFocusPayload(item, layer, diffType, targetIdx = null) {
  return {
    diffIdx: item.diffIdx !== undefined ? item.diffIdx : targetIdx,
    side: item.side ?? (diffType === 'delete' ? 'base' : 'target'),
    diffType,
    baseCoords: item.baseCoords,
    targetCoords: item.targetCoords,
    bbox: item.bbox,
    layer,
  };
}

function dispatchCanvasAction(diffMode, sideBySideRef, diffCanvasRef, actionName, arg) {
  const target = diffMode === 'Side by Side' ? sideBySideRef.current : diffCanvasRef.current;
  target?.[actionName]?.(arg);
}

export function useDiffFocus({
  diffMode,
  sideBySideRef,
  diffCanvasRef,
  activeAuditIdx,
  setActiveAuditIdx,
  selectedLayers,
  setSelectedLayers
}) {
  const resetFocusView = useCallback(() => {
    setActiveAuditIdx(null);
    dispatchCanvasAction(diffMode, sideBySideRef, diffCanvasRef, 'resetView');
  }, [diffMode, diffCanvasRef, setActiveAuditIdx, sideBySideRef]);

  const setHoveredDiff = useCallback((diffIdx) => {
    dispatchCanvasAction(diffMode, sideBySideRef, diffCanvasRef, 'setHoveredDiff', diffIdx);
  }, [diffMode, diffCanvasRef, sideBySideRef]);

  const selectDiffItem = useCallback((item, customIdx = null) => {
    if (!item) return;
    const targetIdx = customIdx !== null ? customIdx : item.diffIdx;

    if (activeAuditIdx === targetIdx) {
      resetFocusView();
      return;
    }
    setActiveAuditIdx(targetIdx);

    const layerToEnsure = resolveDiffItemLayer(item);
    const layerWasMissing = Boolean(layerToEnsure && !selectedLayers.includes(layerToEnsure));
    if (layerWasMissing) {
      setSelectedLayers((prev) => [...prev, layerToEnsure]);
    }

    const diffType = resolveDiffItemType(item);
    const focusPayload = buildFocusPayload(item, layerToEnsure, diffType, targetIdx);

    const trigger = () => dispatchCanvasAction(diffMode, sideBySideRef, diffCanvasRef, 'focusElement', focusPayload);
    trigger();
    if (layerWasMissing) {
      setTimeout(trigger, 60);
    }
  }, [activeAuditIdx, diffMode, diffCanvasRef, resetFocusView, selectedLayers, setActiveAuditIdx, setSelectedLayers, sideBySideRef]);

  return {
    resetFocusView,
    setHoveredDiff,
    selectDiffItem,
  };
}
