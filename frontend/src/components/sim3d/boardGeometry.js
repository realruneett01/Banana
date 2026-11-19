function getPartMaxCoords(part) {
	const pl = part?.placement ?? (typeof part?.x === "number" ? part : null);
	if (!pl || typeof pl.x !== "number" || typeof pl.y !== "number") {
		return null;
	}
	const hw = (part.props?.sizeMm?.w ?? 0) / 2;
	const hh = (part.props?.sizeMm?.h ?? 0) / 2;
	return { x: pl.x + hw, y: pl.y + hh };
}

export function boardSize(ir) {
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	let maxX = 0;
	let maxY = 0;
	let hasPlaced = false;
	for (const p of parts) {
		const coords = getPartMaxCoords(p);
		if (coords) {
			hasPlaced = true;
			if (coords.x > maxX) maxX = coords.x;
			if (coords.y > maxY) maxY = coords.y;
		}
	}
	if (!hasPlaced) {
		return { width: 20, height: 20, w: 20, h: 20, boardW: 20, boardH: 20 };
	}
	const width = Math.max(20, Math.round((maxX + 5) * 10) / 10);
	const height = Math.max(20, Math.round((maxY + 5) * 10) / 10);
	return { width, height, w: width, h: height, boardW: width, boardH: height };
}

export const BOARD_THICKNESS = 1.6;

function isBackLayer(layer) {
	return typeof layer === "string" && layer.toLowerCase().startsWith("b");
}

function layerZ(layer) {
	return isBackLayer(layer) ? -BOARD_THICKNESS : 0;
}

function toFiniteCoord(val) {
	if (typeof val !== "number") return null;
	return Number.isFinite(val) ? val : null;
}

function parsePointWithZ(p, z) {
	const rawX = Array.isArray(p) ? p[0] : p?.x;
	const rawY = Array.isArray(p) ? p[1] : p?.y;
	const x = toFiniteCoord(rawX);
	const y = toFiniteCoord(rawY);
	if (x === null || y === null) return null;
	return [x, y, z];
}

function extractPointsList(points, z) {
	const pts = [];
	for (const p of points) {
		const pt = parsePointWithZ(p, z);
		if (!pt) return null;
		pts.push(pt);
	}
	return pts;
}

function extractTrackPoints(t, z) {
	if (Array.isArray(t?.points) && t.points.length >= 2) {
		return extractPointsList(t.points, z);
	}
	if (t?.start && t?.end) {
		const p1 = parsePointWithZ(t.start, z);
		const p2 = parsePointWithZ(t.end, z);
		return p1 && p2 ? [p1, p2] : null;
	}
	return null;
}

function isValidNetId(id) {
	if (typeof id === "string") return id.length > 0;
	return typeof id === "number" && Number.isFinite(id);
}

function isKnownNet(id, knownNets) {
	if (!isValidNetId(id)) return false;
	return knownNets ? knownNets.has(id) : true;
}

function splitIntoPairs(pts, meta) {
	const segs = [];
	for (let i = 0; i < pts.length - 1; i++) {
		segs.push({
			netId: meta.netId,
			points: [pts[i], pts[i + 1]],
			widthMm: meta.widthMm,
		});
	}
	return segs;
}

function parseTrackSegment(t, knownNets) {
	if (!isKnownNet(t?.netId, knownNets)) return null;
	const z = layerZ(t?.layer);
	const points = extractTrackPoints(t, z);
	if (!points) return null;
	const rawWidth = t?.widthMm ?? t?.width;
	const widthMm = toFiniteCoord(rawWidth) ?? 0.25;
	return { netId: t.netId, points, widthMm };
}

function viaCoords(v) {
	if (v?.at) return v.at;
	if (typeof v?.x === "number" && typeof v?.y === "number") {
		return [v.x, v.y];
	}
	return null;
}

function parseViaSegment(v, knownNets) {
	if (!isKnownNet(v?.netId, knownNets)) return null;
	const at = viaCoords(v);
	const pTop = parsePointWithZ(at, 0);
	const pBot = parsePointWithZ(at, -BOARD_THICKNESS);
	if (!pTop || !pBot) return null;
	const rawWidth = v?.widthMm ?? v?.sizeMm;
	const widthMm = toFiniteCoord(rawWidth) ?? 0.25;
	return { netId: v.netId, points: [pTop, pBot], widthMm };
}

function dist3d(p1, p2) {
	const dx = p1[0] - p2[0];
	const dy = p1[1] - p2[1];
	const dz = p1[2] - p2[2];
	return Math.hypot(dx, dy, dz);
}

function sharePt(p1, p2) {
	return dist3d(p1, p2) <= 0.01;
}

function tryAttach(pts, segPts) {
	const head = pts[0];
	const tail = pts[pts.length - 1];
	const [s0, s1] = segPts;
	if (sharePt(tail, s0)) {
		pts.push(s1);
		return true;
	}
	if (sharePt(tail, s1)) {
		pts.push(s0);
		return true;
	}
	if (sharePt(head, s1)) {
		pts.unshift(s0);
		return true;
	}
	if (sharePt(head, s0)) {
		pts.unshift(s1);
		return true;
	}
	return false;
}

function extendPolylineOnce(pts, remaining) {
	for (let i = 0; i < remaining.length; i++) {
		if (tryAttach(pts, remaining[i].points)) {
			const [attached] = remaining.splice(i, 1);
			return attached;
		}
	}
	return null;
}

function growPolyline(seed, remaining) {
	const pts = [...seed.points];
	let widthMm = seed.widthMm;
	while (true) {
		const attached = extendPolylineOnce(pts, remaining);
		if (!attached) break;
		widthMm = widthMm || attached.widthMm;
	}
	return { points: pts, widthMm };
}

function assembleNetPolylines(netId, segs) {
	const remaining = [...segs];
	const polylines = [];
	while (remaining.length > 0) {
		const seed = remaining.shift();
		const { points, widthMm } = growPolyline(seed, remaining);
		polylines.push({
			netId,
			points,
			widthMm,
			width: widthMm,
			real: true,
		});
	}
	return polylines;
}

function buildKnownNets(ir) {
	if (!Array.isArray(ir?.nets) || ir.nets.length === 0) {
		return null;
	}
	const set = new Set();
	for (const net of ir.nets) {
		if (isValidNetId(net?.id)) set.add(net.id);
	}
	return set;
}

function addSegsToMap(map, segs) {
	for (const seg of segs) {
		if (!map.has(seg.netId)) map.set(seg.netId, []);
		map.get(seg.netId).push(seg);
	}
}

function collectBoardSegments(board, knownNets) {
	const map = new Map();
	for (const t of board?.tracks ?? []) {
		const seg = parseTrackSegment(t, knownNets);
		if (seg) addSegsToMap(map, splitIntoPairs(seg.points, seg));
	}
	for (const v of board?.vias ?? []) {
		const seg = parseViaSegment(v, knownNets);
		if (seg) addSegsToMap(map, [seg]);
	}
	return map;
}

function appendSyntheticNets(ir, routedNetIds, results) {
	const nets = Array.isArray(ir?.nets) ? ir.nets : [];
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const partMap = new Map(parts.map((p) => [p.id, p]));
	for (const net of nets) {
		if (!routedNetIds.has(net.id)) {
			const centres = netPartCentres(net, partMap);
			results.push(...centresToSegments(net.id, centres));
		}
	}
}

function netPartCentres(net, partMap) {
	const seen = new Set();
	const centres = [];
	for (const pin of net.pins ?? []) {
		if (!pin.partId || seen.has(pin.partId)) continue;
		seen.add(pin.partId);
		const part = partMap.get(pin.partId);
		const pl = part?.placement ?? (typeof part?.x === "number" ? part : null);
		if (typeof pl?.x !== "number" || typeof pl?.y !== "number") continue;
		centres.push([pl.x, pl.y, 0]);
	}
	return centres.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
}

function centresToSegments(netId, centres) {
	const segs = [];
	for (let i = 0; i < centres.length - 1; i++) {
		segs.push({
			netId,
			points: [centres[i], centres[i + 1]],
			widthMm: 0.25,
		});
	}
	return segs;
}

function ratsnestSegments(ir) {
	const nets = Array.isArray(ir?.nets) ? ir.nets : [];
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const partMap = new Map(parts.map((p) => [p.id, p]));
	const segments = [];
	for (const net of nets) {
		const centres = netPartCentres(net, partMap);
		const segs = centresToSegments(net.id, centres);
		segments.push(...segs);
	}
	return segments;
}

export function netSegments(ir, board) {
	const tracks = board?.tracks;
	if (!Array.isArray(tracks) || tracks.length === 0) {
		return ratsnestSegments(ir);
	}
	const knownNets = buildKnownNets(ir);
	const segsByNet = collectBoardSegments(board, knownNets);
	const results = [];
	const routedNets = new Set();
	for (const [netId, segs] of segsByNet) {
		routedNets.add(netId);
		results.push(...assembleNetPolylines(netId, segs));
	}
	appendSyntheticNets(ir, routedNets, results);
	return results;
}

function computeNetCurrent(net, partCurrents) {
	let maxAbs = 0;
	let sign = 1;
	let hasSign = false;
	for (const pin of net.pins ?? []) {
		if (!pin.partId) continue;
		const current = partCurrents?.[pin.partId];
		if (typeof current !== "number" || Number.isNaN(current)) continue;
		if (!hasSign) {
			sign = current < 0 ? -1 : 1;
			hasSign = true;
		}
		const abs = Math.abs(current);
		if (abs > maxAbs) maxAbs = abs;
	}
	return sign * maxAbs;
}

export function netCurrentsFromParts(ir, partCurrents) {
	const nets = Array.isArray(ir?.nets) ? ir.nets : [];
	const result = {};
	for (const net of nets) {
		result[net.id] = computeNetCurrent(net, partCurrents);
	}
	return result;
}

function buildPartToNetsMap(nets) {
	const map = new Map();
	for (const net of nets ?? []) {
		for (const pin of net.pins ?? []) {
			if (!pin.partId) continue;
			if (!map.has(pin.partId)) map.set(pin.partId, []);
			map.get(pin.partId).push(net);
		}
	}
	return map;
}

function resolveNetVoltage(net, nodeVoltages) {
	if (!net || !nodeVoltages) return null;
	const v = nodeVoltages[net.id] ?? nodeVoltages[net.name];
	return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function calcPartPower(part, partNets, partCurrents, nodeVoltages) {
	const nets = partNets.get(part.id);
	if (nets?.length !== 2) return null;
	const v0 = resolveNetVoltage(nets[0], nodeVoltages);
	const v1 = resolveNetVoltage(nets[1], nodeVoltages);
	if (v0 === null || v1 === null) return null;
	const current = Number(
		partCurrents?.[part.id] ?? partCurrents?.[part.ref] ?? 0,
	);
	return Math.abs(current * (v0 - v1));
}

export function partPowers(ir, partCurrents, nodeVoltages) {
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const nets = Array.isArray(ir?.nets) ? ir.nets : [];
	const partNets = buildPartToNetsMap(nets);
	const powers = {};
	for (const part of parts) {
		const power = calcPartPower(part, partNets, partCurrents, nodeVoltages);
		if (power !== null) {
			powers[part.id] = power;
		}
	}
	return powers;
}
