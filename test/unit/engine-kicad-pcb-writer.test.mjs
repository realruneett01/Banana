import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const SAMPLE_FOOTPRINTS = {
	"Resistor_SMD:R_0805": {
		pads: [-1, 1].map((x, idx) => ({
			number: String(idx + 1),
			type: "smd",
			shape: "roundrect",
			at: [x, 0],
			size: [1, 1],
			layers: ["F.Cu", "F.Paste", "F.Mask"],
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

const makePart = (id, ref, [val, sym, fp], placement) => ({
	id: `part_${id}`,
	ref,
	value: val,
	symbol: sym,
	footprint: fp,
	props: {},
	...(placement ? { placement } : {}),
});

const BASE_BOARD_IR = {
	schemaVersion: 1,
	name: "DemoBoard",
	parts: [
		makePart(
			"11111111-1111-1111-1111-111111111111",
			"R1",
			["10k", "Device:R", "Resistor_SMD:R_0805"],
			{ x: 50, y: 30, rot: 90, side: "F" },
		),
	],
	nets: [
		{
			id: "net_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			name: "GND",
			pins: [{ partId: "part_11111111-1111-1111-1111-111111111111", pin: "1" }],
		},
		{
			id: "net_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
			name: "+3V3",
			pins: [{ partId: "part_11111111-1111-1111-1111-111111111111", pin: "2" }],
		},
	],
	constraints: [],
};

function createPcbFixture() {
	const ir = structuredClone(BASE_BOARD_IR);
	const fixture = {
		ir,
		withPart(p) {
			ir.parts.push(p);
			return fixture;
		},
		withSide(side) {
			ir.parts[0].placement.side = side;
			return fixture;
		},
		connectPin(netIdx, partId, pin) {
			ir.nets[netIdx].pins.push({ partId, pin });
			return fixture;
		},
		render(opts) {
			return irToKicadPcb(ir, opts);
		},
		buildAst(opts) {
			const res = irToKicadPcb(ir, opts);
			return { ...res, ast: parse(res.text) };
		},
	};
	return fixture;
}

const hasSym = (tag) => (node) => Array.isArray(node) && node[0]?.sym === tag;

function findNodeByTag(ast, tag) {
	return Array.isArray(ast) ? (ast.find(hasSym(tag)) ?? null) : null;
}

function findNodesByTag(ast, tag) {
	return Array.isArray(ast) ? ast.filter(hasSym(tag)) : [];
}

function assertTaggedNode(parent, tag, expectations) {
	const node = findNodeByTag(parent, tag);
	assert.ok(node);
	if (expectations) {
		for (const [childTag, ...expectedValues] of expectations) {
			assert.deepEqual(findNodeByTag(node, childTag), [
				{ sym: childTag },
				...expectedValues,
			]);
		}
	}
	return node;
}

function assertDocumentHeader(ast, warnings) {
	const headerChecks = [
		["docRoot", ast[0]?.sym, "kicad_pcb"],
		["warningsCount", warnings.length, 0],
		["version", findNodeByTag(ast, "version"), [{ sym: "version" }, 20241229]],
		[
			"generator",
			findNodeByTag(ast, "generator"),
			[{ sym: "generator" }, "banana"],
		],
		[
			"generator_version",
			findNodeByTag(ast, "generator_version"),
			[{ sym: "generator_version" }, "0.1"],
		],
		["paper", findNodeByTag(ast, "paper"), [{ sym: "paper" }, "A4"]],
	];
	for (const [, actual, expected] of headerChecks) {
		assert.deepEqual(actual, expected);
	}
}

describe("irToKicadPcb validation and roundtrip", () => {
	test("output parses back with parse() and includes root header elements", () => {
		const { warnings, ast } = createPcbFixture().buildAst({
			boardW: 80,
			boardH: 60,
			footprints: SAMPLE_FOOTPRINTS,
		});
		assertDocumentHeader(ast, warnings);
	});

	test("throws on invalid IR schemas", () => {
		const invalidInputs = [
			null,
			{},
			{ schemaVersion: 2 },
			{ ...createPcbFixture().ir, parts: [{ id: "bad-id" }] },
		];
		for (const invalid of invalidInputs) {
			assert.throws(() => irToKicadPcb(invalid), /Invalid Circuit IR/);
		}
	});
});

describe("irToKicadPcb layers and board outline", () => {
	test("contains all 13 standard layers and setup clearance", () => {
		const { ast } = createPcbFixture().buildAst();
		const layersNode = assertTaggedNode(ast, "layers");
		assert.equal(layersNode.length, 14);
		assertTaggedNode(ast, "setup", [["pad_to_mask_clearance", 0]]);
	});

	test("contains Edge.Cuts outline with stroke, fill, and dimensions", () => {
		const { ast } = createPcbFixture().buildAst({
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
			const { ast } = createPcbFixture()
				.withSide(side)
				.buildAst({ footprints: SAMPLE_FOOTPRINTS });
			assertTaggedNode(ast, "footprint", [
				["layer", expectedLayer],
				["at", 50, 30, 90],
			]);
		});
	}

	test("emits Reference and Value properties inside footprint", () => {
		const { ast } = createPcbFixture().buildAst({
			footprints: SAMPLE_FOOTPRINTS,
		});
		const fp = assertTaggedNode(ast, "footprint");
		const props = findNodesByTag(fp, "property").map((p) => [p[1], p[2]]);
		assert.deepEqual(props, [
			["Reference", "R1"],
			["Value", "10k"],
		]);
	});
});

describe("irToKicadPcb pads and net mapping", () => {
	test("pads map correctly to IR net numbers and include drill when specified", () => {
		const q1 = makePart(
			"22222222-2222-2222-2222-222222222222",
			"Q1",
			["2N3904", "Device:Q_NPN", "Package_TO_SOT_THT:TO-92"],
			{ x: 20, y: 15, rot: 0, side: "F" },
		);
		const { ast } = createPcbFixture()
			.withPart(q1)
			.connectPin(0, q1.id, "1")
			.buildAst({ footprints: SAMPLE_FOOTPRINTS });
		const q1Fp = findNodesByTag(ast, "footprint").find(
			(f) => f[1] === "Package_TO_SOT_THT:TO-92",
		);
		assertTaggedNode(q1Fp, "pad", [
			["drill", 0.8],
			["net", 1, "GND"],
		]);
	});
});

describe("irToKicadPcb warnings and edge cases", () => {
	test("warns on unplaced parts and skips emitting their footprint", () => {
		const c1 = makePart("22222222-2222-2222-2222-222222222222", "C1", [
			"100nF",
			"Device:C",
			"Capacitor_SMD:C_0603",
		]);
		const { warnings, ast } = createPcbFixture().withPart(c1).buildAst();
		assert.ok(warnings.includes("unplaced part C1"));
		const fps = findNodesByTag(ast, "footprint");
		assert.deepEqual([fps.length, fps[0][1]], [1, "Resistor_SMD:R_0805"]);
	});

	test("warns when footprint definition is missing", () => {
		const u2 = makePart(
			"33333333-3333-3333-3333-333333333333",
			"U2",
			["NE555", "Timer:NE555", "Package_SO:SOIC-8"],
			{ x: 10, y: 10, rot: 0, side: "F" },
		);
		const { warnings } = createPcbFixture().withPart(u2).render({
			footprints: SAMPLE_FOOTPRINTS,
		});
		assert.ok(
			warnings.includes("no footprint definition for U2 (Package_SO:SOIC-8)"),
		);
	});
});

describe("irToKicadPcb determinism and thickness option", () => {
	test("generates byte-identical text and deterministic UUIDs across runs", () => {
		const renderOptions = {
			boardW: 100,
			boardH: 80,
			footprints: SAMPLE_FOOTPRINTS,
			thicknessMm: 2.4,
		};
		const run1 = createPcbFixture().render(renderOptions);
		const run2 = createPcbFixture().render(renderOptions);
		assert.equal(run1.text, run2.text);
		assert.deepEqual(run1.warnings, run2.warnings);
		const ast = parse(run1.text);
		assertTaggedNode(ast, "general", [["thickness", 2.4]]);
	});
});
