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

function parsePoint(p) {
	if (Array.isArray(p)) return [p[0] ?? 0, p[1] ?? 0, 0];
	return [p?.x ?? 0, p?.y ?? 0, 0];
}

function trackToSegment(t) {
	const netId = t?.netId ?? "";
	const widthMm = t?.widthMm ?? 0.25;
	if (Array.isArray(t?.points) && t.points.length >= 2) {
		return { netId, points: t.points.map(parsePoint), widthMm };
	}
	if (t?.start && t?.end) {
		return {
			netId,
			points: [parsePoint(t.start), parsePoint(t.end)],
			widthMm,
		};
	}
	return null;
}

function tracksToSegments(tracks) {
	const segments = [];
	for (const t of tracks) {
		const seg = trackToSegment(t);
		if (seg) segments.push(seg);
	}
	return segments;
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
	if (Array.isArray(tracks) && tracks.length > 0) {
		return tracksToSegments(tracks);
	}
	return ratsnestSegments(ir);
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
