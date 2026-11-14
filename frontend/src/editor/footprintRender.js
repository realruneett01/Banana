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

export function calcArcCenter(p1, pm, p2) {
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

// Board-embedded footprints carry graphics already in primitive form; arcs
// only keep start/mid/end, so the centre and radius are derived here.
function compactGraphic(g) {
	if (!g?.type) return null;
	if (g.type !== "arc") return g;
	return { ...g, ...calcArcCenter(g.start, g.mid, g.end) };
}

function parseGraphicNode(node) {
	if (!Array.isArray(node)) return compactGraphic(node);
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

// Shapes padOutline draws from their own settings (rect_delta, primitives).
const KEPT_PAD_SHAPES = new Set(["trapezoid", "custom"]);

function normalizePadShape(shape) {
	const key = String(shape || "").toLowerCase();
	if (KEPT_PAD_SHAPES.has(key)) return key;
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

// A custom pad's (gr_line|gr_rect|gr_circle|gr_arc|gr_poly ...) in pad
// coordinates, read as the matching footprint graphic; width 0 stays 0.
function parsePadPrimitive(node) {
	const head = nodeSym(node?.[0]);
	if (!head.startsWith("gr_")) return null;
	const g = parseGraphicNode([
		{ sym: `fp_${head.slice(3)}` },
		...node.slice(1),
	]);
	if (!g) return null;
	const fill = nodeSym(findChild(node, "fill")?.[1]);
	return {
		...g,
		width: extractWidth(node, 0),
		fill: fill === "yes" || fill === "solid",
	};
}

// Shape settings an imported pad keeps in pad.extra, as written by KiCad.
const PAD_PARAMS = new Map([
	["roundrect_rratio", (n) => ({ rratio: Number(n[1]) || 0 })],
	["chamfer_ratio", (n) => ({ chamferRatio: Number(n[1]) || 0 })],
	["chamfer", (n) => ({ chamfer: n.slice(1).map(nodeSym) })],
	["rect_delta", (n) => ({ delta: toNumPair(n.slice(1)) })],
	["options", (n) => ({ anchor: nodeSym(findChild(n, "anchor")?.[1]) })],
	[
		"primitives",
		(n) => ({ primitives: n.slice(1).map(parsePadPrimitive).filter(Boolean) }),
	],
]);

function padShapeParams(extra) {
	const params = {};
	for (const node of Array.isArray(extra) ? extra : []) {
		const read = Array.isArray(node) && PAD_PARAMS.get(nodeSym(node[0]));
		if (read) Object.assign(params, read(node));
	}
	return params;
}

function parsePad(pad) {
	return {
		...padShapeParams(pad.extra),
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

// pl.rot is an SVG angle (clockwise) but padRot is KiCad's (counter-clockwise),
// so it is subtracted; the X mirror on B reverses it once more.
function transformRot(padRot, pl) {
	const rot = pl.rot ?? 0;
	const base = pl.side === "B" ? rot + padRot : rot - padRot;
	return ((base % 360) + 360) % 360;
}

// Pad shape settings are front-side; on B they are mirrored in the pad's own
// frame: across Y for a library footprint (X mirror), across X for an
// embedded one (KiCad's top-bottom flip, already applied to the pad position).
function padMirror(pad, pl) {
	if (pl.side === "B") return { mirror: "x" };
	return pl.flipPads ? { ...frontShapeParams(pad), mirror: "y" } : {};
}

const FLIP_CORNER = {
	top_left: "bottom_left",
	bottom_left: "top_left",
	top_right: "bottom_right",
	bottom_right: "top_right",
};

// An embedded B pad has its primitives front-side but its chamfer corners
// and rect_delta as the board file has them; take those to the front too.
function frontShapeParams(pad) {
	const front = {};
	if (pad.chamfer) front.chamfer = pad.chamfer.map((c) => FLIP_CORNER[c] ?? c);
	if (pad.delta) front.delta = [pad.delta[0], -pad.delta[1]];
	return front;
}

function transformPad(pad, pl) {
	return {
		...pad,
		center: transformPoint(pad.center, pl),
		rot: transformRot(pad.rot, pl),
		layers: pad.layers.map((l) => mapLayer(l, pl.side)),
		...padMirror(pad, pl),
	};
}

function transformArcGraphic(g, pl, layer) {
	const start = transformPoint(g.start, pl);
	const mid = g.mid ? transformPoint(g.mid, pl) : undefined;
	const end = transformPoint(g.end, pl);
	const center = g.center ? transformPoint(g.center, pl) : undefined;
	// Drop the untransformed path so it is rebuilt from the moved points.
	const arc = { ...g, layer, start, mid, end, center, d: undefined };
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
 * Placement to transform a footprint with. Placement angles are KiCad's
 * (counter-clockwise on a Y-down board, written to the file as is), so the
 * angle is negated. A footprint embedded in a board file is already flipped
 * for its side. A library footprint on B is flipped top-bottom as KiCad does;
 * that is the X mirror applied here turned a further 180 degrees.
 */
export function placementFor(fp, placement = {}) {
	const rot = -(placement.rot ?? 0);
	if (fp?.embedded) {
		const flip = placement.side === "B" ? { flipPads: true } : {};
		return { ...placement, rot, side: "F", ...flip };
	}
	if (placement.side !== "B") return { ...placement, rot };
	return { ...placement, rot: rot + 180 };
}

// SVG rotation for a KiCad text angle (counter-clockwise, Y down), turned
// so the text never reads upside down.
function readableSvgAngle(kicadDeg) {
	const a = ((-kicadDeg % 360) + 360) % 360 || 0;
	if (a >= 90 && a < 270) return a - 180;
	return a >= 270 ? a - 360 : a;
}

/**
 * World position, SVG angle and font height of a board-embedded footprint's
 * reference text; null when the board file gave no position.
 */
export function refLabelPlacement(fp, placement = {}) {
	const label = fp?.refLabel;
	if (!label) return null;
	const [x, y] = transformPoint(label.at, placementFor(fp, placement));
	const angle = readableSvgAngle(label.rot + (placement.rot ?? 0));
	return { x: round4(x), y: round4(y), angle, size: label.size };
}

function partFootprintId(part) {
	return part.footprint ?? part.props?.footprint;
}

/**
 * Library footprint ids still to fetch: only while the PCB view is shown,
 * only for placed parts the board file does not embed, and never again for
 * an id already cached (a cached null is a known miss) or in flight.
 */
export function footprintIdsToFetch(parts, opts = {}) {
	const { visible, embedded, cache = {}, pending = new Set() } = opts;
	if (!visible || !Array.isArray(parts)) return [];
	const ids = parts
		.filter((p) => p.placement && !embedded?.[p.id])
		.map(partFootprintId)
		.filter((id) => id && cache[id] === undefined && !pending.has(id));
	return [...new Set(ids)];
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

// KiCad's roundrect_rratio when a pad does not give one.
const DEFAULT_RRATIO = 0.25;

/** Corner radius of a roundrect pad: its rratio (0.25 when absent) times its smaller side; 0 for other shapes. */
export function padCornerRadius(pad) {
	if (pad.shape !== "roundrect") return 0;
	const ratio = Math.min(0.5, Math.max(0, pad.rratio ?? DEFAULT_RRATIO));
	const [w, h] = toNumPair(pad.size, 0);
	return ratio * Math.min(w, h);
}

const BOX_CORNERS = [
	["top_left", -1, -1],
	["top_right", 1, -1],
	["bottom_right", 1, 1],
	["bottom_left", -1, 1],
];

// One box corner, or the two ends of its chamfer cut c, in outline order.
function cornerPoints([sx, sy], [a, b], c) {
	if (!(c > 0)) return [[sx * a, sy * b]];
	const onSide = [sx * a, sy * (b - c)];
	const onTop = [sx * (a - c), sy * b];
	return sx * sy > 0 ? [onSide, onTop] : [onTop, onSide];
}

// A rect or roundrect pad, chamfered at the named corners. The copper is the
// inner polygon grown by the corner radius r, so the cut on the inner box is
// the chamfer less what growing by r adds to it.
function rectOutline(pad) {
	const [w, h] = toNumPair(pad.size, 0);
	const r = padCornerRadius(pad);
	const cut = (pad.chamferRatio ?? 0) * Math.min(w, h) - r * (2 - Math.SQRT2);
	const corners = pad.chamfer ?? [];
	const pts = BOX_CORNERS.flatMap(([name, sx, sy]) =>
		cornerPoints(
			[sx, sy],
			[w / 2 - r, h / 2 - r],
			corners.includes(name) ? cut : 0,
		),
	);
	return { pts, r };
}

// rect_delta widens one side and narrows the opposite one by half the delta.
function trapezoidOutline(pad) {
	const [hw, hh] = toNumPair(pad.size, 0).map((v) => v / 2);
	const [dx, dy] = toNumPair(pad.delta, 0).map((v) => v / 2);
	const pts = [
		[-hw - dy, hh + dx],
		[hw + dy, hh - dx],
		[hw - dy, -hh + dx],
		[-hw + dy, -hh - dx],
	];
	return { pts, r: 0 };
}

function boundsOf(pts, grow) {
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	return [
		Math.min(...xs) - grow,
		Math.min(...ys) - grow,
		Math.max(...xs) + grow,
		Math.max(...ys) + grow,
	];
}

function primitiveBounds(p) {
	const round = p.type === "circle" || p.type === "arc";
	const grow = (p.width || 0) / 2 + (round ? p.radius : 0);
	return boundsOf(round ? [p.center] : (p.pts ?? [p.start, p.end]), grow);
}

// A custom pad: the bounding box of its anchor and every primitive.
function customOutline(pad) {
	const [w, h] = toNumPair(pad.size, 0);
	const anchorH = pad.anchor === "circle" ? w : h;
	const boxes = [[-w / 2, -anchorH / 2, w / 2, anchorH / 2]];
	boxes.push(...(pad.primitives ?? []).map(primitiveBounds));
	const [x0, y0] = boundsOf(
		boxes.map((b) => [b[0], b[1]]),
		0,
	);
	const [, , x1, y1] = boundsOf(
		boxes.map((b) => [b[2], b[3]]),
		0,
	);
	const pts = [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1],
	];
	return { pts, r: 0 };
}

function roundOutline(pad) {
	const [hw, hh] = toNumPair(pad.size, 0).map((v) => v / 2);
	if (pad.shape === "circle") return { pts: [[0, 0]], r: Math.max(hw, hh) };
	const r = Math.min(hw, hh);
	return {
		pts: [
			[r - hw, r - hh],
			[hw - r, hh - r],
		],
		r,
	};
}

const PAD_OUTLINES = {
	circle: roundOutline,
	oval: roundOutline,
	trapezoid: trapezoidOutline,
	custom: customOutline,
};

/**
 * A pad's copper in its own frame (centre at the origin, rotation and side
 * undone): the polygon pts (a point or a segment for round pads) grown by r.
 */
export function padOutline(pad) {
	return (PAD_OUTLINES[pad.shape] ?? rectOutline)(pad);
}

/** World point p in the pad's own frame, the frame padOutline uses. */
export function padLocalPoint(p, pad) {
	const [cx, cy] = pad.center;
	const [lx, ly] = rotate2D(p[0] - cx, p[1] - cy, -(Number(pad.rot) || 0));
	if (pad.mirror === "x") return [-lx, ly];
	return pad.mirror === "y" ? [lx, -ly] : [lx, ly];
}

/** Closing edges [a, b] of a polygon; a point gives one zero-length edge. */
export function polygonEdges(pts) {
	return pts.map((a, i) => [a, pts[(i + 1) % pts.length]]);
}

/** Even-odd test; false for fewer than three points. */
export function pointInPolygon(p, pts) {
	if (pts.length < 3) return false;
	let inside = false;
	for (const [a, b] of polygonEdges(pts)) {
		const crosses = a[1] > p[1] !== b[1] > p[1];
		if (
			crosses &&
			p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
		) {
			inside = !inside;
		}
	}
	return inside;
}

export function distPointToSegment(px, py, s, e) {
	const dx = e[0] - s[0];
	const dy = e[1] - s[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) {
		return Math.hypot(px - s[0], py - s[1]);
	}
	const t = Math.max(
		0,
		Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / lenSq),
	);
	return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

function pointInPad(pt, pad) {
	const p = padLocalPoint(pt, pad);
	const { pts, r } = padOutline(pad);
	if (pointInPolygon(p, pts)) return true;
	const near = ([a, b]) => distPointToSegment(p[0], p[1], a, b) <= r;
	return polygonEdges(pts).some(near);
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
