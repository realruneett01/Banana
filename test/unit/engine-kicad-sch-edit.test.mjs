import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySchEdits } from "../../backend/src/engine/kicad-sch-edit.js";
import { irToKicadSch } from "../../backend/src/engine/kicad-sch-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const SAMPLE_LIB_R = `(symbol "R"
	(symbol "R_0_1"
		(rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254)) (fill (type none)))
	)
	(symbol "R_1_1"
		(pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
		(pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))
	)
)`;

function createBaseSchematic() {
	const ir = {
		schemaVersion: 1,
		name: "test_circuit",
		parts: [],
		nets: [],
		constraints: [],
	};
	return irToKicadSch(ir, { title: "BananaTest" }).text;
}

function makeAddEdit(ref, val, x, y) {
	return {
		op: "addSymbol",
		libId: "Device:R",
		libSymbol: SAMPLE_LIB_R,
		ref,
		value: val,
		footprint: "R_0805",
		x,
		y,
		pins: ["1", "2"],
	};
}

function findChild(node, tag) {
	return node?.find?.((c) => Array.isArray(c) && c[0]?.sym === tag);
}

function findChildren(node, tag) {
	return Array.isArray(node)
		? node.filter((c) => Array.isArray(c) && c[0]?.sym === tag)
		: [];
}

function isPlacedSymbol(node) {
	if (!Array.isArray(node) || node[0]?.sym !== "symbol") {
		return false;
	}
	const second = node[1];
	return typeof second !== "string" && second?.sym !== "symbol";
}

function findPlacedSymbols(root) {
	return root.filter(isPlacedSymbol);
}

function nodeValue(node, index = 1) {
	const val = node?.[index];
	return typeof val === "object" ? val?.sym : (val ?? null);
}

function findSymbolProp(symNode, name) {
	const prop = symNode?.find?.(
		(c) => Array.isArray(c) && c[0]?.sym === "property" && c[1] === name,
	);
	return nodeValue(prop, 2);
}

function findInstancesRef(symNode) {
	const target = ["instances", "project", "path", "reference"].reduce(
		findChild,
		symNode,
	);
	return nodeValue(target, 1);
}

function getLibSymbols(ast, symbolId) {
	const container = findChild(ast, "lib_symbols");
	const symbols = findChildren(container, "symbol");
	return symbolId ? symbols.filter((s) => s[1] === symbolId) : symbols;
}

function assertSymbolProps(placed, ref, val, fp) {
	assert.equal(findSymbolProp(placed, "Reference"), ref);
	assert.equal(findSymbolProp(placed, "Value"), val);
	assert.equal(findSymbolProp(placed, "Footprint"), fp);
}

function assertPinUuids(placed, count) {
	const pins = findChildren(placed, "pin");
	assert.equal(pins.length, count);
	for (const p of pins) {
		assert.ok(findChild(p, "uuid"));
	}
}

function assertHiddenProperty(symNode, name) {
	const prop = symNode.find(
		(c) => Array.isArray(c) && c[0]?.sym === "property" && c[1] === name,
	);
	assert.ok(findChild(prop, "hide"));
}

function assertRejectedEdit(edits) {
	const base = createBaseSchematic();
	const res = applySchEdits(base, edits);
	assert.equal(res.ok, false);
	assert.equal(typeof res.error, "string");
	assert.ok(res.error.length > 0);
}

describe("kicad-sch-edit", () => {
	it("adds a symbol with lib_symbols entry, placed symbol, and pins", () => {
		const base = createBaseSchematic();
		const edit = makeAddEdit("R1", "10k", 50.8, 76.2);
		edit.footprint = "Resistor_SMD:R_0805_2012Metric";
		const res = applySchEdits(base, [edit]);
		assert.equal(res.ok, true);

		const ast = parse(res.text);
		const [devR] = getLibSymbols(ast, "Device:R");
		assert.ok(devR);

		const placed = findPlacedSymbols(ast);
		assert.equal(placed.length, 1);
		assertSymbolProps(placed[0], "R1", "10k", "Resistor_SMD:R_0805_2012Metric");
		assertPinUuids(placed[0], 2);
	});

	it("reuses existing lib_symbols entry when adding second symbol", () => {
		const base = createBaseSchematic();
		const edits = [
			makeAddEdit("R1", "10k", 10, 20),
			makeAddEdit("R2", "20k", 30, 40),
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);

		const ast = parse(res.text);
		const matches = getLibSymbols(ast, "Device:R");
		assert.equal(matches.length, 1);
		const placed = findPlacedSymbols(ast);
		assert.equal(placed.length, 2);
	});

	const fieldUpdateCases = [
		{
			name: "Reference and instances block",
			edits: [{ op: "setField", ref: "R1", name: "Reference", value: "R5" }],
			verify(placed) {
				assert.equal(placed.length, 1);
				assert.equal(findInstancesRef(placed[0]), "R5");
				assert.equal(findSymbolProp(placed[0], "Reference"), "R5");
			},
		},
		{
			name: "Footprint and creates missing hidden property",
			edits: [
				{ op: "setField", ref: "R1", name: "Footprint", value: "R_0603" },
				{ op: "setField", ref: "R1", name: "Tolerance", value: "1%" },
			],
			verify(placed) {
				assert.equal(findSymbolProp(placed[0], "Footprint"), "R_0603");
				assertHiddenProperty(placed[0], "Tolerance");
				assert.equal(findSymbolProp(placed[0], "Tolerance"), "1%");
			},
		},
	];

	for (const tc of fieldUpdateCases) {
		it(`setField updates ${tc.name}`, () => {
			const base = createBaseSchematic();
			const edits = [makeAddEdit("R1", "10k", 10, 20), ...tc.edits];
			const res = applySchEdits(base, edits);
			assert.equal(res.ok, true);

			const placed = findPlacedSymbols(parse(res.text));
			tc.verify(placed);
		});
	}

	it("deleteSymbol removes placed symbol and preserves lib_symbols", () => {
		const base = createBaseSchematic();
		const edits = [
			makeAddEdit("R1", "10k", 10, 20),
			{ op: "deleteSymbol", ref: "R1" },
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);

		const ast = parse(res.text);
		assert.equal(findPlacedSymbols(ast).length, 0);
		const [devR] = getLibSymbols(ast, "Device:R");
		assert.ok(devR);
	});

	it("addLabel and addNoConnect insert entries with fresh uuid", () => {
		const base = createBaseSchematic();
		const edits = [
			{ op: "addLabel", net: "SPI_MOSI", x: 25.4, y: 38.1, rot: 90 },
			{ op: "addNoConnect", x: 12.7, y: 15.24 },
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);

		const ast = parse(res.text);
		const label = ast.find(
			(c) => Array.isArray(c) && c[0]?.sym === "label" && c[1] === "SPI_MOSI",
		);
		assert.ok(findChild(label, "uuid"));
		const noConn = findChild(ast, "no_connect");
		assert.ok(findChild(noConn, "uuid"));
	});

	it("round-trips edited schematic successfully through parse and serialize", () => {
		const base = createBaseSchematic();
		const edits = [
			makeAddEdit("R1", "10k", 10.12345, 20.67891),
			{ op: "addLabel", net: "VBUS", x: 5.55555, y: 6.66666 },
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);
		assert.equal(typeof res.text, "string");

		const parsedAgain = parse(res.text);
		assert.equal(parsedAgain?.[0]?.sym, "kicad_sch");
		assert.ok(Array.isArray(parsedAgain));
	});

	const invalidEditCases = [
		["unknown operation", [{ op: "rotateSymbol", ref: "R1" }]],
		["deleteSymbol missing ref", [{ op: "deleteSymbol" }]],
		["deleteSymbol unknown ref", [{ op: "deleteSymbol", ref: "R999" }]],
		["setField missing ref", [{ op: "setField", name: "Value", value: "1k" }]],
		[
			"setField unknown ref",
			[{ op: "setField", ref: "R999", name: "Value", value: "1k" }],
		],
		[
			"addSymbol non-finite x",
			[
				{
					op: "addSymbol",
					libId: "Device:R",
					libSymbol: SAMPLE_LIB_R,
					ref: "R1",
					x: Number.NaN,
					y: 10,
				},
			],
		],
		[
			"addLabel non-finite y",
			[{ op: "addLabel", net: "CLK", x: 10, y: Number.POSITIVE_INFINITY }],
		],
		[
			"addNoConnect non-finite coord",
			[{ op: "addNoConnect", x: "invalid", y: 10 }],
		],
	];

	for (const [name, edits] of invalidEditCases) {
		it(`rejects invalid edit: ${name}`, () => {
			assertRejectedEdit(edits);
		});
	}
});
