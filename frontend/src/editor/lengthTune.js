import { pathLength } from "./diffPair.js";

function ptCoords(p) {
	if (Array.isArray(p)) return [p[0], p[1]];
	return [p?.x ?? 0, p?.y ?? 0];
}

export function skewBetween(pPoints, nPoints) {
	return Math.abs(pathLength(pPoints) - pathLength(nPoints));
}

function findSegmentSpecs(points) {
	const specs = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = ptCoords(points[i]);
		const p1 = ptCoords(points[i + 1]);
		const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
		specs.push({ index: i, p0, p1, len });
	}
	return specs;
}

function planSegmentBumps(specs, needed, options) {
	const { amplitudeMm, spacingMm } = options;
	const sorted = [...specs].sort((a, b) => b.len - a.len);
	const tuned = new Map();
	let rem = needed;
	for (const seg of sorted) {
		if (rem <= 0.05) break;
		const maxBumps = Math.floor((seg.len - spacingMm) / (2 * spacingMm));
		if (maxBumps < 1) continue;
		const maxExtra = maxBumps * 2 * amplitudeMm;
		const segExtra = Math.min(rem, maxExtra);
		const count = Math.min(
			maxBumps,
			Math.max(1, Math.ceil(segExtra / (2 * amplitudeMm))),
		);
		const height = Math.min(amplitudeMm, segExtra / (2 * count));
		tuned.set(seg.index, { count, height, spacing: spacingMm });
		rem -= count * 2 * height;
	}
	return tuned;
}

function buildSegmentPoints(p0, p1, cfg) {
	if (!cfg || cfg.count < 1) return [p0, p1];
	const dx = p1[0] - p0[0];
	const dy = p1[1] - p0[1];
	const len = Math.hypot(dx, dy);
	const ux = dx / len;
	const uy = dy / len;
	const nx = -uy;
	const ny = ux;
	const { count, height, spacing } = cfg;
	const totalSpan = count * spacing + (count - 1) * spacing;
	const startT = (len - totalSpan) / 2;
	const pts = [p0];
	for (let k = 0; k < count; k++) {
		const t1 = startT + k * 2 * spacing;
		const t2 = t1 + spacing;
		const b1 = [p0[0] + t1 * ux, p0[1] + t1 * uy];
		const b2 = [b1[0] + height * nx, b1[1] + height * ny];
		const b3 = [b2[0] + spacing * ux, b2[1] + spacing * uy];
		const b4 = [p0[0] + t2 * ux, p0[1] + t2 * uy];
		pts.push(b1, b2, b3, b4);
	}
	pts.push(p1);
	return pts;
}

function stitchSegments(specs, tuned) {
	const result = [];
	for (let i = 0; i < specs.length; i++) {
		const { p0, p1, index } = specs[i];
		const segPts = buildSegmentPoints(p0, p1, tuned.get(index));
		if (i === 0) {
			result.push(...segPts);
		} else {
			result.push(...segPts.slice(1));
		}
	}
	return result;
}

export function meander(options = {}) {
	const {
		points = [],
		targetLengthMm = 0,
		amplitudeMm = 0,
		spacingMm = 0,
	} = options;
	const coords = Array.isArray(points) ? points.map(ptCoords) : [];
	const initialLen = pathLength(coords);
	if (coords.length < 2) {
		return { points: coords, lengthMm: 0, reached: targetLengthMm <= 0.05 };
	}
	if (
		amplitudeMm <= 0 ||
		spacingMm <= 0 ||
		targetLengthMm <= initialLen + 0.05
	) {
		const reached = Math.abs(initialLen - targetLengthMm) <= 0.05;
		return { points: coords, lengthMm: initialLen, reached };
	}
	const specs = findSegmentSpecs(coords);
	const opt = { amplitudeMm, spacingMm };
	const tuned = planSegmentBumps(specs, targetLengthMm - initialLen, opt);
	const newPoints = stitchSegments(specs, tuned);
	const lengthMm = pathLength(newPoints);
	return {
		points: newPoints,
		lengthMm,
		reached: Math.abs(lengthMm - targetLengthMm) <= 0.05,
	};
}
