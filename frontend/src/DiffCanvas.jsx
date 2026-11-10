import React, {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import {
	CanvasTopToolbar,
	SliderSplitHandle,
} from "./components/CanvasControls.jsx";
import { useCanvasTransform } from "./useCanvasTransform.js";
import {
	findDiffDomRect,
	getLayerOpacity,
	getScreenCoordsFromSvg,
	isLayerActive,
	isLayerSolo,
} from "./utils/diffLayerUtils.js";
import { drawFocusRing } from "./utils/focusRingUtils.js";

const RED_FILTER =
	"invert(24%) sepia(93%) saturate(7355%) hue-rotate(356deg) brightness(94%) contrast(119%)";
const GREEN_FILTER =
	"invert(57%) sepia(74%) saturate(2256%) hue-rotate(84deg) brightness(119%) contrast(118%)";
const DIMMED_FILTER =
	"grayscale(1) opacity(0.12) contrast(0.5) brightness(0.6)";

const DIFF_SPLIT_MAP = {
	add: 42,
	delete: 58,
};

const DIFF_RING_CLASS_MAP = {
	delete: "diff-deleted",
	add: "diff-added",
};

const SVG_LAYER_STYLE = {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
	transition: "filter 0.25s ease, opacity 0.25s ease",
	pointerEvents: "none",
};

const LAYER_PANE_STYLE = {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
};

const TARGET_PANE_BASE_STYLE = {
	...LAYER_PANE_STYLE,
	pointerEvents: "none",
	transform: "translate3d(0px, 0px, 0px)",
	willChange: "transform, clip-path",
	backfaceVisibility: "hidden",
};

const LAYER_STACK_STYLE = {
	width: "100%",
	height: "100%",
	position: "relative",
};

const SURFACE_WRAPPER_STYLE = {
	position: "relative",
	flex: 1,
	width: "100%",
	height: "100%",
	overflow: "hidden",
	cursor: "grab",
	userSelect: "none",
	touchAction: "none",
};

const CANVAS_CONTAINER_STYLE = {
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "450px",
	overflow: "hidden",
	background: "#0d0f18",
	borderRadius: "8px",
	border: "1px solid #232738",
	display: "flex",
	flexDirection: "column",
};

function areSvgPropsEqual(prev, next) {
	const keys = ["content", "filterStyle", "opacityStyle", "mixBlendMode"];
	return keys.every((k) => prev[k] === next[k]);
}

const SvgLayer = React.memo(
	({ content, filterStyle, opacityStyle, mixBlendMode }) => {
		const html = content.replace(
			/<svg/,
			'<svg style="width:100%; height:100%; position:absolute;"',
		);
		return (
			<div
				style={{
					...SVG_LAYER_STYLE,
					filter: filterStyle,
					opacity: opacityStyle,
					mixBlendMode,
				}}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted backend-generated PCB SVG content
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		);
	},
	areSvgPropsEqual,
);

function resolveLayerFilter(isDimmed, isSlider, isBase) {
	if (isDimmed) return DIMMED_FILTER;
	if (isSlider) return "none";
	return isBase ? RED_FILTER : GREEN_FILTER;
}

function resolveLayerVisuals({
	filename,
	isBase,
	isSlider,
	soloLayer,
	layerOpacities,
}) {
	const isSolo = isLayerSolo(filename, soloLayer);
	const isDimmed = Boolean(soloLayer && !isSolo);
	const layerOp = getLayerOpacity(filename, layerOpacities);
	const filterStyle = resolveLayerFilter(isDimmed, isSlider, isBase);
	const opacity = isDimmed ? 0.12 : layerOp;
	const mixBlend = isSlider || isDimmed ? "normal" : "difference";
	return { filterStyle, opacity, mixBlend };
}

function LayerStack({ svgs, isBase, isSlider, soloLayer, layerOpacities }) {
	return (
		<div style={LAYER_STACK_STYLE}>
			{svgs.map((svg) => {
				const visuals = resolveLayerVisuals({
					filename: svg.filename,
					isBase,
					isSlider,
					soloLayer,
					layerOpacities,
				});
				return (
					<SvgLayer
						key={`${isBase ? "base" : "target"}-${svg.filename}`}
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

function normalizeToRect(pointOrRect) {
	if (!pointOrRect) return null;
	if (pointOrRect.left !== undefined && pointOrRect.width !== undefined) {
		return pointOrRect;
	}
	if (typeof pointOrRect.x === "number" && typeof pointOrRect.y === "number") {
		return { left: pointOrRect.x, top: pointOrRect.y, width: 0, height: 0 };
	}
	return null;
}

function resolveCoords(targetCoords, baseCoords, bbox) {
	if (targetCoords) return targetCoords;
	if (baseCoords) return baseCoords;
	if (bbox) return { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 };
	return null;
}

function resolveTargetRect(contentRef, options) {
	const { diffIdx, baseCoords, targetCoords, bbox } = options;
	const coords = resolveCoords(targetCoords, baseCoords, bbox);
	const root = contentRef.current;
	// Try coords first, then fall back to DOM lookup — always attempt both
	const fromCoords = coords
		? normalizeToRect(getScreenCoordsFromSvg(root, coords))
		: null;
	const fromDom = findDiffDomRect(root, diffIdx);
	const elRect = fromCoords || fromDom;
	const target =
		diffIdx != null && root
			? root.querySelector(`[data-diff-idx="${diffIdx}"]`)
			: null;
	return { elRect, target, coords };
}

function setDiffSelected(root, targetEl) {
	if (!root) return;
	root.querySelectorAll('[data-diff-selected="true"]').forEach((el) => {
		el.removeAttribute("data-diff-selected");
		el.classList.remove("diff-highlight-active");
	});
	if (targetEl) {
		targetEl.setAttribute("data-diff-selected", "true");
		targetEl.classList.add("diff-highlight-active");
	}
}

function updateDiffHovered(root, diffIdx) {
	if (!root) return;
	root.querySelectorAll('[data-diff-hovered="true"]').forEach((el) => {
		el.removeAttribute("data-diff-hovered");
	});
	if (diffIdx != null) {
		root.querySelectorAll(`[data-diff-idx="${diffIdx}"]`).forEach((el) => {
			el.setAttribute("data-diff-hovered", "true");
		});
	}
}

function computeFocusTransform(elRect, vpRect, current) {
	const targetScale = 2.4;
	const elCX = elRect.left + elRect.width / 2 - vpRect.left;
	const elCY = elRect.top + elRect.height / 2 - vpRect.top;
	const contentX = (elCX - current.x) / current.scale;
	const contentY = (elCY - current.y) / current.scale;
	return {
		scale: targetScale,
		x: vpRect.width / 2 - contentX * targetScale,
		y: vpRect.height / 2 - contentY * targetScale,
	};
}

function handleFocusElement(apiOptions, options) {
	const outer = apiOptions.outerRef.current;
	const content = apiOptions.contentRef.current;
	if (!outer || !content) return;
	const { elRect, target, coords } = resolveTargetRect(
		apiOptions.contentRef,
		options,
	);
	if (!elRect) return;

	const next = computeFocusTransform(
		elRect,
		outer.getBoundingClientRect(),
		apiOptions.transformRef.current,
	);
	apiOptions.animateTo(next, 450);
	setDiffSelected(content, target);

	if (apiOptions.isSlider && apiOptions.onSliderChange) {
		apiOptions.onSliderChange(DIFF_SPLIT_MAP[options.diffType] ?? 50);
	}
	const ringClass = DIFF_RING_CLASS_MAP[options.diffType] || "diff-changed";
	drawFocusRing(content, target || elRect, ringClass, coords);
}

function useDiffCanvasApi(ref, apiOptions) {
	const {
		animateTo,
		contentRef,
		isSlider,
		onSliderChange,
		outerRef,
		transformRef,
	} = apiOptions;
	// biome-ignore lint/correctness/useExhaustiveDependencies: apiOptions is recreated on each render; constituent values are tracked explicitly
	useImperativeHandle(
		ref,
		() => ({
			focusElement: (options) => handleFocusElement(apiOptions, options),
			setHoveredDiff: (diffIdx) =>
				updateDiffHovered(contentRef.current, diffIdx),
			resetView: () => animateTo({ scale: 1, x: 0, y: 0 }, 300),
		}),
		[animateTo, contentRef, isSlider, onSliderChange, outerRef, transformRef],
	);
}

function useCanvasEscapeKey(activeAuditIdx, resetView, setActiveAuditIdx) {
	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === "Escape" && activeAuditIdx !== null) {
				if (setActiveAuditIdx) setActiveAuditIdx(null);
				resetView();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeAuditIdx, resetView, setActiveAuditIdx]);
}

function useActiveDiffDomHighlight(contentRef, activeAuditIdx) {
	useEffect(() => {
		const root = contentRef.current;
		if (!root) return;
		const target =
			activeAuditIdx != null
				? root.querySelector(`[data-diff-idx="${activeAuditIdx}"]`)
				: null;
		setDiffSelected(root, target);
	}, [contentRef, activeAuditIdx]);
}

function filterActiveSvgs(svgs, activeLayers) {
	return (svgs || []).filter((svg) =>
		isLayerActive(svg.filename, activeLayers),
	);
}

function BaseLayerPane({
	baseSvgs,
	activeBaseSvgs,
	activeLayers,
	isSlider,
	soloLayer,
	layerOpacities,
}) {
	const svgs = activeBaseSvgs || filterActiveSvgs(baseSvgs, activeLayers);
	return (
		<div style={LAYER_PANE_STYLE}>
			<LayerStack
				svgs={svgs}
				isBase={true}
				isSlider={isSlider}
				soloLayer={soloLayer}
				layerOpacities={layerOpacities}
			/>
		</div>
	);
}

function TargetLayerPane({
	targetSvgs,
	activeTargetSvgs,
	activeLayers,
	isSlider,
	soloLayer,
	layerOpacities,
	sliderValue,
}) {
	const svgs = activeTargetSvgs || filterActiveSvgs(targetSvgs, activeLayers);
	const clipPath = isSlider ? `inset(0 0 0 ${sliderValue}%)` : "none";
	return (
		<div style={{ ...TARGET_PANE_BASE_STYLE, clipPath }}>
			<LayerStack
				svgs={svgs}
				isBase={false}
				isSlider={isSlider}
				soloLayer={soloLayer}
				layerOpacities={layerOpacities}
			/>
		</div>
	);
}

function DiffCanvasSurface(props) {
	const {
		outerRef,
		contentRef,
		transform,
		mouseHandlers,
		isSlider,
		sliderValue,
	} = props;
	const contentStyle = {
		position: "absolute",
		top: 0,
		left: 0,
		width: "100%",
		height: "100%",
		transformOrigin: "0 0",
		transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: pointer pan/zoom surface; keyboard users use the canvas controls
		<div
			ref={outerRef}
			onMouseDown={mouseHandlers?.onMouseDown}
			onMouseMove={mouseHandlers?.onMouseMove}
			onMouseUp={mouseHandlers?.onMouseUp}
			onDoubleClick={mouseHandlers?.onDoubleClick}
			style={SURFACE_WRAPPER_STYLE}
		>
			<div ref={contentRef} style={contentStyle}>
				<BaseLayerPane {...props} />
				<TargetLayerPane {...props} />
			</div>
			{isSlider && <SliderSplitHandle sliderValue={sliderValue} />}
		</div>
	);
}

function useCanvasInteractions(ref, props, refs) {
	const { outerRef, contentRef } = refs;
	const isSlider = props.diffMode === "Overlay Slider";
	const { onSliderChange, activeAuditIdx, setActiveAuditIdx } = props;
	const {
		transform,
		transformRef,
		animateTo,
		zoomIn,
		zoomOut,
		resetView,
		...mouseHandlers
	} = useCanvasTransform({ outerRef, contentRef, isSlider, onSliderChange });

	useDiffCanvasApi(ref, {
		outerRef,
		contentRef,
		transformRef,
		animateTo,
		isSlider,
		onSliderChange,
	});
	useActiveDiffDomHighlight(contentRef, activeAuditIdx);
	useCanvasEscapeKey(activeAuditIdx, resetView, setActiveAuditIdx);

	return { isSlider, transform, zoomIn, zoomOut, resetView, mouseHandlers };
}

function DiffCanvasToolbar({ isSlider, scale, zoomIn, zoomOut, resetView }) {
	return (
		<CanvasTopToolbar
			isSlider={isSlider}
			currentZoomPercent={Math.round(scale * 100)}
			onZoomIn={zoomIn}
			onZoomOut={zoomOut}
			onReset={resetView}
		/>
	);
}

const DiffCanvas = forwardRef(function DiffCanvas(props, ref) {
	const outerRef = useRef(null);
	const contentRef = useRef(null);
	const interactions = useCanvasInteractions(ref, props, {
		outerRef,
		contentRef,
	});

	return (
		<div style={CANVAS_CONTAINER_STYLE}>
			<DiffCanvasToolbar
				isSlider={interactions.isSlider}
				scale={interactions.transform.scale}
				zoomIn={interactions.zoomIn}
				zoomOut={interactions.zoomOut}
				resetView={interactions.resetView}
			/>
			<DiffCanvasSurface
				{...props}
				outerRef={outerRef}
				contentRef={contentRef}
				transform={interactions.transform}
				mouseHandlers={interactions.mouseHandlers}
				isSlider={interactions.isSlider}
			/>
		</div>
	);
});

export default DiffCanvas;
