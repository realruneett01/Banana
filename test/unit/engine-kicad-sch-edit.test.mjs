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
	const { text } = irToKicadSch(ir, { title: "BananaTest" });
	return text;
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

function findPlacedSymbols(root) {
	return root.filter(
		(child) =>
			Array.isArray(child) &&
			child[0]?.sym === "symbol" &&
			typeof child[1] !== "string" &&
			child[1]?.sym !== "symbol",
	);
}

function findSymbolProp(symNode, name) {
	const prop = symNode.find(
		(c) => Array.isArray(c) && c[0]?.sym === "property" && c[1] === name,
	);
	return prop ? (typeof prop[2] === "string" ? prop[2] : prop[2]?.sym) : null;
}

function findInstancesRef(symNode) {
	const inst = symNode.find(
		(c) => Array.isArray(c) && c[0]?.sym === "instances",
	);
	if (!inst) return null;
	const proj = inst.find((c) => Array.isArray(c) && c[0]?.sym === "project");
	if (!proj) return null;
	const path = proj.find((c) => Array.isArray(c) && c[0]?.sym === "path");
	if (!path) return null;
	const ref = path.find((c) => Array.isArray(c) && c[0]?.sym === "reference");
	return ref ? (typeof ref[1] === "string" ? ref[1] : ref[1]?.sym) : null;
}

function assertSymbolProps(placed, ref, val, fp) {
	assert.equal(findSymbolProp(placed, "Reference"), ref);
	assert.equal(findSymbolProp(placed, "Value"), val);
	assert.equal(findSymbolProp(placed, "Footprint"), fp);
}

function assertPinUuids(placed, count) {
	const pins = placed.filter((c) => Array.isArray(c) && c[0]?.sym === "pin");
	assert.equal(pins.length, count);
	for (const p of pins) {
		assert.ok(p.find((c) => c[0]?.sym === "uuid"));
	}
}

function assertHiddenProperty(symNode, name) {
	const prop = symNode.find(
		(c) => Array.isArray(c) && c[0]?.sym === "property" && c[1] === name,
	);
	assert.ok(prop.find((c) => Array.isArray(c) && c[0]?.sym === "hide"));
}

describe("kicad-sch-edit", () => {
	it("adds a symbol with lib_symbols entry, placed symbol, and pins", () => {
		const base = createBaseSchematic();
		const edit = makeAddEdit("R1", "10k", 50.8, 76.2);
		edit.footprint = "Resistor_SMD:R_0805_2012Metric";
		const res = applySchEdits(base, [edit]);
		assert.equal(res.ok, true);

		const ast = parse(res.text);
		const libSymbols = ast.find(
			(c) => Array.isArray(c) && c[0]?.sym === "lib_symbols",
		);
		assert.ok(
			libSymbols.find(
				(c) =>
					Array.isArray(c) && c[0]?.sym === "symbol" && c[1] === "Device:R",
			),
		);

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
		const libSymbols = ast.find(
			(c) => Array.isArray(c) && c[0]?.sym === "lib_symbols",
		);
		const matches = libSymbols.filter(
			(c) => Array.isArray(c) && c[0]?.sym === "symbol" && c[1] === "Device:R",
		);
		assert.equal(matches.length, 1);
		assert.equal(findPlacedSymbols(ast).length, 2);
	});

	it("setField updates Reference and instances block", () => {
		const base = createBaseSchematic();
		const edits = [
			makeAddEdit("R1", "10k", 10, 20),
			{ op: "setField", ref: "R1", name: "Reference", value: "R5" },
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);

		const placed = findPlacedSymbols(parse(res.text));
		assert.equal(placed.length, 1);
		assert.equal(findSymbolProp(placed[0], "Reference"), "R5");
		assert.equal(findInstancesRef(placed[0]), "R5");
	});

	it("setField updates Footprint and creates missing hidden property", () => {
		const base = createBaseSchematic();
		const edits = [
			makeAddEdit("R1", "10k", 10, 20),
			{ op: "setField", ref: "R1", name: "Footprint", value: "R_0603" },
			{ op: "setField", ref: "R1", name: "Tolerance", value: "1%" },
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);

		const placed = findPlacedSymbols(parse(res.text));
		assert.equal(findSymbolProp(placed[0], "Footprint"), "R_0603");
		assert.equal(findSymbolProp(placed[0], "Tolerance"), "1%");
		assertHiddenProperty(placed[0], "Tolerance");
	});

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
		const libSymbols = ast.find(
			(c) => Array.isArray(c) && c[0]?.sym === "lib_symbols",
		);
		assert.ok(
			libSymbols.find(
				(c) =>
					Array.isArray(c) && c[0]?.sym === "symbol" && c[1] === "Device:R",
			),
		);
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
		assert.ok(label?.find((c) => c[0]?.sym === "uuid"));
		const noConn = ast.find(
			(c) => Array.isArray(c) && c[0]?.sym === "no_connect",
		);
		assert.ok(noConn?.find((c) => c[0]?.sym === "uuid"));
	});

	it("round-trips edited schematic successfully through parse and serialize", () => {
		const base = createBaseSchematic();
		const edits = [
			makeAddEdit("R1", "10k", 10.12345, 20.67891),
			{ op: "addLabel", net: "VBUS", x: 5.55555, y: 6.66666 },
		];
		const res = applySchEdits(base, edits);
		assert.equal(res.ok, true);

		const parsedAgain = parse(res.text);
		assert.ok(Array.isArray(parsedAgain));
		assert.equal(parsedAgain[0]?.sym, "kicad_sch");
	});

	const errorCases = [
		{ name: "unknown operation", edits: [{ op: "rotateSymbol", ref: "R1" }] },
		{ name: "deleteSymbol missing ref", edits: [{ op: "deleteSymbol" }] },
		{
			name: "deleteSymbol unknown ref",
			edits: [{ op: "deleteSymbol", ref: "R999" }],
		},
		{
			name: "setField missing ref",
			edits: [{ op: "setField", name: "Value", value: "1k" }],
		},
		{
			name: "setField unknown ref",
			edits: [{ op: "setField", ref: "R999", name: "Value", value: "1k" }],
		},
		{
			name: "addSymbol non-finite x",
			edits: [
				{
					op: "addSymbol",
					libId: "Device:R",
					libSymbol: SAMPLE_LIB_R,
					ref: "R1",
					x: Number.NaN,
					y: 10,
				},
			],
		},
		{
			name: "addLabel non-finite y",
			edits: [
				{ op: "addLabel", net: "CLK", x: 10, y: Number.POSITIVE_INFINITY },
			],
		},
		{
			name: "addNoConnect non-finite coord",
			edits: [{ op: "addNoConnect", x: "invalid", y: 10 }],
		},
	];

	for (const tc of errorCases) {
		it(`rejects invalid edit: ${tc.name}`, () => {
			const base = createBaseSchematic();
			const res = applySchEdits(base, tc.edits);
			assert.equal(res.ok, false);
			assert.equal(typeof res.error, "string");
			assert.ok(res.error.length > 0);
		});
	}
});
