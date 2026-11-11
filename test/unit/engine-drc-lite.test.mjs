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

function assertSingleViolation(res, metric, messageSubstring) {
	assertValidIssues(res.issues);
	const matched = assertMetricCount(res, metric, 1);
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
	const p1 = createPart("R1", { placement: { x: 10, y: 10 } });
	const p2 = createPart("R2", { placement: { x: 40, y: 10 } });
	const netId = newId("net");
	const net = createSimpleNet("NET1", p1, p2, netId);
	const ir = createIr({ parts: [p1, p2], nets: [net] });
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
	const p1 = createPart("R1", {
		footprint: "R_0603_1608Metric",
		placement: { x: 20, y: 20, rot: 0, side: "F" },
	});
	const p2 = createPart("R2", {
		footprint: "R_0603_1608Metric",
		placement: { x: 20.5, y: 20.2, rot: 0, side },
	});
	const ir = createIr({ parts: [p1, p2] });
	return runLiveChecks({ ir });
}

function isClearanceViolation(a, b, clearanceMm) {
	if (a.layer !== b.layer || a.netId === b.netId) return false;
	const res = segmentSegmentDistance(a.start, a.end, b.start, b.end);
	const clearance = res.dist - (a.widthMm + b.widthMm) / 2;
	return clearance < clearanceMm - 1e-9;
}

function collectPairsForTrack(tracks, i, clearanceMm, pairs) {
	for (let j = i + 1; j < tracks.length; j++) {
		if (isClearanceViolation(tracks[i], tracks[j], clearanceMm)) {
			pairs.push(`${i}:${j}`);
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

describe("DRC Lite - ERC Integration", () => {
	test("reports ERC issues for invalid IR (positive)", () => {
		const ir = createIr({
			name: "BadIR",
			parts: [createPart("R1")],
			nets: [{ id: newId("net"), name: "N1", pins: [] }],
		});
		const res = runLiveChecks({ ir });
		assertValidIssues(res.issues);
		const ercIssues = res.issues.filter((i) => i.source === "erc");
		assert.ok(ercIssues.length > 0);
	});

	test("reports no ERC issues for clean IR (negative)", () => {
		const part1 = createPart("R1", { placement: { x: 10, y: 10 } });
		const part2 = createPart("R2", { placement: { x: 20, y: 20 } });
		const ir = createIr({
			name: "CleanIR",
			parts: [part1, part2],
			nets: [createSimpleNet("SIG1", part1, part2)],
		});
		const res = runLiveChecks({ ir });
		const ercIssues = res.issues.filter((i) => i.source === "erc");
		assert.equal(ercIssues.length, 0);
	});
});

describe("DRC Lite - Track Clearance", () => {
	const CASES = [
		{
			name: "detects clearance violation between different nets on same layer",
			buildTracks: (net1, net2) => [
				createTrack({ netId: net1, start: [10, 10], end: [20, 10] }),
				createTrack({ netId: net2, start: [10, 10.3], end: [20, 10.3] }),
			],
			verify: (res) => assertSingleViolation(res, "clearance", "too close"),
		},
		{
			name: "ignores tracks on same net or different layers",
			buildTracks: (net1, net2) => [
				createTrack({
					netId: net1,
					layer: "F.Cu",
					start: [10, 10],
					end: [20, 10],
				}),
				createTrack({
					netId: net1,
					layer: "F.Cu",
					start: [10, 10.1],
					end: [20, 10.1],
				}),
				createTrack({
					netId: net2,
					layer: "B.Cu",
					start: [10, 10.1],
					end: [20, 10.1],
				}),
			],
			verify: (res) => assertMetricCount(res, "clearance", 0),
		},
	];

	for (const { name, buildTracks, verify } of CASES) {
		test(name, () => {
			const board = { tracks: buildTracks(newId("net"), newId("net")) };
			const res = runLiveChecks({ board, rules: { clearanceMm: 0.2 } });
			verify(res);
		});
	}
});

describe("DRC Lite - Track Width", () => {
	const CASES = [
		{
			name: "detects track narrower than minTrackWidthMm",
			widthMm: 0.1,
			verify: (res) => assertSingleViolation(res, "minTrackWidth", "too thin"),
		},
		{
			name: "accepts track with sufficient width",
			widthMm: 0.25,
			verify: (res) => assertMetricCount(res, "minTrackWidth", 0),
		},
	];

	for (const { name, widthMm, verify } of CASES) {
		test(name, () => {
			const res = checkTrackWidth(widthMm);
			verify(res);
		});
	}
});

describe("DRC Lite - Outline and Edge Clearance", () => {
	const outline = createRectOutline(0, 0, 100, 100);
	const CASES = [
		{
			name: "detects track and part outside board outline",
			partPos: [120, 50],
			trackSeg: [
				[-5, 50],
				[-1, 50],
			],
			rules: undefined,
			verify: (res) => {
				assertValidIssues(res.issues);
				assertMetricCount(res, "boardOutline", 2);
			},
		},
		{
			name: "detects track and part closer than edgeClearanceMm",
			partPos: [0.1, 50],
			trackSeg: [
				[50, 0.1],
				[60, 0.1],
			],
			rules: { edgeClearanceMm: 0.3 },
			verify: (res) => {
				assertValidIssues(res.issues);
				assertMetricCount(res, "edgeClearance", 2);
			},
		},
		{
			name: "accepts elements safely inside outline",
			partPos: [50, 50],
			trackSeg: [
				[40, 40],
				[60, 40],
			],
			rules: { edgeClearanceMm: 0.3 },
			verify: (res) => {
				const issues = res.issues.filter(
					(i) => i.metric === "boardOutline" || i.metric === "edgeClearance",
				);
				assert.equal(issues.length, 0);
			},
		},
	];

	for (const { name, partPos, trackSeg, rules, verify } of CASES) {
		test(name, () => {
			const res = runOutlineCheck(outline, partPos, trackSeg, rules);
			verify(res);
		});
	}
});

describe("DRC Lite - Unrouted Connections", () => {
	const CASES = [
		{
			name: "detects unrouted connections when pins lack continuous tracks",
			tracks: () => [],
			verify: (res) => {
				assertValidIssues(res.issues);
				assertMetricCount(res, "unrouted", 1);
			},
		},
		{
			name: "accepts connected pins snapping within 0.05 mm",
			tracks: (netId) => [
				createTrack({ netId, start: [10.02, 10], end: [39.98, 10] }),
			],
			verify: (res) => assertMetricCount(res, "unrouted", 0),
		},
	];

	for (const { name, tracks, verify } of CASES) {
		test(name, () => {
			const res = checkTwoPinRouting(tracks);
			verify(res);
		});
	}

	test("skips unrouted check when board is missing", () => {
		const p1 = createPart("R1");
		const p2 = createPart("R2");
		const net = createSimpleNet("N", p1, p2);
		const ir = createIr({ parts: [p1, p2], nets: [net] });
		const res = runLiveChecks({ ir });
		assertMetricCount(res, "unrouted", 0);
	});
});

describe("DRC Lite - Overlapping Parts", () => {
	const CASES = [
		{
			name: "detects overlapping parts on same side",
			side: "F",
			verify: (res) =>
				assertSingleViolation(res, "overlap", "physically collide"),
		},
		{
			name: "allows overlapping parts on opposite sides (F vs B)",
			side: "B",
			verify: (res) => assertMetricCount(res, "overlap", 0),
		},
	];

	for (const { name, side, verify } of CASES) {
		test(name, () => {
			const res = checkOverlappingParts(side);
			verify(res);
		});
	}
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
		const p1 = createPart("R1", { placement: { x: 20, y: 20, side: "F" } });
		const p2 = createPart("R2", { placement: { x: 20.2, y: 20, side: "F" } });
		const ir = createIr({ parts: [p1, p2] });
		const runWithCounter = () =>
			runLiveChecks({ ir, idFn: makeIdCounter() }).issues.map((i) => i.id);
		assert.deepEqual(runWithCounter(), runWithCounter());
	});
});

describe("DRC Lite - Spatial Index and Performance", () => {
	test("spatial index finds same clearance violations as brute force", () => {
		const rng = makeSeededRandom(12345);
		const tracks = generateRandomTracks(300, rng, 50);
		const board = { tracks };
		const res = runLiveChecks({ board, rules: { clearanceMm: 0.25 } });
		const drcPairs = res.issues
			.filter((i) => i.metric === "clearance")
			.map((i) => i.itemIds.slice().sort().join(":"))
			.sort();
		const expectedPairs = bruteForceClearancePairs(tracks, 0.25)
			.map((p) => {
				const [a, b] = p.split(":").map(Number);
				return [tracks[a].id, tracks[b].id].sort().join(":");
			})
			.sort();
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
