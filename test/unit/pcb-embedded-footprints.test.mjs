import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import {
	boardPadPositions,
	boardPadRadii,
	padWorldPositions,
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
