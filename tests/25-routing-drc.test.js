// The autorouter is judged by KiCad's own DRC and connectivity, on many generated boards.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { hasKicad, tmpDir } from "./helpers.js";

const projects = tmpDir("banana-route-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const P = await import("../backend/src/design/project.js");
const { findPython } = await import("../backend/src/design/checks.js");
const { randomCircuit } = await import("./design-helpers.js");

const skip = !hasKicad()
	? "kicad-cli not installed"
	: !(findLibraryRoot("symbols") && findLibraryRoot("footprints"))
		? "KiCad libraries not installed"
		: !findPython()
			? "pcbnew python not available"
			: false;
after(() => fs.rmSync(projects, { recursive: true, force: true }));

const ERROR_TYPES_THAT_MUST_NEVER_HAPPEN = [
	"clearance",
	"hole_clearance",
	"hole_near_hole",
	"shorting_items",
	"copper_edge_clearance",
	"track_width",
	"via_diameter",
	"annular_width",
	"tracks_crossing",
	"courtyards_overlap",
	"items_not_allowed",
];

test("autorouted boards are legal in KiCad's DRC: 40 random circuits, zero rule violations", {
	skip,
	timeout: 900000,
}, async (t) => {
	let fullyRouted = 0;
	const total = 40;
	for (let seed = 1; seed <= total; seed++) {
		await t.test(`seed ${seed}`, async () => {
			const name = `r${seed}`;
			await P.createProject(name);
			const d = P.loadDesign(name);
			randomCircuit(d, seed, { minParts: 4, maxParts: 11 });
			P.saveDesign(name, d);
			const route = await P.autoRoute(name);
			const c = await P.checkProject(name);
			assert.equal(c.drc.status, "ok");
			assert.equal(c.netlistParity.status, "ok");
			assert.deepEqual(
				c.copper,
				[],
				"our own copper-clearance check agrees with KiCad",
			);
			const bad = c.drc.issues.filter(
				(i) =>
					i.severity === "error" &&
					ERROR_TYPES_THAT_MUST_NEVER_HAPPEN.includes(i.type),
			);
			assert.deepEqual(
				bad.map((i) => `${i.type}: ${i.message}`),
				[],
				"router must never create rule violations",
			);
			// Our own connectivity check must agree with KiCad about what is unrouted.
			const kicadUnconnected =
				c.drc.issues.filter((i) => i.type === "unconnected_items").length > 0;
			assert.equal(
				c.routing.unrouted.length > 0,
				kicadUnconnected,
				`routingStatus ${JSON.stringify(c.routing.unrouted)} vs KiCad unconnected=${kicadUnconnected}`,
			);
			// Anything the router could not do is reported, not hidden.
			assert.deepEqual(
				c.routing.unrouted.map((u) => u.net).sort(),
				[...route.failedNets].sort(),
			);
			assert.equal(c.ok, route.failedNets.length === 0 && c.errors === 0);
			if (route.failedNets.length === 0) fullyRouted++;
		});
	}
	assert.ok(
		fullyRouted >= total * 0.8,
		`only ${fullyRouted}/${total} boards fully routed`,
	);
});

test("the checks catch real board faults", {
	skip,
	timeout: 300000,
}, async (t) => {
	const mk = async (name) => {
		await P.createProject(name);
		const d = P.loadDesign(name);
		d.addPart({
			symbol: "Device:R",
			value: "1k",
			footprint: "Resistor_SMD:R_0805_2012Metric",
			at: { x: 30, y: 30 },
		});
		d.addPart({
			symbol: "Device:R",
			value: "1k",
			footprint: "Resistor_SMD:R_0805_2012Metric",
			at: { x: 40, y: 30 },
		});
		d.connect("A", ["R1.2", "R2.1"]);
		d.connect("B", ["R1.1", "R2.2"]);
		d.setBoard(40, 30);
		return d;
	};
	await t.test(
		"unrouted board: not ok, with unconnected items from KiCad",
		async () => {
			const d = await mk("f-unrouted");
			P.saveDesign("f-unrouted", d);
			const c = await P.checkProject("f-unrouted");
			assert.equal(c.ok, false);
			assert.ok(c.drc.issues.some((i) => i.type === "unconnected_items"));
			assert.deepEqual(c.routing.unrouted.map((u) => u.net).sort(), ["A", "B"]);
		},
	);
	await t.test(
		"overlapping parts are flagged by both our check and KiCad",
		async () => {
			const d = await mk("f-overlap");
			d.place("R2", 30.5, 30);
			P.saveDesign("f-overlap", d);
			const c = await P.checkProject("f-overlap");
			assert.ok(c.placement.some((i) => i.type === "courtyard_overlap"));
			assert.ok(
				c.drc.issues.some((i) => i.type === "courtyards_overlap"),
				JSON.stringify(c.drc.issues.map((i) => i.type)),
			);
			assert.equal(c.ok, false);
		},
	);
	await t.test("a part outside the board outline", async () => {
		const d = await mk("f-outside");
		d.place("R2", 200, 30);
		P.saveDesign("f-outside", d);
		const c = await P.checkProject("f-outside");
		assert.ok(c.placement.some((i) => i.type === "outside_board"));
		assert.equal(c.ok, false);
	});
	await t.test("two different nets crossing: reported as a short", async () => {
		const d = await mk("f-short");
		d.addTrack({
			net: "A",
			points: [
				[30.9125, 30],
				[39.0875, 30],
			],
		});
		d.addTrack({
			net: "B",
			points: [
				[35, 28],
				[35, 32],
			],
		});
		P.saveDesign("f-short", d);
		const c = await P.checkProject("f-short");
		assert.ok(
			c.copper.some(
				(i) =>
					i.type === "short" && i.nets.includes("A") && i.nets.includes("B"),
			),
			JSON.stringify(c.copper),
		);
		assert.equal(c.ok, false);
	});
	await t.test(
		"tracks that are too close (but not touching) are flagged as clearance, and the exact gap is correct",
		async () => {
			const d = await mk("f-close");
			d.addTrack({
				net: "A",
				points: [
					[30.9125, 30],
					[39.0875, 30],
				],
			});
			d.addTrack({
				net: "B",
				points: [
					[33, 30.35],
					[37, 30.35],
				],
			}); // 0.35 centre-to-centre: gap 0.10 mm
			P.saveDesign("f-close", d);
			const c = await P.checkProject("f-close");
			const hit = c.copper.find((i) => i.type === "clearance");
			assert.ok(hit, JSON.stringify(c.copper));
			assert.match(hit.message, /0\.100 mm apart/);
			assert.equal(c.ok, false);
		},
	);
	await t.test("a hand-routed legal board passes", async () => {
		const d = await mk("f-good");
		d.addTrack({
			net: "A",
			points: [
				[30.9125, 30],
				[39.0875, 30],
			],
		});
		d.addTrack({
			net: "B",
			points: [
				[29.0875, 30],
				[29.0875, 33],
				[40.9125, 33],
				[40.9125, 30],
			],
		});
		P.saveDesign("f-good", d);
		const c = await P.checkProject("f-good");
		assert.deepEqual(
			c.drc.issues.filter((i) => i.severity === "error"),
			[],
		);
		assert.equal(c.routing.complete, true);
		assert.equal(c.ok, true);
	});
});
