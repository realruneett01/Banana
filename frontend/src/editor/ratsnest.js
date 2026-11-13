/** Pure ratsnest computation for the PCB editor. No React, no side-effects. */

const SNAP = 0.01; // mm: points closer than this are the same connection point

function dist(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function createUnionFind(size) {
	const parent = Array.from({ length: size }, (_, i) => i);
	const find = (i) => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return false;
		parent[ra] = rb;
		return true;
	};
	return { find, union };
}

function distToSegment(p, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const raw = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
	const t = Math.max(0, Math.min(1, raw));
	return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function halfWidth(track) {
	return (track.width ?? 0) / 2;
}

/** Copper of `reach` around p overlaps the track (endpoint on it, T-junction, or inside a pad). */
function touchesTrack(item, track) {
	const gap = distToSegment(item.pt, track.start, track.end);
	return gap <= item.reach + halfWidth(track) + SNAP;
}

function insidePolygon(p, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		const crosses = a.y > p.y !== b.y > p.y;
		if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
			inside = !inside;
		}
	}
	return inside;
}

/** Inside the fill, or a fill vertex (e.g. a thermal spoke) reaches the item. */
function touchesZone(item, zone) {
	const poly = zone.polygon ?? [];
	if (insidePolygon(item.pt, poly)) return true;
	return poly.some((v) => dist(item.pt, v) <= item.reach + SNAP);
}

function trackEndItems(tracks) {
	return tracks.flatMap((t) => [
		{ pt: t.start, reach: halfWidth(t) },
		{ pt: t.end, reach: halfWidth(t) },
	]);
}

function joinCoincident(uf, items, i) {
	for (let j = i + 1; j < items.length; j++) {
		if (dist(items[i].pt, items[j].pt) < SNAP) uf.union(i, j);
	}
}

function joinTouching(uf, item, i, ctx) {
	ctx.tracks.forEach((t, k) => {
		if (touchesTrack(item, t)) uf.union(i, ctx.padCount + 2 * k);
	});
	ctx.zones.forEach((z, n) => {
		if (touchesZone(item, z)) uf.union(i, ctx.itemCount + n);
	});
}

/** Union-find over pads, track endpoints and zones; pads joined by any chain of copper share a root. */
function connectByCopper(pads, tracks, zones) {
	const padItems = pads.map((p) => ({ pt: p, reach: p.r ?? 0 }));
	const items = [...padItems, ...trackEndItems(tracks)];
	const uf = createUnionFind(items.length + zones.length);
	tracks.forEach((_, k) => {
		uf.union(pads.length + 2 * k, pads.length + 2 * k + 1);
	});
	const ctx = { tracks, zones, padCount: pads.length, itemCount: items.length };
	items.forEach((item, i) => {
		joinCoincident(uf, items, i);
		joinTouching(uf, item, i, ctx);
	});
	return uf;
}

function padPairs(pads) {
	const pairs = [];
	pads.forEach((a, i) => {
		for (let j = i + 1; j < pads.length; j++) {
			pairs.push({ i, j, length: dist(a, pads[j]) });
		}
	});
	return pairs.sort((p, q) => p.length - q.length);
}

/** Kruskal MST over the pads of one net, treating track-connected pads as already joined. */
function netAirlines(net, pads, copper) {
	const uf = connectByCopper(pads, copper.tracks, copper.zones);
	const airlines = [];
	for (const { i, j, length } of padPairs(pads)) {
		if (uf.union(i, j)) {
			airlines.push({ net, from: pads[i].id, to: pads[j].id, length });
		}
	}
	return airlines;
}

function padsByNet(pads) {
	const byNet = new Map();
	for (const pad of pads) {
		if (pad.net === 0 || pad.net === "" || pad.net == null) continue;
		if (!byNet.has(pad.net)) byNet.set(pad.net, []);
		byNet.get(pad.net).push(pad);
	}
	return byNet;
}

function byNetThenLength(a, b) {
	if (a.net !== b.net) return a.net < b.net ? -1 : 1;
	return a.length - b.length;
}

/**
 * Compute ratsnest airlines.
 * @param {Array<{id:*, net:*, x:number, y:number, r?:number}>} pads  r: copper reach around the centre
 * @param {Array<{net:*, start:{x,y}, end:{x,y}, width?:number}>} tracks
 * @param {Array<{net:*, polygon:Array<{x,y}>}>} [zones]  filled copper areas
 * @returns {Array<{net:*, from:*, to:*, length:number}>}
 */
export function ratsnest(pads, tracks, zones = []) {
	const airlines = [];
	for (const [net, netPads] of padsByNet(pads)) {
		const copper = {
			tracks: tracks.filter((t) => t.net === net),
			zones: zones.filter((z) => z.net === net),
		};
		airlines.push(...netAirlines(net, netPads, copper));
	}
	return airlines.sort(byNetThenLength);
}
