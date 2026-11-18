import { Input, Modal, message } from "antd";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
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
import {
	isDiffPairName,
	partnerNetName,
	pathLength,
	proposeDiffPair,
} from "./diffPair.js";
import {
	get as getEditorStatus,
	subscribe as subscribeEditorStatus,
} from "./editorStatus.js";
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
import { meander } from "./lengthTune.js";
import { markerGlyphs } from "./markerRender.js";
import { netItemsAt } from "./netHighlight.js";
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
import {
	bboxOfPoints,
	fitToBounds,
	formatCoord,
	screenToWorld,
} from "./viewport.js";
import { addZone, pointInZone } from "./zoneModel.js";

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
	if (key === "t") {
		ctx.armText?.();
		return true;
	}
	if (key === "6") {
		ctx.toggleDiffPair?.();
		return true;
	}
	if (key === "7") {
		ctx.toggleTuneLength?.();
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

function cancelHighlight(ctx) {
	if (!ctx.highlightNet && !ctx.highlightMode) return false;
	ctx.cancelHighlight?.();
	return true;
}

// Escape: outline, graphics, armed footprint, route, or net highlight.
function handleEscape(e, key, ctx) {
	if (key !== "escape") return false;
	const cancelFns = [
		ctx.cancelOutline,
		ctx.cancelGraphics,
		ctx.disarmFootprint,
		() => cancelRouting(ctx),
		() => cancelHighlight(ctx),
		ctx.cancelDiffPair,
		ctx.cancelTuneLength,
		ctx.cancelMeasure,
	];
	const cancelled = cancelFns.some((fn) => Boolean(fn?.()));
	if (cancelled) {
		e.preventDefault();
		return true;
	}
	return false;
}

function disarmOtherTools(ctx) {
	if (ctx.isRouting) ctx.cancelRoute();
	ctx.disarmFootprint?.();
	ctx.cancelGraphics?.();
}

function handleBackquoteShortcut(e, ctx) {
	if (e.key !== "`" && e.code !== "Backquote") return false;
	e.preventDefault();
	if (ctx.cursorWorld) {
		const net = resolvePcbNetAtPoint({
			ir: ctx.ir,
			board: ctx.board,
			pads: ctx.pads,
			padPositions: ctx.padPositions,
			pt: ctx.cursorWorld,
		});
		if (net) {
			ctx.setHighlightNet?.(net);
			return true;
		}
	}
	const nextMode = !ctx.highlightMode;
	if (nextMode) disarmOtherTools(ctx);
	ctx.setHighlightMode?.(nextMode);
	return true;
}

function handleMeasureShortcut(e, ctx) {
	if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
		e.preventDefault();
		ctx.toggleMeasure?.();
		return true;
	}
	return false;
}

function handleShortcuts(e, ctx) {
	if (isTextInput(e.target)) return;
	const key = e.key.toLowerCase();
	if (handleEscape(e, key, ctx)) return;
	if (handleMeasureShortcut(e, ctx)) return;
	if (handleBackquoteShortcut(e, ctx)) return;
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

export const DEFAULT_WORK_AREA = Object.freeze({
	minX: -50,
	maxX: 50,
	minY: -40,
	maxY: 40,
});

export function defaultWorkAreaBounds() {
	return DEFAULT_WORK_AREA;
}

export function sceneBoundsFallback(_board, ir) {
	const fpPts = collectFootprintPoints(ir?.parts);
	if (fpPts.length > 0) {
		const fpBox = bboxOfPoints(fpPts);
		if (fpBox) return fpBox;
	}
	return defaultWorkAreaBounds();
}

export function getSceneBounds(board, ir) {
	if (isValidOutline(board?.outline)) {
		const box = getOutlineBBox(board.outline);
		if (box) return box;
	}
	return sceneBoundsFallback(board, ir);
}

function formatPt(pt) {
	if (Array.isArray(pt)) return `${pt[0]},${pt[1]}`;
	if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
		return `${pt.x},${pt.y}`;
	}
	return null;
}

export function getZonePoints(zone) {
	if (Array.isArray(zone?.polygon)) return zone.polygon;
	if (Array.isArray(zone?.points)) return zone.points;
	return [];
}

export function formatZonePt(pt) {
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

function renderZonePolygon(zone, layer, idx, highlightNet) {
	const pts = getZonePoints(zone).map(formatZonePt).filter(Boolean).join(" ");
	if (!pts) return null;
	const color = getLayerColor(PCB_THEME, zone.layer ?? layer);
	const key = zone.id ?? `zone_${zone.layer ?? layer}_${idx}`;
	const isHl = isNetMatch(zone.netId, highlightNet);
	const opacity = getPcbCopperOpacity(isHl, Boolean(highlightNet));
	return (
		<polygon
			key={key}
			points={pts}
			fill={color}
			fillOpacity={isHl ? 0.45 : 0.25}
			stroke={isHl ? "#facc15" : color}
			strokeWidth={isHl ? 0.4 : 0.2}
			style={{
				opacity,
				filter: isHl ? "drop-shadow(0 0 1px #facc15)" : undefined,
			}}
		/>
	);
}

function ZonesLayer({ zones, layer, highlightNet }) {
	if (!Array.isArray(zones)) return null;
	const filtered = zones.filter((z) => (z.layer ?? "F.Cu") === layer);
	if (filtered.length === 0) return null;
	return (
		<g className="pcb-zones">
			{filtered.map((z, i) => renderZonePolygon(z, layer, i, highlightNet))}
		</g>
	);
}

function TracksLayer({ tracks, layer, selectedIndex, highlightNet }) {
	if (!Array.isArray(tracks)) return null;
	const filtered = tracks
		.map((track, originalIndex) => ({ track, index: originalIndex }))
		.filter(({ track }) => track.layer === layer);
	if (filtered.length === 0) return null;
	return (
		<g className="pcb-tracks">
			{filtered.map(({ track, index }) => {
				const isSelected = selectedIndex === index;
				const isHl = isNetMatch(track.netId, highlightNet);
				const opacity = getPcbCopperOpacity(isHl, Boolean(highlightNet));
				const baseWidth = track.widthMm || 0.25;
				const strokeWidth = isHl ? baseWidth + 0.15 : baseWidth;
				const color = isSelected
					? "#fadb14"
					: getLayerColor(PCB_THEME, track.layer);
				return (
					<path
						key={trackKey(track, index)}
						d={trackPath(track)}
						fill="none"
						stroke={color}
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						style={{
							opacity,
							filter: isHl ? "drop-shadow(0 0 0.8px #facc15)" : undefined,
						}}
					/>
				);
			})}
		</g>
	);
}

function ViasLayer({ vias, highlightNet }) {
	if (!Array.isArray(vias)) return null;
	return (
		<g className="pcb-vias">
			{vias.map((via) => {
				const [x, y] = via.at ?? [0, 0];
				const outerR = (via.sizeMm || 0.8) / 2;
				const innerR = (via.drillMm || 0.4) / 2;
				const key = `via_${x}_${y}`;
				const isHl = isNetMatch(via.netId, highlightNet);
				const opacity = getPcbCopperOpacity(isHl, Boolean(highlightNet));
				const stroke = isHl ? "#facc15" : "#059669";
				const strokeWidth = isHl ? 0.25 : 0.1;
				return (
					<g
						key={key}
						style={{
							opacity,
							filter: isHl ? "drop-shadow(0 0 0.8px #facc15)" : undefined,
						}}
					>
						<circle
							cx={x}
							cy={y}
							r={outerR}
							fill={PCB_THEME.via}
							stroke={stroke}
							strokeWidth={strokeWidth}
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

function PadLabel({ cx, cy, fontSize, number }) {
	return (
		<text
			x={cx}
			y={cy}
			textAnchor="middle"
			dominantBaseline="central"
			fill="#ffffff"
			fontSize={fontSize}
			style={{ pointerEvents: "none", userSelect: "none" }}
		>
			{number}
		</text>
	);
}

function FootprintPad({ pad, isBack, layerState, partId, highlightNet }) {
	if (!isPadVisible(pad, isBack, layerState)) return null;
	const isThru = isThruHole(pad);
	const color = isThru
		? PCB_THEME.padThrough
		: getLayerColor(PCB_THEME, isBack ? "B.Cu" : "F.Cu");
	const [cx, cy] = pad.center;
	const rot = pad.rot ? `rotate(${pad.rot} ${cx} ${cy})` : undefined;
	const drillR = calcDrillRadius(pad);
	const fontSize = Math.min(pad.size[0], pad.size[1]) * 0.35;
	const isHl = isPadNetMatch(partId, pad.number, highlightNet);
	const opacity = getPcbCopperOpacity(isHl, Boolean(highlightNet));
	return (
		<g
			style={{
				opacity,
				filter: isHl ? "drop-shadow(0 0 1px #facc15)" : undefined,
			}}
		>
			<PadShapeElement pad={pad} color={color} rot={rot} />
			{isThru && (
				<circle cx={cx} cy={cy} r={drillR} fill={PCB_THEME.background} />
			)}
			<PadLabel cx={cx} cy={cy} fontSize={fontSize} number={pad.number} />
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

function SelectedPartOutline({ rect, rot }) {
	return (
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
	);
}

function FootprintShape({
	fp,
	part,
	rect,
	isSelected,
	layerState,
	highlightNet,
}) {
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
			{isSelected && <SelectedPartOutline rect={rect} rot={rot} />}
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
					partId={part.id}
					isBack={isBack}
					layerState={layerState}
					highlightNet={highlightNet}
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
	highlightNet,
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
					highlightNet={highlightNet}
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
	highlightNet,
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
					highlightNet={highlightNet}
				/>
			))}
		</g>
	);
}

function RatsnestLayer({ lines, highlightNet }) {
	if (!Array.isArray(lines)) return null;
	return (
		<g className="pcb-ratsnest" style={{ pointerEvents: "none" }}>
			{lines.map((l) => {
				const isHl = isNetMatch(l.netId, highlightNet);
				const stroke = isHl ? "#facc15" : PCB_THEME.ratsnest;
				const strokeWidth = isHl ? 0.35 : 0.2;
				const opacity = getPcbCopperOpacity(isHl, Boolean(highlightNet));
				return (
					<line
						key={`rn_${l.netId}_${l.from.x}_${l.from.y}_${l.to.x}_${l.to.y}`}
						x1={l.from.x}
						y1={l.from.y}
						x2={l.to.x}
						y2={l.to.y}
						stroke={stroke}
						strokeWidth={strokeWidth}
						strokeDasharray={isHl ? undefined : "1,1"}
						style={{
							opacity,
							filter: isHl ? "drop-shadow(0 0 1px #facc15)" : undefined,
						}}
					/>
				);
			})}
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

function renderStatusBarMessage(opts) {
	const { statusHint, measuringText, isDiffPair, highlightNet, isRouting } =
		opts;
	if (statusHint) {
		return <strong style={{ color: "#f87171" }}>{statusHint}</strong>;
	}
	if (measuringText) {
		return <strong style={{ color: "#38bdf8" }}>{measuringText}</strong>;
	}
	if (isDiffPair) {
		return "Diff Pair: Click on diff pair pad, double-click to end";
	}
	if (highlightNet) {
		return (
			<>
				Net:{" "}
				<strong style={{ color: "#facc15" }}>
					{highlightNet.netName || highlightNet.netId}
				</strong>
			</>
		);
	}
	if (isRouting) {
		return "Routing: Click to route (Shift to bypass DRC), V for via, Double-click to end";
	}
	return "Ready: Press X to route, V to toggle layer";
}

function PcbStatusBar(props) {
	const { widthPreset, routeMode, posture } = props;
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
			<span>{renderStatusBarMessage(props)}</span>
		</div>
	);
}

function dragDelta(drag, curPt) {
	return [curPt[0] - drag.startPos[0], curPt[1] - drag.startPos[1]];
}

function calcDropPos(drag, curPt) {
	const [dx, dy] = dragDelta(drag, curPt);
	return snapToGrid(
		[drag.origPos[0] + dx, drag.origPos[1] + dy],
		currentGrid(),
	);
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
	const grid = currentGrid();
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

// --- PCB Net Highlight pure helpers ---
function findZoneNetAt(zones, pt) {
	for (const z of zones ?? []) {
		if (!z.keepout && pointInZone(z, pt)) {
			return z.netId ?? "";
		}
	}
	return "";
}

function findNetInIr(ir, netId) {
	if (!ir?.nets || !netId) return null;
	return ir.nets.find((n) => n.id === netId || n.name === netId) ?? null;
}

export function isNetMatch(netId, highlightNet) {
	if (!highlightNet || !netId) return false;
	return (
		netId === highlightNet.netId ||
		Boolean(highlightNet.netName && netId === highlightNet.netName)
	);
}

export function isPadNetMatch(partId, padNumber, highlightNet) {
	if (!highlightNet || !partId || !padNumber) return false;
	if (!highlightNet.partIds?.has?.(partId)) return false;
	return Boolean(
		highlightNet.pins?.some(
			(p) => p.partId === partId && String(p.pin) === String(padNumber),
		),
	);
}

export function getPcbCopperOpacity(isMatch, hasHighlight) {
	if (!hasHighlight) return 1;
	return isMatch ? 1 : 0.3;
}

function findPadNetAt(pads, ir, padPositions, pt) {
	return chooseViaNet(pads, pt) || findPadNet(ir, padPositions, pt);
}

function findCopperNetAt(board, pt) {
	return hitTest({ parts: [] }, board, pt)?.id ?? "";
}

function findBoardNetAt(board, pt) {
	return findCopperNetAt(board, pt) || findZoneNetAt(board?.zones, pt);
}

export function resolvePcbNetAtPoint(ctx) {
	if (!ctx?.ir || !ctx.pt) return null;
	const netId =
		findPadNetAt(ctx.pads, ctx.ir, ctx.padPositions, ctx.pt) ||
		findBoardNetAt(ctx.board, ctx.pt);
	if (!netId) return null;
	const net = findNetInIr(ctx.ir, netId);
	return net ? netItemsAt(ctx.ir, { netId: net.id }) : null;
}
// --- End PCB Net Highlight pure helpers ---

// --- PCB DiffPair, Tune, Measure pure helpers ---
export function calcMeasureReadout(start, end, units = "mm") {
	const x0 = Array.isArray(start) ? start[0] : (start?.x ?? 0);
	const y0 = Array.isArray(start) ? start[1] : (start?.y ?? 0);
	const x1 = Array.isArray(end) ? end[0] : (end?.x ?? 0);
	const y1 = Array.isArray(end) ? end[1] : (end?.y ?? 0);
	const dx = x1 - x0;
	const dy = y1 - y0;
	const distance = Math.hypot(dx, dy);
	let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
	if (Object.is(angle, -0)) angle = 0;
	const u = units || "mm";
	const distStr = `${formatCoord(distance, u)} ${u}`;
	const dxStr = `${formatCoord(dx, u)} ${u}`;
	const dyStr = `${formatCoord(dy, u)} ${u}`;
	const angleStr = `${angle.toFixed(1)}°`;
	const text = `Dist: ${distStr} | dx: ${dxStr} | dy: ${dyStr} | ∠ ${angleStr}`;
	return {
		distance,
		dx,
		dy,
		angle,
		distStr,
		dxStr,
		dyStr,
		angleStr,
		text,
	};
}

export function calcLengthTuneDefaults(currentLength) {
	const len = Number(currentLength) || 0;
	const targetLengthMm = Math.round(len * 1.1 * 100) / 100;
	return {
		currentLength: len,
		targetLengthMm,
		amplitudeMm: 1.0,
		spacingMm: 0.6,
	};
}

export function resolveDiffPairDimensions(board) {
	const setup = board?.setup ?? {};
	const widthMm = Number(
		setup.diffPairWidth ??
			setup.diff_pair_width ??
			setup.diffPair?.width ??
			0.2,
	);
	const gapMm = Number(
		setup.diffPairGap ?? setup.diff_pair_gap ?? setup.diffPair?.gap ?? 0.25,
	);
	return { widthMm, gapMm };
}

function findCandidatePinPos(pin, padPositions, pads) {
	const fromPos =
		padPositions?.[pin.partId]?.[pin.pin] ??
		padPositions?.[pin.partId]?.[String(pin.pin)];
	if (fromPos) return fromPos;
	const match = pads?.find(
		(p) => p.partId === pin.partId && String(p.number) === String(pin.pin),
	);
	return match?.center ?? null;
}

function selectClosestCandidate(candidates, startPos) {
	const sx = startPos?.[0] ?? startPos?.x ?? 0;
	const sy = startPos?.[1] ?? startPos?.y ?? 0;
	let best = candidates[0];
	let bestDist = Infinity;
	for (const c of candidates) {
		const cx = c.pos[0] ?? c.pos.x ?? 0;
		const cy = c.pos[1] ?? c.pos.y ?? 0;
		const d = Math.hypot(cx - sx, cy - sy);
		if (d < bestDist) {
			bestDist = d;
			best = c;
		}
	}
	return best;
}

export function findPartnerPad(startPad, partnerNetName, ctx = {}) {
	if (!startPad || !partnerNetName) return null;
	const { ir, pads, padPositions } = ctx;
	const net = (ir?.nets ?? []).find(
		(n) => n.name === partnerNetName || n.id === partnerNetName,
	);
	const pins = net?.pins ?? [];
	const candidates = [];
	for (const pin of pins) {
		const pos = findCandidatePinPos(pin, padPositions, pads);
		if (pos) {
			candidates.push({
				partId: pin.partId,
				pinNum: String(pin.pin),
				pos,
				netId: net.id,
				netName: net.name ?? net.id,
			});
		}
	}
	if (candidates.length === 0) return null;
	const samePart = candidates.find((c) => c.partId === startPad.partId);
	return samePart ?? selectClosestCandidate(candidates, startPad.pos);
}

export function replaceTrackWithPoints(board, trackIndex, points) {
	const tracks = Array.isArray(board?.tracks) ? [...board.tracks] : [];
	const orig = tracks[trackIndex];
	if (!orig || !Array.isArray(points) || points.length < 2) return board;
	const newSegments = [];
	for (let i = 0; i < points.length - 1; i++) {
		newSegments.push({
			netId: orig.netId ?? "",
			layer: orig.layer ?? "F.Cu",
			start: points[i],
			end: points[i + 1],
			widthMm: orig.widthMm ?? 0.25,
			points,
		});
	}
	tracks.splice(trackIndex, 1, ...newSegments);
	return { ...board, tracks };
}

function resolvePadNetName(ir, netNames, netId) {
	const net = findNetInIr(ir, netId);
	return net?.name || netNames?.[netId] || netId || "";
}

function findNearPadInfo(pt, ctx) {
	const near = findNearPad(ctx.ir?.parts, ctx.padPositions, pt, 2.0);
	if (!near) return null;
	const netId = findPinNet(ctx.ir?.nets, near.partId, near.pinNum);
	return {
		partId: near.partId,
		pinNum: String(near.pinNum),
		pos: near.pos,
		netId,
		netName: resolvePadNetName(ctx.ir, ctx.netNames, netId),
	};
}

function findHitPadInfo(pt, ctx) {
	const coords = [pt.x ?? pt[0], pt.y ?? pt[1]];
	for (const pad of ctx.pads ?? []) {
		if (padHitTest([pad], coords) !== null) {
			return {
				partId: pad.partId,
				pinNum: String(pad.number),
				pos: pad.center,
				netId: pad.netId,
				netName: resolvePadNetName(ctx.ir, ctx.netNames, pad.netId),
			};
		}
	}
	return null;
}

export function findPadInfoAtPoint(pt, ctx = {}) {
	if (!pt) return null;
	return findNearPadInfo(pt, ctx) || findHitPadInfo(pt, ctx);
}
// --- End PCB DiffPair, Tune, Measure pure helpers ---

// Start snaps to a track end, pad or part centre; a later click snaps to a pad centre.
function resolveRouteTarget(raw, hasPoints, snapCtx) {
	const snapped = snapToGrid(raw, currentGrid());
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
			setCursorPos(snapToGrid(raw, currentGrid()));
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

function handlePointerDownHighlight(ctx, pt) {
	if (ctx.highlight?.highlightMode) {
		const net = resolvePcbNetAtPoint({
			ir: ctx.ir,
			board: ctx.board,
			pads: ctx.pads,
			padPositions: ctx.padPositions,
			pt,
		});
		ctx.highlight.setHighlightNet(net);
		return true;
	}
	return false;
}

function usePointerDownHandler(ctx) {
	const { route, sel, ir, board, svgRef, view, isArmed, highlight } = ctx;
	return useCallback(
		(e) => {
			if (e.button !== 0 || route.isRouting) return;
			const pt = screenToBoardCoords(e, svgRef.current, view);
			if (handlePointerDownHighlight(ctx, pt)) return;
			if (isArmed) return;
			const graphicId = hitTestGraphic(board?.graphics, pt);
			if (graphicId) {
				sel.onSelectHit({ kind: "graphic", id: graphicId });
				return;
			}
			const hit = hitTest(ir, board, pt);
			if (!hit && highlight?.highlightNet) {
				highlight.setHighlightNet(null);
			}
			sel.onSelectHit(hit);
		},
		[ctx, route.isRouting, isArmed, ir, board, sel, svgRef, view, highlight],
	);
}

function buildNavShortcuts(ctx) {
	return {
		toggleLayer: ctx.layers.toggleLayer,
		toggleRoute: ctx.route.toggleRoute,
		cancelRoute: ctx.route.cancelRoute,
		toggleRouteMode: ctx.route.toggleRouteMode,
		togglePosture: ctx.route.togglePostureMode,
		cycleWidthPreset: ctx.route.cycleWidthPreset,
		placeVia: ctx.route.placeViaAndSwitchLayer,
		jumpCopper: ctx.layers.onJumpCopper,
		stepCopper: ctx.layers.onStepCopper,
	};
}

function buildHighlightShortcuts(ctx) {
	return {
		highlightNet: ctx.highlight?.highlightNet,
		highlightMode: ctx.highlight?.highlightMode,
		setHighlightNet: ctx.highlight?.setHighlightNet,
		setHighlightMode: ctx.highlight?.setHighlightMode,
		cancelHighlight: ctx.highlight?.clearHighlight,
		ir: ctx.ir,
		board: ctx.board,
		pads: ctx.pads,
		padPositions: ctx.padPositions,
		get cursorWorld() {
			return ctx.cursorWorldRef?.current;
		},
	};
}

function armToolShortcut(ctx, tool) {
	if (ctx.route.isRouting) ctx.route.cancelRoute();
	ctx.armedPlacement?.disarm();
	ctx.graphicsDrawing?.arm(tool);
	ctx.highlight?.setHighlightMode(false);
}

function buildShortcuts(ctx) {
	return {
		...buildNavShortcuts(ctx),
		...buildHighlightShortcuts(ctx),
		editor: ctx.editor,
		selectedPartId: ctx.sel.selectedPartId,
		armVia: () => armToolShortcut(ctx, "placeVia"),
		armText: () => armToolShortcut(ctx, "placeText"),
		isRouting: ctx.route.isRouting,
		deleteSelected: ctx.sel.deleteSelected,
		undoBoard: ctx.history.undoBoard,
		redoBoard: ctx.history.redoBoard,
		cancelOutline: ctx.outlineDrawing?.cancelOutline,
		cancelGraphics: ctx.graphicsDrawing?.cancelGraphics,
		disarmFootprint: ctx.armedPlacement?.disarm,
		toggleDiffPair: ctx.extraTools?.diffPair?.toggle,
		cancelDiffPair: ctx.extraTools?.diffPair?.cancel,
		toggleTuneLength: ctx.extraTools?.tuneLength?.toggle,
		cancelTuneLength: ctx.extraTools?.tuneLength?.cancel,
		toggleMeasure: ctx.extraTools?.measure?.toggle,
		cancelMeasure: ctx.extraTools?.measure?.cancel,
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
			Boolean(ctx.graphicsDrawing?.activeTool) ||
			Boolean(ctx.highlightNetState?.highlightMode),
		highlightNet: ctx.highlightNetState?.highlightNet,
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
			<ZonesLayer
				zones={sceneData.board?.zones}
				layer={layer}
				highlightNet={sceneData.highlightNet}
			/>
			<TracksLayer
				tracks={sceneData.board?.tracks}
				layer={layer}
				selectedIndex={sceneData.selectedTrackIndex}
				highlightNet={sceneData.highlightNet}
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
				highlightNet={sceneData.highlightNet}
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
	const grid = currentGrid();
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
			layer: activeLayer ?? "F.SilkS",
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

function handleDirectToolClick(activeTool, pt, opts) {
	const { st } = opts;
	if (activeTool === "placeVia") {
		return handleViaClick(pt, {
			pads: opts.pads,
			board: opts.board,
			pushBoard: opts.pushBoard,
		});
	}
	if (activeTool === "placeText") {
		st.onTextSubmit?.("TEXT", pt);
		return true;
	}
	if (activeTool === "text" || activeTool === "drawText") {
		st.onTextSubmit?.("TEXT", pt);
		return true;
	}
	if (activeTool === "addZone") {
		st.setPoints((prev) => [...prev, pt]);
		return true;
	}
	return false;
}

function handleGraphicsClick(e, opts) {
	const { activeTool, points, st, svgEl, view } = opts;
	if (!activeTool || !isLeftClick(e)) return false;
	const pt = calcSnappedBoardPoint(e, svgEl, view);
	if (handleDirectToolClick(activeTool, pt, opts)) return true;
	if (activeTool === "drawArc") {
		return handleArcClick({
			pt,
			points,
			activeLayer: opts.activeLayer,
			board: opts.board,
			pushBoard: opts.pushBoard,
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
		activeLayer: opts.activeLayer,
		board: opts.board,
		pushBoard: opts.pushBoard,
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

function tryCommitZone(st, ctx) {
	const { activeTool, points, board, pushBoard, activeLayer } = ctx;
	if (activeTool === "addZone" && points.length >= 3) {
		const coords = points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
		pushBoard(
			addZone(board, {
				netId: "",
				layer: activeLayer ?? "F.Cu",
				points: coords,
			}),
		);
		st.reset();
		return true;
	}
	return false;
}

function handleGraphicsCancel(st, ctx) {
	if (ctx.textModal.open) {
		ctx.setTextModal(EMPTY_TEXT_MODAL);
		return true;
	}
	if (tryCommitZone(st, ctx)) return true;
	if (ctx.points.length > 0) {
		st.setPoints([]);
		return true;
	}
	if (ctx.activeTool) {
		st.reset();
		return true;
	}
	return false;
}

function useGraphicsCancelCallback(st, ctx) {
	const {
		activeTool,
		points,
		textModal,
		setTextModal,
		board,
		pushBoard,
		activeLayer,
	} = ctx;
	return useCallback(
		() =>
			handleGraphicsCancel(st, {
				activeTool,
				points,
				textModal,
				setTextModal,
				board,
				pushBoard,
				activeLayer,
			}),
		[
			st,
			textModal,
			activeTool,
			points,
			activeLayer,
			board,
			pushBoard,
			setTextModal,
		],
	);
}

function useGraphicsTextCallback({
	textModal,
	board,
	activeLayer,
	pushBoard,
	setTextModal,
}) {
	return useCallback(
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
}

function useGraphicsActions(st, { board, pushBoard, activeLayer }) {
	const cancelGraphics = useGraphicsCancelCallback(st, {
		activeTool: st.activeTool,
		points: st.points,
		textModal: st.textModal,
		setTextModal: st.setTextModal,
		board,
		pushBoard,
		activeLayer,
	});
	const onTextSubmit = useGraphicsTextCallback({
		textModal: st.textModal,
		board,
		activeLayer,
		pushBoard,
		setTextModal: st.setTextModal,
	});
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
			title="Edit Text"
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

function PreviewZone({ points, cursor, color }) {
	const allPts = cursor ? [...points, cursor] : points;
	const ptsStr = allPts.map(formatPt).filter(Boolean).join(" ");
	if (!ptsStr) return null;
	return (
		<polygon
			points={ptsStr}
			fill={color}
			fillOpacity={0.15}
			stroke={color}
			strokeWidth={0.2}
			strokeDasharray="2,2"
		/>
	);
}

function GraphicsPreview({ activeTool, points, cursor, activeLayer }) {
	if (!activeTool || !cursor || points.length === 0) return null;
	const color = getLayerColor(PCB_THEME, activeLayer);
	if (activeTool === "drawArc") {
		return <PreviewArc points={points} cursor={cursor} color={color} />;
	}
	if (activeTool === "addZone") {
		return <PreviewZone points={points} cursor={cursor} color={color} />;
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

function disarmTools({ route, armedPlacement, graphicsDrawing, highlight }) {
	if (route.isRouting) route.cancelRoute();
	armedPlacement.disarm();
	graphicsDrawing.disarm();
	highlight?.setHighlightMode(false);
}

function cancelExtraTools(tools) {
	tools.extraTools?.diffPair?.cancel();
	tools.extraTools?.tuneLength?.cancel();
	tools.extraTools?.measure?.cancel();
}

function handleSelectTool(tools) {
	disarmTools(tools);
	cancelExtraTools(tools);
}

function handleRouteTrack(tools) {
	tools.armedPlacement.disarm();
	tools.graphicsDrawing.disarm();
	tools.highlight?.setHighlightMode(false);
	cancelExtraTools(tools);
	if (!tools.route.isRouting) tools.route.toggleRoute();
}

function handleRouteDiffPair(tools) {
	disarmTools(tools);
	cancelExtraTools(tools);
	tools.extraTools?.diffPair?.arm();
}

function handleTuneLength(tools) {
	disarmTools(tools);
	cancelExtraTools(tools);
	tools.extraTools?.tuneLength?.arm();
}

function handleMeasure(tools) {
	disarmTools(tools);
	cancelExtraTools(tools);
	tools.extraTools?.measure?.arm();
}

function handlePlaceFootprint(item, tools) {
	disarmTools(tools);
	if (item) tools.armedPlacement.setArmed(item);
}

function handleHighlightNetTool(tools) {
	if (tools.route.isRouting) tools.route.cancelRoute();
	tools.armedPlacement.disarm();
	tools.graphicsDrawing.disarm();
	tools.highlight?.setHighlightMode(true);
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
	highlight,
	extraTools,
}) {
	const tools = {
		route,
		armedPlacement,
		graphicsDrawing,
		highlight,
		extraTools,
	};
	const armGfx = (tool) => {
		if (route.isRouting) route.cancelRoute();
		extraTools?.diffPair?.cancel();
		extraTools?.tuneLength?.cancel();
		extraTools?.measure?.cancel();
		armedPlacement.disarm();
		graphicsDrawing.arm(tool);
		highlight?.setHighlightMode(false);
	};
	const onVia = () => handleViaTool(route, armGfx);
	return {
		select: () => handleSelectTool(tools),
		highlightNet: () => handleHighlightNetTool(tools),
		drawLine: () => armGfx("drawLine"),
		drawRect: () => armGfx("drawRect"),
		drawCircle: () => armGfx("drawCircle"),
		placeDimension: () => armGfx("placeDimension"),
		drawArc: () => armGfx("drawArc"),
		placeText: () => armGfx("placeText"),
		drawText: () => armGfx("placeText"),
		text: () => armGfx("placeText"),
		addZone: () => armGfx("addZone"),
		routeTrack: () => handleRouteTrack(tools),
		routeDiffPair: () => handleRouteDiffPair(tools),
		tuneLength: () => handleTuneLength(tools),
		measure: () => handleMeasure(tools),
		addVia: onVia,
		placeVia: onVia,
		setLayer: (item) => handleSetLayer(item, layers),
		placeFootprint: (item) => handlePlaceFootprint(item, tools),
	};
}

function reportActiveTool(
	isRouting,
	armedFootprint,
	activeGraphicsTool,
	activeToolOverride,
) {
	if (activeToolOverride) {
		emitActiveTool({ tab: "pcb", tool: activeToolOverride, item: null });
		return;
	}
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
	highlight,
	extraTools,
}) {
	const handlersRef = useRef({});
	handlersRef.current = createToolBusHandlers({
		route,
		layers,
		armedPlacement,
		graphicsDrawing,
		highlight,
		extraTools,
	});

	const activeExtra =
		(extraTools?.diffPair?.active && "routeDiffPair") ||
		(extraTools?.tuneLength?.active && "tuneLength") ||
		(extraTools?.measure?.measure?.active && "measure") ||
		null;

	useEffect(() => {
		reportActiveTool(
			route.isRouting,
			armedPlacement.armed,
			graphicsDrawing.activeTool,
			highlight?.highlightMode ? "highlightNet" : activeExtra,
		);
	}, [
		route.isRouting,
		armedPlacement.armed,
		graphicsDrawing.activeTool,
		highlight?.highlightMode,
		activeExtra,
	]);

	useEffect(() => {
		return onEditorTool((payload) => {
			focusCanvas(containerRef);
			const handler = handlersRef.current[payload?.tool];
			handler?.(payload?.item);
		}, "pcb");
	}, [containerRef]);
}

function handleExtraSceneClick(e, ctx) {
	if (!ctx?.extraTools) return false;
	const { extraTools, board, svgRef, view } = ctx;
	const pt = screenToBoardCoords(e, svgRef?.current, view);
	if (extraTools.measure?.measure?.active) {
		extraTools.measure.onCanvasClick(pt);
		return true;
	}
	if (extraTools.diffPair?.active && extraTools.diffPair.onCanvasClick(pt)) {
		return true;
	}
	if (extraTools.tuneLength?.active) {
		const hit = hitTest({ parts: [] }, board, pt);
		if (hit?.kind === "track") {
			extraTools.tuneLength.onTrackClick(hit.index, pt);
			return true;
		}
	}
	return false;
}

function handleExtraPointerMove(e, ctx) {
	const { extraTools, svgRef, view } = ctx ?? {};
	if (!extraTools?.diffPair?.active && !extraTools?.measure?.measure?.active) {
		return;
	}
	const pt = screenToBoardCoords(e, svgRef?.current, view);
	if (extraTools.diffPair?.active) extraTools.diffPair.onPointerMove(pt);
	if (extraTools.measure?.measure?.active) extraTools.measure.onPointerMove(pt);
}

function useSceneClick(routeClick, armedPlacement, graphicsDrawing, sceneCtx) {
	return useCallback(
		(e) => {
			if (graphicsDrawing?.onCanvasClick(e)) return;
			if (armedPlacement?.onCanvasClick(e)) return;
			if (handleExtraSceneClick(e, sceneCtx)) return;
			routeClick(e);
		},
		[routeClick, armedPlacement, graphicsDrawing, sceneCtx],
	);
}

function useScenePointer(ptrMove, armedPlacement, graphicsDrawing, sceneCtx) {
	return useCallback(
		(e) => {
			ptrMove(e);
			armedPlacement?.onPointerMove(e);
			graphicsDrawing?.onPointerMove(e);
			sceneCtx?.onHover?.(e);
			handleExtraPointerMove(e, sceneCtx);
		},
		[ptrMove, armedPlacement, graphicsDrawing, sceneCtx],
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

function MeasureBadge({ midX, midY, text }) {
	return (
		<>
			<rect
				x={midX - 14}
				y={midY - 3.5}
				width={28}
				height={4}
				rx={0.8}
				fill="rgba(15, 23, 42, 0.88)"
				stroke="#38bdf8"
				strokeWidth={0.15}
			/>
			<text
				x={midX}
				y={midY - 1}
				fill="#f0f9ff"
				fontSize={1.3}
				textAnchor="middle"
				fontFamily="monospace"
			>
				{text}
			</text>
		</>
	);
}

function MeasurePreview({ measure, readout }) {
	if (!measure?.start || !measure?.end || !readout) return null;
	const { start, end } = measure;
	const x1 = Array.isArray(start) ? start[0] : start.x;
	const y1 = Array.isArray(start) ? start[1] : start.y;
	const x2 = Array.isArray(end) ? end[0] : end.x;
	const y2 = Array.isArray(end) ? end[1] : end.y;
	return (
		<g className="pcb-measure-preview" style={{ pointerEvents: "none" }}>
			<line
				x1={x1}
				y1={y1}
				x2={x2}
				y2={y2}
				stroke="#38bdf8"
				strokeWidth={0.25}
				strokeDasharray="0.8,0.8"
			/>
			<circle cx={x1} cy={y1} r={0.3} fill="#38bdf8" />
			<circle cx={x2} cy={y2} r={0.3} fill="#38bdf8" />
			<MeasureBadge
				midX={(x1 + x2) / 2}
				midY={(y1 + y2) / 2}
				text={readout.text}
			/>
		</g>
	);
}

function DiffPairPreview({ proposedPair, activeLayer, widthMm = 0.2 }) {
	if (!proposedPair?.p || !proposedPair?.n) return null;
	const color = getLayerColor(PCB_THEME, activeLayer);
	const ptsToStr = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(" ");
	return (
		<g className="pcb-diffpair-preview" style={{ pointerEvents: "none" }}>
			<polyline
				points={ptsToStr(proposedPair.p)}
				stroke={color}
				strokeWidth={widthMm}
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<polyline
				points={ptsToStr(proposedPair.n)}
				stroke={color}
				strokeWidth={widthMm}
				fill="none"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</g>
	);
}

function TuneField({ label, value, onChange }) {
	return (
		<label
			style={{
				display: "flex",
				justifyContent: "space-between",
				gap: "8px",
			}}
		>
			{label}
			<input
				type="number"
				step="0.1"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				style={{
					width: "70px",
					background: "#1f293d",
					border: "1px solid #334155",
					color: "#f1f5f9",
					borderRadius: "3px",
					padding: "1px 4px",
				}}
			/>
		</label>
	);
}

const TUNE_POPOVER_STYLE = {
	position: "absolute",
	bottom: "40px",
	left: "12px",
	background: "#161b2b",
	border: "1px solid #334155",
	borderRadius: "6px",
	padding: "10px 14px",
	color: "#f1f5f9",
	fontSize: "12px",
	zIndex: 25,
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
};

function LengthTuneHeader({ onClose }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
			}}
		>
			<strong>Tune Track Length</strong>
			<button
				type="button"
				onClick={onClose}
				style={{
					background: "transparent",
					border: "none",
					color: "#94a3b8",
					cursor: "pointer",
					fontSize: "14px",
				}}
			>
				×
			</button>
		</div>
	);
}

const TUNE_APPLY_STYLE = {
	background: "#3b82f6",
	border: "none",
	color: "#fff",
	padding: "4px 10px",
	borderRadius: "4px",
	cursor: "pointer",
	fontWeight: "bold",
};

function LengthTuneFooter({ statusText, onApply }) {
	const statusColor = statusText?.includes("not") ? "#f87171" : "#4ade80";
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginTop: "4px",
			}}
		>
			<button type="button" onClick={onApply} style={TUNE_APPLY_STYLE}>
				Apply
			</button>
			{statusText && (
				<span style={{ color: statusColor, fontWeight: "500" }}>
					{statusText}
				</span>
			)}
		</div>
	);
}

function LengthTuneCard({ popover, onApply, onClose }) {
	const [target, setTarget] = useState(popover.targetLengthMm);
	const [amp, setAmp] = useState(popover.amplitudeMm);
	const [spc, setSpc] = useState(popover.spacingMm);
	return (
		<div style={TUNE_POPOVER_STYLE}>
			<LengthTuneHeader onClose={onClose} />
			<div>Current length: {popover.currentLength.toFixed(2)} mm</div>
			<TuneField label="Target (mm):" value={target} onChange={setTarget} />
			<TuneField label="Amplitude (mm):" value={amp} onChange={setAmp} />
			<TuneField label="Spacing (mm):" value={spc} onChange={setSpc} />
			<LengthTuneFooter
				statusText={popover.statusText}
				onApply={() =>
					onApply({
						targetLengthMm: target,
						amplitudeMm: amp,
						spacingMm: spc,
					})
				}
			/>
		</div>
	);
}

function LengthTunePopover({ popover, onApply, onClose }) {
	if (!popover) return null;
	return (
		<LengthTuneCard popover={popover} onApply={onApply} onClose={onClose} />
	);
}

const MEASURE_TRANSITIONS = {
	arm: () => ({ active: true, start: null, end: null, frozen: false }),
	cancel: () => ({ active: false, start: null, end: null, frozen: false }),
	toggle: (m) => ({ active: !m.active, start: null, end: null, frozen: false }),
	click: (m, { pt }) => {
		if (!m.active) return m;
		const startNew = !m.start || m.frozen;
		return startNew
			? { active: true, start: pt, end: pt, frozen: false }
			: { ...m, end: pt, frozen: true };
	},
	move: (m, { pt }) => {
		const tracking = m.active && m.start && !m.frozen;
		return tracking ? { ...m, end: pt } : m;
	},
};

function measureReducer(m, action) {
	const handler = MEASURE_TRANSITIONS[action.type];
	return handler ? handler(m, action) : m;
}

function useMeasureTool(statusUnits) {
	const [measure, dispatch] = useReducer(measureReducer, {
		active: false,
		start: null,
		end: null,
		frozen: false,
	});
	const arm = useCallback(() => dispatch({ type: "arm" }), []);
	const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
	const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
	const onCanvasClick = useCallback(
		(pt) => dispatch({ type: "click", pt }),
		[],
	);
	const onPointerMove = useCallback((pt) => dispatch({ type: "move", pt }), []);
	const readout = useMemo(() => {
		if (!measure.start || !measure.end) return null;
		return calcMeasureReadout(measure.start, measure.end, statusUnits);
	}, [measure.start, measure.end, statusUnits]);
	return {
		measure,
		readout,
		arm,
		cancel,
		toggle,
		onCanvasClick,
		onPointerMove,
	};
}

function buildTrackPopoverState(track, trackIndex, pt) {
	if (!track) return null;
	const pts =
		Array.isArray(track.points) && track.points.length >= 2
			? track.points
			: [track.start, track.end];
	const len = pathLength(pts);
	return {
		trackIndex,
		points: pts,
		currentLength: len,
		...calcLengthTuneDefaults(len),
		pos: pt,
		statusText: "",
	};
}

function applyMeanderToTrack({ popover, opts, board, pushBoard }) {
	const res = meander({
		points: popover.points,
		targetLengthMm: Number(opts.targetLengthMm),
		amplitudeMm: Number(opts.amplitudeMm),
		spacingMm: Number(opts.spacingMm),
	});
	pushBoard(replaceTrackWithPoints(board, popover.trackIndex, res.points));
	return {
		...popover,
		points: res.points,
		currentLength: res.lengthMm,
		statusText: res.reached ? "reached" : "not reached",
	};
}

function useTuneLengthTool({ board, pushBoard }) {
	const [active, setActive] = useState(false);
	const [popover, setPopover] = useState(null);
	const closePopover = useCallback(() => setPopover(null), []);
	const setArmed = useCallback((val) => {
		setActive(val);
		setPopover(null);
	}, []);
	const arm = useCallback(() => setArmed(true), [setArmed]);
	const cancel = useCallback(() => setArmed(false), [setArmed]);
	const toggle = useCallback(() => {
		setActive((a) => !a);
		setPopover(null);
	}, []);

	const onTrackClick = useCallback(
		(idx, pt) => {
			const next = buildTrackPopoverState(board?.tracks?.[idx], idx, pt);
			if (next) setPopover(next);
		},
		[board],
	);

	const apply = useCallback(
		(opts) => {
			if (!popover) return;
			setPopover((p) =>
				p ? applyMeanderToTrack({ popover: p, opts, board, pushBoard }) : null,
			);
		},
		[popover, board, pushBoard],
	);

	return {
		active,
		popover,
		arm,
		cancel,
		toggle,
		closePopover,
		onTrackClick,
		apply,
	};
}

function resolveDiffPairNetAssignment(session, pStart, nStart) {
	const sx = session.startPad?.pos?.[0] ?? 0;
	const sy = session.startPad?.pos?.[1] ?? 0;
	const pDist = Math.hypot(pStart[0] - sx, pStart[1] - sy);
	const nDist = Math.hypot(nStart[0] - sx, nStart[1] - sy);
	return pDist <= nDist
		? { pNet: session.startNet, nNet: session.partnerNet }
		: { pNet: session.partnerNet, nNet: session.startNet };
}

function commitDiffPairTracks(session, board, activeLayer, pushBoard) {
	if (session.centerline.length < 1) return false;
	const dims = resolveDiffPairDimensions(board);
	const { p, n } = proposeDiffPair({
		centerline: session.centerline,
		widthMm: dims.widthMm,
		gapMm: dims.gapMm,
	});
	if (p.length < 2 || n.length < 2) return false;
	const { pNet, nNet } = resolveDiffPairNetAssignment(session, p[0], n[0]);
	const b1 = addTrack(board, {
		netId: pNet,
		layer: activeLayer,
		points: p,
		widthMm: dims.widthMm,
	});
	const b2 = addTrack(b1, {
		netId: nNet,
		layer: activeLayer,
		points: n,
		widthMm: dims.widthMm,
	});
	pushBoard(b2);
	return true;
}

function calcProposedDiffPair(centerline, cursorPos, posture, board) {
	if (centerline.length === 0 || !cursorPos) return null;
	const last = centerline[centerline.length - 1];
	const legs = legPoints(last, cursorPos, "45", posture);
	const dims = resolveDiffPairDimensions(board);
	return proposeDiffPair({
		centerline: [...centerline, ...legs],
		widthMm: dims.widthMm,
		gapMm: dims.gapMm,
	});
}

function startDiffPairRoute(pt, ctx, setSession, setStatusHint) {
	const padInfo = findPadInfoAtPoint(pt, ctx);
	if (!padInfo || !isDiffPairName(padInfo.netName)) {
		setStatusHint("Not a differential pair net");
		return false;
	}
	setStatusHint("");
	const partnerName = partnerNetName(padInfo.netName);
	const partnerPad = findPartnerPad(padInfo, partnerName, ctx);
	const p1 = padInfo.pos;
	const p2 = partnerPad?.pos ?? padInfo.pos;
	const centerStart = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
	setSession({
		startPad: padInfo,
		partnerPad,
		startNet: padInfo.netId || padInfo.netName,
		partnerNet: partnerPad?.netId || partnerName,
		centerline: [centerStart],
		cursorPos: pt,
	});
	return true;
}

const EMPTY_DP_SESSION = Object.freeze({
	startPad: null,
	partnerPad: null,
	startNet: "",
	partnerNet: "",
	centerline: [],
	cursorPos: null,
});

function extendDiffPairCenterline(session, pt, posture) {
	const last = session.centerline[session.centerline.length - 1];
	return {
		...session,
		centerline: [...session.centerline, ...legPoints(last, pt, "45", posture)],
	};
}

function handleDiffPairCanvasClick({
	active,
	session,
	setSession,
	setStatusHint,
	props,
	pt,
}) {
	if (!active) return false;
	if (session.centerline.length === 0) {
		const { ir, padPositions, pads, netNames } = props;
		return startDiffPairRoute(
			pt,
			{ ir, padPositions, pads, netNames },
			setSession,
			setStatusHint,
		);
	}
	setSession((s) => extendDiffPairCenterline(s, pt, props.posture));
	return true;
}

function handleDiffPairDoubleClick({
	active,
	session,
	setSession,
	board,
	activeLayer,
	pushBoard,
	e,
}) {
	if (!active || session.centerline.length < 1) return false;
	e?.preventDefault?.();
	const committed = commitDiffPairTracks(
		session,
		board,
		activeLayer,
		pushBoard,
	);
	if (committed) setSession(EMPTY_DP_SESSION);
	return committed;
}

function useDiffPairLifecycle(setStatusHint) {
	const [active, setActive] = useState(false);
	const [session, setSession] = useState(EMPTY_DP_SESSION);
	const arm = useCallback(() => {
		setActive(true);
		setSession(EMPTY_DP_SESSION);
	}, []);
	const cancel = useCallback(() => {
		setActive(false);
		setSession(EMPTY_DP_SESSION);
		setStatusHint("");
	}, [setStatusHint]);
	const toggle = useCallback(() => {
		setActive((a) => !a);
		setSession(EMPTY_DP_SESSION);
	}, []);
	return { active, session, setSession, arm, cancel, toggle };
}

function useDiffPairTool(props) {
	const { board, activeLayer, posture, pushBoard, setStatusHint } = props;
	const { active, session, setSession, arm, cancel, toggle } =
		useDiffPairLifecycle(setStatusHint);

	const onCanvasClick = useCallback(
		(pt) =>
			handleDiffPairCanvasClick({
				active,
				session,
				setSession,
				setStatusHint,
				props,
				pt,
			}),
		[active, session, setSession, props, setStatusHint],
	);

	const onDoubleClick = useCallback(
		(e) =>
			handleDiffPairDoubleClick({
				active,
				session,
				setSession,
				board,
				activeLayer,
				pushBoard,
				e,
			}),
		[active, session, setSession, board, activeLayer, pushBoard],
	);

	const onPointerMove = useCallback(
		(pt) => {
			if (active && session.centerline.length > 0) {
				setSession((s) => ({ ...s, cursorPos: pt }));
			}
		},
		[active, session.centerline.length, setSession],
	);

	const proposedPair = useMemo(
		() =>
			calcProposedDiffPair(
				session.centerline,
				session.cursorPos,
				posture,
				board,
			),
		[session.centerline, session.cursorPos, posture, board],
	);

	return {
		active,
		isRouting: session.centerline.length > 0,
		proposedPair,
		arm,
		cancel,
		toggle,
		onCanvasClick,
		onDoubleClick,
		onPointerMove,
	};
}

function useExtraPcbTools(options) {
	const {
		board,
		pushBoard,
		ir,
		padPositions,
		pads,
		netNames,
		activeLayer,
		posture,
		statusUnits,
		setStatusHint,
	} = options;
	const measure = useMeasureTool(statusUnits);
	const tuneLength = useTuneLengthTool({ board, pushBoard });
	const diffPair = useDiffPairTool({
		board,
		ir,
		padPositions,
		pads,
		netNames,
		activeLayer,
		posture,
		pushBoard,
		setStatusHint,
	});
	return { measure, tuneLength, diffPair };
}

function PcbSvgOverlays({
	markers,
	zoom,
	outlineDrawing,
	graphicsDrawing,
	armedPlacement,
	activeLayer,
	extraTools,
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
			<DiffPairPreview
				proposedPair={extraTools?.diffPair?.proposedPair}
				activeLayer={activeLayer}
			/>
			<MeasurePreview
				measure={extraTools?.measure?.measure}
				readout={extraTools?.measure?.readout}
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
			{showVias && (
				<ViasLayer
					vias={sceneData.board?.vias}
					highlightNet={sceneData.highlightNet}
				/>
			)}
			<RatsnestLayer
				lines={sceneData.rnLines}
				highlightNet={sceneData.highlightNet}
			/>
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

// --- PCB Grid pure helpers ---

export function currentGrid(status) {
	const s = status !== undefined ? status : getEditorStatus();
	const g = Number(s?.grid);
	return Number.isFinite(g) && g > 0 ? g : 0.25;
}

export function adaptiveStepMultiple(gridPitch, zoom, minPx = 8) {
	const pitch = Number(gridPitch);
	const z = Number(zoom);
	const spacing = pitch * z;
	if (!Number.isFinite(spacing) || spacing <= 0 || spacing >= minPx) {
		return 1;
	}
	const multipliers = [
		2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
	];
	return multipliers.find((m) => m * spacing >= minPx) ?? 1;
}

function axisSpan(pan, size, zoom, step) {
	const min = -pan / zoom + 0;
	const max = (size - pan) / zoom + 0;
	return {
		min,
		max,
		start: Math.floor(min / step) * step + 0,
		end: Math.ceil(max / step) * step + 0,
	};
}

function gridDimension(val, fallback) {
	return typeof val === "number" && val > 0 ? val : fallback;
}

function safeGridPitch(step) {
	const n = Number(step);
	return n > 0 ? n : 0.25;
}

function safePanCoord(val) {
	return typeof val === "number" ? val : 0;
}

export function visibleGridRange(view, size, step = 0.25) {
	const zoom = gridDimension(view?.zoom, 1);
	const width = gridDimension(size?.width, 800);
	const height = gridDimension(size?.height, 600);
	const pan = view?.pan;
	const s = safeGridPitch(step);
	const x = axisSpan(safePanCoord(pan?.x), width, zoom, s);
	const y = axisSpan(safePanCoord(pan?.y), height, zoom, s);
	return {
		minX: x.min,
		maxX: x.max,
		minY: y.min,
		maxY: y.max,
		startX: x.start,
		endX: x.end,
		startY: y.start,
		endY: y.end,
	};
}

export function getGridColors(theme = PCB_THEME) {
	const dot = theme?.grid ?? "#3a3f4b";
	const major = theme?.gridMajor ?? (theme?.grid ? "#a6a6a6" : "#4f5563");
	return { dot, major };
}

// --- End PCB Grid pure helpers ---

function PcbGridDefs(props) {
	const { step, majorStep, dotR, majorR, dot, major } = props;
	return (
		<defs>
			<pattern
				id="pcb-grid-minor"
				x={-step / 2}
				y={-step / 2}
				width={step}
				height={step}
				patternUnits="userSpaceOnUse"
			>
				<circle cx={step / 2} cy={step / 2} r={dotR} fill={dot} />
			</pattern>
			<pattern
				id="pcb-grid-major"
				x={-majorStep / 2}
				y={-majorStep / 2}
				width={majorStep}
				height={majorStep}
				patternUnits="userSpaceOnUse"
			>
				<circle cx={majorStep / 2} cy={majorStep / 2} r={majorR} fill={major} />
			</pattern>
		</defs>
	);
}

function PcbGrid({ view, size, gridPitch, theme = PCB_THEME }) {
	const zoom = view?.zoom || 1;
	const step = gridPitch * adaptiveStepMultiple(gridPitch, zoom);
	const majorStep = step * 10;
	const { minX, maxX, minY, maxY } = visibleGridRange(view, size, step);
	const { dot, major } = getGridColors(theme);
	const w = Math.max(0, maxX - minX);
	const h = Math.max(0, maxY - minY);
	const defsProps = {
		step,
		majorStep,
		dotR: Math.max(0.01, 0.75 / zoom),
		majorR: Math.max(0.015, 1.0 / zoom),
		dot,
		major,
	};
	return (
		<g
			className="pcb-grid"
			opacity={0.6}
			pointerEvents="none"
			style={{ pointerEvents: "none" }}
		>
			<PcbGridDefs {...defsProps} />
			<rect
				x={minX}
				y={minY}
				width={w}
				height={h}
				fill="url(#pcb-grid-minor)"
			/>
			<rect
				x={minX}
				y={minY}
				width={w}
				height={h}
				fill="url(#pcb-grid-major)"
			/>
		</g>
	);
}

function PcbCrosshair({ cursor, view, size, color = PCB_THEME.cursor }) {
	if (!cursor) return null;
	const cx = cursor.x ?? cursor[0];
	const cy = cursor.y ?? cursor[1];
	if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
	const zoom = view?.zoom || 1;
	const bounds = visibleGridRange(view, size);
	const strokeWidth = 1 / zoom;
	return (
		<g
			className="pcb-crosshair"
			pointerEvents="none"
			style={{ pointerEvents: "none" }}
		>
			<line
				x1={bounds.minX}
				y1={cy}
				x2={bounds.maxX}
				y2={cy}
				stroke={color || "#ffffff"}
				strokeOpacity={0.4}
				strokeWidth={strokeWidth}
			/>
			<line
				x1={cx}
				y1={bounds.minY}
				x2={cx}
				y2={bounds.maxY}
				stroke={color || "#ffffff"}
				strokeOpacity={0.4}
				strokeWidth={strokeWidth}
			/>
		</g>
	);
}

function useCanvasSize(ref) {
	const [size, setSize] = useState({ width: 800, height: 600 });
	useEffect(() => {
		const el = ref?.current;
		if (!el) return;
		const update = () => {
			const rect = el.getBoundingClientRect?.();
			if (rect?.width > 0 && rect?.height > 0) {
				setSize({ width: rect.width, height: rect.height });
			}
		};
		update();
		if (typeof ResizeObserver !== "undefined") {
			const ro = new ResizeObserver(update);
			ro.observe(el);
			return () => ro.disconnect();
		}
		if (typeof window !== "undefined") {
			window.addEventListener("resize", update);
			return () => window.removeEventListener("resize", update);
		}
	}, [ref]);
	return size;
}

function useSceneEvents({
	route,
	armedPlacement,
	graphicsDrawing,
	extraTools,
	board,
	svgRef,
	view,
	ptr,
}) {
	const [cursorPoint, setCursorPoint] = useState(null);
	const onPointerLeave = useCallback(() => setCursorPoint(null), []);
	const onHover = useCallback(
		(e) => setCursorPoint(calcSnappedBoardPoint(e, svgRef.current, view)),
		[svgRef, view],
	);
	const onPointerMove = useScenePointer(
		ptr.onPointerMove,
		armedPlacement,
		graphicsDrawing,
		{ onHover, extraTools, svgRef, view },
	);
	const onClick = useSceneClick(
		route.onCanvasClick,
		armedPlacement,
		graphicsDrawing,
		{ extraTools, board, svgRef, view },
	);
	const onDoubleClick = useSceneDoubleClick(
		graphicsDrawing,
		route.onCanvasDoubleClick,
		extraTools?.diffPair?.onDoubleClick,
	);
	return {
		cursorPoint,
		onPointerLeave,
		onPointerMove,
		onClick,
		onDoubleClick,
	};
}

function useSvgSceneState(props) {
	const {
		svgRef,
		view,
		route,
		layerState,
		sceneData,
		drag,
		outlineDrawing,
		armedPlacement,
		graphicsDrawing,
		graphicDrag,
		extraTools,
	} = props;
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
	const ev = useSceneEvents({
		route,
		armedPlacement,
		graphicsDrawing,
		extraTools,
		board: sceneData.board,
		svgRef,
		view,
		ptr,
	});
	const canvasSize = useCanvasSize(svgRef);
	return { order, showVias, ptr, ev, canvasSize };
}

function PcbSceneViewport({ view, size, gridPitch, cursor, contentProps }) {
	const transform = `translate(${view.pan.x},${view.pan.y}) scale(${view.zoom})`;
	return (
		<g transform={transform}>
			<PcbGrid view={view} size={size} gridPitch={gridPitch || currentGrid()} />
			<PcbCrosshair cursor={cursor} view={view} size={size} />
			<PcbSvgContent {...contentProps} />
		</g>
	);
}

function useSceneContentProps(props, s) {
	const overlays = (
		<PcbSvgOverlays
			markers={props.markers}
			zoom={props.view.zoom}
			outlineDrawing={props.outlineDrawing}
			graphicsDrawing={props.graphicsDrawing}
			armedPlacement={props.armedPlacement}
			activeLayer={props.layerState.active}
			extraTools={props.extraTools}
		/>
	);
	return {
		order: s.order,
		sceneData: props.sceneData,
		layerState: props.layerState,
		drag: props.drag,
		showVias: s.showVias,
		route: props.route,
		overlays,
	};
}

function PcbSvgScene(props) {
	const s = useSvgSceneState(props);
	const { ptr, ev } = s;
	const contentProps = useSceneContentProps(props, s);
	return (
		/* biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard handled on parent region */
		<svg
			ref={props.svgRef}
			style={SVG_STYLE}
			onClick={ev.onClick}
			onDoubleClick={ev.onDoubleClick}
			onPointerDown={ptr.onPointerDown}
			onPointerMove={ev.onPointerMove}
			onPointerUp={ptr.onPointerUp}
			onPointerLeave={ev.onPointerLeave}
		>
			<title>PCB Canvas</title>
			<PcbSceneViewport
				view={props.view}
				size={s.canvasSize}
				gridPitch={props.gridPitch}
				cursor={ev.cursorPoint}
				contentProps={contentProps}
			/>
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
	highlight,
	extraTools,
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
			Boolean(armedPlacement.armed) ||
			Boolean(graphicsDrawing.activeTool) ||
			Boolean(highlight?.highlightMode),
		isRouting: route.isRouting,
	});
	useToolBus({
		route,
		layers,
		armedPlacement,
		graphicsDrawing,
		containerRef,
		highlight,
		extraTools,
	});
	return { graphicsDrawing, graphicDrag };
}

function usePcbHighlight() {
	const [highlightNet, setHighlightNet] = useState(null);
	const [highlightMode, setHighlightMode] = useState(false);
	const clearHighlight = useCallback(() => {
		setHighlightNet(null);
		setHighlightMode(false);
	}, []);
	return {
		highlightNet,
		setHighlightNet,
		highlightMode,
		setHighlightMode,
		clearHighlight,
	};
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
	const cursorWorldRef = useRef(null);
	const highlight = usePcbHighlight();
	const gridPitch = useSyncExternalStore(subscribeEditorStatus, currentGrid);
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
	const [statusHint, setStatusHint] = useState("");
	const statusUnits = useSyncExternalStore(
		subscribeEditorStatus,
		() => getEditorStatus()?.units ?? "mm",
	);
	const extraTools = useExtraPcbTools({
		board,
		pushBoard: history.pushBoard,
		ir,
		padPositions,
		pads,
		netNames,
		activeLayer: layers.layerState.active,
		posture: route.posture,
		statusUnits,
		setStatusHint,
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
		highlight,
		extraTools,
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
		highlight,
		pads,
		padPositions,
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
		highlight,
		ir,
		board,
		pads,
		padPositions,
		cursorWorldRef,
		extraTools,
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
		highlightNetState: highlight,
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
		gridPitch,
		highlight,
		cursorWorldRef,
		statusHint,
		extraTools,
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
				const raw = screenToBoardCoords(e, s.svgRef.current, s.view);
				const [x, y] = snapToGrid(raw, s.gridPitch);
				s.cursorWorldRef.current = [x, y];
				onCursorMove?.({ x, y, zoom: s.view.zoom });
			}}
			onPointerLeave={() => {
				s.cursorWorldRef.current = null;
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
				gridPitch={s.gridPitch}
				extraTools={s.extraTools}
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
				highlightNet={s.highlight.highlightNet}
				statusHint={s.statusHint}
				isDiffPair={s.extraTools.diffPair.active}
				measuringText={s.extraTools.measure.readout?.text}
			/>
			<LengthTunePopover
				popover={s.extraTools.tuneLength.popover}
				onApply={s.extraTools.tuneLength.apply}
				onClose={s.extraTools.tuneLength.closePopover}
			/>
			<TextGraphicModal
				open={Boolean(
					s.graphicsDrawing.textModal.open &&
						s.graphicsDrawing.textModal.graphicId,
				)}
				initialText={s.graphicsDrawing.textModal.initialText}
				onSubmit={s.graphicsDrawing.onTextSubmit}
				onCancel={s.graphicsDrawing.onTextCancel}
			/>
		</div>
	);
}
