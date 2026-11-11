import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	runLiveChecks,
	segmentSegmentDistance,
} from "../../backend/src/engine/drc-lite.js";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";

function makeIdCounter() {
	let count = 0;
	return (kind) => {
		count++;
		const hex = String(count).padStart(12, "0");
		return `${kind}_00000000-0000-0000-0000-${hex}`;
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

function assertValidIssues(issues) {
	for (const issue of issues) {
		const res = validateIssue(issue);
		assert.ok(res.ok, `Invalid issue: ${res.errors.join(", ")}`);
	}
}

describe("DRC Lite - ERC Integration", () => {
	test("reports ERC issues for invalid IR (positive)", () => {
		const ir = {
			schemaVersion: 1,
			name: "BadIR",
			parts: [createPart("R1")],
			nets: [{ id: newId("net"), name: "N1", pins: [] }],
			constraints: [],
		};
		const res = runLiveChecks({ ir });
		assertValidIssues(res.issues);
		const ercIssues = res.issues.filter((i) => i.source === "erc");
		assert.ok(ercIssues.length > 0);
	});

	test("reports no ERC issues for clean IR (negative)", () => {
		const part1 = createPart("R1", { placement: { x: 10, y: 10 } });
		const part2 = createPart("R2", { placement: { x: 20, y: 20 } });
		const ir = {
			schemaVersion: 1,
			name: "CleanIR",
			parts: [part1, part2],
			nets: [
				createNet("SIG1", [
					{ partId: part1.id, pin: "1" },
					{ partId: part2.id, pin: "1" },
				]),
			],
			constraints: [],
		};
		const res = runLiveChecks({ ir });
		const ercIssues = res.issues.filter((i) => i.source === "erc");
		assert.equal(ercIssues.length, 0);
	});
});

describe("DRC Lite - Track Clearance", () => {
	test("detects clearance violation between different nets on same layer", () => {
		const net1 = newId("net");
		const net2 = newId("net");
		const t1 = createTrack({ netId: net1, start: [10, 10], end: [20, 10] });
		const t2 = createTrack({ netId: net2, start: [10, 10.3], end: [20, 10.3] });
		const board = { tracks: [t1, t2] };
		const res = runLiveChecks({ board, rules: { clearanceMm: 0.2 } });
		assertValidIssues(res.issues);
		const clr = res.issues.filter((i) => i.metric === "clearance");
		assert.equal(clr.length, 1);
		assert.ok(clr[0].message.includes("too close"));
		assert.equal(res.markers.length, 1);
	});

	test("ignores tracks on same net or different layers", () => {
		const net1 = newId("net");
		const net2 = newId("net");
		const t1 = createTrack({
			netId: net1,
			layer: "F.Cu",
			start: [10, 10],
			end: [20, 10],
		});
		const t2 = createTrack({
			netId: net1,
			layer: "F.Cu",
			start: [10, 10.1],
			end: [20, 10.1],
		});
		const t3 = createTrack({
			netId: net2,
			layer: "B.Cu",
			start: [10, 10.1],
			end: [20, 10.1],
		});
		const board = { tracks: [t1, t2, t3] };
		const res = runLiveChecks({ board, rules: { clearanceMm: 0.2 } });
		const clr = res.issues.filter((i) => i.metric === "clearance");
		assert.equal(clr.length, 0);
	});
});

describe("DRC Lite - Track Width", () => {
	test("detects track narrower than minTrackWidthMm", () => {
		const t1 = createTrack({ widthMm: 0.1 });
		const board = { tracks: [t1] };
		const res = runLiveChecks({ board, rules: { minTrackWidthMm: 0.15 } });
		assertValidIssues(res.issues);
		const thin = res.issues.filter((i) => i.metric === "minTrackWidth");
		assert.equal(thin.length, 1);
		assert.ok(thin[0].message.includes("too thin"));
		assert.equal(res.markers.length, 1);
	});

	test("accepts track with sufficient width", () => {
		const t1 = createTrack({ widthMm: 0.25 });
		const board = { tracks: [t1] };
		const res = runLiveChecks({ board, rules: { minTrackWidthMm: 0.15 } });
		const thin = res.issues.filter((i) => i.metric === "minTrackWidth");
		assert.equal(thin.length, 0);
	});
});

describe("DRC Lite - Outline and Edge Clearance", () => {
	const outline = createRectOutline(0, 0, 100, 100);

	test("detects track and part outside board outline", () => {
		const part = createPart("U1", { placement: { x: 120, y: 50, side: "F" } });
		const track = createTrack({ start: [-5, 50], end: [-1, 50] });
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [part],
			nets: [],
			constraints: [],
		};
		const board = { outline, tracks: [track] };
		const res = runLiveChecks({ ir, board });
		assertValidIssues(res.issues);
		const out = res.issues.filter((i) => i.metric === "boardOutline");
		assert.equal(out.length, 2);
	});

	test("detects track and part closer than edgeClearanceMm", () => {
		const part = createPart("U1", { placement: { x: 0.1, y: 50, side: "F" } });
		const track = createTrack({ start: [50, 0.1], end: [60, 0.1] });
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [part],
			nets: [],
			constraints: [],
		};
		const board = { outline, tracks: [track] };
		const res = runLiveChecks({ ir, board, rules: { edgeClearanceMm: 0.3 } });
		assertValidIssues(res.issues);
		const edge = res.issues.filter((i) => i.metric === "edgeClearance");
		assert.equal(edge.length, 2);
	});

	test("accepts elements safely inside outline", () => {
		const part = createPart("U1", { placement: { x: 50, y: 50, side: "F" } });
		const track = createTrack({ start: [40, 40], end: [60, 40] });
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [part],
			nets: [],
			constraints: [],
		};
		const board = { outline, tracks: [track] };
		const res = runLiveChecks({ ir, board, rules: { edgeClearanceMm: 0.3 } });
		const issues = res.issues.filter(
			(i) => i.metric === "boardOutline" || i.metric === "edgeClearance",
		);
		assert.equal(issues.length, 0);
	});
});

describe("DRC Lite - Unrouted Connections", () => {
	test("detects unrouted connections when pins lack continuous tracks", () => {
		const p1 = createPart("R1", { placement: { x: 10, y: 10 } });
		const p2 = createPart("R2", { placement: { x: 40, y: 10 } });
		const netId = newId("net");
		const net = createNet(
			"NET1",
			[
				{ partId: p1.id, pin: "1" },
				{ partId: p2.id, pin: "1" },
			],
			netId,
		);
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [p1, p2],
			nets: [net],
			constraints: [],
		};
		const board = {
			pads: [
				{ partId: p1.id, pin: "1", at: [10, 10] },
				{ partId: p2.id, pin: "1", at: [40, 10] },
			],
			tracks: [],
		};
		const res = runLiveChecks({ ir, board });
		assertValidIssues(res.issues);
		const unrouted = res.issues.filter((i) => i.metric === "unrouted");
		assert.equal(unrouted.length, 1);
	});

	test("accepts connected pins snapping within 0.05 mm", () => {
		const p1 = createPart("R1", { placement: { x: 10, y: 10 } });
		const p2 = createPart("R2", { placement: { x: 40, y: 10 } });
		const netId = newId("net");
		const net = createNet(
			"NET1",
			[
				{ partId: p1.id, pin: "1" },
				{ partId: p2.id, pin: "1" },
			],
			netId,
		);
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [p1, p2],
			nets: [net],
			constraints: [],
		};
		const board = {
			pads: [
				{ partId: p1.id, pin: "1", at: [10, 10] },
				{ partId: p2.id, pin: "1", at: [40, 10] },
			],
			tracks: [createTrack({ netId, start: [10.02, 10], end: [39.98, 10] })],
		};
		const res = runLiveChecks({ ir, board });
		const unrouted = res.issues.filter((i) => i.metric === "unrouted");
		assert.equal(unrouted.length, 0);
	});

	test("skips unrouted check when board is missing", () => {
		const p1 = createPart("R1");
		const p2 = createPart("R2");
		const net = createNet("N", [
			{ partId: p1.id, pin: "1" },
			{ partId: p2.id, pin: "1" },
		]);
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [p1, p2],
			nets: [net],
			constraints: [],
		};
		const res = runLiveChecks({ ir });
		const unrouted = res.issues.filter((i) => i.metric === "unrouted");
		assert.equal(unrouted.length, 0);
	});
});

describe("DRC Lite - Overlapping Parts", () => {
	test("detects overlapping parts on same side", () => {
		const p1 = createPart("R1", {
			footprint: "R_0603_1608Metric",
			placement: { x: 20, y: 20, rot: 0, side: "F" },
		});
		const p2 = createPart("R2", {
			footprint: "R_0603_1608Metric",
			placement: { x: 20.5, y: 20.2, rot: 0, side: "F" },
		});
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [p1, p2],
			nets: [],
			constraints: [],
		};
		const res = runLiveChecks({ ir });
		assertValidIssues(res.issues);
		const overlaps = res.issues.filter((i) => i.metric === "overlap");
		assert.equal(overlaps.length, 1);
		assert.ok(overlaps[0].message.includes("physically collide"));
		assert.equal(res.markers.length, 1);
	});

	test("allows overlapping parts on opposite sides (F vs B)", () => {
		const p1 = createPart("R1", {
			footprint: "R_0603_1608Metric",
			placement: { x: 20, y: 20, rot: 0, side: "F" },
		});
		const p2 = createPart("R2", {
			footprint: "R_0603_1608Metric",
			placement: { x: 20, y: 20, rot: 0, side: "B" },
		});
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [p1, p2],
			nets: [],
			constraints: [],
		};
		const res = runLiveChecks({ ir });
		const overlaps = res.issues.filter((i) => i.metric === "overlap");
		assert.equal(overlaps.length, 0);
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
		const p1 = createPart("R1", { placement: { x: 20, y: 20, side: "F" } });
		const p2 = createPart("R2", { placement: { x: 20.2, y: 20, side: "F" } });
		const ir = {
			schemaVersion: 1,
			name: "B",
			parts: [p1, p2],
			nets: [],
			constraints: [],
		};
		const res1 = runLiveChecks({ ir, idFn: makeIdCounter() });
		const res2 = runLiveChecks({ ir, idFn: makeIdCounter() });
		assert.deepEqual(
			res1.issues.map((i) => i.id),
			res2.issues.map((i) => i.id),
		);
	});
});

function bruteForceClearancePairs(tracks, clearanceMm) {
	const pairs = [];
	for (let i = 0; i < tracks.length; i++) {
		for (let j = i + 1; j < tracks.length; j++) {
			const a = tracks[i];
			const b = tracks[j];
			if (a.layer !== b.layer || a.netId === b.netId) continue;
			const res = segmentSegmentDistance(a.start, a.end, b.start, b.end);
			const clearance = res.dist - (a.widthMm + b.widthMm) / 2;
			if (clearance < clearanceMm - 1e-9) {
				pairs.push(`${i}:${j}`);
			}
		}
	}
	return pairs.sort();
}

function generateRandomTracks(count, rng, area = 100) {
	const tracks = [];
	for (let i = 0; i < count; i++) {
		const x = rng() * area;
		const y = rng() * area;
		const len = 0.5 + rng() * 2.0;
		const netId = `net_00000000-0000-0000-0000-${String((i % 20) + 1).padStart(12, "0")}`;
		tracks.push({
			id: `trace_00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
			netId,
			layer: "F.Cu",
			start: [x, y],
			end: [x + len, y],
			widthMm: 0.2,
		});
	}
	return tracks;
}

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
		const rng = makeSeededRandom(999);
		const tracks = generateRandomTracks(2000, rng, 150);
		const board = { tracks };
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
