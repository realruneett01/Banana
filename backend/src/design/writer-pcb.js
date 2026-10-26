import { getFootprint } from "./kicad-lib.js";
import { childLists } from "./sexp.js";
import { q, stableUuid } from "./sexp.js";

const f = (v) => String(Math.round(v * 10000) / 10000);
const ORIGIN = 20; // mm; keeps the board away from the page corner
const GAP = 1.5;

const LAYERS = `  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (33 "F.Adhes" user "F.Adhesive")
    (34 "B.Paste" user)
    (35 "F.Paste" user)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user)
    (39 "F.Mask" user)
    (40 "Dwgs.User" user "User.Drawings")
    (41 "Cmts.User" user "User.Comments")
    (44 "Edge.Cuts" user)
    (45 "Margin" user)
    (46 "B.CrtYd" user "B.Courtyard")
    (47 "F.CrtYd" user "F.Courtyard")
    (48 "B.Fab" user)
    (49 "F.Fab" user)
  )`;

/** Courtyard-aware shelf packing for parts the user has not placed. Deterministic. */
export function autoPlace(design, footprints) {
	const need = design.data.parts.filter((p) => !p.at && footprints.get(p.ref));
	const placed = new Map();
	if (need.length === 0) return placed;
	const area = need.reduce((s, p) => {
		const b = footprints.get(p.ref).bbox;
		return s + (b.maxX - b.minX + GAP) * (b.maxY - b.minY + GAP);
	}, 0);
	const targetWidth = Math.max(design.data.board ? design.data.board.width - 6 : 0, Math.sqrt(area * 2.2), 12);
	let x = ORIGIN + 3;
	let y = ORIGIN + 3;
	let rowH = 0;
	for (const p of [...need].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))) {
		const b = footprints.get(p.ref).bbox;
		const w = b.maxX - b.minX;
		const h = b.maxY - b.minY;
		if (x + w > ORIGIN + 3 + targetWidth && x > ORIGIN + 3) {
			x = ORIGIN + 3;
			y += rowH + GAP;
			rowH = 0;
		}
		placed.set(p.ref, { x: Math.round((x - b.minX) * 100) / 100, y: Math.round((y - b.minY) * 100) / 100, rot: 0 });
		x += w + GAP;
		rowH = Math.max(rowH, h);
	}
	return placed;
}

function rotatedBox(bbox, rot) {
	const pts = [[bbox.minX, bbox.minY], [bbox.maxX, bbox.minY], [bbox.maxX, bbox.maxY], [bbox.minX, bbox.maxY]];
	const r = (rot * Math.PI) / 180;
	const rp = pts.map(([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]);
	return { minX: Math.min(...rp.map((p) => p[0])), maxX: Math.max(...rp.map((p) => p[0])), minY: Math.min(...rp.map((p) => p[1])), maxY: Math.max(...rp.map((p) => p[1])) };
}

/** Rewrites a library footprint for placement in a board: position, reference/value, pad nets. */
const ATOM = '("(?:[^"\\\\]|\\\\.)*"|[^\\s()]+)';

/** Rewrites a library footprint for placement in a board: position, reference/value, pad nets. */
function instantiateFootprint({ libText, libId, ref, value, at, padNet, uuidSeed }) {
	let t = libText;
	t = t.replace(/\(version\s+\d+\)\s*/, "").replace(/\(generator(?:_version)?\s+[^)]*\)\s*/g, "").replace(/\(tedit\s+[0-9A-Fa-f]+\)\s*/, "");
	t = t.replace(new RegExp(`^\\(\\s*footprint\\s+${ATOM}`), `(footprint ${q(libId)}`);
	// first (layer F.Cu) belongs to the footprint itself (before any pad/graphic); library style may or may not quote it
	if (!/\(layer\s+"?F\.Cu"?\)/.test(t)) throw new Error(`Cannot place ${libId}: unsupported footprint layout`);
	t = t.replace(/\(layer\s+"?F\.Cu"?\)/, `(layer "F.Cu")\n  (at ${f(at.x)} ${f(at.y)}${at.rot ? ` ${at.rot}` : ""})\n  (tstamp ${stableUuid(`${uuidSeed}:fp`)})`);
	t = t.replace(new RegExp(`(\\(fp_text\\s+reference\\s+)${ATOM}`), `$1${q(ref)}`);
	t = t.replace(new RegExp(`(\\(fp_text\\s+value\\s+)${ATOM}`), `$1${q(value)}`);
	t = t.replace(new RegExp(`(\\(property\\s+"Reference"\\s+)${ATOM}`), `$1${q(ref)}`);
	t = t.replace(new RegExp(`(\\(property\\s+"Value"\\s+)${ATOM}`), `$1${q(value)}`);
	// drop 3D model references (path variables differ per install)
	for (const b of childLists(t).filter((c) => c.head === "model").reverse()) t = t.slice(0, b.start) + t.slice(b.end + 1);
	// attach nets to pads (edit from the end so offsets stay valid)
	const pads = childLists(t).filter((c) => c.head === "pad").reverse();
	for (const b of pads) {
		const raw = new RegExp(`^\\(\\s*pad\\s+${ATOM}`).exec(t.slice(b.start, b.start + 200))?.[1];
		const num = raw?.startsWith('"') ? raw.slice(1, -1) : raw;
		const net = padNet(num);
		if (net) t = `${t.slice(0, b.end)} (net ${net.id} ${q(net.name)})${t.slice(b.end)}`;
	}
	return t.split("\n").map((l) => `  ${l}`).join("\n");
}

export function writePcb(design) {
	const d = design.data;
	const netIds = new Map([["", 0]]);
	for (const name of Object.keys(d.nets).sort()) netIds.set(name, netIds.size);

	const netOfPin = new Map();
	for (const [name, net] of Object.entries(d.nets)) for (const p of net.pins) netOfPin.set(p, name);

	const footprints = new Map();
	for (const p of d.parts) if (p.footprint) footprints.set(p.ref, getFootprint(p.footprint));

	const auto = autoPlace(design, footprints);
	const positions = new Map();
	for (const p of d.parts) positions.set(p.ref, p.at || auto.get(p.ref));

	// board outline
	let board = d.board;
	let minX = ORIGIN;
	let minY = ORIGIN;
	if (!board) {
		let maxX = ORIGIN + 20;
		let maxY = ORIGIN + 20;
		for (const p of d.parts) {
			const fp = footprints.get(p.ref);
			const at = positions.get(p.ref);
			if (!fp || !at) continue;
			const b = rotatedBox(fp.bbox, at.rot || 0);
			maxX = Math.max(maxX, at.x + b.maxX);
			maxY = Math.max(maxY, at.y + b.maxY);
			minX = Math.min(minX, at.x + b.minX - 3);
			minY = Math.min(minY, at.y + b.minY - 3);
		}
		board = { width: Math.ceil(maxX + 3 - minX), height: Math.ceil(maxY + 3 - minY) };
	}

	const out = [
		`(kicad_pcb (version 20221018) (generator banana)`,
		`  (general (thickness 1.6))`,
		`  (paper "A4")`,
		LAYERS,
		`  (setup (pad_to_mask_clearance 0))`,
		`  (net 0 "")`,
		...[...netIds].filter(([n]) => n).map(([name, id]) => `  (net ${id} ${q(name)})`),
		`  (gr_rect (start ${f(minX)} ${f(minY)}) (end ${f(minX + board.width)} ${f(minY + board.height)}) (layer "Edge.Cuts") (width 0.1) (fill none) (tstamp ${stableUuid(`${d.name}:outline`)}))`,
	];

	for (const p of d.parts) {
		const fp = footprints.get(p.ref);
		if (!fp) continue;
		const at = positions.get(p.ref);
		out.push(
			instantiateFootprint({
				libText: fp.text,
				libId: p.footprint,
				ref: p.ref,
				value: p.value,
				at,
				uuidSeed: `${d.name}:${p.ref}`,
				padNet: (num) => {
					const net = netOfPin.get(`${p.ref}.${num}`);
					return net ? { id: netIds.get(net), name: net } : null;
				},
			}),
		);
	}

	d.tracks.forEach((t, ti) => {
		for (let i = 0; i + 1 < t.points.length; i++) {
			out.push(`  (segment (start ${f(t.points[i][0])} ${f(t.points[i][1])}) (end ${f(t.points[i + 1][0])} ${f(t.points[i + 1][1])}) (width ${t.width}) (layer ${q(t.layer)}) (net ${netIds.get(t.net)}) (tstamp ${stableUuid(`${d.name}:trk:${ti}:${i}`)}))`);
		}
	});
	d.vias.forEach((v, i) => {
		out.push(`  (via (at ${f(v.x)} ${f(v.y)}) (size ${v.size}) (drill ${v.drill}) (layers "F.Cu" "B.Cu") (net ${netIds.get(v.net)}) (tstamp ${stableUuid(`${d.name}:via:${i}`)}))`);
	});
	out.push(")", "");
	return { text: out.join("\n"), board: { ...board, originX: minX, originY: minY }, positions: Object.fromEntries(positions) };
}

export function writeProjectFile(name) {
	return `${JSON.stringify({ meta: { filename: `${name}.kicad_pro`, version: 1 }, board: { design_settings: { rules: { min_clearance: 0.2, min_track_width: 0.2 } } }, net_settings: { classes: [{ name: "Default", clearance: 0.2, track_width: 0.25, via_diameter: 0.8, via_drill: 0.4 }], meta: { version: 3 } }, sheets: [], text_variables: {} }, null, 2)}\n`;
}
