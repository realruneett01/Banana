// Minimal repros of bugs the fuzz suite found; fast, so they run in the default npm test.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { applyPcbEdits } from "../../backend/src/engine/kicad-pcb-edit.js";
import { parse, serialize } from "../../backend/src/engine/sexpr.js";
import { irToSpice } from "../../backend/src/engine/spice/ir-to-spice.js";
import { validateNetlist } from "../../backend/src/engine/spice/ngspice-runner.js";

function nested(head, depth) {
	return `(${head} ${"(".repeat(depth)}${")".repeat(depth)})`;
}

describe("fuzz regressions: deep nesting", () => {
	test("parse rejects nesting deeper than the limit with a plain Error", () => {
		assert.throws(
			() => parse(nested("kicad_pcb", 3000)),
			(err) => !(err instanceof RangeError) && /nesting/i.test(err.message),
		);
	});

	test("nesting at the limit still parses and serializes", () => {
		const tree = parse(nested("kicad_pcb", 999));
		assert.deepEqual(parse(serialize(tree)), tree);
	});

	const editors = {
		patchKicadText: (text) =>
			patchKicadText(text, {
				kind: "pcb",
				edits: [{ op: "move", ref: "R1", x: 1, y: 1 }],
			}),
		applyPcbEdits: (text) =>
			applyPcbEdits(text, [{ op: "addVia", net: "A", x: 1, y: 1 }]),
	};
	for (const [name, edit] of Object.entries(editors)) {
		test(`${name} returns a result object instead of a stack overflow`, () => {
			assert.equal(edit(nested("kicad_pcb", 3000)).ok, false);
		});
	}
});

const EMPTY_PCB = "(kicad_pcb (version 20240108))";
const ABSURD_EDITS = {
	"addVia y=1e308": { op: "addVia", net: "GND", x: 10, y: 1e308 },
	"addVia huge size": { op: "addVia", net: "GND", x: 1, y: 1, size: 1e308 },
	"addVia huge drill": { op: "addVia", net: "GND", x: 1, y: 1, drill: 1e9 },
	"addTrack far point": {
		op: "addTrack",
		net: "GND",
		layer: "F.Cu",
		width: 0.25,
		points: [
			{ x: 0, y: 0 },
			{ x: 1e308, y: 1 },
		],
	},
	"addTrack huge width": {
		op: "addTrack",
		net: "GND",
		layer: "F.Cu",
		width: 1e308,
		points: [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		],
	},
};

describe("fuzz regressions: absurd PCB coordinates", () => {
	for (const [name, edit] of Object.entries(ABSURD_EDITS)) {
		test(`applyPcbEdits ${name} -> ok:false`, () => {
			const res = applyPcbEdits(EMPTY_PCB, [edit]);
			assert.equal(res.ok, false);
			assert.equal(typeof res.error, "string");
		});
	}

	test("patchKicadText addVia y=1e308 -> ok:false", () => {
		const edits = [ABSURD_EDITS["addVia y=1e308"]];
		assert.equal(patchKicadText(EMPTY_PCB, { kind: "pcb", edits }).ok, false);
	});

	test("a sane via is still added", () => {
		const res = applyPcbEdits(EMPTY_PCB, [
			{ op: "addVia", net: "GND", x: 10, y: 20 },
		]);
		assert.equal(res.ok, true);
		assert.match(res.text, /\(via/);
	});
});

function oneResistorIr(name) {
	const id = (kind, n) => `${kind}_00000000-0000-0000-0000-00000000000${n}`;
	const pin = (n) => [{ partId: id("part", 1), pin: String(n) }];
	return {
		schemaVersion: 1,
		name,
		parts: [
			{
				id: id("part", 1),
				ref: "R1",
				value: "1k",
				symbol: "Device:R",
				footprint: "",
				props: {},
			},
		],
		nets: [
			{ id: id("net", 1), name: "A", pins: pin(1) },
			{ id: id("net", 2), name: "GND", pins: pin(2) },
		],
		constraints: [],
	};
}

describe("fuzz regressions: irToSpice title vs validateNetlist", () => {
	for (const name of [
		"fuzz$(id)",
		"$$((x",
		"ng_script",
		" ng_script x",
		"a\u0000b",
		"q`id`",
		"*ng_script",
	]) {
		test(`circuit name ${JSON.stringify(name)} yields a netlist validateNetlist accepts`, () => {
			const res = irToSpice(oneResistorIr(name));
			assert.equal(res.ok, true);
			assert.deepEqual(validateNetlist(res.netlist), { ok: true });
		});
	}

	test("an ordinary name is kept in the title", () => {
		const res = irToSpice(oneResistorIr("Amp rev2"));
		assert.equal(res.netlist.split("\n")[0], "* Amp rev2");
	});
});

describe("fuzz regressions: validateNetlist", () => {
	for (const line of ["system ls", "  SYSTEM ls", "+ system ls"]) {
		test(`rejects ${JSON.stringify(line)}`, () => {
			assert.equal(validateNetlist(`* t\nR1 a 0 1k\n${line}\n.end`).ok, false);
		});
	}
});
