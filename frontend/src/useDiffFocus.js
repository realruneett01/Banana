import { useCallback } from "react";
import { getCleanLayerName } from "./utils/auditLogUtils.js";

function resolveDiffItemLayer(item) {
	const raw = item.layer || item.time;
	const clean = getCleanLayerName(raw);
	return clean && clean !== "Unknown" ? clean : raw;
}

function resolveDiffItemType(item) {
	const action = item.action?.toLowerCase();
	const typeCandidates = [item.type, item.diffType, item.rawType];
	const rawAction = action || typeCandidates.find(Boolean) || "changed";
	if (rawAction.startsWith("add")) return "add";
	if (rawAction.startsWith("del")) return "delete";
	return "change";
}

function buildFocusPayload(item, layer, diffType, targetIdx = null) {
	return {
		diffIdx: item.diffIdx !== undefined ? item.diffIdx : targetIdx,
		side: item.side ?? (diffType === "delete" ? "base" : "target"),
		diffType,
		baseCoords: item.baseCoords,
		targetCoords: item.targetCoords,
		bbox: item.bbox,
		layer,
	};
}

function dispatchCanvasAction(canvasContext, actionName, arg) {
	const { diffMode, sideBySideRef, diffCanvasRef } = canvasContext;
	const target =
		diffMode === "Side by Side" ? sideBySideRef.current : diffCanvasRef.current;
	target?.[actionName]?.(arg);
}

function ensureDiffLayer(item, selectedLayers, setSelectedLayers) {
	const layerToEnsure = resolveDiffItemLayer(item);
	const layerWasMissing = Boolean(
		layerToEnsure && !selectedLayers.includes(layerToEnsure),
	);
	if (layerWasMissing) {
		setSelectedLayers((prev) => [...prev, layerToEnsure]);
	}
	return { layerToEnsure, layerWasMissing };
}

function scheduleFocusTriggers(trigger, layerWasMissing) {
	trigger();
	if (layerWasMissing) {
		setTimeout(trigger, 60);
		setTimeout(trigger, 200);
		return;
	}
	// Retry once even without layer change — DOM may need a frame to settle
	setTimeout(trigger, 50);
}

function executeFocus(item, targetIdx, options) {
	const { selectedLayers, setSelectedLayers } = options;
	const { layerToEnsure, layerWasMissing } = ensureDiffLayer(
		item,
		selectedLayers,
		setSelectedLayers,
	);
	const focusPayload = buildFocusPayload(
		item,
		layerToEnsure,
		resolveDiffItemType(item),
		targetIdx,
	);
	const trigger = () =>
		dispatchCanvasAction(options, "focusElement", focusPayload);
	scheduleFocusTriggers(trigger, layerWasMissing);
}

function handleDiffSelect(item, customIdx, options) {
	if (!item) return;
	const targetIdx = customIdx !== null ? customIdx : item.diffIdx;
	if (options.activeAuditIdx === targetIdx) {
		options.resetFocusView();
		return;
	}
	options.setActiveAuditIdx(targetIdx);
	executeFocus(item, targetIdx, options);
}

function useCanvasFocus({
	diffMode,
	sideBySideRef,
	diffCanvasRef,
	setActiveAuditIdx,
}) {
	const resetFocusView = useCallback(() => {
		setActiveAuditIdx(null);
		dispatchCanvasAction(
			{ diffMode, sideBySideRef, diffCanvasRef },
			"resetView",
		);
	}, [diffMode, diffCanvasRef, setActiveAuditIdx, sideBySideRef]);

	const setHoveredDiff = useCallback(
		(diffIdx) => {
			dispatchCanvasAction(
				{ diffMode, sideBySideRef, diffCanvasRef },
				"setHoveredDiff",
				diffIdx,
			);
		},
		[diffMode, diffCanvasRef, sideBySideRef],
	);

	return { resetFocusView, setHoveredDiff };
}

function useSelectDiffItem(ctx) {
	const { activeAuditIdx, setActiveAuditIdx, resetFocusView } = ctx;
	const { selectedLayers, setSelectedLayers } = ctx;
	const { diffMode, sideBySideRef, diffCanvasRef } = ctx;

	return useCallback(
		(item, customIdx = null) => {
			const canvas = { diffMode, sideBySideRef, diffCanvasRef };
			handleDiffSelect(item, customIdx, {
				activeAuditIdx,
				setActiveAuditIdx,
				resetFocusView,
				selectedLayers,
				setSelectedLayers,
				...canvas,
			});
		},
		[
			activeAuditIdx,
			diffCanvasRef,
			diffMode,
			resetFocusView,
			selectedLayers,
			setActiveAuditIdx,
			setSelectedLayers,
			sideBySideRef,
		],
	);
}

export function useDiffFocus({
	diffMode,
	sideBySideRef,
	diffCanvasRef,
	activeAuditIdx,
	setActiveAuditIdx,
	selectedLayers,
	setSelectedLayers,
}) {
	const canvasRefs = { diffMode, sideBySideRef, diffCanvasRef };
	const { resetFocusView, setHoveredDiff } = useCanvasFocus({
		...canvasRefs,
		setActiveAuditIdx,
	});
	const selectDiffItem = useSelectDiffItem({
		...canvasRefs,
		activeAuditIdx,
		setActiveAuditIdx,
		resetFocusView,
		selectedLayers,
		setSelectedLayers,
	});

	return {
		resetFocusView,
		setHoveredDiff,
		selectDiffItem,
	};
}
