const EPS = 1e-6;

function key(x, y) {
	return `${x},${y}`;
}

/** Collect all wire endpoints as {x,y} objects. */
function collectEndpoints(wires) {
	const pts = [];
	for (const { a, b } of wires) {
		pts.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
	}
	return pts;
}

/**
 * Count how many times each point (wire end or pin) appears as an endpoint.
 * Returns a Map<key, {x,y,count}>.
 */
function countEndpoints(endpoints, pinPoints) {
	const map = new Map();
	for (const { x, y } of [...endpoints, ...pinPoints]) {
		const k = key(x, y);
		const entry = map.get(k) ?? { x, y, count: 0 };
		entry.count += 1;
		map.set(k, entry);
	}
	return map;
}

/**
 * Return t in (0,1) if pt lies strictly inside segment (a,b), else null.
 * Handles axis-aligned and 45-degree segments.
 */
function strictInsideT(pt, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq < EPS * EPS) return null;
	const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
	if (t <= EPS || t >= 1 - EPS) return null;
	const cx = a.x + t * dx;
	const cy = a.y + t * dy;
	if (Math.abs(cx - pt.x) > EPS || Math.abs(cy - pt.y) > EPS) return null;
	return t;
}

/** Check if pt is strictly inside any wire. */
function isStrictlyInsideAnyWire(pt, wires) {
	for (const { a, b } of wires) {
		if (strictInsideT(pt, a, b) !== null) return true;
	}
	return false;
}

/**
 * Export junction points for schematic wires.
 * @param {Array<{a:{x,y},b:{x,y}}>} wires
 * @param {Array<{x,y}>} pinPoints
 * @returns {Array<{x,y}>} sorted by x then y
 */
export function junctionPoints(wires, pinPoints) {
	const endpoints = collectEndpoints(wires);
	const counts = countEndpoints(endpoints, pinPoints);
	const junctions = new Map();

	for (const [k, { x, y, count }] of counts) {
		if (count >= 3) {
			junctions.set(k, { x, y });
			continue;
		}
		if (count >= 2 && isStrictlyInsideAnyWire({ x, y }, wires)) {
			junctions.set(k, { x, y });
			continue;
		}
		if (count === 1 && isStrictlyInsideAnyWire({ x, y }, wires)) {
			// single endpoint lying strictly inside another wire: needs a junction
			// only if it's also an endpoint of at least one wire (count>=1 is endpoint)
			junctions.set(k, { x, y });
		}
	}

	return [...junctions.values()].sort((a, b) => a.x - b.x || a.y - b.y);
}
