import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const PART_ID_1 = "part_11111111-1111-1111-1111-111111111111";
const PART_ID_2 = "part_22222222-2222-2222-2222-222222222222";
const PART_ID_3 = "part_33333333-3333-3333-3333-333333333333";
const NET_ID_1 = "net_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NET_ID_2 = "net_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function createSmdPad(number, x) {
	return {
		number,
		type: "smd",
		shape: "roundrect",
		at: [x, 0],
		size: [1, 1],
		layers: ["F.Cu", "F.Paste", "F.Mask"],
	};
}

const SAMPLE_FOOTPRINTS = {
	"Resistor_SMD:R_0805": {
		pads: [createSmdPad("1", -1), createSmdPad("2", 1)],
	},
	"Package_TO_SOT_THT:TO-92": [
		{
			number: "1",
			type: "thru_hole",
			shape: "circle",
			at: [0, 0],
			size: [1.5, 1.5],
			drill: 0.8,
			layers: ["*.Cu", "*.Mask"],
		},
	],
};

function createValidBaseIr() {
	return {
		schemaVersion: 1,
		name: "DemoBoard",
		parts: [
			{
				id: PART_ID_1,
				ref: "R1",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0805",
				props: {},
				placement: { x: 50, y: 30, rot: 90, side: "F" },
			},
		],
		nets: [
			{
				id: NET_ID_1,
				name: "GND",
				pins: [{ partId: PART_ID_1, pin: "1" }],
			},
			{
				id: NET_ID_2,
				name: "+3V3",
				pins: [{ partId: PART_ID_1, pin: "2" }],
			},
		],
		constraints: [],
	};
}

function findNodeByTag(ast, tag) {
	if (!Array.isArray(ast)) return null;
	return ast.find((child) => Array.isArray(child) && child[0]?.sym === tag);
}

function findNodesByTag(ast, tag) {
	if (!Array.isArray(ast)) return [];
	return ast.filter((child) => Array.isArray(child) && child[0]?.sym === tag);
}

function buildPcbAst(ir = createValidBaseIr(), options) {
	const result = irToKicadPcb(ir, options);
	return { ...result, ast: parse(result.text) };
}

function assertTaggedChildren(node, expectations) {
	for (const [tag, ...expectedValues] of expectations) {
		assert.deepEqual(findNodeByTag(node, tag), [
			{ sym: tag },
			...expectedValues,
		]);
	}
}

function assertProperties(props, expected) {
	assert.equal(props.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		assert.equal(props[i][1], expected[i][0]);
		assert.equal(props[i][2], expected[i][1]);
	}
}

describe("irToKicadPcb validation and roundtrip", () => {
	test("output parses back with parse() and includes root header elements", () => {
		const { warnings, ast } = buildPcbAst(createValidBaseIr(), {
			boardW: 80,
			boardH: 60,
			footprints: SAMPLE_FOOTPRINTS,
		});
		assert.equal(warnings.length, 0);
		assert.equal(ast[0]?.sym, "kicad_pcb");
		assertTaggedChildren(ast, [
			["version", 20241229],
			["generator", "banana"],
			["generator_version", "0.1"],
			["paper", "A4"],
		]);
	});

	test("throws on invalid IR schemas", () => {
		const invalidInputs = [
			null,
			{},
			{ schemaVersion: 2 },
			{ ...createValidBaseIr(), parts: [{ id: "bad-id" }] },
		];
		for (const invalid of invalidInputs) {
			assert.throws(() => irToKicadPcb(invalid), /Invalid Circuit IR/);
		}
	});
});

describe("irToKicadPcb layers and board outline", () => {
	test("contains all 13 standard layers and setup clearance", () => {
		const { ast } = buildPcbAst();
		const layersNode = findNodeByTag(ast, "layers");
		assert.ok(layersNode);
		assert.equal(layersNode.length, 14);
		assertTaggedChildren(ast, [
			["setup", [{ sym: "pad_to_mask_clearance" }, 0]],
		]);
	});

	test("contains Edge.Cuts outline with stroke, fill, and dimensions", () => {
		const { ast } = buildPcbAst(createValidBaseIr(), {
			boardW: 120,
			boardH: 90,
		});
		const rect = findNodeByTag(ast, "gr_rect");
		assert.ok(rect);
		assertTaggedChildren(rect, [
			["start", 0, 0],
			["end", 120, 90],
			["fill", { sym: "no" }],
			["layer", "Edge.Cuts"],
		]);
	});
});

describe("irToKicadPcb footprints and placements", () => {
	const PLACEMENT_CASES = [
		{ side: "F", expectedLayer: "F.Cu" },
		{ side: "B", expectedLayer: "B.Cu" },
	];

	for (const { side, expectedLayer } of PLACEMENT_CASES) {
		test(`places footprint on ${expectedLayer} for side ${side}`, () => {
			const ir = createValidBaseIr();
			ir.parts[0].placement.side = side;
			const { ast } = buildPcbAst(ir, { footprints: SAMPLE_FOOTPRINTS });
			const fp = findNodeByTag(ast, "footprint");
			assert.ok(fp);
			assertTaggedChildren(fp, [
				["layer", expectedLayer],
				["at", 50, 30, 90],
			]);
		});
	}

	test("emits Reference and Value properties inside footprint", () => {
		const { ast } = buildPcbAst(createValidBaseIr(), {
			footprints: SAMPLE_FOOTPRINTS,
		});
		const fp = findNodeByTag(ast, "footprint");
		const props = findNodesByTag(fp, "property");
		assertProperties(props, [
			["Reference", "R1"],
			["Value", "10k"],
		]);
	});
});

describe("irToKicadPcb pads and net mapping", () => {
	test("pads map correctly to IR net numbers and include drill when specified", () => {
		const ir = createValidBaseIr();
		ir.parts.push({
			id: PART_ID_2,
			ref: "Q1",
			value: "2N3904",
			symbol: "Device:Q_NPN",
			footprint: "Package_TO_SOT_THT:TO-92",
			props: {},
			placement: { x: 20, y: 15, rot: 0, side: "F" },
		});
		ir.nets[0].pins.push({ partId: PART_ID_2, pin: "1" });
		const { ast } = buildPcbAst(ir, { footprints: SAMPLE_FOOTPRINTS });
		const fps = findNodesByTag(ast, "footprint");
		const q1Fp = fps.find((f) => f[1] === "Package_TO_SOT_THT:TO-92");
		const padNode = findNodeByTag(q1Fp, "pad");
		assert.ok(padNode);
		assertTaggedChildren(padNode, [
			["drill", 0.8],
			["net", 1, "GND"],
		]);
	});
});

describe("irToKicadPcb warnings and edge cases", () => {
	test("warns on unplaced parts and skips emitting their footprint", () => {
		const ir = createValidBaseIr();
		ir.parts.push({
			id: PART_ID_2,
			ref: "C1",
			value: "100nF",
			symbol: "Device:C",
			footprint: "Capacitor_SMD:C_0603",
			props: {},
		});
		const { warnings, ast } = buildPcbAst(ir);
		assert.ok(warnings.includes("unplaced part C1"));
		const fps = findNodesByTag(ast, "footprint");
		assert.equal(fps.length, 1);
		assert.equal(fps[0][1], "Resistor_SMD:R_0805");
	});

	test("warns when footprint definition is missing", () => {
		const ir = createValidBaseIr();
		ir.parts.push({
			id: PART_ID_3,
			ref: "U2",
			value: "NE555",
			symbol: "Timer:NE555",
			footprint: "Package_SO:SOIC-8",
			props: {},
			placement: { x: 10, y: 10, rot: 0, side: "F" },
		});
		const { warnings } = irToKicadPcb(ir, { footprints: SAMPLE_FOOTPRINTS });
		assert.ok(
			warnings.includes("no footprint definition for U2 (Package_SO:SOIC-8)"),
		);
	});
});

describe("irToKicadPcb determinism and thickness option", () => {
	test("generates byte-identical text and deterministic UUIDs across runs", () => {
		const ir = createValidBaseIr();
		const renderOptions = {
			boardW: 100,
			boardH: 80,
			footprints: SAMPLE_FOOTPRINTS,
			thicknessMm: 2.4,
		};
		const run1 = irToKicadPcb(ir, renderOptions);
		const run2 = irToKicadPcb(ir, renderOptions);
		assert.equal(run1.text, run2.text);
		assert.deepEqual(run1.warnings, run2.warnings);
		const ast = parse(run1.text);
		const general = findNodeByTag(ast, "general");
		assertTaggedChildren(general, [["thickness", 2.4]]);
	});
});
