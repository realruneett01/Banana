function nodeSym(node) {
	if (node === null || node === undefined) return "";
	const val = typeof node === "object" ? node.sym : node;
	return val !== null && val !== undefined ? String(val) : "";
}

function findChild(node, head) {
	if (!Array.isArray(node)) return null;
	for (let i = 0; i < node.length; i++) {
		const c = node[i];
		if (Array.isArray(c) && nodeSym(c[0]) === head) return c;
	}
	return null;
}

function childNum(node, head, index, fallback = 0) {
	const sub = findChild(node, head);
	if (!sub || sub.length <= index) return fallback;
	const n = Number(sub[index]);
	return Number.isFinite(n) ? n : fallback;
}

function childPt(node, head, fallback = [0, 0]) {
	const sub = findChild(node, head);
	if (!sub || sub.length < 3) return fallback;
	return [Number(sub[1]) || 0, Number(sub[2]) || 0];
}

function extractLayer(node, fallback = "F.SilkS") {
	const sub = findChild(node, "layer");
	const name = Array.isArray(sub) && sub.length >= 2 ? nodeSym(sub[1]) : "";
	return name || fallback;
}

function extractWidth(node, fallback = 0.15) {
	const stroke = findChild(node, "stroke");
	const sw = stroke ? childNum(stroke, "width", 1, 0) : 0;
	if (sw > 0) return sw;
	const dw = childNum(node, "width", 1, 0);
	return dw > 0 ? dw : fallback;
}

function calcArcCenter(p1, pm, p2) {
	const [x1, y1] = p1;
	const [x2, y2] = pm;
	const [x3, y3] = p2;
	const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
	if (Math.abs(d) < 1e-10) {
		return {
			center: [(x1 + x2) / 2 || 0, (y1 + y2) / 2 || 0],
			radius: Math.hypot(x2 - x1, y2 - y1),
		};
	}
	const q1 = x1 * x1 + y1 * y1;
	const q2 = x2 * x2 + y2 * y2;
	const q3 = x3 * x3 + y3 * y3;
	const cx = (q1 * (y2 - y3) + q2 * (y3 - y1) + q3 * (y1 - y2)) / d;
	const cy = (q1 * (x3 - x2) + q2 * (x1 - x3) + q3 * (x2 - x1)) / d;
	return {
		center: [cx || 0, cy || 0],
		radius: Math.hypot(x1 - cx, y1 - cy),
	};
}

function calcArcSweep(p1, pm, p2, c) {
	const [a1, am, a2] = [p1, pm, p2].map((pt) =>
		Math.atan2(pt[1] - c[1], pt[0] - c[0]),
	);
	const full = 2 * Math.PI;
	const norm = (a) => ((a % full) + full) % full;
	const dm = norm(am - a1);
	const d2 = norm(a2 - a1);
	const swept = dm < d2 ? d2 : full - d2;
	return swept > Math.PI ? 1 : 0;
}

function getArcEndpoints(arc) {
	const start = arc.start ?? [0, 0];
	const end = arc.end ?? [0, 0];
	const midFallback = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
	return {
		p1: start,
		p2: end,
		pm: arc.mid ?? midFallback,
		c: arc.center ?? midFallback,
	};
}

function getArcRadius(arc, p1, c) {
	return arc.radius ?? Math.hypot(p1[0] - c[0], p1[1] - c[1]);
}

export function arcToSvgPath(arc) {
	if (arc.d) return arc.d;
	const { p1, p2, pm, c } = getArcEndpoints(arc);
	const r = getArcRadius(arc, p1, c);
	if (r <= 0) return `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]}`;
	const cp =
		(pm[0] - p1[0]) * (p2[1] - p1[1]) - (pm[1] - p1[1]) * (p2[0] - p1[0]);
	const sweep = cp > 0 ? 1 : 0;
	const largeArc = calcArcSweep(p1, pm, p2, c);
	return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2[0]} ${p2[1]}`;
}

function pointOnCircle(center, radius, angleRad) {
	return [
		center[0] + radius * Math.cos(angleRad),
		center[1] + radius * Math.sin(angleRad),
	];
}

function parseAngleArc(nodes, layer, width) {
	const { start, end, angle } = nodes;
	const c = [Number(start[1]) || 0, Number(start[2]) || 0];
	const p1 = [Number(end[1]) || 0, Number(end[2]) || 0];
	const angleDeg = Number(angle[1]) || 0;
	const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const sweepRad = (angleDeg * Math.PI) / 180;
	const p2 = pointOnCircle(c, r, a1 + sweepRad);
	const pm = pointOnCircle(c, r, a1 + sweepRad / 2);
	const largeArc = Math.abs(angleDeg) > 180 ? 1 : 0;
	const sweep = angleDeg > 0 ? 1 : 0;
	return {
		type: "arc",
		layer,
		width,
		start: p1,
		mid: pm,
		end: p2,
		center: c,
		radius: r,
		d: `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2[0]} ${p2[1]}`,
	};
}

function parseMidArc(nodes, layer, width) {
	const { start, mid, end } = nodes;
	const p1 = [Number(start[1]) || 0, Number(start[2]) || 0];
	const pm = [Number(mid[1]) || 0, Number(mid[2]) || 0];
	const p2 = [Number(end[1]) || 0, Number(end[2]) || 0];
	const { center, radius } = calcArcCenter(p1, pm, p2);
	const arc = {
		type: "arc",
		layer,
		width,
		start: p1,
		mid: pm,
		end: p2,
		center,
		radius,
	};
	arc.d = arcToSvgPath(arc);
	return arc;
}

function parseArcNode(node, layer, width) {
	const start = findChild(node, "start");
	const mid = findChild(node, "mid");
	const end = findChild(node, "end");
	const angle = findChild(node, "angle");
	if (start && end) {
		if (mid) return parseMidArc({ start, mid, end }, layer, width);
		if (angle) return parseAngleArc({ start, end, angle }, layer, width);
	}
	return null;
}

function parsePolyNode(node, layer, width) {
	const ptsNode = findChild(node, "pts") ?? [];
	const pts = ptsNode
		.filter((c) => Array.isArray(c) && nodeSym(c[0]) === "xy")
		.map((c) => [Number(c[1]) || 0, Number(c[2]) || 0]);
	return { type: "poly", layer, width, pts };
}

function parseGraphicNode(node) {
	if (!Array.isArray(node)) return null;
	const head = nodeSym(node[0]);
	const layer = extractLayer(node);
	const width = extractWidth(node);
	if (head === "fp_line" || head === "fp_rect") {
		const type = head === "fp_line" ? "line" : "rect";
		return {
			type,
			layer,
			width,
			start: childPt(node, "start"),
			end: childPt(node, "end"),
		};
	}
	if (head === "fp_circle") {
		const center = childPt(node, "center");
		const end = childPt(node, "end");
		const radius = Math.hypot(end[0] - center[0], end[1] - center[1]);
		return { type: "circle", layer, width, center, end, radius };
	}
	if (head === "fp_arc") return parseArcNode(node, layer, width);
	if (head === "fp_poly") return parsePolyNode(node, layer, width);
	return null;
}

const PAD_SHAPE_MAP = {
	roundrect: "roundrect",
	rounded_rect: "roundrect",
	oval: "oval",
	oblong: "oval",
	circle: "circle",
	circular: "circle",
};

function normalizePadShape(shape) {
	const key = String(shape || "").toLowerCase();
	return PAD_SHAPE_MAP[key] ?? "rect";
}

function toNumPair(arr, fallback = 0) {
	if (!Array.isArray(arr)) return [fallback, fallback];
	return [Number(arr[0]) || 0, Number(arr[1]) || 0];
}

function extractPadRot(at) {
	return Array.isArray(at) ? Number(at[2]) || 0 : 0;
}

function extractPadLayers(layers) {
	return Array.isArray(layers) ? [...layers] : ["F.Cu"];
}

function extractPadDrill(drill) {
	return drill ? Number(drill) : undefined;
}

function parsePad(pad) {
	return {
		type: "pad",
		number: String(pad.number ?? ""),
		padType: String(pad.type ?? "smd"),
		shape: normalizePadShape(pad.shape),
		center: toNumPair(pad.at, 0),
		size: toNumPair(pad.size, 1),
		rot: extractPadRot(pad.at),
		layers: extractPadLayers(pad.layers),
		drill: extractPadDrill(pad.drill),
	};
}

export function footprintToPrimitives(fp) {
	if (!fp) return { pads: [], graphics: [] };
	const rawPads = Array.isArray(fp.pads) ? fp.pads : [];
	const rawGraphics = Array.isArray(fp.graphics) ? fp.graphics : [];
	const pads = rawPads.map(parsePad);
	const graphics = rawGraphics.map(parseGraphicNode).filter(Boolean);
	return { pads, graphics };
}

function mapLayer(layer, side) {
	if (side !== "B" || typeof layer !== "string") return layer;
	if (layer.startsWith("F.")) return `B.${layer.slice(2)}`;
	return layer;
}

function rotate2D(x, y, angleDeg) {
	const rad = (angleDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return [x * cos - y * sin, x * sin + y * cos];
}

function transformPoint(pt, pl) {
	const x = pl.x ?? 0;
	const y = pl.y ?? 0;
	const rot = pl.rot ?? 0;
	const px = pl.side === "B" ? -pt[0] : pt[0];
	const py = pt[1];
	if (!rot) return [x + px, y + py];
	const [rx, ry] = rotate2D(px, py, rot);
	return [x + rx, y + ry];
}

function transformRot(padRot, pl) {
	const rot = pl.rot ?? 0;
	const base = pl.side === "B" ? rot - padRot : rot + padRot;
	return ((base % 360) + 360) % 360;
}

function transformPad(pad, pl) {
	return {
		...pad,
		center: transformPoint(pad.center, pl),
		rot: transformRot(pad.rot, pl),
		layers: pad.layers.map((l) => mapLayer(l, pl.side)),
	};
}

function transformArcGraphic(g, pl, layer) {
	const start = transformPoint(g.start, pl);
	const mid = g.mid ? transformPoint(g.mid, pl) : undefined;
	const end = transformPoint(g.end, pl);
	const center = g.center ? transformPoint(g.center, pl) : undefined;
	const arc = { ...g, layer, start, mid, end, center };
	arc.d = arcToSvgPath(arc);
	return arc;
}

function transformGraphic(g, pl) {
	const layer = mapLayer(g.layer, pl.side);
	if (g.type === "line" || g.type === "rect") {
		return {
			...g,
			layer,
			start: transformPoint(g.start, pl),
			end: transformPoint(g.end, pl),
		};
	}
	if (g.type === "circle") {
		return { ...g, layer, center: transformPoint(g.center, pl) };
	}
	if (g.type === "arc") return transformArcGraphic(g, pl, layer);
	if (g.type === "poly") {
		return { ...g, layer, pts: g.pts.map((p) => transformPoint(p, pl)) };
	}
	return { ...g, layer };
}

export function transformPrimitives(prims, placement = {}) {
	if (!prims) return { pads: [], graphics: [] };
	const pl = { x: 0, y: 0, rot: 0, side: "F", ...placement };
	if (Array.isArray(prims)) {
		return prims.map((p) =>
			p.type === "pad" ? transformPad(p, pl) : transformGraphic(p, pl),
		);
	}
	const pads = (prims.pads ?? []).map((p) => transformPad(p, pl));
	const graphics = (prims.graphics ?? []).map((g) => transformGraphic(g, pl));
	return { pads, graphics };
}

function round4(n) {
	return Math.round(n * 10000) / 10000;
}

function getFootprintPads(fp) {
	if (!fp?.pads) return [];
	return Array.isArray(fp.pads) ? fp.pads : Object.values(fp.pads);
}

function getPadLocalPt(pad) {
	if (Array.isArray(pad.at)) {
		return [Number(pad.at[0]) || 0, Number(pad.at[1]) || 0];
	}
	return pad.center ?? [0, 0];
}

function calcPadWorldCoord(pad, pl) {
	const localPt = getPadLocalPt(pad);
	const [wx, wy] = transformPoint(localPt, pl);
	return [round4(wx), round4(wy)];
}

/**
 * Placement to transform a footprint with. A footprint embedded in a board
 * file is already flipped for its side, and KiCad turns positive angles
 * counter-clockwise on a Y-down board, so the angle is negated for it.
 */
export function placementFor(fp, placement = {}) {
	if (!fp?.embedded) return placement;
	return { ...placement, rot: -(placement.rot ?? 0), side: "F" };
}

export function padWorldPositions(fp, placement = {}) {
	const pads = getFootprintPads(fp);
	const pl = { x: 0, y: 0, rot: 0, side: "F", ...placementFor(fp, placement) };
	const positions = {};
	for (const pad of pads) {
		const num = String(pad.number ?? "");
		if (num) {
			positions[num] = calcPadWorldCoord(pad, pl);
		}
	}
	return positions;
}

// Radius of the circle around a pad's centre that a track must reach.
function padReach(pad) {
	const [w, h] = toNumPair(pad.size, 0);
	return Math.max(w, h) / 2;
}

function padRadii(fp) {
	const radii = {};
	for (const pad of getFootprintPads(fp)) {
		const num = String(pad.number ?? "");
		if (num) radii[num] = padReach(pad);
	}
	return radii;
}

function mapPlacedParts(parts, lookupFp, fn) {
	const map = {};
	for (const part of parts ?? []) {
		const fp = lookupFp(part);
		if (fp && part.placement) map[part.id] = fn(fp, part.placement);
	}
	return map;
}

/** {partId: {pin: [x, y]}} for every placed part whose footprint lookupFp(part) finds. */
export function boardPadPositions(parts, lookupFp) {
	return mapPlacedParts(parts, lookupFp, padWorldPositions);
}

/** {partId: {pin: reach}} matching boardPadPositions. */
export function boardPadRadii(parts, lookupFp) {
	return mapPlacedParts(parts, lookupFp, padRadii);
}

function pointInRotatedBox(lx, ly, hw, hh) {
	return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

function pointInOval(lx, ly, hw, hh) {
	const horizontal = hw >= hh;
	const r = horizontal ? hh : hw;
	const span = (horizontal ? hw : hh) - r;
	const major = horizontal ? lx : ly;
	const minor = horizontal ? ly : lx;
	const clamped = Math.max(-span, Math.min(span, major));
	return (major - clamped) ** 2 + minor ** 2 <= r ** 2;
}

function pointInRoundRect(lx, ly, hw, hh) {
	if (!pointInRotatedBox(lx, ly, hw, hh)) return false;
	const r = Math.min(hw, hh) * 0.25;
	const cx = hw - r;
	const cy = hh - r;
	if (Math.abs(lx) > cx && Math.abs(ly) > cy) {
		return (Math.abs(lx) - cx) ** 2 + (Math.abs(ly) - cy) ** 2 <= r ** 2;
	}
	return true;
}

function pointInPad(pt, pad) {
	const [px, py] = pt;
	const [cx, cy] = pad.center;
	const [lx, ly] = rotate2D(px - cx, py - cy, -(pad.rot || 0));
	const hw = (pad.size[0] || 0) / 2;
	const hh = (pad.size[1] || 0) / 2;
	if (pad.shape === "circle") return lx ** 2 + ly ** 2 <= Math.max(hw, hh) ** 2;
	if (pad.shape === "oval") return pointInOval(lx, ly, hw, hh);
	if (pad.shape === "roundrect") return pointInRoundRect(lx, ly, hw, hh);
	return pointInRotatedBox(lx, ly, hw, hh);
}

export function padHitTest(prims, pt) {
	if (!prims || !Array.isArray(pt)) return null;
	const pads = Array.isArray(prims)
		? prims.filter((p) => p.type === "pad")
		: (prims.pads ?? []);
	for (const pad of pads) {
		if (pointInPad(pt, pad)) return pad.number;
	}
	return null;
}
