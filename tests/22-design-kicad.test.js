// Generated designs are written out and cross-checked against KiCad itself. Skipped without KiCad + libraries.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { tmpDir } from "./helpers.js";

const projectsRoot = tmpDir("banana-proj-");
process.env.BANANA_PROJECTS_DIR = projectsRoot;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const { Design, emptyDesign } = await import("../backend/src/design/model.js");
const P = await import("../backend/src/design/project.js");
const { parseKiCadBoard } = await import("../backend/src/kicad-pcb-parser.js");
const { netlistParity, ercLite, placementLite, routingStatus } = await import(
	"../backend/src/design/checks.js"
);
const { writePcb } = await import("../backend/src/design/writer-pcb.js");
const { writeSchematic } = await import("../backend/src/design/writer-sch.js");
const { randomCircuit } = await import("./design-helpers.js");
const { hasKicad } = await import("./helpers.js");

const skip = !hasKicad()
	? "kicad-cli not installed"
	: findLibraryRoot("symbols") && findLibraryRoot("footprints")
		? false
		: "KiCad libraries not installed";
after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));

test("KiCad's own netlist export agrees with the design for 30 random circuits", {
	skip,
	timeout: 300000,
}, async (t) => {
	for (let seed = 1; seed <= 30; seed++) {
		await t.test(`seed ${seed}`, async () => {
			const d = randomCircuit(Design.from(emptyDesign(`rnd${seed}`)), seed);
			const dir = tmpDir("banana-sch-");
			const file = path.join(dir, `rnd${seed}.kicad_sch`);
			fs.writeFileSync(file, writeSchematic(d));
			const parity = await netlistParity(d, file);
			assert.equal(
				parity.status,
				"ok",
				JSON.stringify(parity.mismatches?.slice(0, 2)),
			);
			fs.rmSync(dir, { recursive: true, force: true });
		});
	}
});

test("the generated board carries the right nets on the right pads (60 random circuits, read back with Banana's parser)", {
	skip,
	timeout: 300000,
}, async (t) => {
	for (let seed = 100; seed < 160; seed++) {
		await t.test(`seed ${seed}`, () => {
			const d = randomCircuit(Design.from(emptyDesign(`rnd${seed}`)), seed);
			const pcb = writePcb(d);
			const dir = tmpDir("banana-pcb-");
			const file = path.join(dir, "b.kicad_pcb");
			fs.writeFileSync(file, pcb.text);
			const board = parseKiCadBoard(file);
			assert.equal(board.footprints.length, d.parts.length);
			const expected = new Map();
			for (const [name, net] of Object.entries(d.data.nets))
				for (const p of net.pins) expected.set(p, name);
			for (const fp of board.footprints) {
				const ref = fp.reference.text;
				const placed = pcb.positions[ref];
				assert.ok(
					Math.abs(fp.at.x - placed.x) < 1e-6 &&
						Math.abs(fp.at.y - placed.y) < 1e-6,
					`${ref} position`,
				);
				for (const pad of fp.pads)
					assert.equal(
						(pad.net ?? "") || undefined,
						expected.get(`${ref}.${pad.number}`),
						`${ref}.${pad.number}`,
					);
			}
			fs.rmSync(dir, { recursive: true, force: true });
		});
	}
});

test("auto-placement never overlaps courtyards or leaves the board (100 random circuits)", {
	skip,
}, async (t) => {
	for (let seed = 200; seed < 300; seed++) {
		await t.test(`seed ${seed}`, () => {
			const d = randomCircuit(Design.from(emptyDesign(`p${seed}`)), seed, {
				minParts: 2,
				maxParts: 14,
			});
			const pcb = writePcb(d);
			const issues = placementLite(d, pcb.positions, pcb.board);
			assert.deepEqual(issues, []);
		});
	}
});

test("KiCad can render a generated board and schematic", {
	skip,
	timeout: 120000,
}, async () => {
	await P.createProject("render-me", "x");
	const d = P.loadDesign("render-me");
	randomCircuit(d, 7);
	P.saveDesign("render-me", d);
	const built = await P.build("render-me", "first");
	assert.match(built.commit, /^[0-9a-f]{40}$/);
	const { renderKicadFile } = await import("../backend/src/kicad-renderer.js");
	const pcb = await renderKicadFile(
		path.join(built.directory, built.files.board),
		true,
	);
	assert.ok(pcb.svgFiles.length >= 7);
	const sch = await renderKicadFile(
		path.join(built.directory, built.files.schematic),
		false,
	);
	assert.ok(
		sch.svgFiles.length >= 1 && fs.statSync(sch.svgFiles[0]).size > 1000,
	);
});

test("builds are deterministic: rebuilding an unchanged design makes no new commit", {
	skip,
	timeout: 120000,
}, async () => {
	await P.createProject("stable", "x");
	const d = P.loadDesign("stable");
	randomCircuit(d, 11);
	P.saveDesign("stable", d);
	const a = await P.build("stable", "one");
	const b = await P.build("stable", "two");
	assert.equal(a.commit, b.commit);
	assert.equal(b.committed, false);
	assert.equal((await P.history("stable")).length, 2, "create + first build");
});

test("ERC-lite catches real mistakes", { skip }, async (t) => {
	const mk = () => {
		const d = Design.from(emptyDesign("e"));
		d.addPart({
			symbol: "Device:R",
			value: "1k",
			footprint: "Resistor_SMD:R_0805_2012Metric",
		});
		d.addPart({
			symbol: "Device:R",
			value: "1k",
			footprint: "Resistor_SMD:R_0805_2012Metric",
		});
		return d;
	};
	const types = (d) => ercLite(d).map((i) => i.type);
	await t.test("unconnected pins", () => {
		const d = mk();
		d.connect("A", ["R1.1", "R2.1"]);
		assert.equal(types(d).filter((x) => x === "pin_not_connected").length, 2);
	});
	await t.test("no-connect silences it", () => {
		const d = mk();
		d.connect("A", ["R1.1", "R2.1"]);
		d.markNoConnect("R1.2");
		d.markNoConnect("R2.2");
		assert.deepEqual(types(d), []);
	});
	await t.test("single-pin net", () => {
		const d = mk();
		d.connect("A", ["R1.1"]);
		d.connect("B", ["R1.2", "R2.1", "R2.2"]);
		assert.ok(types(d).includes("net_single_pin"));
	});
	await t.test("missing footprint", () => {
		const d = Design.from(emptyDesign("e"));
		d.addPart({ symbol: "Device:C", value: "1u" });
		assert.ok(types(d).includes("unassigned_footprint"));
	});
	await t.test(
		"power input without a source, then with an external supply",
		() => {
			const d = Design.from(emptyDesign("e"));
			d.addPart({
				symbol: "Regulator_Linear:AMS1117-3.3",
				footprint: "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
			});
			d.connect("+5V", ["U1.VI"]);
			d.connect("GND", ["U1.GND"]);
			d.connect("+3V3", ["U1.VO"]);
			assert.ok(
				types(d).filter((x) => x === "power_pin_not_driven").length === 2,
				"VI and GND have no source",
			);
			d.setNetFlags("+5V", { external: true });
			d.setNetFlags("GND", { external: true });
			assert.ok(!types(d).includes("power_pin_not_driven"));
		},
	);
	await t.test("two outputs on one net", () => {
		const d = Design.from(emptyDesign("e"));
		d.addPart({
			symbol: "Regulator_Linear:AMS1117-3.3",
			footprint: "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
		});
		d.addPart({
			symbol: "Regulator_Linear:AMS1117-3.3",
			footprint: "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
		});
		d.connect("+3V3", ["U1.VO", "U2.VO"]);
		assert.ok(types(d).includes("output_conflict"));
	});
});

test("routing status reflects real connectivity", { skip }, async (t) => {
	const d = Design.from(emptyDesign("r"));
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
	const pos = writePcb(d).positions;
	await t.test("unrouted", () =>
		assert.equal(routingStatus(d, pos).A.routed, false),
	);
	await t.test("a track that stops short is still unrouted", () => {
		d.addTrack({
			net: "A",
			points: [
				[30.9125, 30],
				[34, 30],
			],
		});
		assert.equal(routingStatus(d, pos).A.routed, false);
	});
	await t.test("a complete track routes it", () => {
		d.clearRouting();
		d.addTrack({
			net: "A",
			points: [
				[30.9125, 30],
				[39.0875, 30],
			],
		});
		assert.equal(routingStatus(d, pos).A.routed, true);
	});
	await t.test("a track on the wrong layer does not connect SMD pads", () => {
		d.clearRouting();
		d.addTrack({
			net: "A",
			layer: "B.Cu",
			points: [
				[30.9125, 30],
				[39.0875, 30],
			],
		});
		assert.equal(routingStatus(d, pos).A.routed, false);
	});
	await t.test("vias join layers", () => {
		d.clearRouting();
		d.addTrack({
			net: "A",
			points: [
				[30.9125, 30],
				[33, 30],
			],
		});
		d.addVia({ net: "A", x: 33, y: 30 });
		d.addTrack({
			net: "A",
			layer: "B.Cu",
			points: [
				[33, 30],
				[37, 30],
			],
		});
		d.addVia({ net: "A", x: 37, y: 30 });
		d.addTrack({
			net: "A",
			points: [
				[37, 30],
				[39.0875, 30],
			],
		});
		assert.equal(routingStatus(d, pos).A.routed, true);
	});
});
