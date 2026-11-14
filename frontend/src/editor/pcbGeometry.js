import {
	arcToSvgPath,
	calcArcCenter,
	placementFor,
} from "./footprintRender.js";
import { ratsnest as pureRatsnest } from "./ratsnest.js";

// Each net is solved on its own, so the pure module needs only one non-empty net key.
const NET_KEY = "net";

export const LAYER_COLORS = Object.freeze({
	"F.Cu": "#c83434",
	"B.Cu": "#3b82f6",
	"F.SilkS": "#f1f5f9",
	"B.SilkS": "#c084fc",
	"Edge.Cuts": "#eab308",
	"F.Mask": "#a855f7",
	"B.Mask": "#6366f1",
});

const SIZES_BY_CODE = {
	"0402": [1.0, 0.5],
	"0603": [1.6, 0.8],
	"0805": [2.0, 1.25],
	1206: [3.2, 1.6],
	sot23: [2.9, 1.3],
	soic8: [4.9, 3.9],
	dip8: [9.5, 6.5],
};

const PACKAGE_PATTERNS = [
	[/(?:^|\D)(0402|0603|0805|1206)(?:\D|$)/i, (m) => m[1]],
	[/sot[-_]?23/i, () => "sot23"],
	[/soic[-_]?8/i, () => "soic8"],
	[/dip[-_]?8/i, () => "dip8"],
];

function matchPackageKey(str) {
	for (const [regex, getKey] of PACKAGE_PATTERNS) {
		const match = str.match(regex);
		if (match) return getKey(match);
	}
	return null;
}

function resolveFootprintSize(name) {
	if (!name) return { w: 5, h: 5 };
	const key = matchPackageKey(String(name));
	const dims = key ? SIZES_BY_CODE[key] : null;
	return dims ? { w: dims[0], h: dims[1] } : { w: 5, h: 5 };
}

export function footprintRect(part) {
	if (!part) return null;
	const pl = part.placement ?? { x: 0, y: 0, rot: 0, side: "F" };
	const fpName = part.footprint ?? part.props?.footprint ?? "";
	const hint = resolveFootprintSize(fpName);
	const w = part.props?.sizeMm?.w ?? hint.w;
	const h = part.props?.sizeMm?.h ?? hint.h;
	return {
		id: part.id,
		ref: part.ref ?? "",
		x: pl.x ?? 0,
		y: pl.y ?? 0,
		w,
		h,
		rot: pl.rot ?? 0,
		side: pl.side ?? "F",
	};
}

function snapNum(n, grid) {
	if (!grid || grid <= 0) return n;
	const snapped = Math.round(n / grid) * grid;
	return Math.round(snapped * 10000) / 10000;
}

function isPointObject(v) {
	if (!v || typeof v !== "object") return false;
	return "x" in v && "y" in v;
}

export function snapToGrid(v, grid = 0.25) {
	if (typeof v === "number") {
		return snapNum(v, grid);
	}
	if (Array.isArray(v)) {
		return [snapNum(v[0], grid), snapNum(v[1], grid)];
	}
	if (isPointObject(v)) {
		return { x: snapNum(v.x, grid), y: snapNum(v.y, grid) };
	}
	return v;
}

function ptCoords(p) {
	if (Array.isArray(p)) return [p[0], p[1]];
	return [p?.x ?? 0, p?.y ?? 0];
}

function pointDistance(p1, p2) {
	const [x1, y1] = ptCoords(p1);
	const [x2, y2] = ptCoords(p2);
	return Math.hypot(x2 - x1, y2 - y1);
}

function polylineLength(points) {
	let total = 0;
	for (let i = 0; i < points.length - 1; i++) {
		total += pointDistance(points[i], points[i + 1]);
	}
	return total;
}

export function trackLength(track) {
	if (!track) return 0;
	if (Array.isArray(track.points) && track.points.length >= 2) {
		return polylineLength(track.points);
	}
	if (isArcTrack(track)) return arcLength(track);
	if (track.start && track.end) {
		return pointDistance(track.start, track.end);
	}
	return 0;
}

function getBoardTracks(board) {
	return Array.isArray(board?.tracks) ? [...board.tracks] : [];
}

function createTrackSegments(points, meta) {
	const segments = [];
	for (let i = 0; i < points.length - 1; i++) {
		segments.push({
			netId: meta.netId,
			layer: meta.layer,
			start: ptCoords(points[i]),
			end: ptCoords(points[i + 1]),
			widthMm: meta.widthMm,
		});
	}
	return segments;
}

export function addTrack(board, options = {}) {
	const { netId = "", layer = "F.Cu", points = [], widthMm = 0.25 } = options;
	const segments = createTrackSegments(points, { netId, layer, widthMm });
	return {
		...(board ?? {}),
		tracks: [...getBoardTracks(board), ...segments],
	};
}

export function deleteTrack(board, index) {
	const tracks = getBoardTracks(board);
	if (typeof index === "number" && index >= 0 && index < tracks.length) {
		tracks.splice(index, 1);
	}
	return {
		...(board ?? {}),
		tracks,
	};
}

function lookupPadPosition(padPos, partId, pinId) {
	if (typeof padPos === "function") {
		return padPos(partId, pinId);
	}
	if (padPos instanceof Map) {
		return padPos.get(`${partId}:${pinId}`);
	}
	if (padPos && typeof padPos === "object") {
		return padPos[partId]?.[pinId];
	}
	return null;
}

function resolvePin(pin, padPos, partMap) {
	const pos = lookupPadPosition(padPos, pin.partId, pin.pin);
	if (pos) return ptCoords(pos);
	const pl = partMap.get(pin.partId)?.placement;
	return pl ? [pl.x ?? 0, pl.y ?? 0] : null;
}

function collectPinsWithPos(net, padPos, partMap) {
	const pins = [];
	for (const p of net.pins ?? []) {
		const pos = resolvePin(p, padPos, partMap);
		if (pos) {
			pins.push({ partId: p.partId, pin: p.pin, x: pos[0], y: pos[1] });
		}
	}
	return pins;
}

function toXY(p) {
	const [x, y] = ptCoords(p);
	return { x, y };
}

function pureTracksOfNet(tracks, netId) {
	return (tracks ?? [])
		.filter((t) => t.netId === netId)
		.map((t) => ({
			net: NET_KEY,
			start: toXY(t.start),
			end: toXY(t.end),
			width: t.widthMm ?? 0,
		}));
}

function pureZonesOfNet(zones, netId) {
	return (zones ?? [])
		.filter((z) => z.netId === netId)
		.map((z) => ({ net: NET_KEY, polygon: (z.polygon ?? []).map(toXY) }));
}

function pinPad(pin, i, padRadius) {
	const r = padRadius?.[pin.partId]?.[pin.pin] ?? 0;
	return { id: i, net: NET_KEY, x: pin.x, y: pin.y, r };
}

function netAirlines(net, pins, tracks, opts) {
	const pads = pins.map((p, i) => pinPad(p, i, opts.padRadius));
	const netTracks = pureTracksOfNet(tracks, net.id);
	const netZones = pureZonesOfNet(opts.zones, net.id);
	return pureRatsnest(pads, netTracks, netZones).map((a) => ({
		netId: net.id,
		name: net.name ?? net.id,
		from: { ...pins[a.from] },
		to: { ...pins[a.to] },
	}));
}

/** opts.zones: board zones; opts.padRadius: {partId: {pin: reach}} so tracks ending inside a pad connect. */
export function ratsnest(ir, padPos, tracks = [], opts = {}) {
	if (!Array.isArray(ir?.nets)) return [];
	const partMap = new Map((ir?.parts ?? []).map((p) => [p.id, p]));
	const links = [];
	for (const net of ir.nets) {
		const pins = collectPinsWithPos(net, padPos, partMap);
		links.push(...netAirlines(net, pins, tracks, opts));
	}
	return links;
}

function pointInPart(x, y, part) {
	const rect = footprintRect(part);
	if (!rect) return false;
	// Undo the SVG turn the part is drawn with.
	const rad = (-placementFor(null, rect).rot * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = x - rect.x;
	const dy = y - rect.y;
	const lx = dx * cos - dy * sin;
	const ly = dx * sin + dy * cos;
	return Math.abs(lx) <= rect.w / 2 && Math.abs(ly) <= rect.h / 2;
}

// Point of segment start-end nearest to (px, py).
function projectOnSegment(px, py, start, end) {
	const [sx, sy] = start;
	const [ex, ey] = end;
	const segX = ex - sx;
	const segY = ey - sy;
	const sqLen = segX ** 2 + segY ** 2;
	if (!sqLen) return [sx, sy];
	const dot = (px - sx) * segX + (py - sy) * segY;
	const frac = Math.max(0, Math.min(1, dot / sqLen));
	return [sx + frac * segX, sy + frac * segY];
}

function distToSegment(px, py, start, end) {
	return pointDistance([px, py], projectOnSegment(px, py, start, end));
}

function checkPartHit(p, x, y) {
	return Boolean(p.placement && pointInPart(x, y, p));
}

function checkViaHit(v, x, y) {
	const [vx, vy] = ptCoords(v.at);
	const radius = Math.max(0.6, (v.sizeMm ?? 0.8) / 2);
	return Math.hypot(x - vx, y - vy) <= radius;
}

// A KiCad (arc ...) track bends through `mid`; a collinear mid is a straight line.
export function isArcTrack(t) {
	if (!Array.isArray(t?.mid)) return false;
	const [sx, sy] = ptCoords(t.start);
	const [ex, ey] = ptCoords(t.end);
	const [mx, my] = t.mid;
	return Math.abs((mx - sx) * (ey - sy) - (my - sy) * (ex - sx)) > 1e-12;
}

/** SVG path for a track: a true arc through `mid` for arc tracks, else a line. */
export function trackPath(t) {
	const start = ptCoords(t.start);
	const end = ptCoords(t.end);
	if (!isArcTrack(t)) return `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`;
	const circle = calcArcCenter(start, t.mid, end);
	return arcToSvgPath({ start, mid: t.mid, end, ...circle });
}

const TURN = 2 * Math.PI;

function angleFrom(c, p) {
	const [x, y] = ptCoords(p);
	return Math.atan2(y - c[1], x - c[0]);
}

// Angle swept from a0 to a, counter-clockwise in maths terms, in [0, 2pi).
function turnFrom(a0, a) {
	return (((a - a0) % TURN) + TURN) % TURN;
}

function inArcSweep(c, t, p) {
	const a0 = angleFrom(c, t.start);
	const span = turnFrom(a0, angleFrom(c, t.end));
	const viaMid = turnFrom(a0, angleFrom(c, t.mid)) < span;
	return turnFrom(a0, angleFrom(c, p)) <= span === viaMid;
}

function distToArc(p, t) {
	const { center, radius } = arcCircle(t);
	if (!inArcSweep(center, t, p)) {
		return Math.min(pointDistance(p, t.start), pointDistance(p, t.end));
	}
	return Math.abs(pointDistance(p, center) - radius);
}

function arcCircle(t) {
	return calcArcCenter(ptCoords(t.start), t.mid, ptCoords(t.end));
}

// Arc length through `mid`: the sweep is the side of start->end that holds mid.
function arcLength(t) {
	const { center, radius } = arcCircle(t);
	const a0 = angleFrom(center, t.start);
	const span = turnFrom(a0, angleFrom(center, t.end));
	const viaMid = turnFrom(a0, angleFrom(center, t.mid)) < span;
	return radius * (viaMid ? span : TURN - span);
}

// Points where segment s-e crosses the circle (c, r).
function circleHits(s, e, c, r) {
	const [dx, dy] = [e[0] - s[0], e[1] - s[1]];
	const [fx, fy] = [s[0] - c[0], s[1] - c[1]];
	const a = dx * dx + dy * dy;
	const b = 2 * (fx * dx + fy * dy);
	const disc = b * b - 4 * a * (fx * fx + fy * fy - r * r);
	if (!a || disc < 0) return [];
	const root = Math.sqrt(disc);
	return [(-b - root) / (2 * a), (-b + root) / (2 * a)]
		.filter((u) => u >= 0 && u <= 1)
		.map((u) => [s[0] + u * dx, s[1] + u * dy]);
}

/** Shortest distance between segment s-e and arc track t (0 where they cross). */
export function arcSegmentDistance(t, s, e) {
	const { center, radius } = arcCircle(t);
	const onArc = (p) => inArcSweep(center, t, p);
	if (circleHits(s, e, center, radius).some(onArc)) return 0;
	const foot = projectOnSegment(center[0], center[1], s, e);
	const radial = onArc(foot)
		? Math.abs(pointDistance(foot, center) - radius)
		: Number.POSITIVE_INFINITY;
	const [as, ae] = [ptCoords(t.start), ptCoords(t.end)];
	return Math.min(
		radial,
		distToArc(s, t),
		distToArc(e, t),
		distToSegment(as[0], as[1], s, e),
		distToSegment(ae[0], ae[1], s, e),
	);
}

/** Stable React key: uuid when present, else index (arcs can share endpoints). */
export function trackKey(t, index) {
	return t?.uuid ? `track_${t.uuid}` : `track_${index}`;
}

function distToTrack(t, x, y) {
	if (isArcTrack(t)) return distToArc([x, y], t);
	return distToSegment(x, y, ptCoords(t.start), ptCoords(t.end));
}

function checkTrackHit(t, x, y) {
	const tol = Math.max(0.5, (t.widthMm ?? 0.25) / 2 + 0.3);
	return distToTrack(t, x, y) <= tol;
}

function hitTestParts(parts, x, y) {
	const idx = parts.findIndex((p) => checkPartHit(p, x, y));
	return idx >= 0 ? { kind: "part", id: parts[idx].id, index: idx } : null;
}

function hitTestVias(vias, x, y) {
	const idx = vias.findIndex((v) => checkViaHit(v, x, y));
	return idx >= 0 ? { kind: "via", index: idx, id: vias[idx].netId } : null;
}

function hitTestTracks(tracks, x, y) {
	const idx = tracks.findIndex((t) => checkTrackHit(t, x, y));
	return idx >= 0 ? { kind: "track", index: idx, id: tracks[idx].netId } : null;
}

export function hitTest(ir, board, pt) {
	const [x, y] = ptCoords(pt);
	const partHit = hitTestParts(ir?.parts ?? [], x, y);
	if (partHit) return partHit;
	const viaHit = hitTestVias(board?.vias ?? [], x, y);
	if (viaHit) return viaHit;
	return hitTestTracks(board?.tracks ?? [], x, y);
}

function isDirect45(absX, absY) {
	return absX === 0 || absY === 0 || absX === absY;
}

export function constrain45(from, to) {
	const [x0, y0] = ptCoords(from);
	const [x1, y1] = ptCoords(to);
	const dx = x1 - x0;
	const dy = y1 - y0;
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (isDirect45(absX, absY)) {
		return [[x1, y1]];
	}
	if (absX > absY) {
		const cornerX = x0 + Math.sign(dx) * (absX - absY);
		return [
			[cornerX, y0],
			[x1, y1],
		];
	}
	const cornerY = y0 + Math.sign(dy) * (absY - absX);
	return [
		[x0, cornerY],
		[x1, y1],
	];
}

function isZeroLeg(a, b) {
	return a[0] === b[0] && a[1] === b[1];
}

/** Drawable legs of a route in progress: zero-length legs dropped, index-qualified keys. */
export function routePreviewLegs(points) {
	if (!Array.isArray(points)) return [];
	const legs = [];
	for (let i = 1; i < points.length; i++) {
		const [p1, p2] = [points[i - 1], points[i]];
		if (!isZeroLeg(p1, p2)) legs.push({ key: `route_${i}`, p1, p2 });
	}
	return legs;
}

function partFootprintRef(part) {
	return part.footprint ?? part.props?.footprint;
}

/** Library footprint ids of placed parts whose fetch came back empty (cached null). */
export function missingFootprintIds(parts, embedded, cache) {
	const ids = (parts ?? [])
		.filter((p) => p.placement && !embedded?.[p.id])
		.map(partFootprintRef)
		.filter((id) => id && cache?.[id] === null);
	return [...new Set(ids)];
}
