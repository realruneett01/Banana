import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	arcToSvgPath,
	footprintToPrimitives,
	padWorldPositions,
	transformPrimitives,
} from "./footprintRender.js";
import {
	addTrack,
	constrain45,
	deleteTrack,
	footprintRect,
	hitTest,
	LAYER_COLORS,
	ratsnest,
	snapToGrid,
} from "./pcbGeometry.js";

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

function findTrackSnap(tracks, pt, tol) {
	for (const t of tracks ?? []) {
		if (Math.hypot(pt[0] - t.start[0], pt[1] - t.start[1]) <= tol)
			return t.start;
		if (Math.hypot(pt[0] - t.end[0], pt[1] - t.end[1]) <= tol) return t.end;
	}
	return null;
}

function findPadSnap(parts, padPositions, pt, tol) {
	for (const p of parts ?? []) {
		const pads = padPositions?.[p.id];
		if (!pads) continue;
		for (const pos of Object.values(pads)) {
			if (Math.hypot(pt[0] - pos[0], pt[1] - pos[1]) <= tol) return pos;
		}
	}
	return null;
}

function findPartCenterSnap(parts, pt, tol) {
	for (const p of parts ?? []) {
		if (
			p.placement &&
			Math.hypot(pt[0] - p.placement.x, pt[1] - p.placement.y) <= tol
		) {
			return [p.placement.x, p.placement.y];
		}
	}
	return null;
}

function findSnapEndpoint(board, ir, pt, padPositions, tol = 1.0) {
	const trackPt = findTrackSnap(board?.tracks, pt, tol);
	if (trackPt) return trackPt;
	const padPt = findPadSnap(ir?.parts, padPositions, pt, tol);
	if (padPt) return padPt;
	const partPt = findPartCenterSnap(ir?.parts, pt, tol);
	if (partPt) return partPt;
	return pt;
}

function handleToolKeys(e, key, ctx) {
	if (key === "r" && ctx.selectedPartId) {
		e.preventDefault();
		ctx.editor.dispatch({
			type: "rotatePart",
			partId: ctx.selectedPartId,
			deltaDeg: 90,
		});
	} else if (key === "f" && ctx.selectedPartId) {
		e.preventDefault();
		ctx.editor.dispatch({ type: "flipPart", partId: ctx.selectedPartId });
	} else if (key === "v") {
		e.preventDefault();
		ctx.toggleLayer();
	} else if (key === "x") {
		e.preventDefault();
		ctx.toggleRoute();
	} else if (key === "delete" || key === "backspace") {
		e.preventDefault();
		ctx.deleteSelected();
	}
}

function handleShortcuts(e, ctx) {
	const key = e.key.toLowerCase();
	const hasMod = e.ctrlKey || e.metaKey;
	if (hasMod && key === "z" && !e.shiftKey) {
		e.preventDefault();
		if (!ctx.undoBoard()) ctx.editor.undo();
		return;
	}
	if (hasMod && (key === "y" || (key === "z" && e.shiftKey))) {
		e.preventDefault();
		if (!ctx.redoBoard()) ctx.editor.redo();
		return;
	}
	handleToolKeys(e, key, ctx);
}

function EdgeCutsLayer({ outline, visible }) {
	if (!visible || !Array.isArray(outline) || outline.length < 3) return null;
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

function PartShape({ rect, isSelected }) {
	const isFront = rect.side !== "B";
	const stroke = isSelected
		? "#fadb14"
		: isFront
			? LAYER_COLORS["F.SilkS"]
			: LAYER_COLORS["B.SilkS"];
	const fill = isFront ? "rgba(56, 189, 248, 0.2)" : "rgba(167, 139, 250, 0.2)";
	const rot = rect.rot ? `rotate(${rect.rot} ${rect.x} ${rect.y})` : undefined;
	const fontSize = Math.max(0.6, Math.min(rect.w, rect.h) * 0.4);
	return (
		<g transform={rot} style={{ cursor: "move" }}>
			<rect
				x={rect.x - rect.w / 2}
				y={rect.y - rect.h / 2}
				width={rect.w}
				height={rect.h}
				fill={fill}
				stroke={stroke}
				strokeWidth={isSelected ? 0.6 : 0.25}
				rx={0.2}
			/>
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

function FootprintGraphic({ graphic, visibleLayers }) {
	if (visibleLayers[graphic.layer] === false) return null;
	const color = resolveGraphicColor(graphic.layer);
	const width = graphic.width || 0.12;
	if (graphic.type === "line") {
		return (
			<line
				x1={graphic.start[0]}
				y1={graphic.start[1]}
				x2={graphic.end[0]}
				y2={graphic.end[1]}
				stroke={color}
				strokeWidth={width}
				strokeLinecap="round"
			/>
		);
	}
	if (graphic.type === "rect") {
		const x = Math.min(graphic.start[0], graphic.end[0]);
		const y = Math.min(graphic.start[1], graphic.end[1]);
		const w = Math.abs(graphic.end[0] - graphic.start[0]);
		const h = Math.abs(graphic.end[1] - graphic.start[1]);
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
	if (graphic.type === "circle") {
		return (
			<circle
				cx={graphic.center[0]}
				cy={graphic.center[1]}
				r={graphic.radius}
				fill="none"
				stroke={color}
				strokeWidth={width}
			/>
		);
	}
	if (graphic.type === "arc") {
		return (
			<path
				d={arcToSvgPath(graphic)}
				fill="none"
				stroke={color}
				strokeWidth={width}
				strokeLinecap="round"
			/>
		);
	}
	if (graphic.type === "poly") {
		const pts = (graphic.pts ?? []).map((p) => `${p[0]},${p[1]}`).join(" ");
		return (
			<polygon points={pts} fill="none" stroke={color} strokeWidth={width} />
		);
	}
	return null;
}

function isPadVisible(pad, isBack, visibleLayers) {
	const isThru = pad.padType === "thru_hole" || pad.layers.includes("*.Cu");
	if (isThru) {
		return visibleLayers["F.Cu"] !== false || visibleLayers["B.Cu"] !== false;
	}
	const layer = isBack ? "B.Cu" : "F.Cu";
	return visibleLayers[layer] !== false;
}

function PadShapeElement({ pad, color, rot }) {
	const [cx, cy] = pad.center;
	const [w, h] = pad.size;
	if (pad.shape === "circle") {
		return <circle cx={cx} cy={cy} r={w / 2} fill={color} />;
	}
	const rx =
		pad.shape === "roundrect"
			? Math.min(w, h) * 0.25
			: pad.shape === "oval"
				? Math.min(w, h) / 2
				: 0;
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

function FootprintPad({ pad, isBack, visibleLayers }) {
	if (!isPadVisible(pad, isBack, visibleLayers)) return null;
	const isThru = pad.padType === "thru_hole" || pad.layers.includes("*.Cu");
	const color = isBack ? LAYER_COLORS["B.Cu"] : LAYER_COLORS["F.Cu"];
	const [cx, cy] = pad.center;
	const rot = pad.rot ? `rotate(${pad.rot} ${cx} ${cy})` : undefined;
	const drillR = isThru
		? (pad.drill ? pad.drill / 2 : Math.min(pad.size[0], pad.size[1]) * 0.25) ||
			0.4
		: 0;
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
	if (g.type === "line" || g.type === "rect") {
		return `${g.type}_${g.layer}_${g.start[0]}_${g.start[1]}_${g.end[0]}_${g.end[1]}`;
	}
	if (g.type === "circle") {
		return `${g.type}_${g.layer}_${g.center[0]}_${g.center[1]}_${g.radius}`;
	}
	if (g.type === "arc") {
		return `${g.type}_${g.layer}_${g.start[0]}_${g.start[1]}_${g.end[0]}_${g.end[1]}`;
	}
	if (g.type === "poly") {
		return `${g.type}_${g.layer}_${g.pts?.[0]?.[0]}_${g.pts?.[0]?.[1]}`;
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
	const fontSize = Math.max(0.6, Math.min(rect.w, rect.h) * 0.4);
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

function RoutingPreviewLayer({ points, activeLayer }) {
	if (!Array.isArray(points) || points.length < 1) return null;
	const color = LAYER_COLORS[activeLayer] ?? "#c83434";
	return (
		<g className="pcb-routing-preview" style={{ pointerEvents: "none" }}>
			{points.map((pt, i) => {
				if (i === 0) return null;
				const prev = points[i - 1];
				return (
					<line
						key={`route_${prev[0]}_${prev[1]}_${pt[0]}_${pt[1]}`}
						x1={prev[0]}
						y1={prev[1]}
						x2={pt[0]}
						y2={pt[1]}
						stroke={color}
						strokeWidth={0.3}
						strokeDasharray="1,0.5"
						strokeLinecap="round"
					/>
				);
			})}
			{points.map((pt) => (
				<circle
					key={`pt_${pt[0]}_${pt[1]}`}
					cx={pt[0]}
					cy={pt[1]}
					r={0.35}
					fill={color}
				/>
			))}
		</g>
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
}) {
	return (
		<div style={TOOLBAR_STYLE}>
			<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
				<button
					type="button"
					aria-label="Toggle active layer (V)"
					onClick={onToggleLayer}
					style={TOOL_BUTTON_STYLE}
				>
					Active:{" "}
					<strong style={{ color: LAYER_COLORS[activeLayer] }}>
						{activeLayer}
					</strong>{" "}
					(V)
				</button>
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
			</div>
			<LayerCheckboxes
				visibleLayers={visibleLayers}
				onToggleLayer={onToggleLayerVis}
			/>
		</div>
	);
}

function calcDropPos(drag, curPt) {
	const dx = curPt[0] - drag.startPos[0];
	const dy = curPt[1] - drag.startPos[1];
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
	const dx = curPt[0] - drag.startPos[0];
	const dy = curPt[1] - drag.startPos[1];
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

function nextRoutePoints(prev, target) {
	if (prev.length === 0) return [target];
	return [...prev, ...constrain45(prev[prev.length - 1], target)];
}

function resolveRouteTarget(board, ir, raw, hasPoints, padPositions) {
	const snapped = snapToGrid(raw, 0.25);
	if (!hasPoints) return findSnapEndpoint(board, ir, snapped, padPositions);
	return snapped;
}

function commitRouteTrack(board, activeLayer, points) {
	return addTrack(board, {
		netId: "",
		layer: activeLayer,
		points,
		widthMm: 0.25,
	});
}

function useRoutingState({
	board,
	activeLayer,
	pushBoard,
	svgRef,
	ir,
	padPositions,
}) {
	const [isRouting, setIsRouting] = useState(false);
	const [points, setPoints] = useState([]);

	const onCanvasClick = useCallback(
		(e) => {
			if (!isRouting) return;
			const raw = screenToBoardCoords(e, svgRef.current);
			const target = resolveRouteTarget(
				board,
				ir,
				raw,
				points.length > 0,
				padPositions,
			);
			setPoints((prev) => nextRoutePoints(prev, target));
		},
		[isRouting, points.length, board, ir, svgRef, padPositions],
	);

	const onCanvasDoubleClick = useCallback(
		(e) => {
			e.preventDefault();
			if (!isRouting || points.length < 2) return;
			pushBoard(commitRouteTrack(board, activeLayer, points));
			setPoints([]);
			setIsRouting(false);
		},
		[isRouting, points, board, activeLayer, pushBoard],
	);

	const toggleRoute = useCallback(() => {
		setIsRouting((r) => !r);
		setPoints([]);
	}, []);

	return {
		isRouting,
		points,
		onCanvasClick,
		onCanvasDoubleClick,
		toggleRoute,
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

function useFootprintCache(parts, fetchFootprint) {
	const [cache, setCache] = useState({});
	const pendingRef = useRef(new Set());

	useEffect(() => {
		if (!fetchFootprint || !Array.isArray(parts)) return;
		for (const p of parts) {
			const fpId = p.footprint ?? p.props?.footprint;
			if (!shouldFetchFp(fpId, cache, pendingRef.current)) continue;
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

function usePointerDownHandler(route, sel, ir, board, svgRef) {
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
			onPointerMove={drag.onPointerMove}
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
				activeLayer={layers.activeLayer}
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
	const onPointerDown = usePointerDownHandler(route, sel, ir, board, svgRef);
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
			/>
			<PcbSvgScene
				svgRef={svgRef}
				viewBox={viewBox}
				route={route}
				layers={layers}
				sceneData={sceneData}
				drag={drag}
			/>
		</div>
	);
}
