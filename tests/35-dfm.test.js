// Manufacturability checks against typical fab limits.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { randomCircuit } from "./design-helpers.js";
import { tmpDir } from "./helpers.js";

const projects = tmpDir("banana-dfm-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const { Design, emptyDesign } = await import("../backend/src/design/model.js");
const { DFM_PROFILES, dfmReport } = await import(
	"../backend/src/design/dfm.js"
);
const P = await import("../backend/src/design/project.js");
const { callTool } = await import("../backend/src/mcp/tools.js");

const skip =
	findLibraryRoot("symbols") && findLibraryRoot("footprints")
		? false
		: "KiCad libraries not installed";
const R = "Resistor_SMD:R_0805_2012Metric";
const HDR = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical";
after(() => fs.rmSync(projects, { recursive: true, force: true }));

const two = () => {
	const d = new Design(emptyDesign("t"));
	d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	d.connect("A", ["R1.1", "R2.1"]);
	d.connect("B", ["R1.2", "R2.2"]);
	return d;
};
const POS = { R1: { x: 30, y: 30, rot: 0 }, R2: { x: 40, y: 30, rot: 0 } };
const BOARD = { width: 30, height: 20 };
const codes = (r) => r.issues.map((i) => i.code);

test("profiles are ordered from coarse to fine", () => {
	const { standard, budget, fine } = DFM_PROFILES;
	assert.ok(
		fine.minTrack < budget.minTrack && budget.minTrack < standard.minTrack,
	);
	assert.ok(
		fine.minClearance < budget.minClearance &&
			budget.minClearance < standard.minClearance,
	);
	assert.ok(fine.minDrill < standard.minDrill);
	assert.throws(
		() => dfmReport(two(), POS, BOARD, "nonsense"),
		/Unknown DFM profile/,
	);
});

test("a clean board passes every profile", { skip }, () => {
	for (const name of Object.keys(DFM_PROFILES)) {
		const r = dfmReport(two(), POS, BOARD, name);
		assert.equal(r.ok, true, `${name}: ${JSON.stringify(r.issues)}`);
	}
});

test("tracks that are too narrow are caught per profile", { skip }, () => {
	const d = two();
	d.data.tracks = [
		{
			net: "A",
			layer: "F.Cu",
			width: 0.12,
			points: [
				[10, 10],
				[20, 10],
			],
		},
	];
	assert.ok(
		codes(dfmReport(d, POS, BOARD, "standard")).includes("track_width"),
	);
	assert.ok(codes(dfmReport(d, POS, BOARD, "budget")).includes("track_width"));
	assert.ok(
		!codes(dfmReport(d, POS, BOARD, "fine")).includes("track_width"),
		"0.12 mm is fine for the fine profile",
	);
});

test("small vias and thin annular rings", { skip }, () => {
	const d = two();
	d.data.vias = [
		{ net: "A", x: 5, y: 5, size: 0.8, drill: 0.2 },
		{ net: "A", x: 8, y: 5, size: 0.5, drill: 0.3 },
		{ net: "A", x: 11, y: 5, size: 0.8, drill: 0.4 },
	];
	const r = dfmReport(d, POS, BOARD, "standard");
	assert.deepEqual(
		codes(r)
			.filter((c) => c.startsWith("via"))
			.sort(),
		["via_annular", "via_drill"],
	);
	assert.ok(
		r.issues.some((i) => /Via 0/.test(i.message) && i.code === "via_drill"),
	);
	assert.ok(
		r.issues.some((i) => /Via 1/.test(i.message) && i.code === "via_annular"),
	);
	assert.ok(
		!r.issues.some((i) => /Via 2/.test(i.message)),
		"0.8/0.4 is accepted",
	);
});

test("pads of different nets that touch or crowd are errors; the same net is allowed", {
	skip,
}, () => {
	const d = two();
	const crowded = {
		R1: { x: 30, y: 30, rot: 0 },
		R2: { x: 31.9, y: 30, rot: 0 },
	};
	const r = dfmReport(d, crowded, BOARD, "standard");
	assert.ok(
		r.issues.some(
			(i) => i.code === "pad_spacing" && /overlap|apart/.test(i.message),
		),
		JSON.stringify(r.issues),
	);
	// R1.2 (right pad of R1) and R2.1 (left pad of R2) are different nets here; make them the same net and the pair is fine
	const same = two();
	same.disconnect(["R2.1", "R1.1"]);
	same.connect("B", ["R1.2", "R2.1"], { move: true });
	const r2 = dfmReport(same, crowded, BOARD, "standard");
	assert.ok(!r2.issues.some((i) => /R1\.2 and R2\.1/.test(i.message)));
});

test("through-hole drills and rings", { skip }, () => {
	const d = new Design(emptyDesign("t"));
	d.addPart({
		symbol: "Connector_Generic:Conn_01x02",
		value: "J",
		footprint: HDR,
	});
	d.connect("A", ["J1.1"]);
	const r = dfmReport(d, { J1: { x: 30, y: 30, rot: 0 } }, BOARD, "standard");
	assert.equal(r.ok, true, "1.0 mm holes in 1.7 mm pads are fine");
});

test("an oversized board is a warning, not an error", { skip }, () => {
	const r = dfmReport(two(), POS, { width: 150, height: 90 }, "standard");
	assert.ok(codes(r).includes("board_size"));
	assert.equal(r.ok, true);
	assert.equal(r.warnings, 1);
});

test("every autorouted random board meets the standard profile", {
	skip,
	timeout: 600000,
}, async (t) => {
	for (let seed = 1; seed <= 25; seed++)
		await t.test(`seed ${seed}`, async () => {
			const name = `d${seed}`;
			await P.createProject(name);
			const d = P.loadDesign(name);
			randomCircuit(d, seed, { minParts: 4, maxParts: 10 });
			P.saveDesign(name, d);
			await P.autoRoute(name);
			const r = await callTool("dfm_check", { project: name });
			assert.equal(r.ok, true, JSON.stringify(r));
			assert.equal(r.result.ok, true, JSON.stringify(r.result.issues));
		});
});

test("the MCP tool validates its input", { skip }, async () => {
	await P.createProject("dfmtool");
	assert.equal(
		(await callTool("dfm_check", { project: "dfmtool", profile: "nonsense" }))
			.ok,
		false,
	);
	const ok = await callTool("dfm_check", {
		project: "dfmtool",
		profile: "fine",
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.result.profile, "fine");
});
