export const LAYER_COLORS = Object.freeze({
	"F.Cu": "#c83434",
	"B.Cu": "#3b82f6",
	"F.SilkS": "#f1f5f9",
	"B.SilkS": "#c084fc",
	"Edge.Cuts": "#eab308",
	"F.Mask": "#a855f7",
	"B.Mask": "#6366f1",
});

const FOOTPRINT_SIZES = [
	{ match: /(?:^|\D)0402(?:\D|$)/i, w: 1.0, h: 0.5 },
	{ match: /(?:^|\D)0603(?:\D|$)/i, w: 1.6, h: 0.8 },
	{ match: /(?:^|\D)0805(?:\D|$)/i, w: 2.0, h: 1.25 },
	{ match: /(?:^|\D)1206(?:\D|$)/i, w: 3.2, h: 1.6 },
	{ match: /sot[-_]?23/i, w: 2.9, h: 1.3 },
	{ match: /soic[-_]?8/i, w: 4.9, h: 3.9 },
	{ match: /dip[-_]?8/i, w: 9.5, h: 6.5 },
];

function resolveFootprintSize(name) {
	if (!name) return { w: 5, h: 5 };
	const str = String(name);
	for (const entry of FOOTPRINT_SIZES) {
		if (entry.match.test(str)) {
			return { w: entry.w, h: entry.h };
		}
	}
	return { w: 5, h: 5 };
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

export function snapToGrid(v, grid = 0.25) {
	if (typeof v === "number") {
		return snapNum(v, grid);
	}
	if (Array.isArray(v)) {
		return [snapNum(v[0], grid), snapNum(v[1], grid)];
	}
	if (v && typeof v === "object" && "x" in v && "y" in v) {
		return { x: snapNum(v.x, grid), y: snapNum(v.y, grid) };
	}
	return v;
}

function ptCoords(p) {
	if (Array.isArray(p)) return [p[0], p[1]];
	return [p?.x ?? 0, p?.y ?? 0];
}

export function trackLength(track) {
	if (!track) return 0;
	if (Array.isArray(track.points) && track.points.length >= 2) {
		let total = 0;
		for (let i = 0; i < track.points.length - 1; i++) {
			const [x1, y1] = ptCoords(track.points[i]);
			const [x2, y2] = ptCoords(track.points[i + 1]);
			total += Math.hypot(x2 - x1, y2 - y1);
		}
		return total;
	}
	if (track.start && track.end) {
		const [x1, y1] = ptCoords(track.start);
		const [x2, y2] = ptCoords(track.end);
		return Math.hypot(x2 - x1, y2 - y1);
	}
	return 0;
}

export function addTrack(board, options = {}) {
	const { netId = "", layer = "F.Cu", points = [], widthMm = 0.25 } = options;
	const currentTracks = Array.isArray(board?.tracks) ? [...board.tracks] : [];
	const newSegments = [];
	for (let i = 0; i < points.length - 1; i++) {
		const [x1, y1] = ptCoords(points[i]);
		const [x2, y2] = ptCoords(points[i + 1]);
		newSegments.push({
			netId,
			layer,
			start: [x1, y1],
			end: [x2, y2],
			widthMm,
		});
	}
	return {
		...(board ?? {}),
		tracks: [...currentTracks, ...newSegments],
	};
}

export function deleteTrack(board, index) {
	const currentTracks = Array.isArray(board?.tracks) ? [...board.tracks] : [];
	if (typeof index === "number" && index >= 0 && index < currentTracks.length) {
		currentTracks.splice(index, 1);
	}
	return {
		...(board ?? {}),
		tracks: currentTracks,
	};
}

function resolvePin(pin, padPos, partMap) {
	if (typeof padPos === "function") {
		const pos = padPos(pin.partId, pin.pin);
		if (pos) return ptCoords(pos);
	}
	if (padPos && typeof padPos === "object") {
		const key = `${pin.partId}:${pin.pin}`;
		const lookup =
			padPos instanceof Map ? padPos.get(key) : padPos[pin.partId]?.[pin.pin];
		if (lookup) return ptCoords(lookup);
	}
	const part = partMap.get(pin.partId);
	if (part?.placement) {
		return [part.placement.x ?? 0, part.placement.y ?? 0];
	}
	return null;
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

function buildNetPairs(pins) {
	const pairs = [];
	for (let i = 0; i < pins.length; i++) {
		for (let j = i + 1; j < pins.length; j++) {
			const dist = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y);
			pairs.push({ u: i, v: j, dist });
		}
	}
	return pairs.sort((a, b) => a.dist - b.dist);
}

function findRoot(parent, i) {
	let curr = i;
	while (parent[curr] !== curr) {
		parent[curr] = parent[parent[curr]];
		curr = parent[curr];
	}
	return curr;
}

function unionRoots(parent, i, j) {
	const rootI = findRoot(parent, i);
	const rootJ = findRoot(parent, j);
	if (rootI === rootJ) return false;
	parent[rootI] = rootJ;
	return true;
}

function computeMstLinks(pins, net) {
	if (pins.length < 2) return [];
	const pairs = buildNetPairs(pins);
	const parent = Array.from({ length: pins.length }, (_, i) => i);
	const links = [];
	for (const pair of pairs) {
		if (unionRoots(parent, pair.u, pair.v)) {
			links.push({
				netId: net.id,
				name: net.name ?? net.id,
				from: { ...pins[pair.u] },
				to: { ...pins[pair.v] },
			});
			if (links.length === pins.length - 1) break;
		}
	}
	return links;
}

export function ratsnest(ir, padPos) {
	if (!Array.isArray(ir?.nets)) return [];
	const partMap = new Map((ir?.parts ?? []).map((p) => [p.id, p]));
	const links = [];
	for (const net of ir.nets) {
		const pins = collectPinsWithPos(net, padPos, partMap);
		const netLinks = computeMstLinks(pins, net);
		links.push(...netLinks);
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

function distToSegment(px, py, s, e) {
	const dx = e[0] - s[0];
	const dy = e[1] - s[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(px - s[0], py - s[1]);
	const t = Math.max(
		0,
		Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / lenSq),
	);
	return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

function hitTestParts(parts, x, y) {
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.placement && pointInPart(x, y, p)) {
			return { kind: "part", id: p.id, index: i };
		}
	}
	return null;
}

function hitTestVias(vias, x, y) {
	for (let i = 0; i < vias.length; i++) {
		const v = vias[i];
		const [vx, vy] = ptCoords(v.at);
		const radius = Math.max(0.6, (v.sizeMm ?? 0.8) / 2);
		if (Math.hypot(x - vx, y - vy) <= radius) {
			return { kind: "via", index: i, id: v.netId };
		}
	}
	return null;
}

function hitTestTracks(tracks, x, y) {
	for (let i = 0; i < tracks.length; i++) {
		const t = tracks[i];
		const s = ptCoords(t.start);
		const e = ptCoords(t.end);
		const tol = Math.max(0.5, (t.widthMm ?? 0.25) / 2 + 0.3);
		if (distToSegment(x, y, s, e) <= tol) {
			return { kind: "track", index: i, id: t.netId };
		}
	}
	return null;
}

export function hitTest(ir, board, pt) {
	const [x, y] = ptCoords(pt);
	const partHit = hitTestParts(ir?.parts ?? [], x, y);
	if (partHit) return partHit;
	const viaHit = hitTestVias(board?.vias ?? [], x, y);
	if (viaHit) return viaHit;
	return hitTestTracks(board?.tracks ?? [], x, y);
}

export function constrain45(from, to) {
	const [x0, y0] = ptCoords(from);
	const [x1, y1] = ptCoords(to);
	const dx = x1 - x0;
	const dy = y1 - y0;
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (absX === 0 || absY === 0 || absX === absY) {
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
