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

function makeResistor(idSuffix = "000000000001", ref = "R1", overrides = {}) {
	return makePart(idSuffix, ref, "Device:R", overrides);
}

function makeNet(idSuffix, name, pins) {
	return {
		id: `net_00000000-0000-0000-0000-${idSuffix}`,
		name,
		pins,
	};
}

function makeDefaultNet(name, pins) {
	return makeNet("000000000001", name, pins);
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

function hasHead(item, headName) {
	return Array.isArray(item) && item[0]?.sym === headName;
}

function findNodeByHead(children, headName) {
	return children.find((item) => hasHead(item, headName));
}

function findNodesByHead(children, headName) {
	return children.filter((item) => hasHead(item, headName));
}

function convertAndParse(ir, options) {
	const result = irToKicadSch(ir, options);
	return { ...result, ast: parse(result.text) };
}

function assertHeadField(parent, head, expectedValue) {
	assert.deepEqual(findNodeByHead(parent, head), [
		{ sym: head },
		expectedValue,
	]);
}

function assertAt(node, x, y, rot) {
	assert.deepEqual(findNodeByHead(node, "at"), [{ sym: "at" }, x, y, rot]);
}

function assertTitle(ast, expectedTitle) {
	const titleBlock = findNodeByHead(ast, "title_block");
	assert.ok(titleBlock);
	assertHeadField(titleBlock, "title", expectedTitle);
}

function assertProperty(props, key, expectedValue) {
	const prop = props.find((p) => p[1] === key);
	assert.ok(prop);
	assert.equal(prop[2], expectedValue);
	return prop;
}

function assertGlobalLabel(labelNode, expectedName, [x, y, rot]) {
	assert.equal(labelNode[1], expectedName);
	assertHeadField(labelNode, "shape", { sym: "passive" });
	assertAt(labelNode, x, y, rot);
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
				parts: [makeResistor()],
				nets: [makeDefaultNet("VCC", [{ partId: "part_missing", pin: "1" }])],
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
		const part = makeResistor();
		const ir = makeValidIR({ parts: [part], name: "PowerSupply" });
		const { text, warnings, ast } = convertAndParse(ir);

		assert.ok(text.startsWith("(kicad_sch"));
		assert.ok(warnings.length > 0);
		assert.equal(ast[0]?.sym, "kicad_sch");

		const headerFields = [
			["version", 20250114],
			["generator", "banana"],
			["generator_version", "0.1"],
			["paper", "A4"],
		];
		for (const [head, value] of headerFields) {
			assertHeadField(ast, head, value);
		}

		assertTitle(ast, "PowerSupply");
		assert.ok(findNodeByHead(ast, "sheet_instances"));
	});

	test("custom title option overrides ir.name", () => {
		const ir = makeValidIR({ name: "DefaultName" });
		const { ast } = convertAndParse(ir, { title: "CustomOverride" });
		assertTitle(ast, "CustomOverride");
	});
});

describe("irToKicadSch symbols and placement", () => {
	test("emits symbol with Reference, Value, Footprint (hide yes)", () => {
		const part = makeResistor("000000000001", "R1", {
			value: "100k",
			footprint: "Resistor_SMD:R_0805",
		});
		const ir = makeValidIR({ parts: [part] });
		const { ast } = convertAndParse(ir);

		const symbols = findNodesByHead(ast, "symbol");
		assert.equal(symbols.length, 1);
		const symNode = symbols[0];

		const symbolFields = [
			["lib_id", "Device:R"],
			["unit", 1],
			["in_bom", { sym: "yes" }],
			["on_board", { sym: "yes" }],
		];
		for (const [head, value] of symbolFields) {
			assertHeadField(symNode, head, value);
		}

		const props = findNodesByHead(symNode, "property");
		assert.equal(props.length, 3);
		assertProperty(props, "Reference", "R1");
		assertProperty(props, "Value", "100k");
		const fpProp = assertProperty(props, "Footprint", "Resistor_SMD:R_0805");
		assertHeadField(fpProp, "hide", { sym: "yes" });
	});

	test("places symbols on deterministic grid when schAt is absent", () => {
		const parts = Array.from({ length: 8 }, (_, i) =>
			makePart(String(i + 1).padStart(12, "0"), `R${i + 1}`, "Device:R"),
		);
		const ir = makeValidIR({ parts });
		const { ast } = convertAndParse(ir);
		const symbols = findNodesByHead(ast, "symbol");

		const gridCases = [
			[0, 25.4, 25.4, 0],
			[5, 152.4, 25.4, 0],
			[6, 25.4, 50.8, 0],
		];
		for (const [idx, x, y, rot] of gridCases) {
			assertAt(symbols[idx], x, y, rot);
		}
	});

	test("respects part.props.schAt when provided", () => {
		const part = makeResistor("000000000001", "R1", {
			props: { schAt: { x: 100, y: 150, rot: 90 } },
		});
		const ir = makeValidIR({ parts: [part] });
		const { ast } = convertAndParse(ir);
		const symbols = findNodesByHead(ast, "symbol");
		assertAt(symbols[0], 100, 150, 90);
	});
});

describe("irToKicadSch nets and global labels", () => {
	test("emits global labels at symbol position + offset", () => {
		const p1 = makeResistor("000000000001", "R1", {
			props: { schAt: { x: 50, y: 60, rot: 0 } },
		});
		const p2 = makeResistor("000000000002", "R2", {
			props: { schAt: { x: 100, y: 60, rot: 0 } },
		});
		const net = makeDefaultNet("NET_A", [
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

		const { warnings, ast } = convertAndParse(ir, { pinOffsets });
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0], "missing library symbol Device:R");

		const labels = findNodesByHead(ast, "global_label");
		assert.equal(labels.length, 2);
		const expectedLabels = [
			["NET_A", [45, 60, 0]],
			["NET_A", [105, 60, 0]],
		];
		for (const [i, [name, at]] of expectedLabels.entries()) {
			assertGlobalLabel(labels[i], name, at);
		}
	});

	test("records warning and omits label when pin offset is missing", () => {
		const p1 = makeResistor();
		const net = makeDefaultNet("VCC", [{ partId: p1.id, pin: "1" }]);
		const ir = makeValidIR({ parts: [p1], nets: [net] });

		const { warnings, ast } = convertAndParse(ir, { pinOffsets: {} });
		assert.ok(warnings.includes("no pin offset for R1.1"));

		const labels = findNodesByHead(ast, "global_label");
		assert.equal(labels.length, 0);
	});
});

describe("irToKicadSch lib_symbols and determinism", () => {
	test("includes parsed library symbol when supplied", () => {
		const p1 = makeResistor();
		const p2 = makeResistor("000000000002", "R2");
		const ir = makeValidIR({ parts: [p1, p2] });
		const mockLibSymbol = [
			sym("symbol"),
			"Device:R",
			[sym("pin"), "passive", "line"],
		];

		const { warnings, ast } = convertAndParse(ir, {
			libSymbols: { "Device:R": mockLibSymbol },
		});

		assert.equal(warnings.length, 0);
		const libSymbolsNode = findNodeByHead(ast, "lib_symbols");
		assert.ok(libSymbolsNode);
		assert.equal(libSymbolsNode.length, 2);
		assert.deepEqual(libSymbolsNode[1], mockLibSymbol);
	});

	test("is byte-for-byte deterministic across multiple runs", () => {
		const p1 = makeResistor();
		const p2 = makePart("000000000002", "C1", "Device:C");
		const net = makeDefaultNet("GND", [{ partId: p1.id, pin: "1" }]);
		const ir = makeValidIR({ parts: [p1, p2], nets: [net] });
		const pinOffsets = { "Device:R": { 1: { dx: -2.54, dy: 0 } } };

		const res1 = irToKicadSch(ir, { pinOffsets });
		const res2 = irToKicadSch(ir, { pinOffsets });

		assert.equal(res1.text, res2.text);
		assert.deepEqual(res1.warnings, res2.warnings);
	});
});
