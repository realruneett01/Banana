export const WIDTH_PRESETS = Object.freeze([
	Object.freeze({
		label: "Signal 0.25 mm",
		mm: 0.25,
		hint: "~0.5 A current capacity",
	}),
	Object.freeze({
		label: "Power 0.5 mm",
		mm: 0.5,
		hint: "~1.2 A current capacity",
	}),
	Object.freeze({
		label: "High current 1.0 mm",
		mm: 1.0,
		hint: "~2.0 A current capacity",
	}),
]);

function ptCoords(p) {
	if (Array.isArray(p)) return [p[0], p[1]];
	return [p?.x ?? 0, p?.y ?? 0];
}

function constrain45Internal(x0, y0, x1, y1) {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (absX === 0 || absY === 0 || absX === absY) {
		return [[x1, y1]];
	}
	if (absX > absY) {
		return [
			[x0 + Math.sign(dx) * (absX - absY), y0],
			[x1, y1],
		];
	}
	return [
		[x0, y0 + Math.sign(dy) * (absY - absX)],
		[x1, y1],
	];
}

function constrain90Internal(x0, y0, x1, y1) {
	const absX = Math.abs(x1 - x0);
	const absY = Math.abs(y1 - y0);
	if (absX === 0 || absY === 0) {
		return [[x1, y1]];
	}
	if (absX >= absY) {
		return [
			[x1, y0],
			[x1, y1],
		];
	}
	return [
		[x0, y1],
		[x1, y1],
	];
}

export function constrainAngle(from, to, mode = "45") {
	const [x0, y0] = ptCoords(from);
	const [x1, y1] = ptCoords(to);
	if (mode === "90") {
		return constrain90Internal(x0, y0, x1, y1);
	}
	return constrain45Internal(x0, y0, x1, y1);
}

function clamp(val, min, max) {
	return Math.max(min, Math.min(max, val));
}

function distPointToSegment(px, py, s, e) {
	const dx = e[0] - s[0];
	const dy = e[1] - s[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) {
		return Math.hypot(px - s[0], py - s[1]);
	}
	const t = clamp(((px - s[0]) * dx + (py - s[1]) * dy) / lenSq, 0, 1);
	return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

function crossProduct2D(p1, p2, p3) {
	return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function signsOpposite(a, b) {
	return (a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9);
}

function segmentsIntersect(s1, e1, s2, e2) {
	const c1 = crossProduct2D(s1, e1, s2);
	const c2 = crossProduct2D(s1, e1, e2);
	const c3 = crossProduct2D(s2, e2, s1);
	const c4 = crossProduct2D(s2, e2, e1);
	return signsOpposite(c1, c2) && signsOpposite(c3, c4);
}

function segmentDistance(s1, e1, s2, e2) {
	if (segmentsIntersect(s1, e1, s2, e2)) {
		return 0;
	}
	const d1 = distPointToSegment(s1[0], s1[1], s2, e2);
	const d2 = distPointToSegment(e1[0], e1[1], s2, e2);
	const d3 = distPointToSegment(s2[0], s2[1], s1, e1);
	const d4 = distPointToSegment(e2[0], e2[1], s1, e1);
	return Math.min(d1, d2, d3, d4);
}

function getSegmentBox(seg, expandMm = 0) {
	const s = ptCoords(seg.start ?? seg[0]);
	const e = ptCoords(seg.end ?? seg[1]);
	const w = (Number(seg.widthMm) || 0.25) / 2 + expandMm;
	return {
		xMin: Math.min(s[0], e[0]) - w,
		xMax: Math.max(s[0], e[0]) + w,
		yMin: Math.min(s[1], e[1]) - w,
		yMax: Math.max(s[1], e[1]) + w,
	};
}

function insertSegmentToCells(cells, index, box, size) {
	const gx0 = Math.floor(box.xMin / size);
	const gx1 = Math.floor(box.xMax / size);
	const gy0 = Math.floor(box.yMin / size);
	const gy1 = Math.floor(box.yMax / size);
	for (let gx = gx0; gx <= gx1; gx++) {
		for (let gy = gy0; gy <= gy1; gy++) {
			const key = `${gx}:${gy}`;
			let list = cells.get(key);
			if (!list) {
				list = [];
				cells.set(key, list);
			}
			list.push(index);
		}
	}
}

function queryBoxCells(cells, box, size) {
	const candidates = new Set();
	const gx0 = Math.floor(box.xMin / size);
	const gx1 = Math.floor(box.xMax / size);
	const gy0 = Math.floor(box.yMin / size);
	const gy1 = Math.floor(box.yMax / size);
	for (let gx = gx0; gx <= gx1; gx++) {
		for (let gy = gy0; gy <= gy1; gy++) {
			const list = cells.get(`${gx}:${gy}`);
			if (!list) continue;
			for (const idx of list) {
				candidates.add(idx);
			}
		}
	}
	return Array.from(candidates);
}

export function buildSegmentIndex(segments, cellSize = 2.0) {
	const size = Math.max(1.0, cellSize);
	const cells = new Map();
	const segList = Array.isArray(segments) ? segments : [];

	for (let i = 0; i < segList.length; i++) {
		const box = getSegmentBox(segList[i], 0);
		insertSegmentToCells(cells, i, box, size);
	}

	return {
		_isIndex: true,
		segments: segList,
		cellSize: size,
		cells,
		query(box) {
			return queryBoxCells(cells, box, size);
		},
	};
}

function resolveIndexCandidates(others, seg, clearanceMm) {
	if (others?._isIndex) {
		const box = getSegmentBox(seg, clearanceMm + 0.5);
		return { segList: others.segments, candidates: others.query(box) };
	}
	const segList = Array.isArray(others) ? others : [];
	const index = buildSegmentIndex(segList, Math.max(2.0, clearanceMm * 4));
	const box = getSegmentBox(seg, clearanceMm + 0.5);
	return { segList, candidates: index.query(box) };
}

function isCloserGap(gap, worstGap, idx, worstIndex) {
	if (gap < worstGap - 1e-9) return true;
	if (Math.abs(gap - worstGap) <= 1e-9) {
		return worstIndex === null || idx < worstIndex;
	}
	return false;
}

function evaluateWorstClearance(evalCtx) {
	const { s1, e1, w1, segList, candidates, clearanceMm } = evalCtx;
	let worstGap = Infinity;
	let worstIndex = null;

	for (const idx of candidates) {
		const o = segList[idx];
		const s2 = ptCoords(o.start ?? o[0]);
		const e2 = ptCoords(o.end ?? o[1]);
		const w2 = Number(o.widthMm) || 0.25;
		const dist = segmentDistance(s1, e1, s2, e2);
		const gap = dist - (w1 + w2) / 2;
		if (
			gap < clearanceMm - 1e-9 &&
			isCloserGap(gap, worstGap, idx, worstIndex)
		) {
			worstGap = gap;
			worstIndex = idx;
		}
	}

	if (worstIndex === null) return { ok: true, worst: null };
	const gapMm = Math.round(Math.max(0, worstGap) * 1000) / 1000;
	return { ok: false, worst: { otherIndex: worstIndex, gapMm } };
}

export function segmentClearance(
	seg,
	others,
	widthMm = 0.25,
	clearanceMm = 0.2,
) {
	const s1 = ptCoords(seg.start ?? seg[0]);
	const e1 = ptCoords(seg.end ?? seg[1]);
	const w1 = Number(seg.widthMm) || widthMm || 0.25;
	const { segList, candidates } = resolveIndexCandidates(
		others,
		seg,
		clearanceMm,
	);
	return evaluateWorstClearance({
		s1,
		e1,
		w1,
		segList,
		candidates,
		clearanceMm,
	});
}

export function addVia(board, options = {}) {
	const { at = [0, 0], netId = "", drillMm = 0.3, sizeMm = 0.6 } = options;
	const currentVias = Array.isArray(board?.vias) ? [...board.vias] : [];
	const coords = ptCoords(at);
	const newVia = {
		at: coords,
		netId,
		drillMm,
		sizeMm,
	};
	return {
		...(board ?? {}),
		vias: [...currentVias, newVia],
	};
}

function collectCandidateTracks(board, layer, netId) {
	const candidates = [];
	const allTracks = Array.isArray(board?.tracks) ? board.tracks : [];
	for (let i = 0; i < allTracks.length; i++) {
		const t = allTracks[i];
		const trackLayer = t.layer ?? "F.Cu";
		if (trackLayer !== layer) continue;
		if (netId && t.netId && netId === t.netId) continue;
		candidates.push(t);
	}
	return candidates;
}

function checkProposedCollisions(points, index, widthMm, clearanceMm) {
	const collisions = [];
	for (let s = 0; s < points.length - 1; s++) {
		const seg = { start: points[s], end: points[s + 1], widthMm };
		const res = segmentClearance(seg, index, widthMm, clearanceMm);
		if (!res.ok && res.worst) {
			const otherTrack = index.segments[res.worst.otherIndex];
			const otherNet = otherTrack?.netId || "other net";
			collisions.push({
				segmentIndex: s,
				seg: [points[s], points[s + 1]],
				otherIndex: res.worst.otherIndex,
				otherNetId: otherNet,
				gapMm: res.worst.gapMm,
				clearanceMm,
				at: points[s + 1],
				message: `Too close to ${otherNet}: ${res.worst.gapMm} mm, needs ${clearanceMm} mm`,
			});
		}
	}
	return collisions;
}

export function proposeRoute(options = {}) {
	const {
		start = [0, 0],
		cursor = [0, 0],
		layer = "F.Cu",
		widthMm = 0.25,
		clearanceMm = 0.2,
		board = null,
		netId = "",
		mode = "45",
	} = options;

	const cornerPoints = constrainAngle(start, cursor, mode);
	const points = [ptCoords(start), ...cornerPoints];
	const candidateTracks = collectCandidateTracks(board, layer, netId);
	const index = buildSegmentIndex(
		candidateTracks,
		Math.max(2.0, clearanceMm * 4),
	);
	const collisions = checkProposedCollisions(
		points,
		index,
		widthMm,
		clearanceMm,
	);

	return { points, collisions };
}
