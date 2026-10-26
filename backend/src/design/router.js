import { absolutePads } from "./checks.js";

const GRID = 0.25;
const TRACK_W = 0.25;
const CLEARANCE = 0.2;
const PAD_KEEPOUT = CLEARANCE + TRACK_W / 2 + 0.03; // track centre must stay this far from foreign copper
const EDGE_KEEPOUT = 0.5 + TRACK_W / 2;
const VIA_SIZE = 0.8;
const VIA_DRILL = 0.4;
const VIA_COST = 12;
const LAYERS = ["F.Cu", "B.Cu"];

class MinHeap {
	constructor() {
		this.a = [];
	}
	push(item) {
		const a = this.a;
		a.push(item);
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (a[p][0] <= a[i][0]) break;
			[a[p], a[i]] = [a[i], a[p]];
			i = p;
		}
	}
	pop() {
		const a = this.a;
		const top = a[0];
		const last = a.pop();
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && a[l][0] < a[m][0]) m = l;
				if (r < a.length && a[r][0] < a[m][0]) m = r;
				if (m === i) break;
				[a[m], a[i]] = [a[i], a[m]];
				i = m;
			}
		}
		return top;
	}
	get size() {
		return this.a.length;
	}
}

/**
 * Grid-based two-layer router. Manhattan tracks, vias for layer changes, no zones or push-and-shove.
 * It routes what it can and reports the rest; KiCad's DRC is the final judge of the result.
 */
export function autoroute(design, positions, board, { orderSeed = 0 } = {}) {
	const d = design.data;
	const pads = absolutePads(design, positions);
	const x0 = board.originX;
	const y0 = board.originY;
	const W = Math.floor(board.width / GRID) + 1;
	const H = Math.floor(board.height / GRID) + 1;
	const netIds = new Map(Object.keys(d.nets).map((n, i) => [n, i + 1]));
	const cellX = (c) => x0 + c * GRID;
	const cellY = (r) => y0 + r * GRID;
	const toCol = (x) => Math.round((x - x0) / GRID);
	const toRow = (y) => Math.round((y - y0) / GRID);

	// owner[layer][idx]: 0 free, >0 net id, -1 hard blocked, -2 contested by several nets
	const owner = LAYERS.map(() => new Int32Array(W * H));
	const idx = (c, r) => r * W + c;
	const stamp = (layer, c, r, net) => {
		if (c < 0 || r < 0 || c >= W || r >= H) return;
		const k = idx(c, r);
		const cur = owner[layer][k];
		if (cur === 0) owner[layer][k] = net;
		else if (cur !== net && cur !== -1) owner[layer][k] = -2;
	};

	// board edge keepout
	const edgeCells = Math.ceil(EDGE_KEEPOUT / GRID);
	for (let l = 0; l < 2; l++)
		for (let r = 0; r < H; r++)
			for (let c = 0; c < W; c++)
				if (
					c < edgeCells ||
					r < edgeCells ||
					c >= W - edgeCells ||
					r >= H - edgeCells
				)
					owner[l][idx(c, r)] = -1;

	const padRects = [];
	for (const [pin, p] of pads) {
		const net =
			netIds.get(
				[...Object.entries(d.nets)].find(([, n]) => n.pins.includes(pin))?.[0],
			) ?? 0;
		padRects.push({ pin, net, ...p });
		const kx = p.w / 2 + PAD_KEEPOUT;
		const ky = p.h / 2 + PAD_KEEPOUT;
		const layers = p.thru
			? [0, 1]
			: p.layers.includes("F.Cu")
				? [0]
				: p.layers.includes("B.Cu")
					? [1]
					: [];
		for (const l of layers) {
			for (let r = toRow(p.y - ky) - 1; r <= toRow(p.y + ky) + 1; r++) {
				for (let c = toCol(p.x - kx) - 1; c <= toCol(p.x + kx) + 1; c++) {
					if (
						Math.abs(cellX(c) - p.x) <= kx &&
						Math.abs(cellY(r) - p.y) <= ky
					) {
						if (net === 0) {
							if (c >= 0 && r >= 0 && c < W && r < H) owner[l][idx(c, r)] = -1; // unconnected pad: nobody may pass
						} else stamp(l, c, r, net);
					}
				}
			}
		}
	}

	// A pad's own centre must stay reachable even where a neighbour's keepout touches it.
	for (const p of padRects) {
		if (p.net === 0) continue;
		const layers = p.thru
			? [0, 1]
			: p.layers.includes("F.Cu")
				? [0]
				: p.layers.includes("B.Cu")
					? [1]
					: [];
		for (const l of layers) {
			for (let r = toRow(p.y) - 1; r <= toRow(p.y) + 1; r++) {
				for (let c = toCol(p.x) - 1; c <= toCol(p.x) + 1; c++) {
					if (c < 0 || r < 0 || c >= W || r >= H) continue;
					if (
						Math.abs(cellX(c) - p.x) <= p.w / 2 &&
						Math.abs(cellY(r) - p.y) <= p.h / 2
					)
						owner[l][idx(c, r)] = p.net;
				}
			}
		}
	}

	const passable = (l, c, r, net) => {
		if (c < 0 || r < 0 || c >= W || r >= H) return false;
		const o = owner[l][idx(c, r)];
		return o === 0 || o === net;
	};

	const placedVias = []; // {x, y} of every via already placed on the board
	const HOLE_GAP = 0.25 + 0.03; // minimum hole-to-hole / hole-to-copper gap (KiCad default 0.25 mm)
	const viaOk = (c, r, net) => {
		const x = cellX(c);
		const y = cellY(r);
		for (const p of padRects) {
			const dx = Math.max(Math.abs(x - p.x) - p.w / 2, 0);
			const dy = Math.max(Math.abs(y - p.y) - p.h / 2, 0);
			const edge = Math.hypot(dx, dy);
			if (p.net !== net && edge < VIA_SIZE / 2 + CLEARANCE + 0.03) return false; // annulus clearance to foreign pads
			if (edge < VIA_DRILL / 2 + HOLE_GAP) return false; // via hole too close to any pad copper
			if (
				p.drill > 0 &&
				Math.hypot(x - p.x, y - p.y) < VIA_DRILL / 2 + p.drill / 2 + HOLE_GAP
			)
				return false; // hole-to-hole
		}
		for (const v of placedVias)
			if (Math.hypot(x - v.x, y - v.y) < VIA_SIZE + CLEARANCE + 0.03)
				return false;
		for (let l = 0; l < 2; l++) {
			for (let dr = -3; dr <= 3; dr++) {
				for (let dc = -3; dc <= 3; dc++) {
					const cc = c + dc;
					const rr = r + dr;
					if (cc < 0 || rr < 0 || cc >= W || rr >= H) return false;
					const o = owner[l][idx(cc, rr)];
					const dist = Math.hypot(dc, dr) * GRID;
					if (o === -1 || o === -2) {
						if (dist < VIA_SIZE / 2 + 0.2) return false;
					} else if (o !== 0 && o !== net) {
						if (dist <= VIA_SIZE / 2 + CLEARANCE + TRACK_W / 2 + 0.06)
							return false; // foreign track copper
					} else if (o === net && dist < VIA_DRILL / 2 + HOLE_GAP) {
						// own-net cells are fine for the annulus; the hole may not sit on a different net's copper (covered above)
					}
				}
			}
		}
		return true;
	};

	const tracks = [];
	const vias = [];
	const failed = [];

	// Copper pours connect their whole net by themselves. Only SMD pads on the far side need a via down to the pour.
	const zoneOf = new Map(
		(d.zones ?? [])
			.filter((z) => d.nets[z.net])
			.map((z) => [z.net, LAYERS.indexOf(z.layer)]),
	);
	const zoneLayers = new Set(zoneOf.values());
	const padLayersOf = (p) =>
		p.thru ? [0, 1] : p.layers.includes("F.Cu") ? [0] : [1];
	const zoneStubs = [];
	for (const [net, zl] of zoneOf)
		for (const pin of d.nets[net].pins) {
			const p = pads.get(pin);
			if (p && !padLayersOf(p).includes(zl))
				zoneStubs.push({ name: net, pins: [pin], size: 0, zoneGoal: zl });
		}

	const netList = Object.entries(d.nets)
		.filter(([name]) => !zoneOf.has(name))
		.filter(([, n]) => n.pins.filter((p) => pads.has(p)).length > 1)
		.map(([name, n]) => {
			const ps = n.pins.filter((p) => pads.has(p)).map((p) => pads.get(p));
			const bb = [
				Math.min(...ps.map((p) => p.x)),
				Math.max(...ps.map((p) => p.x)),
				Math.min(...ps.map((p) => p.y)),
				Math.max(...ps.map((p) => p.y)),
			];
			return {
				name,
				pins: n.pins.filter((p) => pads.has(p)),
				size: bb[1] - bb[0] + (bb[3] - bb[2]),
			};
		})
		.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
	if (orderSeed) netList.reverse();
	netList.unshift(...zoneStubs); // pours first: their vias claim space before the signals are routed

	for (const net of netList) {
		const id = netIds.get(net.name);
		const targets = net.pins.map((pin) => ({ pin, pad: pads.get(pin) }));
		// cells already connected to this net: start from the first pad
		const connected = new Map(); // key l|c|r -> true
		const first = targets[0];
		for (const l of padLayersOf(first.pad))
			connected.set(`${l}|${toCol(first.pad.x)}|${toRow(first.pad.y)}`, true);
		const remaining = targets.slice(1);
		const netTracks = [];
		const netVias = [];
		let ok = true;
		let reachedZone = false;

		while (remaining.length || (net.zoneGoal !== undefined && !reachedZone)) {
			// multi-source Dijkstra from connected cells to the nearest remaining pad
			const dist = new Float64Array(2 * W * H).fill(Infinity);
			const prev = new Int32Array(2 * W * H).fill(-1);
			const heap = new MinHeap();
			const key = (l, c, r) => (l * H + r) * W + c;
			for (const k of connected.keys()) {
				const [l, c, r] = k.split("|").map(Number);
				dist[key(l, c, r)] = 0;
				heap.push([0, l, c, r]);
			}
			const goal = new Map();
			remaining.forEach((t, i) => {
				for (const l of padLayersOf(t.pad))
					goal.set(key(l, toCol(t.pad.x), toRow(t.pad.y)), i);
			});
			let found = -1;
			let foundKey = -1;
			while (heap.size) {
				const [dd, l, c, r] = heap.pop();
				const kk = key(l, c, r);
				if (dd > dist[kk]) continue;
				if (net.zoneGoal !== undefined ? l === net.zoneGoal : goal.has(kk)) {
					found = net.zoneGoal !== undefined ? 0 : goal.get(kk);
					foundKey = kk;
					break;
				}
				for (const [dc, dr] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				]) {
					const nc = c + dc;
					const nr = r + dr;
					if (!passable(l, nc, nr, id)) continue;
					const nk = key(l, nc, nr);
					// bend penalty keeps tracks straighter
					const pk = prev[kk];
					const bend =
						pk >= 0 && Math.abs(((pk % W) | 0) - c) !== Math.abs(nc - c)
							? 0.3
							: 0;
					// signals keep off a copper pour's layer where they reasonably can
					const lean =
						net.zoneGoal === undefined && zoneLayers.has(l) ? 0.5 : 0;
					const nd = dd + 1 + bend + lean;
					if (nd < dist[nk]) {
						dist[nk] = nd;
						prev[nk] = kk;
						heap.push([nd, l, nc, nr]);
					}
				}
				const ol = 1 - l;
				if (passable(ol, c, r, id) && viaOk(c, r, id)) {
					const nk = key(ol, c, r);
					const nd = dd + VIA_COST;
					if (nd < dist[nk]) {
						dist[nk] = nd;
						prev[nk] = kk;
						heap.push([nd, ol, c, r]);
					}
				}
			}
			if (found < 0) {
				ok = false;
				break;
			}
			const viaStart = netVias.length;
			// walk back
			const cells = [];
			for (let k = foundKey; k >= 0; k = prev[k]) {
				const c = k % W;
				const r = Math.floor(k / W) % H;
				const l = Math.floor(k / (W * H));
				cells.push([l, c, r]);
				if (dist[k] === 0) break;
			}
			cells.reverse();
			const target = remaining[found];
			// split into per-layer runs, with vias where the layer changes
			let run = [];
			const flush = (layer) => {
				if (run.length < 1) return;
				const pts = run.map(([c, r]) => [cellX(c), cellY(r)]);
				netTracks.push({
					net: net.name,
					layer: LAYERS[layer],
					width: TRACK_W,
					points: pts,
				});
			};
			let curLayer = cells[0][0];
			for (const [l, c, r] of cells) {
				if (l !== curLayer) {
					flush(curLayer);
					netVias.push({
						net: net.name,
						x: cellX(c),
						y: cellY(r),
						size: VIA_SIZE,
						drill: VIA_DRILL,
					});
					run = [[c, r]];
					curLayer = l;
				} else run.push([c, r]);
			}
			flush(curLayer);
			// mark and connect
			for (const [l, c, r] of cells) {
				connected.set(`${l}|${c}|${r}`, true);
				for (let dr = -1; dr <= 1; dr++)
					for (let dc = -1; dc <= 1; dc++) stamp(l, c + dc, r + dr, id);
			}
			for (const v of netVias.slice(viaStart)) {
				// every via of this path reserves its whole keepout, on both layers
				for (let l = 0; l < 2; l++)
					for (let dr = -4; dr <= 4; dr++)
						for (let dc = -4; dc <= 4; dc++)
							if (Math.hypot(dc, dr) <= 3.01)
								stamp(l, toCol(v.x) + dc, toRow(v.y) + dr, id);
			}
			remaining.splice(found, 1);
			reachedZone = true;
			void target;
		}
		if (ok) {
			tracks.push(
				...netTracks
					.map((t) => ({ ...t, points: simplify(t.points) }))
					.filter((t) => t.points.length >= 2),
			);
			vias.push(...netVias);
		} else {
			failed.push(net.name);
			// leave this net unrouted; its partial cells stay stamped so we do not create shorts later
		}
	}

	// stubs from exact pad centres to the grid cell centre they snapped to
	const withStubs = tracks.map((t) => attachStubs(t, pads, design));
	return {
		tracks: withStubs,
		vias,
		failed: [...new Set(failed)],
		stats: {
			nets: netList.length,
			routed: netList.length - new Set(failed).size,
			grid: GRID,
			trackWidth: TRACK_W,
		},
	};
}

function simplify(points) {
	const out = [points[0]];
	for (let i = 1; i < points.length - 1; i++) {
		const a = out[out.length - 1];
		const b = points[i];
		const c = points[i + 1];
		if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]))
			continue;
		out.push(b);
	}
	out.push(points[points.length - 1]);
	return out;
}

function attachStubs(track, pads, design) {
	const pinsOnNet = design.data.nets[track.net].pins
		.map((p) => pads.get(p))
		.filter(Boolean);
	const pts = track.points.map((p) => [...p]);
	const snap = (end) => {
		const pt = pts[end === 0 ? 0 : pts.length - 1];
		const pad = pinsOnNet.find(
			(p) =>
				track.layer &&
				Math.abs(p.x - pt[0]) <= GRID * 0.75 &&
				Math.abs(p.y - pt[1]) <= GRID * 0.75 &&
				(p.thru || p.layers.includes(track.layer)),
		);
		if (!pad) return;
		const exact = [
			Math.round(pad.x * 1000) / 1000,
			Math.round(pad.y * 1000) / 1000,
		];
		if (exact[0] === pt[0] && exact[1] === pt[1]) return;
		// L-shaped stub (orthogonal) from the grid cell to the exact centre
		const corner = [exact[0], pt[1]];
		const stub =
			corner[0] === pt[0] || corner[1] === exact[1] ? [exact] : [corner, exact];
		if (end === 0) pts.unshift(...stub.slice().reverse());
		else pts.push(...stub);
	};
	snap(0);
	snap(1);
	return {
		...track,
		points: simplify(
			pts.map(([x, y]) => [
				Math.round(x * 1000) / 1000,
				Math.round(y * 1000) / 1000,
			]),
		),
	};
}
