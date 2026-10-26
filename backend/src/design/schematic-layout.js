import { placeBoxes } from "./layout.js";
import { getSymbol } from "./kicad-lib.js";
import { isGroundName } from "./model.js";

/** KiCad's connection grid. Every pin, wire end and label sits on it. */
export const CELL = 1.27;
const TEXT_PAD = 6.35; // room right of a symbol for Reference/Value text (layout only)
const STUB = 2; // cells every pin leaves straight out before a wire may turn
const BEND = 3;
const PAPERS = [
	["A4", 297, 210],
	["A3", 420, 297],
	["A2", 594, 420],
	["A1", 841, 594],
	["A0", 1189, 841],
];
const round3 = (v) => Math.round(v * 1000) / 1000;

/** Unit vector (schematic space, Y down) pointing away from the symbol body for a library pin angle. */
function outward(angle) {
	switch (((angle % 360) + 360) % 360) {
		case 0:
			return [-1, 0];
		case 90:
			return [0, 1];
		case 180:
			return [1, 0];
		default:
			return [0, -1]; // 270
	}
}

const onGrid = (v) => Math.abs(v / CELL - Math.round(v / CELL)) < 1e-6;

/** Body box of one symbol unit relative to its origin (schematic space) from where its pins start and end. */
function unitBox(pins) {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of pins) {
		const r = (p.angle * Math.PI) / 180;
		const ends = [
			[p.x, -p.y],
			[p.x + Math.cos(r) * p.length, -(p.y + Math.sin(r) * p.length)],
		];
		for (const [x, y] of ends) {
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}
	}
	if (!Number.isFinite(minX))
		return { minX: -CELL, maxX: CELL, minY: -CELL, maxY: CELL };
	return {
		minX: minX - CELL,
		maxX: maxX + CELL,
		minY: minY - CELL,
		maxY: maxY + CELL,
	};
}

/** Pins as they appear with the symbol rotated counter-clockwise by `rot` degrees (symbol space is Y up). */
function rotatePins(pins, rot) {
	const r = (rot * Math.PI) / 180;
	const c = Math.round(Math.cos(r));
	const sn = Math.round(Math.sin(r));
	return pins.map((p) => ({
		...p,
		x: round3(p.x * c - p.y * sn),
		y: round3(p.x * sn + p.y * c),
		angle: (p.angle + rot) % 360,
	}));
}

/** Two-pin parts read best horizontal with the lower-numbered pin on the left. */
function initialRotation(pins) {
	if (pins.length !== 2) return 0;
	const vertical = pins.every((p) => p.angle % 180 === 90);
	if (!vertical) return 0;
	const first = [...pins].sort((a, b) =>
		a.number.localeCompare(b.number, undefined, { numeric: true }),
	)[0];
	return rotatePins([first], 90)[0].x < 0 ? 90 : 270;
}

class Heap {
	constructor() {
		this.f = [];
		this.s = [];
	}
	get size() {
		return this.f.length;
	}
	push(f, s) {
		let i = this.f.length;
		this.f.push(f);
		this.s.push(s);
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (this.f[p] <= f) break;
			this.f[i] = this.f[p];
			this.s[i] = this.s[p];
			i = p;
		}
		this.f[i] = f;
		this.s[i] = s;
	}
	pop() {
		const top = this.s[0];
		const lf = this.f.pop();
		const ls = this.s.pop();
		const n = this.f.length;
		if (n > 0) {
			let i = 0;
			for (;;) {
				let c = 2 * i + 1;
				if (c >= n) break;
				if (c + 1 < n && this.f[c + 1] < this.f[c]) c++;
				if (this.f[c] >= lf) break;
				this.f[i] = this.f[c];
				this.s[i] = this.s[c];
				i = c;
			}
			this.f[i] = lf;
			this.s[i] = ls;
		}
		return top;
	}
}

const DIRS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
];

/**
 * Lays out a schematic: symbols in connectivity-ordered columns, signal nets drawn as orthogonal wires on
 * the 1.27 mm grid, power pins given a short stub ending in a power symbol. Every cell belongs to at most one
 * net, so wires of different nets never touch or overlap; a net that cannot be drawn that way keeps net
 * labels on its pins (always electrically identical), so the result is correct even when it is not pretty.
 */
export function layoutSchematic(design) {
	const d = design.data;
	const netOf = new Map();
	for (const [name, net] of Object.entries(d.nets))
		for (const p of net.pins) netOf.set(p, name);
	const noConnect = new Set(d.noConnect);

	// ---- units ----
	const units = [];
	for (const part of d.parts) {
		const sym = getSymbol(part.symbol);
		const unitNumbers = sym.units.length > 1 ? sym.units : [1];
		for (const unit of unitNumbers) {
			const libPins = sym.pins.filter((p) => p.unit === 0 || p.unit === unit);
			units.push({
				part,
				sym,
				unit,
				key: unit === unitNumbers[0] ? part.ref : `${part.ref}#${unit}`,
				libPins,
				rot: initialRotation(libPins),
			});
		}
	}
	const orient = (u) => {
		u.pins = rotatePins(u.libPins, u.rot);
		u.box = unitBox(u.pins);
	};
	units.forEach(orient);
	const byKey = new Map(units.map((u) => [u.key, u]));
	const need = units.map((u) => ({
		ref: u.key,
		footprint: u.part.footprint,
		symbol: u.part.symbol,
	}));
	const placeOpts = {
		x0: 50.8,
		y0: 50.8,
		gapX: 22.86,
		gapY: 10.16,
		grid: CELL,
		minTargetH: 80,
		aspect: 1.6,
	};
	const place = () =>
		placeBoxes(
			design,
			need,
			(key) => {
				const b = byKey.get(key).box;
				return { ...b, maxX: b.maxX + TEXT_PAD };
			},
			placeOpts,
		);
	let origins = place();
	// turn each symbol around when that shortens its connections (connectors face the circuit, LEDs follow the current)
	const pinPoints = (u, rot, o) =>
		rotatePins(u.libPins, rot).map((p) => ({
			pin: p,
			x: o.x + p.x,
			y: o.y - p.y,
			out: outward(p.angle),
		}));
	const flipCost = (u, rot) => {
		const o = origins.get(u.key);
		let total = 0;
		for (const mine of pinPoints(u, rot, o)) {
			const net = netOf.get(`${u.part.ref}.${mine.pin.number}`);
			if (!net || noConnect.has(`${u.part.ref}.${mine.pin.number}`)) continue;
			const tx = mine.x + mine.out[0] * CELL * STUB;
			const ty = mine.y + mine.out[1] * CELL * STUB;
			if (d.nets[net].power) {
				// supply pins want to leave upward, ground pins downward
				const want = isGroundName(net) ? 1 : -1;
				if (mine.out[1] === -want) total += 4;
				continue;
			}
			for (const other of units) {
				if (other === u) continue;
				const oo = origins.get(other.key);
				for (const q of pinPoints(other, other.rot, oo)) {
					if (netOf.get(`${other.part.ref}.${q.pin.number}`) !== net) continue;
					const qx = q.x + q.out[0] * CELL * STUB;
					const qy = q.y + q.out[1] * CELL * STUB;
					total += (Math.abs(tx - qx) + Math.abs(ty - qy)) / CELL;
				}
			}
		}
		return total;
	};
	for (let pass = 0; pass < 2; pass++)
		for (const u of units) {
			const flipped = (u.rot + 180) % 360;
			if (flipCost(u, flipped) < flipCost(u, u.rot) - 1e-9) u.rot = flipped;
		}
	units.forEach(orient);
	origins = place();
	let extentX = 0;
	let extentY = 0;
	for (const u of units) {
		const o = origins.get(u.key);
		u.ox = o.x;
		u.oy = o.y;
		extentX = Math.max(extentX, o.x + u.box.maxX + TEXT_PAD);
		extentY = Math.max(extentY, o.y + u.box.maxY);
	}
	const [paper, pageW, pageH] =
		PAPERS.find(([, w, h]) => extentX + 30 <= w && extentY + 50 <= h) ??
		PAPERS.at(-1);
	const W = Math.floor(pageW / CELL);
	const H = Math.floor(pageH / CELL);

	// ---- grid ----
	const FREE = 0;
	const BLOCK = -1;
	const owner = new Int32Array(W * H);
	const idx = (i, j) => j * W + i;
	const inside = (i, j) => i >= 1 && j >= 1 && i < W - 1 && j < H - 1;
	const netIds = new Map(
		[...Object.keys(d.nets)].sort().map((n, k) => [n, k + 1]),
	);

	// pin instances
	const instances = [];
	for (const u of units) {
		for (const pin of u.pins) {
			const key = `${u.part.ref}.${pin.number}`;
			const x = round3(u.ox + pin.x);
			const y = round3(u.oy - pin.y);
			const out = outward(pin.angle);
			const inst = {
				id: `${key}@${u.unit}`,
				key,
				unit: u,
				pin,
				x,
				y,
				out,
				i: Math.round(x / CELL),
				j: Math.round(y / CELL),
				net: netOf.get(key) ?? null,
				nc: noConnect.has(key),
				gridOk: onGrid(x) && onGrid(y),
			};
			instances.push(inst);
		}
	}
	// symbol bodies are obstacles; each pin keeps a straight corridor out of its symbol
	for (const u of units) {
		const i0 = Math.round((u.ox + u.box.minX) / CELL);
		const i1 = Math.round((u.ox + u.box.maxX) / CELL);
		const j0 = Math.round((u.oy + u.box.minY) / CELL);
		const j1 = Math.round((u.oy + u.box.maxY) / CELL);
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) if (inside(i, j)) owner[idx(i, j)] = BLOCK;
	}
	for (const inst of instances) {
		inst.corridor = [];
		for (let k = 0; k <= STUB; k++)
			inst.corridor.push([inst.i + inst.out[0] * k, inst.j + inst.out[1] * k]);
		inst.tip = inst.corridor.at(-1);
		const id = inst.net && !inst.nc ? netIds.get(inst.net) : BLOCK;
		for (const [i, j] of inst.corridor)
			if (inside(i, j)) {
				const cur = owner[idx(i, j)];
				// two pins can never share a cell unless they are on the same net
				owner[idx(i, j)] =
					cur === FREE || cur === BLOCK || cur === id ? id : BLOCK;
			}
	}

	// ---- routing ----
	const stamp = new Int32Array(W * H * 5);
	const cost = new Float32Array(W * H * 5);
	const prev = new Int32Array(W * H * 5);
	let epoch = 0;

	/** Cheapest orthogonal path from any cell in `sources` to `goal` within this net's free cells. */
	function route(netId, sources, goal, bounds) {
		epoch++;
		const heap = new Heap();
		const h = (i, j) => Math.abs(i - goal[0]) + Math.abs(j - goal[1]);
		for (const [i, j] of sources) {
			const s = idx(i, j) * 5 + 4;
			stamp[s] = epoch;
			cost[s] = 0;
			prev[s] = -1;
			heap.push(h(i, j), s);
		}
		while (heap.size) {
			const s = heap.pop();
			const dir = s % 5;
			const cell = (s - dir) / 5;
			const i = cell % W;
			const j = (cell - i) / W;
			if (i === goal[0] && j === goal[1]) {
				const path = [];
				for (let t = s; t !== -1; t = prev[t]) {
					const c = (t - (t % 5)) / 5;
					const p = [c % W, Math.floor(c / W)];
					const last = path.at(-1);
					if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p);
				}
				return path.reverse();
			}
			const base = cost[s];
			for (let k = 0; k < 4; k++) {
				const ni = i + DIRS[k][0];
				const nj = j + DIRS[k][1];
				if (
					ni < bounds.i0 ||
					ni > bounds.i1 ||
					nj < bounds.j0 ||
					nj > bounds.j1
				)
					continue;
				if (!inside(ni, nj)) continue;
				const o = owner[idx(ni, nj)];
				if (o !== FREE && o !== netId) continue;
				const ns = idx(ni, nj) * 5 + k;
				const c = base + 1 + (dir !== 4 && dir !== k ? BEND : 0);
				if (stamp[ns] === epoch && cost[ns] <= c) continue;
				stamp[ns] = epoch;
				cost[ns] = c;
				prev[ns] = s;
				heap.push(c + h(ni, nj), ns);
			}
		}
		return null;
	}

	const edges = new Map(); // netName -> Set("i,j|i,j")
	const claim = (netId, cells) => {
		for (const [i, j] of cells) owner[idx(i, j)] = netId;
	};
	const labelled = new Set();
	const wiredNets = new Set();

	const byNet = new Map();
	for (const inst of instances) {
		if (!inst.net || inst.nc) continue;
		if (!byNet.has(inst.net)) byNet.set(inst.net, []);
		byNet.get(inst.net).push(inst);
	}
	const signalNets = [...byNet.entries()]
		.filter(([name]) => !d.nets[name].power)
		.sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));

	for (const [name, pins] of signalNets) {
		const netId = netIds.get(name);
		// one pin instance per distinct point; a net with a single point just gets a label
		if (
			pins.length < 2 ||
			pins.some((p) => !p.gridOk || !inside(p.tip[0], p.tip[1]))
		) {
			labelled.add(name);
			continue;
		}
		const snapshot = owner.slice(); // restore on failure so a half-drawn net blocks nothing
		const tree = [...pins[0].corridor];
		const netEdges = new Set();
		const localEdge = (a, b) =>
			netEdges.add(
				a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
					? `${a}|${b}`
					: `${b}|${a}`,
			);
		for (let k = 1; k < pins[0].corridor.length; k++)
			localEdge(pins[0].corridor[k - 1], pins[0].corridor[k]);
		const rest = pins.slice(1);
		let ok = true;
		while (rest.length && ok) {
			// nearest remaining pin to the tree first
			let best = 0;
			let bestD = Infinity;
			rest.forEach((p, n) => {
				for (const [i, j] of tree) {
					const dist = Math.abs(i - p.tip[0]) + Math.abs(j - p.tip[1]);
					if (dist < bestD) {
						bestD = dist;
						best = n;
					}
				}
			});
			const target = rest.splice(best, 1)[0];
			const margin = 25;
			const xs = [...pins.map((p) => p.tip[0]), ...tree.map((c) => c[0])];
			const ys = [...pins.map((p) => p.tip[1]), ...tree.map((c) => c[1])];
			const bounds = {
				i0: Math.max(1, Math.min(...xs) - margin),
				i1: Math.min(W - 2, Math.max(...xs) + margin),
				j0: Math.max(1, Math.min(...ys) - margin),
				j1: Math.min(H - 2, Math.max(...ys) + margin),
			};
			const path = route(netId, tree, target.tip, bounds);
			if (!path) {
				ok = false;
				break;
			}
			for (let k = 1; k < path.length; k++) localEdge(path[k - 1], path[k]);
			for (let k = 1; k < target.corridor.length; k++)
				localEdge(target.corridor[k - 1], target.corridor[k]);
			claim(netId, path);
			claim(netId, target.corridor);
			for (const c of path) tree.push(c);
			for (const c of target.corridor) tree.push(c);
		}
		if (!ok) {
			owner.set(snapshot);
			labelled.add(name);
			continue;
		}
		wiredNets.add(name);
		edges.set(name, netEdges);
	}

	// ---- power symbols: a short stub ending in the symbol, otherwise the symbol sits on the pin ----
	const powers = new Map(); // instance id -> {x, y, wire: [[x,y]...]|null}
	const powerInstances = instances
		.filter((p) => p.net && !p.nc && d.nets[p.net].power)
		.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
	for (const inst of powerInstances) {
		const ground = isGroundName(inst.net);
		const netId = netIds.get(inst.net);
		const approach = ground ? -1 : 1; // the symbol hangs below its connection point (GND) or rises above it
		const bodyDir = ground ? 1 : -1; // schematic Y grows downward
		let found = null;
		if (inst.gridOk && inside(inst.tip[0], inst.tip[1])) {
			const candidates = [];
			for (let dj = 0; dj <= 7; dj++)
				for (let di = -4; di <= 4; di++) candidates.push([di, dj * bodyDir]);
			candidates.sort(
				(a, b) =>
					Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])) ||
					a[1] * bodyDir - b[1] * bodyDir,
			);
			for (const [di, dj] of candidates) {
				const T = [inst.tip[0] + di, inst.tip[1] + dj];
				const A = [T[0], T[1] + (ground ? -1 : 1)]; // approach cell: wire arrives vertically
				// body cells: the symbol column below/above T plus its sides
				const body = [];
				for (let k = 0; k <= 2; k++)
					for (let s = -1; s <= 1; s++)
						body.push([T[0] + s, T[1] + k * bodyDir]);
				if (![T, A, ...body].every(([i, j]) => inside(i, j))) continue;
				const free = (c) =>
					owner[idx(c[0], c[1])] === FREE || owner[idx(c[0], c[1])] === netId;
				if (!body.every((c) => owner[idx(c[0], c[1])] === FREE) || !free(A))
					continue;
				const bounds = {
					i0: Math.max(1, Math.min(inst.tip[0], T[0]) - 6),
					i1: Math.min(W - 2, Math.max(inst.tip[0], T[0]) + 6),
					j0: Math.max(1, Math.min(inst.tip[1], T[1]) - 6),
					j1: Math.min(H - 2, Math.max(inst.tip[1], T[1]) + 6),
				};
				// the symbol body must not be crossed by its own wire: block it for the search
				for (const c of body) owner[idx(c[0], c[1])] = BLOCK;
				const path = route(netId, [inst.tip], A, bounds);
				for (const c of body) owner[idx(c[0], c[1])] = FREE;
				if (!path) continue;
				found = { T, path: [...path, T], body };
				break;
			}
		}
		if (found) {
			claim(netId, found.path);
			claim(netId, inst.corridor);
			for (const c of found.body) owner[idx(c[0], c[1])] = BLOCK;
			const wire = [...inst.corridor.slice(0, -1), ...found.path];
			powers.set(inst.id, {
				x: round3(found.T[0] * CELL),
				y: round3(found.T[1] * CELL),
				wire,
			});
		} else {
			powers.set(inst.id, { x: inst.x, y: inst.y, wire: null });
		}
	}

	// ---- wires, junctions, labels ----
	const wires = [];
	const junctions = [];
	const toMm = ([i, j]) => [round3(i * CELL), round3(j * CELL)];
	for (const name of [...wiredNets].sort()) {
		const set = edges.get(name);
		const deg = new Map();
		const adj = new Map();
		for (const e of set) {
			const [a, b] = e.split("|");
			for (const [p, q] of [
				[a, b],
				[b, a],
			]) {
				deg.set(p, (deg.get(p) ?? 0) + 1);
				if (!adj.has(p)) adj.set(p, []);
				adj.get(p).push(q);
			}
		}
		const pinCells = new Set(byNet.get(name).map((p) => `${p.i},${p.j}`));
		const corner = (p) => {
			const [a, b] = adj.get(p);
			if (adj.get(p).length !== 2) return true;
			const [pi, pj] = p.split(",").map(Number);
			const [ai, aj] = a.split(",").map(Number);
			const [bi, bj] = b.split(",").map(Number);
			return !((ai === bi && ai === pi) || (aj === bj && aj === pj));
		};
		const stop = (p) => deg.get(p) !== 2 || pinCells.has(p) || corner(p);
		for (const [p, n] of deg)
			if (n >= 3 || (n === 2 && pinCells.has(p))) {
				const [i, j] = p.split(",").map(Number);
				junctions.push({ net: name, x: round3(i * CELL), y: round3(j * CELL) });
			}
		// walk maximal straight runs between stop cells
		const seen = new Set();
		for (const [start] of deg) {
			if (!stop(start)) continue;
			for (const first of adj.get(start)) {
				const ek = [start, first].sort().join("#");
				if (seen.has(ek)) continue;
				let prevCell = start;
				let cur = first;
				seen.add(ek);
				while (!stop(cur)) {
					const nxt = adj.get(cur).find((c) => c !== prevCell);
					seen.add([cur, nxt].sort().join("#"));
					prevCell = cur;
					cur = nxt;
				}
				const a = toMm(start.split(",").map(Number));
				const b = toMm(cur.split(",").map(Number));
				wires.push({ net: name, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
			}
		}
	}
	for (const [id, p] of powers) {
		if (!p.wire) continue;
		const inst = instances.find((x) => x.id === id);
		const pts = p.wire;
		let a = pts[0];
		for (let k = 1; k < pts.length; k++) {
			const last = k === pts.length - 1;
			const straight =
				!last &&
				(pts[k][0] - pts[k - 1][0]) * (pts[k + 1][1] - pts[k][1]) ===
					(pts[k][1] - pts[k - 1][1]) * (pts[k + 1][0] - pts[k][0]);
			if (straight) continue;
			const [x1, y1] = toMm(a);
			const [x2, y2] = toMm(pts[k]);
			if (x1 !== x2 || y1 !== y2) wires.push({ net: inst.net, x1, y1, x2, y2 });
			a = pts[k];
		}
	}

	const labels = [];
	for (const name of [...byNet.keys()].sort()) {
		const pins = byNet.get(name);
		if (d.nets[name].power) continue;
		if (wiredNets.has(name)) {
			const p = pins[0];
			const [x, y] = toMm(p.tip);
			labels.push({ net: name, x, y, angle: labelAngle(p.pin.angle) });
		} else
			for (const p of pins)
				labels.push({
					net: name,
					x: p.x,
					y: p.y,
					angle: labelAngle(p.pin.angle),
				});
	}

	return {
		paper,
		units,
		instances,
		wires,
		junctions,
		labels,
		powers,
		stats: {
			wiredNets: wiredNets.size,
			labelledNets: labelled.size,
			powerStubs: [...powers.values()].filter((p) => p.wire).length,
		},
	};
}

/** Label text direction so it extends away from the symbol (cosmetic; connectivity does not depend on it). */
export function labelAngle(pinAngle) {
	return (
		{ 0: 180, 90: 270, 180: 0, 270: 90 }[((pinAngle % 360) + 360) % 360] ?? 0
	);
}
