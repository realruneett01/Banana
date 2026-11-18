// All exports are pure in-memory topological and geometric operations; no kicad-cli or network required.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyChainClassifications,
	areChainsIdentical,
	assembleTrackChains,
	computeChainMetrics,
	findBestMatchingBaseChain,
	findConnectedComponent,
	findTerminalAnchors,
	isCopperLayerFilename,
	isPointConnectedToOther,
	matchTrackChainsPass,
} from "../../backend/src/track-chains.js";

function makeLine([x1, y1, x2, y2], opts = {}) {
	const { geoKey = "", isComponent = false, isClosedPath = false } = opts;
	return {
		tag: "line",
		fullMatch: `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`,
		geoKey: geoKey || `x1=${x1};y1=${y1};x2=${x2};y2=${y2}`,
		isComponent,
		isClosedPath,
	};
}

function makeTestChain([x1, y1, x2, y2], opts = {}) {
	const { subSegments = [], bbox = null, totalLength = 0 } = opts;
	const start = { x: x1, y: y1 };
	const end = { x: x2, y: y2 };
	return {
		startAnchor: start,
		endAnchor: end,
		subSegments,
		bbox: bbox ?? {
			minX: Math.min(x1, x2),
			minY: Math.min(y1, y2),
			maxX: Math.max(x1, x2),
			maxY: Math.max(y1, y2),
		},
		totalLength,
	};
}

function createTestContext() {
	return {
		matchedBase: new Set(),
		matchedTarget: new Set(),
		baseClassifications: new Map(),
		targetClassifications: new Map(),
	};
}

function isClose(p1, p2) {
	return Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 0.02;
}

function makeSegment(x1, y1, x2, y2) {
	return { pts: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } } };
}

function makeHorizontalPair() {
	return [makeSegment(0, 0, 10, 0), makeSegment(10, 0, 20, 0)];
}

function makeNode(id) {
	return { id, visited: false };
}

function makeGraph(adjacencies) {
	const map = new Map(adjacencies);
	return (node) => map.get(node) || [];
}

function assertMatchResult(actual, expectedBase, expectedMinD) {
	assert.equal(actual.bestBaseChain, expectedBase);
	assert.equal(actual.minD, expectedMinD);
}

function assertChainMetrics(comp, expectedLen, expectedBbox) {
	const { totalLength, bbox } = computeChainMetrics(comp);
	assert.deepEqual(
		{ totalLength, bbox },
		{ totalLength: expectedLen, bbox: expectedBbox },
	);
}

function assertChainProperties(chain, expected) {
	assert.deepEqual(
		{
			subSegments: chain.subSegments.length,
			totalLength: chain.totalLength,
			start: chain.startAnchor,
			end: chain.endAnchor,
			bbox: chain.bbox,
		},
		expected,
	);
}

function verifyAssembledChain(elements, layerFilename, expected) {
	const chains = assembleTrackChains(elements, layerFilename);
	assert.equal(chains.length, 1);
	assertChainProperties(chains[0], expected);
}

function assertClassificationPair(ctx, bSeg, tSeg, expected) {
	assert.ok(ctx.matchedBase.has(bSeg));
	assert.ok(ctx.matchedTarget.has(tSeg));
	assert.deepEqual(ctx.baseClassifications.get(bSeg), expected);
	assert.deepEqual(ctx.targetClassifications.get(tSeg), expected);
}

function assertChangedMetadata(meta, { diffIdx, layer, displacement }) {
	assert.equal(meta.diffClass, "diff-changed");
	assert.equal(meta.displacement, displacement);
	if (diffIdx !== undefined) {
		assert.equal(meta.diffIdx, diffIdx);
		assert.equal(meta.layer, layer);
	}
}

function verifyLegacyChainClassification(bChain, tChain, bSeg) {
	const legCtx = createTestContext();
	applyChainClassifications(
		bChain,
		tChain,
		false,
		99,
		"board-B_Cu.svg",
		legCtx.matchedBase,
		legCtx.matchedTarget,
		legCtx.baseClassifications,
		legCtx.targetClassifications,
	);
	const meta = legCtx.baseClassifications.get(bSeg);
	assert.deepEqual(
		{ diffIdx: meta.diffIdx, layer: meta.layer },
		{ diffIdx: 99, layer: "board-B_Cu.svg" },
	);
}

function createClassificationPair(bId, tId, targetCoords = [0, 0, 10, 0]) {
	const bSeg = { id: bId };
	const tSeg = { id: tId };
	const bChain = makeTestChain([0, 0, 10, 0], { subSegments: [bSeg] });
	const tChain = makeTestChain(targetCoords, { subSegments: [tSeg] });
	return { bSeg, tSeg, bChain, tChain, ctx: createTestContext() };
}

function makeMatchChain(y, segs) {
	return makeTestChain([0, y, 10, y], { subSegments: segs, totalLength: 10 });
}

function getMatchPassCases(segBase) {
	const bChain = makeMatchChain(0, [segBase]);
	const tChanged = makeMatchChain(1, [{ geoKey: "targ1" }]);
	const tIdentical = makeMatchChain(0, [segBase]);
	return [
		{
			base: [bChain],
			target: [tChanged],
			startIdx: 0,
			expectedIdx: 1,
			expectedClass: "diff-changed",
		},
		{
			base: [bChain],
			target: [tIdentical],
			startIdx: 5,
			expectedIdx: 5,
			expectedClass: "diff-unchanged",
		},
		{
			base: [],
			target: [],
			startIdx: 7,
			expectedIdx: 7,
			expectedClass: null,
		},
	];
}

function verifyMatchPass(tc, segBase) {
	const ctx = createTestContext();
	const resultIdx = matchTrackChainsPass(
		tc.base,
		tc.target,
		ctx,
		"board-F_Cu.svg",
		tc.startIdx,
	);
	assert.equal(resultIdx, tc.expectedIdx);
	if (tc.expectedClass) {
		assert.equal(
			ctx.baseClassifications.get(segBase).diffClass,
			tc.expectedClass,
		);
	}
}

function getBaseChainCases(reversedBase, distantBase) {
	const emptySet = new Set();
	return [
		{
			baseChains: [],
			matched: emptySet,
			expectedBase: null,
			expectedMinD: Infinity,
		},
		{
			baseChains: [reversedBase],
			matched: emptySet,
			expectedBase: reversedBase,
			expectedMinD: 0,
		},
		{
			baseChains: [reversedBase],
			matched: new Set([reversedBase]),
			expectedBase: null,
			expectedMinD: Infinity,
		},
		{
			baseChains: [distantBase],
			matched: emptySet,
			expectedBase: null,
			expectedMinD: Infinity,
		},
	];
}

describe("Copper Track Chain Assembly & Topological Matching", () => {
	test("isCopperLayerFilename classifies copper, non-copper, empty, and edge cases", () => {
		const cases = [
			{ filename: "board-F_Cu.svg", expected: true },
			{ filename: "board-B_Cu.svg", expected: true },
			{ filename: "board-In1_Cu.svg", expected: true },
			{ filename: "board-f_cu.svg", expected: true },
			{ filename: "board-Edge_Cuts.svg", expected: false },
			{ filename: "board-F_SilkS.svg", expected: false },
			{ filename: "F_Cu_trace.svg", expected: false },
			{ filename: "", expected: false },
			{ filename: null, expected: false },
			{ filename: undefined, expected: false },
		];

		for (const { filename, expected } of cases) {
			assert.equal(isCopperLayerFilename(filename), expected);
		}
	});

	test("findConnectedComponent traverses components, single nodes, and cycles", () => {
		const [nodeA, nodeB, nodeC] = ["A", "B", "C"].map(makeNode);
		const getNeighbors = makeGraph([
			[nodeA, [nodeB]],
			[nodeB, [nodeC]],
			[nodeC, []],
		]);
		assert.deepEqual(findConnectedComponent(nodeA, getNeighbors), [
			nodeA,
			nodeB,
			nodeC,
		]);

		const isolated = makeNode("iso");
		assert.deepEqual(
			findConnectedComponent(isolated, () => []),
			[isolated],
		);

		const [cycleA, cycleB] = ["c1", "c2"].map(makeNode);
		const getCycleNeighbors = makeGraph([
			[cycleA, [cycleB]],
			[cycleB, [cycleA]],
		]);
		assert.equal(findConnectedComponent(cycleA, getCycleNeighbors).length, 2);
	});

	test("isPointConnectedToOther evaluates connection to other nodes with tolerance", () => {
		const [node1, node2] = makeHorizontalPair();
		const component = [node1, node2];

		const cases = [
			{ pt: node1.pts.end, comp: component, expected: true },
			{ pt: node1.pts.start, comp: component, expected: false },
			{ pt: node1.pts.end, comp: [node1], expected: false },
			{ pt: { x: 10.015, y: 0 }, comp: component, expected: true },
			{ pt: { x: 10.03, y: 0 }, comp: component, expected: false },
		];

		for (const { pt, comp, expected } of cases) {
			assert.equal(isPointConnectedToOther(pt, node1, comp, isClose), expected);
		}
	});

	test("findTerminalAnchors finds open endpoints, handles empty components and loops", () => {
		const linearAnchors = findTerminalAnchors(makeHorizontalPair(), isClose);
		assert.deepEqual(linearAnchors, [
			{ x: 0, y: 0 },
			{ x: 20, y: 0 },
		]);

		const loop = [
			makeSegment(0, 0, 10, 0),
			makeSegment(10, 0, 5, 10),
			makeSegment(5, 10, 0, 0),
		];
		assert.deepEqual(findTerminalAnchors([], isClose), []);
		assert.deepEqual(findTerminalAnchors(loop, isClose), []);
	});

	test("computeChainMetrics computes bbox and totalLength for normal, empty, and edge cases", () => {
		const cases = [
			{
				comp: [makeSegment(0, 0, 3, 4), makeSegment(3, 4, 3, 10)],
				expectedLen: 11,
				expectedBbox: { minX: 0, minY: 0, maxX: 3, maxY: 10 },
			},
			{
				comp: [{ pts: null }, makeSegment(5, 5, 5, 5)],
				expectedLen: 0,
				expectedBbox: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
			},
			{
				comp: [],
				expectedLen: 0,
				expectedBbox: {
					minX: Infinity,
					minY: Infinity,
					maxX: -Infinity,
					maxY: -Infinity,
				},
			},
		];

		for (const { comp, expectedLen, expectedBbox } of cases) {
			assertChainMetrics(comp, expectedLen, expectedBbox);
		}
	});

	test("assembleTrackChains groups connected copper tracks into chains", () => {
		const el1 = makeLine([0, 0, 10, 0]);
		const el2 = makeLine([10, 0, 10, 20]);
		verifyAssembledChain([el1, el2], "board-F_Cu.svg", {
			subSegments: 2,
			totalLength: 30,
			start: { x: 0, y: 0 },
			end: { x: 10, y: 20 },
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
		});
	});

	test("assembleTrackChains filters non-copper, non-tracks, and empty elements", () => {
		const track = makeLine([0, 0, 10, 0]);
		const component = makeLine([0, 0, 10, 0], { isComponent: true });
		const closedPath = {
			tag: "path",
			fullMatch: '<path d="M 0 0 L 10 0" fill="red"/>',
			geoKey: "d=M 0 0 L 10 0",
			isComponent: false,
			isClosedPath: true,
		};

		const cases = [
			{ elements: [track], layer: "board-Edge_Cuts.svg" },
			{ elements: [], layer: "board-F_Cu.svg" },
			{ elements: [component, closedPath], layer: "board-F_Cu.svg" },
		];

		for (const { elements, layer } of cases) {
			assert.deepEqual(assembleTrackChains(elements, layer), []);
		}
	});

	test("findBestMatchingBaseChain matches nearest base chain within distance threshold", () => {
		const bChain1 = makeTestChain([0, 0, 10, 0]);
		const bChain2 = makeTestChain([0, 20, 10, 20]);
		const tChain = makeTestChain([0.1, 0, 10.1, 0]);

		const result = findBestMatchingBaseChain(
			tChain,
			[bChain1, bChain2],
			new Set(),
		);

		assert.equal(result.bestBaseChain, bChain1);
		assert.ok(result.minD < 0.25);
	});

	test("findBestMatchingBaseChain handles empty base chains, reversed chains, and matched sets", () => {
		const tChain = makeTestChain([0, 0, 10, 0]);
		const reversedBase = makeTestChain([10, 0, 0, 0]);
		const distantBase = makeTestChain([50, 50, 60, 50]);

		for (const tc of getBaseChainCases(reversedBase, distantBase)) {
			assertMatchResult(
				findBestMatchingBaseChain(tChain, tc.baseChains, tc.matched),
				tc.expectedBase,
				tc.expectedMinD,
			);
		}
	});

	test("areChainsIdentical validates identity via geoKeys, bbox/length tolerances, and handles nulls", () => {
		const seg1 = { geoKey: "line1" };
		const seg2 = { geoKey: "line2" };
		const bChain = makeTestChain([0, 0, 10, 0], {
			subSegments: [seg1],
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
			totalLength: 10,
		});
		const sameGeo = makeTestChain([0, 0, 10, 0], { subSegments: [seg1] });
		const diffGeo = makeTestChain([0.05, 0, 10.05, 0], {
			subSegments: [seg2],
			bbox: { minX: 0.05, minY: 0, maxX: 10.05, maxY: 0 },
			totalLength: 10.05,
		});

		const cases = [
			{ target: sameGeo, tol: 0, expected: true },
			{ target: diffGeo, tol: 0.1, expected: true },
			{ target: diffGeo, tol: 0.3, expected: false },
			{ target: { ...diffGeo, bbox: null }, tol: 0.1, expected: false },
		];

		for (const { target, tol, expected } of cases) {
			assert.equal(areChainsIdentical(bChain, target, tol), expected);
		}
	});

	test("applyChainClassifications assigns diff-unchanged for identical chains", () => {
		const { bSeg, tSeg, bChain, tChain, ctx } = createClassificationPair(
			"b1",
			"t1",
		);
		applyChainClassifications(bChain, tChain, { chainsIdentical: true }, ctx);
		assertClassificationPair(ctx, bSeg, tSeg, { diffClass: "diff-unchanged" });
	});

	test("applyChainClassifications assigns diff-changed metadata and supports legacy arguments", () => {
		const { bSeg, tSeg, bChain, tChain, ctx } = createClassificationPair(
			"b2",
			"t2",
			[0, 2, 10, 2],
		);

		applyChainClassifications(
			bChain,
			tChain,
			{
				chainsIdentical: false,
				sharedIdx: 42,
				layerFilename: "board-F_Cu.svg",
			},
			ctx,
		);

		const bMeta = ctx.baseClassifications.get(bSeg);
		const tMeta = ctx.targetClassifications.get(tSeg);
		assertChangedMetadata(bMeta, {
			diffIdx: 42,
			layer: "board-F_Cu.svg",
			displacement: 2,
		});
		assertChangedMetadata(tMeta, { displacement: 2 });

		verifyLegacyChainClassification(bChain, tChain, bSeg);
	});

	test("matchTrackChainsPass matches changed, identical, and empty chains", () => {
		const segBase = { geoKey: "base1" };
		for (const tc of getMatchPassCases(segBase)) {
			verifyMatchPass(tc, segBase);
		}
	});
});
