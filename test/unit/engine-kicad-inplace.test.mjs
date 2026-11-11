import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const SAMPLE_PCB = `(kicad_pcb
	(version 20240108)
	(generator "banana")
	(custom_vendor_block (version 1) (meta "keep-me"))
	(footprint "Resistor_SMD:R_0603"
		(layer "F.Cu")
		(at 10 20 45)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
	(footprint "Capacitor_SMD:C_0603"
		(layer "F.Cu")
		(at 50 60 90)
		(property "Reference" "C1")
		(property "Value" "100nF")
	)
)`;

const SAMPLE_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(custom_sch_block (type "note") (text "keep-me"))
	(symbol (lib_id "Device:R") (at 30 40 90)
		(property "Reference" "R1")
		(property "Value" "10k")
		(property "Footprint" "Resistor_SMD:R_0603")
	)
	(symbol (lib_id "Device:C") (at 70 80 0)
		(property "Reference" "C1")
		(property "Value" "100nF")
		(property "Footprint" "Capacitor_SMD:C_0603")
	)
)`;

const LEGACY_PCB = `(kicad_pcb
	(version 20200101)
	(module "Resistor_SMD:R_0603"
		(at 15 25)
		(fp_text reference "R1" (at 0 0))
		(fp_text value "1k" (at 0 1))
	)
)`;

const INVALID_REF_CASES = ["", "R 1", "R#1", "R".repeat(33)];
const INVALID_VALUE_CASES = [123, "a".repeat(201), "val\nline", "val\x00null"];
const INVALID_MOVE_CASES = [
	{ x: "10", y: 20 },
	{ x: 10, y: Number.NaN },
	{ x: 10, y: 20, rot: Number.POSITIVE_INFINITY },
	{ x: 10, y: 20, rot: "90" },
];

function findPartProperty(item, propName) {
	const prop = item.find(
		(c) =>
			Array.isArray(c) &&
			c.length >= 3 &&
			c[0]?.sym === "property" &&
			(c[1] === propName || c[1]?.sym === propName),
	);
	return prop ? prop[2] : null;
}

function findPartAt(item) {
	return item.find((c) => Array.isArray(c) && c[0]?.sym === "at") ?? null;
}

function getPcbFootprint(ast, ref) {
	return ast.slice(1).find((c) => {
		if (!Array.isArray(c)) return false;
		if (c[0]?.sym !== "footprint" && c[0]?.sym !== "module") return false;
		return findPartProperty(c, "Reference") === ref;
	});
}

function getSchSymbol(ast, ref) {
	return ast.slice(1).find((c) => {
		if (!Array.isArray(c) || c[0]?.sym !== "symbol") return false;
		return findPartProperty(c, "Reference") === ref;
	});
}

describe("patchKicadText - validation failures", () => {
	test("returns ok: false for non-string text", () => {
		const res = patchKicadText(12345, { kind: "pcb", edits: [] });
		assert.equal(res.ok, false);
		assert.ok(typeof res.error === "string");
	});

	test("returns ok: false for unparseable text", () => {
		const res = patchKicadText("(kicad_pcb (unclosed", {
			kind: "pcb",
			edits: [],
		});
		assert.equal(res.ok, false);
		assert.ok(typeof res.error === "string");
	});

	test("returns ok: false for wrong kind option", () => {
		const res = patchKicadText(SAMPLE_PCB, { kind: "invalid", edits: [] });
		assert.equal(res.ok, false);
		assert.match(res.error, /kind/i);
	});

	test("returns ok: false when root node does not match kind", () => {
		const res = patchKicadText(SAMPLE_SCH, { kind: "pcb", edits: [] });
		assert.equal(res.ok, false);
		assert.match(res.error, /root node/i);
	});

	test("returns ok: false when edits is not an array", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: "not-an-array",
		});
		assert.equal(res.ok, false);
		assert.match(res.error, /array/i);
	});
});

describe("patchKicadText - skipped edits", () => {
	test("skips unknown ref with plain-English reason", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "setValue", ref: "R99", value: "10k" }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 0);
		assert.equal(res.skipped.length, 1);
		assert.equal(res.skipped[0].index, 0);
		assert.match(res.skipped[0].reason, /unknown reference/i);
	});

	test("skips invalid ref formats", () => {
		for (let i = 0; i < INVALID_REF_CASES.length; i++) {
			const ref = INVALID_REF_CASES[i];
			const res = patchKicadText(SAMPLE_PCB, {
				kind: "pcb",
				edits: [{ op: "setValue", ref, value: "10k" }],
			});
			assert.equal(res.ok, true);
			assert.equal(res.applied, 0);
			assert.equal(res.skipped.length, 1);
			assert.match(res.skipped[0].reason, /invalid reference/i);
		}
	});

	test("skips unknown op with reason", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "deletePart", ref: "R1" }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 0);
		assert.equal(res.skipped.length, 1);
		assert.match(res.skipped[0].reason, /unknown operation/i);
	});

	test("skips invalid setValue values", () => {
		for (let i = 0; i < INVALID_VALUE_CASES.length; i++) {
			const val = INVALID_VALUE_CASES[i];
			const res = patchKicadText(SAMPLE_PCB, {
				kind: "pcb",
				edits: [{ op: "setValue", ref: "R1", value: val }],
			});
			assert.equal(res.ok, true);
			assert.equal(res.applied, 0);
			assert.equal(res.skipped.length, 1);
			assert.match(res.skipped[0].reason, /invalid value/i);
		}
	});

	test("skips invalid move numbers", () => {
		for (let i = 0; i < INVALID_MOVE_CASES.length; i++) {
			const coords = INVALID_MOVE_CASES[i];
			const res = patchKicadText(SAMPLE_PCB, {
				kind: "pcb",
				edits: [{ op: "move", ref: "R1", ...coords }],
			});
			assert.equal(res.ok, true);
			assert.equal(res.applied, 0);
			assert.equal(res.skipped.length, 1);
			assert.match(res.skipped[0].reason, /invalid coordinates/i);
		}
	});
});

describe("patchKicadText - pcb operations", () => {
	test("setValue updates footprint Value property", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "setValue", ref: "R1", value: "22k" }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);
		assert.equal(res.skipped.length, 0);

		const ast = parse(res.text);
		const r1 = getPcbFootprint(ast, "R1");
		assert.ok(r1);
		assert.equal(findPartProperty(r1, "Value"), "22k");
	});

	test("move updates footprint (at) coordinates and keeps rotation when omitted", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "move", ref: "R1", x: 12.5, y: 34.5 }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const ast = parse(res.text);
		const r1 = getPcbFootprint(ast, "R1");
		const at = findPartAt(r1);
		assert.deepEqual(at, [{ sym: "at" }, 12.5, 34.5, 45]);
	});

	test("move updates rotation when rot is specified", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "move", ref: "R1", x: 15, y: 25, rot: 180 }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const ast = parse(res.text);
		const r1 = getPcbFootprint(ast, "R1");
		const at = findPartAt(r1);
		assert.deepEqual(at, [{ sym: "at" }, 15, 25, 180]);
	});

	test("updates legacy module fp_text value", () => {
		const res = patchKicadText(LEGACY_PCB, {
			kind: "pcb",
			edits: [{ op: "setValue", ref: "R1", value: "4.7k" }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const ast = parse(res.text);
		const mod = ast.slice(1).find((c) => c[0]?.sym === "module");
		const valText = mod.find(
			(c) =>
				Array.isArray(c) &&
				c[0]?.sym === "fp_text" &&
				(c[1] === "value" || c[1]?.sym === "value"),
		);
		assert.equal(valText[2], "4.7k");
	});
});

describe("patchKicadText - sch operations", () => {
	test("setValue updates symbol Value property", () => {
		const res = patchKicadText(SAMPLE_SCH, {
			kind: "sch",
			edits: [{ op: "setValue", ref: "R1", value: "47k" }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const ast = parse(res.text);
		const r1 = getSchSymbol(ast, "R1");
		assert.ok(r1);
		assert.equal(findPartProperty(r1, "Value"), "47k");
	});

	test("move updates symbol (at) coordinates and keeps rotation when omitted", () => {
		const res = patchKicadText(SAMPLE_SCH, {
			kind: "sch",
			edits: [{ op: "move", ref: "R1", x: 55, y: 65 }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const ast = parse(res.text);
		const r1 = getSchSymbol(ast, "R1");
		const at = findPartAt(r1);
		assert.deepEqual(at, [{ sym: "at" }, 55, 65, 90]);
	});

	test("move updates rotation when rot is specified", () => {
		const res = patchKicadText(SAMPLE_SCH, {
			kind: "sch",
			edits: [{ op: "move", ref: "R1", x: 55, y: 65, rot: 270 }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const ast = parse(res.text);
		const r1 = getSchSymbol(ast, "R1");
		const at = findPartAt(r1);
		assert.deepEqual(at, [{ sym: "at" }, 55, 65, 270]);
	});
});

describe("patchKicadText - untouched nodes and AST fidelity", () => {
	test("untouched nodes and second footprint are deep-equal after re-parse", () => {
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "setValue", ref: "R1", value: "100k" }],
		});
		assert.equal(res.ok, true);

		const origAst = parse(SAMPLE_PCB);
		const newAst = parse(res.text);

		assert.deepEqual(newAst[1], origAst[1], "version node untouched");
		assert.deepEqual(newAst[2], origAst[2], "generator node untouched");
		assert.deepEqual(newAst[3], origAst[3], "custom node untouched");
		assert.deepEqual(newAst[5], origAst[5], "second footprint untouched");

		const origR1 = origAst[4];
		const newR1 = newAst[4];
		assert.deepEqual(newR1[1], origR1[1]);
		assert.deepEqual(newR1[2], origR1[2]);
		assert.deepEqual(newR1[3], origR1[3]);
		assert.deepEqual(newR1[4], origR1[4]);
	});

	test("untouched nodes in sch are deep-equal after re-parse", () => {
		const res = patchKicadText(SAMPLE_SCH, {
			kind: "sch",
			edits: [{ op: "move", ref: "R1", x: 99, y: 88, rot: 0 }],
		});
		assert.equal(res.ok, true);

		const origAst = parse(SAMPLE_SCH);
		const newAst = parse(res.text);

		assert.deepEqual(newAst[1], origAst[1]);
		assert.deepEqual(newAst[2], origAst[2]);
		assert.deepEqual(newAst[3], origAst[3]);
		assert.deepEqual(newAst[5], origAst[5]);
	});
});

describe("patchKicadText - security and escaping", () => {
	test("value containing quotes, parens and backslash round-trips without s-expression injection", () => {
		const trickyValue = '10k "special" (injected node) \\ path';
		const res = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: [{ op: "setValue", ref: "R1", value: trickyValue }],
		});
		assert.equal(res.ok, true);
		assert.equal(res.applied, 1);

		const origAst = parse(SAMPLE_PCB);
		const newAst = parse(res.text);

		const origR1 = origAst[4];
		const newR1 = newAst[4];
		assert.equal(
			newR1.length,
			origR1.length,
			"sibling node count must remain exactly the same",
		);

		const r1 = getPcbFootprint(newAst, "R1");
		assert.equal(findPartProperty(r1, "Value"), trickyValue);
	});
});

const MULTI_UNIT_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(symbol (lib_id "Amplifier_Operational:TL072") (at 10 20 0)
		(property "Reference" "U1")
		(property "Value" "TL072")
	)
	(symbol (lib_id "Amplifier_Operational:TL072") (at 30 40 0)
		(property "Reference" "U1")
		(property "Value" "TL072")
	)
	(symbol (lib_id "Device:R") (at 50 60 90)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

function getAllSchSymbols(ast, ref) {
	return ast.slice(1).filter((c) => {
		if (!Array.isArray(c)) return false;
		if (c[0]?.sym !== "symbol") return false;
		return findPartProperty(c, "Reference") === ref;
	});
}

describe("patchKicadText - multi-unit schematic symbols", () => {
	const cases = [
		{
			name: "setValue on a two-unit schematic symbol updates both units",
			edit: { op: "setValue", ref: "U1", value: "LM358" },
			verify: (res) => {
				assert.equal(res.ok, true);
				assert.equal(res.applied, 1);
				assert.equal(res.skipped.length, 0);
				const ast = parse(res.text);
				const symbols = getAllSchSymbols(ast, "U1");
				assert.equal(symbols.length, 2);
				for (const s of symbols) {
					assert.equal(findPartProperty(s, "Value"), "LM358");
				}
			},
		},
		{
			name: "move on a two-unit symbol is skipped with a reason and changes nothing",
			edit: { op: "move", ref: "U1", x: 99, y: 88 },
			verify: (res) => {
				assert.equal(res.ok, true);
				assert.equal(res.applied, 0);
				assert.equal(res.skipped.length, 1);
				assert.match(
					res.skipped[0].reason,
					/has several units and must be moved in the editor/i,
				);
				const ast = parse(res.text);
				const symbols = getAllSchSymbols(ast, "U1");
				assert.deepEqual(findPartAt(symbols[0]), [{ sym: "at" }, 10, 20, 0]);
				assert.deepEqual(findPartAt(symbols[1]), [{ sym: "at" }, 30, 40, 0]);
			},
		},
		{
			name: "single-unit behaviour unchanged for setValue",
			edit: { op: "setValue", ref: "R1", value: "20k" },
			verify: (res) => {
				assert.equal(res.ok, true);
				assert.equal(res.applied, 1);
				assert.equal(res.skipped.length, 0);
				const ast = parse(res.text);
				const r1 = getSchSymbol(ast, "R1");
				assert.equal(findPartProperty(r1, "Value"), "20k");
			},
		},
		{
			name: "single-unit behaviour unchanged for move",
			edit: { op: "move", ref: "R1", x: 75, y: 85, rot: 180 },
			verify: (res) => {
				assert.equal(res.ok, true);
				assert.equal(res.applied, 1);
				assert.equal(res.skipped.length, 0);
				const ast = parse(res.text);
				const r1 = getSchSymbol(ast, "R1");
				assert.deepEqual(findPartAt(r1), [{ sym: "at" }, 75, 85, 180]);
			},
		},
	];

	for (const tc of cases) {
		test(tc.name, () => {
			const res = patchKicadText(MULTI_UNIT_SCH, {
				kind: "sch",
				edits: [tc.edit],
			});
			tc.verify(res);
		});
	}
});
