import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyCommand } from "./editorModel.js";
import { markerGlyphs } from "./markerRender.js";
import {
	hitTest,
	partBox,
	pinPositions,
	snapToGrid,
	wireForNet,
} from "./schematicGeometry.js";
import {
	symbolPinPositions,
	symbolToSvgPrimitives,
	transformPrimitives,
} from "./symbolRender.js";

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

function distToSeg(pt, p1, p2) {
	const dx = p2[0] - p1[0];
	const dy = p2[1] - p1[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(pt.x - p1[0], pt.y - p1[1]);
	const t = Math.max(
		0,
		Math.min(1, ((pt.x - p1[0]) * dx + (pt.y - p1[1]) * dy) / lenSq),
	);
	return Math.hypot(pt.x - (p1[0] + t * dx), pt.y - (p1[1] + t * dy));
}

function isPointNearPolyline(pt, poly, wireTol) {
	for (let i = 0; i < poly.length - 1; i++) {
		if (distToSeg(pt, poly[i], poly[i + 1]) <= wireTol) return true;
	}
	return false;
}

function testPinHitWithMap(allPinPos, pt, pinRadius = 2.0) {
	for (const [key, pos] of allPinPos.entries()) {
		if (Math.hypot(pt.x - pos[0], pt.y - pos[1]) <= pinRadius) {
			const colon = key.indexOf(":");
			const id = key.slice(0, colon);
			const pin = key.slice(colon + 1);
			return { kind: "pin", id, pin };
		}
	}
	return null;
}

function testWireHitWithMap(nets, allPinPos, pt, wireTol = 1.27) {
	for (const net of nets) {
		const polylines = wireForNet(net, allPinPos);
		for (const poly of polylines) {
			if (isPointNearPolyline(pt, poly, wireTol)) {
				return { kind: "wire", id: net.id };
			}
		}
	}
	return null;
}

function schematicHitTest(doc, allPinPos, pt) {
	const pinHit = testPinHitWithMap(allPinPos, pt);
	if (pinHit) return pinHit;
	const wireHit = testWireHitWithMap(doc.ir?.nets ?? [], allPinPos, pt);
	if (wireHit) return wireHit;
	return hitTest(doc, [pt.x, pt.y]);
}

function useSymbolCache(parts, fetchSymbol) {
	const [symbols, setSymbols] = useState({});
	const fetchedRef = useRef(new Set());

	useEffect(() => {
		if (typeof fetchSymbol !== "function") return;
		for (const part of parts) {
			const libId = part.symbol;
			if (libId && !fetchedRef.current.has(libId)) {
				fetchedRef.current.add(libId);
				fetchSymbol(libId)
					.then((sym) => {
						if (sym) {
							setSymbols((prev) => ({ ...prev, [libId]: sym }));
						}
					})
					.catch(() => {});
			}
		}
	}, [parts, fetchSymbol]);

	return symbols;
}

function collectPartPinPos(part, sym) {
	if (sym) {
		const res = symbolPinPositions(sym, part.placement);
		return Object.entries(res);
	}
	const positions = pinPositions(part, part.pins);
	return Array.from(positions.entries());
}

function buildAllPinMap(parts, symbolCache) {
	const map = new Map();
	for (const part of parts) {
		const sym = part.symbol ? symbolCache[part.symbol] : null;
		for (const [pin, pos] of collectPartPinPos(part, sym)) {
			map.set(`${part.id}:${pin}`, pos);
		}
	}
	return map;
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

function SymbolPrimitive({ prim, style }) {
	const { stroke, strokeWidth } = style;
	if (prim.type === "rect") {
		return (
			<rect
				x={prim.x}
				y={prim.y}
				width={prim.width}
				height={prim.height}
				fill={style.fill}
				stroke={stroke}
				strokeWidth={strokeWidth}
			/>
		);
	}
	if (prim.type === "polyline") {
		const pts = prim.points.map((p) => `${p[0]},${p[1]}`).join(" ");
		return (
			<polyline
				points={pts}
				fill="none"
				stroke={stroke}
				strokeWidth={strokeWidth}
			/>
		);
	}
	if (prim.type === "circle") {
		return (
			<circle
				cx={prim.cx}
				cy={prim.cy}
				r={prim.r}
				fill="none"
				stroke={stroke}
				strokeWidth={strokeWidth}
			/>
		);
	}
	if (prim.type === "arc") {
		return (
			<path d={prim.d} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
		);
	}
	if (prim.type === "text") {
		return (
			<text
				x={prim.x}
				y={prim.y}
				fill="#94a3b8"
				fontSize={1.2}
				textAnchor="middle"
			>
				{prim.text}
			</text>
		);
	}
	return null;
}

function SymbolPin({ pin, activePart, wireStart, strokeWidth }) {
	const isStart =
		wireStart?.partId === activePart.id && wireStart?.pin === pin.number;
	const hasName = pin.name && pin.name !== "~";
	return (
		<g key={pin.number}>
			<line
				x1={pin.x}
				y1={pin.y}
				x2={pin.x2}
				y2={pin.y2}
				stroke="#94a3b8"
				strokeWidth={strokeWidth}
			/>
			<circle
				cx={pin.x}
				cy={pin.y}
				r={0.65}
				fill={isStart ? "#fadb14" : "#38bdf8"}
				stroke="#0d0f18"
				strokeWidth={0.2}
			/>
			<text
				x={pin.numberPos[0]}
				y={pin.numberPos[1]}
				fill="#94a3b8"
				fontSize={1.0}
				textAnchor="middle"
			>
				{pin.number}
			</text>
			{hasName && (
				<text
					x={pin.namePos[0]}
					y={pin.namePos[1]}
					fill="#38bdf8"
					fontSize={1.0}
					textAnchor="middle"
				>
					{pin.name}
				</text>
			)}
		</g>
	);
}

function getPrimKey(prim, idx) {
	if (prim.type === "pin") return `pin-${prim.number || idx}`;
	if (prim.type === "rect") return `rect-${prim.x}-${prim.y}-${prim.width}`;
	if (prim.type === "circle") return `circle-${prim.cx}-${prim.cy}`;
	if (prim.type === "arc") return `arc-${prim.d}`;
	if (prim.type === "polyline") {
		return `poly-${prim.points?.[0]?.[0]}-${prim.points?.[0]?.[1]}-${idx}`;
	}
	return `prim-${prim.type}-${idx}`;
}

function SymbolPartSvg({ activePart, isSelected, wireStart, symbol }) {
	const placement = {
		x: activePart.placement?.x ?? 0,
		y: activePart.placement?.y ?? 0,
		rot: activePart.placement?.rot ?? 0,
		side: activePart.placement?.side ?? "F",
	};
	const prims = transformPrimitives(symbolToSvgPrimitives(symbol), placement);
	const stroke = isSelected ? "#fadb14" : "#f87171";
	const fill = isSelected ? "rgba(250, 219, 20, 0.15)" : "none";
	const style = { stroke, fill, strokeWidth: 0.254 };
	const px = placement.x;
	const py = placement.y;

	return (
		<g className="schematic-part">
			{prims.map((prim, i) => {
				const k = getPrimKey(prim, i);
				return prim.type === "pin" ? (
					<SymbolPin
						key={k}
						pin={prim}
						activePart={activePart}
						wireStart={wireStart}
						strokeWidth={0.254}
					/>
				) : (
					<SymbolPrimitive key={k} prim={prim} style={style} />
				);
			})}
			<text
				x={px}
				y={py - 2.54}
				fill="#f1f5f9"
				fontSize={1.8}
				fontWeight="bold"
				textAnchor="middle"
			>
				{activePart.ref}
			</text>
			<text
				x={px}
				y={py + 3.81}
				fill="#94a3b8"
				fontSize={1.3}
				textAnchor="middle"
			>
				{activePart.value ?? ""}
			</text>
		</g>
	);
}

function BoxPartSvg({ activePart, isSelected, wireStart }) {
	const box = partBox(activePart);
	const pins = pinPositions(activePart);
	const stroke = isSelected ? "#fadb14" : "#38bdf8";
	const fill = isSelected ? "rgba(250, 219, 20, 0.15)" : "#161b2e";
	const rot = box.rot ? `rotate(${box.rot} ${box.cx} ${box.cy})` : undefined;
	const pinList = Array.isArray(activePart.pins) ? activePart.pins : ["1", "2"];

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

function PartSvg({ part, isSelected, dragPos, wireStart, symbol }) {
	const activePart = dragPos
		? { ...part, placement: { ...part.placement, x: dragPos.x, y: dragPos.y } }
		: part;
	if (symbol) {
		return (
			<SymbolPartSvg
				activePart={activePart}
				isSelected={isSelected}
				wireStart={wireStart}
				symbol={symbol}
			/>
		);
	}
	return (
		<BoxPartSvg
			activePart={activePart}
			isSelected={isSelected}
			wireStart={wireStart}
		/>
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

function handleWireModeKey(ctx) {
	ctx.setWireMode(true);
	ctx.setWireStart(null);
}

function handleEscapeKey(ctx) {
	ctx.setWireMode(false);
	ctx.setWireStart(null);
}

function handleRotateKey(ctx) {
	for (const id of ctx.doc.selection) {
		ctx.dispatchCmd({ type: "rotatePart", partId: id, deltaDeg: 90 });
	}
}

function handleFlipKey(ctx) {
	for (const id of ctx.doc.selection) {
		ctx.dispatchCmd({ type: "flipPart", partId: id });
	}
}

function handleDeleteKey(ctx) {
	for (const id of ctx.doc.selection) {
		ctx.dispatchCmd({ type: "deletePart", partId: id });
	}
}

const ACTION_KEY_HANDLERS = {
	w: handleWireModeKey,
	W: handleWireModeKey,
	Escape: handleEscapeKey,
	r: handleRotateKey,
	R: handleRotateKey,
	f: handleFlipKey,
	F: handleFlipKey,
	Delete: handleDeleteKey,
	Backspace: handleDeleteKey,
};

function handleActionKey(e, ctx) {
	const handler = ACTION_KEY_HANDLERS[e.key];
	if (handler) handler(ctx);
}

function isModifierKey(e) {
	return Boolean(e.ctrlKey || e.metaKey);
}

function isKey(e, keyName) {
	return e.key?.toLowerCase() === keyName;
}

function isUndoShortcut(e) {
	if (!isModifierKey(e)) return false;
	return isKey(e, "z") && !e.shiftKey;
}

function isRedoShortcut(e) {
	if (!isModifierKey(e)) return false;
	if (isKey(e, "y")) return true;
	return isKey(e, "z") && Boolean(e.shiftKey);
}

function handleKeyDown(e, ctx) {
	if (isUndoShortcut(e)) {
		e.preventDefault();
		ctx.handleUndo();
		return;
	}
	if (isRedoShortcut(e)) {
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

function startPanDrag(e, vp, panDragRef) {
	panDragRef.current = {
		sx: e.clientX,
		sy: e.clientY,
		px: vp.pan.x,
		py: vp.pan.y,
	};
}

function updatePanDrag(e, vp, panDrag) {
	const dx = e.clientX - panDrag.sx;
	const dy = e.clientY - panDrag.sy;
	vp.setPan({
		x: panDrag.px + dx,
		y: panDrag.py + dy,
	});
}

function commitPartDrag(dragState, dragPos, dispatchCmd) {
	if (dragState?.moved && dragPos) {
		dispatchCmd({
			type: "movePart",
			partId: dragState.partId,
			x: dragPos.x,
			y: dragPos.y,
		});
	}
}

function onPointerDownEvent(e, ctx) {
	const { svgRef, vp, isSpaceDown, panDragRef, doc, allPinPos, hitCtx } = ctx;
	if (!svgRef.current) return;
	if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
		startPanDrag(e, vp, panDragRef);
		return;
	}
	if (e.button !== 0) return;
	const worldPt = screenToWorld(e.clientX, e.clientY, svgRef.current, vp);
	const hit = schematicHitTest(doc, allPinPos, worldPt);
	handlePointerDownHit(hit, { ...hitCtx, doc, worldPt });
}

function usePointerDown(svgRef, editorState, wireState, dragInit) {
	const { vp, isSpaceDown, wireMode, allPinPos } = wireState;
	const { doc, dispatchCmd } = editorState;
	const { panDragRef, setDragState } = dragInit;
	const hitCtx = useMemo(
		() => ({ wireMode, wireState, dispatchCmd, setDragState }),
		[wireMode, wireState, dispatchCmd, setDragState],
	);

	return useCallback(
		(e) => {
			onPointerDownEvent(e, {
				svgRef,
				vp,
				isSpaceDown,
				panDragRef,
				doc,
				allPinPos,
				hitCtx,
			});
		},
		[svgRef, vp, isSpaceDown, panDragRef, doc, allPinPos, hitCtx],
	);
}

function usePointerMove(svgRef, vp, dragState, moveCtx) {
	const { panDragRef, setDragPos, setCursorWorld } = moveCtx;

	return useCallback(
		(e) => {
			if (!svgRef.current) return;
			const worldPt = screenToWorld(e.clientX, e.clientY, svgRef.current, vp);
			setCursorWorld(worldPt);
			if (panDragRef.current) {
				updatePanDrag(e, vp, panDragRef.current);
				return;
			}
			if (dragState) updatePartDrag(dragState, worldPt, setDragPos);
		},
		[dragState, setDragPos, vp, svgRef, panDragRef, setCursorWorld],
	);
}

function usePointerUp(editorState, wireState, dragState, upCtx) {
	const { dispatchCmd } = editorState;
	const { dragPos, setDragPos } = wireState;
	const { panDragRef, setDragState } = upCtx;

	return useCallback(() => {
		panDragRef.current = null;
		commitPartDrag(dragState, dragPos, dispatchCmd);
		setDragState(null);
		setDragPos(null);
	}, [dragState, dragPos, dispatchCmd, setDragPos, panDragRef, setDragState]);
}

function usePointerInteractions(svgRef, editorState, wireState) {
	const panDragRef = useRef(null);
	const [dragState, setDragState] = useState(null);
	const [cursorWorld, setCursorWorld] = useState(null);

	const dragInit = useMemo(() => ({ panDragRef, setDragState }), []);
	const moveCtx = useMemo(
		() => ({ panDragRef, setDragPos: wireState.setDragPos, setCursorWorld }),
		[wireState.setDragPos],
	);
	const upCtx = useMemo(() => ({ panDragRef, setDragState }), []);

	const onPointerDown = usePointerDown(
		svgRef,
		editorState,
		wireState,
		dragInit,
	);
	const onPointerMove = usePointerMove(
		svgRef,
		wireState.vp,
		dragState,
		moveCtx,
	);
	const onPointerUp = usePointerUp(editorState, wireState, dragState, upCtx);

	return { onPointerDown, onPointerMove, onPointerUp, cursorWorld };
}

function useCanvasViewport(svgRef) {
	const [pan, setPan] = useState({ x: 200, y: 150 });
	const [zoom, setZoom] = useState(4);
	const vp = useMemo(() => ({ pan, zoom, setPan, setZoom }), [pan, zoom]);
	useWheelZoom(svgRef, vp);
	return vp;
}

function useWireSession() {
	const [wireMode, setWireMode] = useState(false);
	const [wireStart, setWireStart] = useState(null);
	const [dragPos, setDragPos] = useState(null);
	return {
		wireMode,
		setWireMode,
		wireStart,
		setWireStart,
		dragPos,
		setDragPos,
	};
}

function useWireState(wire, vp, isSpaceDown, allPinPos) {
	return useMemo(
		() => ({
			wireStart: wire.wireStart,
			setWireStart: wire.setWireStart,
			wireMode: wire.wireMode,
			setWireMode: wire.setWireMode,
			vp,
			isSpaceDown,
			dragPos: wire.dragPos,
			setDragPos: wire.setDragPos,
			allPinPos,
		}),
		[
			wire.wireStart,
			wire.wireMode,
			wire.dragPos,
			wire.setWireMode,
			wire.setWireStart,
			wire.setDragPos,
			vp,
			isSpaceDown,
			allPinPos,
		],
	);
}

function useKeyContext(ed, wire) {
	return useMemo(
		() => ({
			doc: ed.doc,
			dispatchCmd: ed.dispatchCmd,
			handleUndo: ed.handleUndo,
			handleRedo: ed.handleRedo,
			setWireMode: wire.setWireMode,
			setWireStart: wire.setWireStart,
		}),
		[
			ed.doc,
			ed.dispatchCmd,
			ed.handleUndo,
			ed.handleRedo,
			wire.setWireMode,
			wire.setWireStart,
		],
	);
}

function useEditorModel(editor, onChange, fetchSymbol) {
	const ed = useSchematicEditor(editor, onChange);
	const parts = ed.doc.ir?.parts ?? [];
	const symbolCache = useSymbolCache(parts, fetchSymbol);
	const allPinPos = useMemo(
		() => buildAllPinMap(parts, symbolCache),
		[parts, symbolCache],
	);
	return { ed, symbolCache, allPinPos };
}

function useSchematicCanvasState({ editor, onChange, fetchSymbol }) {
	const svgRef = useRef(null);
	const [isSpaceDown, setIsSpaceDown] = useState(false);
	const vp = useCanvasViewport(svgRef);
	const wire = useWireSession();
	const model = useEditorModel(editor, onChange, fetchSymbol);
	const { ed, symbolCache, allPinPos } = model;
	const wireState = useWireState(wire, vp, isSpaceDown, allPinPos);
	const editorState = useMemo(
		() => ({ doc: ed.doc, dispatchCmd: ed.dispatchCmd }),
		[ed.doc, ed.dispatchCmd],
	);
	const ptr = usePointerInteractions(svgRef, editorState, wireState);
	const keyCtx = useKeyContext(ed, wire);
	return {
		svgRef,
		vp,
		wire,
		doc: ed.doc,
		symbolCache,
		allPinPos,
		ptr,
		keyCtx,
		setIsSpaceDown,
	};
}

function handleCanvasKeyDown(e, setIsSpaceDown, keyCtx) {
	if (e.code === "Space") setIsSpaceDown(true);
	handleKeyDown(e, keyCtx);
}

function handleCanvasKeyUp(e, setIsSpaceDown) {
	if (e.code === "Space") setIsSpaceDown(false);
}

function SchematicNetsLayer({ nets, allPinPos, selection }) {
	return (nets ?? []).map((net) => (
		<WireSvg
			key={net.id}
			net={net}
			allPinPos={allPinPos}
			isSelected={selection?.includes(net.id)}
		/>
	));
}

function SchematicPartsLayer({ parts, selection, wire, symbolCache }) {
	return (parts ?? []).map((part) => (
		<PartSvg
			key={part.id}
			part={part}
			isSelected={selection?.includes(part.id)}
			dragPos={wire.dragPos?.partId === part.id ? wire.dragPos : null}
			wireStart={wire.wireStart}
			symbol={part.symbol ? symbolCache[part.symbol] : null}
		/>
	));
}

const SEVERITY_RANK = Object.freeze({ error: 2, warning: 1, info: 0 });

function updateProblemGroup(entry, prob) {
	const currentRank = SEVERITY_RANK[entry.severity] ?? 0;
	const sev = (prob?.severity ?? "info").toLowerCase();
	const nextRank = SEVERITY_RANK[sev] ?? 0;
	if (nextRank > currentRank) {
		entry.severity = sev;
	}
	const msg = prob?.message ?? prob?.title;
	if (msg) entry.messages.push(String(msg));
}

function groupProblemsByPart(problems) {
	const map = new Map();
	if (!Array.isArray(problems)) return map;
	for (const prob of problems) {
		const ids = Array.isArray(prob?.itemIds) ? prob.itemIds : [];
		for (const id of ids) {
			const entry = map.get(id) ?? { severity: "info", messages: [] };
			updateProblemGroup(entry, prob);
			map.set(id, entry);
		}
	}
	return map;
}

function getBadgeCoords(part) {
	const box = partBox(part);
	if (!box.rot) {
		return { x: box.x + box.width, y: box.y };
	}
	const rad = (box.rot * Math.PI) / 180;
	const dx = box.width / 2;
	const dy = -box.height / 2;
	return {
		x: box.cx + dx * Math.cos(rad) - dy * Math.sin(rad),
		y: box.cy + dx * Math.sin(rad) + dy * Math.cos(rad),
	};
}

function buildProblemMarkers(parts, grouped) {
	const markers = [];
	for (const part of parts ?? []) {
		const entry = grouped.get(part.id);
		if (!entry) continue;
		const { x, y } = getBadgeCoords(part);
		markers.push({
			key: `problem-${part.id}`,
			x,
			y,
			severity: entry.severity,
			message: entry.messages.join("\n"),
		});
	}
	return markers;
}

function extractProblemGlyphs(parts, problems) {
	if (!Array.isArray(problems) || problems.length === 0) return [];
	const grouped = groupProblemsByPart(problems);
	if (grouped.size === 0) return [];
	const markers = buildProblemMarkers(parts, grouped);
	return markerGlyphs(markers);
}

function SchematicProblemsOverlay({ parts, problems }) {
	const glyphs = useMemo(
		() => extractProblemGlyphs(parts, problems),
		[parts, problems],
	);

	if (glyphs.length === 0) return null;

	return (
		<g
			className="schematic-problem-badges"
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
					strokeWidth={0.3}
				>
					<title>{g.title}</title>
				</circle>
			))}
		</g>
	);
}

function SchematicSvgScene({ s, problems }) {
	return (
		<g transform={`translate(${s.vp.pan.x},${s.vp.pan.y}) scale(${s.vp.zoom})`}>
			<SchematicGrid />
			<SchematicNetsLayer
				nets={s.doc.ir?.nets}
				allPinPos={s.allPinPos}
				selection={s.doc.selection}
			/>
			<SchematicPartsLayer
				parts={s.doc.ir?.parts}
				selection={s.doc.selection}
				wire={s.wire}
				symbolCache={s.symbolCache}
			/>
			<RubberbandWire
				wireStart={s.wire.wireStart}
				allPinPos={s.allPinPos}
				cursorWorld={s.ptr.cursorWorld}
			/>
			<SchematicProblemsOverlay parts={s.doc.ir?.parts} problems={problems} />
		</g>
	);
}

export default function SchematicCanvas({
	editor,
	onChange,
	fetchSymbol,
	problems = [],
}) {
	const s = useSchematicCanvasState({ editor, onChange, fetchSymbol });
	return (
		// biome-ignore lint/a11y/useSemanticElements: canvas container provides schematic interaction area
		<div
			// biome-ignore lint/a11y/noNoninteractiveTabindex: schematic editor canvas requires focus for keyboard shortcuts
			tabIndex={0}
			role="region"
			aria-label="Schematic editor"
			style={CANVAS_CONTAINER_STYLE}
			onKeyDown={(e) => handleCanvasKeyDown(e, s.setIsSpaceDown, s.keyCtx)}
			onKeyUp={(e) => handleCanvasKeyUp(e, s.setIsSpaceDown)}
			onPointerDown={s.ptr.onPointerDown}
			onPointerMove={s.ptr.onPointerMove}
			onPointerUp={s.ptr.onPointerUp}
		>
			<svg
				ref={s.svgRef}
				width="100%"
				height="100%"
				style={{ display: "block", userSelect: "none" }}
			>
				<title>Schematic Canvas</title>
				<SchematicSvgScene s={s} problems={problems} />
			</svg>
		</div>
	);
}
