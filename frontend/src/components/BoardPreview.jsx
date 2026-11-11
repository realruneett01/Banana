import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	highlightSet,
	partRects,
	ratsnest,
	viewBoxFor,
} from "./boardPreviewModel.js";

const CONTAINER_STYLE = Object.freeze({
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "450px",
	overflow: "hidden",
	background: "#0d0f18",
	borderRadius: "8px",
	border: "1px solid #23283e",
});

const SVG_STYLE = Object.freeze({
	width: "100%",
	height: "100%",
	display: "block",
	cursor: "grab",
	userSelect: "none",
});

function computeCentroid(rects, highlightIds, defaultCenter) {
	if (!highlightIds.size) return defaultCenter;
	let sumX = 0;
	let sumY = 0;
	let count = 0;
	for (const r of rects) {
		if (!highlightIds.has(r.id)) continue;
		sumX += r.x;
		sumY += r.y;
		count++;
	}
	if (count === 0) return defaultCenter;
	return { x: sumX / count, y: sumY / count };
}

function useWheelZoom(svgRef, setZoom) {
	useEffect(() => {
		const el = svgRef.current;
		if (!el) return;
		const handleWheel = (e) => {
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.15 : 0.87;
			setZoom((z) => Math.min(50, Math.max(0.05, z * factor)));
		};
		el.addEventListener("wheel", handleWheel, { passive: false });
		return () => el.removeEventListener("wheel", handleWheel);
	}, [svgRef, setZoom]);
}

function usePointerPan(svgRef, viewW, viewH, setPan, dragRef) {
	useEffect(() => {
		const handleMove = (e) => {
			if (!dragRef.current) return;
			const dx = e.clientX - dragRef.current.x;
			const dy = e.clientY - dragRef.current.y;
			if (!dragRef.current.moved && Math.hypot(dx, dy) < 3) return;
			dragRef.current.moved = true;
			const rect = svgRef.current?.getBoundingClientRect();
			const sx = rect?.width ? viewW / rect.width : 1;
			const sy = rect?.height ? viewH / rect.height : 1;
			setPan({
				x: dragRef.current.panX + dx * sx,
				y: dragRef.current.panY + dy * sy,
			});
		};
		const handleUp = () => {
			dragRef.current = null;
		};
		window.addEventListener("pointermove", handleMove);
		window.addEventListener("pointerup", handleUp);
		return () => {
			window.removeEventListener("pointermove", handleMove);
			window.removeEventListener("pointerup", handleUp);
		};
	}, [svgRef, viewW, viewH, setPan, dragRef]);
}

function createDragState(e, pan) {
	return { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false };
}

function useBoardPanZoom({ svgRef, data }) {
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [zoom, setZoom] = useState(1);
	const [focus, setFocus] = useState(data.centroid);
	const dragRef = useRef(null);

	useEffect(() => {
		setFocus(data.centroid);
		setPan({ x: 0, y: 0 });
	}, [data.centroid]);

	useWheelZoom(svgRef, setZoom);
	usePointerPan(svgRef, data.vw, data.vh, setPan, dragRef);

	const onPointerDown = useCallback(
		(e) => {
			if (e.button === 0) dragRef.current = createDragState(e, pan);
		},
		[pan],
	);

	const transform = `translate(${data.cx + pan.x}, ${data.cy + pan.y}) scale(${zoom}) translate(${-focus.x}, ${-focus.y})`;
	return { transform, onPointerDown, dragRef };
}

function useBoardData(ir, boardW, boardH, selectedId) {
	const rects = useMemo(() => partRects(ir), [ir]);
	const lines = useMemo(() => ratsnest(ir), [ir]);
	const highlights = useMemo(
		() => highlightSet(ir, selectedId),
		[ir, selectedId],
	);
	const partMap = useMemo(
		() => new Map((ir?.parts ?? []).map((p) => [p.id, p])),
		[ir],
	);
	const vb = useMemo(
		() => viewBoxFor(rects, { boardW, boardH }),
		[rects, boardW, boardH],
	);
	const [vx, vy, vw, vh] = useMemo(() => vb.split(" ").map(Number), [vb]);
	const cx = vx + vw / 2;
	const cy = vy + vh / 2;
	const centroid = useMemo(
		() => computeCentroid(rects, highlights, { x: cx, y: cy }),
		[rects, highlights, cx, cy],
	);
	return { rects, lines, highlights, partMap, vb, vw, vh, cx, cy, centroid };
}

function BoardOutline({ width, height }) {
	return (
		<rect
			x={0}
			y={0}
			width={width}
			height={height}
			fill="#131722"
			stroke="#2e3856"
			strokeWidth={0.5}
			rx={1}
		/>
	);
}

function RatsnestLines({ lines }) {
	return (
		<g className="ratsnest">
			{lines.map((l) => (
				<line
					key={`${l.netId}-${l.from.x}-${l.from.y}-${l.to.x}-${l.to.y}`}
					x1={l.from.x}
					y1={l.from.y}
					x2={l.to.x}
					y2={l.to.y}
					stroke="rgba(251, 191, 36, 0.45)"
					strokeWidth={0.25}
					strokeDasharray="1,1"
				/>
			))}
		</g>
	);
}

function PartRect({ rect, isFront, isHighlighted }) {
	const stroke = isHighlighted ? "#fadb14" : isFront ? "#38bdf8" : "#a78bfa";
	const fill = isFront
		? "rgba(56, 189, 248, 0.22)"
		: "rgba(167, 139, 250, 0.22)";
	const rot = rect.rot ? `rotate(${rect.rot} ${rect.x} ${rect.y})` : undefined;
	return (
		<rect
			x={rect.x - rect.w / 2}
			y={rect.y - rect.h / 2}
			width={rect.w}
			height={rect.h}
			transform={rot}
			fill={fill}
			stroke={stroke}
			strokeWidth={isHighlighted ? 0.9 : 0.3}
			rx={0.4}
		/>
	);
}

function PartText({ rect }) {
	const fontSize = Math.min(rect.w, rect.h) * 0.38;
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

function handlePartKey(e, id, onSelect) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		onSelect?.(id);
	}
}

function PartItem({ rect, value, isHighlighted, onSelect, dragRef }) {
	const isFront = rect.side !== "B";
	const label = `${rect.ref} ${value ?? ""}`.trim();
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG elements cannot be replaced with HTML button
		<g
			role="button"
			tabIndex={0}
			aria-label={label}
			onClick={() => !dragRef.current?.moved && onSelect?.(rect.id)}
			onKeyDown={(e) => handlePartKey(e, rect.id, onSelect)}
			style={{ cursor: "pointer", outline: "none" }}
		>
			<PartRect rect={rect} isFront={isFront} isHighlighted={isHighlighted} />
			<PartText rect={rect} />
		</g>
	);
}

function BoardScene({ boardW, boardH, data, onSelect, dragRef }) {
	return (
		<>
			<BoardOutline width={boardW} height={boardH} />
			<RatsnestLines lines={data.lines} />
			{data.rects.map((r) => (
				<PartItem
					key={r.id}
					rect={r}
					value={data.partMap.get(r.id)?.value}
					isHighlighted={data.highlights.has(r.id)}
					onSelect={onSelect}
					dragRef={dragRef}
				/>
			))}
		</>
	);
}

function BoardSvg({ svgRef, data, view, children }) {
	return (
		<svg
			ref={svgRef}
			viewBox={data.vb}
			onPointerDown={view.onPointerDown}
			style={SVG_STYLE}
		>
			<title>Board Preview</title>
			<g transform={view.transform}>{children}</g>
		</svg>
	);
}

export default function BoardPreview({
	ir,
	boardW = 100,
	boardH = 100,
	selectedId,
	onSelect,
}) {
	const svgRef = useRef(null);
	const data = useBoardData(ir, boardW, boardH, selectedId);
	const view = useBoardPanZoom({ svgRef, data });
	return (
		<div style={CONTAINER_STYLE}>
			<BoardSvg svgRef={svgRef} data={data} view={view}>
				<BoardScene
					boardW={boardW}
					boardH={boardH}
					data={data}
					onSelect={onSelect}
					dragRef={view.dragRef}
				/>
			</BoardSvg>
		</div>
	);
}
