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

const GRAPHIC_HEADS = new Set([
	"fp_line",
	"fp_arc",
	"fp_circle",
	"fp_rect",
	"fp_poly",
]);

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

const INTERLEAVED = `(kicad_pcb (version 20241229) (generator test)
  (net 0 "") (net 1 "SIG")
  (segment (start 1 1) (end 2 1) (width 0.2) (layer "F.Cu") (net 1) (uuid "s1"))
  (via (at 2 1) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))
  (arc (start 2 1) (mid 3 0.5) (end 4 1) (width 0.2) (layer "B.Cu") (net 1) (uuid "a1"))
  (via (at 4 1) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "v2"))
  (segment (start 4 1) (end 5 1) (width 0.2) (layer "F.Cu") (net 1) (uuid "s2")))`;

const ROUTING_HEADS = new Set(["segment", "arc", "via"]);
const routingUuids = (text) =>
	parse(text)
		.filter((n) => Array.isArray(n) && ROUTING_HEADS.has(nodeSym(n[0])))
		.map((n) => childOf(n, "uuid")[1]);

describe("tracks, arcs and vias keep their file order", () => {
	const { ir, board } = importBoard(INTERLEAVED);

	test("a round trip writes them in the original interleaved order", () => {
		assert.deepEqual(routingUuids(roundTrip(INTERLEAVED)), [
			"s1",
			"v1",
			"a1",
			"v2",
			"s2",
		]);
	});

	test("items added in the editor go after the imported ones", () => {
		const track = { ...board.tracks[0], uuid: "s9" };
		delete track.order;
		const via = { ...board.vias[0], uuid: "v9" };
		delete via.order;
		const edited = {
			...board,
			tracks: [track, ...board.tracks],
			vias: [via, ...board.vias],
		};
		assert.deepEqual(routingUuids(irToKicadPcb(ir, edited).text), [
			"s1",
			"v1",
			"a1",
			"v2",
			"s2",
			"s9",
			"v9",
		]);
	});
});

const EDGE = `(stroke (width 0.1) (type solid)) (layer "Edge.Cuts")`;
const DRAWN = `(kicad_pcb (version 20241229) (generator test)
  (layers (0 "F.Cu" signal "Top") (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen") (19 "Cmts.User" user "Notes") (25 "Edge.Cuts" user)
    (33 "B.Fab" user) (35 "F.Fab" user))
  (net 0 "") (net 1 "GND")
  (footprint "Lib:U" (layer "B.Cu") (at 10 20 30)
    (property "Reference" "U1" (at 0 -2 30) (unlocked yes) (layer "B.SilkS")
      (effects (font (size 1 1) (thickness 0.15)) (justify right mirror)))
    (property "Value" "LM" (at 1 3 120) (layer "B.SilkS")
      (effects (font (size 0.8 0.7) (thickness 0.1)) (justify left mirror)))
    (solder_mask_margin 0.05)
    (fp_text user "\${REFERENCE}" (at 0 0.5 30) (layer "B.Fab")
      (effects (font (size 0.5 0.5) (thickness 0.08)) (justify mirror)))
    (fp_line (start 0 0) (end 1 0.5) (stroke (width 0.1) (type solid)) (layer "Cmts.User"))
    (fp_line (start 0 0) (end 2 2) (stroke (width 0.1) (type solid)) (layer "User.9"))
    (fp_poly (pts (xy 0 0) (xy 1 0) (xy 1 1)) (stroke (width 0) (type solid)) (fill yes) (layer "B.SilkS"))
    (pad "1" smd roundrect (at 1 -0.5 30) (size 1 0.6) (layers "B.Cu" "B.Mask" "B.Paste")
      (roundrect_rratio 0.25) (net 1 "GND") (pinfunction "GND") (pintype "power_in")))
  (gr_line (start 0 0) (end 40 0) ${EDGE})
  (gr_arc (start 40 0) (mid 45 15) (end 40 30) ${EDGE})
  (gr_line (start 40 30) (end 0 30) ${EDGE})
  (gr_line (start 0 30) (end 0 0) ${EDGE})
  (gr_text "Hi" (at 5 5 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (arc (start 5 5) (mid 7 4) (end 9 5) (width 0.25) (layer "F.Cu") (net 1) (uuid "a1"))
  (zone (net 1) (net_name "GND") (layers "F.Cu" "B.Cu") (uuid "z1") (hatch edge 0.5)
    (connect_pads (clearance 0.3)) (min_thickness 0.25) (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 1 1) (xy 39 1) (xy 39 29) (xy 1 29)))
    (filled_polygon (layer "F.Cu") (pts (xy 2 2) (xy 38 2) (xy 38 28)))
    (filled_polygon (layer "B.Cu") (pts (xy 2 2) (xy 38 2) (xy 38 28)))))`;

const topNodes = (text, head) => parse(text).filter((n) => isHead(n, head));

describe("board drawings, arc tracks, zones and footprint texts round trip", () => {
	const { ir, board, warnings } = importBoard(DRAWN);
	const written = roundTrip(DRAWN);
	const original = footprintNode(DRAWN);
	const fp = footprintNode(written);
	const fpChild = (node, head, key) =>
		node.find((n) => isHead(n, head) && (key === undefined || n[1] === key));

	test("arc tracks are imported with their mid point and written as arcs", () => {
		assert.deepEqual(board.tracks[0].mid, [7, 4]);
		assert.deepEqual(topNodes(written, "arc"), topNodes(DRAWN, "arc"));
	});

	test("board drawings (Edge.Cuts arc, text) are written back unchanged", () => {
		for (const head of ["gr_line", "gr_arc", "gr_text"]) {
			assert.deepEqual(topNodes(written, head), topNodes(DRAWN, head), head);
		}
	});

	test("an edited outline replaces the imported Edge.Cuts drawings", () => {
		const outline = [
			[0, 0],
			[50, 0],
			[50, 40],
		];
		const text = irToKicadPcb(ir, { ...board, outline }).text;
		assert.equal(topNodes(text, "gr_arc").length, 0);
		assert.equal(topNodes(text, "gr_line").length, 3);
		assert.deepEqual(topNodes(text, "gr_text"), topNodes(DRAWN, "gr_text"));
	});

	test("zones keep both layers, their settings and outline; KiCad refills them", () => {
		const [zone] = topNodes(written, "zone");
		const [before] = topNodes(DRAWN, "zone");
		for (const head of ["layers", "uuid", "connect_pads", "fill", "polygon"]) {
			assert.deepEqual(childOf(zone, head), childOf(before, head), head);
		}
		assert.equal(childOf(zone, "filled_polygon"), undefined);
		assert.deepEqual(board.zones[0].polygon, [
			[1, 1],
			[39, 1],
			[39, 29],
			[1, 29],
		]);
	});

	test("reference and value texts keep place, layer, font and justification", () => {
		for (const key of ["Reference", "Value"]) {
			assert.deepEqual(
				fpChild(fp, "property", key),
				fpChild(original, "property", key),
				key,
			);
		}
	});

	test("user texts, other-layer shapes, settings and pad pin functions are kept", () => {
		for (const head of ["fp_text", "solder_mask_margin"]) {
			assert.deepEqual(fpChild(fp, head), fpChild(original, head), head);
		}
		const cmts = (n) =>
			n.filter(
				(c) => isHead(c, "fp_line") && childOf(c, "layer")[1] === "Cmts.User",
			);
		assert.deepEqual(cmts(fp), cmts(original));
		// KiCad reads pad settings in any order.
		const padItems = (n) => fpChild(n, "pad").map((c) => JSON.stringify(c));
		assert.deepEqual(padItems(fp).sort(), padItems(original).sort());
	});

	// Numbered user layers can hold huge overlays (287k strokes on the jetson
	// demo's User.9): they would blow the board JSON past the request limit.
	test("footprint shapes on numbered User layers are left out, with a warning", () => {
		const onUser9 = (n) => childOf(n, "layer")?.[1] === "User.9";
		assert.equal(fp.filter((c) => Array.isArray(c) && onUser9(c)).length, 0);
		assert.ok(
			warnings.some((w) => /1 footprint shape.*User/.test(w)),
			warnings,
		);
	});

	test("filled footprint polygons stay filled", () => {
		assert.deepEqual(childOf(fpChild(fp, "fp_poly"), "fill"), [
			{ sym: "fill" },
			{ sym: "yes" },
		]);
	});

	test("layer user names are written back", () => {
		const layers = childOf(parse(written), "layers");
		const named = layers.filter((l) => Array.isArray(l) && l.length > 3);
		assert.deepEqual(
			named.map((l) => [l[1], l[3]]),
			[
				["F.Cu", "Top"],
				["F.SilkS", "F.Silkscreen"],
				["B.SilkS", "B.Silkscreen"],
				["Cmts.User", "Notes"],
			],
		);
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
	cli(["pcb", "drc", "--refill-zones", "--format", "json", "-o", out, pcb]);
	const drc = JSON.parse(fs.readFileSync(out, "utf8"));
	const counts = { unconnected_items: drc.unconnected_items.length };
	for (const v of drc.violations) counts[v.type] = (counts[v.type] ?? 0) + 1;
	return counts;
}

// The project file (when the demo has one) sits next to the board so both
// use its design rules. Imported zones keep no fill (KiCad computes it), so
// both boards are refilled before DRC and plotting.
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
	cli(["pcb", "export", "gerbers", "--check-zones", "-o", `${out}/`, pcb]);
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

		test("DRC violation counts by type match", () => {
			assert.deepEqual(after.drc, before.drc);
		});

		test("gerber layer files and pad/via flashes match", () => {
			assert.deepEqual(
				gerberField(after, "flashes"),
				gerberField(before, "flashes"),
			);
		});

		// Tracks and vias are written in their file order: KiCad's zone refill
		// depends on it (vias after all tracks add a collinear B.Cu fill point
		// on multichannel_mixer).
		test("gerber draws match and sizes are within 1%", () => {
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
