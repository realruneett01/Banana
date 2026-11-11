import { useCallback, useMemo, useRef, useState } from "react";
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

function findSnapEndpoint(board, ir, [x, y], tol = 1.0) {
	for (const t of board?.tracks ?? []) {
		if (Math.hypot(x - t.start[0], y - t.start[1]) <= tol) return t.start;
		if (Math.hypot(x - t.end[0], y - t.end[1]) <= tol) return t.end;
	}
	for (const p of ir?.parts ?? []) {
		if (
			p.placement &&
			Math.hypot(x - p.placement.x, y - p.placement.y) <= tol
		) {
			return [p.placement.x, p.placement.y];
		}
	}
	return [x, y];
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

function PartsLayer({
	parts,
	selectedId,
	visibleLayers,
	onSelectPart,
	onStartDrag,
}) {
	if (!Array.isArray(parts)) return null;
	return (
		<g className="pcb-parts">
			{parts.map((p) => {
				const rect = footprintRect(p);
				if (!rect) return null;
				const layerKey = rect.side === "B" ? "B.SilkS" : "F.SilkS";
				if (visibleLayers[layerKey] === false) return null;
				const isSelected = selectedId === p.id;
				return (
					// biome-ignore lint/a11y/useSemanticElements: SVG elements cannot be replaced with HTML button
					<g
						key={p.id}
						role="button"
						tabIndex={0}
						aria-label={`Part ${rect.ref}`}
						onClick={(e) => {
							e.stopPropagation();
							onSelectPart(p.id);
						}}
						onKeyDown={(e) => handlePartKey(e, p.id, onSelectPart)}
						onPointerDown={(e) => onStartDrag(e, p)}
					>
						<PartShape rect={rect} isSelected={isSelected} />
					</g>
				);
			})}
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

function resolveRouteTarget(board, ir, raw, hasPoints) {
	const snapped = snapToGrid(raw, 0.25);
	if (!hasPoints) return findSnapEndpoint(board, ir, snapped);
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

function useRoutingState({ board, activeLayer, pushBoard, svgRef, ir }) {
	const [isRouting, setIsRouting] = useState(false);
	const [points, setPoints] = useState([]);

	const onCanvasClick = useCallback(
		(e) => {
			if (!isRouting) return;
			const raw = screenToBoardCoords(e, svgRef.current);
			const target = resolveRouteTarget(board, ir, raw, points.length > 0);
			setPoints((prev) => nextRoutePoints(prev, target));
		},
		[isRouting, points.length, board, ir, svgRef],
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

	return {
		isRouting,
		setIsRouting,
		points,
		setPoints,
		onCanvasClick,
		onCanvasDoubleClick,
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
			/>
			<RoutingPreviewLayer
				points={route.points}
				activeLayer={layers.activeLayer}
			/>
		</svg>
	);
}

export default function PcbCanvas({ editor, board, onBoardChange, onChange }) {
	const svgRef = useRef(null);
	const [activeLayer, setActiveLayer] = useState("F.Cu");
	const [visibleLayers, setVisibleLayers] = useState(DEFAULT_VISIBLE);
	const ir = editor?.state?.ir;
	const { pushBoard, undoBoard, redoBoard } = useBoardHistory(
		board,
		onBoardChange,
	);
	const sel = useCanvasSelection(editor, board, pushBoard, onChange);
	const drag = usePartDrag(editor, svgRef);
	const route = useRoutingState({
		board,
		activeLayer,
		pushBoard,
		svgRef,
		ir,
	});
	const rnLines = useMemo(() => ratsnest(ir), [ir]);
	const viewBox = useMemo(
		() => getBoardBounds(board?.outline),
		[board?.outline],
	);

	const toggleLayer = useCallback(
		() => setActiveLayer((l) => (l === "F.Cu" ? "B.Cu" : "F.Cu")),
		[],
	);
	const toggleRoute = useCallback(() => {
		route.setIsRouting((r) => !r);
		route.setPoints([]);
	}, [route]);
	const toggleLayerVis = useCallback(
		(ly) => setVisibleLayers((v) => ({ ...v, [ly]: v[ly] === false })),
		[],
	);

	const onPointerDown = useCallback(
		(e) => {
			if (route.isRouting) return;
			const [x, y] = screenToBoardCoords(e, svgRef.current);
			sel.onSelectHit(hitTest(ir, board, [x, y]));
		},
		[route.isRouting, ir, board, sel],
	);

	const shortcuts = {
		editor,
		selectedPartId: sel.selectedPartId,
		toggleLayer,
		toggleRoute,
		deleteSelected: sel.deleteSelected,
		undoBoard,
		redoBoard,
	};
	const sceneData = {
		board,
		ir,
		rnLines,
		selectedPartId: sel.selectedPartId,
		selectedTrackIndex: sel.selectedTrackIndex,
		onSelectPart: (id) => editor.dispatch({ type: "select", ids: [id] }),
		onPointerDown,
	};
	const layers = { activeLayer, visibleLayers };

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
				activeLayer={activeLayer}
				isRouting={route.isRouting}
				onToggleLayer={toggleLayer}
				onToggleRoute={toggleRoute}
				visibleLayers={visibleLayers}
				onToggleLayerVis={toggleLayerVis}
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
