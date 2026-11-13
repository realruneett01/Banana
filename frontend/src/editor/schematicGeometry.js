const PITCH = 2.54;
const DEFAULT_WIDTH = 15.24;

function roundGrid(num, grid) {
	const snapped = Math.round(num / grid) * grid;
	return Math.round(snapped * 1e6) / 1e6;
}

export function snapToGrid(v, grid = 1.27) {
	const snap = (n) => roundGrid(n, grid);
	if (typeof v === "number") return snap(v);
	if (Array.isArray(v)) return v.map(snap);
	if (v && typeof v === "object") {
		return { x: snap(v.x), y: snap(v.y) };
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

function storePinPosition(map, pin, coord) {
	const pos = [
		Math.round(coord[0] * 1e6) / 1e6,
		Math.round(coord[1] * 1e6) / 1e6,
	];
	const sPin = String(pin);
	map.set(pin, pos);
	map.set(sPin, pos);
	map[pin] = pos;
	map[sPin] = pos;
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
		storePinPosition(map, p, [px + rx, py + ry]);
	}
	return map;
}

function lookupPinPos(pinPos, partId, pin) {
	const key = `${partId}:${pin}`;
	if (pinPos instanceof Map) {
		return pinPos.get(key) ?? pinPos.get(partId)?.[pin] ?? null;
	}
	return pinPos[key] ?? pinPos[partId]?.[pin] ?? null;
}

function resolvePinCoord(pinRef, pinPos) {
	if (!pinRef) return null;
	if (Array.isArray(pinRef)) return pinRef;
	const partId = pinRef.partId ?? pinRef.part;
	const pin = pinRef.pin ?? pinRef.number;
	if (typeof pinPos === "function") return pinPos(partId, pin);
	return pinPos ? lookupPinPos(pinPos, partId, pin) : null;
}

function createLPolyline(p1, p2) {
	const [x1, y1] = p1;
	const [x2, y2] = p2;
	if (x1 === x2 || y1 === y2) {
		return [p1, p2];
	}
	return [p1, [x2, y1], p2];
}

function findBestPointForVisited(u, points, visited, currentBest) {
	let { bestDist, bestPair } = currentBest;
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
	return { bestDist, bestPair };
}

function findClosestUnvisited(visited, points) {
	let best = { bestDist: Infinity, bestPair: null };
	for (const u of visited) {
		best = findBestPointForVisited(u, points, visited, best);
	}
	return best.bestPair;
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

function addDeclaredPins(pins, partPins) {
	if (!Array.isArray(partPins)) return;
	for (const p of partPins) {
		pins.add(typeof p === "object" && p !== null ? (p.number ?? p.pin) : p);
	}
}

function addNetPins(pins, nets, partId) {
	const pinList = nets.flatMap((n) => n?.pins ?? []);
	for (const p of pinList) {
		if (p.partId === partId) pins.add(p.pin);
	}
}

function addDefaultPins(pins, count) {
	for (let i = 1; i <= count; i++) {
		pins.add(String(i));
	}
}

function collectPartPins(part, nets) {
	const pins = new Set();
	addDeclaredPins(pins, part?.pins);
	addNetPins(pins, nets, part?.id);
	if (pins.size === 0) {
		addDefaultPins(pins, part?.props?.pinCount ?? 2);
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
	const [px, py] = pt;
	const [x1, y1] = p1;
	const [x2, y2] = p2;
	const segX = x2 - x1;
	const segY = y2 - y1;
	const segLenSq = segX ** 2 + segY ** 2;
	if (segLenSq === 0) return Math.hypot(px - x1, py - y1);
	const proj = ((px - x1) * segX + (py - y1) * segY) / segLenSq;
	const clampT = Math.max(0, Math.min(1, proj));
	return Math.hypot(px - (x1 + clampT * segX), py - (y1 + clampT * segY));
}

function testPolylineHit(poly, pt, wireTol) {
	for (let i = 0; i < poly.length - 1; i++) {
		if (distToSegment(pt, poly[i], poly[i + 1]) <= wireTol) {
			return true;
		}
	}
	return false;
}

function testWireHit(net, allPinPos, pt, wireTol) {
	const polylines = wireForNet(net, allPinPos);
	for (const poly of polylines) {
		if (testPolylineHit(poly, pt, wireTol)) {
			return { kind: "wire", id: net.id };
		}
	}
	return null;
}

function testPartHit(part, pt) {
	const box = partBox(part);
	const angle = (-box.rot * Math.PI) / 180;
	const ox = pt[0] - box.cx;
	const oy = pt[1] - box.cy;
	const lx = ox * Math.cos(angle) - oy * Math.sin(angle);
	const ly = ox * Math.sin(angle) + oy * Math.cos(angle);
	if (Math.abs(lx) <= box.width / 2 && Math.abs(ly) <= box.height / 2) {
		return { kind: "part", id: part.id };
	}
	return null;
}

function addPartPinPositions(map, part, nets) {
	const pins = collectPartPins(part, nets);
	const positions = pinPositions(part, pins);
	for (const [pin, pos] of positions.entries()) {
		map.set(`${part.id}:${pin}`, pos);
	}
}

export function buildAllPinPos(parts, nets) {
	const map = new Map();
	for (const part of parts) {
		addPartPinPositions(map, part, nets);
	}
	return map;
}

function findFirstHit(items, testFn) {
	for (const item of items) {
		const hit = testFn(item);
		if (hit) return hit;
	}
	return null;
}

export function hitTest(doc, pt, options = {}) {
	const pinRadius = options.pinRadius ?? 2.0;
	const wireTol = options.wireTol ?? 1.27;
	const ir = doc?.ir ?? doc ?? {};
	const parts = ir.parts ?? [];
	const nets = ir.nets ?? [];

	const pinHit = findFirstHit(parts, (p) => testPinHit(p, nets, pt, pinRadius));
	if (pinHit) return pinHit;

	const allPinPos = buildAllPinPos(parts, nets);
	const wireHit = findFirstHit(nets, (n) =>
		testWireHit(n, allPinPos, pt, wireTol),
	);
	if (wireHit) return wireHit;

	return findFirstHit(parts, (p) => testPartHit(p, pt));
}
