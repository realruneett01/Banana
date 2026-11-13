import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { createKicadLibrary } from "../../backend/src/engine/kicad-library.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
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
