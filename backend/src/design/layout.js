import { isGroundName } from "./model.js";

const ORIGIN = 20; // mm; matches the board origin in writer-pcb.js
const MARGIN = 3;
const GAP_Y = 1.5; // between parts in a column
const GAP_X = 3; // routing channel between columns
const GRID = 0.5;

const snap = (v) => Math.round(v / GRID) * GRID;
const round2 = (v) => Math.round(v * 100) / 100;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

const isConnector = (part) =>
	/^(J|P|CN|X|CON)\d/i.test(part.ref) ||
	/^Connector/i.test(part.footprint || part.symbol || "");

/**
 * Signal graph between parts: nets that are not power rails, weighted 1/(pins-1) so a two-pin net binds
 * its parts tightly and a wide bus barely does. Power nets are kept separately (used only to attach
 * parts that have no signal connection, e.g. decoupling capacitors).
 */
function buildGraphs(design, refs) {
	const signal = new Map(refs.map((r) => [r, new Map()]));
	const power = new Map(refs.map((r) => [r, new Map()])); // ref -> Map(netName -> size)
	for (const [name, net] of Object.entries(design.data.nets)) {
		const members = [
			...new Set(net.pins.map((p) => p.slice(0, p.lastIndexOf(".")))),
		].filter((r) => signal.has(r));
		if (members.length < 2) continue;
		const isPower = net.power || isGroundName(name);
		if (isPower) {
			for (const r of members) power.get(r).set(name, members.length);
			continue;
		}
		const w = 1 / (members.length - 1);
		for (const a of members)
			for (const b of members)
				if (a !== b) signal.get(a).set(b, (signal.get(a).get(b) ?? 0) + w);
	}
	return { signal, power };
}

function assignLayers(parts, signal, power) {
	const layer = new Map();
	const degree = (r) => [...signal.get(r).values()].reduce((s, v) => s + v, 0);
	const refs = parts.map((p) => p.ref).sort(natural);
	const bfs = (starts, base) => {
		const queue = [...starts];
		for (const s of starts) layer.set(s, base);
		while (queue.length) {
			const cur = queue.shift();
			for (const n of [...signal.get(cur).keys()].sort(natural))
				if (!layer.has(n)) {
					layer.set(n, layer.get(cur) + 1);
					queue.push(n);
				}
		}
	};
	const connectors = parts
		.filter(isConnector)
		.map((p) => p.ref)
		.sort(natural);
	for (const c of connectors) layer.set(c, 0);
	bfs(
		connectors.filter((c) => signal.get(c).size > 0),
		0,
	);
	const base = connectors.length ? 1 : 0;
	const componentOf = (start) => {
		const seen = new Set([start]);
		const stack = [start];
		while (stack.length) {
			const cur = stack.pop();
			for (const n of signal.get(cur).keys())
				if (!seen.has(n) && !layer.has(n)) {
					seen.add(n);
					stack.push(n);
				}
		}
		return [...seen];
	};
	const powerLinks = (r) => {
		let count = 0;
		for (const netName of power.get(r).keys())
			if (connectors.some((c) => power.get(c).has(netName)))
				count += isGroundName(netName) ? 1 : 2; // supply side first, ground side after
		return count;
	};
	// components that never reach a connector start next to the connectors they share power rails with
	for (;;) {
		const rest = refs
			.filter((r) => !layer.has(r) && signal.get(r).size > 0)
			.sort((a, b) => degree(b) - degree(a) || natural(a, b));
		if (!rest.length) break;
		const members = componentOf(rest[0]);
		const seed = members.sort(
			(a, b) =>
				powerLinks(b) - powerLinks(a) || degree(b) - degree(a) || natural(a, b),
		)[0];
		bfs([seed], base);
	}
	// parts with no signal edges follow the part they share the smallest power net with
	for (let progress = true; progress; ) {
		progress = false;
		for (const r of refs) {
			if (layer.has(r)) continue;
			let best = null;
			for (const [netName, size] of power.get(r)) {
				for (const o of refs) {
					if (o === r || !layer.has(o) || !power.get(o).has(netName)) continue;
					if (
						!best ||
						size < best.size ||
						(size === best.size && natural(o, best.ref) < 0)
					)
						best = { ref: o, size };
				}
			}
			if (best) {
				layer.set(r, layer.get(best.ref));
				progress = true;
			}
		}
	}
	for (const r of refs) if (!layer.has(r)) layer.set(r, 0);
	return layer;
}

/**
 * Connectivity-aware layered placement for parts without a position: connectors on the left, then one
 * column per distance from them (power rails ignored), parts ordered inside a column by the barycentre of
 * their neighbours so connected parts sit across from each other and routes stay short. Deterministic,
 * on a 0.5 mm grid, and never on top of parts the user already placed.
 */
export function layeredPlace(design, footprints) {
	const need = design.data.parts.filter((p) => !p.at && footprints.get(p.ref));
	const placed = new Map();
	if (need.length === 0) return placed;
	const refs = need.map((p) => p.ref);
	const size = new Map(
		need.map((p) => {
			const b = footprints.get(p.ref).bbox;
			return [p.ref, { w: b.maxX - b.minX, h: b.maxY - b.minY, b }];
		}),
	);
	const { signal, power } = buildGraphs(design, refs);
	const layers = assignLayers(need, signal, power);

	// avoid parts the user already placed
	const fixed = design.data.parts.filter((p) => p.at && footprints.get(p.ref));
	let x0 = ORIGIN + MARGIN;
	let y0 = ORIGIN + MARGIN;
	if (fixed.length) {
		let fx = -Infinity;
		let fy = -Infinity;
		let nx = Infinity;
		let ny = Infinity;
		for (const p of fixed) {
			const b = footprints.get(p.ref).bbox;
			const r = (p.at.rot || 0) % 180 !== 0;
			const w = r ? b.maxY - b.minY : b.maxX - b.minX;
			const h = r ? b.maxX - b.minX : b.maxY - b.minY;
			fx = Math.max(fx, p.at.x + Math.max(w, h));
			fy = Math.max(fy, p.at.y + Math.max(w, h));
			nx = Math.min(nx, p.at.x - Math.max(w, h));
			ny = Math.min(ny, p.at.y - Math.max(w, h));
		}
		if (fx - nx >= fy - ny) y0 = Math.max(y0, fy + GAP_Y + 1);
		else x0 = Math.max(x0, fx + GAP_X);
	}

	const area = need.reduce(
		(s, p) => s + (size.get(p.ref).w + GAP_Y) * (size.get(p.ref).h + GAP_Y),
		0,
	);
	const maxPartH = Math.max(...need.map((p) => size.get(p.ref).h));
	const targetH = Math.max(
		design.data.board ? design.data.board.height - 2 * MARGIN : 0,
		Math.sqrt(area) * 1.3,
		maxPartH,
		10,
	);

	// columns by layer, ordered by neighbour barycentre (a few sweeps both ways)
	const layerIds = [...new Set(refs.map((r) => layers.get(r)))].sort(
		(a, b) => a - b,
	);
	const columns = new Map(
		layerIds.map((l) => [
			l,
			refs.filter((r) => layers.get(r) === l).sort(natural),
		]),
	);
	const order = new Map();
	const reindex = () => {
		for (const col of columns.values()) {
			const total = col.length;
			col.forEach((r, i) => order.set(r, (i + 0.5) / total));
		}
	};
	reindex();
	const sweep = (ids) => {
		for (const l of ids) {
			const col = columns.get(l);
			const key = (r) => {
				let sum = 0;
				let weight = 0;
				for (const [n, w] of signal.get(r)) {
					if (layers.get(n) === l) continue; // same column: no pull
					sum += order.get(n) * w;
					weight += w;
				}
				return weight ? sum / weight : order.get(r);
			};
			const keys = new Map(col.map((r) => [r, key(r)]));
			col.sort((a, b) => keys.get(a) - keys.get(b) || natural(a, b));
			reindex();
		}
	};
	for (let i = 0; i < 4; i++) {
		sweep(layerIds.slice(1));
		sweep([...layerIds].reverse().slice(1));
	}

	// split tall columns, then give every column a width
	const cols = [];
	for (const l of layerIds) {
		let cur = [];
		let h = 0;
		for (const r of columns.get(l)) {
			const rh = size.get(r).h;
			if (cur.length && h + rh > targetH) {
				cols.push(cur);
				cur = [];
				h = 0;
			}
			cur.push(r);
			h += rh + GAP_Y;
		}
		if (cur.length) cols.push(cur);
	}
	const colHeight = (c) =>
		c.reduce((s, r) => s + size.get(r).h, 0) + GAP_Y * (c.length - 1);
	const tallest = Math.max(...cols.map(colHeight));
	let x = x0;
	for (const col of cols) {
		const colW = Math.max(...col.map((r) => size.get(r).w));
		let y = y0 + (tallest - colHeight(col)) / 2;
		for (const r of col) {
			const { w, h, b } = size.get(r);
			placed.set(r, {
				x: round2(snap(x + (colW - w) / 2 - b.minX)),
				y: round2(snap(y - b.minY)),
				rot: 0,
			});
			y += h + GAP_Y;
		}
		x += colW + GAP_X;
	}
	return placed;
}

/** Half-perimeter wirelength over part origins: the standard quick placement-quality measure. */
export function estimateWirelength(design, positions) {
	let total = 0;
	for (const net of Object.values(design.data.nets)) {
		const pts = [];
		for (const pin of net.pins) {
			const at = positions[pin.slice(0, pin.lastIndexOf("."))];
			if (at) pts.push(at);
		}
		if (pts.length < 2) continue;
		const xs = pts.map((p) => p.x);
		const ys = pts.map((p) => p.y);
		total +=
			Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
	}
	return total;
}
