import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boxSelect, normalizeBox } from "./boxSelect.js";
import { applyCommand } from "./editorModel.js";
import { resolveSchematicAction } from "./hotkeys.js";
import { markerGlyphs } from "./markerRender.js";
import { netItemsAt, netRingPoints } from "./netHighlight.js";
import { partItems } from "./partBounds.js";
import { isPanPointer, pointerDownTarget } from "./pointerIntent.js";
import {
	hitTest,
	partBox,
	pinPositions,
	wireForNet,
	wireHitTolerance,
} from "./schematicGeometry.js";
import {
	getPrimKey,
	symbolPinPositions,
	symbolToSvgPrimitives,
	transformPrimitives,
} from "./symbolRender.js";
import { getSchematicColor, SCHEMATIC_THEME } from "./theme.js";
import {
	bboxOfPoints,
	fitToBounds,
	screenToWorld,
	snapPoint,
	worldToScreen,
	zoomAt,
} from "./viewport.js";

const CANVAS_CONTAINER_STYLE = Object.freeze({
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "450px",
	overflow: "hidden",
	background: SCHEMATIC_THEME.background,
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
			const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			const factor = e.deltaY < 0 ? 1.15 : 0.87;
			const next = zoomAt({ pan, zoom }, screenPt, factor);
			setPan(next.pan);
			setZoom(next.zoom);
		};
		el.addEventListener("wheel", handleWheel, { passive: false });
		return () => el.removeEventListener("wheel", handleWheel);
	}, [svgRef, pan, zoom, setPan, setZoom]);
}

function clientToWorld(clientX, clientY, svgEl, vp) {
	const rect = svgEl.getBoundingClientRect();
	return screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, vp);
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

function schematicHitTest(doc, allPinPos, pt, zoom) {
	const pinHit = testPinHitWithMap(allPinPos, pt);
	if (pinHit) return pinHit;
	const wireTol = wireHitTolerance(zoom);
	const nets = doc.ir?.nets ?? [];
	const wireHit = testWireHitWithMap(nets, allPinPos, pt, wireTol);
	if (wireHit) return wireHit;
	return hitTest(doc, [pt.x, pt.y], { wireTol });
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

function SchematicGrid({ zoom, theme }) {
	const gridStep = zoom * 1.27 >= 4 ? 1.27 : 12.7;
	const half = gridStep / 2;
	const color = getSchematicColor(theme, "grid");
	return (
		<>
			<defs>
				<pattern
					id="sch-grid"
					x={-half}
					y={-half}
					width={gridStep}
					height={gridStep}
					patternUnits="userSpaceOnUse"
				>
					<circle cx={half} cy={half} r={0.2} fill={color} />
				</pattern>
			</defs>
			<rect
				x={-50000}
				y={-50000}
				width={100000}
				height={100000}
				fill="url(#sch-grid)"
			/>
		</>
	);
}

function PinSvg({ pin, pos, isWireStart, theme }) {
	const selColor = getSchematicColor(theme, "selection");
	const pinColor = getSchematicColor(theme, "pin");
	return (
		<g key={pin}>
			<circle
				cx={pos[0]}
				cy={pos[1]}
				r={0.65}
				fill={isWireStart ? selColor : pinColor}
				stroke={getSchematicColor(theme, "background")}
				strokeWidth={0.2}
			/>
			<text
				x={pos[0]}
				y={pos[1] - 0.9}
				fill={getSchematicColor(theme, "pinNumber")}
				fontSize={1.1}
				textAnchor="middle"
			>
				{pin}
			</text>
		</g>
	);
}

function renderShapePrim(prim, style) {
	const { stroke, strokeWidth } = style;
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
	return null;
}

function renderRectPrim(prim, style) {
	return (
		<rect
			x={prim.x}
			y={prim.y}
			width={prim.width}
			height={prim.height}
			fill={style.fill}
			fillOpacity={style.fillOpacity}
			stroke={style.stroke}
			strokeWidth={style.strokeWidth}
		/>
	);
}

function renderPolylinePrim(prim, style) {
	const pts = prim.points.map((p) => `${p[0]},${p[1]}`).join(" ");
	return (
		<polyline
			points={pts}
			fill="none"
			stroke={style.stroke}
			strokeWidth={style.strokeWidth}
		/>
	);
}

function SymbolPrimitive({ prim, style }) {
	if (prim.type === "rect") return renderRectPrim(prim, style);
	if (prim.type === "polyline") return renderPolylinePrim(prim, style);
	if (prim.type === "text") {
		return (
			<text
				x={prim.x}
				y={prim.y}
				fill={style.stroke}
				fontSize={1.2}
				textAnchor="middle"
			>
				{prim.text}
			</text>
		);
	}
	return renderShapePrim(prim, style);
}

function SymbolPinName({ name, pos, color }) {
	if (!name || name === "~") return null;
	return (
		<text x={pos[0]} y={pos[1]} fill={color} fontSize={1.0} textAnchor="middle">
			{name}
		</text>
	);
}

function SymbolPin({ pin, activePart, wireStart, strokeWidth, theme }) {
	const isStart =
		wireStart?.partId === activePart.id && wireStart?.pin === pin.number;
	const pinColor = getSchematicColor(theme, "pin");
	return (
		<g key={pin.number}>
			<line
				x1={pin.x}
				y1={pin.y}
				x2={pin.x2}
				y2={pin.y2}
				stroke={pinColor}
				strokeWidth={strokeWidth}
			/>
			<circle
				cx={pin.x}
				cy={pin.y}
				r={0.65}
				fill={isStart ? getSchematicColor(theme, "selection") : pinColor}
				stroke={getSchematicColor(theme, "background")}
				strokeWidth={0.2}
			/>
			<text
				x={pin.numberPos[0]}
				y={pin.numberPos[1]}
				fill={getSchematicColor(theme, "pinNumber")}
				fontSize={1.0}
				textAnchor="middle"
			>
				{pin.number}
			</text>
			<SymbolPinName
				name={pin.name}
				pos={pin.namePos}
				color={getSchematicColor(theme, "pinName")}
			/>
		</g>
	);
}

function PartTextLabels({ x, yRef, yVal, refText, valueText, theme }) {
	return (
		<>
			<text
				x={x}
				y={yRef}
				fill={getSchematicColor(theme, "reference")}
				fontSize={1.8}
				fontWeight="bold"
				textAnchor="middle"
			>
				{refText}
			</text>
			<text
				x={x}
				y={yVal}
				fill={getSchematicColor(theme, "value")}
				fontSize={1.3}
				textAnchor="middle"
			>
				{valueText ?? ""}
			</text>
		</>
	);
}

function SymbolPartSvg({ activePart, isSelected, wireStart, symbol, theme }) {
	const pl = activePart.placement ?? {};
	const placement = {
		x: pl.x ?? 0,
		y: pl.y ?? 0,
		rot: pl.rot ?? 0,
		side: pl.side ?? "F",
	};
	const prims = transformPrimitives(symbolToSvgPrimitives(symbol), placement);
	const stroke = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "symbolBody");
	const fill = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "symbolFill");
	const style = {
		stroke,
		fill,
		fillOpacity: isSelected ? 0.2 : 1,
		strokeWidth: 0.254,
	};

	return (
		<g className="schematic-part">
			{prims.map((prim, i) =>
				prim.type === "pin" ? (
					<SymbolPin
						key={getPrimKey(prim, i)}
						pin={prim}
						activePart={activePart}
						wireStart={wireStart}
						strokeWidth={0.254}
						theme={theme}
					/>
				) : (
					<SymbolPrimitive
						key={getPrimKey(prim, i)}
						prim={prim}
						style={style}
					/>
				),
			)}
			<PartTextLabels
				x={placement.x}
				yRef={placement.y - 2.54}
				yVal={placement.y + 3.81}
				refText={activePart.ref}
				valueText={activePart.value}
				theme={theme}
			/>
		</g>
	);
}

function BoxPartPins({ pinList, pins, wireStart, activePart, theme }) {
	return pinList.map((p) => {
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
				theme={theme}
			/>
		);
	});
}

function BoxPartSvg({ activePart, isSelected, wireStart, theme }) {
	const box = partBox(activePart);
	const pins = pinPositions(activePart);
	const stroke = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "symbolBody");
	const fill = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "symbolFill");
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
				fillOpacity={isSelected ? 0.2 : 1}
				stroke={stroke}
				strokeWidth={isSelected ? 0.6 : 0.4}
				rx={0.5}
			/>
			<PartTextLabels
				x={box.cx}
				yRef={box.cy - 1.2}
				yVal={box.cy + 1.8}
				refText={activePart.ref}
				valueText={activePart.value}
				theme={theme}
			/>
			<BoxPartPins
				pinList={pinList}
				pins={pins}
				wireStart={wireStart}
				activePart={activePart}
				theme={theme}
			/>
		</g>
	);
}

function PartSvg({ part, isSelected, dragPos, wireStart, symbol, theme }) {
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
				theme={theme}
			/>
		);
	}
	return (
		<BoxPartSvg
			activePart={activePart}
			isSelected={isSelected}
			wireStart={wireStart}
			theme={theme}
		/>
	);
}

function getNetLabelPos(polylines) {
	const first = polylines[0];
	if (!first || first.length < 2) return null;
	return {
		x: (first[0][0] + first[1][0]) / 2,
		y: (first[0][1] + first[1][1]) / 2 - 0.5,
	};
}

function WireSvg({ net, allPinPos, isSelected, theme }) {
	const polylines = wireForNet(net, allPinPos);
	const stroke = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "wire");
	const strokeWidth = isSelected ? 0.6 : 0.4;
	const lbl = getNetLabelPos(polylines);

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
					fill={stroke}
					fontSize={1.2}
					textAnchor="middle"
				>
					{net.name}
				</text>
			)}
		</g>
	);
}

function RubberbandWire({ wireStart, allPinPos, cursorWorld, theme }) {
	if (!wireStart || !cursorWorld) return null;
	const startPos = allPinPos.get(`${wireStart.partId}:${wireStart.pin}`);
	if (!startPos) return null;
	return (
		<polyline
			points={`${startPos[0]},${startPos[1]} ${cursorWorld.x},${cursorWorld.y}`}
			fill="none"
			stroke={getSchematicColor(theme, "selection")}
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
	ctx.setDragState(null);
	ctx.setDragPos(null);
}

function forEachSelected(ctx, makeCmd) {
	for (const id of ctx.doc.selection) {
		ctx.dispatchCmd(makeCmd(id));
	}
}

function handleRotateKey(ctx) {
	forEachSelected(ctx, (id) => ({
		type: "rotatePart",
		partId: id,
		deltaDeg: 90,
	}));
}

// Mirror about the Y axis: flipPart negates the symbol's local x.
function handleMirrorYKey(ctx) {
	forEachSelected(ctx, (id) => ({ type: "flipPart", partId: id }));
}

// Mirror about the X axis = mirror about Y, then rotate 180 degrees.
function handleMirrorXKey(ctx) {
	handleMirrorYKey(ctx);
	forEachSelected(ctx, (id) => ({
		type: "rotatePart",
		partId: id,
		deltaDeg: 180,
	}));
}

function handleDeleteKey(ctx) {
	forEachSelected(ctx, (id) => ({ type: "deletePart", partId: id }));
}

function handleHomeKey(ctx) {
	const parts = ctx.doc.ir?.parts ?? [];
	const points = parts.map((p) => ({
		x: p.placement?.x ?? 0,
		y: p.placement?.y ?? 0,
	}));
	const bounds = bboxOfPoints(points);
	const rect = ctx.svgRef?.current?.getBoundingClientRect();
	const size = {
		width: rect?.width || 800,
		height: rect?.height || 600,
	};
	const next = fitToBounds(bounds, size);
	ctx.vp.setPan(next.pan);
	ctx.vp.setZoom(next.zoom);
}

function zoomAtCenter(ctx, factor) {
	const rect = ctx.svgRef?.current?.getBoundingClientRect();
	const center = { x: (rect?.width || 800) / 2, y: (rect?.height || 600) / 2 };
	const next = zoomAt(ctx.vp, center, factor);
	ctx.vp.setPan(next.pan);
	ctx.vp.setZoom(next.zoom);
}

// M / G: the first selected part follows the cursor; the next click drops it.
function handleMoveKey(ctx) {
	const part = ctx.doc.ir?.parts?.find((p) => p.id === ctx.doc.selection[0]);
	if (!part || !ctx.cursorWorld) return;
	ctx.setDragState({
		partId: part.id,
		startX: part.placement?.x ?? 0,
		startY: part.placement?.y ?? 0,
		mouseStartX: ctx.cursorWorld.x,
		mouseStartY: ctx.cursorWorld.y,
		moved: false,
		keyboard: true,
	});
}

// E: select the item under the cursor so the properties panel shows it.
function handleEditKey(ctx) {
	if (!ctx.cursorWorld) return;
	const hit = schematicHitTest(
		ctx.doc,
		ctx.allPinPos,
		ctx.cursorWorld,
		ctx.vp.zoom,
	);
	if (hit?.kind === "part" || hit?.kind === "wire") {
		ctx.dispatchCmd({ type: "select", ids: [hit.id] });
	}
}

const ACTION_KEY_HANDLERS = {
	placeWire: handleWireModeKey,
	cancel: handleEscapeKey,
	rotate: handleRotateKey,
	mirrorX: handleMirrorXKey,
	mirrorY: handleMirrorYKey,
	move: handleMoveKey,
	drag: handleMoveKey,
	edit: handleEditKey,
	delete: handleDeleteKey,
	undo: (ctx) => ctx.handleUndo(),
	redo: (ctx) => ctx.handleRedo(),
	zoomFit: handleHomeKey,
	zoomIn: (ctx) => zoomAtCenter(ctx, 1.15),
	zoomOut: (ctx) => zoomAtCenter(ctx, 0.87),
};

function handleKeyDown(e, ctx) {
	const handler = ACTION_KEY_HANDLERS[resolveSchematicAction(e)];
	if (!handler) return;
	e.preventDefault();
	handler(ctx);
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
	const target = pointerDownTarget(hit?.kind, wireMode);
	if (target === "connect") {
		handlePinConnect(hit, wireState, dispatchCmd);
		return;
	}
	if (wireMode) {
		wireState.setWireMode(false);
		wireState.setWireStart(null);
	}
	if (target === "part") {
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
	} else if (target === "wire") {
		dispatchCmd({ type: "select", ids: [hit.id] });
	} else {
		handleEmptyPointerDown(hitCtx);
	}
}

function handleEmptyPointerDown({
	wireMode,
	dispatchCmd,
	setBoxDrag,
	worldPt,
	capturePointer,
}) {
	// Wire mode has no box drag, so the click clears now. Otherwise the box
	// commit on pointer-up dispatches the single select (empty for a click).
	if (wireMode) {
		dispatchCmd({ type: "select", ids: [] });
		return;
	}
	capturePointer();
	setBoxDrag({ start: worldPt, end: worldPt });
}

function releasePointer(e) {
	const el = e?.currentTarget;
	if (el?.hasPointerCapture?.(e.pointerId))
		el.releasePointerCapture(e.pointerId);
}

function commitBoxSelect(boxDrag, editorState) {
	if (!boxDrag) return;
	const { doc, symbolCache, dispatchCmd } = editorState;
	const items = partItems(doc.ir, symbolCache);
	const ids = boxSelect(items, boxDrag.start, boxDrag.end);
	dispatchCmd({ type: "select", ids });
}

function updatePartDrag(dragState, worldPt, setDragPos) {
	const dx = worldPt.x - dragState.mouseStartX;
	const dy = worldPt.y - dragState.mouseStartY;
	if (Math.hypot(dx, dy) > 0.5) dragState.moved = true;
	const pos = snapPoint(
		{ x: dragState.startX + dx, y: dragState.startY + dy },
		1.27,
	);
	setDragPos({ partId: dragState.partId, x: pos.x, y: pos.y });
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
	if (isPanPointer(e.button, isSpaceDown)) {
		startPanDrag(e, vp, panDragRef);
		return;
	}
	if (e.button !== 0 || ctx.keyboardMove) return;
	const worldPt = clientToWorld(e.clientX, e.clientY, svgRef.current, vp);
	const hit = schematicHitTest(doc, allPinPos, worldPt, vp.zoom);
	const el = e.currentTarget;
	const capturePointer = () => el?.setPointerCapture?.(e.pointerId);
	handlePointerDownHit(hit, { ...hitCtx, doc, worldPt, capturePointer });
}

function usePointerDown(svgRef, editorState, wireState, dragInit) {
	const { vp, isSpaceDown, wireMode, allPinPos } = wireState;
	const { doc, dispatchCmd } = editorState;
	const { panDragRef, setDragState, setBoxDrag, keyboardMove } = dragInit;
	const hitCtx = useMemo(
		() => ({ wireMode, wireState, dispatchCmd, setDragState, setBoxDrag }),
		[wireMode, wireState, dispatchCmd, setDragState, setBoxDrag],
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
				keyboardMove,
			});
		},
		[svgRef, vp, isSpaceDown, panDragRef, doc, allPinPos, hitCtx, keyboardMove],
	);
}

function usePointerMove(svgRef, vp, dragState, moveCtx) {
	const { panDragRef, setDragPos, setCursorWorld, boxDrag, setBoxDrag } =
		moveCtx;

	return useCallback(
		(e) => {
			if (!svgRef.current) return;
			const worldPt = clientToWorld(e.clientX, e.clientY, svgRef.current, vp);
			setCursorWorld(worldPt);
			if (panDragRef.current) {
				updatePanDrag(e, vp, panDragRef.current);
				return;
			}
			if (dragState) updatePartDrag(dragState, worldPt, setDragPos);
			if (boxDrag) setBoxDrag({ ...boxDrag, end: worldPt });
		},
		[
			dragState,
			setDragPos,
			vp,
			svgRef,
			panDragRef,
			setCursorWorld,
			boxDrag,
			setBoxDrag,
		],
	);
}

function usePointerUp(editorState, wireState, dragState, upCtx) {
	const { dispatchCmd } = editorState;
	const { dragPos, setDragPos } = wireState;
	const { panDragRef, setDragState, boxDrag, setBoxDrag } = upCtx;

	return useCallback(
		(e) => {
			releasePointer(e);
			panDragRef.current = null;
			commitPartDrag(dragState, dragPos, dispatchCmd);
			commitBoxSelect(boxDrag, editorState);
			setBoxDrag(null);
			setDragState(null);
			setDragPos(null);
		},
		[
			dragState,
			dragPos,
			dispatchCmd,
			editorState,
			boxDrag,
			setBoxDrag,
			setDragPos,
			panDragRef,
			setDragState,
		],
	);
}

function usePointerInteractions(svgRef, editorState, wireState) {
	const panDragRef = useRef(null);
	const [dragState, setDragState] = useState(null);
	const [cursorWorld, setCursorWorld] = useState(null);
	const [boxDrag, setBoxDrag] = useState(null);

	const keyboardMove = Boolean(dragState?.keyboard);
	const dragInit = useMemo(
		() => ({ panDragRef, setDragState, setBoxDrag, keyboardMove }),
		[keyboardMove],
	);
	const moveCtx = useMemo(
		() => ({
			panDragRef,
			setDragPos: wireState.setDragPos,
			setCursorWorld,
			boxDrag,
			setBoxDrag,
		}),
		[wireState.setDragPos, boxDrag],
	);
	const upCtx = useMemo(
		() => ({ panDragRef, setDragState, boxDrag, setBoxDrag }),
		[boxDrag],
	);

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
	const onPointerLeave = useCallback(() => setCursorWorld(null), []);
	// Cancel or a lost capture drops the box without selecting anything.
	const onPointerCancel = useCallback(() => setBoxDrag(null), []);

	return {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerLeave,
		onPointerCancel,
		cursorWorld,
		setCursorWorld,
		setDragState,
		boxDrag,
	};
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

function useKeyContext(ed, wire, ptr, view) {
	const { vp, svgRef, allPinPos } = view;
	return useMemo(
		() => ({
			doc: ed.doc,
			dispatchCmd: ed.dispatchCmd,
			handleUndo: ed.handleUndo,
			handleRedo: ed.handleRedo,
			setWireMode: wire.setWireMode,
			setWireStart: wire.setWireStart,
			setDragPos: wire.setDragPos,
			setDragState: ptr.setDragState,
			cursorWorld: ptr.cursorWorld,
			allPinPos,
			vp,
			svgRef,
		}),
		[
			ed.doc,
			ed.dispatchCmd,
			ed.handleUndo,
			ed.handleRedo,
			wire.setWireMode,
			wire.setWireStart,
			wire.setDragPos,
			ptr.setDragState,
			ptr.cursorWorld,
			allPinPos,
			vp,
			svgRef,
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
		() => ({ doc: ed.doc, dispatchCmd: ed.dispatchCmd, symbolCache }),
		[ed.doc, ed.dispatchCmd, symbolCache],
	);
	const ptr = usePointerInteractions(svgRef, editorState, wireState);
	const keyCtx = useKeyContext(ed, wire, ptr, { vp, svgRef, allPinPos });
	return {
		svgRef,
		vp,
		wire,
		doc: ed.doc,
		symbolCache,
		allPinPos,
		ptr,
		keyCtx,
		isSpaceDown,
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

function SchematicNetsLayer({ nets, allPinPos, selection, theme }) {
	return (nets ?? []).map((net) => (
		<WireSvg
			key={net.id}
			net={net}
			allPinPos={allPinPos}
			isSelected={selection?.includes(net.id)}
			theme={theme}
		/>
	));
}

function SchematicPartsLayer({ parts, selection, wire, symbolCache, theme }) {
	return (parts ?? []).map((part) => (
		<PartSvg
			key={part.id}
			part={part}
			isSelected={selection?.includes(part.id)}
			dragPos={wire.dragPos?.partId === part.id ? wire.dragPos : null}
			wireStart={wire.wireStart}
			symbol={part.symbol ? symbolCache[part.symbol] : null}
			theme={theme}
		/>
	));
}

function SchematicJunctionsLayer({ doc, theme }) {
	const junctions = doc?.ir?.junctions;
	if (!Array.isArray(junctions) || junctions.length === 0) return null;
	const color = getSchematicColor(theme, "junction");
	return (
		<g className="schematic-junctions">
			{junctions.map((j) => {
				const jx = j.x ?? j[0];
				const jy = j.y ?? j[1];
				return (
					<circle
						key={j.id ?? `junc-${jx}:${jy}`}
						cx={jx}
						cy={jy}
						r={0.65}
						fill={color}
					/>
				);
			})}
		</g>
	);
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

function SchematicSelectionBox({ boxDrag, vp, theme }) {
	if (!boxDrag) return null;
	const box = normalizeBox(
		worldToScreen(boxDrag.start, vp),
		worldToScreen(boxDrag.end, vp),
	);
	const color = getSchematicColor(theme, "selection");
	const rightToLeft = boxDrag.end.x < boxDrag.start.x;
	return (
		<rect
			className="schematic-box-select"
			x={box.minX}
			y={box.minY}
			width={box.maxX - box.minX}
			height={box.maxY - box.minY}
			stroke={color}
			strokeWidth={1}
			strokeDasharray={rightToLeft ? "4 3" : undefined}
			fill={color}
			fillOpacity={0.08}
			pointerEvents="none"
		/>
	);
}

function SchematicCrosshair({ cursorWorld, vp, theme }) {
	if (!cursorWorld) return null;
	const snapped = snapPoint(cursorWorld, 1.27);
	const pt = worldToScreen(snapped, vp);
	const color = getSchematicColor(theme, "cursor");
	return (
		<g
			className="schematic-crosshair"
			pointerEvents="none"
			style={{ pointerEvents: "none" }}
		>
			<line
				x1={0}
				y1={pt.y}
				x2="100%"
				y2={pt.y}
				stroke={color}
				strokeWidth={1}
			/>
			<line
				x1={pt.x}
				y1={0}
				x2={pt.x}
				y2="100%"
				stroke={color}
				strokeWidth={1}
			/>
		</g>
	);
}

function SchematicNetHighlightLayer({ highlightNet, allPinPos, theme }) {
	const points = netRingPoints(highlightNet, allPinPos);
	if (points.length === 0) return null;
	const color = getSchematicColor(theme, "highlight") || "#facc15";
	return (
		<g style={{ pointerEvents: "none" }}>
			{points.map((pt) => (
				<circle
					key={`${pt.x},${pt.y}`}
					cx={pt.x}
					cy={pt.y}
					r={1.2}
					fill="none"
					stroke={color}
					strokeWidth={0.3}
				/>
			))}
		</g>
	);
}

function nextHighlight(hit, ir) {
	if (!hit) return null;
	if (hit.kind === "pin")
		return netItemsAt(ir, { partId: hit.id, pin: hit.pin });
	return undefined;
}

function useNetHighlight(s) {
	const [highlightNet, setHighlightNet] = useState(null);
	const { svgRef, vp, doc, allPinPos, wire, isSpaceDown } = s;
	const onPointerDown = useCallback(
		(e) => {
			// A pan (middle button or Space+left) leaves the highlight alone.
			if (isPanPointer(e.button, isSpaceDown) || e.button !== 0) return;
			if (wire.wireMode || !svgRef.current) return;
			const pt = clientToWorld(e.clientX, e.clientY, svgRef.current, vp);
			const hit = schematicHitTest(doc, allPinPos, pt, vp.zoom);
			const next = nextHighlight(hit, doc.ir);
			if (next !== undefined) setHighlightNet(next);
		},
		[svgRef, vp, doc, allPinPos, wire.wireMode, isSpaceDown],
	);
	const onKeyDown = useCallback((e) => {
		if (e.key === "Escape") setHighlightNet(null);
	}, []);
	return { highlightNet, onPointerDown, onKeyDown };
}

function SchematicSvgScene({ s, problems, theme, highlightNet }) {
	return (
		<g transform={`translate(${s.vp.pan.x},${s.vp.pan.y}) scale(${s.vp.zoom})`}>
			<SchematicGrid zoom={s.vp.zoom} theme={theme} />
			<SchematicNetsLayer
				nets={s.doc.ir?.nets}
				allPinPos={s.allPinPos}
				selection={s.doc.selection}
				theme={theme}
			/>
			<SchematicNetHighlightLayer
				highlightNet={highlightNet}
				allPinPos={s.allPinPos}
				theme={theme}
			/>
			<SchematicPartsLayer
				parts={s.doc.ir?.parts}
				selection={s.doc.selection}
				wire={s.wire}
				symbolCache={s.symbolCache}
				theme={theme}
			/>
			<RubberbandWire
				wireStart={s.wire.wireStart}
				allPinPos={s.allPinPos}
				cursorWorld={s.ptr.cursorWorld}
				theme={theme}
			/>
			<SchematicJunctionsLayer doc={s.doc} theme={theme} />
			<SchematicProblemsOverlay parts={s.doc.ir?.parts} problems={problems} />
		</g>
	);
}

// Feeds the editor status bar: cursor in world mm plus the current zoom.
function useCursorReport(onCursorMove, cursorWorld, zoom) {
	useEffect(() => {
		onCursorMove?.({ x: cursorWorld?.x, y: cursorWorld?.y, zoom });
	}, [onCursorMove, cursorWorld, zoom]);
}

export default function SchematicCanvas({
	editor,
	onChange,
	fetchSymbol,
	problems = [],
	theme,
	onCursorMove,
}) {
	const s = useSchematicCanvasState({ editor, onChange, fetchSymbol });
	const hl = useNetHighlight(s);
	useCursorReport(onCursorMove, s.ptr.cursorWorld, s.vp.zoom);
	const bg = getSchematicColor(theme, "background");
	return (
		// biome-ignore lint/a11y/useSemanticElements: canvas container provides schematic interaction area
		<div
			// biome-ignore lint/a11y/noNoninteractiveTabindex: schematic editor canvas requires focus for keyboard shortcuts
			tabIndex={0}
			role="region"
			aria-label="Schematic editor"
			style={{ ...CANVAS_CONTAINER_STYLE, background: bg }}
			onKeyDown={(e) => {
				hl.onKeyDown(e);
				handleCanvasKeyDown(e, s.setIsSpaceDown, s.keyCtx);
			}}
			onKeyUp={(e) => handleCanvasKeyUp(e, s.setIsSpaceDown)}
			onPointerDown={(e) => {
				hl.onPointerDown(e);
				s.ptr.onPointerDown(e);
			}}
			onPointerMove={s.ptr.onPointerMove}
			onPointerUp={s.ptr.onPointerUp}
			onPointerCancel={s.ptr.onPointerCancel}
			onLostPointerCapture={s.ptr.onPointerCancel}
			onPointerLeave={s.ptr.onPointerLeave}
		>
			<svg
				ref={s.svgRef}
				width="100%"
				height="100%"
				style={{ display: "block", userSelect: "none" }}
			>
				<title>Schematic Canvas</title>
				<SchematicSvgScene
					s={s}
					problems={problems}
					theme={theme}
					highlightNet={hl.highlightNet}
				/>
				<SchematicSelectionBox
					boxDrag={s.ptr.boxDrag}
					vp={s.vp}
					theme={theme}
				/>
				<SchematicCrosshair
					cursorWorld={s.ptr.cursorWorld}
					vp={s.vp}
					theme={theme}
				/>
			</svg>
		</div>
	);
}
