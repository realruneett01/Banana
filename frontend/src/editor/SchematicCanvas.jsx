import { Input, Modal } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boxSelect, normalizeBox } from "./boxSelect.js";
import { applyCommand } from "./editorModel.js";
import { emitActiveTool, onEditorTool } from "./editorToolBus.js";
import { isTypingTarget, resolveSchematicAction } from "./hotkeys.js";
import { markerGlyphs } from "./markerRender.js";
import { netItemsAt, netRingPoints } from "./netHighlight.js";
import { partItems } from "./partBounds.js";
import { buildPlacedPart } from "./partPlacement.js";
import { pointerDownTarget } from "./pointerIntent.js";
import SchAnnotationLayer, {
	hitTestAnnotation,
} from "./SchAnnotationLayer.jsx";
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
import { useCanvasNav } from "./useCanvasNav.js";
import {
	bboxOfPoints,
	screenToWorld,
	snapPoint,
	worldToScreen,
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

function clientToWorld(clientX, clientY, svgEl, vp) {
	const rect = svgEl.getBoundingClientRect();
	return screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, vp);
}

const SCH_GRID = 1.27;

function snapToGrid(pt) {
	return snapPoint(pt, SCH_GRID);
}

export function isSchematicPart(part) {
	return typeof part?.symbol === "string" && part.symbol.trim() !== "";
}

const LABEL_PREFIXES = Object.freeze({
	label: "NET",
	globalLabel: "G",
	hierLabel: "H",
});

function extractPrefixNumbers(items, prop, re, used) {
	for (const it of items) {
		const val = it?.[prop];
		if (typeof val === "string") {
			const m = re.exec(val);
			if (m) used.add(Number.parseInt(m[1], 10));
		}
	}
}

export function nextFreeLabelName(kind, annotations = [], nets = []) {
	if (kind === "text") return "TEXT";
	const prefix = LABEL_PREFIXES[kind] || "NET";
	const used = new Set();
	const re = new RegExp(`^${prefix}(\\d+)$`);
	if (annotations) extractPrefixNumbers(annotations, "text", re, used);
	if (nets) extractPrefixNumbers(nets, "name", re, used);
	let num = 1;
	while (used.has(num)) num++;
	return `${prefix}${num}`;
}

export function buildWireSegments(p1, p2, orientation = "horizontal-first") {
	if (!p1 || !p2) return [];
	const x1 = Math.round(p1.x * 1e4) / 1e4;
	const y1 = Math.round(p1.y * 1e4) / 1e4;
	const x2 = Math.round(p2.x * 1e4) / 1e4;
	const y2 = Math.round(p2.y * 1e4) / 1e4;
	if (x1 === x2 && y1 === y2) return [];
	if (x1 === x2 || y1 === y2) {
		return [{ x: x1, y: y1, x2, y2 }];
	}
	const corner =
		orientation === "horizontal-first" ? { x: x2, y: y1 } : { x: x1, y: y2 };
	return [
		{ x: x1, y: y1, x2: corner.x, y2: corner.y },
		{ x: corner.x, y: corner.y, x2, y2 },
	];
}

export function findPinNearPoint(pt, allPinPos, radius = 1.27) {
	if (!pt || !allPinPos) return null;
	const entries =
		allPinPos instanceof Map ? allPinPos.entries() : Object.entries(allPinPos);
	for (const [key, pos] of entries) {
		if (Math.hypot(pt.x - pos[0], pt.y - pos[1]) <= radius) {
			const colon = key.indexOf(":");
			return {
				partId: key.slice(0, colon),
				pin: key.slice(colon + 1),
				x: pos[0],
				y: pos[1],
			};
		}
	}
	return null;
}

export function snapPointToPinOrGrid(pt, allPinPos, grid = 1.27) {
	const pinHit = findPinNearPoint(pt, allPinPos, grid);
	if (pinHit) {
		return {
			x: pinHit.x,
			y: pinHit.y,
			pin: { partId: pinHit.partId, pin: pinHit.pin },
		};
	}
	const snapped = snapToGrid(pt, grid);
	return { x: snapped.x, y: snapped.y, pin: null };
}

function wirePtKey(x, y) {
	return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
}

function createDisjointSet(wires) {
	const parent = new Map();
	const find = (k) => {
		if (!parent.has(k)) parent.set(k, k);
		if (parent.get(k) !== k) parent.set(k, find(parent.get(k)));
		return parent.get(k);
	};
	const union = (k1, k2) => {
		const r1 = find(k1);
		const r2 = find(k2);
		if (r1 !== r2) parent.set(r1, r2);
	};
	for (const w of wires) {
		union(wirePtKey(w.x, w.y), wirePtKey(w.x2 ?? w.x, w.y2 ?? w.y));
	}
	return find;
}

function isPinNearWire(pos, w, tol) {
	const d1 = Math.hypot(pos[0] - w.x, pos[1] - w.y);
	if (d1 <= tol) return wirePtKey(w.x, w.y);
	const x2 = w.x2 ?? w.x;
	const y2 = w.y2 ?? w.y;
	const d2 = Math.hypot(pos[0] - x2, pos[1] - y2);
	return d2 <= tol ? wirePtKey(x2, y2) : null;
}

function findPinWireRoot(pos, wires, find, tol) {
	for (const w of wires) {
		const near = isPinNearWire(pos, w, tol);
		if (near) return find(near);
	}
	return null;
}

function groupPinsByWireTree(allPinPos, wires, find, tol) {
	const entries =
		allPinPos instanceof Map
			? Array.from(allPinPos.entries())
			: Object.entries(allPinPos);
	const groups = new Map();
	for (const [key, pos] of entries) {
		const root = findPinWireRoot(pos, wires, find, tol);
		if (!root) continue;
		const colon = key.indexOf(":");
		const pinObj = { partId: key.slice(0, colon), pin: key.slice(colon + 1) };
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root).push(pinObj);
	}
	return groups;
}

function collectPinPairs(pins, pairs) {
	for (let i = 0; i < pins.length - 1; i++) {
		for (let j = i + 1; j < pins.length; j++) {
			if (pins[i].partId !== pins[j].partId || pins[i].pin !== pins[j].pin) {
				pairs.push({
					partIdA: pins[i].partId,
					pinA: pins[i].pin,
					partIdB: pins[j].partId,
					pinB: pins[j].pin,
				});
			}
		}
	}
}

export function findPinsConnectedByWires(annotations, allPinPos, tol = 1.27) {
	const wires = (annotations ?? []).filter((a) => a.kind === "wire");
	if (wires.length === 0 || !allPinPos) return [];
	const find = createDisjointSet(wires);
	const groups = groupPinsByWireTree(allPinPos, wires, find, tol);
	const pairs = [];
	for (const pins of groups.values()) {
		collectPinPairs(pins, pairs);
	}
	return pairs;
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
	const wireTol = wireHitTolerance(zoom);
	const annHit = hitTestAnnotation(doc.ir?.annotations, pt, wireTol);
	if (annHit) return { kind: "annotation", id: annHit };
	const pinHit = testPinHitWithMap(allPinPos, pt);
	if (pinHit) return pinHit;
	const nets = doc.ir?.nets ?? [];
	const wireHit = testWireHitWithMap(nets, allPinPos, pt, wireTol);
	if (wireHit) return wireHit;
	const filteredDoc = doc?.ir?.parts
		? { ...doc, ir: { ...doc.ir, parts: doc.ir.parts.filter(isSchematicPart) } }
		: doc;
	return hitTest(filteredDoc, [pt.x, pt.y], { wireTol });
}

function useSymbolCache(parts, fetchSymbol) {
	const [symbols, setSymbols] = useState({});
	const fetchedRef = useRef(new Set());

	useEffect(() => {
		if (typeof fetchSymbol !== "function") return;
		for (const part of (parts ?? []).filter(isSchematicPart)) {
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
	for (const part of (parts ?? []).filter(isSchematicPart)) {
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

function hasWireAnnotationForPins(annotations, pins, allPinPos) {
	if (!Array.isArray(annotations) || !Array.isArray(pins) || pins.length < 2) {
		return false;
	}
	const pts = pins
		.map((p) => allPinPos?.get?.(`${p.partId}:${p.pin}`))
		.filter(Boolean);
	if (pts.length < 2) return false;
	return annotations.some(
		(a) =>
			a.kind === "wire" &&
			pts.some(
				(pt) =>
					Math.hypot(pt[0] - a.x, pt[1] - a.y) <= 0.1 ||
					Math.hypot(pt[0] - (a.x2 ?? a.x), pt[1] - (a.y2 ?? a.y)) <= 0.1,
			),
	);
}

function WireSvg({ net, allPinPos, isSelected, theme, annotations }) {
	const polylines = hasWireAnnotationForPins(annotations, net?.pins, allPinPos)
		? []
		: wireForNet(net, allPinPos);
	const lbl = getNetLabelPos(polylines);
	if (polylines.length === 0 && !lbl) return null;
	const stroke = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "wire");
	const strokeWidth = isSelected ? 0.5 : 0.254;

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
	const endSnapped = snapPointToPinOrGrid(cursorWorld, allPinPos, SCH_GRID);
	const segments = buildWireSegments(wireStart, endSnapped);
	if (segments.length === 0) return null;
	const stroke = getSchematicColor(theme, "wire") || "#009600";
	return (
		<g className="schematic-rubberband-wire" pointerEvents="none">
			{segments.map((seg) => (
				<line
					key={`${seg.x}-${seg.y}-${seg.x2}-${seg.y2}`}
					x1={seg.x}
					y1={seg.y}
					x2={seg.x2}
					y2={seg.y2}
					stroke={stroke}
					strokeWidth={0.254}
				/>
			))}
		</g>
	);
}

function GhostBox({ snapped, dummyPart, theme }) {
	const stroke = getSchematicColor(theme, "selection");
	const { x, y } = snapped;
	return (
		<g>
			<rect
				x={x - 5}
				y={y - 5}
				width={10}
				height={10}
				fill="none"
				stroke={stroke}
				strokeWidth={0.4}
				strokeDasharray="1.5,1.5"
				rx={0.5}
			/>
			<PartTextLabels
				x={x}
				yRef={y - 1.2}
				yVal={y + 1.8}
				refText={dummyPart.ref}
				valueText={dummyPart.value}
				theme={theme}
			/>
		</g>
	);
}

function ghostGeometry(armedPart, cursor, symbol) {
	if (!armedPart || !cursor) return null;
	const snapped = snapToGrid(cursor);
	const item = armedPart.item ?? {};
	const dummyPart = {
		id: "__ghost__",
		ref: item.ref ?? item.prefix ?? "?",
		value: item.value ?? "",
		symbol: item.symbol ?? "",
		placement: { x: snapped.x, y: snapped.y, rot: 0, side: "F" },
	};
	return { snapped, dummyPart, symbol };
}

function ArmedGhostMarker({ armedPart, cursorWorld, symbolCache, theme }) {
	const symbol = armedPart?.item?.symbol
		? symbolCache?.[armedPart.item.symbol]
		: null;
	const geom = ghostGeometry(armedPart, cursorWorld, symbol);
	if (!geom) return null;
	return (
		<g className="schematic-armed-ghost" opacity={0.5} pointerEvents="none">
			{geom.symbol ? (
				<PartSvg
					part={geom.dummyPart}
					isSelected={false}
					dragPos={null}
					wireStart={null}
					symbol={geom.symbol}
					theme={theme}
				/>
			) : (
				<GhostBox
					snapped={geom.snapped}
					dummyPart={geom.dummyPart}
					theme={theme}
				/>
			)}
		</g>
	);
}

function RubberbandAnnotationLine({ lineStart, cursorWorld, tool, theme }) {
	if (!lineStart || !cursorWorld) return null;
	const end = snapToGrid(cursorWorld);
	const isBus = tool === "placeBus";
	const busColor = getSchematicColor(theme, "bus") || "#000084";
	const stroke = isBus ? busColor : getSchematicColor(theme, "selection");
	return (
		<line
			x1={lineStart.x}
			y1={lineStart.y}
			x2={end.x}
			y2={end.y}
			stroke={stroke}
			strokeWidth={isBus ? 0.8 : 0.3}
			strokeDasharray={isBus ? undefined : "1.27,1.27"}
			pointerEvents="none"
		/>
	);
}

function SchematicGhostLayer({ s, theme }) {
	return (
		<>
			<RubberbandWire
				wireStart={s.wire.wireStart}
				allPinPos={s.allPinPos}
				cursorWorld={s.ptr.cursorWorld}
				theme={theme}
			/>
			<RubberbandAnnotationLine
				lineStart={s.annotationSession?.lineStart}
				cursorWorld={s.ptr.cursorWorld}
				tool={s.annotationSession?.annotationTool}
				theme={theme}
			/>
			<ArmedGhostMarker
				armedPart={s.armedPart}
				cursorWorld={s.ptr.cursorWorld}
				symbolCache={s.symbolCache}
				theme={theme}
			/>
		</>
	);
}

function resetToolMode(target) {
	target.setWireMode?.(false);
	target.setWireStart?.(null);
	target.setArmedPart?.(null);
	target.setAnnotationTool?.(null);
	target.setLineStart?.(null);
	target.setTextModal?.(null);
}

function handleWireModeKey(ctx) {
	resetToolMode(ctx);
	ctx.setWireMode(true);
}

function handleAnnotationToolKey(ctx, tool) {
	resetToolMode(ctx);
	ctx.setAnnotationTool?.(tool);
}

function handleEscapeKey(ctx) {
	if (ctx.wireStart) {
		ctx.setWireStart(null);
		return;
	}
	if (ctx.lineStart) {
		ctx.setLineStart(null);
		return;
	}
	resetToolMode(ctx);
	ctx.setDragState(null);
	ctx.setDragPos(null);
	ctx.setHighlightNet?.(null);
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
	for (const id of ctx.doc.selection) {
		if (ctx.doc.ir?.annotations?.some((a) => a.id === id)) {
			ctx.dispatchCmd({ type: "deleteAnnotation", id });
		} else {
			ctx.dispatchCmd({ type: "deletePart", partId: id });
		}
	}
}

function getSchematicBounds(doc) {
	const parts = (doc?.ir?.parts ?? []).filter(isSchematicPart);
	const points = parts.map((p) => ({
		x: p.placement?.x ?? 0,
		y: p.placement?.y ?? 0,
	}));
	return bboxOfPoints(points);
}

// M / G: the first selected part follows the cursor; the next click drops it.
function handleMoveKey(ctx) {
	const selId = ctx.doc.selection[0];
	if (!selId || !ctx.cursorWorld) return;
	const ann = ctx.doc.ir?.annotations?.find((a) => a.id === selId);
	if (ann) {
		ctx.setDragState({
			annId: ann.id,
			startX: ann.x,
			startY: ann.y,
			mouseStartX: ctx.cursorWorld.x,
			mouseStartY: ctx.cursorWorld.y,
			moved: false,
			keyboard: true,
		});
		return;
	}
	const part = ctx.doc.ir?.parts
		?.filter(isSchematicPart)
		.find((p) => p.id === selId);
	if (!part) return;
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
	if (
		hit?.kind === "part" ||
		hit?.kind === "wire" ||
		hit?.kind === "annotation"
	) {
		ctx.dispatchCmd({ type: "select", ids: [hit.id] });
	}
}

const ACTION_KEY_HANDLERS = {
	placeWire: handleWireModeKey,
	placeBus: (ctx) => handleAnnotationToolKey(ctx, "placeBus"),
	placeNoConnect: (ctx) => handleAnnotationToolKey(ctx, "placeNoConnect"),
	placeJunction: (ctx) => handleAnnotationToolKey(ctx, "placeJunction"),
	placeLabel: (ctx) => handleAnnotationToolKey(ctx, "placeLabel"),
	placeGlobalLabel: (ctx) => handleAnnotationToolKey(ctx, "placeGlobalLabel"),
	placeHierLabel: (ctx) => handleAnnotationToolKey(ctx, "placeHierLabel"),
	placeText: (ctx) => handleAnnotationToolKey(ctx, "placeText"),
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
};

function handleKeyDown(e, ctx) {
	const handler = ACTION_KEY_HANDLERS[resolveSchematicAction(e)];
	if (!handler) return;
	e.preventDefault();
	handler(ctx);
}

function commitWireSegments(segments, dispatchCmd) {
	if (!segments || segments.length === 0) return [];
	const annotations = segments.map((seg) => ({
		kind: "wire",
		x: seg.x,
		y: seg.y,
		x2: seg.x2,
		y2: seg.y2,
	}));
	const commands = annotations.map((annotation) => ({
		type: "addAnnotation",
		annotation,
	}));
	dispatchCmd({ type: "batch", commands });
	return annotations;
}

function connectPinsIfTouched(startPin, nextPin, dispatchCmd) {
	if (!startPin || !nextPin) return;
	if (startPin.partId === nextPin.partId && startPin.pin === nextPin.pin)
		return;
	dispatchCmd({
		type: "connect",
		partIdA: startPin.partId,
		pinA: startPin.pin,
		partIdB: nextPin.partId,
		pinB: nextPin.pin,
	});
}

function arePinsInSameNet(nets, partIdA, pinA, partIdB, pinB) {
	return (nets ?? []).some(
		(n) =>
			n.pins?.some((p) => p.partId === partIdA && p.pin === pinA) &&
			n.pins?.some((p) => p.partId === partIdB && p.pin === pinB),
	);
}

function syncConnectedWirePins(annotations, nets, allPinPos, dispatchCmd) {
	const pairs = findPinsConnectedByWires(annotations, allPinPos, SCH_GRID);
	for (const pair of pairs) {
		if (
			!arePinsInSameNet(nets, pair.partIdA, pair.pinA, pair.partIdB, pair.pinB)
		) {
			dispatchCmd({ type: "connect", ...pair });
		}
	}
}

function resolvePinOrSnap(hit, worldPt, allPinPos) {
	if (hit?.kind === "pin" && hit.id && hit.pin) {
		const pos = allPinPos?.get?.(`${hit.id}:${hit.pin}`);
		if (pos) {
			return {
				x: pos[0],
				y: pos[1],
				pin: { partId: hit.id, pin: hit.pin },
			};
		}
	}
	return snapPointToPinOrGrid(worldPt, allPinPos, 2.0);
}

function updateWireEndState(snapped, startPin, setWireStart) {
	if (snapped.pin) {
		setWireStart(null);
		return;
	}
	setWireStart({
		x: snapped.x,
		y: snapped.y,
		partId: startPin?.partId,
		pin: startPin?.pin,
		startPin,
	});
}

function handleWirePointerDown(hitCtx, hit) {
	const { worldPt, wireState, dispatchCmd, doc } = hitCtx;
	const { wireStart, setWireStart, allPinPos } = wireState;
	const snapped = resolvePinOrSnap(hit, worldPt, allPinPos);
	if (!wireStart) {
		setWireStart({
			x: snapped.x,
			y: snapped.y,
			partId: snapped.pin?.partId,
			pin: snapped.pin?.pin,
			startPin: snapped.pin,
		});
		return;
	}
	const segments = buildWireSegments(wireStart, snapped);
	const newAnns = commitWireSegments(segments, dispatchCmd);
	const startPin =
		wireStart.startPin ??
		(wireStart.partId
			? { partId: wireStart.partId, pin: wireStart.pin }
			: null);
	connectPinsIfTouched(startPin, snapped.pin, dispatchCmd);
	const allAnns = [...(doc?.ir?.annotations ?? []), ...newAnns];
	syncConnectedWirePins(allAnns, doc?.ir?.nets, allPinPos, dispatchCmd);
	updateWireEndState(snapped, startPin, setWireStart);
}

function handlePinConnect(hit, wireState, dispatchCmd) {
	const { wireStart, setWireStart } = wireState;
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
	resetToolMode(wireState);
}

function handleArmedClick(hit, hitCtx) {
	if (!hit) {
		const snapped = snapToGrid(hitCtx.worldPt);
		const parts = hitCtx.doc.ir?.parts;
		const part = buildPlacedPart(hitCtx.armedPart.item, parts, snapped);
		hitCtx.dispatchCmd({ type: "addPart", part });
	}
}

const ANNOTATION_TOOLS = new Set([
	"placeNoConnect",
	"placeJunction",
	"placeLabel",
	"placeGlobalLabel",
	"placeHierLabel",
	"placeText",
	"placeLine",
	"placeBus",
]);

function isAnnotationTool(tool) {
	return ANNOTATION_TOOLS.has(tool);
}

const TEXT_TOOL_KIND = {
	placeLabel: "label",
	placeGlobalLabel: "globalLabel",
	placeHierLabel: "hierLabel",
	placeText: "text",
};

const MODAL_TITLES = {
	label: "Place Net Label",
	globalLabel: "Place Global Label",
	hierLabel: "Place Hierarchical Label",
	text: "Place Text",
};

function handleLineAnnotationClick(tool, hitCtx, snapped) {
	const { lineStart, setLineStart, dispatchCmd } = hitCtx;
	if (!lineStart) {
		setLineStart(snapped);
		return;
	}
	const kind = tool === "placeLine" ? "line" : "bus";
	dispatchCmd({
		type: "addAnnotation",
		annotation: {
			kind,
			x: lineStart.x,
			y: lineStart.y,
			x2: snapped.x,
			y2: snapped.y,
		},
	});
	setLineStart(null);
}

function handleAnnotationClick(tool, hitCtx, worldPt) {
	const snapped = snapToGrid(worldPt);
	if (tool === "placeNoConnect" || tool === "placeJunction") {
		const kind = tool === "placeNoConnect" ? "noConnect" : "junction";
		hitCtx.dispatchCmd({
			type: "addAnnotation",
			annotation: { kind, x: snapped.x, y: snapped.y },
		});
		return;
	}
	if (tool === "placeLine" || tool === "placeBus") {
		handleLineAnnotationClick(tool, hitCtx, snapped);
		return;
	}
	const textKind = TEXT_TOOL_KIND[tool];
	if (textKind) {
		const text = nextFreeLabelName(
			textKind,
			hitCtx.doc?.ir?.annotations,
			hitCtx.doc?.ir?.nets,
		);
		hitCtx.dispatchCmd({
			type: "addAnnotation",
			annotation: { kind: textKind, x: snapped.x, y: snapped.y, text },
		});
	}
}

function handleAnnotationSelect(hit, doc, worldPt, hitCtx) {
	hitCtx.dispatchCmd({ type: "select", ids: [hit.id] });
	const ann = doc.ir?.annotations?.find((a) => a.id === hit.id);
	hitCtx.setDragState({
		annId: hit.id,
		startX: ann?.x ?? 0,
		startY: ann?.y ?? 0,
		mouseStartX: worldPt.x,
		mouseStartY: worldPt.y,
		moved: false,
	});
}

function handlePartSelect(hit, doc, worldPt, hitCtx) {
	hitCtx.dispatchCmd({ type: "select", ids: [hit.id] });
	const part = doc.ir.parts?.find((p) => p.id === hit.id);
	hitCtx.setDragState({
		partId: hit.id,
		startX: part?.placement?.x ?? 0,
		startY: part?.placement?.y ?? 0,
		mouseStartX: worldPt.x,
		mouseStartY: worldPt.y,
		moved: false,
	});
}

function handlePointerDownHit(hit, hitCtx) {
	const { wireMode, wireState, dispatchCmd, doc, worldPt } = hitCtx;
	if (wireMode) {
		handleWirePointerDown(hitCtx, hit);
		return;
	}
	if (hit?.kind === "annotation") {
		handleAnnotationSelect(hit, doc, worldPt, hitCtx);
		return;
	}
	const target = pointerDownTarget(hit?.kind, wireMode);
	if (target === "connect") {
		handlePinConnect(hit, wireState, dispatchCmd);
	} else if (target === "part") {
		handlePartSelect(hit, doc, worldPt, hitCtx);
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
	const filteredIr = doc?.ir?.parts
		? { ...doc.ir, parts: doc.ir.parts.filter(isSchematicPart) }
		: doc?.ir;
	const items = partItems(filteredIr, symbolCache);
	const ids = boxSelect(items, boxDrag.start, boxDrag.end);
	dispatchCmd({ type: "select", ids });
}

function updatePartDrag(dragState, worldPt, setDragPos) {
	const dx = worldPt.x - dragState.mouseStartX;
	const dy = worldPt.y - dragState.mouseStartY;
	if (Math.hypot(dx, dy) > 0.5) dragState.moved = true;
	const pos = snapToGrid({
		x: dragState.startX + dx,
		y: dragState.startY + dy,
	});
	setDragPos({
		partId: dragState.partId,
		annId: dragState.annId,
		x: pos.x,
		y: pos.y,
		dx: pos.x - dragState.startX,
		dy: pos.y - dragState.startY,
	});
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
	if (!dragState?.moved || !dragPos) return;
	if (dragState.annId) {
		const dx = dragPos.x - dragState.startX;
		const dy = dragPos.y - dragState.startY;
		dispatchCmd({
			type: "moveAnnotation",
			id: dragState.annId,
			dx,
			dy,
		});
	} else if (dragState.partId) {
		dispatchCmd({
			type: "movePart",
			partId: dragState.partId,
			x: dragPos.x,
			y: dragPos.y,
		});
	}
}

function updateNetHighlight(hit, doc, hitCtx) {
	if (hitCtx.wireMode || hitCtx.armedPart || hitCtx.annotationTool) return;
	const next = nextHighlight(hit, doc.ir);
	if (next !== undefined) hitCtx.setHighlightNet?.(next);
}

function onPointerDownEvent(e, ctx) {
	const { svgRef, vp, isSpaceDown, panDragRef, doc, allPinPos, hitCtx } = ctx;
	if (!svgRef.current) return;
	if (e.button === 0 && isSpaceDown) {
		startPanDrag(e, vp, panDragRef);
		return;
	}
	if (e.button !== 0 || ctx.keyboardMove) return;
	const worldPt = clientToWorld(e.clientX, e.clientY, svgRef.current, vp);
	const hit = schematicHitTest(doc, allPinPos, worldPt, vp.zoom);
	updateNetHighlight(hit, doc, hitCtx);
	if (hitCtx.armedPart) {
		handleArmedClick(hit, { ...hitCtx, doc, worldPt });
		return;
	}
	if (hitCtx.annotationTool) {
		handleAnnotationClick(hitCtx.annotationTool, { ...hitCtx, doc }, worldPt);
		return;
	}
	const el = e.currentTarget;
	const capturePointer = () => el?.setPointerCapture?.(e.pointerId);
	handlePointerDownHit(hit, { ...hitCtx, doc, worldPt, capturePointer });
}

function usePointerDown(svgRef, editorState, wireState, dragInit) {
	const { vp, isSpaceDown, wireMode, allPinPos } = wireState;
	const { doc, dispatchCmd, armedPart, setHighlightNet, annotationSession } =
		editorState;
	const { panDragRef, setDragState, setBoxDrag, keyboardMove } = dragInit;
	const hitCtx = useMemo(
		() => ({
			wireMode,
			wireState,
			dispatchCmd,
			setDragState,
			setBoxDrag,
			armedPart,
			setHighlightNet,
			annotationTool: annotationSession?.annotationTool,
			lineStart: annotationSession?.lineStart,
			setLineStart: annotationSession?.setLineStart,
			setTextModal: annotationSession?.setTextModal,
		}),
		[
			wireMode,
			wireState,
			dispatchCmd,
			setDragState,
			setBoxDrag,
			armedPart,
			setHighlightNet,
			annotationSession?.annotationTool,
			annotationSession?.lineStart,
			annotationSession?.setLineStart,
			annotationSession?.setTextModal,
		],
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

function isPlaceTool(tool) {
	return tool === "placeSymbol" || tool === "placePower";
}

const TOOL_ALIASES = {
	wire: "placeWire",
	label: "placeLabel",
	globalLabel: "placeGlobalLabel",
	hierLabel: "placeHierLabel",
	text: "placeText",
	noConnect: "placeNoConnect",
	junction: "placeJunction",
	line: "placeLine",
	bus: "placeBus",
};

function handleBusTool(payload, setters) {
	const rawTool = payload?.tool;
	const tool = TOOL_ALIASES[rawTool] ?? rawTool;
	const item = payload?.item;
	resetToolMode(setters);
	if (tool === "placeWire") {
		setters.setWireMode(true);
	} else if (isPlaceTool(tool) && item) {
		setters.setArmedPart({ tool, item });
	} else if (isAnnotationTool(tool)) {
		setters.setAnnotationTool(tool);
	}
}

function reportActiveTool(wireMode, armedPart, annotationTool) {
	if (wireMode) {
		emitActiveTool({ tab: "schematic", tool: "placeWire", item: null });
	} else if (armedPart) {
		emitActiveTool({
			tab: "schematic",
			tool: armedPart.tool,
			item: armedPart.item,
		});
	} else if (annotationTool) {
		emitActiveTool({
			tab: "schematic",
			tool: annotationTool,
			item: null,
		});
	} else {
		emitActiveTool({ tab: "schematic", tool: "select", item: null });
	}
}

function focusCanvas(containerRef) {
	if (typeof document === "undefined") return;
	if (isTypingTarget(document.activeElement)) return;
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

function useAnnotationSession() {
	const [annotationTool, setAnnotationTool] = useState(null);
	const [lineStart, setLineStart] = useState(null);
	const [textModal, setTextModal] = useState(null);
	return {
		annotationTool,
		setAnnotationTool,
		lineStart,
		setLineStart,
		textModal,
		setTextModal,
	};
}

function useToolBus({
	wireMode,
	setWireMode,
	setWireStart,
	containerRef,
	annotationSession,
}) {
	const [armedPart, setArmedPart] = useState(null);
	const { annotationTool, setAnnotationTool, setLineStart, setTextModal } =
		annotationSession;

	useEffect(() => {
		const setters = {
			setWireMode,
			setWireStart,
			setArmedPart,
			setAnnotationTool,
			setLineStart,
			setTextModal,
		};
		return onEditorTool((p) => {
			focusCanvas(containerRef);
			handleBusTool(p, setters);
		}, "schematic");
	}, [
		setWireMode,
		setWireStart,
		containerRef,
		setAnnotationTool,
		setLineStart,
		setTextModal,
	]);

	useEffect(() => {
		reportActiveTool(wireMode, armedPart, annotationTool);
	}, [wireMode, armedPart, annotationTool]);

	return { armedPart, setArmedPart };
}

function useCanvasViewport() {
	const [view, setView] = useState({ pan: { x: 200, y: 150 }, zoom: 4 });
	const setPan = useCallback(
		(pan) =>
			setView((prev) => ({
				...prev,
				pan: typeof pan === "function" ? pan(prev.pan) : pan,
			})),
		[],
	);
	const setZoom = useCallback(
		(zoom) =>
			setView((prev) => ({
				...prev,
				zoom: typeof zoom === "function" ? zoom(prev.zoom) : zoom,
			})),
		[],
	);
	const vp = useMemo(
		() => ({ pan: view.pan, zoom: view.zoom, setPan, setZoom }),
		[view.pan, view.zoom, setPan, setZoom],
	);
	return { view, setView, vp };
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
	const {
		vp,
		svgRef,
		allPinPos,
		setArmedPart,
		setHighlightNet,
		annotationSession,
	} = view;
	return useMemo(
		() => ({
			doc: ed.doc,
			dispatchCmd: ed.dispatchCmd,
			handleUndo: ed.handleUndo,
			handleRedo: ed.handleRedo,
			wireMode: wire.wireMode,
			wireStart: wire.wireStart,
			setWireMode: wire.setWireMode,
			setWireStart: wire.setWireStart,
			setDragPos: wire.setDragPos,
			setDragState: ptr.setDragState,
			cursorWorld: ptr.cursorWorld,
			allPinPos,
			vp,
			svgRef,
			setArmedPart,
			setHighlightNet,
			annotationTool: annotationSession?.annotationTool,
			setAnnotationTool: annotationSession?.setAnnotationTool,
			lineStart: annotationSession?.lineStart,
			setLineStart: annotationSession?.setLineStart,
		}),
		[
			ed.doc,
			ed.dispatchCmd,
			ed.handleUndo,
			ed.handleRedo,
			wire.wireMode,
			wire.wireStart,
			wire.setWireMode,
			wire.setWireStart,
			wire.setDragPos,
			ptr.setDragState,
			ptr.cursorWorld,
			allPinPos,
			vp,
			svgRef,
			setArmedPart,
			setHighlightNet,
			annotationSession?.annotationTool,
			annotationSession?.setAnnotationTool,
			annotationSession?.lineStart,
			annotationSession?.setLineStart,
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

function useSchematicCanvasState({
	editor,
	onChange,
	fetchSymbol,
	containerRef,
}) {
	const svgRef = useRef(null);
	const [isSpaceDown, setIsSpaceDown] = useState(false);
	const [highlightNet, setHighlightNet] = useState(null);
	const { view, setView, vp } = useCanvasViewport();
	const wire = useWireSession();
	const annotationSession = useAnnotationSession();
	const busInit = { ...wire, containerRef, annotationSession };
	const { armedPart, setArmedPart } = useToolBus(busInit);
	const { ed, symbolCache, allPinPos } = useEditorModel(
		editor,
		onChange,
		fetchSymbol,
	);
	const getBounds = useCallback(() => getSchematicBounds(ed.doc), [ed.doc]);
	const wireState = useWireState(wire, vp, isSpaceDown, allPinPos);
	const editorState = useMemo(
		() => ({
			doc: ed.doc,
			dispatchCmd: ed.dispatchCmd,
			symbolCache,
			armedPart,
			setHighlightNet,
			annotationSession,
		}),
		[ed.doc, ed.dispatchCmd, symbolCache, armedPart, annotationSession],
	);
	const ptr = usePointerInteractions(svgRef, editorState, wireState);
	const viewCtx = {
		vp,
		svgRef,
		allPinPos,
		setArmedPart,
		setHighlightNet,
		annotationSession,
	};
	const keyCtx = useKeyContext(ed, wire, ptr, viewCtx);
	return {
		svgRef,
		vp,
		view,
		setView,
		getBounds,
		wire,
		armedPart,
		annotationSession,
		doc: ed.doc,
		symbolCache,
		allPinPos,
		ptr,
		keyCtx,
		isSpaceDown,
		setIsSpaceDown,
		highlightNet,
	};
}

function handleCanvasKeyDown(e, setIsSpaceDown, keyCtx) {
	if (e.code === "Space") setIsSpaceDown(true);
	handleKeyDown(e, keyCtx);
}

function handleCanvasKeyUp(e, setIsSpaceDown) {
	if (e.code === "Space") setIsSpaceDown(false);
}

function SchematicNetsLayer({
	nets,
	allPinPos,
	selection,
	theme,
	annotations,
}) {
	return (nets ?? []).map((net) => (
		<WireSvg
			key={net.id}
			net={net}
			allPinPos={allPinPos}
			isSelected={selection?.includes(net.id)}
			theme={theme}
			annotations={annotations}
		/>
	));
}

function SchematicPartsLayer({ parts, selection, wire, symbolCache, theme }) {
	return (parts ?? [])
		.filter(isSchematicPart)
		.map((part) => (
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
	const snapped = snapToGrid(cursorWorld);
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

function SchematicSvgScene({ s, problems, theme, highlightNet }) {
	return (
		<g transform={`translate(${s.vp.pan.x},${s.vp.pan.y}) scale(${s.vp.zoom})`}>
			<SchematicGrid zoom={s.vp.zoom} theme={theme} />
			<SchematicNetsLayer
				nets={s.doc.ir?.nets}
				allPinPos={s.allPinPos}
				selection={s.doc.selection}
				theme={theme}
				annotations={s.doc.ir?.annotations}
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
			<SchAnnotationLayer
				annotations={s.doc.ir?.annotations}
				selection={s.doc.selection}
				dragPos={s.wire.dragPos}
				theme={theme}
			/>
			<SchematicGhostLayer s={s} theme={theme} />
			<SchematicJunctionsLayer doc={s.doc} theme={theme} />
			<SchematicProblemsOverlay parts={s.doc.ir?.parts} problems={problems} />
		</g>
	);
}

function AnnotationTextModal({ textModal, onOk, onCancel }) {
	const [value, setValue] = useState("");
	const [activeModal, setActiveModal] = useState(null);

	if (textModal && textModal !== activeModal) {
		setValue(textModal.text ?? "");
		setActiveModal(textModal);
	}

	const handleOk = () => {
		const trimmed = value.trim();
		if (trimmed) onOk(trimmed);
	};

	const kind = textModal?.kind;
	const isEdit = Boolean(textModal?.id);
	const baseTitle = kind ? (MODAL_TITLES[kind] ?? "Annotation") : "";
	const title = isEdit ? baseTitle.replace(/^Place /, "Edit ") : baseTitle;

	return (
		<Modal
			open={Boolean(textModal?.id)}
			title={title}
			okText="OK"
			onOk={handleOk}
			onCancel={onCancel}
			destroyOnClose
		>
			<Input
				autoFocus
				placeholder="Enter text..."
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onPressEnter={handleOk}
			/>
		</Modal>
	);
}

function handleTextModalOk(text, ctx) {
	if (ctx.modalData?.id && text) {
		ctx.dispatchCmd({
			type: "batch",
			commands: [
				{ type: "deleteAnnotation", id: ctx.modalData.id },
				{
					type: "addAnnotation",
					annotation: { ...ctx.modalData, text },
				},
			],
		});
	}
	ctx.setTextModal(null);
	focusCanvas(ctx.containerRef);
}

function handleTextModalCancel(ctx) {
	ctx.setTextModal(null);
	focusCanvas(ctx.containerRef);
}

const EDITABLE_TEXT_KINDS = new Set([
	"label",
	"globalLabel",
	"hierLabel",
	"text",
]);

function handleCanvasDoubleClick(e, s) {
	if (s.wire.wireMode && s.wire.wireStart) {
		s.wire.setWireStart(null);
		return;
	}
	if (!s.svgRef.current) return;
	const worldPt = clientToWorld(e.clientX, e.clientY, s.svgRef.current, s.vp);
	const hitId = hitTestAnnotation(
		s.doc.ir?.annotations,
		worldPt,
		wireHitTolerance(s.vp.zoom),
	);
	if (!hitId) return;
	const ann = s.doc.ir?.annotations?.find((a) => a.id === hitId);
	if (ann && EDITABLE_TEXT_KINDS.has(ann.kind)) {
		s.annotationSession.setTextModal(ann);
	}
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
	const containerRef = useRef(null);
	const s = useSchematicCanvasState({
		editor,
		onChange,
		fetchSymbol,
		containerRef,
	});
	const { view, setView, getBounds } = s;
	useCanvasNav(containerRef, { view, setView, getBounds });
	useCursorReport(onCursorMove, s.ptr.cursorWorld, s.vp.zoom);
	useCanvasAutoFocus(containerRef, "schematic");
	const bg = getSchematicColor(theme, "background");
	const textModalCtx = useMemo(
		() => ({
			modalData: s.annotationSession.textModal,
			dispatchCmd: s.keyCtx.dispatchCmd,
			setTextModal: s.annotationSession.setTextModal,
			containerRef,
		}),
		[
			s.annotationSession.textModal,
			s.keyCtx.dispatchCmd,
			s.annotationSession.setTextModal,
		],
	);
	return (
		// biome-ignore lint/a11y/useSemanticElements: canvas container provides schematic interaction area
		<div
			ref={containerRef}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: schematic editor canvas requires focus for keyboard shortcuts
			tabIndex={0}
			role="region"
			aria-label="Schematic editor"
			style={{ ...CANVAS_CONTAINER_STYLE, background: bg }}
			onKeyDown={(e) => handleCanvasKeyDown(e, s.setIsSpaceDown, s.keyCtx)}
			onKeyUp={(e) => handleCanvasKeyUp(e, s.setIsSpaceDown)}
			onDoubleClick={(e) => handleCanvasDoubleClick(e, s)}
			onPointerDown={s.ptr.onPointerDown}
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
					highlightNet={s.highlightNet}
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
			<AnnotationTextModal
				textModal={s.annotationSession.textModal}
				onOk={(text) => handleTextModalOk(text, textModalCtx)}
				onCancel={() => handleTextModalCancel(textModalCtx)}
			/>
		</div>
	);
}
