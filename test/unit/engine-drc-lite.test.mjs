import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	runLiveChecks,
	segmentSegmentDistance,
} from "../../backend/src/engine/drc-lite.js";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";

function formatMockId(kind, n) {
	const hex = String(n).padStart(12, "0");
	return `${kind}_00000000-0000-0000-0000-${hex}`;
}

function makeIdCounter() {
	let count = 0;
	return (kind) => {
		count++;
		return formatMockId(kind, count);
	};
}

function makeSeededRandom(seed = 42) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

function createPart(ref, overrides = {}) {
	return {
		id: newId("part"),
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		placement: { x: 50, y: 50, rot: 0, side: "F" },
		...overrides,
	};
}

function createNet(name, pins = [], id = newId("net")) {
	return { id, name, pins };
}

function createSimpleNet(name, p1, p2, netId) {
	return createNet(
		name,
		[
			{ partId: p1.id, pin: "1" },
			{ partId: p2.id, pin: "1" },
		],
		netId,
	);
}

function createTwoPartIr({
	p1Placement = { x: 50, y: 50, rot: 0, side: "F" },
	p2Placement = { x: 50, y: 50, rot: 0, side: "F" },
	netName,
	netId,
	name = "B",
} = {}) {
	const p1 = createPart("R1", { placement: p1Placement });
	const p2 = createPart("R2", { placement: p2Placement });
	const nets = netName ? [createSimpleNet(netName, p1, p2, netId)] : [];
	return { ir: createIr({ name, parts: [p1, p2], nets }), p1, p2 };
}

function createRectOutline(x1 = 0, y1 = 0, x2 = 100, y2 = 100) {
	return [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
}

function createTrack(overrides = {}) {
	return {
		netId: newId("net"),
		layer: "F.Cu",
		start: [10, 10],
		end: [20, 10],
		widthMm: 0.25,
		...overrides,
	};
}

function createHorizTrack(netId, y, layer = "F.Cu") {
	return createTrack({ netId, layer, start: [10, y], end: [20, y] });
}

function createIr({ parts = [], nets = [], name = "B" } = {}) {
	return {
		schemaVersion: 1,
		name,
		parts,
		nets,
		constraints: [],
	};
}

function assertValidIssues(issues) {
	for (const issue of issues) {
		const res = validateIssue(issue);
		assert.ok(res.ok, `Invalid issue: ${res.errors.join(", ")}`);
	}
}

function assertMetricCount(res, metric, count) {
	const matched = res.issues.filter((i) => i.metric === metric);
	assert.equal(matched.length, count);
	return matched;
}

function assertMetricViolation(res, metric, count) {
	assertValidIssues(res.issues);
	return assertMetricCount(res, metric, count);
}

function assertSingleViolation(res, metric, messageSubstring) {
	const matched = assertMetricViolation(res, metric, 1);
	assert.ok(matched[0].message.includes(messageSubstring));
	assert.equal(res.markers.length, 1);
}

function checkTrackWidth(widthMm, minTrackWidthMm = 0.15) {
	const board = { tracks: [createTrack({ widthMm })] };
	return runLiveChecks({ board, rules: { minTrackWidthMm } });
}

function runOutlineCheck(outline, partPos, trackSeg, rules) {
	const part = createPart("U1", {
		placement: { x: partPos[0], y: partPos[1], side: "F" },
	});
	const track = createTrack({ start: trackSeg[0], end: trackSeg[1] });
	const ir = createIr({ parts: [part] });
	const board = { outline, tracks: [track] };
	return runLiveChecks({ ir, board, ...(rules ? { rules } : {}) });
}

function checkTwoPinRouting(tracksFn) {
	const netId = newId("net");
	const { ir, p1, p2 } = createTwoPartIr({
		p1Placement: { x: 10, y: 10, rot: 0, side: "F" },
		p2Placement: { x: 40, y: 10, rot: 0, side: "F" },
		netName: "NET1",
		netId,
	});
	const board = {
		pads: [
			{ partId: p1.id, pin: "1", at: [10, 10] },
			{ partId: p2.id, pin: "1", at: [40, 10] },
		],
		tracks: tracksFn ? tracksFn(netId) : [],
	};
	return runLiveChecks({ ir, board });
}

function checkOverlappingParts(side) {
	const { ir } = createTwoPartIr({
		p1Placement: { x: 20, y: 20, rot: 0, side: "F" },
		p2Placement: { x: 20.5, y: 20.2, rot: 0, side },
	});
	return runLiveChecks({ ir });
}

function isClearanceViolation(a, b, clearanceMm) {
	if (a.layer !== b.layer || a.netId === b.netId) return false;
	const res = segmentSegmentDistance(a.start, a.end, b.start, b.end);
	const clearance = res.dist - (a.widthMm + b.widthMm) / 2;
	return clearance < clearanceMm - 1e-9;
}

function formatTrackPair(t1, t2) {
	return [t1.id, t2.id].sort().join(":");
}

function collectPairsForTrack(tracks, i, clearanceMm, pairs) {
	for (let j = i + 1; j < tracks.length; j++) {
		if (isClearanceViolation(tracks[i], tracks[j], clearanceMm)) {
			pairs.push(formatTrackPair(tracks[i], tracks[j]));
		}
	}
}

function bruteForceClearancePairs(tracks, clearanceMm) {
	const pairs = [];
	for (let i = 0; i < tracks.length; i++) {
		collectPairsForTrack(tracks, i, clearanceMm, pairs);
	}
	return pairs.sort();
}

function generateRandomTracks(count, rng, area = 100) {
	const tracks = [];
	for (let i = 0; i < count; i++) {
		const x = rng() * area;
		const y = rng() * area;
		const len = 0.5 + rng() * 2.0;
		tracks.push({
			id: formatMockId("trace", i + 1),
			netId: formatMockId("net", (i % 20) + 1),
			layer: "F.Cu",
			start: [x, y],
			end: [x + len, y],
			widthMm: 0.2,
		});
	}
	return tracks;
}

function createBenchmarkBoard(count, seed, area) {
	const rng = makeSeededRandom(seed);
	return { tracks: generateRandomTracks(count, rng, area) };
}

function extractDrcClearancePairs(res) {
	return res.issues
		.filter((i) => i.metric === "clearance")
		.map((i) => i.itemIds.slice().sort().join(":"))
		.sort();
}

function getErcIssues(ir) {
	const res = runLiveChecks({ ir });
	return { res, ercIssues: res.issues.filter((i) => i.source === "erc") };
}

describe("DRC Lite - ERC Integration", () => {
	test("reports ERC issues for invalid IR (positive)", () => {
		const ir = createIr({
			name: "BadIR",
			parts: [createPart("R1")],
			nets: [{ id: newId("net"), name: "N1", pins: [] }],
		});
		const { res, ercIssues } = getErcIssues(ir);
		assertValidIssues(res.issues);
		assert.ok(ercIssues.length > 0);
	});

	test("reports no ERC issues for clean IR (negative)", () => {
		const { ir } = createTwoPartIr({
			name: "CleanIR",
			p1Placement: { x: 10, y: 10, rot: 0, side: "F" },
			p2Placement: { x: 20, y: 20, rot: 0, side: "F" },
			netName: "SIG1",
		});
		const { ercIssues } = getErcIssues(ir);
		assert.equal(ercIssues.length, 0);
	});
});

describe("DRC Lite - Track Clearance", () => {
	test("detects clearance violation between different nets on same layer", () => {
		const board = {
			tracks: [
				createHorizTrack(newId("net"), 10),
				createHorizTrack(newId("net"), 10.3),
			],
		};
		const res = runLiveChecks({ board, rules: { clearanceMm: 0.2 } });
		assertSingleViolation(res, "clearance", "too close");
	});

	test("ignores tracks on same net or different layers", () => {
		const net1 = newId("net");
		const net2 = newId("net");
		const board = {
			tracks: [
				createHorizTrack(net1, 10),
				createHorizTrack(net1, 10.1),
				createHorizTrack(net2, 10.1, "B.Cu"),
			],
		};
		const res = runLiveChecks({ board, rules: { clearanceMm: 0.2 } });
		assertMetricCount(res, "clearance", 0);
	});
});

describe("DRC Lite - Track Width", () => {
	test("detects track narrower than minTrackWidthMm", () => {
		const res = checkTrackWidth(0.1);
		assertSingleViolation(res, "minTrackWidth", "too thin");
	});

	test("accepts track with sufficient width", () => {
		const res = checkTrackWidth(0.25);
		assertMetricCount(res, "minTrackWidth", 0);
	});
});

describe("DRC Lite - Outline and Edge Clearance", () => {
	const outline = createRectOutline(0, 0, 100, 100);

	test("detects track and part outside board outline", () => {
		const res = runOutlineCheck(
			outline,
			[120, 50],
			[
				[-5, 50],
				[-1, 50],
			],
		);
		assertMetricViolation(res, "boardOutline", 2);
	});

	test("detects track and part closer than edgeClearanceMm", () => {
		const res = runOutlineCheck(
			outline,
			[0.1, 50],
			[
				[50, 0.1],
				[60, 0.1],
			],
			{ edgeClearanceMm: 0.3 },
		);
		assertMetricViolation(res, "edgeClearance", 2);
	});

	test("accepts elements safely inside outline", () => {
		const res = runOutlineCheck(
			outline,
			[50, 50],
			[
				[40, 40],
				[60, 40],
			],
			{ edgeClearanceMm: 0.3 },
		);
		const issues = res.issues.filter(
			(i) => i.metric === "boardOutline" || i.metric === "edgeClearance",
		);
		assert.equal(issues.length, 0);
	});
});

describe("DRC Lite - Unrouted Connections", () => {
	test("detects unrouted connections when pins lack continuous tracks", () => {
		const res = checkTwoPinRouting(() => []);
		assertMetricViolation(res, "unrouted", 1);
	});

	test("accepts connected pins snapping within 0.05 mm", () => {
		const res = checkTwoPinRouting((netId) => [
			createTrack({ netId, start: [10.02, 10], end: [39.98, 10] }),
		]);
		assertMetricCount(res, "unrouted", 0);
	});

	test("skips unrouted check when board is missing", () => {
		const { ir } = createTwoPartIr({ netName: "N" });
		const res = runLiveChecks({ ir });
		assertMetricCount(res, "unrouted", 0);
	});
});

describe("DRC Lite - Overlapping Parts", () => {
	test("detects overlapping parts on same side", () => {
		const res = checkOverlappingParts("F");
		assertSingleViolation(res, "overlap", "physically collide");
	});

	test("allows overlapping parts on opposite sides (F vs B)", () => {
		const res = checkOverlappingParts("B");
		assertMetricCount(res, "overlap", 0);
	});
});

describe("DRC Lite - Robustness and Determinism", () => {
	test("never throws on empty or malformed inputs", () => {
		const cases = [
			undefined,
			null,
			{},
			{ ir: null },
			{ board: null },
			{ rules: "bad" },
		];
		for (const c of cases) {
			const res = runLiveChecks(c);
			assert.ok(Array.isArray(res.issues));
			assert.ok(Array.isArray(res.markers));
		}
	});

	test("deterministic idFn gives repeatable IDs", () => {
		const { ir } = createTwoPartIr({
			p1Placement: { x: 20, y: 20, side: "F" },
			p2Placement: { x: 20.2, y: 20, side: "F" },
		});
		const runWithCounter = () =>
			runLiveChecks({ ir, idFn: makeIdCounter() }).issues.map((i) => i.id);
		assert.deepEqual(runWithCounter(), runWithCounter());
	});
});

describe("DRC Lite - Spatial Index and Performance", () => {
	test("spatial index finds same clearance violations as brute force", () => {
		const rng = makeSeededRandom(12345);
		const tracks = generateRandomTracks(300, rng, 50);
		const res = runLiveChecks({
			board: { tracks },
			rules: { clearanceMm: 0.25 },
		});
		const drcPairs = extractDrcClearancePairs(res);
		const expectedPairs = bruteForceClearancePairs(tracks, 0.25);
		assert.equal(drcPairs.length, expectedPairs.length);
		assert.deepEqual(drcPairs, expectedPairs);
	});

	test("performance: 2,000 segments under 500 ms", () => {
		const board = createBenchmarkBoard(2000, 999, 150);
		const start = performance.now();
		const res = runLiveChecks({ board, rules: { clearanceMm: 0.2 } });
		const elapsedMs = performance.now() - start;
		assert.ok(
			elapsedMs < 500,
			`Took ${elapsedMs.toFixed(2)} ms, expected < 500 ms`,
		);
		assert.ok(Array.isArray(res.issues));
	});
});
