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
import { FILL_BOX, FLEX_CENTERED, FLEX_COLUMN } from "./utils/fe_a-styles.js";
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

const FULL_ABSOLUTE_STYLE = {
	position: "absolute",
	top: 0,
	left: 0,
	...FILL_BOX,
};
const LAYER_STACK_STYLE = { position: "relative", ...FILL_BOX };

const SVG_LAYER_STYLE = {
	...FULL_ABSOLUTE_STYLE,
	transition: "filter 0.25s ease, opacity 0.25s ease",
	pointerEvents: "none",
};

const LAYER_PANE_STYLE = {
	...FULL_ABSOLUTE_STYLE,
	...FLEX_CENTERED,
};

const TARGET_PANE_BASE_STYLE = {
	...LAYER_PANE_STYLE,
	pointerEvents: "none",
	transform: "translate3d(0px, 0px, 0px)",
	willChange: "transform, clip-path",
	backfaceVisibility: "hidden",
};

const SURFACE_WRAPPER_STYLE = {
	...FILL_BOX,
	position: "relative",
	flex: 1,
	overflow: "hidden",
	cursor: "grab",
	userSelect: "none",
	touchAction: "none",
};

const CANVAS_CONTAINER_STYLE = {
	...FILL_BOX,
	position: "relative",
	minHeight: "450px",
	...FLEX_COLUMN,
	overflow: "hidden",
	background: "#0d0f18",
	borderRadius: "8px",
	border: "1px solid #232738",
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

function selectFilter(dimmed, isSlider, isBase) {
	if (dimmed) return DIMMED_FILTER;
	if (isSlider) return "none";
	return isBase ? RED_FILTER : GREEN_FILTER;
}

function computeLayerStyle(filename, config) {
	const { isBase, isSlider, soloLayer, layerOpacities } = config;
	const dimmed = Boolean(soloLayer) && !isLayerSolo(filename, soloLayer);
	return {
		filterStyle: selectFilter(dimmed, isSlider, isBase),
		opacity: dimmed ? 0.12 : getLayerOpacity(filename, layerOpacities),
		mixBlend: isSlider || dimmed ? "normal" : "difference",
	};
}

function LayerStack({ svgs, isBase, isSlider, soloLayer, layerOpacities }) {
	const prefix = isBase ? "base" : "target";
	return (
		<div style={LAYER_STACK_STYLE}>
			{svgs.map((svg) => {
				const visuals = computeLayerStyle(svg.filename, {
					isBase,
					isSlider,
					soloLayer,
					layerOpacities,
				});
				return (
					<SvgLayer
						key={`${prefix}-${svg.filename}`}
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

function normalizeToRect(target) {
	if (!target) return null;
	if ("left" in target && "width" in target) return target;
	if ("x" in target && "y" in target) {
		return { left: target.x, top: target.y, width: 0, height: 0 };
	}
	return null;
}

function resolveCoords({ targetCoords, baseCoords, bbox }) {
	if (targetCoords) return targetCoords;
	if (baseCoords) return baseCoords;
	return bbox
		? { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 }
		: null;
}

function findDiffDomElement(root, diffIdx) {
	if (!root || diffIdx == null) return null;
	return root.querySelector(`[data-diff-idx="${diffIdx}"]`);
}

function resolveTargetRect(contentRef, options) {
	const root = contentRef.current;
	const coords = resolveCoords(options);
	// Try coords first, then fall back to DOM lookup — always attempt both
	const point = coords ? getScreenCoordsFromSvg(root, coords) : null;
	const elRect =
		normalizeToRect(point) ?? findDiffDomRect(root, options.diffIdx);
	const target = findDiffDomElement(root, options.diffIdx);
	return { elRect, target, coords };
}

function clearMarker(root, attr, className) {
	if (!root) return;
	const items = root.querySelectorAll(`[${attr}="true"]`);
	for (const el of items) {
		el.removeAttribute(attr);
		if (className) el.classList.remove(className);
	}
}

function setDiffSelected(root, targetEl) {
	clearMarker(root, "data-diff-selected", "diff-highlight-active");
	if (targetEl) {
		targetEl.setAttribute("data-diff-selected", "true");
		targetEl.classList.add("diff-highlight-active");
	}
}

function updateDiffHovered(root, diffIdx) {
	clearMarker(root, "data-diff-hovered");
	if (diffIdx == null || !root) return;
	const items = root.querySelectorAll(`[data-diff-idx="${diffIdx}"]`);
	for (const el of items) {
		el.setAttribute("data-diff-hovered", "true");
	}
}

function computeFocusTransform(elRect, vpRect, current) {
	const targetScale = 2.4;
	const midX = elRect.left + elRect.width / 2 - vpRect.left;
	const midY = elRect.top + elRect.height / 2 - vpRect.top;
	const originX = (midX - current.x) / current.scale;
	const originY = (midY - current.y) / current.scale;
	return {
		scale: targetScale,
		x: vpRect.width / 2 - originX * targetScale,
		y: vpRect.height / 2 - originY * targetScale,
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
		const onKey = (event) => {
			const shouldReset = event.key === "Escape" && activeAuditIdx !== null;
			if (!shouldReset) return;
			setActiveAuditIdx?.(null);
			resetView();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [activeAuditIdx, resetView, setActiveAuditIdx]);
}

function useActiveDiffDomHighlight(contentRef, activeAuditIdx) {
	useEffect(() => {
		const root = contentRef.current;
		setDiffSelected(root, findDiffDomElement(root, activeAuditIdx));
	}, [contentRef, activeAuditIdx]);
}

function filterActiveSvgs(svgs, activeLayers) {
	return (svgs || []).filter((svg) =>
		isLayerActive(svg.filename, activeLayers),
	);
}

function resolvePaneStyle(isBase, isSlider, sliderValue) {
	if (isBase) return LAYER_PANE_STYLE;
	const clipPath = isSlider ? `inset(0 0 0 ${sliderValue}%)` : "none";
	return { ...TARGET_PANE_BASE_STYLE, clipPath };
}

function resolvePaneSvgs(props, isBase) {
	const raw = isBase ? props.baseSvgs : props.targetSvgs;
	const active = isBase ? props.activeBaseSvgs : props.activeTargetSvgs;
	return active || filterActiveSvgs(raw, props.activeLayers);
}

function DiffLayerPane(props) {
	const { isBase, isSlider, sliderValue, soloLayer, layerOpacities } = props;
	const svgs = resolvePaneSvgs(props, isBase);
	const style = resolvePaneStyle(isBase, isSlider, sliderValue);
	return (
		<div style={style}>
			<LayerStack
				svgs={svgs}
				isBase={isBase}
				isSlider={isSlider}
				soloLayer={soloLayer}
				layerOpacities={layerOpacities}
			/>
		</div>
	);
}

function makeContentTransformStyle({ x, y, scale }) {
	return {
		...FULL_ABSOLUTE_STYLE,
		transformOrigin: "0 0",
		transform: `translate(${x}px, ${y}px) scale(${scale})`,
	};
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
			<div ref={contentRef} style={makeContentTransformStyle(transform)}>
				<DiffLayerPane isBase={true} {...props} />
				<DiffLayerPane isBase={false} {...props} />
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

const DiffCanvas = forwardRef(function DiffCanvas(props, ref) {
	const outerRef = useRef(null);
	const contentRef = useRef(null);
	const interactions = useCanvasInteractions(ref, props, {
		outerRef,
		contentRef,
	});

	return (
		<div style={CANVAS_CONTAINER_STYLE}>
			<CanvasTopToolbar
				isSlider={interactions.isSlider}
				currentZoomPercent={Math.round(interactions.transform.scale * 100)}
				onZoomIn={interactions.zoomIn}
				onZoomOut={interactions.zoomOut}
				onReset={interactions.resetView}
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
