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
		const isClose = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 0.02;
		const node1 = { pts: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } };
		const node2 = { pts: { start: { x: 10, y: 0 }, end: { x: 20, y: 0 } } };
		const component = [node1, node2];

		assert.equal(
			isPointConnectedToOther(node1.pts.end, node1, component, isClose),
			true,
		);
		assert.equal(
			isPointConnectedToOther(node1.pts.start, node1, component, isClose),
			false,
		);
		assert.equal(
			isPointConnectedToOther(node1.pts.end, node1, [node1], isClose),
			false,
		);

		const nearPoint = { x: 10.015, y: 0 };
		const farPoint = { x: 10.03, y: 0 };
		assert.equal(
			isPointConnectedToOther(nearPoint, node1, [node1, node2], isClose),
			true,
		);
		assert.equal(
			isPointConnectedToOther(farPoint, node1, [node1, node2], isClose),
			false,
		);
	});

	test("findTerminalAnchors finds open endpoints, handles empty components and loops", () => {
		const isClose = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 0.02;
		const seg1 = { pts: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } };
		const seg2 = { pts: { start: { x: 10, y: 0 }, end: { x: 20, y: 0 } } };

		const linearAnchors = findTerminalAnchors([seg1, seg2], isClose);
		assert.equal(linearAnchors.length, 2);
		assert.deepEqual(linearAnchors[0], { x: 0, y: 0 });
		assert.deepEqual(linearAnchors[1], { x: 20, y: 0 });

		assert.deepEqual(findTerminalAnchors([], isClose), []);

		const loop1 = { pts: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } };
		const loop2 = { pts: { start: { x: 10, y: 0 }, end: { x: 5, y: 10 } } };
		const loop3 = { pts: { start: { x: 5, y: 10 }, end: { x: 0, y: 0 } } };
		const loopAnchors = findTerminalAnchors([loop1, loop2, loop3], isClose);
		assert.deepEqual(loopAnchors, []);
	});

	test("computeChainMetrics computes bbox and totalLength for normal, empty, and edge cases", () => {
		const comp = [
			{ pts: { start: { x: 0, y: 0 }, end: { x: 3, y: 4 } } },
			{ pts: { start: { x: 3, y: 4 }, end: { x: 3, y: 10 } } },
		];
		const metrics = computeChainMetrics(comp);
		assert.equal(metrics.totalLength, 11);
		assert.deepEqual(metrics.bbox, { minX: 0, minY: 0, maxX: 3, maxY: 10 });

		const emptyMetrics = computeChainMetrics([]);
		assert.equal(emptyMetrics.totalLength, 0);
		assert.equal(emptyMetrics.bbox.minX, Infinity);

		const edgeComp = [
			{ pts: null },
			{ pts: { start: { x: 5, y: 5 }, end: { x: 5, y: 5 } } },
		];
		const edgeMetrics = computeChainMetrics(edgeComp);
		assert.equal(edgeMetrics.totalLength, 0);
		assert.deepEqual(edgeMetrics.bbox, { minX: 5, minY: 5, maxX: 5, maxY: 5 });
	});

	test("assembleTrackChains groups connected copper tracks into chains", () => {
		const el1 = makeLineElement({ x1: 0, y1: 0, x2: 10, y2: 0 });
		const el2 = makeLineElement({ x1: 10, y1: 0, x2: 10, y2: 20 });
		const chains = assembleTrackChains([el1, el2], "board-F_Cu.svg");

		assert.equal(chains.length, 1);
		assert.equal(chains[0].subSegments.length, 2);
		assert.equal(chains[0].totalLength, 30);
		assert.deepEqual(chains[0].startAnchor, { x: 0, y: 0 });
		assert.deepEqual(chains[0].endAnchor, { x: 10, y: 20 });
		assert.deepEqual(chains[0].bbox, { minX: 0, minY: 0, maxX: 10, maxY: 20 });
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

		assert.deepEqual(assembleTrackChains([track], "board-Edge_Cuts.svg"), []);
		assert.deepEqual(assembleTrackChains([], "board-F_Cu.svg"), []);
		assert.deepEqual(
			assembleTrackChains([component, closedPath], "board-F_Cu.svg"),
			[],
		);
	});

	test("findBestMatchingBaseChain matches nearest base chain within distance threshold", () => {
		const bChain1 = makeChain({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
		const bChain2 = makeChain({
			start: { x: 0, y: 20 },
			end: { x: 10, y: 20 },
		});
		const tChain = makeChain({
			start: { x: 0.1, y: 0 },
			end: { x: 10.1, y: 0 },
		});

		const matchedBase = new Set();
		const result = findBestMatchingBaseChain(
			tChain,
			[bChain1, bChain2],
			matchedBase,
		);

		assert.equal(result.bestBaseChain, bChain1);
		assert.ok(result.minD < 0.25);
	});

	test("findBestMatchingBaseChain handles empty base chains, reversed chains, and matched sets", () => {
		const tChain = makeChain({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });

		const emptyRes = findBestMatchingBaseChain(tChain, [], new Set());
		assert.equal(emptyRes.bestBaseChain, null);
		assert.equal(emptyRes.minD, Infinity);

		const reversedBase = makeChain({
			start: { x: 10, y: 0 },
			end: { x: 0, y: 0 },
		});
		const revRes = findBestMatchingBaseChain(tChain, [reversedBase], new Set());
		assert.equal(revRes.bestBaseChain, reversedBase);
		assert.equal(revRes.minD, 0);

		const skippedRes = findBestMatchingBaseChain(
			tChain,
			[reversedBase],
			new Set([reversedBase]),
		);
		assert.equal(skippedRes.bestBaseChain, null);
		assert.equal(skippedRes.minD, Infinity);

		const distantBase = makeChain({
			start: { x: 50, y: 50 },
			end: { x: 60, y: 50 },
		});
		const farRes = findBestMatchingBaseChain(tChain, [distantBase], new Set());
		assert.equal(farRes.bestBaseChain, null);
		assert.equal(farRes.minD, Infinity);
	});

	test("areChainsIdentical validates identity via geoKeys, bbox/length tolerances, and handles nulls", () => {
		const seg1 = { geoKey: "line1" };
		const seg2 = { geoKey: "line2" };
		const bChain = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [seg1],
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
			totalLength: 10,
		});

		const sameGeoTarget = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [seg1],
		});
		assert.equal(areChainsIdentical(bChain, sameGeoTarget, 0), true);

		const diffGeoTarget = makeChain({
			start: { x: 0.05, y: 0 },
			end: { x: 10.05, y: 0 },
			subSegments: [seg2],
			bbox: { minX: 0.05, minY: 0, maxX: 10.05, maxY: 0 },
			totalLength: 10.05,
		});
		assert.equal(areChainsIdentical(bChain, diffGeoTarget, 0.1), true);
		assert.equal(areChainsIdentical(bChain, diffGeoTarget, 0.3), false);

		const nullBoxChain = { ...diffGeoTarget, bbox: null };
		assert.equal(areChainsIdentical(bChain, nullBoxChain, 0.1), false);
	});

	test("applyChainClassifications assigns diff-unchanged for identical chains", () => {
		const bSeg = { id: "b1" };
		const tSeg = { id: "t1" };
		const bChain = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [bSeg],
		});
		const tChain = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [tSeg],
		});
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
		const bChain = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [bSeg],
		});
		const tChain = makeChain({
			start: { x: 0, y: 2 },
			end: { x: 10, y: 2 },
			subSegments: [tSeg],
		});
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
		assert.equal(bMeta.diffIdx, 42);
		assert.equal(bMeta.layer, "board-F_Cu.svg");
		assert.equal(bMeta.displacement, 2);
		assert.equal(tMeta.diffClass, "diff-changed");
		assert.equal(tMeta.displacement, 2);

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
		assert.equal(legCtx.baseClassifications.get(bSeg).diffIdx, 99);
		assert.equal(legCtx.baseClassifications.get(bSeg).layer, "board-B_Cu.svg");
	});

	test("matchTrackChainsPass matches changed, identical, and empty chains", () => {
		const segBase = { geoKey: "base1" };
		const segTargChanged = { geoKey: "targ1" };
		const bChain = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [segBase],
			totalLength: 10,
		});
		const tChainChanged = makeChain({
			start: { x: 0, y: 1 },
			end: { x: 10, y: 1 },
			subSegments: [segTargChanged],
			totalLength: 10,
		});

		const ctxChanged = createTestContext();
		const nextIdx = matchTrackChainsPass(
			[bChain],
			[tChainChanged],
			ctxChanged,
			"board-F_Cu.svg",
			0,
		);
		assert.equal(nextIdx, 1);
		assert.equal(
			ctxChanged.baseClassifications.get(segBase).diffClass,
			"diff-changed",
		);

		const tChainIdentical = makeChain({
			start: { x: 0, y: 0 },
			end: { x: 10, y: 0 },
			subSegments: [segBase],
			totalLength: 10,
		});
		const ctxIdentical = createTestContext();
		const sameIdx = matchTrackChainsPass(
			[bChain],
			[tChainIdentical],
			ctxIdentical,
			"board-F_Cu.svg",
			5,
		);
		assert.equal(sameIdx, 5);
		assert.equal(
			ctxIdentical.baseClassifications.get(segBase).diffClass,
			"diff-unchanged",
		);

		const ctxEmpty = createTestContext();
		const emptyIdx = matchTrackChainsPass(
			[],
			[],
			ctxEmpty,
			"board-F_Cu.svg",
			7,
		);
		assert.equal(emptyIdx, 7);
	});
});
