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
	const {
		baseElements = [],
		targetElements = [],
		layerFilename = "board-F_Cu.svg",
	} = options;
	return {
		baseElements,
		targetElements,
		matchedBase: new Set(),
		matchedTarget: new Set(),
		matchedTargetToBase: new Map(),
		matchedBaseToTarget: new Map(),
		baseClassifications: new Map(),
		targetClassifications: new Map(),
		layerFilename,
	};
}

function makePrimitive(overrides = {}) {
	return {
		tag: "circle",
		fullMatch: '<circle cx="10" cy="10" r="2" />',
		fullKey: "circle||cx=10;cy=10;r=2",
		idKey: "circle|",
		geoKey: "cx=10;cy=10;r=2",
		id: "",
		label: "",
		text: "",
		isClosedPath: false,
		isComponent: false,
		isWorksheetFrame: false,
		center: { x: 10, y: 10 },
		...overrides,
	};
}

describe("SVG Diff Processor Unit Tests", () => {
	test("cleanNetName normalizes nets and falls back to signal", () => {
		const cases = [
			{ input: "/GND", expected: "gnd" },
			{ input: "Net-(R1-Pad1)", expected: "r1-pad1" },
			{ input: "", expected: "signal" },
			{ input: null, expected: "signal" },
			{ input: "unconnected", expected: "signal" },
			{ input: "0", expected: "signal" },
			{ input: "unconnected-(CLK)", expected: "clk" },
		];
		for (const { input, expected } of cases) {
			assert.equal(cleanNetName(input), expected);
		}
	});

	test("cleanLayerName strips svg extension and prefix, defaulting to F.Cu", () => {
		const cases = [
			{ input: "board-F_Cu.svg", expected: "F.Cu" },
			{ input: "myproj-B_Cu.svg", expected: "B.Cu" },
			{ input: "", expected: "F.Cu" },
			{ input: null, expected: "F.Cu" },
			{ input: "In1_Cu", expected: "In1.Cu" },
			{ input: "board-B_Silkscreen.svg", expected: "B.Silkscreen" },
		];
		for (const { input, expected } of cases) {
			assert.equal(cleanLayerName(input), expected);
		}
	});

	test("isCopperLayerFilename detects copper layers and rejects others", () => {
		const cases = [
			{ input: "board-F_Cu.svg", expected: true },
			{ input: "board-B_Cu.svg", expected: true },
			{ input: "board-In1_Cu.svg", expected: true },
			{ input: "", expected: false },
			{ input: null, expected: false },
			{ input: "board-F_Silkscreen.svg", expected: false },
			{ input: "board-Edge_Cuts.svg", expected: false },
		];
		for (const { input, expected } of cases) {
			assert.equal(isCopperLayerFilename(input), expected);
		}
	});

	test("extractElements extracts primitives, components, and detects frames", () => {
		const svg = [
			"<svg>",
			'  <line x1="0" y1="0" x2="10" y2="0" stroke="black" />',
			'  <g class="stroked-text"><desc>R1</desc><text x="12" y="15">R1</text></g>',
			'  <rect width="200" height="150" x="0" y="0" />',
			"</svg>",
		].join("\n");
		const elements = extractElements(svg);
		assert.equal(elements.length, 3);
		assert.equal(elements[0].isComponent, true);
		assert.equal(elements[0].refDes, "R1");
		assert.equal(elements[1].tag, "line");
		assert.equal(elements[1].isWorksheetFrame, false);
		assert.equal(elements[2].tag, "rect");
		assert.equal(elements[2].isWorksheetFrame, true);

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
		assert.equal(chains.length, 1);
		assert.equal(chains[0].subSegments.length, 2);
		assert.equal(chains[0].totalLength, 20);

		assert.deepEqual(assembleTrackChains([], "board-F_Cu.svg"), []);
		assert.deepEqual(assembleTrackChains([el1, el2], "board-F_Mask.svg"), []);
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
		assert.equal(ctx.matchedBase.has(baseEl), true);
		assert.equal(ctx.matchedTarget.has(targetEl), true);
		assert.equal(ctx.matchedTarget.has(frameEl), false);
		assert.equal(
			ctx.targetClassifications.get(targetEl)?.diffClass,
			"diff-unchanged",
		);
	});

	test("matchRefDesComponentsPass matches components by refDes and computes displacement", () => {
		const baseEl = makePrimitive({
			isComponent: true,
			refDes: "R1",
			center: { x: 10, y: 10 },
		});
		const targetEl = makePrimitive({
			isComponent: true,
			refDes: "R1",
			center: { x: 10, y: 14 },
		});
		const unmatchedEl = makePrimitive({ isComponent: true, refDes: "C1" });
		const ctx = makeTestContext({
			baseElements: [baseEl],
			targetElements: [targetEl, unmatchedEl],
		});

		matchRefDesComponentsPass(ctx);
		assert.equal(ctx.matchedTarget.has(targetEl), true);
		assert.equal(ctx.matchedTarget.has(unmatchedEl), false);
		const classification = ctx.targetClassifications.get(targetEl);
		assert.equal(classification?.diffClass, "diff-changed");
		assert.equal(classification?.displacement, 4);
	});

	test("matchProximityPrimitivesPass matches primitives within threshold", () => {
		const baseNear = makePrimitive({ center: { x: 10, y: 10 } });
		const targetNear = makePrimitive({ center: { x: 10, y: 12 } });
		const targetFar = makePrimitive({ center: { x: 10, y: 50 } });
		const ctx = makeTestContext({
			baseElements: [baseNear],
			targetElements: [targetNear, targetFar],
		});

		matchProximityPrimitivesPass(ctx);
		assert.equal(ctx.matchedTarget.has(targetNear), true);
		assert.equal(ctx.matchedTarget.has(targetFar), false);
		assert.equal(
			ctx.targetClassifications.get(targetNear)?.diffClass,
			"diff-changed",
		);
		assert.equal(ctx.targetClassifications.get(targetNear)?.displacement, 2);
	});

	test("classifyDeletedBaseElements marks unclassified base elements as deleted", () => {
		const bEl1 = makePrimitive({ id: "line1" });
		const bEl2 = makePrimitive({ id: "line2", isWorksheetFrame: true });
		const ctx = makeTestContext({ baseElements: [bEl1, bEl2] });

		const nextIdx = classifyDeletedBaseElements(ctx, 3);
		assert.equal(nextIdx, 4);
		assert.equal(ctx.baseClassifications.has(bEl2), false);
		const c1 = ctx.baseClassifications.get(bEl1);
		assert.equal(c1?.diffClass, "diff-deleted");
		assert.equal(c1?.diffIdx, 3);
		assert.deepEqual(c1?.baseCoords, { x: 10, y: 10 });
	});

	test("classifyAddedTargetElement marks target element as added with coordinates", () => {
		const tEl = makePrimitive({ id: "circ_new", center: { x: 5, y: 8 } });
		const ctx = makeTestContext();

		classifyAddedTargetElement(tEl, ctx, 7);
		const c = ctx.targetClassifications.get(tEl);
		assert.equal(c?.diffClass, "diff-added");
		assert.equal(c?.diffIdx, 7);
		assert.deepEqual(c?.targetCoords, { x: 5, y: 8 });
		assert.deepEqual(c?.bbox, { x1: 4, y1: 7, x2: 6, y2: 9 });
	});

	test("linkChangedElementPair joins changed target and base with shared properties", () => {
		const bEl = makePrimitive({ center: { x: 10, y: 10 } });
		const tEl = makePrimitive({ center: { x: 14, y: 10 } });
		const ctx = makeTestContext();
		ctx.targetClassifications.set(tEl, {
			diffClass: "diff-changed",
			displacement: 4,
		});
		ctx.baseClassifications.set(bEl, {
			diffClass: "diff-changed",
			displacement: 4,
		});

		linkChangedElementPair(tEl, bEl, ctx, 42);
		const tClass = ctx.targetClassifications.get(tEl);
		const bClass = ctx.baseClassifications.get(bEl);
		assert.equal(tClass?.diffIdx, 42);
		assert.equal(bClass?.diffIdx, 42);
		assert.deepEqual(tClass?.bbox, { x1: 9, y1: 9, x2: 15, y2: 11 });
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
		ctx.baseClassifications.set(bChanged, { diffClass: "diff-changed" });
		ctx.targetClassifications.set(tChanged, { diffClass: "diff-changed" });

		const nextIdx = classifyResidualElementsPass(ctx, 1);
		assert.equal(nextIdx, 4);
		assert.equal(ctx.baseClassifications.get(bDel)?.diffClass, "diff-deleted");
		assert.equal(
			ctx.targetClassifications.get(tAdded)?.diffClass,
			"diff-added",
		);
		assert.equal(ctx.targetClassifications.get(tChanged)?.diffIdx, 3);
	});

	test("processSvgDiff executes complete diff pipeline and returns annotated SVGs", () => {
		const baseSvg =
			'<svg><circle cx="10" cy="10" r="5" stroke="black" /></svg>';
		const targetSvg =
			'<svg><circle cx="10" cy="15" r="5" stroke="black" /></svg>';
		const diff = processSvgDiff(baseSvg, targetSvg, {
			layerFilename: "board-F_Cu.svg",
			startDiffIdx: 5,
		});

		assert.ok(diff.baseSvg.includes("<svg"));
		assert.ok(diff.targetSvg.includes("<svg"));
		assert.ok(diff.nextDiffIdx >= 5);
		assert.ok(diff.telemetry.tTotalDiff >= 0);
		assert.equal(diff.telemetry.baseCount, 1);
		assert.equal(diff.telemetry.targetCount, 1);

		const emptyDiff = processSvgDiff("<svg></svg>", "<svg></svg>");
		assert.equal(emptyDiff.modifications.length, 0);
		assert.equal(emptyDiff.nextDiffIdx, 0);
	});
});
