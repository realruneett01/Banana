import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyCommand } from "./editorModel.js";
import {
	hitTest,
	partBox,
	pinPositions,
	snapToGrid,
	wireForNet,
} from "./schematicGeometry.js";

const CANVAS_CONTAINER_STYLE = Object.freeze({
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "450px",
	overflow: "hidden",
	background: "#0d0f18",
	borderRadius: "8px",
	border: "1px solid #23283e",
	outline: "none",
});

function runHistoryStep(stepFn, setDoc, onChange) {
	const next = stepFn?.();
	if (next) {
		setDoc(next);
		onChange?.(next.ir);
	}
}

function useSchematicEditor(editor, onChange) {
	const [doc, setDoc] = useState(
		() =>
			editor?.state ?? {
				ir: { parts: [], nets: [] },
				selection: [],
				history: { past: [], future: [] },
			},
	);
	useEffect(() => {
		if (editor?.state) setDoc(editor.state);
	}, [editor, editor?.state]);

	const dispatchCmd = useCallback(
		(cmd) => {
			const next = editor?.dispatch
				? editor.dispatch(cmd)
				: applyCommand(doc, cmd);
			if (next && !next.error) {
				setDoc(next);
				onChange?.(next.ir);
			}
			return next;
		},
		[editor, doc, onChange],
	);

	const handleUndo = useCallback(
		() => runHistoryStep(editor?.undo, setDoc, onChange),
		[editor, onChange],
	);
	const handleRedo = useCallback(
		() => runHistoryStep(editor?.redo, setDoc, onChange),
		[editor, onChange],
	);

	return { doc, dispatchCmd, handleUndo, handleRedo };
}

function useWheelZoom(svgRef, vp) {
	const { pan, zoom, setPan, setZoom } = vp;
	useEffect(() => {
		const el = svgRef.current;
		if (!el) return;
		const handleWheel = (e) => {
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			const wx = (mx - pan.x) / zoom;
			const wy = (my - pan.y) / zoom;
			const factor = e.deltaY < 0 ? 1.15 : 0.87;
			const nextZoom = Math.min(20, Math.max(0.1, zoom * factor));
			setPan({ x: mx - wx * nextZoom, y: my - wy * nextZoom });
			setZoom(nextZoom);
		};
		el.addEventListener("wheel", handleWheel, { passive: false });
		return () => el.removeEventListener("wheel", handleWheel);
	}, [svgRef, pan, zoom, setPan, setZoom]);
}

function screenToWorld(clientX, clientY, svgEl, vp) {
	const rect = svgEl.getBoundingClientRect();
	return {
		x: (clientX - rect.left - vp.pan.x) / vp.zoom,
		y: (clientY - rect.top - vp.pan.y) / vp.zoom,
	};
}

function SchematicGrid() {
	return (
		<>
			<defs>
				<pattern
					id="sch-grid"
					width={2.54}
					height={2.54}
					patternUnits="userSpaceOnUse"
				>
					<circle cx={1.27} cy={1.27} r={0.2} fill="#23283e" />
				</pattern>
			</defs>
			<rect
				x={-5000}
				y={-5000}
				width={10000}
				height={10000}
				fill="url(#sch-grid)"
			/>
		</>
	);
}

function PinSvg({ pin, pos, isWireStart }) {
	return (
		<g key={pin}>
			<circle
				cx={pos[0]}
				cy={pos[1]}
				r={0.65}
				fill={isWireStart ? "#fadb14" : "#38bdf8"}
				stroke="#0d0f18"
				strokeWidth={0.2}
			/>
			<text
				x={pos[0]}
				y={pos[1] - 0.9}
				fill="#94a3b8"
				fontSize={1.1}
				textAnchor="middle"
			>
				{pin}
			</text>
		</g>
	);
}

function PartSvg({ part, isSelected, dragPos, wireStart }) {
	const activePart = dragPos
		? { ...part, placement: { ...part.placement, x: dragPos.x, y: dragPos.y } }
		: part;
	const box = partBox(activePart);
	const pins = pinPositions(activePart);
	const stroke = isSelected ? "#fadb14" : "#38bdf8";
	const fill = isSelected ? "rgba(250, 219, 20, 0.15)" : "#161b2e";
	const rot = box.rot ? `rotate(${box.rot} ${box.cx} ${box.cy})` : undefined;
	const pinList = Array.isArray(part.pins) ? part.pins : ["1", "2"];

	return (
		<g className="schematic-part" transform={rot}>
			<rect
				x={box.x}
				y={box.y}
				width={box.width}
				height={box.height}
				fill={fill}
				stroke={stroke}
				strokeWidth={isSelected ? 0.6 : 0.4}
				rx={0.5}
			/>
			<text
				x={box.cx}
				y={box.cy - 1.2}
				fill="#f1f5f9"
				fontSize={1.8}
				fontWeight="bold"
				textAnchor="middle"
			>
				{activePart.ref}
			</text>
			<text
				x={box.cx}
				y={box.cy + 1.8}
				fill="#94a3b8"
				fontSize={1.3}
				textAnchor="middle"
			>
				{activePart.value ?? ""}
			</text>
			{pinList.map((p) => {
				const pos = pins.get(p);
				if (!pos) return null;
				const isStart =
					wireStart?.partId === activePart.id && wireStart?.pin === String(p);
				return (
					<PinSvg
						key={String(p)}
						pin={String(p)}
						pos={pos}
						isWireStart={isStart}
					/>
				);
			})}
		</g>
	);
}

function WireSvg({ net, allPinPos, isSelected }) {
	const polylines = wireForNet(net, allPinPos);
	const stroke = isSelected ? "#fadb14" : "#4ade80";
	const strokeWidth = isSelected ? 0.6 : 0.4;
	const first = polylines[0];
	const lbl =
		first && first.length >= 2
			? {
					x: (first[0][0] + first[1][0]) / 2,
					y: (first[0][1] + first[1][1]) / 2 - 0.5,
				}
			: null;

	return (
		<g className="schematic-wire">
			{polylines.map((poly) => {
				const pKey = `${net.id}-${poly[0][0]}-${poly[0][1]}-${poly[poly.length - 1][0]}-${poly[poly.length - 1][1]}`;
				return (
					<polyline
						key={pKey}
						points={poly.map((pt) => `${pt[0]},${pt[1]}`).join(" ")}
						fill="none"
						stroke={stroke}
						strokeWidth={strokeWidth}
					/>
				);
			})}
			{lbl && net.name && (
				<text
					x={lbl.x}
					y={lbl.y}
					fill="#4ade80"
					fontSize={1.2}
					textAnchor="middle"
				>
					{net.name}
				</text>
			)}
		</g>
	);
}

function RubberbandWire({ wireStart, allPinPos, cursorWorld }) {
	if (!wireStart || !cursorWorld) return null;
	const startPos = allPinPos.get(`${wireStart.partId}:${wireStart.pin}`);
	if (!startPos) return null;
	return (
		<polyline
			points={`${startPos[0]},${startPos[1]} ${cursorWorld.x},${cursorWorld.y}`}
			fill="none"
			stroke="#fadb14"
			strokeWidth={0.4}
			strokeDasharray="1.5,1.5"
		/>
	);
}

function handleActionKey(e, ctx) {
	const { doc, dispatchCmd, setWireMode, setWireStart } = ctx;
	if (e.key === "w" || e.key === "W") {
		setWireMode(true);
		setWireStart(null);
	} else if (e.key === "Escape") {
		setWireMode(false);
		setWireStart(null);
	} else if (e.key === "r" || e.key === "R") {
		for (const id of doc.selection) {
			dispatchCmd({ type: "rotatePart", partId: id, deltaDeg: 90 });
		}
	} else if (e.key === "f" || e.key === "F") {
		for (const id of doc.selection) {
			dispatchCmd({ type: "flipPart", partId: id });
		}
	} else if (e.key === "Delete" || e.key === "Backspace") {
		for (const id of doc.selection) {
			dispatchCmd({ type: "deletePart", partId: id });
		}
	}
}

function handleKeyDown(e, ctx) {
	const isMod = e.ctrlKey || e.metaKey;
	if (isMod && (e.key === "z" || e.key === "Z")) {
		e.preventDefault();
		if (e.shiftKey) ctx.handleRedo();
		else ctx.handleUndo();
		return;
	}
	if (isMod && (e.key === "y" || e.key === "Y")) {
		e.preventDefault();
		ctx.handleRedo();
		return;
	}
	handleActionKey(e, ctx);
}

function handlePinConnect(hit, wireState, dispatchCmd) {
	const { wireStart, setWireStart, setWireMode } = wireState;
	if (!wireStart) {
		setWireStart({ partId: hit.id, pin: hit.pin });
		return;
	}
	if (wireStart.partId !== hit.id || wireStart.pin !== hit.pin) {
		dispatchCmd({
			type: "connect",
			partIdA: wireStart.partId,
			pinA: wireStart.pin,
			partIdB: hit.id,
			pinB: hit.pin,
		});
	}
	setWireStart(null);
	setWireMode(false);
}

function handlePointerDownHit(hit, hitCtx) {
	const { wireMode, wireState, dispatchCmd, setDragState, doc, worldPt } =
		hitCtx;
	if (wireMode || hit?.kind === "pin") {
		if (hit?.kind === "pin") {
			handlePinConnect(hit, wireState, dispatchCmd);
			return;
		}
		wireState.setWireMode(false);
		wireState.setWireStart(null);
	}
	if (hit?.kind === "part") {
		dispatchCmd({ type: "select", ids: [hit.id] });
		const part = doc.ir.parts?.find((p) => p.id === hit.id);
		setDragState({
			partId: hit.id,
			startX: part?.placement?.x ?? 0,
			startY: part?.placement?.y ?? 0,
			mouseStartX: worldPt.x,
			mouseStartY: worldPt.y,
			moved: false,
		});
	} else if (hit?.kind === "wire") {
		dispatchCmd({ type: "select", ids: [hit.id] });
	} else {
		dispatchCmd({ type: "select", ids: [] });
	}
}

function updatePartDrag(dragState, worldPt, setDragPos) {
	const dx = worldPt.x - dragState.mouseStartX;
	const dy = worldPt.y - dragState.mouseStartY;
	if (Math.hypot(dx, dy) > 0.5) dragState.moved = true;
	const x = snapToGrid(dragState.startX + dx, 1.27);
	const y = snapToGrid(dragState.startY + dy, 1.27);
	setDragPos({ partId: dragState.partId, x, y });
}

function usePointerInteractions(svgRef, editorState, wireState) {
	const { vp, isSpaceDown, wireMode, dragPos, setDragPos } = wireState;
	const { doc, dispatchCmd } = editorState;
	const panDragRef = useRef(null);
	const [dragState, setDragState] = useState(null);
	const [cursorWorld, setCursorWorld] = useState(null);

	const onPointerDown = useCallback(
		(e) => {
			if (!svgRef.current) return;
			if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
				panDragRef.current = {
					sx: e.clientX,
					sy: e.clientY,
					px: vp.pan.x,
					py: vp.pan.y,
				};
				return;
			}
			if (e.button !== 0) return;
			const worldPt = screenToWorld(e.clientX, e.clientY, svgRef.current, vp);
			const hit = hitTest(doc, [worldPt.x, worldPt.y]);
			handlePointerDownHit(hit, {
				wireMode,
				wireState,
				dispatchCmd,
				setDragState,
				doc,
				worldPt,
			});
		},
		[doc, dispatchCmd, isSpaceDown, vp, svgRef, wireMode, wireState],
	);

	const onPointerMove = useCallback(
		(e) => {
			if (!svgRef.current) return;
			const worldPt = screenToWorld(e.clientX, e.clientY, svgRef.current, vp);
			setCursorWorld(worldPt);
			if (panDragRef.current) {
				const dx = e.clientX - panDragRef.current.sx;
				const dy = e.clientY - panDragRef.current.sy;
				vp.setPan({
					x: panDragRef.current.px + dx,
					y: panDragRef.current.py + dy,
				});
				return;
			}
			if (dragState) updatePartDrag(dragState, worldPt, setDragPos);
		},
		[dragState, setDragPos, vp, svgRef],
	);

	const onPointerUp = useCallback(() => {
		panDragRef.current = null;
		if (dragState?.moved && dragPos) {
			dispatchCmd({
				type: "movePart",
				partId: dragState.partId,
				x: dragPos.x,
				y: dragPos.y,
			});
		}
		setDragState(null);
		setDragPos(null);
	}, [dragState, dragPos, dispatchCmd, setDragPos]);

	return { onPointerDown, onPointerMove, onPointerUp, cursorWorld };
}

export default function SchematicCanvas({ editor, onChange }) {
	const svgRef = useRef(null);
	const [pan, setPan] = useState({ x: 200, y: 150 });
	const [zoom, setZoom] = useState(4);
	const [isSpaceDown, setIsSpaceDown] = useState(false);
	const [wireMode, setWireMode] = useState(false);
	const [wireStart, setWireStart] = useState(null);
	const [dragPos, setDragPos] = useState(null);

	const { doc, dispatchCmd, handleUndo, handleRedo } = useSchematicEditor(
		editor,
		onChange,
	);
	const vp = useMemo(() => ({ pan, zoom, setPan, setZoom }), [pan, zoom]);
	useWheelZoom(svgRef, vp);

	const wireState = useMemo(
		() => ({
			wireStart,
			setWireStart,
			wireMode,
			setWireMode,
			vp,
			isSpaceDown,
			dragPos,
			setDragPos,
		}),
		[wireStart, wireMode, vp, isSpaceDown, dragPos],
	);

	const editorState = useMemo(() => ({ doc, dispatchCmd }), [doc, dispatchCmd]);
	const { onPointerDown, onPointerMove, onPointerUp, cursorWorld } =
		usePointerInteractions(svgRef, editorState, wireState);

	const allPinPos = useMemo(() => {
		const map = new Map();
		for (const part of doc.ir?.parts ?? []) {
			const positions = pinPositions(part, part.pins);
			for (const [pin, pos] of positions.entries()) {
				map.set(`${part.id}:${pin}`, pos);
			}
		}
		return map;
	}, [doc.ir?.parts]);

	const keyCtx = useMemo(
		() => ({
			doc,
			dispatchCmd,
			handleUndo,
			handleRedo,
			setWireMode,
			setWireStart,
		}),
		[doc, dispatchCmd, handleUndo, handleRedo],
	);

	return (
		// biome-ignore lint/a11y/useSemanticElements: canvas container provides schematic interaction area
		<div
			// biome-ignore lint/a11y/noNoninteractiveTabindex: schematic editor canvas requires focus for keyboard shortcuts
			tabIndex={0}
			role="region"
			aria-label="Schematic editor"
			style={CANVAS_CONTAINER_STYLE}
			onKeyDown={(e) => {
				if (e.code === "Space") setIsSpaceDown(true);
				handleKeyDown(e, keyCtx);
			}}
			onKeyUp={(e) => {
				if (e.code === "Space") setIsSpaceDown(false);
			}}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
		>
			<svg
				ref={svgRef}
				width="100%"
				height="100%"
				style={{ display: "block", userSelect: "none" }}
			>
				<title>Schematic Canvas</title>
				<g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
					<SchematicGrid />
					{(doc.ir?.nets ?? []).map((net) => (
						<WireSvg
							key={net.id}
							net={net}
							allPinPos={allPinPos}
							isSelected={doc.selection?.includes(net.id)}
						/>
					))}
					{(doc.ir?.parts ?? []).map((part) => (
						<PartSvg
							key={part.id}
							part={part}
							isSelected={doc.selection?.includes(part.id)}
							dragPos={dragPos?.partId === part.id ? dragPos : null}
							wireStart={wireStart}
						/>
					))}
					<RubberbandWire
						wireStart={wireStart}
						allPinPos={allPinPos}
						cursorWorld={cursorWorld}
					/>
				</g>
			</svg>
		</div>
	);
}
