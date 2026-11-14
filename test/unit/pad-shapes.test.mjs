import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import {
	footprintToPrimitives,
	padCornerRadius,
	padHitTest,
	padLocalPoint,
	padOutline,
	transformPrimitives,
} from "../../frontend/src/editor/footprintRender.js";
import {
	boardCopperPads,
	padSegmentDistance,
} from "../../frontend/src/editor/routingModel.js";

const KICAD = "C:/Program Files/KiCad/10.0";
const KIPYTHON = `${KICAD}/bin/python.exe`;
const DEMOS = `${KICAD}/share/kicad/demos`;
const skipKicad = fs.existsSync(KIPYTHON) ? false : `missing ${KIPYTHON}`;

const s = (name) => ({ sym: name });
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// One imported pad as the IR carries it: KiCad settings kept in pad.extra.
function irPad(shape, size, extra) {
	return {
		number: "1",
		type: "smd",
		shape,
		at: [0, 0, 0],
		size,
		layers: ["F.Cu"],
		extra,
	};
}

function worldPad(pad, placement = {}) {
	const prims = footprintToPrimitives({ pads: [pad] });
	return transformPrimitives(prims, placement).pads[0];
}

describe("roundrect corner radius from roundrect_rratio", () => {
	test("rratio sets the radius; 0.25 when absent", () => {
		const pad = (rr) =>
			worldPad(
				irPad(
					"roundrect",
					[2, 1],
					rr === undefined ? [] : [[s("roundrect_rratio"), rr]],
				),
			);
		assert.equal(padCornerRadius(pad(0.1)), 0.1);
		assert.equal(padCornerRadius(pad(0.5)), 0.5);
		assert.equal(padCornerRadius(pad(undefined)), 0.25);
		assert.equal(padCornerRadius(worldPad(irPad("rect", [2, 1], []))), 0);
	});

	test("hit test and clearance use the pad's own radius", () => {
		// 2 x 2 pad: rratio 0.5 is a circle of radius 1; 0.1 leaves (0.9, 0.9) copper.
		const round = worldPad(
			irPad("roundrect", [2, 2], [[s("roundrect_rratio"), 0.5]]),
		);
		const sharp = worldPad(
			irPad("roundrect", [2, 2], [[s("roundrect_rratio"), 0.1]]),
		);
		assert.equal(padHitTest([round], [0.9, 0.9]), null);
		assert.equal(padHitTest([sharp], [0.9, 0.9]), "1");
		const corner = [2, 2];
		assert.ok(
			near(padSegmentDistance(round, corner, corner), Math.hypot(2, 2) - 1),
		);
		const d = Math.hypot(1.2, 1.2) - 0.2;
		assert.ok(near(padSegmentDistance(sharp, corner, corner), d));
	});

	test("default ratio: the hit test matches clearance (r = 0.25 * min side)", () => {
		const pad = worldPad(irPad("roundrect", [2, 2], []));
		// Corner centre (0.5, 0.5), radius 0.5: (0.85, 0.85) is inside.
		assert.equal(padHitTest([pad], [0.85, 0.85]), "1");
		assert.equal(padHitTest([pad], [0.9, 0.9]), null);
	});
});

describe("chamfered, trapezoid and custom pad outlines", () => {
	const CHAMFER = [
		[s("roundrect_rratio"), 0],
		[s("chamfer_ratio"), 0.25],
		[s("chamfer"), s("top_left")],
	];

	test("chamfer cuts only the named corner", () => {
		const pad = worldPad(irPad("roundrect", [2, 2], CHAMFER));
		assert.equal(padOutline(pad).pts.length, 5);
		// Cut 0.5 at top-left: (-0.9, -0.9) is off the copper, (0.9, -0.9) is on it.
		assert.equal(padHitTest([pad], [-0.9, -0.9]), null);
		assert.equal(padHitTest([pad], [0.9, -0.9]), "1");
		const p = [-1, -1];
		assert.ok(near(padSegmentDistance(pad, p, p), Math.SQRT2 * 0.25));
	});

	test("a library pad on B mirrors the chamfer to top-right", () => {
		const pad = worldPad(irPad("roundrect", [2, 2], CHAMFER), { side: "B" });
		assert.equal(pad.mirror, "x");
		assert.equal(padHitTest([pad], [0.9, -0.9]), null);
		assert.equal(padHitTest([pad], [-0.9, -0.9]), "1");
	});

	// The importer keeps an embedded B pad's chamfer as the board file has it
	// but turns its primitives to the front; both must land where KiCad draws.
	test("an embedded pad on B: chamfer as in the file, primitives flipped back", () => {
		const tri = [
			s("gr_poly"),
			[s("pts"), [s("xy"), 0, 1], [s("xy"), 0, 2], [s("xy"), 0.2, 2]],
		];
		const extra = [...CHAMFER, [s("primitives"), tri]];
		const fp = { embedded: true, pads: [irPad("roundrect", [2, 2], extra)] };
		const pl = { x: 0, y: 0, rot: 0, side: "F", flipPads: true };
		const pad = transformPrimitives(footprintToPrimitives(fp), pl).pads[0];
		assert.equal(pad.mirror, "y");
		assert.deepEqual(padLocalPoint([-0.9, 0.9], pad), [-0.9, -0.9]);
		assert.equal(padHitTest([pad], [-0.9, -0.9]), null);
		assert.equal(padHitTest([pad], [-0.9, 0.9]), "1");
	});

	test("rect_delta narrows one side of a trapezoid", () => {
		const pad = worldPad(irPad("trapezoid", [2, 2], [[s("rect_delta"), 0, 1]]));
		const ys = padOutline(pad).pts.map((p) => p[1]);
		assert.deepEqual([Math.min(...ys), Math.max(...ys)], [-1, 1]);
		// Top side (y = -1) is 1 wide, bottom (y = 1) is 3 wide.
		assert.equal(padHitTest([pad], [0.9, -0.9]), null);
		assert.equal(padHitTest([pad], [1.4, 0.95]), "1");
	});

	test("custom pad clearance is the box of its anchor and primitives", () => {
		const poly = [
			s("gr_poly"),
			[s("pts"), [s("xy"), 0, 0], [s("xy"), 3, 0], [s("xy"), 3, 0.5]],
			[s("width"), 0.2],
			[s("fill"), s("yes")],
		];
		const extra = [
			[s("options"), [s("anchor"), s("rect")]],
			[s("primitives"), poly],
		];
		const pad = worldPad(irPad("custom", [1, 1], extra));
		assert.equal(pad.primitives.length, 1);
		assert.equal(pad.primitives[0].fill, true);
		const xs = padOutline(pad).pts.map((p) => p[0]);
		assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-0.5, 3.1]);
		const p = [4.1, 0];
		assert.ok(near(padSegmentDistance(pad, p, p), 1));
	});
});

// pcbnew's own numbers for every copper pad: corner radius, polygon area, box.
const PCBNEW = [
	"import sys, json, pcbnew",
	"b = pcbnew.LoadBoard(sys.argv[1])",
	"out = []",
	"for f in b.GetFootprints():",
	"    for p in f.Pads():",
	"        lay = p.GetPrincipalLayer()",
	"        bb = p.GetBoundingBox()",
	"        area = p.GetEffectivePolygon(lay, pcbnew.ERROR_INSIDE).Area() / 1e12",
	"        box = [bb.GetLeft() / 1e6, bb.GetTop() / 1e6, bb.GetRight() / 1e6, bb.GetBottom() / 1e6]",
	"        out.append([f.GetReference(), p.GetPosition().x / 1e6, p.GetPosition().y / 1e6,",
	"            p.GetShape(lay), p.GetRoundRectCornerRadius(lay) / 1e6, area, box, p.GetOrientationDegrees(),",
	"            p.GetSize(lay).x / 1e6, p.GetSize(lay).y / 1e6])",
	"print(json.dumps(out))",
].join("\n");

function kicadPads(board) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "padshape-"));
	const script = path.join(dir, "pads.py");
	fs.writeFileSync(script, PCBNEW);
	const out = execFileSync(KIPYTHON, ["-I", script, board], {
		maxBuffer: 64 * 1024 * 1024,
	});
	return JSON.parse(out.toString());
}

// Stacked pads share a position, so the size is part of the key.
const key = (ref, [x, y], [w, h]) =>
	`${ref}@${x.toFixed(3)},${y.toFixed(3)}#${w.toFixed(3)},${h.toFixed(3)}`;

function ourPads(board) {
	const { ir, board: b } = kicadPcbToIr(fs.readFileSync(board, "utf8"));
	const lookup = (part) => b.footprints?.[part.id] ?? null;
	const refOf = new Map(ir.parts.map((p) => [p.id, p.ref]));
	const map = new Map();
	for (const pad of boardCopperPads(ir.parts, lookup, ir.nets)) {
		map.set(key(refOf.get(pad.partId), pad.center, pad.size), pad);
	}
	return map;
}

// Copper area of a convex polygon grown by r.
function outlineArea({ pts, r }) {
	const edges = pts.map((a, i) => [a, pts[(i + 1) % pts.length]]);
	const shoelace = edges.reduce(
		(sum, [a, b]) => sum + a[0] * b[1] - b[0] * a[1],
		0,
	);
	const perimeter = edges.reduce(
		(sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]),
		0,
	);
	return Math.abs(shoelace) / 2 + perimeter * r + Math.PI * r * r;
}

function worldBox(pad) {
	const { pts } = padOutline(pad);
	const rad = (pad.rot * Math.PI) / 180;
	const world = pts.map(([x, y]) => {
		const [lx, ly] = [pad.mirror === "x" ? -x : x, pad.mirror === "y" ? -y : y];
		return [
			pad.center[0] + lx * Math.cos(rad) - ly * Math.sin(rad),
			pad.center[1] + lx * Math.sin(rad) + ly * Math.cos(rad),
		];
	});
	const xs = world.map((p) => p[0]);
	const ys = world.map((p) => p[1]);
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// PAD_SHAPE values in pcbnew: 4 roundrect, 5 chamfered rect, 6 custom.
function checkPad(pad, [, , , shape, radius, area, box, angle]) {
	const r = padCornerRadius(pad);
	const where = `${pad.partId} ${pad.number} ${pad.size}`;
	if (shape === 4)
		return assert.ok(near(r, radius, 1e-3), `${where}: ${r} vs ${radius}`);
	if (shape === 3 || shape === 5) {
		const ours = outlineArea(padOutline(pad));
		assert.ok(near(ours, area, 1e-3), `${where}: area ${ours} vs ${area}`);
	}
	// A sharp polygon's world box shows which corner or side it is cut on.
	const sharp = (shape === 3 || shape === 5) && r === 0;
	if (!sharp && (shape !== 6 || angle % 90 !== 0)) return;
	worldBox(pad).forEach((v, i) => {
		assert.ok(near(v, box[i], 1e-3), `${where} box[${i}]: ${v} vs ${box[i]}`);
	});
}

// Each board with the pcbnew pad shapes it must compare. RoyalBlue54L-Feather
// itself does not load in pcbnew within minutes; its NFC antenna board does.
const ORACLE_BOARDS = [
	[`${DEMOS}/stickhub/StickHub.kicad_pcb`, [4, 6]],
	[`${DEMOS}/multichannel/multichannel_mixer.kicad_pcb`, [4]],
	[
		`${DEMOS}/royalblue54L_feather/nfc_antenna/RoyalBlue54L-NFC-Antenna/RoyalBlue54L-NFC-Antenna.kicad_pcb`,
		[4],
	],
];

// Shapes compared on one board (pads matched by reference, position and size).
function compareBoard(board) {
	const ours = ourPads(board);
	const shapes = new Set();
	for (const kp of kicadPads(board)) {
		const pad = ours.get(key(kp[0], kp.slice(1, 3), kp.slice(8, 10)));
		if (!pad || ![3, 4, 5, 6].includes(kp[3])) continue;
		checkPad(pad, kp);
		shapes.add(kp[3]);
	}
	return shapes;
}

// Shapes the demos pcbnew can load lack: trapezoids, chamfers with and
// without rounding; on a front and a back footprint.
const SYNTH_PADS = [
	'(pad "1" smd trapezoid (at 0 0 30) (size 2 1.5) (rect_delta 0 0.6) (layers "F.Cu"))',
	'(pad "2" smd trapezoid (at 4 0 0) (size 1.5 2) (rect_delta 0.5 0) (layers "F.Cu"))',
	'(pad "3" smd roundrect (at 0 4 0) (size 2 1.2) (roundrect_rratio 0) (chamfer_ratio 0.3) (chamfer top_left bottom_right) (layers "F.Cu"))',
	'(pad "4" smd roundrect (at 4 4 90) (size 2 1.2) (roundrect_rratio 0.2) (chamfer_ratio 0.25) (chamfer top_right) (layers "F.Cu"))',
].join("\n");

function synthFootprint(ref, layer, at) {
	const pads =
		layer === "B.Cu" ? SYNTH_PADS.replaceAll('"F.Cu"', '"B.Cu"') : SYNTH_PADS;
	const prop = `(property "Reference" "${ref}" (at 0 0 0) (layer "F.SilkS"))`;
	return `(footprint "T" (layer "${layer}") (at ${at}) ${prop} ${pads})`;
}

function synthBoard() {
	const text = [
		'(kicad_pcb (version 20241229) (generator "pcbnew") (general (thickness 1.6))',
		'(layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (7 "B.SilkS" user))',
		synthFootprint("U1", "F.Cu", "20 20 0"),
		synthFootprint("U2", "B.Cu", "40 20 15"),
		")",
	].join("\n");
	const file = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "padsynth-")),
		"in.kicad_pcb",
	);
	fs.writeFileSync(file, text);
	return file;
}

describe("pcbnew oracle: pad radius, chamfer and trapezoid area, custom box", {
	skip: skipKicad,
}, () => {
	for (const [board, shapes] of ORACLE_BOARDS) {
		test(path.basename(board), () => {
			assert.deepEqual([...compareBoard(board)].sort(), shapes);
		});
	}

	test("trapezoids and chamfers, with and without rounding", () => {
		assert.deepEqual([...compareBoard(synthBoard())].sort(), [3, 5]);
	});
});
