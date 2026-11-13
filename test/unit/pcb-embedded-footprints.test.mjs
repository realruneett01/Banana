import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import {
	arcToSvgPath,
	boardPadPositions,
	boardPadRadii,
	footprintIdsToFetch,
	footprintToPrimitives,
	padWorldPositions,
	placementFor,
	refLabelPlacement,
	transformPrimitives,
} from "../../frontend/src/editor/footprintRender.js";
import { ratsnest as boardRatsnest } from "../../frontend/src/editor/pcbGeometry.js";
import { ratsnest } from "../../frontend/src/editor/ratsnest.js";

const KICAD = "C:/Program Files/KiCad/10.0";
const ECC83 = `${KICAD}/share/kicad/demos/ecc83/ecc83-pp.kicad_pcb`;
const KICAD_CLI = `${KICAD}/bin/kicad-cli.exe`;
const skipEcc83 = fs.existsSync(ECC83) ? false : `missing ${ECC83}`;

// kicad-cli DRC is the oracle for "fully routed"; 0 when the CLI is absent.
function kicadUnconnectedCount(pcbPath) {
	if (!fs.existsSync(KICAD_CLI)) return 0;
	const out = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "drc-")),
		"drc.json",
	);
	execFileSync(KICAD_CLI, [
		"pcb",
		"drc",
		"--format",
		"json",
		"-o",
		out,
		pcbPath,
	]);
	return JSON.parse(fs.readFileSync(out, "utf8")).unconnected_items.length;
}

function importEcc83() {
	const res = kicadPcbToIr(fs.readFileSync(ECC83, "utf8"));
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return res;
}

// Same lookup PcbCanvas uses: embedded board footprint first.
function embeddedLookup(board) {
	return (part) => board.footprints?.[part.id] ?? null;
}

describe("embedded board footprints (ecc83-pp)", { skip: skipEcc83 }, () => {
	test("every placed footprint carries its pads", () => {
		const { ir, board } = importEcc83();
		assert.equal(ir.parts.length, 15);
		for (const part of ir.parts) {
			const fp = board.footprints[part.id];
			assert.ok(fp?.pads?.length > 0, `no pads for ${part.ref}`);
			assert.equal(fp.embedded, true);
		}
	});

	test("ratsnest of the routed board matches kicad-cli unconnected count", () => {
		const { ir, board } = importEcc83();
		const lookup = embeddedLookup(board);
		const padPos = boardPadPositions(ir.parts, lookup);
		const padRadius = boardPadRadii(ir.parts, lookup);
		const airlines = boardRatsnest(ir, padPos, board.tracks, {
			zones: board.zones,
			padRadius,
		});
		assert.equal(airlines.length, kicadUnconnectedCount(ECC83));
	});
});

describe("embedded footprint placement", () => {
	test("pad offsets rotate counter-clockwise like KiCad (board Y down)", () => {
		const fp = { embedded: true, pads: [{ number: "2", at: [5, 0, 0] }] };
		const pos = padWorldPositions(fp, { x: 10, y: 20, rot: 90, side: "F" });
		assert.deepEqual(pos["2"], [10, 15]);
	});

	test("back-side embedded pads are not mirrored a second time", () => {
		const fp = { embedded: true, pads: [{ number: "1", at: [2, 1, 0] }] };
		const pos = padWorldPositions(fp, { x: 0, y: 0, rot: 0, side: "B" });
		assert.deepEqual(pos["1"], [2, 1]);
	});

	test("embedded pad angle is stored relative to the footprint", () => {
		const text = `(kicad_pcb (version 20240108) (generator test)
  (footprint "Lib:R" (layer "F.Cu") (at 10 20 -90)
    (property "Reference" "R1")
    (pad "1" thru_hole oval (at 5 0 270) (size 1.6 2.4) (layers "*.Cu"))))`;
		const res = kicadPcbToIr(text);
		assert.equal(res.ok, true, JSON.stringify(res.errors));
		const fp = res.board.footprints[res.ir.parts[0].id];
		assert.deepEqual(fp.pads[0].at, [5, 0, 0]);
	});
});

describe("ratsnest connectivity", () => {
	const net = "N";
	const seg = (start, end, width = 0) => ({ net, start, end, width });

	test("track ending inside a pad (not at its centre) connects it", () => {
		const pads = [
			{ id: 0, net, x: 0, y: 0, r: 1.5 },
			{ id: 1, net, x: 10, y: 0, r: 1.5 },
		];
		const tracks = [seg({ x: 1.2, y: 0 }, { x: 10, y: 0 }, 0.8)];
		assert.equal(ratsnest(pads, tracks).length, 0);
	});

	test("T-junction: endpoint on another track's middle connects", () => {
		const pads = [
			{ id: 0, net, x: 0, y: 0 },
			{ id: 1, net, x: 10, y: 0 },
			{ id: 2, net, x: 5, y: 5 },
		];
		const tracks = [
			seg({ x: 0, y: 0 }, { x: 10, y: 0 }),
			seg({ x: 5, y: 5 }, { x: 5, y: 0 }),
		];
		assert.equal(ratsnest(pads, tracks).length, 0);
	});

	test("pads touching the same zone fill are connected", () => {
		const pads = [
			{ id: 0, net, x: 1, y: 1, r: 0.5 },
			{ id: 1, net, x: 9, y: 9, r: 0.5 },
		];
		const square = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		];
		assert.equal(ratsnest(pads, [], [{ net, polygon: square }]).length, 0);
	});

	test("pads with no copper between them still get an airline", () => {
		const pads = [
			{ id: 0, net, x: 0, y: 0, r: 0.5 },
			{ id: 1, net, x: 9, y: 9, r: 0.5 },
		];
		assert.equal(ratsnest(pads, []).length, 1);
	});
});

const GRAPHIC_TYPES = new Set(["line", "arc", "circle", "poly"]);
const GRAPHIC_LAYERS = new Set(["F.SilkS", "B.SilkS", "F.Fab", "B.Fab"]);
// express.json() default body limit ("100kb").
const EXPRESS_DEFAULT_LIMIT = 100 * 1024;

function allGraphics(board) {
	return Object.values(board.footprints).flatMap((fp) => fp.graphics);
}

function isMilliRounded(n) {
	return Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
}

function graphicNumbers(g) {
	const pts = [g.start, g.mid, g.end, g.center, ...(g.pts ?? [])];
	return pts
		.filter(Boolean)
		.flat()
		.concat(g.radius ?? [], g.width);
}

describe("compact embedded graphics (ecc83-pp)", { skip: skipEcc83 }, () => {
	test("silkscreen primitives are extracted in compact form", () => {
		const { board } = importEcc83();
		const graphics = allGraphics(board);
		const silk = graphics.filter((g) => g.layer.endsWith(".SilkS"));
		assert.ok(silk.length > 0, "no silkscreen primitives");
		for (const g of graphics) {
			assert.ok(GRAPHIC_TYPES.has(g.type), `type ${g.type}`);
			assert.ok(GRAPHIC_LAYERS.has(g.layer), `layer ${g.layer}`);
			assert.ok(graphicNumbers(g).every(isMilliRounded), JSON.stringify(g));
		}
	});

	test("ir + board request body stays under the default JSON limit", () => {
		const { ir, board } = importEcc83();
		const size = JSON.stringify({ ir, board }).length;
		assert.ok(size < EXPRESS_DEFAULT_LIMIT, `body is ${size} bytes`);
	});

	test("compact graphics render through footprintToPrimitives", () => {
		const { ir, board } = importEcc83();
		const part = ir.parts.find((p) => p.ref === "R1");
		const fp = board.footprints[part.id];
		const prims = transformPrimitives(
			footprintToPrimitives(fp),
			placementFor(fp, part.placement),
		);
		assert.equal(prims.graphics.length, fp.graphics.length);
		for (const g of prims.graphics.filter((x) => x.type === "arc")) {
			assert.match(arcToSvgPath(g), /^M [-\d.]+ [-\d.]+ A /);
		}
	});

	test("reference label position comes from the board file", () => {
		const { ir, board } = importEcc83();
		const p5 = ir.parts.find((p) => p.ref === "P5");
		assert.deepEqual(board.footprints[p5.id].refLabel, {
			at: [4.505, -1.28],
			rot: 0,
			size: 1,
		});
		const r1 = ir.parts.find((p) => p.ref === "R1");
		// Board text angle 90 is absolute; the footprint sits at -90.
		assert.equal(board.footprints[r1.id].refLabel.rot, 180);
	});
});

describe("compact embedded graphics (synthetic)", () => {
	const text = `(kicad_pcb (version 20240108) (generator test)
  (footprint "Lib:X" (layer "F.Cu") (at 10 20 90)
    (property "Reference" "U1" (at 1.23456 -2 90) (layer "F.SilkS")
      (effects (font (size 1.5 1.5))))
    (fp_line (start 0 0) (end 1.00049 0) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
    (fp_rect (start -1 -1) (end 1 1) (stroke (width 0.1) (type solid)) (layer "F.Fab"))
    (fp_circle (center 0 0) (end 3 4) (stroke (width 0.1) (type solid)) (layer "B.SilkS"))
    (fp_arc (start 1 0) (mid 0 1) (end -1 0) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
    (fp_poly (pts (xy 0 0) (xy 1 0) (xy 1 1)) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
    (fp_line (start 0 0) (end 5 5) (stroke (width 0.05) (type solid)) (layer "F.CrtYd"))
    (fp_text user "x" (at 0 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0 90) (size 1 1) (layers "F.Cu"))))`;

	function importSynthetic() {
		const res = kicadPcbToIr(text);
		assert.equal(res.ok, true, JSON.stringify(res.errors));
		return res.board.footprints[res.ir.parts[0].id];
	}

	test("keeps silk and fab shapes only, rounded to 0.001 mm", () => {
		const fp = importSynthetic();
		const style = (layer, width) => ({ layer, width });
		assert.deepEqual(fp.graphics, [
			{ type: "line", start: [0, 0], end: [1, 0], ...style("F.SilkS", 0.12) },
			{
				type: "poly",
				pts: [
					[-1, -1],
					[1, -1],
					[1, 1],
					[-1, 1],
				],
				...style("F.Fab", 0.1),
			},
			{ type: "circle", center: [0, 0], radius: 5, ...style("B.SilkS", 0.1) },
			{
				type: "arc",
				start: [1, 0],
				mid: [0, 1],
				end: [-1, 0],
				...style("F.SilkS", 0.1),
			},
			{
				type: "poly",
				pts: [
					[0, 0],
					[1, 0],
					[1, 1],
				],
				...style("F.SilkS", 0.1),
			},
		]);
	});

	test("compact arcs get centre and radius for drawing", () => {
		const fp = importSynthetic();
		const placed = transformPrimitives(
			footprintToPrimitives(fp),
			placementFor(fp, { x: 10, y: 20, rot: 90, side: "F" }),
		);
		const arc = placed.graphics.find((g) => g.type === "arc");
		assert.deepEqual(
			arc.center.map((n) => Math.round(n * 1000) / 1000),
			[10, 20],
		);
		assert.equal(arc.radius, 1);
		assert.match(arcToSvgPath(arc), /^M [-\d.]+ [-\d.]+ A 1 1 /);
	});

	test("reference label is footprint-local with a relative angle", () => {
		const fp = importSynthetic();
		assert.deepEqual(fp.refLabel, { at: [1.235, -2], rot: 0, size: 1.5 });
	});

	test("label placement rotates with the footprint and stays readable", () => {
		const fp = { embedded: true, refLabel: { at: [2, 0], rot: 0, size: 1 } };
		const pl = refLabelPlacement(fp, { x: 10, y: 20, rot: 90, side: "F" });
		assert.deepEqual(pl, { x: 10, y: 18, angle: -90, size: 1 });
		const flipped = refLabelPlacement(
			{ ...fp, refLabel: { at: [0, 0], rot: 180, size: 1 } },
			{ x: 0, y: 0, rot: 0, side: "F" },
		);
		assert.equal(flipped.angle, 0);
	});

	test("no reference label without a board-file position", () => {
		assert.equal(refLabelPlacement({ embedded: true, pads: [] }, {}), null);
		assert.equal(refLabelPlacement(null, {}), null);
	});
});

describe("library footprint fetch decision", () => {
	const part = (id, footprint, placement = { x: 0, y: 0 }) => ({
		id,
		footprint,
		placement,
	});
	const parts = [
		part("a", "Lib:A"),
		part("b", "Lib:B"),
		part("c", "Lib:A"),
		{ id: "d", footprint: "Lib:D" },
	];

	test("nothing is fetched while the PCB view is hidden", () => {
		assert.deepEqual(footprintIdsToFetch(parts, { visible: false }), []);
	});

	test("visible view fetches each unknown placed footprint once", () => {
		const ids = footprintIdsToFetch(parts, { visible: true });
		assert.deepEqual(ids, ["Lib:A", "Lib:B"]);
	});

	test("known misses, cached, pending and embedded parts are skipped", () => {
		const ids = footprintIdsToFetch(parts, {
			visible: true,
			cache: { "Lib:A": null },
			pending: new Set(["Lib:B"]),
		});
		assert.deepEqual(ids, []);
		const embedded = footprintIdsToFetch(parts, {
			visible: true,
			embedded: { a: {}, c: {} },
		});
		assert.deepEqual(embedded, ["Lib:B"]);
	});
});
