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

/** Union-find over pads + track endpoints; pads joined by any chain of tracks share a root. */
function connectByTracks(pads, tracks) {
	const points = [...pads, ...tracks.flatMap((t) => [t.start, t.end])];
	const uf = createUnionFind(points.length);
	tracks.forEach((_, k) => {
		uf.union(pads.length + 2 * k, pads.length + 2 * k + 1);
	});
	points.forEach((p, i) => {
		for (let j = i + 1; j < points.length; j++) {
			if (dist(p, points[j]) < SNAP) uf.union(i, j);
		}
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
function netAirlines(net, pads, tracks) {
	const uf = connectByTracks(pads, tracks);
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
 * @param {Array<{id:*, net:*, x:number, y:number}>} pads
 * @param {Array<{net:*, start:{x,y}, end:{x,y}}>} tracks
 * @returns {Array<{net:*, from:*, to:*, length:number}>}
 */
export function ratsnest(pads, tracks) {
	const airlines = [];
	for (const [net, netPads] of padsByNet(pads)) {
		const netTracks = tracks.filter((t) => t.net === net);
		airlines.push(...netAirlines(net, netPads, netTracks));
	}
	return airlines.sort(byNetThenLength);
}
