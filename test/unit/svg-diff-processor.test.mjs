// All exported functions are unit-testable in-memory without kicad-cli or network.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	assembleTrackChains,
	classifyAddedTargetElement,
	classifyDeletedBaseElements,
	classifyResidualElementsPass,
	cleanLayerName,
	cleanNetName,
	extractElements,
	isCopperLayerFilename,
	linkChangedElementPair,
	matchExactPrimitivesPass,
	matchProximityPrimitivesPass,
	matchRefDesComponentsPass,
	processSvgDiff,
} from "../../backend/src/svg-diff-processor.js";

function makeTestContext(options = {}) {
	const ctx = {
		baseElements: options.baseElements ?? [],
		targetElements: options.targetElements ?? [],
		layerFilename: options.layerFilename ?? "board-F_Cu.svg",
	};
	for (const key of ["matchedBase", "matchedTarget"]) {
		ctx[key] = new Set();
	}
	for (const key of [
		"matchedTargetToBase",
		"matchedBaseToTarget",
		"baseClassifications",
		"targetClassifications",
	]) {
		ctx[key] = new Map();
	}
	return ctx;
}

function makePrimitive(overrides = {}) {
	const elem = {
		tag: "circle",
		fullMatch: '<circle cx="10" cy="10" r="2" />',
		fullKey: "circle||cx=10;cy=10;r=2",
		idKey: "circle|",
		geoKey: "cx=10;cy=10;r=2",
		center: { x: 10, y: 10 },
	};
	for (const field of ["id", "label", "text"]) {
		elem[field] = "";
	}
	for (const field of ["isClosedPath", "isComponent", "isWorksheetFrame"]) {
		elem[field] = false;
	}
	return Object.assign(elem, overrides);
}

function setChangedPair(ctx, targetEl, baseEl, extra = {}) {
	const classification = { diffClass: "diff-changed", ...extra };
	ctx.targetClassifications.set(targetEl, { ...classification });
	ctx.baseClassifications.set(baseEl, { ...classification });
}

function getPairClassifications(ctx, targetEl, baseEl) {
	return {
		tClass: ctx.targetClassifications.get(targetEl),
		bClass: ctx.baseClassifications.get(baseEl),
	};
}

function assertExpectedProperties(items, expectedSpecs) {
	assert.equal(items.length, expectedSpecs.length);
	items.forEach((item, idx) => {
		for (const [key, expectedVal] of Object.entries(expectedSpecs[idx])) {
			assert.equal(item[key], expectedVal);
		}
	});
}

function runPairMatchTest({
	passFn,
	baseElement,
	targetElement,
	otherElement,
	displacement,
}) {
	const ctx = makeTestContext({
		baseElements: [baseElement],
		targetElements: [targetElement, otherElement],
	});
	passFn(ctx);
	const classification = ctx.targetClassifications.get(targetElement);
	assert.deepEqual(
		{
			matched: ctx.matchedTarget.has(targetElement),
			unmatched: ctx.matchedTarget.has(otherElement),
			diffClass: classification?.diffClass,
			displacement: classification?.displacement,
		},
		{
			matched: true,
			unmatched: false,
			diffClass: "diff-changed",
			displacement,
		},
	);
}

const CLEANER_CASES = [
	{
		name: "cleanNetName normalizes nets and falls back to signal",
		fn: cleanNetName,
		cases: [
			["/GND", "gnd"],
			["Net-(R1-Pad1)", "r1-pad1"],
			["", "signal"],
			[null, "signal"],
			["unconnected", "signal"],
			["0", "signal"],
			["unconnected-(CLK)", "clk"],
		],
	},
	{
		name: "cleanLayerName strips svg extension and prefix, defaulting to F.Cu",
		fn: cleanLayerName,
		cases: [
			["board-F_Cu.svg", "F.Cu"],
			["myproj-B_Cu.svg", "B.Cu"],
			["", "F.Cu"],
			[null, "F.Cu"],
			["In1_Cu", "In1.Cu"],
			["board-B_Silkscreen.svg", "B.Silkscreen"],
		],
	},
	{
		name: "isCopperLayerFilename detects copper layers and rejects others",
		fn: isCopperLayerFilename,
		cases: [
			["board-F_Cu.svg", true],
			["board-B_Cu.svg", true],
			["board-In1_Cu.svg", true],
			["", false],
			[null, false],
			["board-F_Silkscreen.svg", false],
			["board-Edge_Cuts.svg", false],
		],
	},
];

const PAIR_MATCH_CASES = [
	{
		name: "matchRefDesComponentsPass matches components by refDes and computes displacement",
		passFn: matchRefDesComponentsPass,
		baseElement: makePrimitive({
			isComponent: true,
			refDes: "R1",
			center: { x: 10, y: 10 },
		}),
		targetElement: makePrimitive({
			isComponent: true,
			refDes: "R1",
			center: { x: 10, y: 14 },
		}),
		otherElement: makePrimitive({ isComponent: true, refDes: "C1" }),
		displacement: 4,
	},
	{
		name: "matchProximityPrimitivesPass matches primitives within threshold",
		passFn: matchProximityPrimitivesPass,
		baseElement: makePrimitive({ center: { x: 10, y: 10 } }),
		targetElement: makePrimitive({ center: { x: 10, y: 12 } }),
		otherElement: makePrimitive({ center: { x: 10, y: 50 } }),
		displacement: 2,
	},
];

describe("SVG Diff Processor Unit Tests", () => {
	for (const { name, fn, cases } of CLEANER_CASES) {
		test(name, () => {
			for (const [input, expected] of cases) {
				assert.equal(fn(input), expected);
			}
		});
	}

	test("extractElements extracts primitives, components, and detects frames", () => {
		const svg = [
			"<svg>",
			'  <line x1="0" y1="0" x2="10" y2="0" stroke="black" />',
			'  <g class="stroked-text"><desc>R1</desc><text x="12" y="15">R1</text></g>',
			'  <rect width="200" height="150" x="0" y="0" />',
			"</svg>",
		].join("\n");
		const elements = extractElements(svg);
		assertExpectedProperties(elements, [
			{ isComponent: true, refDes: "R1" },
			{ tag: "line", isWorksheetFrame: false },
			{ tag: "rect", isWorksheetFrame: true },
		]);
		assert.deepEqual(extractElements(""), []);
	});

	test("assembleTrackChains groups connected segments on copper layers", () => {
		const el1 = makePrimitive({
			tag: "line",
			fullMatch: '<line x1="0" y1="0" x2="10" y2="0" />',
		});
		const el2 = makePrimitive({
			tag: "line",
			fullMatch: '<line x1="10" y1="0" x2="20" y2="0" />',
		});
		const chains = assembleTrackChains([el1, el2], "board-F_Cu.svg");
		assert.deepEqual(
			chains.map((chain) => ({
				subSegmentsCount: chain.subSegments.length,
				totalLength: chain.totalLength,
			})),
			[{ subSegmentsCount: 2, totalLength: 20 }],
		);

		for (const [items, layer] of [
			[[], "board-F_Cu.svg"],
			[[el1, el2], "board-F_Mask.svg"],
		]) {
			assert.deepEqual(assembleTrackChains(items, layer), []);
		}
	});

	test("matchExactPrimitivesPass matches identical primitives and marks unchanged", () => {
		const baseEl = makePrimitive({ fullKey: "circle||r=5" });
		const targetEl = makePrimitive({ fullKey: "circle||r=5" });
		const frameEl = makePrimitive({
			fullKey: "circle||r=5",
			isWorksheetFrame: true,
		});
		const ctx = makeTestContext({
			baseElements: [baseEl],
			targetElements: [targetEl, frameEl],
		});

		matchExactPrimitivesPass(ctx);
		assert.deepEqual(
			{
				matchedBase: ctx.matchedBase.has(baseEl),
				matchedTarget: ctx.matchedTarget.has(targetEl),
				matchedFrame: ctx.matchedTarget.has(frameEl),
				diffClass: ctx.targetClassifications.get(targetEl)?.diffClass,
			},
			{
				matchedBase: true,
				matchedTarget: true,
				matchedFrame: false,
				diffClass: "diff-unchanged",
			},
		);
	});

	for (const { name, ...config } of PAIR_MATCH_CASES) {
		test(name, () => {
			runPairMatchTest(config);
		});
	}

	test("classifyDeletedBaseElements marks unclassified base elements as deleted", () => {
		const bEl1 = makePrimitive({ id: "line1" });
		const bEl2 = makePrimitive({ id: "line2", isWorksheetFrame: true });
		const ctx = makeTestContext({ baseElements: [bEl1, bEl2] });

		const nextIdx = classifyDeletedBaseElements(ctx, 3);
		const c1 = ctx.baseClassifications.get(bEl1);
		assert.deepEqual(
			{
				nextIdx,
				hasFrame: ctx.baseClassifications.has(bEl2),
				diffClass: c1?.diffClass,
				diffIdx: c1?.diffIdx,
				baseCoords: c1?.baseCoords,
			},
			{
				nextIdx: 4,
				hasFrame: false,
				diffClass: "diff-deleted",
				diffIdx: 3,
				baseCoords: { x: 10, y: 10 },
			},
		);
	});

	test("classifyAddedTargetElement marks target element as added with coordinates", () => {
		const tEl = makePrimitive({ id: "circ_new", center: { x: 5, y: 8 } });
		const ctx = makeTestContext();

		classifyAddedTargetElement(tEl, ctx, 7);
		const c = ctx.targetClassifications.get(tEl);
		assert.deepEqual(
			{
				diffClass: c?.diffClass,
				diffIdx: c?.diffIdx,
				targetCoords: c?.targetCoords,
				bbox: c?.bbox,
			},
			{
				diffClass: "diff-added",
				diffIdx: 7,
				targetCoords: { x: 5, y: 8 },
				bbox: { x1: 4, y1: 7, x2: 6, y2: 9 },
			},
		);
	});

	test("linkChangedElementPair joins changed target and base with shared properties", () => {
		const bEl = makePrimitive({ center: { x: 10, y: 10 } });
		const tEl = makePrimitive({ center: { x: 14, y: 10 } });
		const ctx = makeTestContext();
		setChangedPair(ctx, tEl, bEl, { displacement: 4 });

		linkChangedElementPair(tEl, bEl, ctx, 42);
		const { tClass, bClass } = getPairClassifications(ctx, tEl, bEl);
		assert.deepEqual(
			{
				tDiffIdx: tClass?.diffIdx,
				bDiffIdx: bClass?.diffIdx,
				bbox: tClass?.bbox,
			},
			{
				tDiffIdx: 42,
				bDiffIdx: 42,
				bbox: { x1: 9, y1: 9, x2: 15, y2: 11 },
			},
		);
	});

	test("classifyResidualElementsPass processes deleted base, added target, and changed pairs", () => {
		const bDel = makePrimitive({ center: { x: 2, y: 2 } });
		const bChanged = makePrimitive({ center: { x: 10, y: 10 } });
		const tAdded = makePrimitive({ center: { x: 30, y: 30 } });
		const tChanged = makePrimitive({ center: { x: 10, y: 15 } });

		const ctx = makeTestContext({
			baseElements: [bDel, bChanged],
			targetElements: [tAdded, tChanged],
		});
		ctx.matchedTargetToBase.set(tChanged, bChanged);
		setChangedPair(ctx, tChanged, bChanged);

		const nextIdx = classifyResidualElementsPass(ctx, 1);
		assert.deepEqual(
			{
				nextIdx,
				delClass: ctx.baseClassifications.get(bDel)?.diffClass,
				addedClass: ctx.targetClassifications.get(tAdded)?.diffClass,
				changedIdx: ctx.targetClassifications.get(tChanged)?.diffIdx,
			},
			{
				nextIdx: 4,
				delClass: "diff-deleted",
				addedClass: "diff-added",
				changedIdx: 3,
			},
		);
	});

	test("processSvgDiff executes complete diff pipeline and returns annotated SVGs", () => {
		const [baseSvg, targetSvg] = [10, 15].map(
			(y) => `<svg><circle cx="10" cy="${y}" r="5" stroke="black" /></svg>`,
		);
		const diff = processSvgDiff(baseSvg, targetSvg, {
			layerFilename: "board-F_Cu.svg",
			startDiffIdx: 5,
		});

		assert.ok(diff.baseSvg.includes("<svg"));
		assert.ok(diff.targetSvg.includes("<svg"));
		assert.ok(diff.nextDiffIdx >= 5);
		assert.ok(diff.telemetry.tTotalDiff >= 0);
		assert.deepEqual(
			{
				baseCount: diff.telemetry.baseCount,
				targetCount: diff.telemetry.targetCount,
			},
			{ baseCount: 1, targetCount: 1 },
		);

		const emptyDiff = processSvgDiff("<svg></svg>", "<svg></svg>");
		assert.deepEqual(
			{
				modificationsCount: emptyDiff.modifications.length,
				nextDiffIdx: emptyDiff.nextDiffIdx,
			},
			{ modificationsCount: 0, nextDiffIdx: 0 },
		);
	});
});
