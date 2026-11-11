const PITCH = 2.54;
const DEFAULT_WIDTH = 15.24;

function roundGrid(num, grid) {
	const snapped = Math.round(num / grid) * grid;
	return Math.round(snapped * 1e6) / 1e6;
}

export function snapToGrid(v, grid = 1.27) {
	if (typeof v === "number") {
		return roundGrid(v, grid);
	}
	if (Array.isArray(v)) {
		return [roundGrid(v[0], grid), roundGrid(v[1], grid)];
	}
	if (v && typeof v === "object") {
		return { x: roundGrid(v.x, grid), y: roundGrid(v.y, grid) };
	}
	return v;
}

export function partBox(part, pinCount) {
	const count =
		typeof pinCount === "number" ? pinCount : (part?.pins?.length ?? 2);
	const rows = Math.max(1, Math.ceil(count / 2));
	const width = part?.props?.sizeMm?.w ?? DEFAULT_WIDTH;
	const height = (rows + 1) * PITCH;
	const px = part?.placement?.x ?? 0;
	const py = part?.placement?.y ?? 0;
	return {
		x: px - width / 2,
		y: py - height / 2,
		width,
		height,
		w: width,
		h: height,
		cx: px,
		cy: py,
		rot: part?.placement?.rot ?? 0,
		side: part?.placement?.side ?? "F",
	};
}

function resolvePinList(pinNumbers, part) {
	if (typeof pinNumbers === "number") {
		return Array.from({ length: pinNumbers }, (_, i) => i + 1);
	}
	if (Array.isArray(pinNumbers) && pinNumbers.length > 0) {
		return pinNumbers;
	}
	if (Array.isArray(part?.pins) && part.pins.length > 0) {
		return part.pins;
	}
	return [1, 2];
}

function computeLocalPin(pin, totalRows, halfW) {
	const n = Number.parseInt(pin, 10);
	const validN = Number.isFinite(n) && n > 0 ? n : 1;
	const isOdd = validN % 2 !== 0;
	const row = Math.floor((validN - 1) / 2);
	const lx = isOdd ? -halfW : halfW;
	const ly = (row - (totalRows - 1) / 2) * PITCH;
	return { lx, ly };
}

function rotatePin(lx, ly, rot, side) {
	const flippedX = side === "B" ? -lx : lx;
	const rad = (rot * Math.PI) / 180;
	const cos = Math.round(Math.cos(rad));
	const sin = Math.round(Math.sin(rad));
	const rx = flippedX * cos - ly * sin;
	const ry = flippedX * sin + ly * cos;
	return [rx, ry];
}

export function pinPositions(part, pinNumbers) {
	const pins = resolvePinList(pinNumbers, part);
	const numList = pins
		.map((p) => Number.parseInt(p, 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	const maxPin = numList.length > 0 ? Math.max(...numList) : pins.length;
	const totalRows = Math.max(1, Math.ceil(maxPin / 2));
	const box = partBox(part, totalRows * 2);
	const halfW = box.width / 2;
	const { cx: px, cy: py, rot, side } = box;

	const map = new Map();
	for (const p of pins) {
		const { lx, ly } = computeLocalPin(p, totalRows, halfW);
		const [rx, ry] = rotatePin(lx, ly, rot, side);
		const pos = [
			Math.round((px + rx) * 1e6) / 1e6,
			Math.round((py + ry) * 1e6) / 1e6,
		];
		map.set(p, pos);
		map.set(String(p), pos);
		map[p] = pos;
		map[String(p)] = pos;
	}
	return map;
}

function resolvePinCoord(pinRef, pinPos) {
	if (!pinRef) return null;
	if (Array.isArray(pinRef)) return pinRef;
	const partId = pinRef.partId ?? pinRef.part;
	const pin = pinRef.pin ?? pinRef.number;
	if (typeof pinPos === "function") return pinPos(partId, pin);
	if (!pinPos) return null;
	const key = `${partId}:${pin}`;
	if (pinPos instanceof Map) {
		return pinPos.get(key) ?? pinPos.get(partId)?.[pin] ?? null;
	}
	return pinPos[key] ?? pinPos[partId]?.[pin] ?? null;
}

function createLPolyline(p1, p2) {
	const [x1, y1] = p1;
	const [x2, y2] = p2;
	if (x1 === x2 || y1 === y2) {
		return [p1, p2];
	}
	return [p1, [x2, y1], p2];
}

function findClosestUnvisited(visited, points) {
	let bestDist = Infinity;
	let bestPair = null;
	for (const u of visited) {
		for (let v = 0; v < points.length; v++) {
			if (visited.has(v)) continue;
			const dist =
				Math.abs(points[u][0] - points[v][0]) +
				Math.abs(points[u][1] - points[v][1]);
			if (dist < bestDist) {
				bestDist = dist;
				bestPair = [u, v];
			}
		}
	}
	return bestPair;
}

function buildSpanningTree(points) {
	const polylines = [];
	const visited = new Set([0]);
	while (visited.size < points.length) {
		const pair = findClosestUnvisited(visited, points);
		if (!pair) break;
		visited.add(pair[1]);
		polylines.push(createLPolyline(points[pair[0]], points[pair[1]]));
	}
	return polylines;
}

export function wireForNet(net, pinPos) {
	const rawPins = net?.pins ?? [];
	const points = [];
	for (const p of rawPins) {
		const pt = resolvePinCoord(p, pinPos);
		if (pt) points.push(pt);
	}
	if (points.length <= 1) return [];
	if (points.length === 2) return [createLPolyline(points[0], points[1])];
	return buildSpanningTree(points);
}

function collectPartPins(part, nets) {
	const pins = new Set();
	if (Array.isArray(part?.pins)) {
		for (const p of part.pins) {
			pins.add(typeof p === "object" ? (p.number ?? p.pin) : p);
		}
	}
	for (const net of nets) {
		for (const p of net?.pins ?? []) {
			if (p.partId === part?.id) pins.add(p.pin);
		}
	}
	if (pins.size === 0) {
		const count = part?.props?.pinCount ?? 2;
		for (let i = 1; i <= count; i++) pins.add(String(i));
	}
	return Array.from(pins);
}

function testPinHit(part, nets, pt, pinRadius) {
	const pins = collectPartPins(part, nets);
	const posMap = pinPositions(part, pins);
	for (const [pin, pos] of posMap.entries()) {
		if (Math.hypot(pt[0] - pos[0], pt[1] - pos[1]) <= pinRadius) {
			return { kind: "pin", id: part.id, pin: String(pin) };
		}
	}
	return null;
}

function distToSegment(pt, p1, p2) {
	const dx = p2[0] - p1[0];
	const dy = p2[1] - p1[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(pt[0] - p1[0], pt[1] - p1[1]);
	const t = Math.max(
		0,
		Math.min(1, ((pt[0] - p1[0]) * dx + (pt[1] - p1[1]) * dy) / lenSq),
	);
	return Math.hypot(pt[0] - (p1[0] + t * dx), pt[1] - (p1[1] + t * dy));
}

function testWireHit(net, allPinPos, pt, wireTol) {
	const polylines = wireForNet(net, allPinPos);
	for (const poly of polylines) {
		for (let i = 0; i < poly.length - 1; i++) {
			if (distToSegment(pt, poly[i], poly[i + 1]) <= wireTol) {
				return { kind: "wire", id: net.id };
			}
		}
	}
	return null;
}

function testPartHit(part, pt) {
	const box = partBox(part);
	const dx = pt[0] - box.cx;
	const dy = pt[1] - box.cy;
	const rad = (-box.rot * Math.PI) / 180;
	const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
	const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
	if (Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2) {
		return { kind: "part", id: part.id };
	}
	return null;
}

function buildAllPinPos(parts, nets) {
	const map = new Map();
	for (const part of parts) {
		const pins = collectPartPins(part, nets);
		const positions = pinPositions(part, pins);
		for (const [pin, pos] of positions.entries()) {
			map.set(`${part.id}:${pin}`, pos);
		}
	}
	return map;
}

export function hitTest(doc, pt, options = {}) {
	const pinRadius = options.pinRadius ?? 2.0;
	const wireTol = options.wireTol ?? 1.27;
	const ir = doc?.ir ?? doc ?? {};
	const parts = ir.parts ?? [];
	const nets = ir.nets ?? [];

	for (const part of parts) {
		const hit = testPinHit(part, nets, pt, pinRadius);
		if (hit) return hit;
	}
	const allPinPos = buildAllPinPos(parts, nets);
	for (const net of nets) {
		const hit = testWireHit(net, allPinPos, pt, wireTol);
		if (hit) return hit;
	}
	for (const part of parts) {
		const hit = testPartHit(part, pt);
		if (hit) return hit;
	}
	return null;
}
