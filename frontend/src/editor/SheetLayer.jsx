import { useState } from "react";
import { getSchematicColor } from "./theme.js";
import { snapPoint, worldToScreen } from "./viewport.js";

const SCH_GRID = 1.27;

function snapToGrid(pt) {
	return snapPoint(pt, SCH_GRID);
}

export const HIER_TYPE_COLORS = Object.freeze({
	input: "#008484",
	output: "#840000",
	bidirectional: "#725600",
	tri_state: "#840084",
	passive: "#009600",
});

export function rectFromPoints(p1, p2, minSize = 10) {
	const x1 = p1?.x ?? 0;
	const y1 = p1?.y ?? 0;
	const x2 = p2?.x ?? x1;
	const y2 = p2?.y ?? y1;
	const x = Math.min(x1, x2);
	const y = Math.min(y1, y2);
	const w = Math.max(minSize, Math.abs(x2 - x1));
	const h = Math.max(minSize, Math.abs(y2 - y1));
	return { x, y, w, h };
}

export function pinPosition(sheet, pinOrSide, maybeOffset) {
	if (!sheet) return { x: 0, y: 0 };
	const isObj = typeof pinOrSide === "object";
	const side = isObj ? pinOrSide?.side : pinOrSide;
	const offset = isObj ? (pinOrSide?.offset ?? 0) : (maybeOffset ?? 0);
	const { x = 0, y = 0, w = 10, h = 10 } = sheet;
	if (side === "right") return { x: x + w, y: y + offset };
	if (side === "top") return { x: x + offset, y };
	if (side === "bottom") return { x: x + offset, y: y + h };
	return { x, y: y + offset };
}

export function sheetPinPosition(sheet, pinOrSide, maybeOffset) {
	return pinPosition(sheet, pinOrSide, maybeOffset);
}

export function getSheetHandles(sheet) {
	if (!sheet) return [];
	const { x = 0, y = 0, w = 10, h = 10 } = sheet;
	const mx = x + w / 2;
	const my = y + h / 2;
	return [
		{ id: "nw", x, y, cursor: "nwse-resize" },
		{ id: "n", x: mx, y, cursor: "ns-resize" },
		{ id: "ne", x: x + w, y, cursor: "nesw-resize" },
		{ id: "e", x: x + w, y: my, cursor: "ew-resize" },
		{ id: "se", x: x + w, y: y + h, cursor: "nwse-resize" },
		{ id: "s", x: mx, y: y + h, cursor: "ns-resize" },
		{ id: "sw", x, y: y + h, cursor: "nesw-resize" },
		{ id: "w", x, y: my, cursor: "ew-resize" },
	];
}

export function handleAtPoint(sheet, pt, tol = 1.5) {
	if (!sheet || !pt) return null;
	const handles = getSheetHandles(sheet);
	const hit = handles.find((h) => Math.hypot(pt.x - h.x, pt.y - h.y) <= tol);
	return hit?.id ?? null;
}

export function sheetHandleAt(sheet, pt, tol = 1.5) {
	return handleAtPoint(sheet, pt, tol);
}

function getEdgeDistances(sheet, pt) {
	const { x, y, w, h } = sheet;
	return [
		{ side: "left", d: Math.abs(pt.x - x), horiz: false },
		{ side: "right", d: Math.abs(pt.x - (x + w)), horiz: false },
		{ side: "top", d: Math.abs(pt.y - y), horiz: true },
		{ side: "bottom", d: Math.abs(pt.y - (y + h)), horiz: true },
	];
}

function edgeOffset(edge, pt, sheet) {
	const { x, y, w, h } = sheet;
	if (edge.horiz) {
		return Math.max(0, Math.min(w, pt.x - x));
	}
	return Math.max(0, Math.min(h, pt.y - y));
}

function isWithinEdgeSpan(edge, pt, sheet, tol) {
	const { x, y, w, h } = sheet;
	const [val, min, max] = edge.horiz ? [pt.x, x, x + w] : [pt.y, y, y + h];
	return val >= min - tol && val <= max + tol;
}

export function sheetBorderSideAndOffset(sheet, pt, tol = 2.54) {
	if (!sheet || !pt) return null;
	const edges = getEdgeDistances(sheet, pt);
	edges.sort((a, b) => a.d - b.d);
	const closest = edges[0];
	if (closest.d > tol) return null;
	if (!isWithinEdgeSpan(closest, pt, sheet, tol)) return null;
	return { side: closest.side, offset: edgeOffset(closest, pt, sheet) };
}

export function isPointInSheet(sheet, pt) {
	if (!sheet || !pt) return false;
	const inX = pt.x >= sheet.x && pt.x <= sheet.x + sheet.w;
	const inY = pt.y >= sheet.y && pt.y <= sheet.y + sheet.h;
	return inX && inY;
}

export function isPointInSheetName(sheet, pt) {
	if (!sheet || !pt) return false;
	const len = sheet.name?.length ?? 6;
	const inX = pt.x >= sheet.x - 1 && pt.x <= sheet.x + len * 1.5;
	const inY = pt.y >= sheet.y - 3.5 && pt.y <= sheet.y;
	return inX && inY;
}

function extractHierPinNumbers(items, prop, re, used) {
	for (const it of items) {
		const val = it?.[prop];
		if (typeof val === "string") {
			const m = re.exec(val);
			if (m) used.add(Number.parseInt(m[1], 10));
		}
	}
}

export function nextSheetPinName(sheet, annotations = [], nets = []) {
	const used = new Set();
	const re = /^H(\d+)$/;
	if (sheet?.pins) extractHierPinNumbers(sheet.pins, "name", re, used);
	if (annotations) extractHierPinNumbers(annotations, "text", re, used);
	if (nets) extractHierPinNumbers(nets, "name", re, used);
	let num = 1;
	while (used.has(num)) num++;
	return `H${num}`;
}

export function nextFreeSheetPinName(sheet, annotations = [], nets = []) {
	return nextSheetPinName(sheet, annotations, nets);
}

const PIN_ARROW_LEN = 1.5;
const PIN_ARROW_HW = 0.6;

function getHorizArrowPoints(pos, isRight, isInput) {
	const L = PIN_ARROW_LEN;
	const hw = PIN_ARROW_HW;
	if (isInput) {
		const tipX = pos.x + (isRight ? -L : L);
		return `${pos.x},${pos.y - hw} ${tipX},${pos.y} ${pos.x},${pos.y + hw}`;
	}
	const baseX = pos.x + (isRight ? -L : L);
	return `${pos.x},${pos.y} ${baseX},${pos.y - hw} ${baseX},${pos.y + hw}`;
}

function getVertArrowPoints(pos, isBottom, isInput) {
	const L = PIN_ARROW_LEN;
	const hw = PIN_ARROW_HW;
	if (isInput) {
		const tipY = pos.y + (isBottom ? -L : L);
		return `${pos.x - hw},${pos.y} ${pos.x},${tipY} ${pos.x + hw},${pos.y}`;
	}
	const baseY = pos.y + (isBottom ? -L : L);
	return `${pos.x},${pos.y} ${pos.x - hw},${baseY} ${pos.x + hw},${baseY}`;
}

export function sheetPinArrowPoints(sheet, pin) {
	const pos = pinPosition(sheet, pin);
	const side = pin?.side || "left";
	const isInput = (pin?.type || "input") !== "output";
	if (side === "top" || side === "bottom") {
		return getVertArrowPoints(pos, side === "bottom", isInput);
	}
	return getHorizArrowPoints(pos, side === "right", isInput);
}

function sheetPinTextProps(_sheet, pin, pos) {
	const side = pin?.side || "left";
	const d = 2.0;
	if (side === "right") return { x: pos.x - d, y: pos.y, textAnchor: "end" };
	if (side === "top") return { x: pos.x, y: pos.y + d, textAnchor: "middle" };
	if (side === "bottom") {
		return { x: pos.x, y: pos.y - d + 0.5, textAnchor: "middle" };
	}
	return { x: pos.x + d, y: pos.y, textAnchor: "start" };
}

export function testSheetHit(sheets, pt, selectedIds = []) {
	for (const sheet of sheets ?? []) {
		if (selectedIds.includes(sheet.id)) {
			const handle = handleAtPoint(sheet, pt, 2.0);
			if (handle) {
				return { kind: "sheetHandle", id: sheet.id, handle, sheet };
			}
		}
		if (isPointInSheet(sheet, pt)) {
			return { kind: "sheet", id: sheet.id, sheet };
		}
	}
	return null;
}

export function findSheetBorderAtPoint(sheets, pt, selectedIds = []) {
	for (const sheet of sheets ?? []) {
		if (selectedIds.length > 0 && !selectedIds.includes(sheet.id)) continue;
		const border = sheetBorderSideAndOffset(sheet, pt, 2.54);
		if (border) {
			return { sheet, side: border.side, offset: border.offset };
		}
	}
	return null;
}

export function getEffectiveSheetRect(sheet, dragPos) {
	if (!dragPos || dragPos.sheetId !== sheet.id) {
		return { x: sheet.x, y: sheet.y, w: sheet.w, h: sheet.h };
	}
	if (dragPos.w !== undefined && dragPos.h !== undefined) {
		return { x: sheet.x, y: sheet.y, w: dragPos.w, h: dragPos.h };
	}
	const dx = dragPos.dx ?? 0;
	const dy = dragPos.dy ?? 0;
	return { x: sheet.x + dx, y: sheet.y + dy, w: sheet.w, h: sheet.h };
}

export function handleSheetHandleSelect(hit, hitCtx) {
	hitCtx.capturePointer?.();
	hitCtx.setDragState({
		kind: "sheetResize",
		sheetId: hit.id,
		handle: hit.handle,
		startX: hitCtx.worldPt.x,
		startY: hitCtx.worldPt.y,
		origW: hit.sheet.w,
		origH: hit.sheet.h,
		mouseStartX: hitCtx.worldPt.x,
		mouseStartY: hitCtx.worldPt.y,
		moved: false,
	});
}

export function handleSheetSelect(hit, doc, worldPt, hitCtx) {
	hitCtx.capturePointer?.();
	hitCtx.dispatchCmd({ type: "select", ids: [hit.id] });
	const sheet = doc.ir?.sheets?.find((s) => s.id === hit.id);
	hitCtx.setDragState({
		kind: "sheetMove",
		sheetId: hit.id,
		startX: sheet?.x ?? 0,
		startY: sheet?.y ?? 0,
		mouseStartX: worldPt.x,
		mouseStartY: worldPt.y,
		moved: false,
	});
}

export function handleSheetPointerDown(hit, hitCtx) {
	if (hit?.kind === "sheetHandle") {
		handleSheetHandleSelect(hit, hitCtx);
		return true;
	}
	const { doc, worldPt } = hitCtx;
	if (hit?.kind === "sheet") {
		handleSheetSelect(hit, doc, worldPt, hitCtx);
		return true;
	}
	if (hit?.kind === "pin" && doc.ir?.sheets?.some((s) => s.id === hit.id)) {
		const sheet = doc.ir.sheets.find((s) => s.id === hit.id);
		handleSheetSelect({ id: sheet.id, sheet }, doc, worldPt, hitCtx);
		return true;
	}
	return false;
}

export function updateSheetResizeDrag(dragState, worldPt, setDragPos) {
	const dx = worldPt.x - dragState.startX;
	const dy = worldPt.y - dragState.startY;
	if (Math.hypot(dx, dy) > 0.5) dragState.moved = true;
	const snapped = snapToGrid({
		x: dragState.origW + dx,
		y: dragState.origH + dy,
	});
	setDragPos({
		sheetId: dragState.sheetId,
		w: Math.max(10, snapped.x),
		h: Math.max(10, snapped.y),
	});
}

export function commitSheetDrag(dragState, dragPos, dispatchCmd) {
	if (dragState.kind === "sheetResize") {
		const w = dragPos.w ?? dragState.origW;
		const h = dragPos.h ?? dragState.origH;
		dispatchCmd({ type: "resizeSheet", sheetId: dragState.sheetId, w, h });
		return true;
	}
	if (dragState.kind === "sheetMove") {
		const dx = dragPos.x - dragState.startX;
		const dy = dragPos.y - dragState.startY;
		if (dx !== 0 || dy !== 0) {
			dispatchCmd({ type: "moveSheet", sheetId: dragState.sheetId, dx, dy });
		}
		return true;
	}
	return false;
}

export function handleSheetDrawPointerDown(hitCtx, worldPt) {
	const snapped = snapToGrid(worldPt);
	if (!hitCtx.sheetStart) {
		hitCtx.setSheetStart(snapped);
		hitCtx.capturePointer?.();
		return;
	}
	const rect = rectFromPoints(hitCtx.sheetStart, snapped, 10);
	hitCtx.dispatchCmd({
		type: "addSheet",
		sheet: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
	});
	hitCtx.setSheetStart(null);
	hitCtx.setSheetMode(false);
}

export function checkSheetPointerUp(sheetSession, cursorWorld, dispatchCmd) {
	if (!sheetSession?.sheetMode || !sheetSession?.sheetStart || !cursorWorld) {
		return false;
	}
	const end = snapToGrid(cursorWorld);
	const dist = Math.hypot(
		end.x - sheetSession.sheetStart.x,
		end.y - sheetSession.sheetStart.y,
	);
	if (dist > 0.5) {
		const rect = rectFromPoints(sheetSession.sheetStart, end, 10);
		dispatchCmd({
			type: "addSheet",
			sheet: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
		});
		sheetSession.setSheetStart(null);
		sheetSession.setSheetMode(false);
		return true;
	}
	return false;
}

export function handleSheetDoubleClick(worldPt, s) {
	const sheets = s.doc.ir?.sheets ?? [];
	for (let i = sheets.length - 1; i >= 0; i--) {
		const sheet = sheets[i];
		if (isPointInSheetName(sheet, worldPt)) {
			s.sheetSession?.setEditingSheet(sheet);
			return true;
		}
		if (isPointInSheet(sheet, worldPt)) {
			s.onEnterSheet?.(sheet);
			return true;
		}
	}
	return false;
}

export function handleHierLabelSheetPin(hitCtx, snapped) {
	const borderHit = findSheetBorderAtPoint(
		hitCtx.doc?.ir?.sheets,
		snapped,
		hitCtx.doc?.selection,
	);
	if (!borderHit) return false;
	const { sheet, side, offset } = borderHit;
	const name = nextSheetPinName(
		sheet,
		hitCtx.doc?.ir?.annotations,
		hitCtx.doc?.ir?.nets,
	);
	hitCtx.dispatchCmd({
		type: "addSheetPin",
		sheetId: sheet.id,
		pin: { name, side, offset, type: "input" },
	});
	return true;
}

function SchematicSheetPin({ sheet, pin }) {
	const pos = pinPosition(sheet, pin);
	const color = HIER_TYPE_COLORS[pin.type] ?? HIER_TYPE_COLORS.passive;
	const points = sheetPinArrowPoints(sheet, pin);
	const textProps = sheetPinTextProps(sheet, pin, pos);
	return (
		<g key={pin.id || pin.name}>
			<polygon points={points} fill={color} stroke={color} strokeWidth={0.25} />
			<text
				x={textProps.x}
				y={textProps.y + 0.35}
				fill={color}
				fontSize={1.0}
				textAnchor={textProps.textAnchor}
				fontFamily="monospace, sans-serif"
			>
				{pin.name}
			</text>
		</g>
	);
}

function SchematicSheetHandles({ sheet, theme }) {
	const handles = getSheetHandles(sheet);
	const selColor = getSchematicColor(theme, "selection");
	return (
		<g>
			<rect
				x={sheet.x - 0.5}
				y={sheet.y - 0.5}
				width={sheet.w + 1}
				height={sheet.h + 1}
				fill="none"
				stroke={selColor}
				strokeWidth={0.3}
				strokeDasharray="1,1"
				pointerEvents="none"
			/>
			{handles.map((h) => (
				<rect
					key={h.id}
					x={h.x - 0.75}
					y={h.y - 0.75}
					width={1.5}
					height={1.5}
					fill="#ffffff"
					stroke={selColor}
					strokeWidth={0.25}
					pointerEvents="none"
				/>
			))}
		</g>
	);
}

function SchematicSheetItem({ sheet, isSelected, dragPos, theme }) {
	const eff = getEffectiveSheetRect(sheet, dragPos);
	const stroke = getSchematicColor(theme, "sheet") || "#840000";
	const fill = getSchematicColor(theme, "sheetFill") || "#ffffff";
	const nameColor = getSchematicColor(theme, "sheetName") || "#008484";
	const fileColor = getSchematicColor(theme, "sheetFile") || "#725600";
	const fileName = sheet.file || `${sheet.name}.kicad_sch`;
	return (
		<g id={`sheet-${sheet.id}`}>
			<rect
				x={eff.x}
				y={eff.y}
				width={eff.w}
				height={eff.h}
				fill={fill}
				stroke={stroke}
				strokeWidth={0.3}
			>
				<title>Double-click to open sheet</title>
			</rect>
			<text
				x={eff.x}
				y={eff.y - 1}
				fill={nameColor}
				fontSize={1.2}
				fontWeight="bold"
				fontFamily="sans-serif"
			>
				{sheet.name}
			</text>
			<text
				x={eff.x}
				y={eff.y + eff.h + 2.5}
				fill={fileColor}
				fontSize={1.0}
				fontFamily="sans-serif"
			>
				{fileName}
			</text>
			{(sheet.pins ?? []).map((pin) => (
				<SchematicSheetPin key={pin.id || pin.name} sheet={eff} pin={pin} />
			))}
			{isSelected && <SchematicSheetHandles sheet={eff} theme={theme} />}
		</g>
	);
}

export function SchematicSheetPreview({ start, current, theme }) {
	if (!start || !current) return null;
	const rect = rectFromPoints(start, current);
	const stroke = getSchematicColor(theme, "sheet") || "#840000";
	const nameColor = getSchematicColor(theme, "sheetName") || "#008484";
	return (
		<g pointerEvents="none">
			<rect
				x={rect.x}
				y={rect.y}
				width={rect.w}
				height={rect.h}
				fill="none"
				stroke={stroke}
				strokeWidth={0.3}
				strokeDasharray="1.5,1.5"
			/>
			<text
				x={rect.x}
				y={rect.y - 1}
				fill={nameColor}
				fontSize={1.2}
				fontWeight="bold"
				fontFamily="sans-serif"
			>
				Sheet
			</text>
		</g>
	);
}

const SHEET_RENAME_STYLE = {
	position: "absolute",
	zIndex: 100,
	fontSize: "12px",
	padding: "2px 4px",
	border: "1px solid #1890ff",
	borderRadius: 2,
	outline: "none",
};

export function SheetRenameInput({ sheet, vp, dispatchCmd, onClose }) {
	const [val, setVal] = useState(sheet?.name ?? "");
	if (!sheet) return null;
	const scr = worldToScreen({ x: sheet.x, y: sheet.y }, vp);
	const commit = () => {
		const trimmed = val.trim();
		if (trimmed && trimmed !== sheet.name) {
			dispatchCmd({ type: "renameSheet", sheetId: sheet.id, name: trimmed });
		}
		onClose();
	};
	const onKeyDown = (e) => {
		if (e.key === "Enter") commit();
		else if (e.key === "Escape") onClose();
	};
	return (
		<input
			ref={(el) => el?.focus()}
			type="text"
			value={val}
			onChange={(e) => setVal(e.target.value)}
			onKeyDown={onKeyDown}
			onBlur={commit}
			style={{ ...SHEET_RENAME_STYLE, left: scr.x, top: scr.y - 24 }}
		/>
	);
}

export function useSheetSession() {
	const [sheetMode, setSheetMode] = useState(false);
	const [sheetStart, setSheetStart] = useState(null);
	const [editingSheet, setEditingSheet] = useState(null);
	return {
		sheetMode,
		setSheetMode,
		sheetStart,
		setSheetStart,
		editingSheet,
		setEditingSheet,
	};
}

export default function SheetLayer({
	sheets = [],
	selection = [],
	dragPos = null,
	theme,
	previewStart = null,
	previewCurrent = null,
}) {
	const hasSheets = sheets && sheets.length > 0;
	const hasPreview = previewStart && previewCurrent;
	if (!hasSheets && !hasPreview) return null;
	return (
		<g className="schematic-sheets-layer">
			{hasSheets &&
				sheets.map((sheet) => (
					<SchematicSheetItem
						key={sheet.id}
						sheet={sheet}
						isSelected={selection?.includes(sheet.id)}
						dragPos={dragPos}
						theme={theme}
					/>
				))}
			{hasPreview && (
				<SchematicSheetPreview
					start={previewStart}
					current={previewCurrent}
					theme={theme}
				/>
			)}
		</g>
	);
}

export { SheetLayer };
