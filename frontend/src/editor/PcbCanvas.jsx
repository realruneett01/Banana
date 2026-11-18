import { Input, Modal, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BoardGraphicsLayer from "./BoardGraphicsLayer.jsx";
import { setOutlineTool, useOutlineTool } from "./BoardTools.jsx";
import {
	addGraphic,
	deleteGraphic,
	hitTestGraphic,
	moveGraphic,
} from "./boardGraphics.js";
import {
	outlineToPolygon,
	polygonBBox,
	rectOutline,
	roundedRectOutline,
} from "./boardOutline.js";
import { get as getEditorStatus } from "./editorStatus.js";
import { emitActiveTool, onEditorTool } from "./editorToolBus.js";
import {
	arcToSvgPath,
	boardPadPositions,
	boardPadRadii,
	calcArcCenter,
	footprintIdsToFetch,
	footprintToPrimitives,
	padHitTest,
	padOutline,
	placementFor,
	refLabelPlacement,
	transformPrimitives,
} from "./footprintRender.js";
import {
	createLayerState,
	drawOrder,
	isVisible,
	jumpCopper,
	setActive,
	stepCopper,
	toggleVisible,
} from "./layers.js";
import { markerGlyphs } from "./markerRender.js";
import { buildPlacedPart } from "./partPlacement.js";
import {
	addTrack,
	deleteTrack,
	footprintRect,
	hitTest,
	missingFootprintIds,
	ratsnest,
	routePreviewLegs,
	snapToGrid,
	trackKey,
	trackPath,
} from "./pcbGeometry.js";
import { addVia, boardCopperPads, WIDTH_PRESETS } from "./routingModel.js";
import { getLayerColor, PCB_THEME } from "./theme.js";
import {
	legPoints,
	proposePostureRoute,
	togglePosture,
} from "./trackPosture.js";
import { useCanvasNav } from "./useCanvasNav.js";
import { bboxOfPoints, fitToBounds, screenToWorld } from "./viewport.js";

const CONTAINER_STYLE = Object.freeze({
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "500px",
	display: "flex",
	flexDirection: "column",
	background: PCB_THEME.background,
	borderRadius: "8px",
	border: "1px solid #23283e",
	color: "#f1f5f9",
	outline: "none",
	overflow: "hidden",
});

const TOOLBAR_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "8px 12px",
	background: "#161b2b",
	borderBottom: "1px solid #23283e",
	gap: "12px",
	flexWrap: "wrap",
});

const TOOL_BUTTON_STYLE = Object.freeze({
	background: "#1f293d",
	border: "1px solid #334155",
	color: "#f1f5f9",
	padding: "4px 10px",
	borderRadius: "4px",
	cursor: "pointer",
	fontSize: "12px",
});

const STATUS_BAR_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "4px 12px",
	background: "#161b2b",
	borderTop: "1px solid #23283e",
	fontSize: "12px",
	color: "#94a3b8",
	userSelect: "none",
});

const SVG_STYLE = Object.freeze({
	width: "100%",
	flex: 1,
	display: "block",
	cursor: "crosshair",
	userSelect: "none",
	background: PCB_THEME.background,
});

const LAYER_LIST_STYLE = Object.freeze({
	position: "absolute",
	top: "52px",
	right: "12px",
	background: "rgba(22, 27, 43, 0.92)",
	border: "1px solid #23283e",
	borderRadius: "6px",
	padding: "6px 8px",
	display: "flex",
	flexDirection: "column",
	gap: "3px",
	maxHeight: "360px",
	overflowY: "auto",
	zIndex: 10,
	fontSize: "11px",
	color: "#f1f5f9",
	userSelect: "none",
	boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
});

const LAYER_HEADER_STYLE = Object.freeze({
	fontSize: "11px",
	fontWeight: 600,
	color: "#94a3b8",
	marginBottom: "4px",
	borderBottom: "1px solid #23283e",
	paddingBottom: "2px",
});

const OVERLAY_EXTRA_LAYERS = Object.freeze([
	"Edge.Cuts",
	"F.SilkS",
	"B.SilkS",
	"F.Fab",
	"B.Fab",
	"F.CrtYd",
	"B.CrtYd",
]);

function doUndo(past, board, setPast, setFuture) {
	const prev = past[past.length - 1];
	setPast(past.slice(0, -1));
	setFuture((f) => [board, ...f].slice(-50));
	return prev;
}

function doRedo(future, board, setPast, setFuture) {
	const next = future[0];
	setFuture(future.slice(1));
	setPast((p) => [...p, board].slice(-50));
	return next;
}

function useBoardHistory(board, onBoardChange) {
	const [past, setPast] = useState([]);
	const [future, setFuture] = useState([]);

	const pushBoard = useCallback(
		(next) => {
			setPast((p) => [...p, board].slice(-50));
			setFuture([]);
			onBoardChange?.(next);
		},
		[board, onBoardChange],
	);

	const undoBoard = useCallback(() => {
		if (past.length === 0) return false;
		onBoardChange?.(doUndo(past, board, setPast, setFuture));
		return true;
	}, [past, board, onBoardChange]);

	const redoBoard = useCallback(() => {
		if (future.length === 0) return false;
		onBoardChange?.(doRedo(future, board, setPast, setFuture));
		return true;
	}, [future, board, onBoardChange]);

	return { pushBoard, undoBoard, redoBoard };
}

function screenToBoardCoords(e, svgEl, view) {
	if (!svgEl) return [0, 0];
	const rect = svgEl.getBoundingClientRect();
	const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
	const world = screenToWorld(pt, view);
	return [world.x, world.y];
}

function isNear(p1, p2, tol = 1.0) {
	return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= tol;
}

function findNearTrack(tracks, pt, tol = 1.0) {
	for (const t of tracks ?? []) {
		if (isNear(pt, t.start, tol)) return { track: t, endpoint: t.start };
		if (isNear(pt, t.end, tol)) return { track: t, endpoint: t.end };
	}
	return null;
}

function findTrackSnap(tracks, pt, tol = 1.0) {
	return findNearTrack(tracks, pt, tol)?.endpoint ?? null;
}

function findNearPad(parts, padPositions, pt, tol = 1.0) {
	for (const p of parts ?? []) {
		const pads = padPositions?.[p.id];
		if (!pads) continue;
		for (const [pinNum, pos] of Object.entries(pads)) {
			if (isNear(pt, pos, tol)) return { partId: p.id, pinNum, pos };
		}
	}
	return null;
}

function findPadSnap(parts, padPositions, pt, tol = 1.0) {
	return findNearPad(parts, padPositions, pt, tol)?.pos ?? null;
}

function findPartCenterSnap(parts, pt, tol = 1.0) {
	for (const p of parts ?? []) {
		if (p.placement && isNear(pt, [p.placement.x, p.placement.y], tol)) {
			return [p.placement.x, p.placement.y];
		}
	}
	return null;
}

function findSnapEndpoint(pt, { board, ir, padPositions }, tol = 1.0) {
	return (
		findTrackSnap(board?.tracks, pt, tol) ??
		findPadSnap(ir?.parts, padPositions, pt, tol) ??
		findPartCenterSnap(ir?.parts, pt, tol) ??
		pt
	);
}

function hasModifier(e) {
	return Boolean(e.ctrlKey || e.metaKey);
}

function isUndoShortcut(e, key) {
	if (!hasModifier(e)) return false;
	return key === "z" && !e.shiftKey;
}

function isRedoShortcut(e, key) {
	if (!hasModifier(e)) return false;
	if (key === "y") return true;
	return key === "z" && Boolean(e.shiftKey);
}

function handleHistoryShortcuts(e, key, ctx) {
	if (isUndoShortcut(e, key)) {
		e.preventDefault();
		if (!ctx.undoBoard()) ctx.editor.undo();
		return true;
	}
	if (isRedoShortcut(e, key)) {
		e.preventDefault();
		if (!ctx.redoBoard()) ctx.editor.redo();
		return true;
	}
	return false;
}

function handlePartKeys(e, key, ctx) {
	if (!ctx.selectedPartId) return false;
	if (key === "r") {
		e.preventDefault();
		ctx.editor.dispatch({
			type: "rotatePart",
			partId: ctx.selectedPartId,
			deltaDeg: 90,
		});
		return true;
	}
	if (key === "f") {
		e.preventDefault();
		ctx.editor.dispatch({ type: "flipPart", partId: ctx.selectedPartId });
		return true;
	}
	return false;
}

function handleRoutingAction(key, ctx) {
	if (key === "v") {
		if (ctx.isRouting) ctx.placeVia();
		else ctx.armVia?.();
		return true;
	}
	const actions = {
		w: ctx.cycleWidthPreset,
		"/": ctx.toggleRouteMode,
		x: ctx.toggleRoute,
	};
	const action = actions[key];
	if (!action) return false;
	action();
	return true;
}

function handlePostureKey(e, key, ctx) {
	if (key !== "/" || !hasModifier(e)) return false;
	ctx.togglePosture();
	return true;
}

function handleRoutingKeys(e, key, ctx) {
	const handled =
		handlePostureKey(e, key, ctx) || handleRoutingAction(key, ctx);
	if (!handled) return false;
	e.preventDefault();
	return true;
}

function handleLayerShortcuts(e, ctx) {
	if (e.key === "PageUp") {
		e.preventDefault();
		ctx.jumpCopper("top");
		return true;
	}
	if (e.key === "PageDown") {
		e.preventDefault();
		ctx.jumpCopper("bottom");
		return true;
	}
	if (e.key === "+" || e.key === "=") {
		e.preventDefault();
		ctx.stepCopper(1);
		return true;
	}
	if (e.key === "-") {
		e.preventDefault();
		ctx.stepCopper(-1);
		return true;
	}
	return false;
}

function handleToolKeys(e, key, ctx) {
	if (handlePartKeys(e, key, ctx)) return;
	if (handleRoutingKeys(e, key, ctx)) return;
	if (key === "delete" || key === "backspace") {
		e.preventDefault();
		ctx.deleteSelected();
	}
}

function isTextInput(target) {
	if (!target) return false;
	const tag = target.tagName?.toLowerCase();
	return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function cancelRouting(ctx) {
	if (!ctx.isRouting) return false;
	ctx.cancelRoute();
	return true;
}

// Escape: first outline, then graphics, then armed footprint, else leave the route tool.
function handleEscape(e, key, ctx) {
	if (key !== "escape") return false;
	if (ctx.cancelOutline?.()) {
		e.preventDefault();
		return true;
	}
	if (ctx.cancelGraphics?.()) {
		e.preventDefault();
		return true;
	}
	if (ctx.disarmFootprint?.()) {
		e.preventDefault();
		return true;
	}
	if (cancelRouting(ctx)) {
		e.preventDefault();
		return true;
	}
	return false;
}

function handleShortcuts(e, ctx) {
	if (isTextInput(e.target)) return;
	const key = e.key.toLowerCase();
	if (handleEscape(e, key, ctx)) return;
	if (handleHistoryShortcuts(e, key, ctx)) return;
	if (handleLayerShortcuts(e, ctx)) return;
	handleToolKeys(e, key, ctx);
}

function isValidOutline(outline) {
	return Array.isArray(outline) && outline.length >= 3;
}

function collectFootprintPoints(parts) {
	const pts = [];
	for (const p of parts ?? []) {
		const r = footprintRect(p);
		if (r) {
			pts.push({ x: r.x - r.w / 2, y: r.y - r.h / 2 });
			pts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
		} else if (p.placement) {
			pts.push({ x: p.placement.x, y: p.placement.y });
		}
	}
	return pts;
}

function getOutlineBBox(outline) {
	if (outline[0]?.type) {
		const res = outlineToPolygon(outline);
		if (res.ok) return polygonBBox(res.polygon);
	}
	return bboxOfPoints(outline);
}

function getSceneBounds(board, ir) {
	if (isValidOutline(board?.outline)) {
		const box = getOutlineBBox(board.outline);
		if (box) return box;
	}
	return bboxOfPoints(collectFootprintPoints(ir?.parts));
}

function formatPt(pt) {
	if (Array.isArray(pt)) return `${pt[0]},${pt[1]}`;
	if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
		return `${pt.x},${pt.y}`;
	}
	return null;
}

function outlinePoints(outline) {
	if (!isValidOutline(outline)) return null;
	if (outline[0]?.type) {
		const res = outlineToPolygon(outline);
		if (!res.ok) return null;
		return res.polygon.map(formatPt).filter(Boolean).join(" ");
	}
	return outline.map(formatPt).filter(Boolean).join(" ");
}

function EdgeCutsLayer({ outline }) {
	const pts = outlinePoints(outline);
	if (!pts) return null;
	return (
		<polygon
			points={pts}
			fill="none"
			stroke={getLayerColor(PCB_THEME, "Edge.Cuts")}
			strokeWidth={0.5}
		/>
	);
}

function ZonesLayer({ zones, layer }) {
	if (!Array.isArray(zones)) return null;
	const filtered = zones.filter((z) => z.layer === layer);
	if (filtered.length === 0) return null;
	return (
		<g className="pcb-zones">
			{filtered.map((zone) => {
				const pts = (zone.polygon ?? [])
					.map((p) => `${p[0]},${p[1]}`)
					.join(" ");
				const color = getLayerColor(PCB_THEME, zone.layer);
				const key = `zone_${zone.layer}_${zone.polygon?.[0]?.[0]}_${zone.polygon?.[0]?.[1]}`;
				return (
					<polygon
						key={key}
						points={pts}
						fill={color}
						fillOpacity={0.25}
						stroke={color}
						strokeWidth={0.2}
					/>
				);
			})}
		</g>
	);
}

function TracksLayer({ tracks, layer, selectedIndex }) {
	if (!Array.isArray(tracks)) return null;
	const filtered = tracks
		.map((track, originalIndex) => ({ track, index: originalIndex }))
		.filter(({ track }) => track.layer === layer);
	if (filtered.length === 0) return null;
	return (
		<g className="pcb-tracks">
			{filtered.map(({ track, index }) => {
				const isSelected = selectedIndex === index;
				const color = isSelected
					? "#fadb14"
					: getLayerColor(PCB_THEME, track.layer);
				return (
					<path
						key={trackKey(track, index)}
						d={trackPath(track)}
						fill="none"
						stroke={color}
						strokeWidth={track.widthMm || 0.25}
						strokeLinecap="round"
					/>
				);
			})}
		</g>
	);
}

function ViasLayer({ vias }) {
	if (!Array.isArray(vias)) return null;
	return (
		<g className="pcb-vias">
			{vias.map((via) => {
				const [x, y] = via.at ?? [0, 0];
				const outerR = (via.sizeMm || 0.8) / 2;
				const innerR = (via.drillMm || 0.4) / 2;
				const key = `via_${x}_${y}`;
				return (
					<g key={key}>
						<circle
							cx={x}
							cy={y}
							r={outerR}
							fill={PCB_THEME.via}
							stroke="#059669"
							strokeWidth={0.1}
						/>
						<circle cx={x} cy={y} r={innerR} fill={PCB_THEME.background} />
					</g>
				);
			})}
		</g>
	);
}

// `label` is the board file's reference text placement; without it the
// reference sits at the part centre, sized to the part.
function PartRefLabel({ rect, label }) {
	const fontSize = label?.size ?? Math.max(0.6, Math.min(rect.w, rect.h) * 0.4);
	const x = label?.x ?? rect.x;
	const y = label?.y ?? rect.y;
	return (
		<text
			x={x}
			y={y}
			transform={label?.angle ? `rotate(${label.angle} ${x} ${y})` : undefined}
			textAnchor="middle"
			dominantBaseline="central"
			fill="#f1f5f9"
			fontSize={fontSize}
			style={{ pointerEvents: "none", userSelect: "none", fontWeight: 600 }}
		>
			{rect.ref}
		</text>
	);
}

function resolvePartColors(isFront, isSelected) {
	if (isSelected) {
		return { stroke: "#fadb14", strokeWidth: 0.6 };
	}
	const stroke = getLayerColor(PCB_THEME, isFront ? "F.SilkS" : "B.SilkS");
	return { stroke, strokeWidth: 0.25 };
}

// SVG transform for a part outline, turned KiCad's way like its footprint.
function partRotation(rect) {
	if (!rect.rot) return undefined;
	return `rotate(${placementFor(null, rect).rot} ${rect.x} ${rect.y})`;
}

function PartShape({ rect, isSelected }) {
	const isFront = rect.side !== "B";
	const { stroke, strokeWidth } = resolvePartColors(isFront, isSelected);
	const fill = isFront ? "rgba(56, 189, 248, 0.2)" : "rgba(167, 139, 250, 0.2)";
	const rot = partRotation(rect);
	return (
		<g transform={rot} style={{ cursor: "move" }}>
			<rect
				x={rect.x - rect.w / 2}
				y={rect.y - rect.h / 2}
				width={rect.w}
				height={rect.h}
				fill={fill}
				stroke={stroke}
				strokeWidth={strokeWidth}
				rx={0.2}
			/>
			<PartRefLabel rect={rect} />
		</g>
	);
}

function resolveGhostStyle(side) {
	const isFront = side !== "B";
	const stroke = getLayerColor(PCB_THEME, isFront ? "F.SilkS" : "B.SilkS");
	const fill = isFront
		? "rgba(56, 189, 248, 0.25)"
		: "rgba(167, 139, 250, 0.25)";
	return { stroke, fill };
}

function FootprintGhost({ item, cursor, activeLayer }) {
	if (!item || !cursor) return null;
	const side = activeLayer === "B.Cu" ? "B" : "F";
	const rect = footprintRect({
		...item,
		placement: { x: cursor.x, y: cursor.y, rot: 0, side },
	});
	const refText = item.ref || item.prefix || rect?.ref || "U";
	const ghostRect = {
		x: cursor.x,
		y: cursor.y,
		w: rect?.w ?? 5,
		h: rect?.h ?? 5,
		ref: refText,
	};
	const { stroke, fill } = resolveGhostStyle(side);
	return (
		<g className="pcb-footprint-ghost" style={{ pointerEvents: "none" }}>
			<rect
				x={ghostRect.x - ghostRect.w / 2}
				y={ghostRect.y - ghostRect.h / 2}
				width={ghostRect.w}
				height={ghostRect.h}
				fill={fill}
				stroke={stroke}
				strokeWidth={0.3}
				strokeDasharray="2,2"
				rx={0.2}
			/>
			<PartRefLabel rect={ghostRect} />
		</g>
	);
}

function handlePartKey(e, partId, onSelectPart) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		onSelectPart(partId);
	}
}

function resolveGraphicColor(layer) {
	return getLayerColor(PCB_THEME, layer);
}

function GraphicLine({ g, color, width }) {
	return (
		<line
			x1={g.start[0]}
			y1={g.start[1]}
			x2={g.end[0]}
			y2={g.end[1]}
			stroke={color}
			strokeWidth={width}
			strokeLinecap="round"
		/>
	);
}

function GraphicRect({ g, color, width }) {
	const x = Math.min(g.start[0], g.end[0]);
	const y = Math.min(g.start[1], g.end[1]);
	const w = Math.abs(g.end[0] - g.start[0]);
	const h = Math.abs(g.end[1] - g.start[1]);
	return (
		<rect
			x={x}
			y={y}
			width={w}
			height={h}
			fill="none"
			stroke={color}
			strokeWidth={width}
		/>
	);
}

function GraphicCircle({ g, color, width }) {
	return (
		<circle
			cx={g.center[0]}
			cy={g.center[1]}
			r={g.radius}
			fill="none"
			stroke={color}
			strokeWidth={width}
		/>
	);
}

function GraphicArc({ g, color, width }) {
	return (
		<path
			d={arcToSvgPath(g)}
			fill="none"
			stroke={color}
			strokeWidth={width}
			strokeLinecap="round"
		/>
	);
}

function GraphicPoly({ g, color, width }) {
	const pts = (g.pts ?? []).map((p) => `${p[0]},${p[1]}`).join(" ");
	return (
		<polygon points={pts} fill="none" stroke={color} strokeWidth={width} />
	);
}

const GRAPHIC_COMPONENTS = {
	line: GraphicLine,
	rect: GraphicRect,
	circle: GraphicCircle,
	arc: GraphicArc,
	poly: GraphicPoly,
};

function FootprintGraphic({ graphic, layerState }) {
	if (!isVisible(layerState, graphic.layer)) return null;
	const Component = GRAPHIC_COMPONENTS[graphic.type];
	if (!Component) return null;
	const color = resolveGraphicColor(graphic.layer);
	const width = graphic.width || 0.12;
	return <Component g={graphic} color={color} width={width} />;
}

function isThruHole(pad) {
	return pad.padType === "thru_hole" || pad.layers.includes("*.Cu");
}

function isPadVisible(pad, isBack, layerState) {
	if (isThruHole(pad)) {
		return isVisible(layerState, "F.Cu") || isVisible(layerState, "B.Cu");
	}
	const layer = isBack ? "B.Cu" : "F.Cu";
	return isVisible(layerState, layer);
}

const PAD_FLIP = { x: " scale(-1 1)", y: " scale(1 -1)" };

// SVG transform from a pad's own frame (padOutline's) to the board.
function padFrame(pad) {
	const [cx, cy] = pad.center;
	const flip = PAD_FLIP[pad.mirror] ?? "";
	return `translate(${cx} ${cy}) rotate(${pad.rot || 0})${flip}`;
}

// A polygon grown by r: round-joined stroke 2r wide, as the copper is.
function PadPolygon({ pts, r = 0, color, fill = color, transform }) {
	return (
		<polygon
			points={pts.map((p) => `${p[0]},${p[1]}`).join(" ")}
			transform={transform}
			fill={fill}
			stroke={color}
			strokeWidth={2 * r}
			strokeLinejoin="round"
		/>
	);
}

function PadPrimitive({ p, color }) {
	const fill = p.fill ? color : "none";
	const r = p.width / 2;
	if (p.type === "line")
		return <GraphicLine g={p} color={color} width={p.width} />;
	if (p.type === "arc")
		return <GraphicArc g={p} color={color} width={p.width} />;
	if (p.type === "circle") {
		const [cx, cy] = p.center;
		return (
			<circle
				cx={cx}
				cy={cy}
				r={p.radius}
				fill={fill}
				stroke={color}
				strokeWidth={p.width}
			/>
		);
	}
	const [s, e] = [p.start, p.end];
	const pts = p.pts ?? [s, [e[0], s[1]], e, [s[0], e[1]]];
	return <PadPolygon pts={pts} r={r} color={color} fill={fill} />;
}

// A custom pad: its anchor and every primitive, in the pad's frame.
function CustomPadShape({ pad, color }) {
	const [w, h] = pad.size;
	const anchor =
		pad.anchor === "circle" ? (
			<circle r={w / 2} fill={color} />
		) : (
			<rect x={-w / 2} y={-h / 2} width={w} height={h} fill={color} />
		);
	return (
		<g transform={padFrame(pad)}>
			{anchor}
			{(pad.primitives ?? []).map((p) => (
				<PadPrimitive key={getGraphicKey(p)} p={p} color={color} />
			))}
		</g>
	);
}

function PadShapeElement({ pad, color, rot }) {
	const [cx, cy] = pad.center;
	const [w, h] = pad.size;
	if (pad.shape === "circle") {
		return <circle cx={cx} cy={cy} r={w / 2} fill={color} />;
	}
	if (pad.shape === "custom") return <CustomPadShape pad={pad} color={color} />;
	const { pts, r: rx } = padOutline(pad);
	if (pts.length > 4 || pad.shape === "trapezoid") {
		return (
			<PadPolygon pts={pts} r={rx} color={color} transform={padFrame(pad)} />
		);
	}

	return (
		<rect
			x={cx - w / 2}
			y={cy - h / 2}
			width={w}
			height={h}
			rx={rx}
			fill={color}
			transform={rot}
		/>
	);
}

function calcDrillRadius(pad) {
	if (!isThruHole(pad)) return 0;
	if (pad.drill) return pad.drill / 2;
	const minDim = Math.min(pad.size[0], pad.size[1]);
	return minDim * 0.25 || 0.4;
}

function FootprintPad({ pad, isBack, layerState }) {
	if (!isPadVisible(pad, isBack, layerState)) return null;
	const isThru = isThruHole(pad);
	const color = isThru
		? PCB_THEME.padThrough
		: getLayerColor(PCB_THEME, isBack ? "B.Cu" : "F.Cu");
	const [cx, cy] = pad.center;
	const rot = pad.rot ? `rotate(${pad.rot} ${cx} ${cy})` : undefined;
	const drillR = calcDrillRadius(pad);
	const fontSize = Math.min(pad.size[0], pad.size[1]) * 0.35;
	return (
		<g>
			<PadShapeElement pad={pad} color={color} rot={rot} />
			{isThru && (
				<circle cx={cx} cy={cy} r={drillR} fill={PCB_THEME.background} />
			)}
			<text
				x={cx}
				y={cy}
				textAnchor="middle"
				dominantBaseline="central"
				fill="#ffffff"
				fontSize={fontSize}
				style={{ pointerEvents: "none", userSelect: "none" }}
			>
				{pad.number}
			</text>
		</g>
	);
}

function getGraphicKey(g) {
	if (g.type === "circle") {
		return `${g.type}_${g.layer}_${g.center[0]}_${g.center[1]}_${g.radius}`;
	}
	if (g.type === "poly") {
		return `${g.type}_${g.layer}_${g.pts?.[0]?.[0]}_${g.pts?.[0]?.[1]}`;
	}
	if (g.start && g.end) {
		return `${g.type}_${g.layer}_${g.start[0]}_${g.start[1]}_${g.end[0]}_${g.end[1]}`;
	}
	return `${g.type}_${g.layer}`;
}

function FootprintShape({ fp, part, rect, isSelected, layerState }) {
	const prims = useMemo(
		() =>
			transformPrimitives(
				footprintToPrimitives(fp),
				placementFor(fp, part.placement),
			),
		[fp, part.placement],
	);
	const label = refLabelPlacement(fp, part.placement);
	const isBack = rect.side === "B";
	const rot = partRotation(rect);
	return (
		<g style={{ cursor: "move" }}>
			{isSelected && (
				<rect
					x={rect.x - rect.w / 2}
					y={rect.y - rect.h / 2}
					width={rect.w}
					height={rect.h}
					fill="rgba(250, 219, 20, 0.15)"
					stroke="#fadb14"
					strokeWidth={0.5}
					strokeDasharray="1,1"
					rx={0.2}
					transform={rot}
				/>
			)}
			{prims.graphics.map((g) => (
				<FootprintGraphic
					key={getGraphicKey(g)}
					graphic={g}
					layerState={layerState}
				/>
			))}
			{prims.pads.map((pad, i) => (
				<FootprintPad
					// biome-ignore lint/suspicious/noArrayIndexKey: pads keep file order; numbers repeat (MP) or are empty
					key={`pad_${i}_${pad.number}`}
					pad={pad}
					isBack={isBack}
					layerState={layerState}
				/>
			))}
			{!fp.refLabel?.hide && <PartRefLabel rect={rect} label={label} />}
		</g>
	);
}

// While routing, a click on a part (its pads) bubbles to the router instead of selecting.
function handlePartClick(e, partId, isRouting, onSelectPart) {
	if (isRouting) return;
	e.stopPropagation();
	onSelectPart(partId);
}

// Keyboard focus ring: a fixed screen-pixel stroke, so it does not grow with zoom.
function PartFocusRing({ rect }) {
	return (
		<rect
			x={rect.x - rect.w / 2}
			y={rect.y - rect.h / 2}
			width={rect.w}
			height={rect.h}
			fill="none"
			stroke="#38bdf8"
			strokeWidth={1.5}
			vectorEffect="non-scaling-stroke"
			transform={partRotation(rect)}
			pointerEvents="none"
		/>
	);
}

const PART_G_STYLE = Object.freeze({ outline: "none" });

function isPartShown(rect, layerState) {
	if (!rect) return false;
	return isVisible(layerState, rect.side === "B" ? "B.SilkS" : "F.SilkS");
}

function PartItem({
	part,
	isSelected,
	layerState,
	onSelectPart,
	onStartDrag,
	fp,
	isRouting,
}) {
	const [focused, setFocused] = useState(false);
	const rect = footprintRect(part);
	if (!isPartShown(rect, layerState)) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG elements cannot be replaced with HTML button
		<g
			role="button"
			tabIndex={0}
			aria-label={`Part ${rect.ref}`}
			style={PART_G_STYLE}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onClick={(e) => handlePartClick(e, part.id, isRouting, onSelectPart)}
			onKeyDown={(e) => handlePartKey(e, part.id, onSelectPart)}
			onPointerDown={(e) => !isRouting && onStartDrag(e, part)}
		>
			{focused && <PartFocusRing rect={rect} />}
			{fp ? (
				<FootprintShape
					fp={fp}
					part={part}
					rect={rect}
					isSelected={isSelected}
					layerState={layerState}
				/>
			) : (
				<PartShape rect={rect} isSelected={isSelected} />
			)}
		</g>
	);
}

function PartsLayer({
	parts,
	layer,
	selectedId,
	layerState,
	onSelectPart,
	onStartDrag,
	fpLookup,
	isRouting,
}) {
	if (!Array.isArray(parts)) return null;
	const isSilk = layer === "F.SilkS" || layer === "B.SilkS";
	if (!isSilk) return null;
	const targetSide = layer === "B.SilkS" ? "B" : "F";
	const filtered = parts.filter((p) => {
		const rect = footprintRect(p);
		return rect && (rect.side === "B" ? "B" : "F") === targetSide;
	});
	if (filtered.length === 0) return null;
	return (
		<g className={`pcb-parts-${layer}`}>
			{filtered.map((p) => (
				<PartItem
					key={p.id}
					part={p}
					isSelected={selectedId === p.id}
					layerState={layerState}
					onSelectPart={onSelectPart}
					onStartDrag={onStartDrag}
					fp={fpLookup?.(p)}
					isRouting={isRouting}
				/>
			))}
		</g>
	);
}

function RatsnestLayer({ lines }) {
	if (!Array.isArray(lines)) return null;
	return (
		<g className="pcb-ratsnest" style={{ pointerEvents: "none" }}>
			{lines.map((l) => (
				<line
					key={`rn_${l.netId}_${l.from.x}_${l.from.y}_${l.to.x}_${l.to.y}`}
					x1={l.from.x}
					y1={l.from.y}
					x2={l.to.x}
					y2={l.to.y}
					stroke={PCB_THEME.ratsnest}
					strokeWidth={0.2}
					strokeDasharray="1,1"
				/>
			))}
		</g>
	);
}

function RoutingCollisionTip({ collision }) {
	const [x, y] = collision.at ?? [0, 0];
	const text = collision.message;
	const w = Math.max(22, text.length * 0.72 + 2);
	return (
		<g
			className="pcb-collision-tooltip"
			transform={`translate(${x + 1}, ${y - 3})`}
		>
			<rect
				x={0}
				y={0}
				width={w}
				height={4}
				fill="#1e1e2e"
				stroke="#ef4444"
				strokeWidth={0.2}
				rx={0.6}
			/>
			<text x={1} y={2.6} fill="#f87171" fontSize={1.2} fontWeight={600}>
				{text}
			</text>
		</g>
	);
}

function RoutingProposedSegment({ p1, p2, isColliding, color, widthMm }) {
	const stroke = isColliding ? "#ef4444" : color;
	return (
		<line
			x1={p1[0]}
			y1={p1[1]}
			x2={p2[0]}
			y2={p2[1]}
			stroke={stroke}
			strokeWidth={widthMm}
			strokeDasharray={isColliding ? "1,0.5" : undefined}
			strokeLinecap="round"
		/>
	);
}

function hasPreviewPoints(points) {
	return Array.isArray(points) && points.length > 0;
}

function hasProposedPoints(proposed) {
	return Array.isArray(proposed?.points) && proposed.points.length > 1;
}

function hasPreviewContent(points, proposed) {
	return hasPreviewPoints(points) || hasProposedPoints(proposed);
}

function RoutingSegments({ points, color, widthMm }) {
	return routePreviewLegs(points).map((leg) => (
		<RoutingProposedSegment
			key={leg.key}
			p1={leg.p1}
			p2={leg.p2}
			isColliding={false}
			color={color}
			widthMm={widthMm}
		/>
	));
}

function ProposedSegments({ points, collisions, color, widthMm }) {
	return points.slice(1).map((pt, i) => {
		const prev = points[i];
		const isColliding = collisions.some((c) => c.segmentIndex === i);
		return (
			<RoutingProposedSegment
				// biome-ignore lint/suspicious/noArrayIndexKey: the leg index is its identity (collision segmentIndex)
				key={`prop_${i}`}
				p1={prev}
				p2={pt}
				isColliding={isColliding}
				color={color}
				widthMm={widthMm}
			/>
		);
	});
}

function RoutingPreviewLayer({
	points,
	proposed,
	activeLayer,
	widthMm = 0.25,
}) {
	if (!hasPreviewContent(points, proposed)) return null;
	const color = getLayerColor(PCB_THEME, activeLayer);
	const collisions = proposed?.collisions ?? [];
	return (
		<g className="pcb-routing-preview" style={{ pointerEvents: "none" }}>
			{hasPreviewPoints(points) && (
				<RoutingSegments points={points} color={color} widthMm={widthMm} />
			)}
			{hasProposedPoints(proposed) && (
				<ProposedSegments
					points={proposed.points}
					collisions={collisions}
					color={color}
					widthMm={widthMm}
				/>
			)}
			{collisions.map((c) => (
				<RoutingCollisionTip
					key={`col_${c.segmentIndex}_${c.at[0]}_${c.at[1]}`}
					collision={c}
				/>
			))}
		</g>
	);
}

function ToolbarButton({ label, value, shortcut, onClick, color }) {
	const strongStyle = color ? { color } : undefined;
	return (
		<button
			type="button"
			aria-label={`${label} (${shortcut})`}
			onClick={onClick}
			style={TOOL_BUTTON_STYLE}
		>
			{label}: <strong style={strongStyle}>{value}</strong> ({shortcut})
		</button>
	);
}

function PcbToolbar({
	activeLayer,
	isRouting,
	onToggleLayer,
	onToggleRoute,
	widthPreset,
	onCycleWidth,
	routeMode,
	onToggleRouteMode,
}) {
	return (
		<div style={TOOLBAR_STYLE}>
			<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
				<ToolbarButton
					label="Active"
					value={activeLayer}
					color={getLayerColor(PCB_THEME, activeLayer)}
					shortcut="V"
					onClick={onToggleLayer}
				/>
				<button
					type="button"
					aria-label="Toggle route track (X)"
					onClick={onToggleRoute}
					style={{
						...TOOL_BUTTON_STYLE,
						borderColor: isRouting ? "#fadb14" : "#334155",
					}}
				>
					{isRouting ? "Routing... [Double-click to End]" : "Route Track (X)"}
				</button>
				<ToolbarButton
					label="Width"
					value={widthPreset?.label ?? "0.25 mm"}
					shortcut="W"
					onClick={onCycleWidth}
				/>
				<ToolbarButton
					label="Angle"
					value={`${routeMode ?? "45"}°`}
					shortcut="/"
					onClick={onToggleRouteMode}
				/>
			</div>
		</div>
	);
}

function PcbStatusBar({ isRouting, widthPreset, routeMode, posture }) {
	return (
		<div style={STATUS_BAR_STYLE}>
			<span>
				Width:{" "}
				<strong style={{ color: "#f1f5f9" }}>{widthPreset?.label}</strong> (
				{widthPreset?.hint}) [W] | Mode:{" "}
				<strong style={{ color: "#f1f5f9" }}>
					{routeMode}° {posture}
				</strong>{" "}
				[/, Ctrl+/]
			</span>
			<span>
				{isRouting
					? "Routing: Click to route (Shift to bypass DRC), V for via, Double-click to end"
					: "Ready: Press X to route, V to toggle layer"}
			</span>
		</div>
	);
}

function dragDelta(drag, curPt) {
	return [curPt[0] - drag.startPos[0], curPt[1] - drag.startPos[1]];
}

function calcDropPos(drag, curPt) {
	const [dx, dy] = dragDelta(drag, curPt);
	return snapToGrid([drag.origPos[0] + dx, drag.origPos[1] + dy], 0.25);
}

function createPartDrag(e, part, svgEl, view) {
	if (e.button !== 0 || !part.placement) return null;
	const [x, y] = screenToBoardCoords(e, svgEl, view);
	return {
		partId: part.id,
		startPos: [x, y],
		origPos: [part.placement.x, part.placement.y],
		moved: false,
	};
}

function checkDragMoved(drag, curPt) {
	const [dx, dy] = dragDelta(drag, curPt);
	if (Math.hypot(dx, dy) > 0.4) drag.moved = true;
}

function usePartDrag(editor, svgRef, view) {
	const dragRef = useRef(null);

	const onStartDrag = useCallback(
		(e, part) => {
			dragRef.current = createPartDrag(e, part, svgRef.current, view);
		},
		[svgRef, view],
	);

	const onDropDrag = useCallback(
		(e) => {
			const drag = dragRef.current;
			dragRef.current = null;
			if (!drag?.moved) return;
			const [x, y] = calcDropPos(
				drag,
				screenToBoardCoords(e, svgRef.current, view),
			);
			editor.dispatch({ type: "movePart", partId: drag.partId, x, y });
		},
		[editor, svgRef, view],
	);

	const onPointerMove = useCallback(
		(e) => {
			if (dragRef.current) {
				checkDragMoved(
					dragRef.current,
					screenToBoardCoords(e, svgRef.current, view),
				);
			}
		},
		[svgRef, view],
	);

	return { onStartDrag, onDropDrag, onPointerMove };
}

function checkGraphicDragStart(e, { isArmed, isRouting, board, svgEl, view }) {
	if (isArmed || isRouting || e.button !== 0) return null;
	const [x, y] = screenToBoardCoords(e, svgEl, view);
	const hitId = hitTestGraphic(board?.graphics, [x, y]);
	return hitId ? { id: hitId, startPos: [x, y], moved: false } : null;
}

function commitGraphicDrop(drag, e, { board, pushBoard, svgEl, view }) {
	if (!drag?.moved) return false;
	const curPt = screenToBoardCoords(e, svgEl, view);
	const [rawDx, rawDy] = dragDelta(drag, curPt);
	const grid = getEditorStatus()?.grid || 0.25;
	const dx = Math.round(rawDx / grid) * grid;
	const dy = Math.round(rawDy / grid) * grid;
	if (dx !== 0 || dy !== 0) {
		pushBoard(moveGraphic(board, drag.id, dx, dy));
		return true;
	}
	return false;
}

function useGraphicDrag({
	board,
	pushBoard,
	svgRef,
	view,
	isArmed,
	isRouting,
}) {
	const dragRef = useRef(null);
	const onPointerDown = useCallback(
		(e) => {
			const drag = checkGraphicDragStart(e, {
				isArmed,
				isRouting,
				board,
				svgEl: svgRef.current,
				view,
			});
			if (drag) {
				dragRef.current = drag;
				return true;
			}
			return false;
		},
		[board, isArmed, isRouting, svgRef, view],
	);
	const onPointerMove = useCallback(
		(e) => {
			if (!dragRef.current) return false;
			checkDragMoved(
				dragRef.current,
				screenToBoardCoords(e, svgRef.current, view),
			);
			return true;
		},
		[svgRef, view],
	);
	const onPointerUp = useCallback(
		(e) => {
			const drag = dragRef.current;
			dragRef.current = null;
			return commitGraphicDrop(drag, e, {
				board,
				pushBoard,
				svgEl: svgRef.current,
				view,
			});
		},
		[board, pushBoard, svgRef, view],
	);
	return { onPointerDown, onPointerMove, onPointerUp };
}

function findPinNet(nets, partId, pinNum) {
	for (const net of nets ?? []) {
		for (const pin of net.pins ?? []) {
			if (pin.partId === partId && String(pin.pin) === String(pinNum)) {
				return net.id ?? net.name ?? "";
			}
		}
	}
	return "";
}

function findPadNet(ir, padPositions, pt, tol = 1.0) {
	const hit = findNearPad(ir?.parts, padPositions, pt, tol);
	return hit ? findPinNet(ir?.nets, hit.partId, hit.pinNum) : "";
}

function findTrackNet(tracks, pt, tol = 1.0) {
	return findNearTrack(tracks, pt, tol)?.track?.netId ?? "";
}

function detectNetAtPoint(ir, board, pt, padPositions) {
	return (
		findPadNet(ir, padPositions, pt) || findTrackNet(board?.tracks, pt) || ""
	);
}

// Start snaps to a track end, pad or part centre; a later click snaps to a pad centre.
function resolveRouteTarget(raw, hasPoints, snapCtx) {
	const snapped = snapToGrid(raw, 0.25);
	if (!hasPoints) return findSnapEndpoint(snapped, snapCtx);
	return findPadSnap(snapCtx.ir?.parts, snapCtx.padPositions, raw) ?? snapped;
}

function executeViaPlacement(viaCtx) {
	const {
		board,
		activeLayer,
		points,
		cursorPos,
		widthMm,
		netId,
		routeMode,
		posture,
		pushBoard,
		toggleLayer,
		setPoints,
	} = viaCtx;

	const start = points[points.length - 1] ?? cursorPos ?? [0, 0];
	const target = cursorPos ?? start;
	const cornerPts =
		points.length > 0 ? legPoints(start, target, routeMode, posture) : [];
	const fullPoints = points.length > 0 ? [...points, ...cornerPts] : [start];
	const viaAt = fullPoints[fullPoints.length - 1];

	let nextBoard = board;
	if (fullPoints.length >= 2) {
		nextBoard = addTrack(nextBoard, {
			netId,
			layer: activeLayer,
			points: fullPoints,
			widthMm,
		});
	}
	nextBoard = addVia(nextBoard, {
		at: viaAt,
		netId,
		drillMm: 0.3,
		sizeMm: 0.6,
	});
	pushBoard(nextBoard);
	toggleLayer();
	setPoints([viaAt]);
}

function checkCommitAllowed(routeCtx, target, isShiftHeld) {
	const { points, activeLayer, widthMm, board, currentNetId, routeMode } =
		routeCtx;
	if (points.length === 0 || isShiftHeld) return true;
	const start = points[points.length - 1];
	const prop = proposePostureRoute(
		{
			start,
			cursor: target,
			layer: activeLayer,
			widthMm,
			clearanceMm: 0.2,
			board,
			pads: routeCtx.pads,
			netId: currentNetId,
			mode: routeMode,
		},
		routeCtx.posture,
	);
	return prop.collisions.length === 0;
}

function useRoutePreset() {
	const [presetIdx, setPresetIdx] = useState(0);
	const widthPreset = WIDTH_PRESETS[presetIdx];
	const cycleWidthPreset = useCallback(() => {
		setPresetIdx((i) => (i + 1) % WIDTH_PRESETS.length);
	}, []);
	return { widthPreset, widthMm: widthPreset.mm, cycleWidthPreset };
}

function useRouteMode() {
	const [routeMode, setRouteMode] = useState("45");
	const toggleRouteMode = useCallback(() => {
		setRouteMode((m) => (m === "45" ? "90" : "45"));
	}, []);
	const [posture, setPosture] = useState("straight-first");
	const togglePostureMode = useCallback(() => {
		setPosture((p) => togglePosture(p));
	}, []);
	return { routeMode, toggleRouteMode, posture, togglePostureMode };
}

function useRouteSession() {
	const [isRouting, setIsRouting] = useState(false);
	const [points, setPoints] = useState([]);
	const [cursorPos, setCursorPos] = useState(null);
	const [currentNetId, setCurrentNetId] = useState("");

	const toggleRoute = useCallback(() => {
		setIsRouting((r) => !r);
		setPoints([]);
		setCurrentNetId("");
		setCursorPos(null);
	}, []);

	const resetSession = useCallback(() => {
		setPoints([]);
		setIsRouting(false);
		setCurrentNetId("");
	}, []);

	return {
		isRouting,
		points,
		setPoints,
		cursorPos,
		setCursorPos,
		currentNetId,
		setCurrentNetId,
		toggleRoute,
		resetSession,
	};
}

function useRouteProposed({
	isRouting,
	points,
	cursorPos,
	activeLayer,
	widthMm,
	board,
	currentNetId,
	routeMode,
	posture,
	pads,
	netNames,
}) {
	return useMemo(() => {
		if (!isRouting || points.length === 0 || !cursorPos) {
			return { points: [], collisions: [] };
		}
		return proposePostureRoute(
			{
				start: points[points.length - 1],
				cursor: cursorPos,
				layer: activeLayer,
				widthMm,
				clearanceMm: 0.2,
				board,
				pads,
				netId: currentNetId,
				mode: routeMode,
				netNames,
			},
			posture,
		);
	}, [
		isRouting,
		points,
		cursorPos,
		activeLayer,
		widthMm,
		board,
		currentNetId,
		routeMode,
		posture,
		pads,
		netNames,
	]);
}

function useRouteClick({
	session,
	board,
	ir,
	padPositions,
	activeLayer,
	widthMm,
	routeMode,
	posture,
	pads,
	svgRef,
	view,
}) {
	const { isRouting, points, currentNetId, setCurrentNetId, setPoints } =
		session;
	return useCallback(
		(e) => {
			if (!isRouting) return;
			const raw = screenToBoardCoords(e, svgRef.current, view);
			const target = resolveRouteTarget(raw, points.length > 0, {
				board,
				ir,
				padPositions,
			});
			if (points.length === 0) {
				setCurrentNetId(detectNetAtPoint(ir, board, target, padPositions));
				setPoints([target]);
				return;
			}
			// A route started off-net takes the net of the pad it finishes on.
			const netId =
				currentNetId || detectNetAtPoint(ir, board, target, padPositions);
			setCurrentNetId(netId);
			const routeCtx = {
				points,
				activeLayer,
				widthMm,
				board,
				currentNetId: netId,
				routeMode,
				posture,
				pads,
			};
			if (!checkCommitAllowed(routeCtx, target, e.shiftKey)) return;
			const legs = legPoints(points.at(-1), target, routeMode, posture);
			setPoints((prev) => [...prev, ...legs]);
		},
		[
			isRouting,
			points,
			currentNetId,
			board,
			ir,
			padPositions,
			activeLayer,
			widthMm,
			routeMode,
			posture,
			pads,
			svgRef,
			view,
			setCurrentNetId,
			setPoints,
		],
	);
}

function useRouteDoubleClick({
	session,
	board,
	activeLayer,
	widthMm,
	pushBoard,
}) {
	const { isRouting, points, currentNetId, resetSession } = session;
	return useCallback(
		(e) => {
			e.preventDefault();
			if (!isRouting || points.length < 2) return;
			pushBoard(
				addTrack(board, {
					netId: currentNetId,
					layer: activeLayer,
					points,
					widthMm,
				}),
			);
			resetSession();
		},
		[
			isRouting,
			points,
			currentNetId,
			board,
			activeLayer,
			widthMm,
			pushBoard,
			resetSession,
		],
	);
}

function useRoutePointer({ session, svgRef, view }) {
	const { isRouting, setCursorPos } = session;
	return useCallback(
		(e) => {
			if (!isRouting) return;
			const raw = screenToBoardCoords(e, svgRef.current, view);
			setCursorPos(snapToGrid(raw, 0.25));
		},
		[isRouting, setCursorPos, svgRef, view],
	);
}

function useRouteVia({
	session,
	board,
	activeLayer,
	widthMm,
	routeMode,
	posture,
	pushBoard,
	toggleLayer,
}) {
	const { isRouting, points, cursorPos, currentNetId, setPoints } = session;
	return useCallback(() => {
		if (!isRouting) return;
		executeViaPlacement({
			board,
			activeLayer,
			points,
			cursorPos,
			widthMm,
			netId: currentNetId,
			routeMode,
			posture,
			pushBoard,
			toggleLayer,
			setPoints,
		});
	}, [
		isRouting,
		board,
		activeLayer,
		points,
		cursorPos,
		widthMm,
		currentNetId,
		routeMode,
		posture,
		pushBoard,
		toggleLayer,
		setPoints,
	]);
}

function useRouteHandlers(session, routingProps) {
	const {
		board,
		activeLayer,
		widthMm,
		routeMode,
		posture,
		pushBoard,
		toggleLayer,
		svgRef,
		ir,
		padPositions,
		pads,
		view,
	} = routingProps;
	const onCanvasClick = useRouteClick({
		session,
		board,
		ir,
		padPositions,
		activeLayer,
		widthMm,
		routeMode,
		posture,
		pads,
		svgRef,
		view,
	});
	const onCanvasDoubleClick = useRouteDoubleClick({
		session,
		board,
		activeLayer,
		widthMm,
		pushBoard,
	});
	const onPointerMove = useRoutePointer({ session, svgRef, view });
	const placeViaAndSwitchLayer = useRouteVia({
		session,
		board,
		activeLayer,
		widthMm,
		routeMode,
		posture,
		pushBoard,
		toggleLayer,
	});
	return {
		onCanvasClick,
		onCanvasDoubleClick,
		onPointerMove,
		placeViaAndSwitchLayer,
	};
}

function useRoutingState(props) {
	const session = useRouteSession();
	const { routeMode, toggleRouteMode, posture, togglePostureMode } =
		useRouteMode();
	const { widthPreset, widthMm, cycleWidthPreset } = useRoutePreset();

	const proposedRoute = useRouteProposed({
		isRouting: session.isRouting,
		points: session.points,
		cursorPos: session.cursorPos,
		activeLayer: props.activeLayer,
		widthMm,
		board: props.board,
		currentNetId: session.currentNetId,
		routeMode,
		posture,
		pads: props.pads,
		netNames: props.netNames,
	});

	const handlers = useRouteHandlers(session, {
		...props,
		widthMm,
		routeMode,
		posture,
	});

	return {
		isRouting: session.isRouting,
		points: session.points,
		cursorPos: session.cursorPos,
		routeMode,
		posture,
		togglePostureMode,
		widthPreset,
		widthMm,
		proposedRoute,
		...handlers,
		toggleRoute: session.toggleRoute,
		cancelRoute: session.resetSession,
		toggleRouteMode,
		cycleWidthPreset,
	};
}

function deleteFromBoard(board, target) {
	const {
		selectedGraphicId,
		selectedTrackIndex,
		selectedPartId,
		pushBoard,
		editor,
	} = target;
	if (selectedGraphicId !== null) {
		pushBoard(deleteGraphic(board, selectedGraphicId));
	} else if (selectedTrackIndex !== null) {
		pushBoard(deleteTrack(board, selectedTrackIndex));
	} else if (selectedPartId) {
		editor.dispatch({ type: "deletePart", partId: selectedPartId });
	}
}

function applySelectHit(hit, setters) {
	const { editor, setSelectedTrackIndex, setSelectedGraphicId } = setters;
	if (hit?.kind === "graphic") {
		setSelectedGraphicId(hit.id);
		setSelectedTrackIndex(null);
		editor.dispatch({ type: "select", ids: [] });
	} else if (hit?.kind === "part") {
		editor.dispatch({ type: "select", ids: [hit.id] });
		setSelectedTrackIndex(null);
		setSelectedGraphicId(null);
	} else if (hit?.kind === "track") {
		setSelectedTrackIndex(hit.index);
		setSelectedGraphicId(null);
		editor.dispatch({ type: "select", ids: [] });
	} else {
		editor.dispatch({ type: "select", ids: [] });
		setSelectedTrackIndex(null);
		setSelectedGraphicId(null);
	}
}

function useCanvasSelection(editor, board, pushBoard, onChange) {
	const [selectedTrackIndex, setSelectedTrackIndex] = useState(null);
	const [selectedGraphicId, setSelectedGraphicId] = useState(null);
	const selectedPartId = editor?.selection?.[0] ?? null;

	const deleteSelected = useCallback(() => {
		deleteFromBoard(board, {
			selectedGraphicId,
			selectedTrackIndex,
			selectedPartId,
			pushBoard,
			editor,
		});
		if (selectedGraphicId !== null) setSelectedGraphicId(null);
		else if (selectedTrackIndex !== null) setSelectedTrackIndex(null);
	}, [
		selectedGraphicId,
		selectedTrackIndex,
		selectedPartId,
		board,
		pushBoard,
		editor,
	]);

	const onSelectHit = useCallback(
		(hit) => {
			applySelectHit(hit, {
				editor,
				setSelectedTrackIndex,
				setSelectedGraphicId,
			});
			onChange?.(editor.state);
		},
		[editor, onChange],
	);

	return {
		selectedTrackIndex,
		selectedPartId,
		selectedGraphicId,
		deleteSelected,
		onSelectHit,
	};
}

function fetchSingleFootprint(fpId, fetchFootprint, pendingRef, setCache) {
	pendingRef.current.add(fpId);
	fetchFootprint(fpId)
		.then((fp) => {
			pendingRef.current.delete(fpId);
			setCache((prev) => ({ ...prev, [fpId]: fp ?? null }));
		})
		.catch(() => {
			pendingRef.current.delete(fpId);
			setCache((prev) => ({ ...prev, [fpId]: null }));
		});
}

// Lazy: nothing is fetched until the PCB view is shown; a cached null is a
// known miss and is never fetched again.
function useFootprintCache(parts, embedded, fetchFootprint, visible) {
	const [cache, setCache] = useState({});
	const pendingRef = useRef(new Set());

	useEffect(() => {
		if (!fetchFootprint) return;
		const ids = footprintIdsToFetch(parts, {
			visible,
			embedded,
			cache,
			pending: pendingRef.current,
		});
		for (const fpId of ids) {
			fetchSingleFootprint(fpId, fetchFootprint, pendingRef, setCache);
		}
	}, [parts, embedded, fetchFootprint, cache, visible]);

	return cache;
}

function partFpId(part) {
	return part.footprint ?? part.props?.footprint;
}

// A board file embeds every placed footprint; fetch from the library only the rest.
function usePadGeometry(parts, board, fetchFootprint, visible) {
	const embedded = board?.footprints;
	const fpCache = useFootprintCache(parts, embedded, fetchFootprint, visible);
	const fpLookup = useCallback(
		(p) => embedded?.[p.id] ?? fpCache[partFpId(p)] ?? null,
		[embedded, fpCache],
	);
	return useMemo(
		() => ({
			fpLookup,
			padPositions: boardPadPositions(parts, fpLookup),
			padRadius: boardPadRadii(parts, fpLookup),
			missingFootprints: missingFootprintIds(parts, embedded, fpCache).length,
		}),
		[parts, fpLookup, embedded, fpCache],
	);
}

const FOOTPRINT_NOTE_STYLE = Object.freeze({
	position: "absolute",
	left: 12,
	bottom: 40,
	fontSize: 11,
	color: "#94a3b8",
	pointerEvents: "none",
});

// Quiet note for library footprints that could not be loaded (drawn as outlines).
function FootprintMissNote({ count }) {
	if (!count) return null;
	return (
		<div style={FOOTPRINT_NOTE_STYLE} role="status">
			{count} footprint{count === 1 ? "" : "s"} not in the installed footprint
			library; drawn as outlines
		</div>
	);
}

// Keyboard shortcuts work as soon as a board is shown, without a click first.
function useFocusOnShow(containerRef, visible, hasBoard) {
	useEffect(() => {
		if (visible && hasBoard)
			containerRef.current?.focus({ preventScroll: true });
	}, [containerRef, visible, hasBoard]);
}

function focusCanvas(containerRef) {
	if (typeof document === "undefined") return;
	if (isTextInput(document.activeElement)) return;
	containerRef?.current?.focus({ preventScroll: true });
}

function useCanvasAutoFocus(containerRef, _tab) {
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const handlePointerEnter = () => focusCanvas(containerRef);
		el.addEventListener("pointerenter", handlePointerEnter);
		return () => el.removeEventListener("pointerenter", handlePointerEnter);
	}, [containerRef]);
}

function useCanvasLayers(board) {
	const [layerState, setLayerState] = useState(() =>
		createLayerState({ copperCount: board?.copperCount ?? 2 }),
	);
	const toggleLayer = useCallback(
		() => setLayerState((s) => stepCopper(s, 1)),
		[],
	);
	const onToggleVisible = useCallback(
		(layer) => setLayerState((s) => toggleVisible(s, layer)),
		[],
	);
	const onSetActive = useCallback(
		(layer) => setLayerState((s) => setActive(s, layer)),
		[],
	);
	const onStepCopper = useCallback(
		(dir) => setLayerState((s) => stepCopper(s, dir)),
		[],
	);
	const onJumpCopper = useCallback(
		(which) => setLayerState((s) => jumpCopper(s, which)),
		[],
	);
	return {
		layerState,
		setLayerState,
		toggleLayer,
		onToggleVisible,
		onSetActive,
		onStepCopper,
		onJumpCopper,
	};
}

function usePointerDownHandler({
	route,
	sel,
	ir,
	board,
	svgRef,
	view,
	isArmed,
}) {
	return useCallback(
		(e) => {
			if (e.button !== 0) return;
			if (route.isRouting || isArmed) return;
			const [x, y] = screenToBoardCoords(e, svgRef.current, view);
			const graphicId = hitTestGraphic(board?.graphics, [x, y]);
			if (graphicId) {
				sel.onSelectHit({ kind: "graphic", id: graphicId });
				return;
			}
			sel.onSelectHit(hitTest(ir, board, [x, y]));
		},
		[route.isRouting, isArmed, ir, board, sel, svgRef, view],
	);
}

function buildShortcuts(ctx) {
	return {
		editor: ctx.editor,
		selectedPartId: ctx.sel.selectedPartId,
		toggleLayer: ctx.layers.toggleLayer,
		toggleRoute: ctx.route.toggleRoute,
		cancelRoute: ctx.route.cancelRoute,
		toggleRouteMode: ctx.route.toggleRouteMode,
		togglePosture: ctx.route.togglePostureMode,
		cycleWidthPreset: ctx.route.cycleWidthPreset,
		placeVia: ctx.route.placeViaAndSwitchLayer,
		armVia: () => {
			if (ctx.route.isRouting) ctx.route.cancelRoute();
			ctx.armedPlacement?.disarm();
			ctx.graphicsDrawing?.arm("placeVia");
		},
		isRouting: ctx.route.isRouting,
		deleteSelected: ctx.sel.deleteSelected,
		undoBoard: ctx.history.undoBoard,
		redoBoard: ctx.history.redoBoard,
		jumpCopper: ctx.layers.onJumpCopper,
		stepCopper: ctx.layers.onStepCopper,
		cancelOutline: ctx.outlineDrawing?.cancelOutline,
		cancelGraphics: ctx.graphicsDrawing?.cancelGraphics,
		disarmFootprint: ctx.armedPlacement?.disarm,
	};
}

function buildSceneData(ctx) {
	return {
		board: ctx.board,
		ir: ctx.ir,
		rnLines: ctx.rnLines,
		selectedPartId: ctx.sel.selectedPartId,
		selectedTrackIndex: ctx.sel.selectedTrackIndex,
		selectedGraphicId: ctx.sel.selectedGraphicId,
		onSelectPart: (id) => ctx.editor.dispatch({ type: "select", ids: [id] }),
		onPointerDown: ctx.onPointerDown,
		fpLookup: ctx.fpLookup,
		isRouting:
			ctx.isRouting ||
			Boolean(ctx.armedPlacement?.armed) ||
			Boolean(ctx.graphicsDrawing?.activeTool),
	};
}

// Markers keep one screen size at any zoom, like KiCad's.
function MarkersOverlay({ markers, zoom }) {
	const glyphs = useMemo(
		() => markerGlyphs(markers, { zoom }),
		[markers, zoom],
	);
	if (glyphs.length === 0) return null;
	return (
		<g
			className="pcb-markers"
			pointerEvents="none"
			style={{ pointerEvents: "none" }}
		>
			{glyphs.map((g) => (
				<circle
					key={g.key}
					cx={g.x}
					cy={g.y}
					r={g.r}
					fill={g.color}
					stroke="#ffffff"
					strokeWidth={g.strokeWidth}
				>
					{g.title ? <title>{g.title}</title> : null}
				</circle>
			))}
		</g>
	);
}

function LayerRow({ layer, isActive, visible, onToggleVisible, onSetActive }) {
	const color = getLayerColor(PCB_THEME, layer);
	const rowStyle = {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		padding: "2px 4px",
		borderRadius: "3px",
		cursor: "pointer",
		background: isActive ? "rgba(56, 189, 248, 0.25)" : "transparent",
		fontWeight: isActive ? 600 : "normal",
	};
	return (
		// biome-ignore lint/a11y/useSemanticElements: Layer row with click to activate
		<div
			style={rowStyle}
			role="button"
			tabIndex={0}
			aria-label={`Activate layer ${layer}`}
			onClick={() => onSetActive(layer)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSetActive(layer);
				}
			}}
		>
			<input
				type="checkbox"
				checked={visible}
				aria-label={`Toggle visibility for ${layer}`}
				onClick={(e) => e.stopPropagation()}
				onChange={() => onToggleVisible(layer)}
				style={{ cursor: "pointer", margin: 0 }}
			/>
			<span
				style={{
					width: "10px",
					height: "10px",
					borderRadius: "2px",
					backgroundColor: color,
					display: "inline-block",
					flexShrink: 0,
				}}
			/>
			<span
				style={{
					fontSize: "11px",
					color: isActive ? "#ffffff" : "#cbd5e1",
				}}
			>
				{layer}
			</span>
		</div>
	);
}

function LayerListOverlay({ layerState, onToggleVisible, onSetActive }) {
	const layers = useMemo(
		() => [...layerState.copper, ...OVERLAY_EXTRA_LAYERS],
		[layerState.copper],
	);
	return (
		<div style={LAYER_LIST_STYLE} className="pcb-layer-list">
			<div style={LAYER_HEADER_STYLE}>Layers</div>
			{layers.map((layer) => (
				<LayerRow
					key={layer}
					layer={layer}
					isActive={layerState.active === layer}
					visible={isVisible(layerState, layer)}
					onToggleVisible={onToggleVisible}
					onSetActive={onSetActive}
				/>
			))}
		</div>
	);
}

function PcbLayerStack({ order, sceneData, layerState, drag }) {
	return order.map((layer) => (
		<g key={layer} className={`pcb-layer-${layer}`}>
			{layer === "Edge.Cuts" && (
				<EdgeCutsLayer outline={sceneData.board?.outline} />
			)}
			<ZonesLayer zones={sceneData.board?.zones} layer={layer} />
			<TracksLayer
				tracks={sceneData.board?.tracks}
				layer={layer}
				selectedIndex={sceneData.selectedTrackIndex}
			/>
			<BoardGraphicsLayer
				graphics={sceneData.board?.graphics}
				layer={layer}
				selectedId={sceneData.selectedGraphicId}
			/>
			<PartsLayer
				parts={sceneData.ir?.parts}
				layer={layer}
				selectedId={sceneData.selectedPartId}
				layerState={layerState}
				onSelectPart={sceneData.onSelectPart}
				onStartDrag={drag.onStartDrag}
				fpLookup={sceneData.fpLookup}
				isRouting={sceneData.isRouting}
			/>
		</g>
	));
}

function getPointCoord(pt) {
	if (!pt) return null;
	const x = typeof pt.x === "number" ? pt.x : pt[0];
	const y = typeof pt.y === "number" ? pt.y : pt[1];
	if (typeof x !== "number" || typeof y !== "number") return null;
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x, y };
}

export function normalizeOutlineRect(start, current) {
	const p1 = getPointCoord(start);
	const p2 = getPointCoord(current);
	if (!p1 || !p2) return null;
	const w = Math.abs(p2.x - p1.x);
	const h = Math.abs(p2.y - p1.y);
	if (w === 0 || h === 0) return null;
	return {
		x: Math.min(p1.x, p2.x),
		y: Math.min(p1.y, p2.y),
		w,
		h,
	};
}
export const normalizeRect = normalizeOutlineRect;

export function createOutlineShapes(tool, start, current, radius) {
	const rect = normalizeOutlineRect(start, current);
	if (!rect) return null;
	const { x, y, w, h } = rect;
	if (tool === "rounded_rect") {
		return roundedRectOutline(x, y, w, h, radius ?? 1);
	}
	return rectOutline(x, y, w, h);
}

function commitOutline(shapes, board, pushBoard) {
	const res = outlineToPolygon(shapes);
	if (!res.ok) {
		message.error(res.error || "Failed to create board outline");
		return false;
	}
	pushBoard({ ...(board || {}), outline: shapes });
	setOutlineTool({ activeTool: null });
	return true;
}

function OutlinePreview({ drag, activeTool, radius }) {
	if (!drag?.start || !drag?.current || !activeTool) return null;
	const shapes = createOutlineShapes(
		activeTool,
		drag.start,
		drag.current,
		radius,
	);
	if (!shapes) return null;
	const res = outlineToPolygon(shapes);
	if (!res.ok) return null;
	const pts = res.polygon.map(formatPt).filter(Boolean).join(" ");
	const color = getLayerColor(PCB_THEME, "Edge.Cuts");
	return (
		<polygon
			points={pts}
			fill="none"
			stroke={color}
			strokeWidth={0.5}
			strokeDasharray="2,2"
		/>
	);
}

function isLeftClick(e) {
	return e.button === undefined || e.button === 0;
}

function calcSnappedBoardPoint(e, svgEl, view) {
	const raw = screenToBoardCoords(e, svgEl, view);
	const grid = getEditorStatus()?.grid || 0.25;
	const [x, y] = snapToGrid(raw, grid);
	return { x, y };
}

function useOutlinePointerDown({
	outlineTool,
	drag,
	setDrag,
	board,
	pushBoard,
	svgRef,
	view,
}) {
	return useCallback(
		(e) => {
			if (e.button !== 0) return false;
			if (!outlineTool.activeTool) return false;
			const pt = calcSnappedBoardPoint(e, svgRef.current, view);
			if (drag?.start) {
				const shapes = createOutlineShapes(
					outlineTool.activeTool,
					drag.start,
					pt,
					outlineTool.radius,
				);
				if (shapes && commitOutline(shapes, board, pushBoard)) {
					setDrag(null);
					return true;
				}
			}
			setDrag({ start: pt, current: pt });
			return true;
		},
		[outlineTool, drag, board, pushBoard, svgRef, view, setDrag],
	);
}

function useOutlinePointerMove({
	activeTool,
	isDrawing,
	svgRef,
	view,
	setDrag,
}) {
	return useCallback(
		(e) => {
			if (!activeTool || !isDrawing) return false;
			const pt = calcSnappedBoardPoint(e, svgRef.current, view);
			setDrag((prev) => (prev ? { ...prev, current: pt } : null));
			return true;
		},
		[activeTool, isDrawing, svgRef, view, setDrag],
	);
}

function useOutlinePointerUp({
	outlineTool,
	drag,
	setDrag,
	board,
	pushBoard,
	svgRef,
	view,
}) {
	return useCallback(
		(e) => {
			if (e.button !== 0) return false;
			if (!outlineTool.activeTool || !drag?.start) return false;
			const pt = calcSnappedBoardPoint(e, svgRef.current, view);
			const shapes = createOutlineShapes(
				outlineTool.activeTool,
				drag.start,
				pt,
				outlineTool.radius,
			);
			if (shapes && commitOutline(shapes, board, pushBoard)) {
				setDrag(null);
				return true;
			}
			return true;
		},
		[outlineTool, drag, board, pushBoard, svgRef, view, setDrag],
	);
}

function useOutlineCancel(drag, activeTool, setDrag) {
	return useCallback(() => {
		if (drag) {
			setDrag(null);
			return true;
		}
		if (activeTool) {
			setOutlineTool({ activeTool: null });
			return true;
		}
		return false;
	}, [drag, activeTool, setDrag]);
}

function useOutlineDrawing({ board, pushBoard, svgRef, view }) {
	const outlineTool = useOutlineTool();
	const [drag, setDrag] = useState(null);
	useEffect(() => {
		if (!outlineTool.activeTool && drag) {
			setDrag(null);
		}
	}, [outlineTool.activeTool, drag]);
	const onPointerDown = useOutlinePointerDown({
		outlineTool,
		drag,
		setDrag,
		board,
		pushBoard,
		svgRef,
		view,
	});
	const onPointerMove = useOutlinePointerMove({
		activeTool: outlineTool.activeTool,
		isDrawing: Boolean(drag?.start),
		svgRef,
		view,
		setDrag,
	});
	const onPointerUp = useOutlinePointerUp({
		outlineTool,
		drag,
		setDrag,
		board,
		pushBoard,
		svgRef,
		view,
	});
	const cancelOutline = useOutlineCancel(drag, outlineTool.activeTool, setDrag);
	return {
		drag,
		activeTool: outlineTool.activeTool,
		radius: outlineTool.radius,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		cancelOutline,
	};
}

function placeArmedPart({ item, editor, activeLayer, at }) {
	const side = activeLayer === "B.Cu" ? "B" : "F";
	const parts = editor?.state?.ir?.parts ?? [];
	const part = buildPlacedPart(item, parts, { x: at.x, y: at.y, side });
	editor?.dispatch({ type: "addPart", part });
}

function useArmedFootprint({ editor, activeLayer, svgRef, view }) {
	const [armed, setArmed] = useState(null);
	const [cursor, setCursor] = useState(null);
	const disarm = useCallback(() => {
		if (!armed) return false;
		setArmed(null);
		setCursor(null);
		return true;
	}, [armed]);
	const onPointerMove = useCallback(
		(e) => {
			if (armed) setCursor(calcSnappedBoardPoint(e, svgRef.current, view));
		},
		[armed, svgRef, view],
	);
	const onCanvasClick = useCallback(
		(e) => {
			if (!armed || !isLeftClick(e)) return false;
			const at = calcSnappedBoardPoint(e, svgRef.current, view);
			placeArmedPart({ item: armed, editor, activeLayer, at });
			return true;
		},
		[armed, activeLayer, editor, svgRef, view],
	);
	return { armed, setArmed, cursor, disarm, onPointerMove, onCanvasClick };
}

const GRAPHIC_TOOL_KINDS = Object.freeze({
	drawLine: "line",
	drawRect: "rect",
	drawCircle: "circle",
	placeDimension: "dimension",
});

function commitTwoClickGraphic({
	tool,
	p1,
	p2,
	activeLayer,
	board,
	pushBoard,
}) {
	const kind = GRAPHIC_TOOL_KINDS[tool];
	if (!kind) return false;
	pushBoard(
		addGraphic(board, {
			kind,
			layer: activeLayer,
			x: p1.x,
			y: p1.y,
			x2: p2.x,
			y2: p2.y,
		}),
	);
	return true;
}

function handleArcClick({
	pt,
	points,
	activeLayer,
	board,
	pushBoard,
	setPoints,
}) {
	if (points.length === 0) {
		setPoints([pt]);
		return true;
	}
	if (points.length === 1) {
		setPoints([points[0], pt]);
		return true;
	}
	const [p1, pm] = points;
	pushBoard(
		addGraphic(board, {
			kind: "arc",
			layer: activeLayer,
			x: p1.x,
			y: p1.y,
			xm: pm.x,
			ym: pm.y,
			x2: pt.x,
			y2: pt.y,
		}),
	);
	setPoints([]);
	return true;
}

export function chooseViaNet(pads, pt) {
	if (!Array.isArray(pads) || !pt) return "";
	const coords = Array.isArray(pt) ? pt : [pt.x, pt.y];
	for (const pad of pads) {
		if (padHitTest([pad], coords) !== null) {
			return pad.netId ?? "";
		}
	}
	return "";
}

export function buildDefaultTextGraphic(pos, layer, text = "TEXT") {
	const x = Array.isArray(pos) ? pos[0] : (pos?.x ?? 0);
	const y = Array.isArray(pos) ? pos[1] : (pos?.y ?? 0);
	return {
		kind: "text",
		layer: layer ?? "F.SilkS",
		x,
		y,
		text: text ?? "TEXT",
	};
}

export function commitTextGraphic(board, opts = {}) {
	const { pos, layer, text = "TEXT", graphicId = null } = opts;
	if (graphicId) {
		const existing = Array.isArray(board?.graphics) ? board.graphics : [];
		return {
			...(board ?? {}),
			graphics: existing.map((g) => (g.id === graphicId ? { ...g, text } : g)),
		};
	}
	return addGraphic(board, buildDefaultTextGraphic(pos, layer, text));
}

function isPointInText(g, px, py, tol) {
	if (Math.hypot(px - g.x, py - g.y) <= tol) return true;
	const w = Math.max(1, (g.text?.length ?? 4) * 0.8);
	return (
		px >= g.x - tol &&
		px <= g.x + w + tol &&
		py >= g.y - 1.2 - tol &&
		py <= g.y + tol
	);
}

export function findTextGraphicAt(graphics, pt, tol = 1.0) {
	if (!Array.isArray(graphics) || !pt) return null;
	const [px, py] = Array.isArray(pt) ? pt : [pt.x, pt.y];
	for (const g of graphics) {
		if (g.kind === "text" && isPointInText(g, px, py, tol)) {
			return g;
		}
	}
	return null;
}

function handleViaClick(pt, { pads, board, pushBoard }) {
	const netId = chooseViaNet(pads, pt);
	pushBoard(
		addVia(board, {
			at: [pt.x, pt.y],
			netId,
			drillMm: 0.3,
			sizeMm: 0.6,
		}),
	);
	return true;
}

function handleGraphicsClick(e, opts) {
	const {
		activeTool,
		points,
		activeLayer,
		board,
		pushBoard,
		st,
		svgEl,
		view,
		pads,
	} = opts;
	if (!activeTool || !isLeftClick(e)) return false;
	const pt = calcSnappedBoardPoint(e, svgEl, view);
	if (activeTool === "placeVia") {
		return handleViaClick(pt, { pads, board, pushBoard });
	}
	if (activeTool === "placeText") {
		st.onTextSubmit?.("TEXT", pt);
		return true;
	}
	if (activeTool === "drawArc") {
		return handleArcClick({
			pt,
			points,
			activeLayer,
			board,
			pushBoard,
			setPoints: st.setPoints,
		});
	}
	if (points.length === 0) {
		st.setPoints([pt]);
		return true;
	}
	commitTwoClickGraphic({
		tool: activeTool,
		p1: points[0],
		p2: pt,
		activeLayer,
		board,
		pushBoard,
	});
	st.setPoints([]);
	return true;
}

const EMPTY_TEXT_MODAL = Object.freeze({
	open: false,
	pos: null,
	initialText: "",
	graphicId: null,
});

function useGraphicsToolState() {
	const [activeTool, setActiveTool] = useState(null);
	const [points, setPoints] = useState([]);
	const [cursor, setCursor] = useState(null);
	const [textModal, setTextModal] = useState(EMPTY_TEXT_MODAL);
	const reset = useCallback(() => {
		setActiveTool(null);
		setPoints([]);
		setCursor(null);
		setTextModal(EMPTY_TEXT_MODAL);
	}, []);
	const armTool = useCallback((tool) => {
		setActiveTool(tool);
		setPoints([]);
		setCursor(null);
		setTextModal(EMPTY_TEXT_MODAL);
	}, []);
	return {
		activeTool,
		points,
		cursor,
		setCursor,
		textModal,
		setTextModal,
		setPoints,
		reset,
		armTool,
	};
}

function useGraphicsActions(st, { board, pushBoard, activeLayer }) {
	const { activeTool, points, textModal, setTextModal } = st;
	const cancelGraphics = useCallback(() => {
		if (textModal.open) {
			setTextModal(EMPTY_TEXT_MODAL);
			return true;
		}
		if (points.length > 0) {
			st.setPoints([]);
			return true;
		}
		if (activeTool) {
			st.reset();
			return true;
		}
		return false;
	}, [
		textModal.open,
		points.length,
		activeTool,
		setTextModal,
		st.setPoints,
		st.reset,
	]);

	const onTextSubmit = useCallback(
		(text = "TEXT", targetPos = null) => {
			const pos = targetPos ?? textModal.pos;
			if (textModal.graphicId || (pos && text)) {
				pushBoard(
					commitTextGraphic(board, {
						pos,
						layer: activeLayer,
						text,
						graphicId: textModal.graphicId,
					}),
				);
			}
			setTextModal(EMPTY_TEXT_MODAL);
		},
		[textModal, board, activeLayer, pushBoard, setTextModal],
	);

	return { cancelGraphics, onTextSubmit };
}

function useGraphicsEvents({
	st,
	acts,
	board,
	pushBoard,
	activeLayer,
	pads,
	svgRef,
	view,
}) {
	const onPointerMove = useCallback(
		(e) => {
			if (st.activeTool) {
				st.setCursor(calcSnappedBoardPoint(e, svgRef.current, view));
			}
		},
		[st.activeTool, st.setCursor, svgRef, view],
	);
	const onCanvasClick = useCallback(
		(e) =>
			handleGraphicsClick(e, {
				activeTool: st.activeTool,
				points: st.points,
				activeLayer,
				board,
				pushBoard,
				st: { ...st, onTextSubmit: acts.onTextSubmit },
				svgEl: svgRef.current,
				view,
				pads,
			}),
		[st, acts.onTextSubmit, activeLayer, board, pushBoard, pads, svgRef, view],
	);
	const onDoubleClick = useCallback(
		(e) => {
			const pt = screenToBoardCoords(e, svgRef.current, view);
			const target = findTextGraphicAt(board?.graphics, pt);
			if (!target) return false;
			e.preventDefault();
			st.setTextModal({
				open: true,
				pos: { x: target.x, y: target.y },
				initialText: target.text ?? "",
				graphicId: target.id,
			});
			return true;
		},
		[board?.graphics, svgRef, view, st.setTextModal],
	);
	return { onPointerMove, onCanvasClick, onDoubleClick };
}

function useGraphicsDrawing(opts) {
	const { board, pushBoard, activeLayer, pads, svgRef, view } = opts;
	const st = useGraphicsToolState();
	const acts = useGraphicsActions(st, { board, pushBoard, activeLayer });
	const evts = useGraphicsEvents({
		st,
		acts,
		board,
		pushBoard,
		activeLayer,
		pads,
		svgRef,
		view,
	});
	const arm = useCallback((tool) => st.armTool(tool), [st.armTool]);
	return {
		activeTool: st.activeTool,
		points: st.points,
		cursor: st.cursor,
		textModal: st.textModal,
		arm,
		disarm: st.reset,
		...acts,
		...evts,
		onTextCancel: () => st.setTextModal(EMPTY_TEXT_MODAL),
	};
}

function TextGraphicModal({ open, initialText = "", onSubmit, onCancel }) {
	const [text, setText] = useState(initialText);
	useEffect(() => {
		if (open) setText(initialText || "");
	}, [open, initialText]);
	const handleOk = () => {
		if (text.trim().length > 0) onSubmit(text);
		else onCancel();
	};
	return (
		<Modal
			title={initialText ? "Edit Text" : "Add Text"}
			open={open}
			onOk={handleOk}
			onCancel={onCancel}
			width={320}
			destroyOnClose
		>
			<Input
				autoFocus
				aria-label="Graphic text"
				placeholder="Enter text..."
				value={text}
				onChange={(e) => setText(e.target.value)}
				onPressEnter={handleOk}
			/>
		</Modal>
	);
}

function PreviewLine({ p1, cursor, color }) {
	return (
		<line
			x1={p1.x}
			y1={p1.y}
			x2={cursor.x}
			y2={cursor.y}
			stroke={color}
			strokeWidth={0.15}
			strokeDasharray="2,2"
			strokeLinecap="round"
		/>
	);
}

function PreviewRect({ p1, cursor, color }) {
	return (
		<rect
			x={Math.min(p1.x, cursor.x)}
			y={Math.min(p1.y, cursor.y)}
			width={Math.abs(cursor.x - p1.x)}
			height={Math.abs(cursor.y - p1.y)}
			fill="none"
			stroke={color}
			strokeWidth={0.15}
			strokeDasharray="2,2"
		/>
	);
}

function PreviewCircle({ p1, cursor, color }) {
	const r = Math.hypot(cursor.x - p1.x, cursor.y - p1.y);
	return (
		<circle
			cx={p1.x}
			cy={p1.y}
			r={r}
			fill="none"
			stroke={color}
			strokeWidth={0.15}
			strokeDasharray="2,2"
		/>
	);
}

function PreviewDimension({ p1, cursor, color }) {
	const len = Math.hypot(cursor.x - p1.x, cursor.y - p1.y);
	return (
		<g>
			<line
				x1={p1.x}
				y1={p1.y}
				x2={cursor.x}
				y2={cursor.y}
				stroke={color}
				strokeWidth={0.15}
				strokeDasharray="2,2"
			/>
			<text
				x={(p1.x + cursor.x) / 2}
				y={(p1.y + cursor.y) / 2 - 0.5}
				fill={color}
				fontSize={0.8}
				textAnchor="middle"
			>
				{`${len.toFixed(2)} mm`}
			</text>
		</g>
	);
}

const PREVIEW_RENDERERS = {
	drawLine: PreviewLine,
	drawRect: PreviewRect,
	drawCircle: PreviewCircle,
	placeDimension: PreviewDimension,
};

function PreviewTwoClick({ tool, p1, cursor, color }) {
	const Comp = PREVIEW_RENDERERS[tool];
	return Comp ? <Comp p1={p1} cursor={cursor} color={color} /> : null;
}

function PreviewArc({ points, cursor, color }) {
	if (points.length === 1) {
		return (
			<line
				x1={points[0].x}
				y1={points[0].y}
				x2={cursor.x}
				y2={cursor.y}
				stroke={color}
				strokeWidth={0.15}
				strokeDasharray="2,2"
			/>
		);
	}
	if (points.length === 2) {
		const p1 = [points[0].x, points[0].y];
		const pm = [points[1].x, points[1].y];
		const p2 = [cursor.x, cursor.y];
		const { center, radius } = calcArcCenter(p1, pm, p2);
		const d = arcToSvgPath({ start: p1, mid: pm, end: p2, center, radius });
		return (
			<path
				d={d}
				fill="none"
				stroke={color}
				strokeWidth={0.15}
				strokeDasharray="2,2"
			/>
		);
	}
	return null;
}

function GraphicsPreview({ activeTool, points, cursor, activeLayer }) {
	if (!activeTool || !cursor || points.length === 0) return null;
	const color = getLayerColor(PCB_THEME, activeLayer);
	if (activeTool === "drawArc") {
		return <PreviewArc points={points} cursor={cursor} color={color} />;
	}
	return (
		<PreviewTwoClick
			tool={activeTool}
			p1={points[0]}
			cursor={cursor}
			color={color}
		/>
	);
}

function handleViaTool(route, armGfx) {
	if (route.isRouting) route.placeViaAndSwitchLayer();
	else armGfx("placeVia");
}

function handleSelectTool(route, armedPlacement, graphicsDrawing) {
	if (route.isRouting) route.cancelRoute();
	armedPlacement.disarm();
	graphicsDrawing.disarm();
}

function handleRouteTrack(route, armedPlacement, graphicsDrawing) {
	armedPlacement.disarm();
	graphicsDrawing.disarm();
	if (!route.isRouting) route.toggleRoute();
}

function handlePlaceFootprint(item, route, armedPlacement, graphicsDrawing) {
	if (route.isRouting) route.cancelRoute();
	graphicsDrawing.disarm();
	if (item) armedPlacement.setArmed(item);
}

function handleSetLayer(item, layers) {
	if (typeof item?.layer === "string") {
		layers.onSetActive(item.layer);
	}
}

function createToolBusHandlers({
	route,
	layers,
	armedPlacement,
	graphicsDrawing,
}) {
	const armGfx = (tool) => {
		if (route.isRouting) route.cancelRoute();
		armedPlacement.disarm();
		graphicsDrawing.arm(tool);
	};
	const onVia = () => handleViaTool(route, armGfx);
	return {
		select: () => handleSelectTool(route, armedPlacement, graphicsDrawing),
		drawLine: () => armGfx("drawLine"),
		drawRect: () => armGfx("drawRect"),
		drawCircle: () => armGfx("drawCircle"),
		placeDimension: () => armGfx("placeDimension"),
		drawArc: () => armGfx("drawArc"),
		placeText: () => armGfx("placeText"),
		routeTrack: () => handleRouteTrack(route, armedPlacement, graphicsDrawing),
		addVia: onVia,
		placeVia: onVia,
		setLayer: (item) => handleSetLayer(item, layers),
		placeFootprint: (item) =>
			handlePlaceFootprint(item, route, armedPlacement, graphicsDrawing),
	};
}

function reportActiveTool(isRouting, armedFootprint, activeGraphicsTool) {
	if (activeGraphicsTool) {
		const tool =
			activeGraphicsTool === "placeVia" ? "addVia" : activeGraphicsTool;
		emitActiveTool({ tab: "pcb", tool, item: null });
		return;
	}
	if (isRouting) {
		emitActiveTool({ tab: "pcb", tool: "routeTrack", item: null });
		return;
	}
	if (armedFootprint) {
		emitActiveTool({
			tab: "pcb",
			tool: "placeFootprint",
			item: armedFootprint,
		});
		return;
	}
	emitActiveTool({ tab: "pcb", tool: "select", item: null });
}

function useToolBus({
	route,
	layers,
	armedPlacement,
	graphicsDrawing,
	containerRef,
}) {
	const handlersRef = useRef({});
	handlersRef.current = createToolBusHandlers({
		route,
		layers,
		armedPlacement,
		graphicsDrawing,
	});

	useEffect(() => {
		reportActiveTool(
			route.isRouting,
			armedPlacement.armed,
			graphicsDrawing.activeTool,
		);
	}, [route.isRouting, armedPlacement.armed, graphicsDrawing.activeTool]);

	useEffect(() => {
		return onEditorTool((payload) => {
			focusCanvas(containerRef);
			const handler = handlersRef.current[payload?.tool];
			handler?.(payload?.item);
		}, "pcb");
	}, [containerRef]);
}

function useSceneClick(routeClick, armedPlacement, graphicsDrawing) {
	return useCallback(
		(e) => {
			if (graphicsDrawing?.onCanvasClick(e)) return;
			if (armedPlacement?.onCanvasClick(e)) return;
			routeClick(e);
		},
		[routeClick, armedPlacement, graphicsDrawing],
	);
}

function useScenePointer(ptrMove, armedPlacement, graphicsDrawing) {
	return useCallback(
		(e) => {
			ptrMove(e);
			armedPlacement?.onPointerMove(e);
			graphicsDrawing?.onPointerMove(e);
		},
		[ptrMove, armedPlacement, graphicsDrawing],
	);
}

function useSvgPointerHandlers({
	drag,
	graphicDrag,
	route,
	sceneData,
	outlineDrawing,
}) {
	const onPointerDown = useCallback(
		(e) => {
			if (outlineDrawing.onPointerDown(e)) return;
			graphicDrag?.onPointerDown(e);
			sceneData.onPointerDown(e);
		},
		[outlineDrawing, graphicDrag, sceneData],
	);
	const onPointerMove = useCallback(
		(e) => {
			if (outlineDrawing.onPointerMove(e)) return;
			graphicDrag?.onPointerMove(e);
			drag.onPointerMove(e);
			route.onPointerMove(e);
		},
		[outlineDrawing, graphicDrag, drag, route],
	);
	const onPointerUp = useCallback(
		(e) => {
			if (outlineDrawing.onPointerUp(e)) return;
			if (graphicDrag?.onPointerUp(e)) return;
			drag.onDropDrag(e);
		},
		[outlineDrawing, graphicDrag, drag],
	);
	return { onPointerDown, onPointerMove, onPointerUp };
}

function PcbSvgOverlays({
	markers,
	zoom,
	outlineDrawing,
	graphicsDrawing,
	armedPlacement,
	activeLayer,
}) {
	return (
		<>
			<MarkersOverlay markers={markers} zoom={zoom} />
			<OutlinePreview
				drag={outlineDrawing.drag}
				activeTool={outlineDrawing.activeTool}
				radius={outlineDrawing.radius}
			/>
			<GraphicsPreview
				activeTool={graphicsDrawing?.activeTool}
				points={graphicsDrawing?.points}
				cursor={graphicsDrawing?.cursor}
				activeLayer={activeLayer}
			/>
			<FootprintGhost
				item={armedPlacement?.armed}
				cursor={armedPlacement?.cursor}
				activeLayer={activeLayer}
			/>
		</>
	);
}

function PcbSvgContent({
	order,
	sceneData,
	layerState,
	drag,
	showVias,
	route,
	overlays,
}) {
	return (
		<>
			<PcbLayerStack
				order={order}
				sceneData={sceneData}
				layerState={layerState}
				drag={drag}
			/>
			{showVias && <ViasLayer vias={sceneData.board?.vias} />}
			<RatsnestLayer lines={sceneData.rnLines} />
			<RoutingPreviewLayer
				points={route.points}
				proposed={route.proposedRoute}
				activeLayer={layerState.active}
				widthMm={route.widthMm}
			/>
			{overlays}
		</>
	);
}

function useSceneDoubleClick(graphicsDrawing, routeDoubleClick) {
	return useCallback(
		(e) => {
			if (graphicsDrawing?.onDoubleClick?.(e)) return;
			routeDoubleClick?.(e);
		},
		[graphicsDrawing, routeDoubleClick],
	);
}

function PcbSvgScene({
	svgRef,
	view,
	route,
	layerState,
	sceneData,
	drag,
	markers,
	outlineDrawing,
	armedPlacement,
	graphicsDrawing,
	graphicDrag,
}) {
	const order = useMemo(() => drawOrder(layerState), [layerState]);
	const showVias =
		isVisible(layerState, "F.Cu") || isVisible(layerState, "B.Cu");
	const ptr = useSvgPointerHandlers({
		drag,
		graphicDrag,
		route,
		sceneData,
		outlineDrawing,
	});
	const onClick = useSceneClick(
		route.onCanvasClick,
		armedPlacement,
		graphicsDrawing,
	);
	const onDoubleClick = useSceneDoubleClick(
		graphicsDrawing,
		route.onCanvasDoubleClick,
	);
	const onPointerMove = useScenePointer(
		ptr.onPointerMove,
		armedPlacement,
		graphicsDrawing,
	);
	const transform = `translate(${view.pan.x},${view.pan.y}) scale(${view.zoom})`;
	const overlays = (
		<PcbSvgOverlays
			markers={markers}
			zoom={view.zoom}
			outlineDrawing={outlineDrawing}
			graphicsDrawing={graphicsDrawing}
			armedPlacement={armedPlacement}
			activeLayer={layerState.active}
		/>
	);
	return (
		/* biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard handled on parent region */
		<svg
			ref={svgRef}
			style={SVG_STYLE}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onPointerDown={ptr.onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={ptr.onPointerUp}
		>
			<title>PCB Canvas</title>
			<g transform={transform}>
				<PcbSvgContent
					order={order}
					sceneData={sceneData}
					layerState={layerState}
					drag={drag}
					showVias={showVias}
					route={route}
					overlays={overlays}
				/>
			</g>
		</svg>
	);
}

function useCanvasView(board, ir, containerRef) {
	const [view, setView] = useState(() =>
		fitToBounds(getSceneBounds(board, ir), { width: 800, height: 600 }),
	);
	const getBounds = useCallback(() => getSceneBounds(board, ir), [board, ir]);
	useCanvasNav(containerRef, { view, setView, getBounds });
	return { view, setView };
}

function netNameMap(nets) {
	return Object.fromEntries((nets ?? []).map((n) => [n.id, n.name]));
}

function useCanvasGraphicsTools({
	board,
	history,
	layers,
	svgRef,
	view,
	armedPlacement,
	route,
	containerRef,
	pads,
}) {
	const graphicsDrawing = useGraphicsDrawing({
		board,
		pushBoard: history.pushBoard,
		activeLayer: layers.layerState.active,
		pads,
		svgRef,
		view,
	});
	const graphicDrag = useGraphicDrag({
		board,
		pushBoard: history.pushBoard,
		svgRef,
		view,
		isArmed:
			Boolean(armedPlacement.armed) || Boolean(graphicsDrawing.activeTool),
		isRouting: route.isRouting,
	});
	useToolBus({
		route,
		layers,
		armedPlacement,
		graphicsDrawing,
		containerRef,
	});
	return { graphicsDrawing, graphicDrag };
}

function usePcbCanvasState({
	editor,
	board,
	onBoardChange,
	onChange,
	fetchFootprint,
	visible,
	containerRef,
}) {
	const svgRef = useRef(null);
	const ir = editor?.state?.ir;
	const { view } = useCanvasView(board, ir, containerRef);
	const layers = useCanvasLayers(board);
	const { fpLookup, padPositions, padRadius, missingFootprints } =
		usePadGeometry(ir?.parts, board, fetchFootprint, visible);
	const pads = useMemo(
		() => boardCopperPads(ir?.parts, fpLookup, ir?.nets),
		[ir, fpLookup],
	);
	const netNames = useMemo(() => netNameMap(ir?.nets), [ir]);
	const history = useBoardHistory(board, onBoardChange);
	const sel = useCanvasSelection(editor, board, history.pushBoard, onChange);
	const drag = usePartDrag(editor, svgRef, view);
	const route = useRoutingState({
		board,
		activeLayer: layers.layerState.active,
		toggleLayer: layers.toggleLayer,
		pushBoard: history.pushBoard,
		svgRef,
		ir,
		padPositions,
		pads,
		netNames,
		view,
	});
	const outlineDrawing = useOutlineDrawing({
		board,
		pushBoard: history.pushBoard,
		svgRef,
		view,
	});
	const armedPlacement = useArmedFootprint({
		editor,
		activeLayer: layers.layerState.active,
		svgRef,
		view,
	});
	const { graphicsDrawing, graphicDrag } = useCanvasGraphicsTools({
		board,
		history,
		layers,
		svgRef,
		view,
		armedPlacement,
		route,
		containerRef,
		pads,
	});
	const rnLines = useMemo(
		() =>
			ratsnest(ir, padPositions, board?.tracks, {
				zones: board?.zones,
				padRadius,
			}),
		[ir, padPositions, padRadius, board?.tracks, board?.zones],
	);
	const onPointerDown = usePointerDownHandler({
		route,
		sel,
		ir,
		board,
		svgRef,
		view,
		isArmed:
			Boolean(armedPlacement.armed) || Boolean(graphicsDrawing.activeTool),
	});
	const shortcuts = buildShortcuts({
		editor,
		sel,
		layers,
		route,
		history,
		outlineDrawing,
		armedPlacement,
		graphicsDrawing,
	});
	const sceneData = buildSceneData({
		editor,
		isRouting: route.isRouting,
		board,
		ir,
		rnLines,
		sel,
		onPointerDown,
		fpLookup,
		armedPlacement,
		graphicsDrawing,
	});
	return {
		svgRef,
		view,
		layers,
		route,
		sceneData,
		drag,
		shortcuts,
		outlineDrawing,
		missingFootprints,
		armedPlacement,
		graphicsDrawing,
		graphicDrag,
	};
}

export default function PcbCanvas({
	editor,
	board,
	onBoardChange,
	onChange,
	fetchFootprint,
	markers = [],
	visible = true,
	onCursorMove,
}) {
	const containerRef = useRef(null);
	const s = usePcbCanvasState({
		editor,
		board,
		onBoardChange,
		onChange,
		fetchFootprint,
		visible,
		containerRef,
	});
	useFocusOnShow(containerRef, visible, Boolean(board));
	useCanvasAutoFocus(containerRef, "pcb");

	return (
		<div
			ref={containerRef}
			style={CONTAINER_STYLE}
			role="application"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard navigation for canvas shortcuts
			tabIndex={0}
			aria-label="PCB editor"
			onKeyDown={(e) => handleShortcuts(e, s.shortcuts)}
			onPointerMove={(e) => {
				const [x, y] = screenToBoardCoords(e, s.svgRef.current, s.view);
				onCursorMove?.({ x, y, zoom: s.view.zoom });
			}}
		>
			<PcbToolbar
				activeLayer={s.layers.layerState.active}
				isRouting={s.route.isRouting}
				onToggleLayer={s.layers.toggleLayer}
				onToggleRoute={s.route.toggleRoute}
				widthPreset={s.route.widthPreset}
				onCycleWidth={s.route.cycleWidthPreset}
				routeMode={s.route.routeMode}
				onToggleRouteMode={s.route.toggleRouteMode}
			/>
			<PcbSvgScene
				svgRef={s.svgRef}
				view={s.view}
				route={s.route}
				layerState={s.layers.layerState}
				sceneData={s.sceneData}
				drag={s.drag}
				markers={markers}
				outlineDrawing={s.outlineDrawing}
				armedPlacement={s.armedPlacement}
				graphicsDrawing={s.graphicsDrawing}
				graphicDrag={s.graphicDrag}
			/>
			<LayerListOverlay
				layerState={s.layers.layerState}
				onToggleVisible={s.layers.onToggleVisible}
				onSetActive={s.layers.onSetActive}
			/>
			<FootprintMissNote count={s.missingFootprints} />
			<PcbStatusBar
				isRouting={s.route.isRouting}
				widthPreset={s.route.widthPreset}
				routeMode={s.route.routeMode}
				posture={s.route.posture}
			/>
			<TextGraphicModal
				open={s.graphicsDrawing.textModal.open}
				initialText={s.graphicsDrawing.textModal.initialText}
				onSubmit={s.graphicsDrawing.onTextSubmit}
				onCancel={s.graphicsDrawing.onTextCancel}
			/>
		</div>
	);
}
