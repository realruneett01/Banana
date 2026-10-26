// The wired schematic: an independent geometric netlist extractor and KiCad's own netlister must both agree
// with the design on every generated circuit, and wires of different nets must never touch.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { randomCircuit } from "./design-helpers.js";
import { hasKicad, tmpDir } from "./helpers.js";

const work = tmpDir("banana-sch-");
process.env.BANANA_PROJECTS_DIR = work;
const { Design, emptyDesign } = await import("../backend/src/design/model.js");
const { findLibraryRoot, getSymbol } = await import(
	"../backend/src/design/kicad-lib.js"
);
const { writeSchematic } = await import("../backend/src/design/writer-sch.js");
const { layoutSchematic, CELL } = await import(
	"../backend/src/design/schematic-layout.js"
);
const { netlistParity } = await import("../backend/src/design/checks.js");

const libs = findLibraryRoot("symbols") && findLibraryRoot("footprints");
const skip = libs ? false : "KiCad libraries not installed";
const skipKicad = !libs
	? "KiCad libraries not installed"
	: !hasKicad()
		? "kicad-cli not installed"
		: false;
after(() => fs.rmSync(work, { recursive: true, force: true }));

const PAPER = {
	A4: [297, 210],
	A3: [420, 297],
	A2: [594, 420],
	A1: [841, 594],
	A0: [1189, 841],
};
const key = (x, y) =>
	`${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

/** Reads the written schematic and rebuilds connectivity from geometry alone, the way KiCad defines it. */
function extract(text) {
	const wires = [
		...text.matchAll(
			/\(wire \(pts \(xy ([\d.-]+) ([\d.-]+)\) \(xy ([\d.-]+) ([\d.-]+)\)\)/g,
		),
	].map((m) => m.slice(1, 5).map(Number));
	const junctions = [
		...text.matchAll(/\(junction \(at ([\d.-]+) ([\d.-]+)\)/g),
	].map((m) => [Number(m[1]), Number(m[2])]);
	const labels = [
		...text.matchAll(/\(label "([^"]+)" \(at ([\d.-]+) ([\d.-]+) /g),
	].map((m) => ({ name: m[1], x: Number(m[2]), y: Number(m[3]) }));
	const symbols = [];
	for (const m of text.matchAll(
		/\(symbol \(lib_id "([^"]+)"\) \(at ([\d.-]+) ([\d.-]+) ([\d.-]+)\) \(unit (\d+)\)[\s\S]*?\(property "Reference" "([^"]+)"[\s\S]*?\(property "Value" "([^"]*)"/g,
	))
		symbols.push({
			lib: m[1],
			x: Number(m[2]),
			y: Number(m[3]),
			rot: Number(m[4]),
			unit: Number(m[5]),
			ref: m[6],
			value: m[7],
		});
	const noConnects = [
		...text.matchAll(/\(no_connect \(at ([\d.-]+) ([\d.-]+)\)/g),
	].map((m) => [Number(m[1]), Number(m[2])]);

	const parent = new Map();
	const find = (a) => {
		if (!parent.has(a)) parent.set(a, a);
		while (parent.get(a) !== a) {
			parent.set(a, parent.get(parent.get(a)));
			a = parent.get(a);
		}
		return a;
	};
	const union = (a, b) => parent.set(find(a), find(b));
	const pinPoints = []; // {ref, number, k}
	const powerPins = []; // {value, k}
	for (const s of symbols) {
		const sym = getSymbol(s.lib);
		const th = (s.rot * Math.PI) / 180;
		const c = Math.round(Math.cos(th));
		const sn = Math.round(Math.sin(th));
		for (const p of sym.pins.filter((q) => q.unit === 0 || q.unit === s.unit)) {
			const k = key(s.x + p.x * c - p.y * sn, s.y - (p.x * sn + p.y * c));
			find(k);
			if (sym.isPower) {
				if (s.lib !== "power:PWR_FLAG") powerPins.push({ value: s.value, k });
			} else pinPoints.push({ ref: s.ref, number: p.number, k });
		}
	}
	for (const [x, y] of junctions) find(key(x, y));
	for (const l of labels) find(key(l.x, l.y));
	for (const w of wires) union(key(w[0], w[1]), key(w[2], w[3]));
	// anything sitting on the inside of a wire is connected to it
	const points = [...parent.keys()];
	const onSegment = (p, w) => {
		const [px, py] = p.split(",").map(Number);
		const [x1, y1, x2, y2] = w;
		const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
		if (Math.abs(cross) > 0.02) return false;
		return (
			px >= Math.min(x1, x2) - 0.01 &&
			px <= Math.max(x1, x2) + 0.01 &&
			py >= Math.min(y1, y2) - 0.01 &&
			py <= Math.max(y1, y2) + 0.01
		);
	};
	for (const w of wires)
		for (const p of points) if (onSegment(p, w)) union(p, key(w[0], w[1]));
	const byLabel = new Map();
	for (const l of labels) {
		if (byLabel.has(l.name)) union(key(l.x, l.y), byLabel.get(l.name));
		else byLabel.set(l.name, key(l.x, l.y));
	}
	const byPower = new Map();
	for (const p of powerPins) {
		if (byPower.has(p.value)) union(p.k, byPower.get(p.value));
		else byPower.set(p.value, p.k);
	}
	return {
		wires,
		junctions,
		labels,
		symbols,
		noConnects,
		pinPoints,
		powerPins,
		find,
		onSegment,
	};
}

function check(design, text, label) {
	const x = extract(text);
	const nets = design.data.nets;
	const netOfPin = new Map();
	for (const [n, def] of Object.entries(nets))
		for (const p of def.pins) netOfPin.set(p, n);
	const compOfNet = new Map();
	for (const p of x.pinPoints) {
		const n = netOfPin.get(`${p.ref}.${p.number}`);
		if (!n) continue;
		const comp = x.find(p.k);
		if (compOfNet.has(n))
			assert.equal(
				comp,
				compOfNet.get(n),
				`${label}: net ${n} is split (pin ${p.ref}.${p.number} is not joined to the rest)`,
			);
		else compOfNet.set(n, comp);
	}
	const seen = new Map();
	for (const [n, comp] of compOfNet) {
		assert.ok(
			!seen.has(comp),
			`${label}: nets ${seen.get(comp)} and ${n} are shorted together`,
		);
		seen.set(comp, n);
	}
	// every unrelated pin stays alone
	for (const p of x.pinPoints) {
		if (netOfPin.has(`${p.ref}.${p.number}`)) continue;
		assert.ok(
			!seen.has(x.find(p.k)),
			`${label}: unconnected pin ${p.ref}.${p.number} touches net ${seen.get(x.find(p.k))}`,
		);
	}
	// labels and power symbols name the net they sit on
	for (const l of x.labels)
		assert.equal(
			seen.get(x.find(key(l.x, l.y))) ?? l.name,
			l.name,
			`${label}: label ${l.name} sits on another net`,
		);
	for (const p of x.powerPins)
		assert.equal(
			seen.get(x.find(p.k)) ?? p.value,
			p.value,
			`${label}: power symbol ${p.value} sits on another net`,
		);
	return x;
}

const randomDesign = (seed, min = 3, max = 12) => {
	const d = new Design(emptyDesign("t"));
	randomCircuit(d, seed, { minParts: min, maxParts: max });
	return d;
};

test("independent geometry check: 150 random circuits have exactly the design's connectivity", {
	skip,
	timeout: 600000,
}, async (t) => {
	let wired = 0;
	let labelled = 0;
	for (let seed = 1; seed <= 150; seed++)
		await t.test(`seed ${seed}`, () => {
			const d = randomDesign(seed, 2, 14);
			const text = writeSchematic(d);
			check(d, text, `seed ${seed}`);
			const l = layoutSchematic(d);
			wired += l.stats.wiredNets;
			labelled += l.stats.labelledNets;
		});
	assert.ok(wired > 0, "some nets are drawn as wires");
	assert.ok(
		wired >= labelled,
		`wired ${wired} vs labelled ${labelled}: most nets should be wired`,
	);
});

test("KiCad's own netlister agrees on 120 random circuits", {
	skip: skipKicad,
	timeout: 900000,
}, async (t) => {
	for (let seed = 200; seed < 320; seed++)
		await t.test(`seed ${seed}`, async () => {
			const d = randomDesign(seed, 3, 14);
			const file = path.join(work, `s${seed}.kicad_sch`);
			fs.writeFileSync(file, writeSchematic(d));
			const r = await netlistParity(d, file);
			assert.equal(r.status, "ok", JSON.stringify(r).slice(0, 400));
		});
});

test("everything is on KiCad's 1.27 mm grid and inside the sheet", {
	skip,
	timeout: 300000,
}, async (t) => {
	for (let seed = 400; seed < 440; seed++)
		await t.test(`seed ${seed}`, () => {
			const d = randomDesign(seed, 3, 16);
			const l = layoutSchematic(d);
			const onGrid = (v) => Math.abs(v / CELL - Math.round(v / CELL)) < 1e-6;
			const [w, h] = PAPER[l.paper];
			for (const wire of l.wires) {
				for (const v of [wire.x1, wire.y1, wire.x2, wire.y2])
					assert.ok(onGrid(v), `wire coordinate ${v}`);
				assert.ok(
					wire.x1 === wire.x2 || wire.y1 === wire.y2,
					"wires are orthogonal",
				);
				assert.ok(
					Math.max(wire.x1, wire.x2) < w && Math.max(wire.y1, wire.y2) < h,
					"inside the sheet",
				);
			}
			for (const j of l.junctions) assert.ok(onGrid(j.x) && onGrid(j.y));
			for (const u of l.units)
				assert.ok(onGrid(u.ox) && onGrid(u.oy), `${u.part.ref} origin`);
		});
});

test("dense circuits fall back to labels instead of touching nets", {
	skip,
	timeout: 300000,
}, async (t) => {
	for (let seed = 500; seed < 520; seed++)
		await t.test(`seed ${seed}`, () => {
			const d = new Design(emptyDesign("dense"));
			randomCircuit(d, seed, { minParts: 18, maxParts: 30 });
			check(d, writeSchematic(d), `dense ${seed}`);
		});
});

test("hidden-risk shapes: no-connects, floating pins, a net on one pin, multi-pin buses", {
	skip,
}, () => {
	const d = new Design(emptyDesign("odd"));
	for (let i = 0; i < 4; i++)
		d.addPart({
			symbol: "Device:R",
			value: "1k",
			footprint: "Resistor_SMD:R_0805_2012Metric",
		});
	d.addPart({
		symbol: "Connector_Generic:Conn_01x04",
		value: "J",
		footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
	});
	d.connect("BUS", ["J1.1", "R1.1", "R2.1", "R3.1", "R4.1"]);
	d.connect("LONELY", ["R1.2", "R2.2"]);
	d.connect("GND", ["J1.4", "R3.2"]);
	d.setNetFlags("GND", { external: true });
	d.noConnect = ["R4.2"];
	check(d, writeSchematic(d), "odd");
});

test("rotation: library symbols turned by the layout still land their pins on the wires", {
	skip,
}, () => {
	const d = new Design(emptyDesign("rot"));
	d.addPart({
		symbol: "Device:Q_NPN_BCE",
		value: "BC847",
		footprint: "Package_TO_SOT_SMD:SOT-23",
	});
	d.addPart({
		symbol: "Device:R",
		value: "1k",
		footprint: "Resistor_SMD:R_0805_2012Metric",
	});
	d.addPart({
		symbol: "Device:LED",
		value: "RED",
		footprint: "LED_SMD:LED_0805_2012Metric",
	});
	d.connect("B", ["Q1.1", "R1.2"]);
	d.connect("C", ["Q1.2", "D1.2"]);
	d.connect("GND", ["Q1.3", "D1.1"]);
	d.setNetFlags("GND", { external: true });
	d.connect("IN", ["R1.1"]);
	const text = writeSchematic(d);
	check(d, text, "rot");
	assert.match(
		text,
		/\(at [\d.]+ [\d.]+ (90|270)\) \(unit 1\)/,
		"the resistor is turned horizontal",
	);
});

test("deterministic: the same design writes the same schematic", {
	skip,
}, () => {
	for (const seed of [1, 2, 3])
		assert.equal(
			writeSchematic(randomDesign(seed)),
			writeSchematic(randomDesign(seed)),
		);
});
