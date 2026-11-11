import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { irToKicadSch } from "../../backend/src/engine/kicad-sch-writer.js";
import { parse, sym } from "../../backend/src/engine/sexpr.js";

function makePart(idSuffix, ref, symbol, overrides = {}) {
	return {
		id: `part_00000000-0000-0000-0000-${idSuffix}`,
		ref,
		value: "10k",
		symbol,
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeNet(idSuffix, name, pins) {
	return {
		id: `net_00000000-0000-0000-0000-${idSuffix}`,
		name,
		pins,
	};
}

function makeValidIR({ parts = [], nets = [], name = "TestCircuit" } = {}) {
	return {
		schemaVersion: 1,
		name,
		parts,
		nets,
		constraints: [],
	};
}

function findNodeByHead(children, headName) {
	return children.find((item) => {
		if (!Array.isArray(item) || item.length === 0) {
			return false;
		}
		const first = item[0];
		return first && typeof first === "object" && first.sym === headName;
	});
}

function findNodesByHead(children, headName) {
	return children.filter((item) => {
		if (!Array.isArray(item) || item.length === 0) {
			return false;
		}
		const first = item[0];
		return first && typeof first === "object" && first.sym === headName;
	});
}

describe("irToKicadSch validation", () => {
	const INVALID_CASES = [
		{ name: "null IR", input: null },
		{ name: "empty object", input: {} },
		{
			name: "missing required schema fields",
			input: { schemaVersion: 1, name: "Bad" },
		},
		{
			name: "net references unknown partId",
			input: makeValidIR({
				parts: [makePart("000000000001", "R1", "Device:R")],
				nets: [
					makeNet("000000000001", "VCC", [
						{ partId: "part_missing", pin: "1" },
					]),
				],
			}),
		},
	];

	for (const { name, input } of INVALID_CASES) {
		test(`throws on ${name}`, () => {
			assert.throws(() => irToKicadSch(input), /Invalid circuit IR/i);
		});
	}
});

describe("irToKicadSch root structure and headers", () => {
	test("emits correct header fields and title block", () => {
		const part = makePart("000000000001", "R1", "Device:R");
		const ir = makeValidIR({ parts: [part], name: "PowerSupply" });
		const { text, warnings } = irToKicadSch(ir);

		assert.ok(text.startsWith("(kicad_sch"));
		assert.ok(warnings.length > 0);

		const ast = parse(text);
		assert.equal(ast[0]?.sym, "kicad_sch");

		const versionNode = findNodeByHead(ast, "version");
		assert.deepEqual(versionNode, [{ sym: "version" }, 20250114]);

		const genNode = findNodeByHead(ast, "generator");
		assert.deepEqual(genNode, [{ sym: "generator" }, "banana"]);

		const genVerNode = findNodeByHead(ast, "generator_version");
		assert.deepEqual(genVerNode, [{ sym: "generator_version" }, "0.1"]);

		const paperNode = findNodeByHead(ast, "paper");
		assert.deepEqual(paperNode, [{ sym: "paper" }, "A4"]);

		const titleBlock = findNodeByHead(ast, "title_block");
		assert.ok(titleBlock);
		const titleNode = findNodeByHead(titleBlock, "title");
		assert.deepEqual(titleNode, [{ sym: "title" }, "PowerSupply"]);

		const sheetNode = findNodeByHead(ast, "sheet_instances");
		assert.ok(sheetNode);
	});

	test("custom title option overrides ir.name", () => {
		const ir = makeValidIR({ name: "DefaultName" });
		const { text } = irToKicadSch(ir, { title: "CustomOverride" });
		const ast = parse(text);
		const titleBlock = findNodeByHead(ast, "title_block");
		const titleNode = findNodeByHead(titleBlock, "title");
		assert.deepEqual(titleNode, [{ sym: "title" }, "CustomOverride"]);
	});
});

describe("irToKicadSch symbols and placement", () => {
	test("emits symbol with Reference, Value, Footprint (hide yes)", () => {
		const part = makePart("000000000001", "R1", "Device:R", {
			value: "100k",
			footprint: "Resistor_SMD:R_0805",
		});
		const ir = makeValidIR({ parts: [part] });
		const { text } = irToKicadSch(ir);
		const ast = parse(text);

		const symbols = findNodesByHead(ast, "symbol");
		assert.equal(symbols.length, 1);
		const symNode = symbols[0];

		const libId = findNodeByHead(symNode, "lib_id");
		assert.deepEqual(libId, [{ sym: "lib_id" }, "Device:R"]);

		const unit = findNodeByHead(symNode, "unit");
		assert.deepEqual(unit, [{ sym: "unit" }, 1]);

		const inBom = findNodeByHead(symNode, "in_bom");
		assert.deepEqual(inBom, [{ sym: "in_bom" }, { sym: "yes" }]);

		const onBoard = findNodeByHead(symNode, "on_board");
		assert.deepEqual(onBoard, [{ sym: "on_board" }, { sym: "yes" }]);

		const props = findNodesByHead(symNode, "property");
		assert.equal(props.length, 3);

		const refProp = props.find((p) => p[1] === "Reference");
		assert.equal(refProp[2], "R1");

		const valProp = props.find((p) => p[1] === "Value");
		assert.equal(valProp[2], "100k");

		const fpProp = props.find((p) => p[1] === "Footprint");
		assert.equal(fpProp[2], "Resistor_SMD:R_0805");
		const hideNode = findNodeByHead(fpProp, "hide");
		assert.deepEqual(hideNode, [{ sym: "hide" }, { sym: "yes" }]);
	});

	test("places symbols on deterministic grid when schAt is absent", () => {
		const parts = Array.from({ length: 8 }, (_, i) =>
			makePart(String(i + 1).padStart(12, "0"), `R${i + 1}`, "Device:R"),
		);
		const ir = makeValidIR({ parts });
		const { text } = irToKicadSch(ir);
		const ast = parse(text);
		const symbols = findNodesByHead(ast, "symbol");

		const at0 = findNodeByHead(symbols[0], "at");
		assert.deepEqual(at0, [{ sym: "at" }, 25.4, 25.4, 0]);

		const at5 = findNodeByHead(symbols[5], "at");
		assert.deepEqual(at5, [{ sym: "at" }, 152.4, 25.4, 0]);

		const at6 = findNodeByHead(symbols[6], "at");
		assert.deepEqual(at6, [{ sym: "at" }, 25.4, 50.8, 0]);
	});

	test("respects part.props.schAt when provided", () => {
		const part = makePart("000000000001", "R1", "Device:R", {
			props: { schAt: { x: 100, y: 150, rot: 90 } },
		});
		const ir = makeValidIR({ parts: [part] });
		const { text } = irToKicadSch(ir);
		const ast = parse(text);
		const symbols = findNodesByHead(ast, "symbol");
		const atNode = findNodeByHead(symbols[0], "at");
		assert.deepEqual(atNode, [{ sym: "at" }, 100, 150, 90]);
	});
});

describe("irToKicadSch nets and global labels", () => {
	test("emits global labels at symbol position + offset", () => {
		const p1 = makePart("000000000001", "R1", "Device:R", {
			props: { schAt: { x: 50, y: 60, rot: 0 } },
		});
		const p2 = makePart("000000000002", "R2", "Device:R", {
			props: { schAt: { x: 100, y: 60, rot: 0 } },
		});
		const net = makeNet("000000000001", "NET_A", [
			{ partId: p1.id, pin: "1" },
			{ partId: p2.id, pin: "2" },
		]);
		const ir = makeValidIR({ parts: [p1, p2], nets: [net] });
		const pinOffsets = {
			"Device:R": {
				1: { dx: -5, dy: 0 },
				2: { dx: 5, dy: 0 },
			},
		};

		const { text, warnings } = irToKicadSch(ir, { pinOffsets });
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0], "missing library symbol Device:R");

		const ast = parse(text);
		const labels = findNodesByHead(ast, "global_label");
		assert.equal(labels.length, 2);

		assert.equal(labels[0][1], "NET_A");
		assert.deepEqual(findNodeByHead(labels[0], "shape"), [
			{ sym: "shape" },
			{ sym: "passive" },
		]);
		assert.deepEqual(findNodeByHead(labels[0], "at"), [
			{ sym: "at" },
			45,
			60,
			0,
		]);

		assert.equal(labels[1][1], "NET_A");
		assert.deepEqual(findNodeByHead(labels[1], "shape"), [
			{ sym: "shape" },
			{ sym: "passive" },
		]);
		assert.deepEqual(findNodeByHead(labels[1], "at"), [
			{ sym: "at" },
			105,
			60,
			0,
		]);
	});

	test("records warning and omits label when pin offset is missing", () => {
		const p1 = makePart("000000000001", "R1", "Device:R");
		const net = makeNet("000000000001", "VCC", [{ partId: p1.id, pin: "1" }]);
		const ir = makeValidIR({ parts: [p1], nets: [net] });

		const { text, warnings } = irToKicadSch(ir, { pinOffsets: {} });
		assert.ok(warnings.includes("no pin offset for R1.1"));

		const ast = parse(text);
		const labels = findNodesByHead(ast, "global_label");
		assert.equal(labels.length, 0);
	});
});

describe("irToKicadSch lib_symbols and determinism", () => {
	test("includes parsed library symbol when supplied", () => {
		const p1 = makePart("000000000001", "R1", "Device:R");
		const p2 = makePart("000000000002", "R2", "Device:R");
		const ir = makeValidIR({ parts: [p1, p2] });
		const mockLibSymbol = [
			sym("symbol"),
			"Device:R",
			[sym("pin"), "passive", "line"],
		];

		const { text, warnings } = irToKicadSch(ir, {
			libSymbols: { "Device:R": mockLibSymbol },
		});

		assert.equal(warnings.length, 0);
		const ast = parse(text);
		const libSymbolsNode = findNodeByHead(ast, "lib_symbols");
		assert.ok(libSymbolsNode);
		assert.equal(libSymbolsNode.length, 2);
		assert.deepEqual(libSymbolsNode[1], mockLibSymbol);
	});

	test("is byte-for-byte deterministic across multiple runs", () => {
		const p1 = makePart("000000000001", "R1", "Device:R");
		const p2 = makePart("000000000002", "C1", "Device:C");
		const net = makeNet("000000000001", "GND", [{ partId: p1.id, pin: "1" }]);
		const ir = makeValidIR({ parts: [p1, p2], nets: [net] });
		const pinOffsets = { "Device:R": { 1: { dx: -2.54, dy: 0 } } };

		const res1 = irToKicadSch(ir, { pinOffsets });
		const res2 = irToKicadSch(ir, { pinOffsets });

		assert.equal(res1.text, res2.text);
		assert.deepEqual(res1.warnings, res2.warnings);
	});
});
