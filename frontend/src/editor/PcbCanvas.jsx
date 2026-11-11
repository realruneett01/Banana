import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	arcToSvgPath,
	footprintToPrimitives,
	padWorldPositions,
	transformPrimitives,
} from "./footprintRender.js";
import {
	addTrack,
	deleteTrack,
	footprintRect,
	hitTest,
	LAYER_COLORS,
	ratsnest,
	snapToGrid,
} from "./pcbGeometry.js";
import {
	addVia,
	constrainAngle,
	proposeRoute,
	WIDTH_PRESETS,
} from "./routingModel.js";

const CONTAINER_STYLE = Object.freeze({
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "500px",
	display: "flex",
	flexDirection: "column",
	background: "#0d0f18",
	borderRadius: "8px",
	border: "1px solid #23283e",
	color: "#f1f5f9",
	outline: "none",
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
});

const DEFAULT_VISIBLE = Object.freeze({
	"F.Cu": true,
	"B.Cu": true,
	"F.SilkS": true,
	"B.SilkS": true,
	"Edge.Cuts": true,
});

function getBoardBounds(outline) {
	let minX = 0;
	let maxX = 100;
	let minY = 0;
	let maxY = 100;
	if (Array.isArray(outline) && outline.length >= 3) {
		minX = Math.min(...outline.map((p) => p[0]));
		maxX = Math.max(...outline.map((p) => p[0]));
		minY = Math.min(...outline.map((p) => p[1]));
		maxY = Math.max(...outline.map((p) => p[1]));
	}
	const pad = 8;
	const w = Math.max(20, maxX - minX + 2 * pad);
	const h = Math.max(20, maxY - minY + 2 * pad);
	return `${minX - pad} ${minY - pad} ${w} ${h}`;
}

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

function screenToBoardCoords(e, svgEl) {
	if (!svgEl) return [0, 0];
	const pt = svgEl.createSVGPoint();
	pt.x = e.clientX;
	pt.y = e.clientY;
	const ctm = svgEl.getScreenCTM();
	if (!ctm) return [0, 0];
	const svgPt = pt.matrixTransform(ctm.inverse());
	return [svgPt.x, svgPt.y];
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
		else ctx.toggleLayer();
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

function handleRoutingKeys(e, key, ctx) {
	if (!handleRoutingAction(key, ctx)) return false;
	e.preventDefault();
	return true;
}

function handleToolKeys(e, key, ctx) {
	if (handlePartKeys(e, key, ctx)) return;
	if (handleRoutingKeys(e, key, ctx)) return;
	if (key === "delete" || key === "backspace") {
		e.preventDefault();
		ctx.deleteSelected();
	}
}

function handleShortcuts(e, ctx) {
	const key = e.key.toLowerCase();
	if (handleHistoryShortcuts(e, key, ctx)) return;
	handleToolKeys(e, key, ctx);
}

function isValidOutline(outline) {
	return Array.isArray(outline) && outline.length >= 3;
}

function EdgeCutsLayer({ outline, visible }) {
	if (!visible || !isValidOutline(outline)) return null;
	const pts = outline.map((p) => `${p[0]},${p[1]}`).join(" ");
	return (
		<polygon
			points={pts}
			fill="none"
			stroke={LAYER_COLORS["Edge.Cuts"]}
			strokeWidth={0.5}
		/>
	);
}

function ZonesLayer({ zones, visibleLayers }) {
	if (!Array.isArray(zones)) return null;
	return (
		<g className="pcb-zones">
			{zones.map((zone) => {
				if (visibleLayers[zone.layer] === false) return null;
				const pts = (zone.polygon ?? [])
					.map((p) => `${p[0]},${p[1]}`)
					.join(" ");
				const color = LAYER_COLORS[zone.layer] ?? "#c83434";
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

function sortTracks(tracks, activeLayer) {
	if (!Array.isArray(tracks)) return [];
	return tracks
		.map((track, originalIndex) => ({ track, index: originalIndex }))
		.sort((a, b) => {
			const aIsActive = a.track.layer === activeLayer;
			const bIsActive = b.track.layer === activeLayer;
			if (aIsActive === bIsActive) return a.index - b.index;
			return aIsActive ? 1 : -1;
		});
}

function TracksLayer({ tracks, activeLayer, visibleLayers, selectedIndex }) {
	const sorted = useMemo(
		() => sortTracks(tracks, activeLayer),
		[tracks, activeLayer],
	);
	return (
		<g className="pcb-tracks">
			{sorted.map(({ track, index }) => {
				if (visibleLayers[track.layer] === false) return null;
				const isSelected = selectedIndex === index;
				const color = isSelected
					? "#fadb14"
					: (LAYER_COLORS[track.layer] ?? "#c83434");
				const key = `track_${track.layer}_${track.start[0]}_${track.start[1]}_${track.end[0]}_${track.end[1]}`;
				return (
					<line
						key={key}
						x1={track.start[0]}
						y1={track.start[1]}
						x2={track.end[0]}
						y2={track.end[1]}
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
							fill="#10b981"
							stroke="#059669"
							strokeWidth={0.1}
						/>
						<circle cx={x} cy={y} r={innerR} fill="#0d0f18" />
					</g>
				);
			})}
		</g>
	);
}

function PartRefLabel({ rect }) {
	const fontSize = Math.max(0.6, Math.min(rect.w, rect.h) * 0.4);
	return (
		<text
			x={rect.x}
			y={rect.y}
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
	const stroke = isFront ? LAYER_COLORS["F.SilkS"] : LAYER_COLORS["B.SilkS"];
	return { stroke, strokeWidth: 0.25 };
}

function PartShape({ rect, isSelected }) {
	const isFront = rect.side !== "B";
	const { stroke, strokeWidth } = resolvePartColors(isFront, isSelected);
	const fill = isFront ? "rgba(56, 189, 248, 0.2)" : "rgba(167, 139, 250, 0.2)";
	const rot = rect.rot ? `rotate(${rect.rot} ${rect.x} ${rect.y})` : undefined;
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

function handlePartKey(e, partId, onSelectPart) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		onSelectPart(partId);
	}
}

function resolveGraphicColor(layer) {
	if (layer === "F.SilkS") return LAYER_COLORS["F.SilkS"];
	if (layer === "B.SilkS") return LAYER_COLORS["B.SilkS"];
	return LAYER_COLORS[layer] ?? "#94a3b8";
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

function FootprintGraphic({ graphic, visibleLayers }) {
	if (visibleLayers[graphic.layer] === false) return null;
	const Component = GRAPHIC_COMPONENTS[graphic.type];
	if (!Component) return null;
	const color = resolveGraphicColor(graphic.layer);
	const width = graphic.width || 0.12;
	return <Component g={graphic} color={color} width={width} />;
}

function isThruHole(pad) {
	return pad.padType === "thru_hole" || pad.layers.includes("*.Cu");
}

function isPadVisible(pad, isBack, visibleLayers) {
	if (isThruHole(pad)) {
		return visibleLayers["F.Cu"] !== false || visibleLayers["B.Cu"] !== false;
	}
	const layer = isBack ? "B.Cu" : "F.Cu";
	return visibleLayers[layer] !== false;
}

function calcPadCornerRadius(shape, w, h) {
	if (shape === "roundrect") return Math.min(w, h) * 0.25;
	if (shape === "oval") return Math.min(w, h) / 2;
	return 0;
}

function PadShapeElement({ pad, color, rot }) {
	const [cx, cy] = pad.center;
	const [w, h] = pad.size;
	if (pad.shape === "circle") {
		return <circle cx={cx} cy={cy} r={w / 2} fill={color} />;
	}
	const rx = calcPadCornerRadius(pad.shape, w, h);
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

function FootprintPad({ pad, isBack, visibleLayers }) {
	if (!isPadVisible(pad, isBack, visibleLayers)) return null;
	const isThru = isThruHole(pad);
	const color = isBack ? LAYER_COLORS["B.Cu"] : LAYER_COLORS["F.Cu"];
	const [cx, cy] = pad.center;
	const rot = pad.rot ? `rotate(${pad.rot} ${cx} ${cy})` : undefined;
	const drillR = calcDrillRadius(pad);
	const fontSize = Math.min(pad.size[0], pad.size[1]) * 0.35;
	return (
		<g>
			<PadShapeElement pad={pad} color={color} rot={rot} />
			{isThru && <circle cx={cx} cy={cy} r={drillR} fill="#0d0f18" />}
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

function FootprintShape({ fp, part, rect, isSelected, visibleLayers }) {
	const prims = useMemo(
		() => transformPrimitives(footprintToPrimitives(fp), part.placement),
		[fp, part.placement],
	);
	const isBack = rect.side === "B";
	const rot = rect.rot ? `rotate(${rect.rot} ${rect.x} ${rect.y})` : undefined;
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
					visibleLayers={visibleLayers}
				/>
			))}
			{prims.pads.map((pad) => (
				<FootprintPad
					key={`pad_${pad.number}`}
					pad={pad}
					isBack={isBack}
					visibleLayers={visibleLayers}
				/>
			))}
			<PartRefLabel rect={rect} />
		</g>
	);
}

function PartItem({
	part,
	isSelected,
	visibleLayers,
	onSelectPart,
	onStartDrag,
	fp,
}) {
	const rect = footprintRect(part);
	if (!rect) return null;
	const layerKey = rect.side === "B" ? "B.SilkS" : "F.SilkS";
	if (visibleLayers[layerKey] === false) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG elements cannot be replaced with HTML button
		<g
			role="button"
			tabIndex={0}
			aria-label={`Part ${rect.ref}`}
			onClick={(e) => {
				e.stopPropagation();
				onSelectPart(part.id);
			}}
			onKeyDown={(e) => handlePartKey(e, part.id, onSelectPart)}
			onPointerDown={(e) => onStartDrag(e, part)}
		>
			{fp ? (
				<FootprintShape
					fp={fp}
					part={part}
					rect={rect}
					isSelected={isSelected}
					visibleLayers={visibleLayers}
				/>
			) : (
				<PartShape rect={rect} isSelected={isSelected} />
			)}
		</g>
	);
}

function PartsLayer({
	parts,
	selectedId,
	visibleLayers,
	onSelectPart,
	onStartDrag,
	fpCache,
}) {
	if (!Array.isArray(parts)) return null;
	return (
		<g className="pcb-parts">
			{parts.map((p) => (
				<PartItem
					key={p.id}
					part={p}
					isSelected={selectedId === p.id}
					visibleLayers={visibleLayers}
					onSelectPart={onSelectPart}
					onStartDrag={onStartDrag}
					fp={fpCache?.[p.footprint ?? p.props?.footprint]}
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
					stroke="rgba(251, 191, 36, 0.45)"
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

function RoutingPreviewLayer({
	points,
	proposed,
	activeLayer,
	widthMm = 0.25,
}) {
	if (!hasPreviewContent(points, proposed)) return null;

	const color = LAYER_COLORS[activeLayer] ?? "#c83434";
	const collisions = proposed?.collisions ?? [];
	const hasPoints = hasPreviewPoints(points);
	const hasProposed = hasProposedPoints(proposed);

	return (
		<g className="pcb-routing-preview" style={{ pointerEvents: "none" }}>
			{hasPoints &&
				points.map((pt, i) => {
					if (i === 0) return null;
					const prev = points[i - 1];
					return (
						<RoutingProposedSegment
							key={`route_${prev[0]}_${prev[1]}_${pt[0]}_${pt[1]}`}
							p1={prev}
							p2={pt}
							isColliding={false}
							color={color}
							widthMm={widthMm}
						/>
					);
				})}
			{hasProposed &&
				proposed.points.slice(1).map((pt, i) => {
					const prev = proposed.points[i];
					const isColliding = collisions.some((c) => c.segmentIndex === i);
					return (
						<RoutingProposedSegment
							key={`prop_${prev[0]}_${prev[1]}_${pt[0]}_${pt[1]}`}
							p1={prev}
							p2={pt}
							isColliding={isColliding}
							color={color}
							widthMm={widthMm}
						/>
					);
				})}
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

function LayerCheckboxes({ visibleLayers, onToggleLayer }) {
	const layers = ["F.Cu", "B.Cu", "F.SilkS", "B.SilkS", "Edge.Cuts"];
	return (
		<div
			style={{
				display: "flex",
				gap: "10px",
				alignItems: "center",
				flexWrap: "wrap",
			}}
		>
			<span style={{ fontSize: "12px", fontWeight: 600, color: "#94a3b8" }}>
				Layers:
			</span>
			{layers.map((layer) => (
				<label
					key={layer}
					htmlFor={`chk_layer_${layer}`}
					style={{
						display: "flex",
						alignItems: "center",
						gap: "4px",
						fontSize: "12px",
						cursor: "pointer",
					}}
				>
					<input
						type="checkbox"
						id={`chk_layer_${layer}`}
						checked={visibleLayers[layer] !== false}
						onChange={() => onToggleLayer(layer)}
					/>
					<span style={{ color: LAYER_COLORS[layer] ?? "#cbd5e1" }}>
						{layer}
					</span>
				</label>
			))}
		</div>
	);
}

function PcbToolbar({
	activeLayer,
	isRouting,
	onToggleLayer,
	onToggleRoute,
	visibleLayers,
	onToggleLayerVis,
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
					color={LAYER_COLORS[activeLayer]}
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
			<LayerCheckboxes
				visibleLayers={visibleLayers}
				onToggleLayer={onToggleLayerVis}
			/>
		</div>
	);
}

function PcbStatusBar({ isRouting, widthPreset, routeMode }) {
	return (
		<div style={STATUS_BAR_STYLE}>
			<span>
				Width:{" "}
				<strong style={{ color: "#f1f5f9" }}>{widthPreset?.label}</strong> (
				{widthPreset?.hint}) [W] | Mode:{" "}
				<strong style={{ color: "#f1f5f9" }}>{routeMode}°</strong> [/]
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

function createPartDrag(e, part, svgEl) {
	if (e.button !== 0 || !part.placement) return null;
	const [x, y] = screenToBoardCoords(e, svgEl);
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

function usePartDrag(editor, svgRef) {
	const dragRef = useRef(null);

	const onStartDrag = useCallback(
		(e, part) => {
			dragRef.current = createPartDrag(e, part, svgRef.current);
		},
		[svgRef],
	);

	const onDropDrag = useCallback(
		(e) => {
			const drag = dragRef.current;
			dragRef.current = null;
			if (!drag?.moved) return;
			const [x, y] = calcDropPos(drag, screenToBoardCoords(e, svgRef.current));
			editor.dispatch({ type: "movePart", partId: drag.partId, x, y });
		},
		[editor, svgRef],
	);

	const onPointerMove = useCallback(
		(e) => {
			if (dragRef.current) {
				checkDragMoved(dragRef.current, screenToBoardCoords(e, svgRef.current));
			}
		},
		[svgRef],
	);

	return { onStartDrag, onDropDrag, onPointerMove };
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

function resolveRouteTarget(raw, hasPoints, snapCtx) {
	const snapped = snapToGrid(raw, 0.25);
	if (!hasPoints) return findSnapEndpoint(snapped, snapCtx);
	return snapped;
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
		pushBoard,
		toggleLayer,
		setPoints,
	} = viaCtx;

	const start = points[points.length - 1] ?? cursorPos ?? [0, 0];
	const target = cursorPos ?? start;
	const cornerPts =
		points.length > 0 ? constrainAngle(start, target, routeMode) : [];
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
	const prop = proposeRoute({
		start,
		cursor: target,
		layer: activeLayer,
		widthMm,
		clearanceMm: 0.2,
		board,
		netId: currentNetId,
		mode: routeMode,
	});
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
	return { routeMode, toggleRouteMode };
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
}) {
	return useMemo(() => {
		if (!isRouting || points.length === 0 || !cursorPos) {
			return { points: [], collisions: [] };
		}
		return proposeRoute({
			start: points[points.length - 1],
			cursor: cursorPos,
			layer: activeLayer,
			widthMm,
			clearanceMm: 0.2,
			board,
			netId: currentNetId,
			mode: routeMode,
		});
	}, [
		isRouting,
		points,
		cursorPos,
		activeLayer,
		widthMm,
		board,
		currentNetId,
		routeMode,
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
	svgRef,
}) {
	const { isRouting, points, currentNetId, setCurrentNetId, setPoints } =
		session;
	return useCallback(
		(e) => {
			if (!isRouting) return;
			const raw = screenToBoardCoords(e, svgRef.current);
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
			const routeCtx = {
				points,
				activeLayer,
				widthMm,
				board,
				currentNetId,
				routeMode,
			};
			if (!checkCommitAllowed(routeCtx, target, e.shiftKey)) return;
			const start = points[points.length - 1];
			setPoints((prev) => [
				...prev,
				...constrainAngle(start, target, routeMode),
			]);
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
			svgRef,
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

function useRoutePointer({ session, svgRef }) {
	const { isRouting, setCursorPos } = session;
	return useCallback(
		(e) => {
			if (!isRouting) return;
			const raw = screenToBoardCoords(e, svgRef.current);
			setCursorPos(snapToGrid(raw, 0.25));
		},
		[isRouting, setCursorPos, svgRef],
	);
}

function useRouteVia({
	session,
	board,
	activeLayer,
	widthMm,
	routeMode,
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
		pushBoard,
		toggleLayer,
		setPoints,
	]);
}

function useRoutingState({
	board,
	activeLayer,
	toggleLayer,
	pushBoard,
	svgRef,
	ir,
	padPositions,
}) {
	const session = useRouteSession();
	const { routeMode, toggleRouteMode } = useRouteMode();
	const { widthPreset, widthMm, cycleWidthPreset } = useRoutePreset();

	const proposedRoute = useRouteProposed({
		isRouting: session.isRouting,
		points: session.points,
		cursorPos: session.cursorPos,
		activeLayer,
		widthMm,
		board,
		currentNetId: session.currentNetId,
		routeMode,
	});

	const onCanvasClick = useRouteClick({
		session,
		board,
		ir,
		padPositions,
		activeLayer,
		widthMm,
		routeMode,
		svgRef,
	});

	const onCanvasDoubleClick = useRouteDoubleClick({
		session,
		board,
		activeLayer,
		widthMm,
		pushBoard,
	});

	const onPointerMove = useRoutePointer({ session, svgRef });
	const placeViaAndSwitchLayer = useRouteVia({
		session,
		board,
		activeLayer,
		widthMm,
		routeMode,
		pushBoard,
		toggleLayer,
	});

	return {
		isRouting: session.isRouting,
		points: session.points,
		cursorPos: session.cursorPos,
		routeMode,
		widthPreset,
		widthMm,
		proposedRoute,
		onCanvasClick,
		onCanvasDoubleClick,
		onPointerMove,
		toggleRoute: session.toggleRoute,
		toggleRouteMode,
		cycleWidthPreset,
		placeViaAndSwitchLayer,
	};
}

function useCanvasSelection(editor, board, pushBoard, onChange) {
	const [selectedTrackIndex, setSelectedTrackIndex] = useState(null);
	const selectedPartId = editor?.selection?.[0] ?? null;

	const deleteSelected = useCallback(() => {
		if (selectedTrackIndex !== null) {
			pushBoard(deleteTrack(board, selectedTrackIndex));
			setSelectedTrackIndex(null);
		} else if (selectedPartId) {
			editor.dispatch({ type: "deletePart", partId: selectedPartId });
		}
	}, [selectedTrackIndex, selectedPartId, board, pushBoard, editor]);

	const onSelectHit = useCallback(
		(hit) => {
			if (hit?.kind === "part") {
				editor.dispatch({ type: "select", ids: [hit.id] });
				setSelectedTrackIndex(null);
			} else if (hit?.kind === "track") {
				setSelectedTrackIndex(hit.index);
				editor.dispatch({ type: "select", ids: [] });
			} else if (!hit) {
				editor.dispatch({ type: "select", ids: [] });
				setSelectedTrackIndex(null);
			}
			onChange?.(editor.state);
		},
		[editor, onChange],
	);

	return { selectedTrackIndex, selectedPartId, deleteSelected, onSelectHit };
}

function shouldFetchFp(fpId, cache, pending) {
	if (!fpId) return false;
	return cache[fpId] === undefined && !pending.has(fpId);
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

function useFootprintCache(parts, fetchFootprint) {
	const [cache, setCache] = useState({});
	const pendingRef = useRef(new Set());

	useEffect(() => {
		if (!fetchFootprint || !Array.isArray(parts)) return;
		for (const p of parts) {
			const fpId = p.footprint ?? p.props?.footprint;
			if (shouldFetchFp(fpId, cache, pendingRef.current)) {
				fetchSingleFootprint(fpId, fetchFootprint, pendingRef, setCache);
			}
		}
	}, [parts, fetchFootprint, cache]);

	return cache;
}

function buildPadPositions(parts, fpCache) {
	const map = {};
	for (const p of parts ?? []) {
		const fpId = p.footprint ?? p.props?.footprint;
		const fp = fpId ? fpCache[fpId] : null;
		if (fp && p.placement) {
			map[p.id] = padWorldPositions(fp, p.placement);
		}
	}
	return map;
}

function useCanvasLayers() {
	const [activeLayer, setActiveLayer] = useState("F.Cu");
	const [visibleLayers, setVisibleLayers] = useState(DEFAULT_VISIBLE);
	const toggleLayer = useCallback(
		() => setActiveLayer((l) => (l === "F.Cu" ? "B.Cu" : "F.Cu")),
		[],
	);
	const toggleLayerVis = useCallback(
		(ly) => setVisibleLayers((v) => ({ ...v, [ly]: v[ly] === false })),
		[],
	);
	return { activeLayer, visibleLayers, toggleLayer, toggleLayerVis };
}

function usePointerDownHandler({ route, sel, ir, board, svgRef }) {
	return useCallback(
		(e) => {
			if (route.isRouting) return;
			const [x, y] = screenToBoardCoords(e, svgRef.current);
			sel.onSelectHit(hitTest(ir, board, [x, y]));
		},
		[route.isRouting, ir, board, sel, svgRef],
	);
}

function buildShortcuts(ctx) {
	return {
		editor: ctx.editor,
		selectedPartId: ctx.sel.selectedPartId,
		toggleLayer: ctx.layers.toggleLayer,
		toggleRoute: ctx.route.toggleRoute,
		toggleRouteMode: ctx.route.toggleRouteMode,
		cycleWidthPreset: ctx.route.cycleWidthPreset,
		placeVia: ctx.route.placeViaAndSwitchLayer,
		isRouting: ctx.route.isRouting,
		deleteSelected: ctx.sel.deleteSelected,
		undoBoard: ctx.history.undoBoard,
		redoBoard: ctx.history.redoBoard,
	};
}

function buildSceneData(ctx) {
	return {
		board: ctx.board,
		ir: ctx.ir,
		rnLines: ctx.rnLines,
		selectedPartId: ctx.sel.selectedPartId,
		selectedTrackIndex: ctx.sel.selectedTrackIndex,
		onSelectPart: (id) => ctx.editor.dispatch({ type: "select", ids: [id] }),
		onPointerDown: ctx.onPointerDown,
		fpCache: ctx.fpCache,
	};
}

function PcbSvgScene({ svgRef, viewBox, route, layers, sceneData, drag }) {
	return (
		/* biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard handled on parent region */
		<svg
			ref={svgRef}
			viewBox={viewBox}
			style={SVG_STYLE}
			onClick={route.onCanvasClick}
			onDoubleClick={route.onCanvasDoubleClick}
			onPointerDown={sceneData.onPointerDown}
			onPointerMove={(e) => {
				drag.onPointerMove(e);
				route.onPointerMove(e);
			}}
			onPointerUp={drag.onDropDrag}
		>
			<title>PCB Canvas</title>
			<EdgeCutsLayer
				outline={sceneData.board?.outline}
				visible={layers.visibleLayers["Edge.Cuts"]}
			/>
			<ZonesLayer
				zones={sceneData.board?.zones}
				visibleLayers={layers.visibleLayers}
			/>
			<TracksLayer
				tracks={sceneData.board?.tracks}
				activeLayer={layers.activeLayer}
				visibleLayers={layers.visibleLayers}
				selectedIndex={sceneData.selectedTrackIndex}
			/>
			<ViasLayer vias={sceneData.board?.vias} />
			<RatsnestLayer lines={sceneData.rnLines} />
			<PartsLayer
				parts={sceneData.ir?.parts}
				selectedId={sceneData.selectedPartId}
				visibleLayers={layers.visibleLayers}
				onSelectPart={sceneData.onSelectPart}
				onStartDrag={drag.onStartDrag}
				fpCache={sceneData.fpCache}
			/>
			<RoutingPreviewLayer
				points={route.points}
				proposed={route.proposedRoute}
				activeLayer={layers.activeLayer}
				widthMm={route.widthMm}
			/>
		</svg>
	);
}

export default function PcbCanvas({
	editor,
	board,
	onBoardChange,
	onChange,
	fetchFootprint,
}) {
	const svgRef = useRef(null);
	const layers = useCanvasLayers();
	const ir = editor?.state?.ir;
	const fpCache = useFootprintCache(ir?.parts, fetchFootprint);
	const history = useBoardHistory(board, onBoardChange);
	const sel = useCanvasSelection(editor, board, history.pushBoard, onChange);
	const drag = usePartDrag(editor, svgRef);
	const padPositions = useMemo(
		() => buildPadPositions(ir?.parts, fpCache),
		[ir?.parts, fpCache],
	);
	const route = useRoutingState({
		board,
		activeLayer: layers.activeLayer,
		toggleLayer: layers.toggleLayer,
		pushBoard: history.pushBoard,
		svgRef,
		ir,
		padPositions,
	});
	const rnLines = useMemo(() => ratsnest(ir, padPositions), [ir, padPositions]);
	const viewBox = useMemo(
		() => getBoardBounds(board?.outline),
		[board?.outline],
	);
	const onPointerDown = usePointerDownHandler({
		route,
		sel,
		ir,
		board,
		svgRef,
	});
	const shortcuts = buildShortcuts({ editor, sel, layers, route, history });
	const sceneData = buildSceneData({
		board,
		ir,
		rnLines,
		sel,
		onPointerDown,
		fpCache,
	});

	return (
		<div
			style={CONTAINER_STYLE}
			role="application"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard navigation for canvas shortcuts
			tabIndex={0}
			aria-label="PCB editor"
			onKeyDown={(e) => handleShortcuts(e, shortcuts)}
		>
			<PcbToolbar
				activeLayer={layers.activeLayer}
				isRouting={route.isRouting}
				onToggleLayer={layers.toggleLayer}
				onToggleRoute={route.toggleRoute}
				visibleLayers={layers.visibleLayers}
				onToggleLayerVis={layers.toggleLayerVis}
				widthPreset={route.widthPreset}
				onCycleWidth={route.cycleWidthPreset}
				routeMode={route.routeMode}
				onToggleRouteMode={route.toggleRouteMode}
			/>
			<PcbSvgScene
				svgRef={svgRef}
				viewBox={viewBox}
				route={route}
				layers={layers}
				sceneData={sceneData}
				drag={drag}
			/>
			<PcbStatusBar
				isRouting={route.isRouting}
				widthPreset={route.widthPreset}
				routeMode={route.routeMode}
			/>
		</div>
	);
}
