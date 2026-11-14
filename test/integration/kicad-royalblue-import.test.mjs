import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";

// KiCad 10's own demo has 349 "(curved_edges no)filter_ratio 0.9)" fragments.
// kicad-cli loads it; "kicad-cli pcb upgrade --force" re-saves each fragment as
// "(filter_ratio 0.9)", giving 71 footprints and 428 pads, and
// "kicad-cli pcb export pos" writes 50 rows (21 footprints are excluded from pos).
const DEMOS_DIR =
	process.env.KICAD_DEMOS_DIR ||
	"C:/Program Files/KiCad/10.0/share/kicad/demos";
const BOARD = path.join(
	DEMOS_DIR,
	"royalblue54L_feather/RoyalBlue54L-Feather.kicad_pcb",
);
const skip = fs.existsSync(BOARD) ? false : `KiCad demo missing: ${BOARD}`;

describe("RoyalBlue54L-Feather demo import", { skip }, () => {
	test("imports with a recovery warning and KiCad's own counts", () => {
		const res = kicadPcbToIr(fs.readFileSync(BOARD, "utf8"));
		assert.equal(res.ok, true, JSON.stringify(res.errors));
		assert.ok(res.warnings.some((w) => /349 lists missing '\('/.test(w)));
		const footprints = Object.values(res.board.footprints);
		assert.equal(footprints.length, 71);
		const pads = footprints.reduce((n, fp) => n + fp.pads.length, 0);
		assert.equal(pads, 428);
		const inPos = footprints.filter(
			(fp) => !fp.attr?.includes("exclude_from_pos_files"),
		);
		assert.equal(inPos.length, 50);
	});
});
