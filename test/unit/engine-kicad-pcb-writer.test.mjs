import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const PART_ID_1 = "part_11111111-1111-1111-1111-111111111111";
const PART_ID_2 = "part_22222222-2222-2222-2222-222222222222";
const PART_ID_3 = "part_33333333-3333-3333-3333-333333333333";
const NET_ID_1 = "net_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NET_ID_2 = "net_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const F_CU_LAYERS = ["F.Cu", "F.Paste", "F.Mask"];

const SAMPLE_FOOTPRINTS = {
	"Resistor_SMD:R_0805": {
		pads: [-1, 1].map((x, idx) => ({
			number: String(idx + 1),
			type: "smd",
			shape: "roundrect",
			at: [x, 0],
			size: [1, 1],
			layers: F_CU_LAYERS,
		})),
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

function makePart(id, ref, [value, symbol, footprint], placement) {
	return {
		id,
		ref,
		value,
		symbol,
		footprint,
		props: {},
		...(placement ? { placement } : {}),
	};
}

function makeNet(id, name, partId, pin) {
	return { id, name, pins: [{ partId, pin }] };
}

function createValidBaseIr(extraPart) {
	const parts = [
		makePart(PART_ID_1, "R1", ["10k", "Device:R", "Resistor_SMD:R_0805"], {
			x: 50,
			y: 30,
			rot: 90,
			side: "F",
		}),
	];
	if (extraPart) parts.push(extraPart);
	return {
		schemaVersion: 1,
		name: "DemoBoard",
		parts,
		nets: [
			makeNet(NET_ID_1, "GND", PART_ID_1, "1"),
			makeNet(NET_ID_2, "+3V3", PART_ID_1, "2"),
		],
		constraints: [],
	};
}

const hasSym = (tag) => (node) => Array.isArray(node) && node[0]?.sym === tag;

function findNodeByTag(ast, tag) {
	return Array.isArray(ast) ? (ast.find(hasSym(tag)) ?? null) : null;
}

function findNodesByTag(ast, tag) {
	return Array.isArray(ast) ? ast.filter(hasSym(tag)) : [];
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

function assertTaggedNode(parent, tag, expectations) {
	const node = findNodeByTag(parent, tag);
	assert.ok(node);
	if (expectations) {
		assertTaggedChildren(node, expectations);
	}
	return node;
}

function assertProperties(props, expected) {
	assert.deepEqual(
		props.map((p) => [p[1], p[2]]),
		expected,
	);
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
		const layersNode = assertTaggedNode(ast, "layers");
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
		assertTaggedNode(ast, "gr_rect", [
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
			assertTaggedNode(ast, "footprint", [
				["layer", expectedLayer],
				["at", 50, 30, 90],
			]);
		});
	}

	test("emits Reference and Value properties inside footprint", () => {
		const { ast } = buildPcbAst(createValidBaseIr(), {
			footprints: SAMPLE_FOOTPRINTS,
		});
		const fp = assertTaggedNode(ast, "footprint");
		const props = findNodesByTag(fp, "property");
		assertProperties(props, [
			["Reference", "R1"],
			["Value", "10k"],
		]);
	});
});

describe("irToKicadPcb pads and net mapping", () => {
	test("pads map correctly to IR net numbers and include drill when specified", () => {
		const q1 = makePart(
			PART_ID_2,
			"Q1",
			["2N3904", "Device:Q_NPN", "Package_TO_SOT_THT:TO-92"],
			{ x: 20, y: 15, rot: 0, side: "F" },
		);
		const ir = createValidBaseIr(q1);
		ir.nets[0].pins.push({ partId: PART_ID_2, pin: "1" });
		const { ast } = buildPcbAst(ir, { footprints: SAMPLE_FOOTPRINTS });
		const fps = findNodesByTag(ast, "footprint");
		const q1Fp = fps.find((f) => f[1] === "Package_TO_SOT_THT:TO-92");
		assertTaggedNode(q1Fp, "pad", [
			["drill", 0.8],
			["net", 1, "GND"],
		]);
	});
});

describe("irToKicadPcb warnings and edge cases", () => {
	test("warns on unplaced parts and skips emitting their footprint", () => {
		const c1 = makePart(PART_ID_2, "C1", [
			"100nF",
			"Device:C",
			"Capacitor_SMD:C_0603",
		]);
		const { warnings, ast } = buildPcbAst(createValidBaseIr(c1));
		assert.ok(warnings.includes("unplaced part C1"));
		const fps = findNodesByTag(ast, "footprint");
		assert.equal(fps.length, 1);
		assert.equal(fps[0][1], "Resistor_SMD:R_0805");
	});

	test("warns when footprint definition is missing", () => {
		const u2 = makePart(
			PART_ID_3,
			"U2",
			["NE555", "Timer:NE555", "Package_SO:SOIC-8"],
			{ x: 10, y: 10, rot: 0, side: "F" },
		);
		const { warnings } = irToKicadPcb(createValidBaseIr(u2), {
			footprints: SAMPLE_FOOTPRINTS,
		});
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
		assertTaggedNode(ast, "general", [["thickness", 2.4]]);
	});
});
