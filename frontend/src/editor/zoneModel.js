function ptCoords(p) {
	if (Array.isArray(p)) return [p[0], p[1]];
	return [p?.x ?? 0, p?.y ?? 0];
}

function isFiniteNumber(v) {
	return typeof v === "number" && Number.isFinite(v);
}

function isFinitePoint(p) {
	if (!Array.isArray(p)) return false;
	if (p.length < 2) return false;
	return isFiniteNumber(p[0]) && isFiniteNumber(p[1]);
}

function isValidPointsList(points) {
	if (!Array.isArray(points)) return false;
	if (points.length < 3) return false;
	return points.every(isFinitePoint);
}

function isValidIndex(index, length) {
	if (typeof index !== "number") return false;
	if (!Number.isInteger(index)) return false;
	return index >= 0 && index < length;
}

function getZonePoints(zone) {
	if (Array.isArray(zone?.polygon)) return zone.polygon;
	if (Array.isArray(zone?.points)) return zone.points;
	return [];
}

function buildZone(options) {
	const isKeepout = Boolean(options.keepout);
	const polygon = options.points.map(([x, y]) => [x, y]);
	const net = isKeepout ? "" : (options.netId ?? "");
	const zone = {
		netId: net,
		layer: options.layer ?? "F.Cu",
		polygon,
	};
	if (isKeepout) {
		zone.keepout = true;
	}
	return zone;
}

export function addZone(board, options = {}) {
	const { points } = options;
	if (!isValidPointsList(points)) {
		return board;
	}
	const existing = Array.isArray(board?.zones) ? board.zones : [];
	const newZone = buildZone(options);
	return {
		...(board ?? {}),
		zones: [...existing, newZone],
	};
}

export function removeZone(board, index) {
	if (!Array.isArray(board?.zones)) return board;
	if (!isValidIndex(index, board.zones.length)) return board;
	const zones = board.zones.filter((_, i) => i !== index);
	return {
		...board,
		zones,
	};
}

function updateZonePoint(zone, pointIndex, nextCoord) {
	const pts = getZonePoints(zone);
	if (!isValidIndex(pointIndex, pts.length)) return null;
	const [x, y] = nextCoord;
	const nextPts = pts.map((p, i) => (i === pointIndex ? [x, y] : [p[0], p[1]]));
	const updated = { ...zone, polygon: nextPts };
	if (Array.isArray(zone.points)) {
		updated.points = nextPts;
	}
	return updated;
}

export function moveZonePoint(board, zoneIndex, pointIndex, coords) {
	if (!Array.isArray(board?.zones)) return board;
	if (!isValidIndex(zoneIndex, board.zones.length)) return board;
	if (!isFinitePoint(coords)) return board;
	const zone = board.zones[zoneIndex];
	const updatedZone = updateZonePoint(zone, pointIndex, coords);
	if (!updatedZone) return board;
	const zones = board.zones.map((z, i) => (i === zoneIndex ? updatedZone : z));
	return {
		...board,
		zones,
	};
}

export function rectZonePoints(p1, p2) {
	const [x1, y1] = ptCoords(p1);
	const [x2, y2] = ptCoords(p2);
	return [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
}

export function zoneArea(zone) {
	const pts = getZonePoints(zone);
	if (pts.length < 3) return 0;
	let sum = 0;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [x1, y1] = pts[j];
		const [x2, y2] = pts[i];
		sum += x1 * y2 - x2 * y1;
	}
	return Math.abs(sum) / 2;
}

function isPointOnSegment(px, py, p1, p2, eps = 1e-9) {
	const [x1, y1] = p1;
	const [x2, y2] = p2;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const cross = (px - x1) * dy - (py - y1) * dx;
	if (Math.abs(cross) > eps) return false;
	const dot = (px - x1) * dx + (py - y1) * dy;
	if (dot < -eps) return false;
	const lenSq = dx * dx + dy * dy;
	if (dot > lenSq + eps) return false;
	return true;
}

function rayCrossesEdge(px, py, p1, p2) {
	const [x1, y1] = p1;
	const [x2, y2] = p2;
	const crossesY = y1 > py !== y2 > py;
	if (!crossesY) return false;
	const xIntersect = ((x2 - x1) * (py - y1)) / (y2 - y1) + x1;
	return px < xIntersect;
}

export function pointInZone(zone, pt) {
	const pts = getZonePoints(zone);
	if (pts.length < 3) return false;
	const [px, py] = ptCoords(pt);
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		if (isPointOnSegment(px, py, pts[j], pts[i])) {
			return true;
		}
	}
	let inside = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		if (rayCrossesEdge(px, py, pts[j], pts[i])) {
			inside = !inside;
		}
	}
	return inside;
}

function validateLayer(layer) {
	if (typeof layer !== "string") {
		return "Unknown layer: layer must be a non-empty string";
	}
	if (layer.trim().length === 0) {
		return "Unknown layer: layer must be a non-empty string";
	}
	return null;
}

function validateNet(zone) {
	if (zone?.keepout) return null;
	const netId = zone?.netId;
	if (typeof netId !== "string") {
		return "Missing net on a non-keepout zone";
	}
	if (netId.trim().length === 0) {
		return "Missing net on a non-keepout zone";
	}
	return null;
}

function validatePoints(pts) {
	if (!Array.isArray(pts) || pts.length < 3) {
		return "Too few points: zone requires at least 3 points";
	}
	if (!pts.every(isFinitePoint)) {
		return "Too few points: all points must be finite coordinates";
	}
	return null;
}

export function validateZone(zone) {
	if (!zone) return "Zone is required";
	const layerProblem = validateLayer(zone.layer);
	if (layerProblem) return layerProblem;
	const netProblem = validateNet(zone);
	if (netProblem) return netProblem;
	const pts = getZonePoints(zone);
	const ptsProblem = validatePoints(pts);
	if (ptsProblem) return ptsProblem;
	if (zoneArea(zone) <= 0) {
		return "Zone has zero area";
	}
	return null;
}
