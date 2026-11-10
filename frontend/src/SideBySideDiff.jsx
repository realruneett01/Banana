import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { SideBySideToolbar } from "./components/SideBySideToolbar.jsx";
import { SvgPanel } from "./components/SvgPanel.jsx";
import PadLabelOverlay from "./PadLabelOverlay.jsx";
import { DIFF_CONFIG, DIFF_CSS, FOCUS_CSS } from "./sideBySideStyles.js";
import { useSyncedTransform } from "./useSyncedTransform.js";
import {
	applyTransformToDom,
	findDiffDomRect,
	getScreenCoordsFromSvg,
} from "./utils/diffLayerUtils.js";
import { drawFocusRing } from "./utils/focusRingUtils.js";

const SPLIT_DIVIDER_STYLE = {
	width: "3px",
	background:
		"linear-gradient(to bottom, #fadb14 0%, #faad14 50%, #fadb14 100%)",
	borderRadius: "2px",
	flexShrink: 0,
	opacity: 0.7,
};

const CONTAINER_BASE_STYLE = {
	display: "flex",
	flexDirection: "column",
	width: "100%",
	height: "100%",
	gap: 0,
};

const INITIAL_TRANSFORM = { scale: 1, x: 0, y: 0 };

function normalizeToRect(pointOrRect) {
	if (!pointOrRect) return null;
	const { left, width, x, y } = pointOrRect;
	// Already a DOMRect or rect-like object with left/width
	const hasBounds = left !== undefined && width !== undefined;
	if (hasBounds) return pointOrRect;
	// Point from getScreenCoordsFromSvg → synthesize a small rect so computeFocusTarget works
	const isPoint = typeof x === "number" && typeof y === "number";
	return isPoint ? { left: x, top: y, width: 0, height: 0 } : null;
}

function locateTargetRect(root, coords, diffIdx) {
	// Try coords first, then fall back to DOM lookup by diffIdx — always try both
	const screenPt = coords ? getScreenCoordsFromSvg(root, coords) : null;
	const fromCoords = screenPt ? normalizeToRect(screenPt) : null;
	return fromCoords || findDiffDomRect(root, diffIdx);
}

function resolveSideParams(contentRef, coords, diffIdx) {
	const root = contentRef?.current;
	const viewport = root?.parentElement;
	if (!root || !viewport) return null;

	const elRect = locateTargetRect(root, coords, diffIdx);
	if (!elRect) return null;

	return {
		elRect,
		viewportRect: viewport.getBoundingClientRect(),
		targetScale: 2.4,
	};
}

function computeBboxTransform(bbox, width, height) {
	const scale = 2.5;
	const cx = (bbox.x1 + bbox.x2) / 2;
	const cy = (bbox.y1 + bbox.y2) / 2;
	return {
		scale,
		x: width / 2 - cx * scale,
		y: height / 2 - cy * scale,
	};
}

function drawSideFocusRing(contentEl, params, ringClass, coords) {
	if (!params || !contentEl) return;
	drawFocusRing(contentEl, params.elRect, ringClass, coords);
}

function drawSideRings({
	leftEl,
	rightEl,
	leftParams,
	rightParams,
	diffType,
	baseCoords,
	targetCoords,
}) {
	const leftClass = diffType === "delete" ? "diff-deleted" : "diff-changed";
	const rightClass = diffType === "add" ? "diff-added" : "diff-changed";
	drawSideFocusRing(leftEl, leftParams, leftClass, baseCoords);
	drawSideFocusRing(rightEl, rightParams, rightClass, targetCoords);
}

function syncParams(leftParams, rightParams, synced) {
	if (!synced) return { left: leftParams, right: rightParams };
	if (leftParams && !rightParams) {
		return { left: leftParams, right: { ...leftParams } };
	}
	if (rightParams && !leftParams) {
		return { left: { ...rightParams }, right: rightParams };
	}
	return { left: leftParams, right: rightParams };
}

function applyHoveredDiff(root, diffIdx) {
	if (!root) return;
	for (const el of root.querySelectorAll('[data-diff-hovered="true"]')) {
		el.removeAttribute("data-diff-hovered");
	}
	if (diffIdx == null) return;
	for (const el of root.querySelectorAll(`[data-diff-idx="${diffIdx}"]`)) {
		el.setAttribute("data-diff-hovered", "true");
	}
}

function focusSideElement({
	options,
	leftRef,
	rightRef,
	synced,
	animateTo,
	focusBbox,
}) {
	const { diffIdx, diffType, baseCoords, targetCoords, bbox } = options || {};
	const leftParams = resolveSideParams(leftRef, baseCoords, diffIdx);
	const rightParams = resolveSideParams(rightRef, targetCoords, diffIdx);
	drawSideRings({
		leftEl: leftRef.current,
		rightEl: rightRef.current,
		leftParams,
		rightParams,
		diffType,
		baseCoords,
		targetCoords,
	});
	const { left, right } = syncParams(leftParams, rightParams, synced);
	if (left || right) {
		animateTo(left, right, 450);
		return;
	}
	focusBbox(bbox);
}

function applyBboxToDom(next, refs) {
	refs.baseTransformRef.current = next;
	refs.targetTransformRef.current = next;
	refs.setBaseTransform(next);
	refs.setTargetTransform(next);
	applyTransformToDom(refs.leftContentRef.current, next);
	applyTransformToDom(refs.rightContentRef.current, next);
}

function useBoundingBoxFocus(refs) {
	const { outerRef } = refs;
	const focusBox = useCallback(
		(bbox, w, h) => {
			if (!bbox) return;
			applyBboxToDom(computeBboxTransform(bbox, w, h), refs);
		},
		[refs],
	);

	return useCallback(
		(bbox) => {
			const el = outerRef.current;
			if (!bbox || !el) return;
			const rect = el.getBoundingClientRect();
			focusBox(bbox, rect.width / 2, rect.height);
		},
		[outerRef, focusBox],
	);
}

function buildImperativeHandle(apiConfig, focusBbox) {
	const {
		leftContentRef,
		rightContentRef,
		synced,
		animateTo,
		resetTransform,
		setActiveAuditIdx,
	} = apiConfig;
	return {
		focusElement: (options) =>
			focusSideElement({
				options,
				leftRef: leftContentRef,
				rightRef: rightContentRef,
				synced,
				animateTo,
				focusBbox,
			}),
		focusOnBoundingBox: focusBbox,
		setHoveredDiff: (idx) => {
			applyHoveredDiff(leftContentRef.current, idx);
			applyHoveredDiff(rightContentRef.current, idx);
		},
		resetView: () => {
			resetTransform();
			if (setActiveAuditIdx) setActiveAuditIdx(null);
		},
	};
}

function useSideBySideApi(ref, apiConfig) {
	const {
		leftContentRef,
		rightContentRef,
		synced,
		animateTo,
		resetTransform,
		setActiveAuditIdx,
	} = apiConfig;
	const focusBbox = useBoundingBoxFocus(apiConfig);
	// biome-ignore lint/correctness/useExhaustiveDependencies: apiConfig object changes every render; dependencies track its members
	useImperativeHandle(ref, () => buildImperativeHandle(apiConfig, focusBbox), [
		animateTo,
		focusBbox,
		leftContentRef,
		resetTransform,
		rightContentRef,
		setActiveAuditIdx,
		synced,
	]);
}

function FocusedDiffStyle({ activeAuditIdx }) {
	if (activeAuditIdx == null) return null;
	return (
		<style>{`
      .mode-side-by-side.has-focus svg [data-diff-idx="${activeAuditIdx}"],
      .mode-side-by-side.has-focus svg [data-diff-idx="${activeAuditIdx}"] * {
        filter: drop-shadow(0 0 3px rgba(250, 219, 20, 0.85)) !important;
      }
    `}</style>
	);
}

function SplitSvgPanel({ panelProps, sideConfig }) {
	const { activeLayers, soloLayer, layerOpacities } = panelProps;
	const { svgs, contentRef, side, commit, transform } = sideConfig;
	const fallback = side === "base" ? "Base" : "Target";
	const commitLabel = commit
		? `Commit: ${String(commit).substring(0, 10)}`
		: fallback;
	return (
		<SvgPanel
			svgs={svgs}
			activeLayers={activeLayers}
			soloLayer={soloLayer}
			layerOpacities={layerOpacities}
			contentRef={contentRef}
			side={side}
			commitLabel={commitLabel}
			transform={transform}
		/>
	);
}

function makeSideConfig(props, side) {
	const isBase = side === "base";
	return {
		side,
		svgs: isBase ? props.baseSvgs : props.targetSvgs,
		contentRef: isBase ? props.leftContentRef : props.rightContentRef,
		commit: isBase ? props.baseCommit : props.targetCommit,
		transform: isBase ? props.baseTransform : props.targetTransform,
	};
}

function SideBySideSplitView(props) {
	return (
		<div style={{ display: "flex", flex: 1, gap: "4px", minHeight: 0 }}>
			<SplitSvgPanel
				panelProps={props}
				sideConfig={makeSideConfig(props, "base")}
			/>
			<div style={SPLIT_DIVIDER_STYLE} />
			<SplitSvgPanel
				panelProps={props}
				sideConfig={makeSideConfig(props, "target")}
			/>
		</div>
	);
}

function useSideBySideListeners({
	outerRef,
	onWheel,
	activeAuditIdx,
	onReset,
}) {
	useEffect(() => {
		const el = outerRef.current;
		if (!el) return;
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [outerRef, onWheel]);

	useEffect(() => {
		const onKeyDown = ({ key }) => {
			if (key === "Escape" && activeAuditIdx !== null) onReset();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeAuditIdx, onReset]);
}

function SideBySidePadOverlay(props) {
	const {
		padLabelProps,
		leftContentRef,
		rightContentRef,
		activeLayers,
		soloLayer,
		layerOpacities,
		baseTransform,
		targetTransform,
	} = props;
	if (!padLabelProps) return null;
	return (
		<PadLabelOverlay
			{...padLabelProps}
			leftContentRef={leftContentRef}
			rightContentRef={rightContentRef}
			activeLayers={activeLayers}
			soloLayer={soloLayer}
			layerOpacities={layerOpacities}
			baseTransformScale={baseTransform.scale}
			targetTransformScale={targetTransform.scale}
		/>
	);
}

function useTraceWidth(traceWidth = DIFF_CONFIG.DEFAULT_TRACE_WIDTH) {
	const [selected, setSelected] = useState(traceWidth);
	useEffect(() => {
		if (traceWidth) setSelected(traceWidth);
	}, [traceWidth]);
	return [selected, setSelected];
}

function useSideBySideTransforms() {
	const leftContentRef = useRef(null);
	const rightContentRef = useRef(null);
	const outerRef = useRef(null);
	const [synced, setSynced] = useState(true);
	const [baseTransform, setBaseTransform] = useState(INITIAL_TRANSFORM);
	const [targetTransform, setTargetTransform] = useState(INITIAL_TRANSFORM);

	const state = {
		baseTransform,
		setBaseTransform,
		targetTransform,
		setTargetTransform,
		leftContentRef,
		rightContentRef,
		outerRef,
		synced,
	};
	const syncedTransform = useSyncedTransform(state);
	return { ...state, setSynced, ...syncedTransform };
}

function useSideBySideController(props = {}, ref) {
	const {
		isSchematic,
		padLabelProps,
		traceWidth = DIFF_CONFIG.DEFAULT_TRACE_WIDTH,
		activeAuditIdx,
		setActiveAuditIdx,
	} = props;
	const isSchematicMode =
		isSchematic ?? !padLabelProps?.relativeFilePath?.endsWith(".kicad_pcb");
	const [width, setWidth] = useTraceWidth(traceWidth);
	const state = useSideBySideTransforms();
	const onReset = useCallback(() => {
		state.resetTransform();
		if (setActiveAuditIdx) setActiveAuditIdx(null);
	}, [state.resetTransform, setActiveAuditIdx]);

	useSideBySideApi(ref, { ...state, setActiveAuditIdx });
	useSideBySideListeners({
		outerRef: state.outerRef,
		onWheel: state.onWheel,
		activeAuditIdx,
		onReset,
	});
	return { isSchematicMode, width, setWidth, state, onReset };
}

function SideBySideContainer({ props, ctrl }) {
	const { state, isSchematicMode, width, setWidth, onReset } = ctrl;
	const mode = isSchematicMode ? "schematic-mode" : "pcb-mode";
	const focus = props.activeAuditIdx !== null ? "has-focus" : "";
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer pan/zoom surface; keyboard users use the toolbar controls
		<div
			ref={state.outerRef}
			className={`mode-side-by-side ${mode} ${focus}`}
			onMouseDown={state.onMouseDown}
			onMouseMove={state.onMouseMove}
			onMouseUp={state.onMouseUp}
			onMouseLeave={state.onMouseUp}
			style={{ ...CONTAINER_BASE_STYLE, "--diff-trace-width": width }}
		>
			<SideBySideToolbar
				synced={state.synced}
				setSynced={state.setSynced}
				selectedTraceWidth={width}
				setSelectedTraceWidth={setWidth}
				activeAuditIdx={props.activeAuditIdx}
				onReset={onReset}
			/>
			<SideBySideSplitView {...props} {...state} />
			<SideBySidePadOverlay {...props} {...state} />
		</div>
	);
}

export default forwardRef(function SideBySideDiff(props = {}, ref) {
	const ctrl = useSideBySideController(props, ref);
	return (
		<>
			<style>{FOCUS_CSS}</style>
			<style>{DIFF_CSS}</style>
			<FocusedDiffStyle activeAuditIdx={props.activeAuditIdx} />
			<SideBySideContainer props={props} ctrl={ctrl} />
		</>
	);
});
