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

function makeLineElement(opts) {
	const {
		x1,
		y1,
		x2,
		y2,
		geoKey = "",
		isComponent = false,
		isClosedPath = false,
	} = opts;
	return {
		tag: "line",
		fullMatch: `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`,
		geoKey: geoKey || `x1=${x1};y1=${y1};x2=${x2};y2=${y2}`,
		isComponent,
		isClosedPath,
	};
}

function makeChain(opts) {
	const { start, end, subSegments = [], bbox = null, totalLength = 0 } = opts;
	const defaultBbox = {
		minX: Math.min(start.x, end.x),
		minY: Math.min(start.y, end.y),
		maxX: Math.max(start.x, end.x),
		maxY: Math.max(start.y, end.y),
	};
	return {
		startAnchor: start,
		endAnchor: end,
		subSegments,
		bbox: bbox ?? defaultBbox,
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

function makeTestChain(x1, y1, x2, y2, opts = {}) {
	return makeChain({
		start: { x: x1, y: y1 },
		end: { x: x2, y: y2 },
		...opts,
	});
}

function assertClassificationRef(meta, diffIdx, layer) {
	assert.equal(meta.diffIdx, diffIdx);
	assert.equal(meta.layer, layer);
}

function verifyAssembledChain(elements, layerFilename, expected) {
	const chains = assembleTrackChains(elements, layerFilename);
	assert.equal(chains.length, 1);
	const [chain] = chains;
	assert.equal(chain.subSegments.length, expected.subSegments);
	assert.equal(chain.totalLength, expected.totalLength);
	assert.deepEqual(chain.startAnchor, expected.start);
	assert.deepEqual(chain.endAnchor, expected.end);
	assert.deepEqual(chain.bbox, expected.bbox);
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
	assertClassificationRef(
		legCtx.baseClassifications.get(bSeg),
		99,
		"board-B_Cu.svg",
	);
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
		const nodeA = { id: "A", visited: false };
		const nodeB = { id: "B", visited: false };
		const nodeC = { id: "C", visited: false };
		const graph = new Map([
			[nodeA, [nodeB]],
			[nodeB, [nodeC]],
			[nodeC, []],
		]);
		const component = findConnectedComponent(
			nodeA,
			(curr) => graph.get(curr) || [],
		);
		assert.deepEqual(component, [nodeA, nodeB, nodeC]);

		const isolated = { id: "iso", visited: false };
		const isolatedRes = findConnectedComponent(isolated, () => []);
		assert.deepEqual(isolatedRes, [isolated]);

		const cycleA = { id: "c1", visited: false };
		const cycleB = { id: "c2", visited: false };
		const cycleGraph = new Map([
			[cycleA, [cycleB]],
			[cycleB, [cycleA]],
		]);
		const cycleRes = findConnectedComponent(
			cycleA,
			(curr) => cycleGraph.get(curr) || [],
		);
		assert.equal(cycleRes.length, 2);
	});

	test("isPointConnectedToOther evaluates connection to other nodes with tolerance", () => {
		const node1 = makeSegment(0, 0, 10, 0);
		const node2 = makeSegment(10, 0, 20, 0);
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
		const seg1 = makeSegment(0, 0, 10, 0);
		const seg2 = makeSegment(10, 0, 20, 0);
		const linearAnchors = findTerminalAnchors([seg1, seg2], isClose);
		assert.equal(linearAnchors.length, 2);
		assert.deepEqual(linearAnchors[0], { x: 0, y: 0 });
		assert.deepEqual(linearAnchors[1], { x: 20, y: 0 });

		const loop = [
			makeSegment(0, 0, 10, 0),
			makeSegment(10, 0, 5, 10),
			makeSegment(5, 10, 0, 0),
		];
		assert.deepEqual(findTerminalAnchors([], isClose), []);
		assert.deepEqual(findTerminalAnchors(loop, isClose), []);
	});

	test("computeChainMetrics computes bbox and totalLength for normal, empty, and edge cases", () => {
		const normalComp = [makeSegment(0, 0, 3, 4), makeSegment(3, 4, 3, 10)];
		const edgeComp = [{ pts: null }, makeSegment(5, 5, 5, 5)];

		const cases = [
			{
				comp: normalComp,
				expectedLen: 11,
				expectedBbox: { minX: 0, minY: 0, maxX: 3, maxY: 10 },
			},
			{
				comp: edgeComp,
				expectedLen: 0,
				expectedBbox: { minX: 5, minY: 5, maxX: 5, maxY: 5 },
			},
		];

		for (const { comp, expectedLen, expectedBbox } of cases) {
			const metrics = computeChainMetrics(comp);
			assert.equal(metrics.totalLength, expectedLen);
			assert.deepEqual(metrics.bbox, expectedBbox);
		}

		const emptyMetrics = computeChainMetrics([]);
		assert.equal(emptyMetrics.totalLength, 0);
		assert.equal(emptyMetrics.bbox.minX, Infinity);
	});

	test("assembleTrackChains groups connected copper tracks into chains", () => {
		const el1 = makeLineElement({ x1: 0, y1: 0, x2: 10, y2: 0 });
		const el2 = makeLineElement({ x1: 10, y1: 0, x2: 10, y2: 20 });
		verifyAssembledChain([el1, el2], "board-F_Cu.svg", {
			subSegments: 2,
			totalLength: 30,
			start: { x: 0, y: 0 },
			end: { x: 10, y: 20 },
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
		});
	});

	test("assembleTrackChains filters non-copper, non-tracks, and empty elements", () => {
		const track = makeLineElement({ x1: 0, y1: 0, x2: 10, y2: 0 });
		const component = makeLineElement({
			x1: 0,
			y1: 0,
			x2: 10,
			y2: 0,
			isComponent: true,
		});
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
		const bChain1 = makeTestChain(0, 0, 10, 0);
		const bChain2 = makeTestChain(0, 20, 10, 20);
		const tChain = makeTestChain(0.1, 0, 10.1, 0);

		const result = findBestMatchingBaseChain(
			tChain,
			[bChain1, bChain2],
			new Set(),
		);

		assert.equal(result.bestBaseChain, bChain1);
		assert.ok(result.minD < 0.25);
	});

	test("findBestMatchingBaseChain handles empty base chains, reversed chains, and matched sets", () => {
		const tChain = makeTestChain(0, 0, 10, 0);
		const reversedBase = makeTestChain(10, 0, 0, 0);
		const distantBase = makeTestChain(50, 50, 60, 50);

		const cases = [
			{
				baseChains: [],
				matched: new Set(),
				expectedBase: null,
				expectedMinD: Infinity,
			},
			{
				baseChains: [reversedBase],
				matched: new Set(),
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
				matched: new Set(),
				expectedBase: null,
				expectedMinD: Infinity,
			},
		];

		for (const { baseChains, matched, expectedBase, expectedMinD } of cases) {
			const res = findBestMatchingBaseChain(tChain, baseChains, matched);
			assert.equal(res.bestBaseChain, expectedBase);
			assert.equal(res.minD, expectedMinD);
		}
	});

	test("areChainsIdentical validates identity via geoKeys, bbox/length tolerances, and handles nulls", () => {
		const seg1 = { geoKey: "line1" };
		const seg2 = { geoKey: "line2" };
		const bChain = makeTestChain(0, 0, 10, 0, {
			subSegments: [seg1],
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
			totalLength: 10,
		});
		const sameGeo = makeTestChain(0, 0, 10, 0, { subSegments: [seg1] });
		const diffGeo = makeTestChain(0.05, 0, 10.05, 0, {
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
		const bSeg = { id: "b1" };
		const tSeg = { id: "t1" };
		const bChain = makeTestChain(0, 0, 10, 0, { subSegments: [bSeg] });
		const tChain = makeTestChain(0, 0, 10, 0, { subSegments: [tSeg] });
		const ctx = createTestContext();

		applyChainClassifications(bChain, tChain, { chainsIdentical: true }, ctx);

		assert.ok(ctx.matchedBase.has(bSeg));
		assert.ok(ctx.matchedTarget.has(tSeg));
		assert.deepEqual(ctx.baseClassifications.get(bSeg), {
			diffClass: "diff-unchanged",
		});
		assert.deepEqual(ctx.targetClassifications.get(tSeg), {
			diffClass: "diff-unchanged",
		});
	});

	test("applyChainClassifications assigns diff-changed metadata and supports legacy arguments", () => {
		const bSeg = { id: "b2" };
		const tSeg = { id: "t2" };
		const bChain = makeTestChain(0, 0, 10, 0, { subSegments: [bSeg] });
		const tChain = makeTestChain(0, 2, 10, 2, { subSegments: [tSeg] });
		const ctx = createTestContext();

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
		assert.equal(bMeta.diffClass, "diff-changed");
		assertClassificationRef(bMeta, 42, "board-F_Cu.svg");
		assert.equal(bMeta.displacement, 2);
		assert.equal(tMeta.diffClass, "diff-changed");
		assert.equal(tMeta.displacement, 2);

		verifyLegacyChainClassification(bChain, tChain, bSeg);
	});

	test("matchTrackChainsPass matches changed, identical, and empty chains", () => {
		const segBase = { geoKey: "base1" };
		const bChain = makeTestChain(0, 0, 10, 0, {
			subSegments: [segBase],
			totalLength: 10,
		});
		const tChanged = makeTestChain(0, 1, 10, 1, {
			subSegments: [{ geoKey: "targ1" }],
			totalLength: 10,
		});
		const tIdentical = makeTestChain(0, 0, 10, 0, {
			subSegments: [segBase],
			totalLength: 10,
		});

		const cases = [
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

		for (const {
			base,
			target,
			startIdx,
			expectedIdx,
			expectedClass,
		} of cases) {
			const ctx = createTestContext();
			const resultIdx = matchTrackChainsPass(
				base,
				target,
				ctx,
				"board-F_Cu.svg",
				startIdx,
			);
			assert.equal(resultIdx, expectedIdx);
			if (expectedClass) {
				assert.equal(
					ctx.baseClassifications.get(segBase).diffClass,
					expectedClass,
				);
			}
		}
	});
});
