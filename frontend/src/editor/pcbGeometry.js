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
		.map((t) => ({ net: NET_KEY, start: toXY(t.start), end: toXY(t.end) }));
}

function netAirlines(net, pins, tracks) {
	const pads = pins.map((p, i) => ({ id: i, net: NET_KEY, x: p.x, y: p.y }));
	return pureRatsnest(pads, pureTracksOfNet(tracks, net.id)).map((a) => ({
		netId: net.id,
		name: net.name ?? net.id,
		from: { ...pins[a.from] },
		to: { ...pins[a.to] },
	}));
}

export function ratsnest(ir, padPos, tracks = []) {
	if (!Array.isArray(ir?.nets)) return [];
	const partMap = new Map((ir?.parts ?? []).map((p) => [p.id, p]));
	const links = [];
	for (const net of ir.nets) {
		const pins = collectPinsWithPos(net, padPos, partMap);
		links.push(...netAirlines(net, pins, tracks));
	}
	return links;
}

function pointInPart(x, y, part) {
	const rect = footprintRect(part);
	if (!rect) return false;
	const rad = (-rect.rot * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const dx = x - rect.x;
	const dy = y - rect.y;
	const lx = dx * cos - dy * sin;
	const ly = dx * sin + dy * cos;
	return Math.abs(lx) <= rect.w / 2 && Math.abs(ly) <= rect.h / 2;
}

function distToSegment(px, py, start, end) {
	const [sx, sy] = start;
	const [ex, ey] = end;
	const segX = ex - sx;
	const segY = ey - sy;
	const sqLen = segX ** 2 + segY ** 2;
	if (!sqLen) return Math.hypot(px - sx, py - sy);
	const dot = (px - sx) * segX + (py - sy) * segY;
	const frac = Math.max(0, Math.min(1, dot / sqLen));
	const projX = sx + frac * segX;
	const projY = sy + frac * segY;
	return Math.hypot(px - projX, py - projY);
}

function checkPartHit(p, x, y) {
	return Boolean(p.placement && pointInPart(x, y, p));
}

function checkViaHit(v, x, y) {
	const [vx, vy] = ptCoords(v.at);
	const radius = Math.max(0.6, (v.sizeMm ?? 0.8) / 2);
	return Math.hypot(x - vx, y - vy) <= radius;
}

function checkTrackHit(t, x, y) {
	const tol = Math.max(0.5, (t.widthMm ?? 0.25) / 2 + 0.3);
	return distToSegment(x, y, ptCoords(t.start), ptCoords(t.end)) <= tol;
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
