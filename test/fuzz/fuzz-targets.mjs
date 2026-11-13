// Fuzz targets: each builds one input from the case RNG, runs the API and throws on a broken promise.
import assert from "node:assert/strict";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { kicadSchToIr } from "../../backend/src/engine/kicad-sch-to-ir.js";
import { parse, serialize } from "../../backend/src/engine/sexpr.js";
import { irToSpice } from "../../backend/src/engine/spice/ir-to-spice.js";
import { validateNetlist } from "../../backend/src/engine/spice/ngspice-runner.js";
import { findUnsafeSpiceLine, fixedId, mutateText } from "./fuzz-lib.mjs";

// Each target returns true when the case got past input rejection, so the suite can prove it is not vacuous.

// serialize() rounds to 6 decimals by design, so numbers compare with that tolerance.
function sameTree(a, b) {
	if (typeof a === "number" && typeof b === "number") {
		return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => sameTree(x, b[i]));
	}
	if (a?.sym !== undefined) return a.sym === b?.sym;
	return a === b;
}

function seedWindow(rng, text) {
	const start = rng.int(text.length);
	return text.slice(start, start + 1 + rng.int(4096));
}

function randomList(rng, depth) {
	if (depth > 4 || rng.chance(0.3)) return rng.pick(ATOMS);
	const len = rng.int(5);
	return Array.from({ length: len }, () => randomList(rng, depth + 1));
}

const ATOMS = [
	0,
	-1,
	1.5,
	1e21,
	1e-7,
	"",
	"a b",
	'q"\\',
	"\n",
	{ sym: "at" },
	{ sym: "x" },
];

function sexprInput(rng, seeds) {
	if (rng.chance(0.3)) return serialize([{ sym: "r" }, randomList(rng, 0)]);
	return mutateText(rng, seedWindow(rng, rng.pick(seeds.all)));
}

function fuzzSexpr(rng, seeds, sink) {
	const text = sexprInput(rng, seeds);
	sink.input = text;
	let tree;
	try {
		tree = parse(text);
	} catch (err) {
		assert.ok(
			err instanceof Error && !(err instanceof RangeError),
			String(err),
		);
		return false;
	}
	if (tree === null) return false;
	assert.ok(sameTree(parse(serialize(tree)), tree), "parse(serialize(x)) != x");
	return true;
}

function nodeAt(rng, tree) {
	let node = tree;
	for (let d = 0; d < 6; d++) {
		const kids = node.filter(Array.isArray);
		if (kids.length === 0 || rng.chance(0.25)) break;
		node = rng.pick(kids);
	}
	return node;
}

// Structural mutation keeps the file parseable so importers get past the tokenizer.
function mutateTree(rng, text) {
	const tree = parse(text);
	for (let i = 0; i < 1 + rng.int(6); i++) {
		const node = nodeAt(rng, tree);
		const at = 1 + rng.int(Math.max(node.length - 1, 1));
		const op = rng.int(3);
		if (op === 0) node.splice(at, 1);
		else if (op === 1) node.splice(at, 0, structuredClone(node[at] ?? 0));
		else node[at] = rng.pick(ATOMS);
	}
	return serialize(tree);
}

function mutateSeed(rng, text) {
	return rng.chance(0.5) ? mutateTree(rng, text) : mutateText(rng, text);
}

function assertResultObject(res) {
	assert.ok(res && typeof res === "object", "result is not an object");
	assert.equal(typeof res.ok, "boolean", "result.ok is not boolean");
}

function assertSafeSpice(ir) {
	const res = irToSpice(ir);
	assertResultObject(res);
	if (!res.ok) return false;
	assert.equal(
		findUnsafeSpiceLine(res.netlist),
		null,
		"irToSpice emitted unsafe SPICE",
	);
	assert.ok(
		validateNetlist(res.netlist).ok,
		"irToSpice output fails validateNetlist",
	);
	return true;
}

function importerTarget(importFn, seedKey) {
	return (rng, seeds, sink) => {
		const text = mutateSeed(rng, rng.pick(seeds[seedKey]));
		sink.input = text;
		const res = importFn(text);
		assertResultObject(res);
		if (!res.ok) return false;
		assertSafeSpice(res.ir);
		return true;
	};
}

const WILD = [
	"R1",
	"U1",
	"",
	"x".repeat(300),
	"10k\n.include /etc/passwd",
	"a\u0000b",
	0,
	-1,
	1e308,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	null,
	undefined,
	{},
	[],
	true,
];
const OPS = {
	sch: [
		"setValue",
		"move",
		"addSymbol",
		"deleteSymbol",
		"setField",
		"addLabel",
		"addNoConnect",
	],
	pcb: [
		"setValue",
		"move",
		"addFootprint",
		"deleteFootprint",
		"setFootprintField",
		"setPadNet",
		"addTrack",
		"addVia",
		"deleteTrack",
	],
};
const ANY_OP = [...OPS.sch, ...OPS.pcb, "bogus"];
// Plausible values keep a share of edits past validation and into the editors.
const SANE = {
	ref: "R1",
	value: "22k",
	x: 10,
	y: 20,
	rot: 90,
	net: "GND",
	name: "Value",
	libId: "Device:R",
	uuid: "00000000-0000-0000-0000-000000000001",
	pad: "1",
	layer: "F.Cu",
	width: 0.25,
	points: [{ x: 1, y: 2 }],
	side: "F",
};
const EDIT_FIELDS = [
	"ref",
	"value",
	"x",
	"y",
	"rot",
	"net",
	"name",
	"libId",
	"uuid",
	"pad",
	"layer",
	"width",
	"points",
	"side",
];

function randomEdit(rng, kind) {
	if (rng.chance(0.05)) return rng.pick(WILD);
	const edit = { op: rng.pick(rng.chance(0.85) ? OPS[kind] : ANY_OP) };
	for (const field of EDIT_FIELDS) {
		if (rng.chance(0.5))
			edit[field] = rng.chance(0.6) ? SANE[field] : rng.pick(WILD);
	}
	if (rng.chance(0.3)) edit.points = [{ x: rng.pick(WILD), y: rng.pick(WILD) }];
	return edit;
}

function fuzzPatch(rng, seeds, sink) {
	const kind = rng.pick(["sch", "pcb"]);
	const seed = rng.pick(seeds[kind]);
	const text = rng.chance(0.3) ? mutateText(rng, seed) : seed;
	const edits = Array.from({ length: 1 + rng.int(3) }, () =>
		randomEdit(rng, kind),
	);
	sink.input = { kind, edits, textHead: text.slice(0, 80) };
	const res = patchKicadText(text, {
		kind: rng.chance(0.9) ? kind : rng.pick(WILD),
		edits,
	});
	assertResultObject(res);
	if (res.ok)
		assert.ok(Array.isArray(parse(res.text)), "patched text does not parse");
	return res.ok;
}

const EVIL = [
	"\n.include /etc/passwd",
	"\r\n.control\nshell calc\n.endc",
	"\n+.lib x",
	"\nsystem rm",
	"\n*ng_script",
	"`id`",
	"$(id)",
	" ; .inc x",
];
const REFS = [
	"R",
	"C",
	"L",
	"V",
	"I",
	"D",
	"LED",
	"SW",
	"F",
	"U",
	"X",
	"Q",
	".",
	"+",
	"*",
];

function evil(rng, base) {
	return rng.chance(0.4) ? `${base}${rng.pick(EVIL)}` : String(base);
}

function randomPart(rng, i) {
	const props = {};
	for (const k of ["vout", "supplyCurrent", "voltage", "current", "closed"]) {
		if (rng.chance(0.2))
			props[k] = rng.chance(0.5) ? evil(rng, "5") : rng.pick(WILD);
	}
	if (rng.chance(0.2))
		props.pinRoles = { in: evil(rng, "1"), out: "3", gnd: "2", supply: "1" };
	return {
		id: fixedId("part", i),
		ref: evil(rng, `${rng.pick(REFS)}${i}`),
		value: evil(
			rng,
			rng.pick(["10k", "1u", "lm358", "7805", "ams1117-3.3", "atmega", "5V"]),
		),
		symbol: evil(rng, rng.pick(["Device:R", "Device:LED", "Device:D", ""])),
		footprint: "",
		props,
	};
}

function randomNet(rng, i, partCount) {
	const pins = Array.from({ length: 1 + rng.int(3) }, () => ({
		partId: fixedId("part", rng.int(partCount)),
		pin: rng.pick(["1", "2", "3", "A", "K", "VCC", "GND"]),
	}));
	return {
		id: fixedId("net", i),
		name: evil(rng, rng.pick(["GND", "VCC", "OUT", "0", "net"])),
		pins,
	};
}

function fuzzSpice(rng, _seeds, sink) {
	const partCount = 1 + rng.int(6);
	const ir = {
		schemaVersion: 1,
		name: evil(rng, "fuzz"),
		parts: Array.from({ length: partCount }, (_, i) => randomPart(rng, i)),
		nets: Array.from({ length: 1 + rng.int(5) }, (_, i) =>
			randomNet(rng, i, partCount),
		),
		constraints: [],
	};
	sink.input = ir;
	return assertSafeSpice(ir);
}

const SAFE_LINES = [
	"R1 a b 1k",
	"V1 a 0 DC 5",
	"* comment",
	".op",
	".tran 1u 1m",
	".save all",
	"+ 1k",
	".end",
];
const DANGER = [
	".include x",
	".inc x",
	".lib x 1",
	".control",
	"shell ls",
	"system ls",
	"*ng_script",
	".exec",
];
const LEADS = ["", " ", "\t", "+", "+ ", "\v", "\f", "\r", "  +\t"];

function obfuscate(rng, line) {
	const lead = rng.pick(LEADS);
	const cased = rng.chance(0.5) ? line.toUpperCase() : line;
	return lead + cased;
}

function fuzzNetlist(rng, _seeds, sink) {
	const lines = Array.from({ length: 1 + rng.int(8) }, () =>
		rng.chance(0.3) ? obfuscate(rng, rng.pick(DANGER)) : rng.pick(SAFE_LINES),
	);
	const netlist = lines.join(rng.pick(["\n", "\r\n"]));
	sink.input = netlist;
	const res = validateNetlist(netlist);
	assertResultObject(res);
	const unsafe = findUnsafeSpiceLine(netlist);
	if (res.ok)
		assert.equal(unsafe, null, "validateNetlist accepted unsafe SPICE");
	return res.ok;
}

export const TARGETS = {
	sexpr: fuzzSexpr,
	sch: importerTarget(kicadSchToIr, "sch"),
	pcb: importerTarget(kicadPcbToIr, "pcb"),
	patch: fuzzPatch,
	spice: fuzzSpice,
	netlist: fuzzNetlist,
};
