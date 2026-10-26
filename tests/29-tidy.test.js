// 45 degree corner cutting: every accepted cut keeps the board legal, every unsafe cut is reverted.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { randomCircuit } from "./design-helpers.js";
import { hasKicad, tmpDir } from "./helpers.js";

const projects = tmpDir("banana-tidy-");
process.env.BANANA_PROJECTS_DIR = projects;
const { Design, emptyDesign } = await import("../backend/src/design/model.js");
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const { chamferTracks } = await import("../backend/src/design/tidy.js");
const { copperLite, routingStatus } = await import(
	"../backend/src/design/checks.js"
);
const P = await import("../backend/src/design/project.js");

const libs = findLibraryRoot("symbols") && findLibraryRoot("footprints");
const skip = libs ? false : "KiCad libraries not installed";
const skipKicad = !libs
	? "KiCad libraries not installed"
	: !hasKicad()
		? "kicad-cli not installed"
		: false;
after(() => fs.rmSync(projects, { recursive: true, force: true }));

const R = "Resistor_SMD:R_0805_2012Metric";
const POS = { R1: { x: 100, y: 100, rot: 0 }, R2: { x: 110, y: 100, rot: 0 } };
function base() {
	const d = new Design(emptyDesign("t"));
	d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	d.connect("A", ["R1.1", "R2.1"]);
	d.connect("B", ["R1.2", "R2.2"]);
	return d;
}
const angleOk = (a, b) => {
	if (a[0] === b[0] && a[1] === b[1]) return false;
	const m =
		Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 45;
	return m < 1e-6 || 45 - m < 1e-6;
};

test("an L-shaped track gets a 45 degree corner", { skip }, () => {
	const d = base();
	d.data.tracks = [
		{
			net: "A",
			layer: "F.Cu",
			width: 0.25,
			points: [
				[0, 0],
				[5, 0],
				[5, 5],
			],
		},
	];
	const r = chamferTracks(d, POS);
	assert.equal(r.corners, 1);
	assert.deepEqual(r.tracks[0].points, [
		[0, 0],
		[4.5, 0],
		[5, 0.5],
		[5, 5],
	]);
	assert.equal(r.tracks[0].points.length, 4);
});

test("a corner next to a foreign via keeps the router's version (clearance would be lost)", {
	skip,
}, () => {
	const d = base();
	d.data.tracks = [
		{
			net: "A",
			layer: "F.Cu",
			width: 0.25,
			points: [
				[0, 0],
				[5, 0],
				[5, 5],
			],
		},
	];
	// legal beside both legs of the L (0.2 mm gap) but inside the cut-off triangle's reach
	d.data.vias = [{ net: "B", x: 4.275, y: 0.725, size: 0.8, drill: 0.4 }];
	assert.equal(copperLite(d, POS).length, 0, "starting point is legal");
	const r = chamferTracks(d, POS);
	assert.equal(r.reverted, 1);
	assert.deepEqual(r.tracks[0].points, [
		[0, 0],
		[5, 0],
		[5, 5],
	]);
	assert.equal(
		copperLite({ data: { ...d.data, tracks: r.tracks } }, POS).length,
		0,
	);
});

test("only the unsafe track is reverted; the rest are still cut", {
	skip,
}, () => {
	const d = base();
	d.data.tracks = [
		{
			net: "A",
			layer: "F.Cu",
			width: 0.25,
			points: [
				[0, 0],
				[5, 0],
				[5, 5],
			],
		},
		{
			net: "B",
			layer: "F.Cu",
			width: 0.25,
			points: [
				[20, 0],
				[25, 0],
				[25, 5],
			],
		},
	];
	d.data.vias = [{ net: "B", x: 4.275, y: 0.725, size: 0.8, drill: 0.4 }];
	const r = chamferTracks(d, POS);
	assert.equal(r.tracksChanged, 1);
	assert.equal(r.reverted, 1);
	assert.equal(r.tracks[0].points.length, 3);
	assert.equal(r.tracks[1].points.length, 4);
});

test("short legs, straight tracks, existing diagonals and 2-point tracks are left alone", {
	skip,
}, async (t) => {
	const cases = {
		"two points": [
			[0, 0],
			[5, 0],
		],
		straight: [
			[0, 0],
			[2, 0],
			[5, 0],
		],
		"leg too short": [
			[0, 0],
			[0.3, 0],
			[0.3, 5],
		],
		diagonal: [
			[0, 0],
			[3, 3],
			[6, 3],
		],
	};
	for (const [label, points] of Object.entries(cases))
		await t.test(label, () => {
			const d = base();
			d.data.tracks = [{ net: "A", layer: "F.Cu", width: 0.25, points }];
			const r = chamferTracks(d, POS);
			assert.deepEqual(r.tracks[0].points, points);
			assert.equal(r.corners, 0);
		});
});

test("adjacent corners on a staircase share a leg without colliding", {
	skip,
}, () => {
	const d = base();
	d.data.tracks = [
		{
			net: "A",
			layer: "F.Cu",
			width: 0.25,
			points: [
				[0, 0],
				[5, 0],
				[5, 0.6],
				[10, 0.6],
			],
		},
	];
	const r = chamferTracks(d, POS);
	const pts = r.tracks[0].points;
	for (let i = 0; i + 1 < pts.length; i++) {
		assert.ok(
			Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) > 0.1,
			"no zero-length segment",
		);
		assert.ok(angleOk(pts[i], pts[i + 1]), `segment ${i} is 0/45/90 degrees`);
	}
	assert.equal(pts[0].join(), "0,0");
	assert.equal(pts.at(-1).join(), "10,0.6");
});

test("40 autorouted boards: all segments 0/45/90, still legal and fully connected, cuts happen", {
	skip: skipKicad,
	timeout: 900000,
}, async (t) => {
	let corners = 0;
	let boardsWithCuts = 0;
	for (let seed = 1; seed <= 40; seed++)
		await t.test(`seed ${seed}`, async () => {
			const name = `t${seed}`;
			await P.createProject(name);
			const d = P.loadDesign(name);
			randomCircuit(d, seed, { minParts: 4, maxParts: 11 });
			P.saveDesign(name, d);
			const route = await P.autoRoute(name);
			const design = P.loadDesign(name);
			const state = await P.projectState(name);
			const positions = Object.fromEntries(
				state.parts.map((p) => [p.ref, p.at]),
			);
			assert.deepEqual(copperLite(design, positions), []);
			const status = routingStatus(design, positions);
			assert.deepEqual(
				Object.entries(status)
					.filter(([, r]) => !r.routed)
					.map(([n]) => n)
					.sort(),
				[...route.failedNets].sort(),
			);
			for (const tr of design.data.tracks)
				for (let i = 0; i + 1 < tr.points.length; i++)
					assert.ok(
						angleOk(tr.points[i], tr.points[i + 1]),
						`${tr.net}: ${tr.points[i]} -> ${tr.points[i + 1]}`,
					);
			corners += route.chamfered;
			if (route.chamfered) boardsWithCuts++;
		});
	assert.ok(
		corners > 0 && boardsWithCuts >= 10,
		`only ${corners} corners cut on ${boardsWithCuts} boards`,
	);
});
