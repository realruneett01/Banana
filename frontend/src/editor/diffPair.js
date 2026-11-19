function ptCoords(p) {
	if (Array.isArray(p)) return [p[0], p[1]];
	return [p?.x ?? 0, p?.y ?? 0];
}

const SUFFIX_PAIRS = Object.freeze([
	{ match: /^(.+)\+$/, replace: (b) => `${b}-` },
	{ match: /^(.+)-$/, replace: (b) => `${b}+` },
	{ match: /^(.+)_P$/, replace: (b) => `${b}_N` },
	{ match: /^(.+)_p$/, replace: (b) => `${b}_n` },
	{ match: /^(.+)_N$/, replace: (b) => `${b}_P` },
	{ match: /^(.+)_n$/, replace: (b) => `${b}_p` },
	{ match: /^(.+)P$/, replace: (b) => `${b}N` },
	{ match: /^(.+)p$/, replace: (b) => `${b}n` },
	{ match: /^(.+)N$/, replace: (b) => `${b}P` },
	{ match: /^(.+)n$/, replace: (b) => `${b}p` },
]);

export function partnerNetName(name) {
	if (typeof name !== "string" || name.length < 2) return null;
	for (const { match, replace } of SUFFIX_PAIRS) {
		const m = name.match(match);
		if (m) return replace(m[1]);
	}
	return null;
}

export function isDiffPairName(name) {
	return Boolean(partnerNetName(name));
}

export function pathLength(points) {
	if (!Array.isArray(points) || points.length < 2) return 0;
	let total = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const [x0, y0] = ptCoords(points[i]);
		const [x1, y1] = ptCoords(points[i + 1]);
		total += Math.hypot(x1 - x0, y1 - y0);
	}
	return total;
}

function filterDegenerate(points) {
	const result = [];
	for (const p of points) {
		const coords = ptCoords(p);
		if (result.length === 0) {
			result.push(coords);
			continue;
		}
		const prev = result[result.length - 1];
		if (Math.hypot(coords[0] - prev[0], coords[1] - prev[1]) > 1e-9) {
			result.push(coords);
		}
	}
	return result;
}

function computeSegmentDirs(points) {
	const dirs = [];
	for (let i = 0; i < points.length - 1; i++) {
		const [x0, y0] = points[i];
		const [x1, y1] = points[i + 1];
		const dx = x1 - x0;
		const dy = y1 - y0;
		const len = Math.hypot(dx, dy);
		const ux = dx / len;
		const uy = dy / len;
		dirs.push({ u: [ux, uy], n: [-uy, ux] });
	}
	return dirs;
}

function cornerOffset(pt, dir0, dir1, dist) {
	const dot = dir0.u[0] * dir1.u[0] + dir0.u[1] * dir1.u[1];
	const denom = 1 + dot;
	if (denom < 1e-6) {
		return [pt[0] + dist * dir0.n[0], pt[1] + dist * dir0.n[1]];
	}
	const nx = dir0.n[0] + dir1.n[0];
	const ny = dir0.n[1] + dir1.n[1];
	const scale = dist / denom;
	return [pt[0] + scale * nx, pt[1] + scale * ny];
}

export function offsetPath(points, distanceMm) {
	if (!Array.isArray(points) || points.length === 0) return [];
	const clean = filterDegenerate(points);
	if (clean.length < 2) return clean.map((p) => [...p]);
	const dirs = computeSegmentDirs(clean);
	const result = [
		[
			clean[0][0] + distanceMm * dirs[0].n[0],
			clean[0][1] + distanceMm * dirs[0].n[1],
		],
	];
	for (let i = 1; i < clean.length - 1; i++) {
		result.push(cornerOffset(clean[i], dirs[i - 1], dirs[i], distanceMm));
	}
	const lastIdx = clean.length - 1;
	const lastDir = dirs[dirs.length - 1];
	result.push([
		clean[lastIdx][0] + distanceMm * lastDir.n[0],
		clean[lastIdx][1] + distanceMm * lastDir.n[1],
	]);
	return result;
}

export function proposeDiffPair(options = {}) {
	const { centerline = [], widthMm = 0.25, gapMm = 0.2 } = options;
	const offset = (Number(gapMm) + Number(widthMm)) / 2;
	return {
		p: offsetPath(centerline, offset),
		n: offsetPath(centerline, -offset),
	};
}
