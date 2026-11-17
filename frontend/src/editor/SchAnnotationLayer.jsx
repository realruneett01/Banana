import { distPointToSegment } from "./footprintRender.js";
import { getSchematicColor } from "./theme.js";

function isLineHit(ann, px, py, tol) {
	const p1 = [ann.x, ann.y];
	const p2 = [ann.x2 ?? ann.x, ann.y2 ?? ann.y];
	return distPointToSegment(px, py, p1, p2) <= tol;
}

function isPointHit(ann, px, py, tol) {
	return Math.hypot(px - ann.x, py - ann.y) <= tol;
}

function isTextHit(ann, px, py, tol) {
	if (isPointHit(ann, px, py, tol)) return true;
	const rad = (-(ann.rot ?? 0) * Math.PI) / 180;
	const dx = px - ann.x;
	const dy = py - ann.y;
	const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
	const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
	const w = Math.max(2, (ann.text?.length ?? 1) * 0.8 + 1);
	const inX = lx >= -tol && lx <= w + tol;
	const inY = Math.abs(ly) <= 1.2 + tol;
	return inX && inY;
}

function isAnnotationHit(ann, px, py, tol) {
	if (ann.kind === "line" || ann.kind === "bus") {
		return isLineHit(ann, px, py, tol);
	}
	if (ann.kind === "junction" || ann.kind === "noConnect") {
		return isPointHit(ann, px, py, tol);
	}
	return isTextHit(ann, px, py, tol);
}

export function hitTestAnnotation(annotations, worldPt, tol = 1.27) {
	if (!Array.isArray(annotations) || !worldPt) return null;
	const px = worldPt.x ?? worldPt[0] ?? 0;
	const py = worldPt.y ?? worldPt[1] ?? 0;
	for (let i = annotations.length - 1; i >= 0; i--) {
		const ann = annotations[i];
		if (isAnnotationHit(ann, px, py, tol)) return ann.id;
	}
	return null;
}

function renderSharedText(ann, color, outlinePoints) {
	const rot = ann.rot ? `rotate(${ann.rot} ${ann.x} ${ann.y})` : undefined;
	const textVal = ann.text ?? "";
	return (
		<g key={ann.id} transform={rot} className="schematic-annotation">
			{outlinePoints && (
				<polygon
					points={outlinePoints}
					fill="none"
					stroke={color}
					strokeWidth={0.25}
				/>
			)}
			<text
				x={outlinePoints ? ann.x + 1.1 : ann.x}
				y={ann.y + 0.45}
				fill={color}
				fontSize={1.27}
				fontFamily="monospace, sans-serif"
			>
				{textVal}
			</text>
		</g>
	);
}

const LABEL_DEFS = {
	label: { key: "label", tip: 0 },
	globalLabel: { key: "globalLabel", tip: 0.8 },
	hierLabel: { key: "hierLabel", tip: 1 },
	text: { key: "label", tip: null },
};

function formatLabelPolygon(ann, tip) {
	const w = Math.max(2, (ann.text?.length ?? 1) * 0.8 + 0.8);
	const { x, y } = ann;
	const tipPoint = tip ? ` ${x + 0.8 + w + tip},${y}` : "";
	return `${x},${y} ${x + 0.8},${y - 0.9} ${x + 0.8 + w},${y - 0.9}${tipPoint} ${x + 0.8 + w},${y + 0.9} ${x + 0.8},${y + 0.9}`;
}

function renderTextAnnotation(ann, isSelected, theme, { key, tip }) {
	const color = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, key);
	const outline = tip !== null ? formatLabelPolygon(ann, tip) : null;
	return renderSharedText(ann, color, outline);
}

function renderNoConnectAnnotation(ann, isSelected, theme) {
	const color = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "noConnect");
	const d = 0.635;
	return (
		<g key={ann.id} className="schematic-annotation">
			<line
				x1={ann.x - d}
				y1={ann.y - d}
				x2={ann.x + d}
				y2={ann.y + d}
				stroke={color}
				strokeWidth={0.35}
			/>
			<line
				x1={ann.x - d}
				y1={ann.y + d}
				x2={ann.x + d}
				y2={ann.y - d}
				stroke={color}
				strokeWidth={0.35}
			/>
		</g>
	);
}

function renderJunctionAnnotation(ann, isSelected, theme) {
	const color = isSelected
		? getSchematicColor(theme, "selection")
		: getSchematicColor(theme, "junction");
	return (
		<circle
			key={ann.id}
			cx={ann.x}
			cy={ann.y}
			r={0.55}
			fill={color}
			className="schematic-annotation"
		/>
	);
}

function renderStrokeAnnotation(ann, color, width, dash) {
	return (
		<line
			key={ann.id}
			x1={ann.x}
			y1={ann.y}
			x2={ann.x2 ?? ann.x}
			y2={ann.y2 ?? ann.y}
			stroke={color}
			strokeWidth={width}
			strokeDasharray={dash}
			className="schematic-annotation"
		/>
	);
}

function renderLineAnnotation(ann, isSelected) {
	const color = isSelected ? "#ff9900" : "#4a5568";
	return renderStrokeAnnotation(ann, color, 0.254, "1.27,1.27");
}

function renderBusAnnotation(ann, isSelected, theme) {
	const busColor = getSchematicColor(theme, "bus") || "#000084";
	const color = isSelected ? getSchematicColor(theme, "selection") : busColor;
	return renderStrokeAnnotation(ann, color, 0.8);
}

const RENDER_BY_KIND = {
	label: (ann, sel, th) => renderTextAnnotation(ann, sel, th, LABEL_DEFS.label),
	globalLabel: (ann, sel, th) =>
		renderTextAnnotation(ann, sel, th, LABEL_DEFS.globalLabel),
	hierLabel: (ann, sel, th) =>
		renderTextAnnotation(ann, sel, th, LABEL_DEFS.hierLabel),
	text: (ann, sel, th) => renderTextAnnotation(ann, sel, th, LABEL_DEFS.text),
	noConnect: renderNoConnectAnnotation,
	junction: renderJunctionAnnotation,
	line: renderLineAnnotation,
	bus: renderBusAnnotation,
};

function applyDragOffset(ann, dragPos) {
	if (!dragPos || dragPos.annId !== ann.id) return ann;
	const dx = dragPos.dx ?? 0;
	const dy = dragPos.dy ?? 0;
	return {
		...ann,
		x: ann.x + dx,
		y: ann.y + dy,
		x2: ann.x2 !== undefined ? ann.x2 + dx : undefined,
		y2: ann.y2 !== undefined ? ann.y2 + dy : undefined,
	};
}

export default function SchAnnotationLayer({
	doc,
	annotations,
	selection,
	dragPos,
	theme,
}) {
	const items = annotations ?? doc?.ir?.annotations;
	if (!Array.isArray(items) || items.length === 0) return null;
	const sel = new Set(selection ?? doc?.selection ?? []);
	return (
		<g className="schematic-annotations-layer">
			{items.map((ann) => {
				const activeAnn = applyDragOffset(ann, dragPos);
				const renderFn = RENDER_BY_KIND[activeAnn.kind];
				return renderFn
					? renderFn(activeAnn, sel.has(activeAnn.id), theme)
					: null;
			})}
		</g>
	);
}

export { SchAnnotationLayer };
