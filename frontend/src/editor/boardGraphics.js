import { distPointToSegment } from "./footprintRender.js";

const DEFAULT_WIDTH = 0.15;
const EDGE_CUTS_WIDTH = 0.1;

const GRAPHIC_PROPS = [
	"kind",
	"layer",
	"x",
	"y",
	"x2",
	"y2",
	"xm",
	"ym",
	"text",
	"width",
];

function nextGraphicId(graphics) {
	let max = 0;
	for (const g of graphics) {
		const match = /^gfx-(\d+)$/.exec(g.id);
		if (match) {
			const num = Number.parseInt(match[1], 10);
			if (num > max) max = num;
		}
	}
	return `gfx-${max + 1}`;
}

function resolveWidth(graphic) {
	if (typeof graphic.width === "number") return graphic.width;
	return graphic.layer === "Edge.Cuts" ? EDGE_CUTS_WIDTH : DEFAULT_WIDTH;
}

export function addGraphic(board, graphic) {
	const existing = Array.isArray(board?.graphics) ? board.graphics : [];
	const id = graphic.id || nextGraphicId(existing);
	const width = resolveWidth(graphic);
	const nextGraphic = { ...graphic, id, width };
	return {
		...(board ?? {}),
		graphics: [...existing, nextGraphic],
	};
}

export function deleteGraphic(board, id) {
	const existing = Array.isArray(board?.graphics) ? board.graphics : [];
	return {
		...(board ?? {}),
		graphics: existing.filter((g) => g.id !== id),
	};
}

function moveGraphicItem(g, dx, dy) {
	const next = { ...g, x: g.x + dx, y: g.y + dy };
	if (typeof g.x2 === "number") next.x2 = g.x2 + dx;
	if (typeof g.y2 === "number") next.y2 = g.y2 + dy;
	if (typeof g.xm === "number") next.xm = g.xm + dx;
	if (typeof g.ym === "number") next.ym = g.ym + dy;
	return next;
}

export function moveGraphic(board, id, dx, dy) {
	const existing = Array.isArray(board?.graphics) ? board.graphics : [];
	return {
		...(board ?? {}),
		graphics: existing.map((g) =>
			g.id === id ? moveGraphicItem(g, dx, dy) : g,
		),
	};
}

function isGraphicChanged(a, b) {
	return GRAPHIC_PROPS.some((prop) => a[prop] !== b[prop]);
}

function matchGraphic(g, list, map) {
	return (
		map.get(g.id) ?? list.find((item) => item.uuid && item.uuid === g.uuid)
	);
}

function collectDeletions(before, after, afterMap) {
	const ops = [];
	for (const b of before) {
		if (!matchGraphic(b, after, afterMap) && b.uuid) {
			ops.push({ op: "deleteGraphic", uuid: b.uuid });
		}
	}
	return ops;
}

function collectAdditions(after, before, beforeMap) {
	const ops = [];
	for (const a of after) {
		const b = matchGraphic(a, before, beforeMap);
		if (!b) {
			ops.push({ op: "addGraphic", graphic: a });
		} else if (isGraphicChanged(b, a)) {
			if (b.uuid) ops.push({ op: "deleteGraphic", uuid: b.uuid });
			ops.push({ op: "addGraphic", graphic: a });
		}
	}
	return ops;
}

export function graphicsEdits(beforeBoard, afterBoard) {
	const before = Array.isArray(beforeBoard?.graphics)
		? beforeBoard.graphics
		: [];
	const after = Array.isArray(afterBoard?.graphics) ? afterBoard.graphics : [];
	const beforeMap = new Map(before.map((g) => [g.id, g]));
	const afterMap = new Map(after.map((g) => [g.id, g]));
	return [
		...collectDeletions(before, after, afterMap),
		...collectAdditions(after, before, beforeMap),
	];
}

function hitTestLine(g, px, py, tol) {
	const s = [g.x, g.y];
	const e = [g.x2 ?? g.x, g.y2 ?? g.y];
	return distPointToSegment(px, py, s, e) <= tol;
}

function hitTestRect(g, px, py, tol) {
	const x1 = g.x;
	const y1 = g.y;
	const x2 = g.x2 ?? g.x;
	const y2 = g.y2 ?? g.y;
	const edges = [
		[
			[x1, y1],
			[x2, y1],
		],
		[
			[x2, y1],
			[x2, y2],
		],
		[
			[x2, y2],
			[x1, y2],
		],
		[
			[x1, y2],
			[x1, y1],
		],
	];
	return edges.some(([s, e]) => distPointToSegment(px, py, s, e) <= tol);
}

function hitTestCircle(g, px, py, tol) {
	const hasRadiusPoint = g.x2 !== undefined && g.y2 !== undefined;
	const radius = hasRadiusPoint
		? Math.hypot(g.x2 - g.x, g.y2 - g.y)
		: (g.radius ?? 0);
	const dist = Math.hypot(px - g.x, py - g.y);
	return Math.abs(dist - radius) <= tol;
}

function hitTestArc(g, px, py, tol) {
	const s = [g.x, g.y];
	const e = [g.x2 ?? g.x, g.y2 ?? g.y];
	if (g.xm !== undefined && g.ym !== undefined) {
		const m = [g.xm, g.ym];
		return (
			distPointToSegment(px, py, s, m) <= tol ||
			distPointToSegment(px, py, m, e) <= tol
		);
	}
	return distPointToSegment(px, py, s, e) <= tol;
}

function hitTestAnchor(g, px, py, tol) {
	return Math.abs(px - g.x) <= tol && Math.abs(py - g.y) <= tol;
}

const HIT_TESTERS = {
	line: hitTestLine,
	rect: hitTestRect,
	circle: hitTestCircle,
	arc: hitTestArc,
	text: hitTestAnchor,
	dimension: hitTestAnchor,
};

export function hitTestGraphic(graphics, pt, tol) {
	if (!Array.isArray(graphics) || !pt) return null;
	const t = tol ?? 0.5;
	const [px, py] = Array.isArray(pt) ? pt : [pt.x ?? 0, pt.y ?? 0];
	for (const g of graphics) {
		const tester = HIT_TESTERS[g.kind];
		if (tester?.(g, px, py, t)) {
			return g.id;
		}
	}
	return null;
}
