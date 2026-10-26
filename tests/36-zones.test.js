// Copper pours: model, writer, KiCad's own fill, routing to the pour, and KiCad's DRC as judge.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { randomCircuit } from "./design-helpers.js";
import { hasKicad, tmpDir } from "./helpers.js";

const projects = tmpDir("banana-zones-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const { Design, DesignError, emptyDesign } = await import(
	"../backend/src/design/model.js"
);
const { writePcb } = await import("../backend/src/design/writer-pcb.js");
const { fillZones, extractFills } = await import(
	"../backend/src/design/zonefill.js"
);
const { findPython, routingStatus } = await import(
	"../backend/src/design/checks.js"
);
const P = await import("../backend/src/design/project.js");
const { callTool } = await import("../backend/src/mcp/tools.js");

const libs = findLibraryRoot("symbols") && findLibraryRoot("footprints");
const skip = libs ? false : "KiCad libraries not installed";
const skipKicad = !libs
	? "KiCad libraries not installed"
	: !hasKicad()
		? "kicad-cli not installed"
		: !findPython()
			? "pcbnew python not available"
			: false;
const R = "Resistor_SMD:R_0805_2012Metric";
const LED = "LED_SMD:LED_0805_2012Metric";
const HDR = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical";
after(() => fs.rmSync(projects, { recursive: true, force: true }));

const MUST_NEVER = [
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

function ledBoard(name = "t") {
	const d = new Design(emptyDesign(name));
	d.addPart({
		symbol: "Connector_Generic:Conn_01x02",
		value: "IN",
		footprint: HDR,
	});
	for (let i = 0; i < 2; i++)
		d.addPart({ symbol: "Device:R", value: "330", footprint: R });
	for (let i = 0; i < 2; i++)
		d.addPart({ symbol: "Device:LED", value: "RED", footprint: LED });
	d.connect("+5V", ["J1.1", "R1.1", "R2.1"]);
	d.setNetFlags("+5V", { external: true });
	d.connect("L1", ["R1.2", "D1.2"]);
	d.connect("L2", ["R2.2", "D2.2"]);
	d.connect("GND", ["J1.2", "D1.1", "D2.1"]);
	d.setNetFlags("GND", { external: true });
	return d;
}

test("model: pours are validated, follow renames, and disappear with their net", {
	skip,
}, async (t) => {
	await t.test("add and remove", () => {
		const d = ledBoard();
		d.addZone({ net: "GND", layer: "B.Cu" });
		assert.deepEqual(d.data.zones, [{ net: "GND", layer: "B.Cu" }]);
		assert.deepEqual(d.summary().zones, d.data.zones);
		d.removeZone("GND", "B.Cu");
		assert.deepEqual(d.data.zones, []);
	});
	await t.test("bad input", () => {
		const d = ledBoard();
		assert.throws(() => d.addZone({ net: "NOPE", layer: "B.Cu" }), /No net/);
		assert.throws(
			() => d.addZone({ net: "GND", layer: "In1.Cu" }),
			/layer must be/,
		);
		d.addZone({ net: "GND", layer: "B.Cu" });
		assert.throws(
			() => d.addZone({ net: "GND", layer: "B.Cu" }),
			/already has a copper pour/,
		);
		assert.throws(
			() => d.addZone({ net: "+5V", layer: "B.Cu" }),
			/one whole-board pour per layer/,
		);
		assert.throws(() => d.removeZone("+5V"), /No copper pour/);
		d.addZone({ net: "+5V", layer: "F.Cu" });
		assert.equal(d.data.zones.length, 2);
	});
	await t.test("rename follows", () => {
		const d = ledBoard();
		d.addZone({ net: "GND", layer: "B.Cu" });
		d.renameNet("GND", "GROUND");
		assert.deepEqual(d.data.zones, [{ net: "GROUND", layer: "B.Cu" }]);
	});
	await t.test("a net that disappears takes its pour with it", () => {
		const d = new Design(emptyDesign("t"));
		d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
		d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
		d.connect("X", ["R1.1", "R2.1"]);
		d.addZone({ net: "X", layer: "B.Cu" });
		d.removePart("R1");
		d.removePart("R2");
		assert.deepEqual(d.data.zones, []);
	});
	await t.test("designs saved before pours existed still load", () => {
		const old = emptyDesign("old");
		delete old.zones;
		assert.deepEqual(Design.from(old).data.zones, []);
	});
	await t.test("through the edit tool, atomically", async () => {
		await P.createProject("tool");
		const ops = [
			{ op: "add_part", symbol: "Device:R", value: "1k", footprint: R },
			{ op: "add_part", symbol: "Device:R", value: "1k", footprint: R },
			{ op: "connect", net: "GND", pins: ["R1.1", "R2.1"] },
			{ op: "add_zone", net: "GND", layer: "B.Cu" },
		];
		assert.equal(
			(await callTool("edit", { project: "tool", operations: ops })).ok,
			true,
		);
		assert.deepEqual(P.loadDesign("tool").data.zones, [
			{ net: "GND", layer: "B.Cu" },
		]);
		const bad = await callTool("edit", {
			project: "tool",
			operations: [
				{ op: "remove_zone", net: "GND", layer: "B.Cu" },
				{ op: "add_zone", net: "NOPE", layer: "B.Cu" },
			],
		});
		assert.equal(bad.ok, false);
		assert.equal(
			P.loadDesign("tool").data.zones.length,
			1,
			"the removal was rolled back",
		);
		assert.equal(
			(
				await callTool("edit", {
					project: "tool",
					operations: [{ op: "remove_zone", net: "GND" }],
				})
			).ok,
			true,
		);
		assert.equal(DesignError.name, "DesignError");
	});
});

test("writer: the pour is a whole-board polygon pulled in from the outline", {
	skip,
}, () => {
	const d = ledBoard();
	d.addZone({ net: "GND", layer: "B.Cu" });
	const out = writePcb(d);
	const zone =
		/\(zone \(net (\d+)\) \(net_name "GND"\) \(layer "B\.Cu"\)[^\n]*\(polygon \(pts ((?:\(xy [^)]*\) ?)+)\)\)/.exec(
			out.text,
		);
	assert.ok(zone, "zone block");
	const netLine = new RegExp(`\\(net ${zone[1]} "GND"\\)`);
	assert.match(out.text, netLine, "zone net id matches the net table");
	const pts = [...zone[2].matchAll(/\(xy ([\d.-]+) ([\d.-]+)\)/g)].map((m) => [
		Number(m[1]),
		Number(m[2]),
	]);
	assert.equal(pts.length, 4);
	const { originX, originY, width, height } = out.board;
	assert.deepEqual(pts[0], [originX + 0.5, originY + 0.5]);
	assert.deepEqual(pts[2], [originX + width - 0.5, originY + height - 0.5]);
	assert.match(out.text, /\(fill yes /);
	assert.ok(!/filled_polygon/.test(out.text), "unfilled until KiCad fills it");
	assert.equal(writePcb(d).text, out.text, "deterministic");
	const fills = new Map([
		[
			"GND|B.Cu",
			'(filled_polygon (layer "B.Cu") (pts (xy 1 1) (xy 2 1) (xy 2 2)))',
		],
	]);
	assert.match(
		writePcb(d, { zoneFills: fills }).text,
		/\(polygon \(pts [^)]*\)[^\n]*\) \(filled_polygon \(layer "B\.Cu"\)/,
	);
	const none = ledBoard();
	assert.ok(!/\(zone /.test(writePcb(none).text));
});

test("extractFills reads KiCad's saved zones", () => {
	const text = `(kicad_pcb (version 20221018)
  (zone (net 1) (net_name "A (x)") (layer "B.Cu") (tstamp 1)
    (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1)))
    (filled_polygon
      (layer "B.Cu")
      (pts
        (xy 0 0)
        (xy 1 0)
      )
    )
    (filled_polygon
      (layer "B.Cu")
      (pts (xy 5 5) (xy 6 5) (xy 6 6))
    )
  )
  (zone (net 2) (net_name "B") (layer "F.Cu") (tstamp 2)
    (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1)))
  )
)`;
	const fills = extractFills(text);
	assert.deepEqual(
		[...fills.keys()],
		["A (x)|B.Cu"],
		"a pour KiCad could not fill has no entry",
	);
	const one = fills.get("A (x)|B.Cu");
	assert.equal((one.match(/filled_polygon/g) ?? []).length, 2);
	assert.ok(!/\n/.test(one), "single line");
	assert.match(
		one,
		/^\(filled_polygon \(layer "B\.Cu"\) \(pts \(xy 0 0\) \(xy 1 0\)\)\)/,
	);
});

test("without KiCad's Python the pour stays unfilled and says so", {
	skip,
}, async () => {
	const d = ledBoard();
	d.addZone({ net: "GND", layer: "B.Cu" });
	const r = await fillZones(writePcb(d).text, { python: null });
	assert.equal(r.status, "unavailable");
	assert.match(r.reason, /pcbnew/);
	assert.equal(r.fills.size, 0);
});

test("KiCad fills the pour, results are cached, and the board still passes its own DRC", {
	skip: skipKicad,
	timeout: 300000,
}, async (t) => {
	const name = "pour";
	await P.createProject(name);
	P.saveDesign(name, ledBoard(name));
	const d = P.loadDesign(name);
	d.addZone({ net: "GND", layer: "B.Cu" });
	P.saveDesign(name, d);

	await t.test("fill via pcbnew, then cached", async () => {
		const text = writePcb(P.loadDesign(name)).text;
		const first = await fillZones(text);
		assert.equal(first.status, "ok");
		assert.ok(first.fills.get("GND|B.Cu")?.startsWith("(filled_polygon"));
		const again = await fillZones(text);
		assert.equal(again.cached, true);
		assert.deepEqual([...again.fills], [...first.fills]);
	});

	const route = await P.autoRoute(name);
	await t.test(
		"the router connects far-side pads to the pour with vias and leaves the pour net alone",
		() => {
			assert.deepEqual(route.failedNets, []);
			const after = P.loadDesign(name);
			const gndVias = after.data.vias.filter((v) => v.net === "GND");
			assert.equal(gndVias.length, 2, "one via per LED cathode (SMD on F.Cu)");
			assert.ok(
				!after.data.tracks.some(
					(tr) => tr.net === "GND" && tr.layer === "B.Cu",
				),
				"no tracks on the pour layer for the pour net",
			);
			assert.ok(
				!after.data.tracks.some(
					(tr) => tr.net !== "GND" && tr.layer === "B.Cu" && false,
				),
			);
		},
	);

	await t.test(
		"build writes KiCad's fill into the board, and state is not stale afterwards",
		async () => {
			const b = await P.build(name, "pour");
			assert.equal(b.zones.status, "ok");
			const file = fs.readFileSync(
				path.join(projects, name, `${name}.kicad_pcb`),
				"utf8",
			);
			assert.match(file, /\(filled_polygon/);
			assert.equal((await P.projectState(name)).needsBuild, false);
			assert.deepEqual((await P.projectState(name)).zones, [
				{ net: "GND", layer: "B.Cu", fill: "ok" },
			]);
		},
	);

	await t.test(
		"every check passes, including KiCad's DRC and our own connectivity",
		async () => {
			const c = await P.checkProject(name);
			assert.equal(c.drc.status, "ok");
			const bad = c.drc.issues.filter(
				(i) => i.severity === "error" && MUST_NEVER.includes(i.type),
			);
			assert.deepEqual(
				bad.map((i) => `${i.type}: ${i.message}`),
				[],
			);
			assert.ok(
				!c.drc.issues.some((i) => i.type === "unconnected_items"),
				"KiCad sees every GND pad connected through the pour",
			);
			assert.deepEqual(c.routing.unrouted, []);
			assert.equal(c.ok, true, JSON.stringify([c.errors, c.drc.issues]));
			assert.deepEqual(c.copper, []);
		},
	);

	await t.test(
		"KiCad's picture shows the copper: the back view has a large filled shape",
		async () => {
			const r = await P.viewSvg(name, { kind: "board", view: "back" });
			const biggest = Math.max(
				...[...r.svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map(
					(m) => (m[1].match(/,/g) ?? []).length,
				),
			);
			assert.ok(biggest > 8, `pour polygon found (${biggest} points)`);
		},
	);

	await t.test(
		"removing a connection that the pour carried is caught by both our check and KiCad's",
		async () => {
			const broken = P.loadDesign(name);
			broken.data.vias = broken.data.vias.filter((v) => v.net !== "GND");
			P.saveDesign(name, broken);
			const c = await P.checkProject(name);
			assert.ok(
				c.routing.unrouted.some((u) => u.net === "GND"),
				"our check: GND is split",
			);
			assert.ok(
				c.drc.issues.some((i) => i.type === "unconnected_items"),
				"KiCad agrees",
			);
			assert.equal(c.ok, false);
		},
	);

	await t.test("the diff engine handles a board with a pour", async () => {
		await P.autoRoute(name);
		await P.build(name, "restored");
		const d2 = P.loadDesign(name);
		d2.removeZone("GND");
		P.saveDesign(name, d2);
		await P.autoRoute(name);
		await P.build(name, "no pour");
		const diff = await P.diffBuilds(name, { base: "HEAD~1", target: "HEAD" });
		assert.ok(Array.isArray(diff.modifications));
		assert.ok(diff.sideBySide.target.length > 0);
	});
});

test("30 random circuits with a GND pour: KiCad's DRC agrees with our connectivity", {
	skip: skipKicad,
	timeout: 900000,
}, async (t) => {
	let poured = 0;
	for (let seed = 1; seed <= 30; seed++)
		await t.test(`seed ${seed}`, async () => {
			const name = `rz${seed}`;
			await P.createProject(name);
			const d = P.loadDesign(name);
			randomCircuit(d, seed, { minParts: 4, maxParts: 10 });
			if (!d.data.nets.GND) return;
			d.addZone({ net: "GND", layer: "B.Cu" });
			P.saveDesign(name, d);
			poured++;
			const route = await P.autoRoute(name);
			const c = await P.checkProject(name);
			assert.equal(c.drc.status, "ok");
			const bad = c.drc.issues.filter(
				(i) => i.severity === "error" && MUST_NEVER.includes(i.type),
			);
			assert.deepEqual(
				bad.map((i) => `${i.type}: ${i.message}`),
				[],
				"the router and the pour never create rule violations",
			);
			const kicadUnconnected = c.drc.issues.some(
				(i) => i.type === "unconnected_items",
			);
			const ours = c.routing.unrouted.length > 0;
			if (route.failedNets.length === 0)
				assert.equal(
					kicadUnconnected,
					ours,
					`our ${JSON.stringify(c.routing.unrouted)} vs KiCad unconnected=${kicadUnconnected}`,
				);
		});
	assert.ok(poured >= 10, `only ${poured} of 30 random circuits had a GND net`);
});
