export function rectOutline(x, y, w, h) {
	return [
		{ type: "line", start: { x, y }, end: { x: x + w, y } },
		{ type: "line", start: { x: x + w, y }, end: { x: x + w, y: y + h } },
		{ type: "line", start: { x: x + w, y: y + h }, end: { x, y: y + h } },
		{ type: "line", start: { x, y: y + h }, end: { x, y } },
	];
}

export function roundedRectOutline(x, y, w, h, r) {
	const cr = Math.min(r, Math.min(w, h) / 2);
	if (cr <= 0) return rectOutline(x, y, w, h);
	const k = cr * Math.SQRT1_2;
	const [x0, x1, x2, x3] = [x, x + cr, x + w - cr, x + w];
	const [y0, y1, y2, y3] = [y, y + cr, y + h - cr, y + h];
	return [
		{ type: "line", start: { x: x1, y: y0 }, end: { x: x2, y: y0 } },
		{
			type: "arc",
			start: { x: x2, y: y0 },
			mid: { x: x2 + k, y: y1 - k },
			end: { x: x3, y: y1 },
		},
		{ type: "line", start: { x: x3, y: y1 }, end: { x: x3, y: y2 } },
		{
			type: "arc",
			start: { x: x3, y: y2 },
			mid: { x: x2 + k, y: y2 + k },
			end: { x: x2, y: y3 },
		},
		{ type: "line", start: { x: x2, y: y3 }, end: { x: x1, y: y3 } },
		{
			type: "arc",
			start: { x: x1, y: y3 },
			mid: { x: x1 - k, y: y2 + k },
			end: { x: x0, y: y2 },
		},
		{ type: "line", start: { x: x0, y: y2 }, end: { x: x0, y: y1 } },
		{
			type: "arc",
			start: { x: x0, y: y1 },
			mid: { x: x1 - k, y: y1 - k },
			end: { x: x1, y: y0 },
		},
	];
}

export function arcCenter(start, mid, end) {
	if (!start || !mid || !end) return null;
	const d =
		2 *
		(start.x * (mid.y - end.y) +
			mid.x * (end.y - start.y) +
			end.x * (start.y - mid.y));
	if (Math.abs(d) < 1e-10) return null;
	const aSq = start.x * start.x + start.y * start.y;
	const bSq = mid.x * mid.x + mid.y * mid.y;
	const cSq = end.x * end.x + end.y * end.y;
	const x =
		(aSq * (mid.y - end.y) +
			bSq * (end.y - start.y) +
			cSq * (start.y - mid.y)) /
		d;
	const y =
		(aSq * (end.x - mid.x) +
			bSq * (start.x - end.x) +
			cSq * (mid.x - start.x)) /
		d;
	return { x, y };
}

function normAngle(a) {
	const twoPi = 2 * Math.PI;
	let res = a % twoPi;
	if (res < 0) res += twoPi;
	return res;
}

function flattenArc(arc, segmentsPerArc) {
	const c = arcCenter(arc.start, arc.mid, arc.end);
	if (!c) return [arc.start, arc.end];
	const r = Math.hypot(arc.start.x - c.x, arc.start.y - c.y);
	const a1 = Math.atan2(arc.start.y - c.y, arc.start.x - c.x);
	const am = Math.atan2(arc.mid.y - c.y, arc.mid.x - c.x);
	const a2 = Math.atan2(arc.end.y - c.y, arc.end.x - c.x);
	const dm = normAngle(am - a1);
	const d2 = normAngle(a2 - a1);
	const sweep = dm < d2 ? d2 : -(2 * Math.PI - d2);
	const pts = [arc.start];
	for (let i = 1; i < segmentsPerArc; i++) {
		const ang = a1 + (i / segmentsPerArc) * sweep;
		pts.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
	}
	pts.push(arc.end);
	return pts;
}

function flattenCircle(shape, segmentsPerArc) {
	const { center, end } = shape;
	const r = Math.hypot(end.x - center.x, end.y - center.y);
	const a0 = Math.atan2(end.y - center.y, end.x - center.x);
	const twoPi = 2 * Math.PI;
	const pts = [];
	for (let i = 0; i < segmentsPerArc; i++) {
		const ang = a0 + (i / segmentsPerArc) * twoPi;
		pts.push({
			x: center.x + r * Math.cos(ang),
			y: center.y + r * Math.sin(ang),
		});
	}
	pts.push({ x: end.x, y: end.y });
	return pts;
}

function flattenRect(shape) {
	const { start, end } = shape;
	return [
		{ x: start.x, y: start.y },
		{ x: end.x, y: start.y },
		{ x: end.x, y: end.y },
		{ x: start.x, y: end.y },
		{ x: start.x, y: start.y },
	];
}

export function flattenShape(shape, segmentsPerArc = 16) {
	if (!shape) return [];
	if (shape.type === "rect") return flattenRect(shape);
	if (shape.type === "circle") return flattenCircle(shape, segmentsPerArc);
	if (shape.type === "arc") return flattenArc(shape, segmentsPerArc);
	if (shape.type === "line") return [shape.start, shape.end];
	return [];
}

function reverseShape(shape) {
	if (shape.type === "line") {
		return { type: "line", start: shape.end, end: shape.start };
	}
	if (shape.type === "arc") {
		return {
			type: "arc",
			start: shape.end,
			mid: shape.mid,
			end: shape.start,
		};
	}
	return shape;
}

function ptDist(p1, p2) {
	return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function findNextShape(curr, shapes, used, tolerance) {
	for (let i = 0; i < shapes.length; i++) {
		if (used.has(i)) continue;
		const s = shapes[i];
		if (ptDist(s.start, curr) <= tolerance) {
			return { index: i, shape: s, nextPt: s.end };
		}
		if (ptDist(s.end, curr) <= tolerance) {
			return { index: i, shape: reverseShape(s), nextPt: s.start };
		}
	}
	return null;
}

function chainShapes(shapes, tolerance) {
	const ordered = [shapes[0]];
	const used = new Set([0]);
	let curr = shapes[0].end;
	while (used.size < shapes.length) {
		const match = findNextShape(curr, shapes, used, tolerance);
		if (!match) return null;
		used.add(match.index);
		ordered.push(match.shape);
		curr = match.nextPt;
	}
	if (ptDist(curr, shapes[0].start) > tolerance) return null;
	return ordered;
}

function buildPolygon(orderedShapes, segmentsPerArc) {
	const polygon = [];
	for (let i = 0; i < orderedShapes.length; i++) {
		const pts = flattenShape(orderedShapes[i], segmentsPerArc);
		const startIdx = i === 0 ? 0 : 1;
		for (let j = startIdx; j < pts.length; j++) {
			polygon.push(pts[j]);
		}
	}
	if (polygon.length > 0) {
		polygon[polygon.length - 1] = { x: polygon[0].x, y: polygon[0].y };
	}
	return polygon;
}

export function outlineToPolygon(shapes, tolerance = 0.01) {
	if (!Array.isArray(shapes) || shapes.length === 0) {
		return { ok: false, error: "Outline is not closed" };
	}
	const first = shapes[0];
	if (
		shapes.length === 1 &&
		(first.type === "rect" || first.type === "circle")
	) {
		return { ok: true, polygon: flattenShape(first) };
	}
	const ordered = chainShapes(shapes, tolerance);
	if (!ordered) {
		return { ok: false, error: "Outline is not closed" };
	}
	return { ok: true, polygon: buildPolygon(ordered, 16) };
}

export function polygonArea(points) {
	if (!Array.isArray(points) || points.length < 3) return 0;
	let sum = 0;
	const n = points.length;
	for (let i = 0; i < n; i++) {
		const curr = points[i];
		const next = points[(i + 1) % n];
		sum += curr.x * next.y - next.x * curr.y;
	}
	return Math.abs(sum) / 2;
}

export function polygonBBox(points) {
	if (!Array.isArray(points) || points.length === 0) {
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}
	let minX = points[0].x;
	let maxX = points[0].x;
	let minY = points[0].y;
	let maxY = points[0].y;
	for (let i = 1; i < points.length; i++) {
		const pt = points[i];
		if (pt.x < minX) minX = pt.x;
		if (pt.x > maxX) maxX = pt.x;
		if (pt.y < minY) minY = pt.y;
		if (pt.y > maxY) maxY = pt.y;
	}
	return { minX, minY, maxX, maxY };
}

export function pointInPolygon(pt, points) {
	if (!pt || !Array.isArray(points) || points.length < 3) return false;
	let inside = false;
	const n = points.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const pi = points[i];
		const pj = points[j];
		const intersect =
			pi.y > pt.y !== pj.y > pt.y &&
			pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x;
		if (intersect) {
			inside = !inside;
		}
	}
	return inside;
}
