import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { createKicadLibrary } from "../../backend/src/engine/kicad-library.js";
import { applyPcbEdits } from "../../backend/src/engine/kicad-pcb-edit.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { parse } from "../../backend/src/engine/sexpr.js";
import {
	footprintToPrimitives,
	padWorldPositions,
	placementFor,
	transformPrimitives,
} from "../../frontend/src/editor/footprintRender.js";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const KICAD = "C:/Program Files/KiCad/10.0";
const STICKHUB_DIR = `${KICAD}/share/kicad/demos/stickhub`;
const STICKHUB = `${STICKHUB_DIR}/StickHub.kicad_pcb`;
const KIPYTHON = `${KICAD}/bin/python.exe`;
const skipStickhub = fs.existsSync(STICKHUB) ? false : `missing ${STICKHUB}`;
const skipPython =
	skipStickhub || (fs.existsSync(KIPYTHON) ? false : `missing ${KIPYTHON}`);

// StickHub keeps its footprints in a project library, so the same parts can
// be loaded both as the board embeds them and as the library defines them.
const library = createKicadLibrary({ footprintDir: STICKHUB_DIR });

function importBoard(text) {
	const res = kicadPcbToIr(text);
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return res;
}

function maxPadOffset(a, b) {
	let max = 0;
	for (const [num, [x, y]] of Object.entries(a)) {
		assert.ok(b[num], `pad ${num} missing on the library path`);
		max = Math.max(max, Math.hypot(x - b[num][0], y - b[num][1]));
	}
	return max;
}

function padAngles(fp, placement) {
	const { pads } = transformPrimitives(
		footprintToPrimitives(fp),
		placementFor(fp, placement),
	);
	return pads.map((p) => ((p.rot % 180) + 180) % 180);
}

// Library-path pads must land where KiCad put them, i.e. on the pads of the
// footprint the board file embeds for the same part.
async function compareLibraryToEmbedded({ ir, board }, refs) {
	const checked = [];
	for (const part of ir.parts) {
		if (refs && !refs.includes(part.ref)) continue;
		const embedded = board.footprints?.[part.id];
		const lib = await library.getFootprint(part.footprint);
		if (!embedded || !lib?.pads.length) continue;
		const emb = padWorldPositions(embedded, part.placement);
		const off = maxPadOffset(emb, padWorldPositions(lib, part.placement));
		assert.ok(off < 1e-3, `${part.ref} off by ${off} mm`);
		const angles = padAngles(lib, part.placement);
		assert.deepEqual(angles, padAngles(embedded, part.placement), part.ref);
		checked.push(`${part.placement.side}${part.placement.rot}`);
	}
	return new Set(checked);
}

describe("library footprints follow KiCad rotation", {
	skip: skipStickhub,
}, () => {
	test("StickHub: library pads match embedded pads on both sides", async () => {
		const res = importBoard(fs.readFileSync(STICKHUB, "utf8"));
		const seen = await compareLibraryToEmbedded(res);
		for (const k of ["F90", "F-90", "B90", "B45", "B-135", "B180"]) {
			assert.ok(seen.has(k), `no ${k} part was compared`);
		}
	});

	test("30 degrees front and back, rotated by KiCad itself", {
		skip: skipPython,
	}, async () => {
		const out = path.join(
			fs.mkdtempSync(path.join(os.tmpdir(), "rot30-")),
			"b.kicad_pcb",
		);
		const script = [
			"import sys, pcbnew",
			"b = pcbnew.LoadBoard(sys.argv[1])",
			"for ref in ('D4', 'R7'): b.FindFootprintByReference(ref).SetOrientationDegrees(30)",
			"b.Save(sys.argv[2])",
		].join("\n");
		execFileSync(KIPYTHON, ["-I", "-c", script, STICKHUB, out]);
		const res = importBoard(fs.readFileSync(out, "utf8"));
		const seen = await compareLibraryToEmbedded(res, ["D4", "R7"]);
		assert.deepEqual([...seen].sort(), ["B30", "F30"]);
	});
});

const ARC_FP = {
	pads: [],
	graphics: [
		[
			{ sym: "fp_arc" },
			[{ sym: "start" }, 1, 0],
			[{ sym: "mid" }, 0, 1],
			[{ sym: "end" }, -1, 0],
			[{ sym: "layer" }, "F.SilkS"],
		],
	],
};

describe("library footprint arcs", () => {
	test("arc path is drawn at the transformed points", () => {
		const placement = { x: 10, y: 20, rot: 90, side: "F" };
		const prims = transformPrimitives(
			footprintToPrimitives(ARC_FP),
			placementFor(ARC_FP, placement),
		);
		const arc = prims.graphics[0];
		const round = (p) => p.map((n) => Math.round(n * 1e6) / 1e6);
		// KiCad: +90 turns (1, 0) to (0, -1) and (-1, 0) to (0, 1), Y down.
		assert.deepEqual(round(arc.start), [10, 19]);
		assert.deepEqual(round(arc.end), [10, 21]);
		const nums = arc.d.match(/-?[\d.e-]+/g).map(Number);
		assert.deepEqual(round(nums.slice(0, 2)), [10, 19]);
		assert.deepEqual(round(nums.slice(-2)), [10, 21]);
	});
});

const ROUND_TRIP_PCB = `(kicad_pcb (version 20240108) (generator test)
  (footprint "Lib:A" (layer "F.Cu") (at 10 20 30)
    (property "Reference" "U1")
    (pad "1" smd rect (at -1 0 30) (size 1 1) (layers "F.Cu"))
    (pad "2" smd rect (at 1 0.5 30) (size 1 1) (layers "F.Cu")))
  (footprint "Lib:A" (layer "B.Cu") (at 30 20 -135)
    (property "Reference" "U2")
    (pad "1" smd rect (at -1 0 -135) (size 1 1) (layers "B.Cu"))
    (pad "2" smd rect (at 1 -0.5 -135) (size 1 1) (layers "B.Cu"))))`;

describe("rotation round trip", () => {
	test("import -> render -> save keeps every footprint angle", () => {
		const { ir, board } = importBoard(ROUND_TRIP_PCB);
		const before = structuredClone(ir);
		for (const part of ir.parts) {
			const fp = board.footprints[part.id];
			const lib = { pads: fp.pads, graphics: [] };
			transformPrimitives(
				footprintToPrimitives(fp),
				placementFor(fp, part.placement),
			);
			padWorldPositions(lib, part.placement);
		}
		assert.deepEqual(ir, before, "rendering must not touch the model");
		const moved = structuredClone(ir);
		for (const part of moved.parts) part.placement.x += 1;
		const { pcb } = editsFromIrChange(ir, moved);
		const saved = patchKicadText(ROUND_TRIP_PCB, { kind: "pcb", edits: pcb });
		assert.equal(saved.ok, true, saved.error);
		const again = importBoard(saved.text).ir;
		const rots = (m) => m.parts.map((p) => [p.ref, p.placement.rot]);
		assert.deepEqual(rots(again), rots(ir));
		assert.deepEqual(rots(ir), [
			["U1", 30],
			["U2", -135],
		]);
	});
});

// A pad at 30 degrees inside the footprint, off centre, so a wrong sign on
// either the pad angle or the flip shows up.
const P30_MOD = `(footprint "P30" (version 20240108) (generator "test") (layer "F.Cu")
  (property "Reference" "REF**" (at 0.5 -2 30) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "P30" (at 0 2 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
  (fp_line (start -1 -1) (end 2 -1) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (pad "1" smd rect (at 1 0.5 30) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at -2 -1) (size 0.5 1) (layers "F.Cu" "F.Paste" "F.Mask"))
)`;

// ref: [x, on the back]
const P30_REFS = { U2: [30, false], U4: [50, true] };

function p30Footprint(ref, x) {
	return P30_MOD.replace(
		'"P30" (version 20240108) (generator "test")',
		'"T:P30"',
	)
		.replace('"REF**"', `"${ref}"`)
		.replace('(layer "F.Cu")', `(layer "F.Cu") (at ${x} 20)`);
}

function p30Board() {
	const fps = Object.entries(P30_REFS).map(([ref, [x]]) =>
		p30Footprint(ref, x),
	);
	return `(kicad_pcb (version 20240108) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (34 "B.Paste" user) (35 "F.Paste" user) (36 "B.SilkS" user) (37 "F.SilkS" user) (38 "B.Mask" user) (39 "F.Mask" user) (48 "B.Fab" user) (49 "F.Fab" user))
  ${fps.join("\n  ")})`;
}

const PCBNEW_P30 = [
	"import sys, json, pcbnew",
	"b = pcbnew.LoadBoard(sys.argv[1])",
	"pads = {}",
	"for ref, back in (('U2', False), ('U4', True)):",
	"    fp = b.FindFootprintByReference(ref)",
	"    if back: fp.Flip(fp.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)",
	"    fp.SetOrientationDegrees(45)",
	"    pads[ref] = {p.GetNumber(): [pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y), p.GetOrientationDegrees()] for p in fp.Pads()}",
	"b.Save(sys.argv[2])",
	"print(json.dumps(pads))",
].join("\n");

// KiCad itself turns both parts to 45 degrees, flipping U4 to the back first,
// and reports every pad's board position and absolute angle.
function pcbnewP30(dir) {
	const src = path.join(dir, "in.kicad_pcb");
	const out = path.join(dir, "out.kicad_pcb");
	fs.writeFileSync(src, p30Board());
	const json = execFileSync(KIPYTHON, ["-I", "-c", PCBNEW_P30, src, out]);
	return { pads: JSON.parse(String(json)), text: fs.readFileSync(out, "utf8") };
}

const mod180 = (a) => Math.round((((a % 180) + 180) % 180) * 1e3) / 1e3;

function assertPadsMatch(fp, placement, expected, label) {
	const { pads } = transformPrimitives(
		footprintToPrimitives(fp),
		placementFor(fp, placement),
	);
	for (const pad of pads) {
		const [x, y, orient] = expected[pad.number];
		const off = Math.hypot(pad.center[0] - x, pad.center[1] - y);
		assert.ok(off < 1e-3, `${label} pad ${pad.number} off by ${off} mm`);
		// SVG turns clockwise on a Y-down board: KiCad's angle negated.
		const name = `${label} pad ${pad.number}`;
		assert.equal(mod180(pad.rot), mod180(-orient), name);
	}
}

function nodeSym(n) {
	return typeof n === "object" && n !== null ? n.sym : n;
}

function childAt(node) {
	return node.find((c) => Array.isArray(c) && nodeSym(c[0]) === "at");
}

// [name, x, y, angle] of every pad and Reference text of footprint `ref`.
function footprintAts(text, ref) {
	const fp = parse(text)
		.filter((n) => Array.isArray(n) && nodeSym(n[0]) === "footprint")
		.find((n) => JSON.stringify(n).includes(`"${ref}"`));
	const items = fp.filter(
		(n) =>
			Array.isArray(n) &&
			(nodeSym(n[0]) === "pad" ||
				(nodeSym(n[0]) === "property" && n[1] === "Reference")),
	);
	const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
	return items.map((n) => {
		const at = childAt(n);
		const angle = (((Number(at[3]) || 0) % 360) + 360) % 360;
		return [String(n[1]), r4(at[1]), r4(at[2]), r4(angle)];
	});
}

describe("pad at 30 degrees in a footprint at 45, checked against pcbnew", {
	skip: fs.existsSync(KIPYTHON) ? false : `missing ${KIPYTHON}`,
}, () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p30-"));
	fs.mkdirSync(path.join(dir, "T.pretty"));
	fs.writeFileSync(path.join(dir, "T.pretty", "P30.kicad_mod"), P30_MOD);
	const kicad = fs.existsSync(KIPYTHON) ? pcbnewP30(dir) : null;

	test("embedded and library pads land on KiCad's pads, front and back", async () => {
		const { ir, board } = importBoard(kicad.text);
		const lib = createKicadLibrary({ footprintDir: dir });
		const libFp = await lib.getFootprint("T:P30");
		assert.ok(libFp?.pads.length, "library footprint T:P30 not found");
		for (const part of ir.parts) {
			const want = kicad.pads[part.ref];
			const emb = board.footprints[part.id];
			assertPadsMatch(emb, part.placement, want, `${part.ref} embedded`);
			assertPadsMatch(libFp, part.placement, want, `${part.ref} library`);
		}
	});

	test("adding the footprint writes what pcbnew writes, Flip() included", () => {
		const edits = Object.entries(P30_REFS).map(([ref, [x, back]]) => ({
			op: "addFootprint",
			libId: "T:P30",
			source: P30_MOD,
			ref,
			value: "P30",
			x,
			y: 20,
			rot: 45,
			side: back ? "B" : "F",
		}));
		const res = applyPcbEdits(
			'(kicad_pcb (version 20240108) (generator "test"))',
			edits,
		);
		assert.equal(res.ok, true, res.error);
		for (const ref of Object.keys(P30_REFS)) {
			assert.deepEqual(
				footprintAts(res.text, ref),
				footprintAts(kicad.text, ref),
				ref,
			);
		}
	});
});
