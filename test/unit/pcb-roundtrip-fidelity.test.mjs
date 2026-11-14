import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const nodeSym = (n) => (typeof n === "object" && n !== null ? n.sym : n);
const isHead = (n, h) => Array.isArray(n) && nodeSym(n[0]) === h;
const childOf = (node, h) => node.find((c) => isHead(c, h));

const BOARD = `(kicad_pcb (version 20241229) (generator test)
  (footprint "Lib:J" (layer "B.Cu") (at 10 20 90)
    (property "Reference" "J1" (at 0 -2 90) (layer "B.SilkS") (hide yes)
      (effects (font (size 0.8 0.8) (thickness 0.12)) (justify mirror)))
    (attr through_hole exclude_from_pos_files exclude_from_bom dnp)
    (fp_line (start 0 1) (end 2 1) (stroke (width 0.12) (type solid)) (layer "B.SilkS"))
    (fp_rect (start -1 -1) (end 1 1) (stroke (width 0.05) (type solid)) (layer "B.CrtYd"))
    (fp_circle (center 0 0) (end 0 -3) (stroke (width 0.1) (type solid)) (layer "B.Fab"))
    (fp_arc (start 1 0) (mid 0 -1) (end -1 0) (stroke (width 0.1) (type solid)) (layer "B.SilkS"))
    (pad "1" thru_hole oval (at 1 -0.5 60) (size 1.6 2.4) (drill oval 0.8 1.2 (offset 0.1 -0.2)) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole circle (at -1 0.5 90) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask"))
    (pad "3" smd rect (at 0 2 90) (size 1 1) (drill (offset 0 0.3)) (layers "B.Cu"))))`;

function importBoard(text) {
	const res = kicadPcbToIr(text);
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return res;
}

function footprintNode(text) {
	return parse(text).find((n) => isHead(n, "footprint"));
}

function roundTrip(text) {
	const { ir, board } = importBoard(text);
	return irToKicadPcb(ir, board).text;
}

const GRAPHIC_HEADS = new Set(["fp_line", "fp_arc", "fp_circle", "fp_poly"]);

describe("embedded footprint import keeps attributes, drills and courtyard", () => {
	const { ir, board } = importBoard(BOARD);
	const fp = board.footprints[ir.parts[0].id];

	test("footprint attributes are kept as written", () => {
		assert.deepEqual(fp.attr, [
			"through_hole",
			"exclude_from_pos_files",
			"exclude_from_bom",
			"dnp",
		]);
	});

	test("pad drills keep size, oval shape and offset", () => {
		const drills = fp.pads.map(({ drill, drillHeight, drillOffset }) => ({
			drill,
			drillHeight,
			drillOffset,
		}));
		assert.deepEqual(drills, [
			{ drill: 0.8, drillHeight: 1.2, drillOffset: [0.1, -0.2] },
			{ drill: 0.8, drillHeight: undefined, drillOffset: undefined },
			{ drill: undefined, drillHeight: undefined, drillOffset: [0, 0.3] },
		]);
		assert.equal("drill" in fp.pads[2], false);
	});

	test("courtyard outlines are kept with silk and fab", () => {
		assert.deepEqual(
			fp.graphics.map((g) => g.layer),
			["B.SilkS", "B.CrtYd", "B.Fab", "B.SilkS"],
		);
	});
});

describe("irToKicadPcb writes embedded attributes, drills and graphics back", () => {
	const original = footprintNode(BOARD);
	const written = footprintNode(roundTrip(BOARD));

	test("attr node is written back unchanged", () => {
		assert.deepEqual(childOf(written, "attr"), childOf(original, "attr"));
	});

	test("back reference text keeps place, layer, hide, font and mirror", () => {
		const reference = (fp) =>
			fp.find((n) => isHead(n, "property") && n[1] === "Reference");
		assert.deepEqual(reference(written), reference(original));
	});

	test("pad drill nodes are written back unchanged", () => {
		const drills = (fp) =>
			fp.filter((n) => isHead(n, "pad")).map((p) => childOf(p, "drill"));
		assert.deepEqual(drills(written), drills(original));
	});

	test("back-side graphics come back on the same layer and coordinates", () => {
		const graphicsOf = (text) => {
			const { ir, board } = importBoard(text);
			return board.footprints[ir.parts[0].id].graphics;
		};
		assert.deepEqual(graphicsOf(roundTrip(BOARD)), graphicsOf(BOARD));
		assert.equal(
			written.filter((n) => GRAPHIC_HEADS.has(nodeSym(n[0]))).length,
			4,
		);
	});

	test("library defs without graphics or attr write neither", () => {
		const fp = footprintNode(writeLibraryPart({ pads: LIB_PADS }, "F"));
		assert.equal(childOf(fp, "attr"), undefined);
		assert.equal(fp.filter((n) => GRAPHIC_HEADS.has(nodeSym(n[0]))).length, 0);
	});

	test("library shapes are copied without uuid and the def is not changed", () => {
		const libText = `(footprint "R"
  (fp_line (start 0 1) (end 2 1) (stroke (width 0.12) (type solid)) (layer "F.SilkS") (uuid "u1"))
  (fp_text user "x" (at 0 0) (layer "F.SilkS")))`;
		const graphics = parse(libText).slice(2);
		const def = { pads: LIB_PADS, graphics };
		const before = structuredClone(def);
		const fp = footprintNode(writeLibraryPart(def, "B"));
		const shapes = fp.filter((n) => GRAPHIC_HEADS.has(nodeSym(n[0])));
		assert.equal(shapes.length, 1);
		assert.equal(childOf(shapes[0], "uuid"), undefined);
		assert.deepEqual(
			childOf(shapes[0], "start"),
			childOf(graphics[0], "start").map((v, i) => (i === 2 ? -v : v)),
		);
		assert.equal(childOf(shapes[0], "layer")[1], "B.SilkS");
		assert.deepEqual(def, before);
	});
});

const LIB_PADS = [
	{
		number: "1",
		type: "smd",
		shape: "rect",
		at: [0, 0],
		size: [1, 1],
		layers: ["F.Cu"],
	},
];

function writeLibraryPart(def, side) {
	const part = {
		id: "part_00000001-0000-0000-0000-000000000000",
		ref: "R1",
		value: "1k",
		symbol: "Device:R",
		footprint: "Lib:R",
		props: {},
		placement: { x: 0, y: 0, rot: 0, side },
	};
	const ir = {
		schemaVersion: 1,
		name: "L",
		parts: [part],
		nets: [],
		constraints: [],
	};
	return irToKicadPcb(ir, { footprints: { "Lib:R": def } }).text;
}

const ROUTED = `(kicad_pcb (version 20241229) (generator test)
  (net 0 "") (net 1 "GND") (net 2 "SIG")
  (footprint "Lib:R" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 2 "SIG")))
  (gr_line (start 0 0) (end 40 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 40 0) (end 40 30) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 40 30) (end 0 30) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_line (start 0 30) (end 0 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (segment (start 10 10) (end 20 10.5) (width 0.25) (layer "F.Cu") (net 2) (uuid "s1"))
  (segment (start 1 1) (end 2 1) (width 0.2) (layer "B.Cu") (net 0) (uuid "s2"))
  (via (at 20 10.5) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 2) (uuid "v1"))
  (zone (net 1) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)
    (polygon (pts (xy 1 1) (xy 39 1) (xy 39 29) (xy 1 29)))))`;

// Net ids are new on every import: compare items by net name instead.
function namedItems(text, key) {
	const { ir, board } = importBoard(text);
	const names = new Map(ir.nets.map((n) => [n.id, n.name]));
	return board[key].map(({ netId, ...rest }) => ({
		net: names.get(netId) ?? "",
		...rest,
	}));
}

describe("irToKicadPcb writes board routing and outline back", () => {
	const { board } = importBoard(ROUTED);
	const written = roundTrip(ROUTED);
	const again = importBoard(written).board;
	for (const [key, count] of [
		["tracks", 2],
		["vias", 1],
		["zones", 1],
	]) {
		test(`${key} come back with their net, geometry and uuid`, () => {
			const before = namedItems(ROUTED, key);
			assert.deepEqual(namedItems(written, key), before);
			assert.equal(before.length, count);
		});
	}

	test("the board outline replaces the default rectangle", () => {
		assert.deepEqual(again.outline, board.outline);
		assert.doesNotMatch(written, /gr_rect/);
	});

	test("arc tracks are written as arcs with their mid point", () => {
		const track = { ...board.tracks[0], mid: [15, 9] };
		const { ir } = importBoard(ROUTED);
		const text = irToKicadPcb(ir, { ...board, tracks: [track] }).text;
		const arc = parse(text).find((n) => isHead(n, "arc"));
		assert.deepEqual(childOf(arc, "mid").slice(1), [15, 9]);
	});
});

// --- kicad-cli oracle -------------------------------------------------------

const KICAD = "C:/Program Files/KiCad/10.0";
const CLI = `${KICAD}/bin/kicad-cli.exe`;
const DEMOS = `${KICAD}/share/kicad/demos`;
const ORACLE_BOARDS = [
	"ecc83/ecc83-pp",
	"stickhub/StickHub",
	"multichannel/multichannel_mixer",
	"multichannel/multichannel_mixer-unrouted",
];

// Known gaps: these need data the importer's board model does not keep, so
// the writer cannot put it back. They run and report, but do not fail.
const ZONE_GAP =
	"a zone on two layers is imported without a layer, and only the first filled polygon of a zone is kept";
const DRC_GAPS = {
	"stickhub/StickHub":
		"arc tracks are not imported, the gr_arc outline is approximated and zone thermal settings are not kept",
	"multichannel/multichannel_mixer": ZONE_GAP,
	"multichannel/multichannel_mixer-unrouted": ZONE_GAP,
};
const DRAW_GAP =
	"footprint text (Value, fp_text, pad pin functions) and board drawings (gr_text, gr_poly, ...) are not in the board model";

function cli(args) {
	try {
		execFileSync(CLI, args, { stdio: "pipe" });
	} catch {
		// kicad-cli drc exits non-zero when it finds violations.
	}
}

function readPos(dir, pcb) {
	const out = path.join(dir, "pos.csv");
	const args = ["--format", "csv", "--units", "mm", "--side", "both"];
	cli(["pcb", "export", "pos", ...args, "-o", out, pcb]);
	return fs.readFileSync(out, "utf8").trim().split(/\r?\n/).slice(1).sort();
}

function readDrillTools(dir, pcb) {
	const report = path.join(dir, "drill.txt");
	const args = ["--generate-report", "--report-path", report];
	cli(["pcb", "export", "drill", ...args, "-o", `${dir}/`, pcb]);
	return fs
		.readFileSync(report, "utf8")
		.split(/\r?\n/)
		.filter((l) => /^\s+T\d+\s|Total/.test(l))
		.map((l) => l.trim());
}

function readDrcCounts(dir, pcb) {
	const out = path.join(dir, "drc.json");
	cli(["pcb", "drc", "--format", "json", "-o", out, pcb]);
	const drc = JSON.parse(fs.readFileSync(out, "utf8"));
	const counts = { unconnected_items: drc.unconnected_items.length };
	for (const v of drc.violations) counts[v.type] = (counts[v.type] ?? 0) + 1;
	return counts;
}

// The project file (when the demo has one) sits next to the board so both
// use its design rules.
function kicadReports(text, project) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtfid-"));
	const pcb = path.join(dir, "board.kicad_pcb");
	fs.writeFileSync(pcb, text);
	if (fs.existsSync(project)) {
		fs.copyFileSync(project, path.join(dir, "board.kicad_pro"));
	}
	return {
		pos: readPos(dir, pcb),
		drill: readDrillTools(dir, pcb),
		drc: readDrcCounts(dir, pcb),
		gerbers: readGerbers(dir, pcb),
	};
}

// Per plotted layer, keyed by its X2 file function (file names follow the
// board's own layer names): draws (D01), flashes (D03) and file size.
function readGerbers(dir, pcb) {
	const out = path.join(dir, "gerbers");
	cli(["pcb", "export", "gerbers", "-o", `${out}/`, pcb]);
	const layers = {};
	for (const file of fs.readdirSync(out).sort()) {
		const body = fs.readFileSync(path.join(out, file), "utf8");
		const fn = /%TF\.FileFunction,([^*]+)\*%/.exec(body)?.[1] ?? file;
		layers[fn] = {
			draws: body.match(/D01\*/g)?.length ?? 0,
			flashes: body.match(/D03\*/g)?.length ?? 0,
			bytes: body.length,
		};
	}
	return layers;
}

for (const name of ORACLE_BOARDS) {
	const file = `${DEMOS}/${name}.kicad_pcb`;
	const skip =
		fs.existsSync(CLI) && fs.existsSync(file) ? false : `missing ${file}`;
	describe(`kicad-cli round trip oracle: ${name}`, { skip }, () => {
		const text = skip ? "" : fs.readFileSync(file, "utf8");
		const project = file.replace(/\.kicad_pcb$/, ".kicad_pro");
		const before = skip ? null : kicadReports(text, project);
		const after = skip ? null : kicadReports(roundTrip(text), project);

		test("position file rows match", () => {
			assert.deepEqual(after.pos, before.pos);
		});

		test("drill tool table (sizes, hits, slots) matches", () => {
			assert.deepEqual(after.drill, before.drill);
		});

		test("DRC violation counts by type match", { todo: DRC_GAPS[name] }, () => {
			assert.deepEqual(after.drc, before.drc);
		});

		test("gerber layer files and pad/via flashes match", () => {
			assert.deepEqual(
				gerberField(after, "flashes"),
				gerberField(before, "flashes"),
			);
		});

		test("gerber draws match and sizes are within 1%", {
			todo: DRAW_GAP,
		}, () => {
			assert.deepEqual(
				gerberField(after, "draws"),
				gerberField(before, "draws"),
			);
			for (const [layer, { bytes }] of Object.entries(before.gerbers)) {
				const ratio = after.gerbers[layer].bytes / bytes;
				assert.ok(Math.abs(ratio - 1) <= 0.01, `${layer}: ${ratio}`);
			}
		});
	});
}

function gerberField(report, field) {
	const entries = Object.entries(report.gerbers);
	return Object.fromEntries(entries.map(([layer, g]) => [layer, g[field]]));
}
