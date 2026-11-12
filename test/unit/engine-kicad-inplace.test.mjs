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

const INVALID_REF_CASES = ["", "R 1", "R#1", "R".repeat(33)];
const INVALID_VALUE_CASES = [123, "a".repeat(201), "val\nline", "val\x00null"];
const INVALID_MOVE_CASES = [
	{ x: "10", y: 20 },
	{ x: 10, y: Number.NaN },
	{ x: 10, y: 20, rot: Number.POSITIVE_INFINITY },
	{ x: 10, y: 20, rot: "90" },
];

const PCB_PART_SYMS = ["footprint", "module"];
const SCH_PART_SYMS = ["symbol"];

function isPropertyMatch(node, propName) {
	if (!Array.isArray(node) || node.length < 3) return false;
	if (node[0]?.sym !== "property") return false;
	const key = node[1]?.sym ?? node[1];
	return key === propName;
}

function findPartProperty(item, propName) {
	const prop = item.find((c) => isPropertyMatch(c, propName));
	return prop ? prop[2] : null;
}

function findPartAt(item) {
	return item.find((c) => Array.isArray(c) && c[0]?.sym === "at") ?? null;
}

function matchesRef(node, allowedSyms, ref) {
	if (!Array.isArray(node)) return false;
	const sym = node[0]?.sym;
	if (!allowedSyms.includes(sym)) return false;
	return findPartProperty(node, "Reference") === ref;
}

function getPcbFootprint(ast, ref) {
	return ast.slice(1).find((c) => matchesRef(c, PCB_PART_SYMS, ref));
}

function getSchSymbol(ast, ref) {
	return ast.slice(1).find((c) => matchesRef(c, SCH_PART_SYMS, ref));
}

function getAllSchSymbols(ast, ref) {
	return ast.slice(1).filter((c) => matchesRef(c, SCH_PART_SYMS, ref));
}

function isLegacyValueText(node) {
	if (!Array.isArray(node)) return false;
	if (node[0]?.sym !== "fp_text") return false;
	const key = node[1]?.sym ?? node[1];
	return key === "value";
}

function assertValidationFailure(res, expected) {
	assert.equal(res.ok, false);
	if (expected instanceof RegExp) {
		assert.match(res.error, expected);
		return;
	}
	assert.ok(typeof res.error === "string");
}

function assertSkipped(res, pattern, index) {
	assert.equal(res.ok, true);
	assert.equal(res.applied, 0);
	assert.equal(res.skipped.length, 1);
	if (index !== undefined) {
		assert.equal(res.skipped[0].index, index);
	}
	assert.match(res.skipped[0].reason, pattern);
}

function assertSuccessfulRes(res) {
	assert.equal(res.ok, true);
	assert.equal(res.applied, 1);
	assert.equal(res.skipped.length, 0);
}

function executeSuccessfulEdit(text, kind, edit) {
	const res = patchKicadText(text, { kind, edits: [edit] });
	assertSuccessfulRes(res);
	return parse(res.text);
}

function assertPartValue(part, expected) {
	assert.ok(part);
	assert.equal(findPartProperty(part, "Value"), expected);
}

function assertPartAt(part, expectedAt) {
	assert.deepEqual(findPartAt(part), expectedAt);
}

function assertAstSubtreeEquality(actualAst, expectedAst, indices) {
	for (const idx of indices) {
		assert.deepEqual(actualAst[idx], expectedAst[idx]);
	}
}

function checkSkippedEdit(edit, pattern, index) {
	const res = patchKicadText(SAMPLE_PCB, {
		kind: "pcb",
		edits: [edit],
	});
	assertSkipped(res, pattern, index);
}

describe("patchKicadText - validation failures", () => {
	function checkFailure(text, opts, expected) {
		const res = patchKicadText(text, opts);
		assertValidationFailure(res, expected);
	}

	test("returns ok: false for non-string text", () => {
		checkFailure(12345, { kind: "pcb", edits: [] });
	});

	test("returns ok: false for unparseable text", () => {
		checkFailure("(kicad_pcb (unclosed", { kind: "pcb", edits: [] });
	});

	test("returns ok: false for wrong kind option", () => {
		checkFailure(SAMPLE_PCB, { kind: "invalid", edits: [] }, /kind/i);
	});

	test("returns ok: false when root node does not match kind", () => {
		checkFailure(SAMPLE_SCH, { kind: "pcb", edits: [] }, /root node/i);
	});

	test("returns ok: false when edits is not an array", () => {
		checkFailure(SAMPLE_PCB, { kind: "pcb", edits: "not-an-array" }, /array/i);
	});
});

describe("patchKicadText - skipped edits", () => {
	test("skips unknown ref with plain-English reason", () => {
		checkSkippedEdit(
			{ op: "setValue", ref: "R99", value: "10k" },
			/unknown reference/i,
			0,
		);
	});

	test("skips invalid ref formats", () => {
		for (const ref of INVALID_REF_CASES) {
			checkSkippedEdit(
				{ op: "setValue", ref, value: "10k" },
				/invalid reference/i,
			);
		}
	});

	test("skips unknown op with reason", () => {
		checkSkippedEdit({ op: "deletePart", ref: "R1" }, /unknown operation/i);
	});

	test("skips invalid setValue values", () => {
		for (const val of INVALID_VALUE_CASES) {
			checkSkippedEdit(
				{ op: "setValue", ref: "R1", value: val },
				/invalid value/i,
			);
		}
	});

	test("skips invalid move numbers", () => {
		for (const coords of INVALID_MOVE_CASES) {
			checkSkippedEdit(
				{ op: "move", ref: "R1", ...coords },
				/invalid coordinates/i,
			);
		}
	});
});

describe("patchKicadText - pcb operations", () => {
	function patchPcb(edit) {
		const ast = executeSuccessfulEdit(SAMPLE_PCB, "pcb", edit);
		return getPcbFootprint(ast, "R1");
	}

	test("setValue updates footprint Value property", () => {
		const r1 = patchPcb({ op: "setValue", ref: "R1", value: "22k" });
		assertPartValue(r1, "22k");
	});

	test("move updates footprint (at) coordinates and keeps rotation when omitted", () => {
		const r1 = patchPcb({ op: "move", ref: "R1", x: 12.5, y: 34.5 });
		assertPartAt(r1, [{ sym: "at" }, 12.5, 34.5, 45]);
	});

	test("move updates rotation when rot is specified", () => {
		const r1 = patchPcb({ op: "move", ref: "R1", x: 15, y: 25, rot: 180 });
		assertPartAt(r1, [{ sym: "at" }, 15, 25, 180]);
	});

	test("updates legacy module fp_text value", () => {
		const ast = executeSuccessfulEdit(LEGACY_PCB, "pcb", {
			op: "setValue",
			ref: "R1",
			value: "4.7k",
		});
		const mod = ast.slice(1).find((c) => c[0]?.sym === "module");
		const valText = mod.find(isLegacyValueText);
		assert.equal(valText[2], "4.7k");
	});
});

describe("patchKicadText - sch operations", () => {
	const schCases = {
		setValue: {
			edit: { op: "setValue", ref: "R1", value: "47k" },
			verify: (sym) => assertPartValue(sym, "47k"),
		},
		moveNoRot: {
			edit: { op: "move", ref: "R1", x: 55, y: 65 },
			verify: (sym) => assertPartAt(sym, [{ sym: "at" }, 55, 65, 90]),
		},
		moveRot: {
			edit: { op: "move", ref: "R1", x: 55, y: 65, rot: 270 },
			verify: (sym) => assertPartAt(sym, [{ sym: "at" }, 55, 65, 270]),
		},
	};

	function runSchTest(config) {
		const ast = executeSuccessfulEdit(SAMPLE_SCH, "sch", config.edit);
		config.verify(getSchSymbol(ast, "R1"));
	}

	test("setValue updates symbol Value property", () => {
		runSchTest(schCases.setValue);
	});

	test("move updates symbol (at) coordinates and keeps rotation when omitted", () => {
		runSchTest(schCases.moveNoRot);
	});

	test("move updates rotation when rot is specified", () => {
		runSchTest(schCases.moveRot);
	});
});

describe("patchKicadText - untouched nodes and AST fidelity", () => {
	function verifyUntouched(sample, kind, edit) {
		const res = patchKicadText(sample, { kind, edits: [edit] });
		assert.equal(res.ok, true);
		const origAst = parse(sample);
		const newAst = parse(res.text);
		assertAstSubtreeEquality(newAst, origAst, [1, 2, 3, 5]);
		return { origAst, newAst };
	}

	test("untouched nodes and second footprint are deep-equal after re-parse", () => {
		const { origAst, newAst } = verifyUntouched(SAMPLE_PCB, "pcb", {
			op: "setValue",
			ref: "R1",
			value: "100k",
		});
		assertAstSubtreeEquality(newAst[4], origAst[4], [1, 2, 3, 4]);
	});

	test("untouched nodes in sch are deep-equal after re-parse", () => {
		verifyUntouched(SAMPLE_SCH, "sch", {
			op: "move",
			ref: "R1",
			x: 99,
			y: 88,
			rot: 0,
		});
	});
});

describe("patchKicadText - security and escaping", () => {
	test("value containing quotes, parens and backslash round-trips without s-expression injection", () => {
		const trickyValue = '10k "special" (injected node) \\ path';
		const newAst = executeSuccessfulEdit(SAMPLE_PCB, "pcb", {
			op: "setValue",
			ref: "R1",
			value: trickyValue,
		});
		const origAst = parse(SAMPLE_PCB);
		assert.equal(
			newAst[4].length,
			origAst[4].length,
			"sibling node count must remain exactly the same",
		);
		const r1 = getPcbFootprint(newAst, "R1");
		assertPartValue(r1, trickyValue);
	});
});

describe("patchKicadText - multi-unit schematic symbols", () => {
	function parseMultiUnitSuccess(edit) {
		const res = patchKicadText(MULTI_UNIT_SCH, {
			kind: "sch",
			edits: [edit],
		});
		assertSuccessfulRes(res);
		return parse(res.text);
	}

	test("setValue on a two-unit schematic symbol updates both units", () => {
		const ast = parseMultiUnitSuccess({
			op: "setValue",
			ref: "U1",
			value: "LM358",
		});
		const symbols = getAllSchSymbols(ast, "U1");
		assert.equal(symbols.length, 2);
		for (const s of symbols) {
			assertPartValue(s, "LM358");
		}
	});

	test("move on a two-unit symbol is skipped with a reason and changes nothing", () => {
		const res = patchKicadText(MULTI_UNIT_SCH, {
			kind: "sch",
			edits: [{ op: "move", ref: "U1", x: 99, y: 88 }],
		});
		assertSkipped(res, /has several units and must be moved in the editor/i);
		const ast = parse(res.text);
		const symbols = getAllSchSymbols(ast, "U1");
		assertPartAt(symbols[0], [{ sym: "at" }, 10, 20, 0]);
		assertPartAt(symbols[1], [{ sym: "at" }, 30, 40, 0]);
	});

	test("single-unit behaviour unchanged for setValue", () => {
		const ast = parseMultiUnitSuccess({
			op: "setValue",
			ref: "R1",
			value: "20k",
		});
		assertPartValue(getSchSymbol(ast, "R1"), "20k");
	});

	test("single-unit behaviour unchanged for move", () => {
		const ast = parseMultiUnitSuccess({
			op: "move",
			ref: "R1",
			x: 75,
			y: 85,
			rot: 180,
		});
		assertPartAt(getSchSymbol(ast, "R1"), [{ sym: "at" }, 75, 85, 180]);
	});
});
