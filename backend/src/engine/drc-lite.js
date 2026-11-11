import { runErc } from "./erc.js";
import { isId, newId } from "./ids.js";

const DEFAULT_RULES = {
	clearanceMm: 0.2,
	minTrackWidthMm: 0.15,
	edgeClearanceMm: 0.3,
};

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

function getPartDimensions(part) {
	if (part.props?.sizeMm?.w && part.props?.sizeMm?.h) {
		return { w: part.props.sizeMm.w, h: part.props.sizeMm.h };
	}
	const fp = part.footprint ?? part.props?.footprint ?? "";
	return resolveFootprintSize(fp);
}

function getPartBox(part) {
	const pl = part.placement ?? { x: 0, y: 0, rot: 0, side: "F" };
	const dim = getPartDimensions(part);
	const rot = pl.rot ?? 0;
	const swap = rot === 90 || rot === 270 || rot === -90 || rot === -270;
	const w = swap ? dim.h : dim.w;
	const h = swap ? dim.w : dim.h;
	return {
		xMin: pl.x - w / 2,
		xMax: pl.x + w / 2,
		yMin: pl.y - h / 2,
		yMax: pl.y + h / 2,
		side: pl.side ?? "F",
	};
}

function boxesOverlap(b1, b2) {
	return (
		b1.xMin < b2.xMax - 1e-6 &&
		b1.xMax > b2.xMin + 1e-6 &&
		b1.yMin < b2.yMax - 1e-6 &&
		b1.yMax > b2.yMin + 1e-6
	);
}

function resolveItemIds(candidates, idFn, fallbackKind = "trace") {
	const valid = candidates.filter((id) => typeof id === "string" && isId(id));
	if (valid.length > 0) return valid;
	return [idFn(fallbackKind)];
}

function createOverlapIssue(partA, partB, ctx) {
	const issueId = ctx.idFn("issue");
	const side = partA.placement?.side ?? "F";
	const refA = partA.ref || partA.id;
	const refB = partB.ref || partB.id;
	ctx.issues.push({
		id: issueId,
		source: "drc",
		severity: "error",
		itemIds: resolveItemIds([partA.id, partB.id], ctx.idFn, "part"),
		metric: "overlap",
		message: `Parts ${refA} and ${refB} overlap on side ${side} - they will physically collide.`,
		suggestion: "move components apart",
		commit: ctx.commit,
		status: "open",
	});
	ctx.markers.push({
		issueId,
		at: [
			(partA.placement.x + partB.placement.x) / 2,
			(partA.placement.y + partB.placement.y) / 2,
		],
		layer: side === "B" ? "B.Cu" : "F.Cu",
	});
}

function checkPartPair(partA, partB, ctx) {
	const plA = partA.placement;
	const plB = partB.placement;
	if (!plA || !plB || plA.x == null || plB.x == null) return;
	const sideA = plA.side ?? "F";
	const sideB = plB.side ?? "F";
	if (sideA !== sideB) return;
	if (boxesOverlap(getPartBox(partA), getPartBox(partB))) {
		createOverlapIssue(partA, partB, ctx);
	}
}

function checkOverlappingParts(parts, ctx) {
	const placed = parts.filter((p) => p.placement?.x != null);
	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			checkPartPair(placed[i], placed[j], ctx);
		}
	}
}

function checkSingleTrackWidth(track, ctx) {
	const width = Number(track.widthMm) || 0;
	if (width >= ctx.rules.minTrackWidthMm - 1e-9) return;
	const issueId = ctx.idFn("issue");
	const measured = Math.round(width * 1000) / 1000;
	const limit = ctx.rules.minTrackWidthMm;
	ctx.issues.push({
		id: issueId,
		source: "drc",
		severity: "error",
		itemIds: resolveItemIds([track.id || track.netId], ctx.idFn, "trace"),
		metric: "minTrackWidth",
		measured,
		limit,
		unit: "mm",
		message: `Track width ${measured} mm is too thin (minimum ${limit} mm) - it could overheat.`,
		suggestion: "increase track width",
		commit: ctx.commit,
		status: "open",
	});
	ctx.markers.push({
		issueId,
		at: [
			(track.start[0] + track.end[0]) / 2,
			(track.start[1] + track.end[1]) / 2,
		],
		layer: track.layer,
	});
}

function checkTrackWidths(tracks, ctx) {
	for (const track of tracks) {
		checkSingleTrackWidth(track, ctx);
	}
}

function clamp(val, min, max) {
	return Math.max(min, Math.min(max, val));
}

function closestPointOnSegment(px, py, s, e) {
	const dx = e[0] - s[0];
	const dy = e[1] - s[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return [s[0], s[1]];
	const t = clamp(((px - s[0]) * dx + (py - s[1]) * dy) / lenSq, 0, 1);
	return [s[0] + t * dx, s[1] + t * dy];
}

function distPointToSegment(px, py, s, e) {
	const [cx, cy] = closestPointOnSegment(px, py, s, e);
	return { dist: Math.hypot(px - cx, py - cy), closest: [cx, cy] };
}

function crossProduct2D(p1, p2, p3) {
	return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function segmentsStraddle(c1, c2, c3, c4) {
	const s1 = (c1 > 1e-9 && c2 < -1e-9) || (c1 < -1e-9 && c2 > 1e-9);
	const s2 = (c3 > 1e-9 && c4 < -1e-9) || (c3 < -1e-9 && c4 > 1e-9);
	return s1 && s2;
}

function checkSegmentIntersection(s1, e1, s2, e2) {
	const c1 = crossProduct2D(s1, e1, s2);
	const c2 = crossProduct2D(s1, e1, e2);
	const c3 = crossProduct2D(s2, e2, s1);
	const c4 = crossProduct2D(s2, e2, e1);
	if (!segmentsStraddle(c1, c2, c3, c4)) return null;
	const s = c3 / (c3 - c4);
	const at = [s1[0] + s * (e1[0] - s1[0]), s1[1] + s * (e1[1] - s1[1])];
	return { dist: 0, at };
}

export function segmentSegmentDistance(s1, e1, s2, e2) {
	const hit = checkSegmentIntersection(s1, e1, s2, e2);
	if (hit) return hit;
	const d1 = distPointToSegment(s1[0], s1[1], s2, e2);
	const d2 = distPointToSegment(e1[0], e1[1], s2, e2);
	const d3 = distPointToSegment(s2[0], s2[1], s1, e1);
	const d4 = distPointToSegment(e2[0], e2[1], s1, e1);
	const tests = [
		{
			dist: d1.dist,
			at: [(s1[0] + d1.closest[0]) / 2, (s1[1] + d1.closest[1]) / 2],
		},
		{
			dist: d2.dist,
			at: [(e1[0] + d2.closest[0]) / 2, (e1[1] + d2.closest[1]) / 2],
		},
		{
			dist: d3.dist,
			at: [(s2[0] + d3.closest[0]) / 2, (s2[1] + d3.closest[1]) / 2],
		},
		{
			dist: d4.dist,
			at: [(e2[0] + d4.closest[0]) / 2, (e2[1] + d4.closest[1]) / 2],
		},
	];
	tests.sort((a, b) => a.dist - b.dist);
	return tests[0];
}

function getTrackBox(track, clearanceMm) {
	const w = (Number(track.widthMm) || 0.2) / 2 + clearanceMm;
	return {
		xMin: Math.min(track.start[0], track.end[0]) - w,
		xMax: Math.max(track.start[0], track.end[0]) + w,
		yMin: Math.min(track.start[1], track.end[1]) - w,
		yMax: Math.max(track.start[1], track.end[1]) + w,
	};
}

function insertTrackToGrid(track, idx, gridCtx) {
	const { grid, cellSize, clearanceMm } = gridCtx;
	const box = getTrackBox(track, clearanceMm);
	const gx0 = Math.floor(box.xMin / cellSize);
	const gx1 = Math.floor(box.xMax / cellSize);
	const gy0 = Math.floor(box.yMin / cellSize);
	const gy1 = Math.floor(box.yMax / cellSize);
	for (let gx = gx0; gx <= gx1; gx++) {
		for (let gy = gy0; gy <= gy1; gy++) {
			const key = `${gx}:${gy}`;
			let list = grid.get(key);
			if (!list) {
				list = [];
				grid.set(key, list);
			}
			list.push(idx);
		}
	}
}

function createClearanceIssue(tA, tB, info, ctx) {
	const issueId = ctx.idFn("issue");
	const measured = Math.round(info.clearance * 1000) / 1000;
	const limit = ctx.rules.clearanceMm;
	const idA = tA.id || tA.netId;
	const idB = tB.id || tB.netId;
	ctx.issues.push({
		id: issueId,
		source: "drc",
		severity: "error",
		itemIds: resolveItemIds([idA, idB], ctx.idFn, "trace"),
		metric: "clearance",
		measured,
		limit,
		unit: "mm",
		message: `These two copper tracks are too close (${measured} mm, need ${limit} mm) - they could short.`,
		suggestion: "increase spacing between tracks or reroute",
		commit: ctx.commit,
		status: "open",
	});
	ctx.markers.push({ issueId, at: info.at, layer: tA.layer });
}

function checkPairClearance(idxA, idxB, tracks, ctx) {
	const tA = tracks[idxA];
	const tB = tracks[idxB];
	if (tA.netId === tB.netId) return;
	const segDist = segmentSegmentDistance(tA.start, tA.end, tB.start, tB.end);
	const wA = Number(tA.widthMm) || 0.2;
	const wB = Number(tB.widthMm) || 0.2;
	const clearance = segDist.dist - (wA + wB) / 2;
	if (clearance < ctx.rules.clearanceMm - 1e-9) {
		createClearanceIssue(
			tA,
			tB,
			{ clearance: Math.max(0, clearance), at: segDist.at },
			ctx,
		);
	}
}

function checkLayerClearance(tracks, ctx) {
	const cellSize = Math.max(2.0, ctx.rules.clearanceMm * 4);
	const grid = new Map();
	const gridCtx = { grid, cellSize, clearanceMm: ctx.rules.clearanceMm };
	for (let i = 0; i < tracks.length; i++) {
		insertTrackToGrid(tracks[i], i, gridCtx);
	}
	const checked = new Set();
	for (const list of grid.values()) {
		for (let a = 0; a < list.length; a++) {
			for (let b = a + 1; b < list.length; b++) {
				const i = list[a] < list[b] ? list[a] : list[b];
				const j = list[a] < list[b] ? list[b] : list[a];
				const pairKey = `${i}:${j}`;
				if (checked.has(pairKey)) continue;
				checked.add(pairKey);
				checkPairClearance(i, j, tracks, ctx);
			}
		}
	}
}

function checkTrackClearance(tracks, ctx) {
	const byLayer = new Map();
	for (const track of tracks) {
		const l = track.layer || "F.Cu";
		let list = byLayer.get(l);
		if (!list) {
			list = [];
			byLayer.set(l, list);
		}
		list.push(track);
	}
	for (const layerTracks of byLayer.values()) {
		if (layerTracks.length >= 2) {
			checkLayerClearance(layerTracks, ctx);
		}
	}
}

function pointInPolygon(pt, polygon) {
	if (!polygon || polygon.length < 3) return false;
	const [px, py] = pt;
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i];
		const [xj, yj] = polygon[j];
		const intersect =
			yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

function distPointToPolygonEdges(pt, polygon) {
	let minDist = Infinity;
	let bestPt = pt;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const res = distPointToSegment(pt[0], pt[1], polygon[j], polygon[i]);
		if (res.dist < minDist) {
			minDist = res.dist;
			bestPt = res.closest;
		}
	}
	return { dist: minDist, closest: bestPt };
}

function distSegmentToPolygonEdges(track, polygon) {
	let minDist = Infinity;
	let bestAt = track.start;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const res = segmentSegmentDistance(
			track.start,
			track.end,
			polygon[j],
			polygon[i],
		);
		if (res.dist < minDist) {
			minDist = res.dist;
			bestAt = res.at;
		}
	}
	return { dist: minDist, at: bestAt };
}

function reportOutlineIssue(item, metric, msg, ctx) {
	const issueId = ctx.idFn("issue");
	ctx.issues.push({
		id: issueId,
		source: "drc",
		severity: metric === "boardOutline" ? "error" : "warning",
		itemIds: resolveItemIds([item.id], ctx.idFn, item.kind || "trace"),
		metric,
		message: msg,
		suggestion: "keep all parts and tracks safely inside board boundary",
		commit: ctx.commit,
		status: "open",
	});
	ctx.markers.push({ issueId, at: item.at, layer: item.layer });
}

function checkTrackOutlineClearance(track, edgeRes, trackId, ctx) {
	const clearance = edgeRes.dist - (Number(track.widthMm) || 0.2) / 2;
	if (clearance < ctx.rules.edgeClearanceMm - 1e-9) {
		const measured = Math.round(Math.max(0, clearance) * 1000) / 1000;
		const msg = `Track is too close to board edge (${measured} mm, need ${ctx.rules.edgeClearanceMm} mm).`;
		const item = {
			id: trackId,
			at: edgeRes.at,
			layer: track.layer,
			kind: "trace",
		};
		reportOutlineIssue(item, "edgeClearance", msg, ctx);
	}
}

function checkTrackOutline(track, outline, ctx) {
	const inStart = pointInPolygon(track.start, outline);
	const inEnd = pointInPolygon(track.end, outline);
	const at = [
		(track.start[0] + track.end[0]) / 2,
		(track.start[1] + track.end[1]) / 2,
	];
	const trackId = track.id || track.netId;
	if (!inStart || !inEnd) {
		const item = { id: trackId, at, layer: track.layer, kind: "trace" };
		reportOutlineIssue(
			item,
			"boardOutline",
			"Track is outside the board outline.",
			ctx,
		);
		return;
	}
	checkTrackOutlineClearance(
		track,
		distSegmentToPolygonEdges(track, outline),
		trackId,
		ctx,
	);
}

function checkPartOutline(part, outline, ctx) {
	if (!part.placement || part.placement.x == null) return;
	const at = [part.placement.x, part.placement.y];
	const ref = part.ref || part.id;
	const layer = part.placement.side === "B" ? "B.Cu" : "F.Cu";
	if (!pointInPolygon(at, outline)) {
		const item = { id: part.id, at, layer, kind: "part" };
		reportOutlineIssue(
			item,
			"boardOutline",
			`Part ${ref} is outside the board outline.`,
			ctx,
		);
		return;
	}
	const edgeRes = distPointToPolygonEdges(at, outline);
	if (edgeRes.dist < ctx.rules.edgeClearanceMm - 1e-9) {
		const measured = Math.round(edgeRes.dist * 1000) / 1000;
		const msg = `Part ${ref} is too close to board edge (${measured} mm, need ${ctx.rules.edgeClearanceMm} mm).`;
		const item = { id: part.id, at: edgeRes.closest, layer, kind: "part" };
		reportOutlineIssue(item, "edgeClearance", msg, ctx);
	}
}

function checkBoardOutline(parts, tracks, outline, ctx) {
	if (!outline || outline.length < 3) return;
	for (const track of tracks) {
		checkTrackOutline(track, outline, ctx);
	}
	for (const part of parts) {
		checkPartOutline(part, outline, ctx);
	}
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
	const rI = findRoot(parent, i);
	const rJ = findRoot(parent, j);
	if (rI === rJ) return false;
	parent[rI] = rJ;
	return true;
}

function resolveNetPadCoord(pin, board, partsMap) {
	if (Array.isArray(board.pads)) {
		const pad = board.pads.find(
			(p) =>
				p.partId === pin.partId &&
				String(p.pin ?? p.number) === String(pin.pin),
		);
		if (pad) {
			const x = pad.x ?? pad.at?.[0];
			const y = pad.y ?? pad.at?.[1];
			if (typeof x === "number" && typeof y === "number") return [x, y];
		}
	}
	const part = partsMap.get(pin.partId);
	if (part?.placement && typeof part.placement.x === "number") {
		return [part.placement.x, part.placement.y];
	}
	return null;
}

function unionTracksEndpoints(tracks, parent, offset) {
	for (let i = 0; i < tracks.length; i++) {
		for (let j = i + 1; j < tracks.length; j++) {
			const t1 = tracks[i];
			const t2 = tracks[j];
			const d1 = Math.hypot(
				t1.start[0] - t2.start[0],
				t1.start[1] - t2.start[1],
			);
			const d2 = Math.hypot(t1.start[0] - t2.end[0], t1.start[1] - t2.end[1]);
			const d3 = Math.hypot(t1.end[0] - t2.start[0], t1.end[1] - t2.start[1]);
			const d4 = Math.hypot(t1.end[0] - t2.end[0], t1.end[1] - t2.end[1]);
			if (Math.min(d1, d2, d3, d4) <= 0.05) {
				unionRoots(parent, offset + i, offset + j);
			}
		}
	}
}

function snapPadsToTracks(padCoords, tracks, parent) {
	for (let p = 0; p < padCoords.length; p++) {
		const pt = padCoords[p];
		for (let t = 0; t < tracks.length; t++) {
			const trk = tracks[t];
			const ds = Math.hypot(pt[0] - trk.start[0], pt[1] - trk.start[1]);
			const de = Math.hypot(pt[0] - trk.end[0], pt[1] - trk.end[1]);
			if (ds <= 0.05 || de <= 0.05) {
				unionRoots(parent, p, padCoords.length + t);
			}
		}
	}
}

function checkNetRouted(net, padCoords, tracks, ctx) {
	const total = padCoords.length + tracks.length;
	const parent = Array.from({ length: total }, (_, i) => i);
	snapPadsToTracks(padCoords, tracks, parent);
	unionTracksEndpoints(tracks, parent, padCoords.length);
	const root0 = findRoot(parent, 0);
	for (let i = 1; i < padCoords.length; i++) {
		if (findRoot(parent, i) !== root0) {
			const issueId = ctx.idFn("issue");
			ctx.issues.push({
				id: issueId,
				source: "drc",
				severity: "warning",
				itemIds: resolveItemIds([net.id], ctx.idFn, "net"),
				metric: "unrouted",
				message: `Net ${net.name || net.id} has unrouted connections between pads.`,
				suggestion: "route remaining connections between pads",
				commit: ctx.commit,
				status: "open",
			});
			ctx.markers.push({ issueId, at: padCoords[i] });
			return;
		}
	}
}

function checkUnroutedConnections(nets, board, partsMap, ctx) {
	if (!board) return;
	const allTracks = Array.isArray(board.tracks) ? board.tracks : [];
	for (const net of nets) {
		const pins = Array.isArray(net.pins) ? net.pins : [];
		if (pins.length < 2) continue;
		const padCoords = [];
		for (const pin of pins) {
			const pos = resolveNetPadCoord(pin, board, partsMap);
			if (pos) padCoords.push(pos);
		}
		if (padCoords.length < 2) continue;
		const netTracks = allTracks.filter((t) => t.netId === net.id);
		checkNetRouted(net, padCoords, netTracks, ctx);
	}
}

function collectErcIssues(ir, ctx) {
	const ercIssues = runErc(ir, { commit: ctx.commit });
	for (const issue of ercIssues) {
		const issueId = ctx.idFn === newId ? issue.id : ctx.idFn("issue");
		ctx.issues.push({ ...issue, id: issueId });
	}
}

function executeLiveChecks(ir, board, ctx) {
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const nets = Array.isArray(ir?.nets) ? ir.nets : [];
	const tracks = Array.isArray(board?.tracks) ? board.tracks : [];
	const partsMap = new Map(parts.map((p) => [p.id, p]));

	collectErcIssues(ir, ctx);
	checkTrackClearance(tracks, ctx);
	checkTrackWidths(tracks, ctx);
	checkBoardOutline(parts, tracks, board?.outline, ctx);
	checkUnroutedConnections(nets, board, partsMap, ctx);
	checkOverlappingParts(parts, ctx);
}

export function runLiveChecks(options = {}) {
	try {
		const opts = options && typeof options === "object" ? options : {};
		const {
			ir = {},
			board = null,
			rules = {},
			idFn = newId,
			commit = "",
		} = opts;
		const ctx = {
			rules: { ...DEFAULT_RULES, ...(rules ?? {}) },
			idFn,
			commit,
			issues: [],
			markers: [],
		};
		executeLiveChecks(ir, board, ctx);
		return { issues: ctx.issues, markers: ctx.markers };
	} catch {
		// Broad catch to guarantee runLiveChecks never throws
		return { issues: [], markers: [] };
	}
}
