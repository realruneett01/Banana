import { arcToSvgPath, calcArcCenter } from "./footprintRender.js";
import { getLayerColor, PCB_THEME } from "./theme.js";

const HIGHLIGHT_COLOR = "#fadb14";
const DEFAULT_WIDTH = 0.15;
const EDGE_CUTS_WIDTH = 0.1;

function resolveWidth(g) {
	if (typeof g.width === "number") return g.width;
	return g.layer === "Edge.Cuts" ? EDGE_CUTS_WIDTH : DEFAULT_WIDTH;
}

function renderLine(g, color, width) {
	return (
		<line
			key={g.id}
			x1={g.x}
			y1={g.y}
			x2={g.x2 ?? g.x}
			y2={g.y2 ?? g.y}
			stroke={color}
			strokeWidth={width}
			strokeLinecap="round"
		/>
	);
}

function renderRect(g, color, width) {
	const x = Math.min(g.x, g.x2 ?? g.x);
	const y = Math.min(g.y, g.y2 ?? g.y);
	const w = Math.abs((g.x2 ?? g.x) - g.x);
	const h = Math.abs((g.y2 ?? g.y) - g.y);
	return (
		<rect
			key={g.id}
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

function renderCircle(g, color, width) {
	const r =
		g.x2 !== undefined && g.y2 !== undefined
			? Math.hypot(g.x2 - g.x, g.y2 - g.y)
			: (g.radius ?? 0);
	return (
		<circle
			key={g.id}
			cx={g.x}
			cy={g.y}
			r={r}
			fill="none"
			stroke={color}
			strokeWidth={width}
		/>
	);
}

function renderArc(g, color, width) {
	const p1 = [g.x, g.y];
	const p2 = [g.x2 ?? g.x, g.y2 ?? g.y];
	const pm = [
		g.xm ?? (g.x + (g.x2 ?? g.x)) / 2,
		g.ym ?? (g.y + (g.y2 ?? g.y)) / 2,
	];
	const { center, radius } = calcArcCenter(p1, pm, p2);
	const d = arcToSvgPath({ start: p1, mid: pm, end: p2, center, radius });
	return (
		<path
			key={g.id}
			d={d}
			fill="none"
			stroke={color}
			strokeWidth={width}
			strokeLinecap="round"
		/>
	);
}

function renderText(g, color) {
	return (
		<text
			key={g.id}
			x={g.x}
			y={g.y}
			fill={color}
			fontSize={1}
			fontWeight={600}
			textAnchor="start"
			dominantBaseline="auto"
		>
			{g.text ?? ""}
		</text>
	);
}

function dimensionGeometry(g) {
	const x2 = g.x2 ?? g.x;
	const y2 = g.y2 ?? g.y;
	const dx = x2 - g.x;
	const dy = y2 - g.y;
	const len = Math.hypot(dx, dy);
	const nx = len > 0 ? -dy / len : 0;
	const ny = len > 0 ? dx / len : 1;
	return { x2, y2, len, nx, ny };
}

function renderDimension(g, color, width) {
	const { x2, y2, len, nx, ny } = dimensionGeometry(g);
	const tick = 1;
	const tx = (g.x + x2) / 2 + nx * 0.8;
	const ty = (g.y + y2) / 2 + ny * 0.8;
	return (
		<g key={g.id} className="pcb-graphic-dimension">
			<line
				x1={g.x}
				y1={g.y}
				x2={x2}
				y2={y2}
				stroke={color}
				strokeWidth={width}
			/>
			<line
				x1={g.x - nx * tick}
				y1={g.y - ny * tick}
				x2={g.x + nx * tick}
				y2={g.y + ny * tick}
				stroke={color}
				strokeWidth={width}
			/>
			<line
				x1={x2 - nx * tick}
				y1={y2 - ny * tick}
				x2={x2 + nx * tick}
				y2={y2 + ny * tick}
				stroke={color}
				strokeWidth={width}
			/>
			<text
				x={tx}
				y={ty}
				fill={color}
				fontSize={0.8}
				textAnchor="middle"
				dominantBaseline="middle"
			>
				{`${len.toFixed(2)} mm`}
			</text>
		</g>
	);
}

const KIND_RENDERERS = {
	line: renderLine,
	rect: renderRect,
	circle: renderCircle,
	arc: renderArc,
	text: (g, color) => renderText(g, color),
	dimension: renderDimension,
};

function renderGraphicItem(g, selectedId) {
	const renderer = KIND_RENDERERS[g.kind];
	if (!renderer) return null;
	const isSelected = g.id === selectedId;
	const color = isSelected
		? HIGHLIGHT_COLOR
		: getLayerColor(PCB_THEME, g.layer);
	const width = resolveWidth(g);
	return renderer(g, color, width);
}

export function BoardGraphicsLayer({ graphics, layer, selectedId }) {
	if (!Array.isArray(graphics) || graphics.length === 0) return null;
	const items = layer ? graphics.filter((g) => g.layer === layer) : graphics;
	if (items.length === 0) return null;
	const cls = layer ? `pcb-graphics-${layer}` : "pcb-graphics";
	return (
		<g className={cls}>{items.map((g) => renderGraphicItem(g, selectedId))}</g>
	);
}

export default BoardGraphicsLayer;
