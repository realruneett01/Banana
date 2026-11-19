import { runErc } from "./erc.js";
import { isId, newId } from "./ids.js";

const DEFAULT_RULES = {
	clearanceMm: 0.2,
	minTrackWidthMm: 0.15,
	edgeClearanceMm: 0.3,
};

const FP_SPECS = [
	[/(?:^|\D)0402(?:\D|$)/i, 1.0, 0.5],
	[/(?:^|\D)0603(?:\D|$)/i, 1.6, 0.8],
	[/(?:^|\D)0805(?:\D|$)/i, 2.0, 1.25],
	[/(?:^|\D)1206(?:\D|$)/i, 3.2, 1.6],
	[/sot[-_]?23/i, 2.9, 1.3],
	[/soic[-_]?8/i, 4.9, 3.9],
	[/dip[-_]?8/i, 9.5, 6.5],
];

function resolveFootprintSize(name) {
	if (!name) return { w: 5, h: 5 };
	const target = String(name);
	const row = FP_SPECS.find(([rx]) => rx.test(target));
	return row ? { w: row[1], h: row[2] } : { w: 5, h: 5 };
}

function getPartDimensions(part) {
	const size = part.props?.sizeMm;
	if (size?.w && size?.h) {
		return { w: size.w, h: size.h };
	}
	const fp = part.footprint ?? part.props?.footprint ?? "";
	return resolveFootprintSize(fp);
}

function isQuarterTurn(rot) {
	return Math.abs(rot % 180) === 90;
}

function getPartBox(part) {
	const pl = part.placement ?? { x: 0, y: 0, rot: 0, side: "F" };
	const dim = getPartDimensions(part);
	const rot = pl.rot ?? 0;
	const swap = isQuarterTurn(rot);
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

function intervalsOverlap(minA, maxA, minB, maxB) {
	return minA < maxB - 1e-6 && maxA > minB + 1e-6;
}

function boxesOverlap(b1, b2) {
	const xOverlap = intervalsOverlap(b1.xMin, b1.xMax, b2.xMin, b2.xMax);
	const yOverlap = intervalsOverlap(b1.yMin, b1.yMax, b2.yMin, b2.yMax);
	return xOverlap && yOverlap;
}

function resolveItemIds(candidates, idFn, fallbackKind = "trace") {
	const valid = candidates.filter((id) => typeof id === "string" && isId(id));
	return valid.length > 0 ? valid : [idFn(fallbackKind)];
}

function recordIssue(ctx, spec, marker) {
	const issueId = ctx.idFn("issue");
	const issue = {
		id: issueId,
		source: "drc",
		severity: spec.severity ?? "error",
		itemIds: resolveItemIds(spec.itemIds, ctx.idFn, spec.fallbackKind),
		metric: spec.metric,
		message: spec.message,
		suggestion: spec.suggestion,
		commit: ctx.commit,
		status: "open",
	};
	if (spec.measured != null) {
		issue.measured = spec.measured;
		issue.limit = spec.limit;
		issue.unit = spec.unit ?? "mm";
	}
	ctx.issues.push(issue);
	if (marker?.at) {
		ctx.markers.push({
			issueId,
			at: marker.at,
			...(marker.layer ? { layer: marker.layer } : {}),
		});
	}
	return issueId;
}

function midpoint(p1, p2) {
	return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

function createOverlapIssue(partA, partB, ctx) {
	const side = partA.placement?.side ?? "F";
	const refA = partA.ref || partA.id;
	const refB = partB.ref || partB.id;
	recordIssue(
		ctx,
		{
			itemIds: [partA.id, partB.id],
			fallbackKind: "part",
			metric: "overlap",
			message: `Parts ${refA} and ${refB} overlap on side ${side} - they will physically collide.`,
			suggestion: "move components apart",
		},
		{
			at: midpoint(
				[partA.placement.x, partA.placement.y],
				[partB.placement.x, partB.placement.y],
			),
			layer: side === "B" ? "B.Cu" : "F.Cu",
		},
	);
}

function hasPlacement(p) {
	return p?.placement?.x != null;
}

function checkPartPair(partA, partB, ctx) {
	if (!hasPlacement(partA) || !hasPlacement(partB)) return;
	const sideA = partA.placement.side ?? "F";
	const sideB = partB.placement.side ?? "F";
	if (sideA !== sideB) return;
	if (boxesOverlap(getPartBox(partA), getPartBox(partB))) {
		createOverlapIssue(partA, partB, ctx);
	}
}

function checkOverlappingParts(parts, ctx) {
	const placed = parts.filter(hasPlacement);
	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			checkPartPair(placed[i], placed[j], ctx);
		}
	}
}

function checkSingleTrackWidth(track, ctx) {
	const width = Number(track.widthMm) || 0;
	if (width >= ctx.rules.minTrackWidthMm - 1e-9) return;
	const measured = Math.round(width * 1000) / 1000;
	const limit = ctx.rules.minTrackWidthMm;
	recordIssue(
		ctx,
		{
			itemIds: [track.id || track.netId],
			metric: "minTrackWidth",
			measured,
			limit,
			message: `Track width ${measured} mm is too thin (minimum ${limit} mm) - it could overheat.`,
			suggestion: "increase track width",
		},
		{
			at: midpoint(track.start, track.end),
			layer: track.layer,
		},
	);
}

function checkTrackWidths(tracks, ctx) {
	for (const track of tracks) {
		checkSingleTrackWidth(track, ctx);
	}
}

function projectPointToSegment(px, py, s, e) {
	const dx = e[0] - s[0];
	const dy = e[1] - s[1];
	const lenSq = dx * dx + dy * dy;
	if (lenSq <= 1e-12) {
		return { dist: Math.hypot(px - s[0], py - s[1]), closest: [s[0], s[1]] };
	}
	const rawT = ((px - s[0]) * dx + (py - s[1]) * dy) / lenSq;
	const t = Math.max(0, Math.min(1, rawT));
	const cx = s[0] + t * dx;
	const cy = s[1] + t * dy;
	return { dist: Math.hypot(px - cx, py - cy), closest: [cx, cy] };
}

function crossProduct2D(p1, p2, p3) {
	return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function straddleZero(a, b) {
	if (Math.abs(a) <= 1e-9 || Math.abs(b) <= 1e-9) return false;
	return a > 0 !== b > 0;
}

function segmentsStraddle(c1, c2, c3, c4) {
	return straddleZero(c1, c2) && straddleZero(c3, c4);
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

function testEndpoint(pt, s, e) {
	const res = projectPointToSegment(pt[0], pt[1], s, e);
	return {
		dist: res.dist,
		at: midpoint(pt, res.closest),
	};
}

export function segmentSegmentDistance(s1, e1, s2, e2) {
	const hit = checkSegmentIntersection(s1, e1, s2, e2);
	if (hit) return hit;
	const candidates = [
		testEndpoint(s1, s2, e2),
		testEndpoint(e1, s2, e2),
		testEndpoint(s2, s1, e1),
		testEndpoint(e2, s1, e1),
	];
	return candidates.reduce((best, cur) => (cur.dist < best.dist ? cur : best));
}

function getTrackBoundingBox(track, clearanceMm) {
	const halfWidth = (Number(track.widthMm) || 0.2) / 2 + clearanceMm;
	const [sX, sY] = track.start;
	const [eX, eY] = track.end;
	return {
		xMin: Math.min(sX, eX) - halfWidth,
		xMax: Math.max(sX, eX) + halfWidth,
		yMin: Math.min(sY, eY) - halfWidth,
		yMax: Math.max(sY, eY) + halfWidth,
	};
}

class SpatialGrid {
	constructor(cellSize) {
		this.cellSize = cellSize;
		this.cells = new Map();
	}

	add(index, box) {
		const minX = Math.floor(box.xMin / this.cellSize);
		const maxX = Math.floor(box.xMax / this.cellSize);
		const minY = Math.floor(box.yMin / this.cellSize);
		const maxY = Math.floor(box.yMax / this.cellSize);
		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				const key = `${x}:${y}`;
				const bucket = this.cells.get(key) ?? [];
				if (bucket.length === 0) this.cells.set(key, bucket);
				bucket.push(index);
			}
		}
	}

	values() {
		return this.cells.values();
	}
}

function populateSpatialGrid(tracks, clearanceMm) {
	const cellSize = Math.max(2.0, clearanceMm * 4);
	const grid = new SpatialGrid(cellSize);
	tracks.forEach((track, idx) => {
		grid.add(idx, getTrackBoundingBox(track, clearanceMm));
	});
	return grid;
}

function createClearanceIssue(tA, tB, info, ctx) {
	const measured = Math.round(info.clearance * 1000) / 1000;
	const limit = ctx.rules.clearanceMm;
	recordIssue(
		ctx,
		{
			itemIds: [tA.id || tA.netId, tB.id || tB.netId],
			metric: "clearance",
			measured,
			limit,
			message: `These two copper tracks are too close (${measured} mm, need ${limit} mm) - they could short.`,
			suggestion: "increase spacing between tracks or reroute",
		},
		{ at: info.at, layer: tA.layer },
	);
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

function checkBucketPair(u, v, env) {
	const i = Math.min(u, v);
	const j = Math.max(u, v);
	const pairKey = `${i}:${j}`;
	if (env.checked.has(pairKey)) return;
	env.checked.add(pairKey);
	checkPairClearance(i, j, env.tracks, env.ctx);
}

function checkBucketPairs(indices, env) {
	for (let a = 0; a < indices.length; a++) {
		for (let b = a + 1; b < indices.length; b++) {
			checkBucketPair(indices[a], indices[b], env);
		}
	}
}

function checkLayerClearance(tracks, ctx) {
	const grid = populateSpatialGrid(tracks, ctx.rules.clearanceMm);
	const env = { checked: new Set(), tracks, ctx };
	for (const bucket of grid.values()) {
		checkBucketPairs(bucket, env);
	}
}

function groupTracksByLayer(tracks) {
	const byLayer = new Map();
	for (const track of tracks) {
		const layer = track.layer || "F.Cu";
		const list = byLayer.get(layer) ?? [];
		if (list.length === 0) byLayer.set(layer, list);
		list.push(track);
	}
	return byLayer;
}

function checkTrackClearance(tracks, ctx) {
	const byLayer = groupTracksByLayer(tracks);
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

function forEachPolygonEdge(polygon, fn) {
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		fn(polygon[j], polygon[i]);
	}
}

function distPointToPolygonEdges(pt, polygon) {
	let minDist = Infinity;
	let bestPt = pt;
	forEachPolygonEdge(polygon, (start, end) => {
		const res = projectPointToSegment(pt[0], pt[1], start, end);
		if (res.dist < minDist) {
			minDist = res.dist;
			bestPt = res.closest;
		}
	});
	return { dist: minDist, closest: bestPt };
}

function distSegmentToPolygonEdges(track, polygon) {
	let minDist = Infinity;
	let bestAt = track.start;
	forEachPolygonEdge(polygon, (start, end) => {
		const res = segmentSegmentDistance(track.start, track.end, start, end);
		if (res.dist < minDist) {
			minDist = res.dist;
			bestAt = res.at;
		}
	});
	return { dist: minDist, at: bestAt };
}

function reportOutlineIssue(item, metric, msg, ctx) {
	recordIssue(
		ctx,
		{
			severity: metric === "boardOutline" ? "error" : "warning",
			itemIds: [item.id],
			fallbackKind: item.kind || "trace",
			metric,
			message: msg,
			suggestion: "keep all parts and tracks safely inside board boundary",
		},
		{ at: item.at, layer: item.layer },
	);
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
	const trackId = track.id || track.netId;
	if (!inStart || !inEnd) {
		const item = {
			id: trackId,
			at: midpoint(track.start, track.end),
			layer: track.layer,
			kind: "trace",
		};
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

class DisjointSet {
	constructor(size) {
		this.parent = Array.from({ length: size }, (_, i) => i);
	}

	find(i) {
		let curr = i;
		while (this.parent[curr] !== curr) {
			this.parent[curr] = this.parent[this.parent[curr]];
			curr = this.parent[curr];
		}
		return curr;
	}

	union(i, j) {
		const rA = this.find(i);
		const rB = this.find(j);
		if (rA === rB) return false;
		this.parent[rA] = rB;
		return true;
	}

	connected(i, j) {
		return this.find(i) === this.find(j);
	}
}

function findPadCoord(pads, pin) {
	if (!Array.isArray(pads)) return null;
	const pad = pads.find(
		(p) =>
			p.partId === pin.partId && String(p.pin ?? p.number) === String(pin.pin),
	);
	if (!pad) return null;
	const x = pad.x ?? pad.at?.[0];
	const y = pad.y ?? pad.at?.[1];
	return typeof x === "number" && typeof y === "number" ? [x, y] : null;
}

function resolveNetPadCoord(pin, board, partsMap) {
	const padPos = findPadCoord(board.pads, pin);
	if (padPos) return padPos;
	const part = partsMap.get(pin.partId);
	if (typeof part?.placement?.x === "number") {
		return [part.placement.x, part.placement.y];
	}
	return null;
}

function tracksTouch(t1, t2) {
	const d1 = Math.hypot(t1.start[0] - t2.start[0], t1.start[1] - t2.start[1]);
	const d2 = Math.hypot(t1.start[0] - t2.end[0], t1.start[1] - t2.end[1]);
	const d3 = Math.hypot(t1.end[0] - t2.start[0], t1.end[1] - t2.start[1]);
	const d4 = Math.hypot(t1.end[0] - t2.end[0], t1.end[1] - t2.end[1]);
	return Math.min(d1, d2, d3, d4) <= 0.05;
}

function unionTracksEndpoints(tracks, ds, offset) {
	for (let i = 0; i < tracks.length; i++) {
		for (let j = i + 1; j < tracks.length; j++) {
			if (tracksTouch(tracks[i], tracks[j])) {
				ds.union(offset + i, offset + j);
			}
		}
	}
}

function snapPadsToTracks(padCoords, tracks, ds) {
	for (let p = 0; p < padCoords.length; p++) {
		const pt = padCoords[p];
		for (let t = 0; t < tracks.length; t++) {
			const trk = tracks[t];
			const ds1 = Math.hypot(pt[0] - trk.start[0], pt[1] - trk.start[1]);
			const ds2 = Math.hypot(pt[0] - trk.end[0], pt[1] - trk.end[1]);
			if (Math.min(ds1, ds2) <= 0.05) {
				ds.union(p, padCoords.length + t);
			}
		}
	}
}

function checkNetRouted(net, padCoords, tracks, ctx) {
	const total = padCoords.length + tracks.length;
	const ds = new DisjointSet(total);
	snapPadsToTracks(padCoords, tracks, ds);
	unionTracksEndpoints(tracks, ds, padCoords.length);
	for (let i = 1; i < padCoords.length; i++) {
		if (!ds.connected(0, i)) {
			recordIssue(
				ctx,
				{
					severity: "warning",
					itemIds: [net.id],
					fallbackKind: "net",
					metric: "unrouted",
					message: `Net ${net.name || net.id} has unrouted connections between pads.`,
					suggestion: "route remaining connections between pads",
				},
				{ at: padCoords[i] },
			);
			return;
		}
	}
}

function collectNetPadCoords(pins, board, partsMap) {
	if (!Array.isArray(pins) || pins.length < 2) return [];
	const coords = [];
	for (const pin of pins) {
		const pos = resolveNetPadCoord(pin, board, partsMap);
		if (pos) coords.push(pos);
	}
	return coords;
}

function checkSingleNet(net, tracks, env) {
	const padCoords = collectNetPadCoords(net.pins, env.board, env.partsMap);
	if (padCoords.length < 2) return;
	const netTracks = tracks.filter((t) => t.netId === net.id);
	checkNetRouted(net, padCoords, netTracks, env.ctx);
}

function checkUnroutedConnections(nets, board, partsMap, ctx) {
	if (!board) return;
	const tracks = Array.isArray(board.tracks) ? board.tracks : [];
	const env = { board, partsMap, ctx };
	for (const net of nets) {
		checkSingleNet(net, tracks, env);
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
