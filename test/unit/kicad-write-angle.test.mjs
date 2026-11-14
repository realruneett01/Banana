import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const KICAD = "C:/Program Files/KiCad/10.0/bin";
const KIPYTHON = `${KICAD}/python.exe`;
const KICLI = `${KICAD}/kicad-cli.exe`;
const skip = fs.existsSync(KIPYTHON) ? false : `missing ${KIPYTHON}`;

// A pad at 30 degrees inside the footprint, off centre, so a wrong sign on
// either the pad angle or the flip shows up.
const FOOTPRINTS = {
	"T:P30": {
		pads: [
			{ number: "1", type: "smd", shape: "rect", at: [1, 0.5, 30] },
			{ number: "2", type: "smd", shape: "rect", at: [-2, -1] },
		].map((p, i) => ({
			...p,
			size: [1, 2 - i],
			layers: ["F.Cu", "F.Paste", "F.Mask"],
		})),
	},
};

function part(n, x, rot, side) {
	return {
		id: `part_0000000${n}-0000-0000-0000-000000000000`,
		ref: `U${n}`,
		value: "P30",
		symbol: "T:P30",
		footprint: "T:P30",
		props: {},
		placement: { x, y: 20, rot, side },
	};
}

function writeBoard(placements) {
	const parts = placements.map(([x, rot, side], i) =>
		part(i + 1, x, rot, side),
	);
	const ir = { schemaVersion: 1, name: "A", parts, nets: [], constraints: [] };
	return irToKicadPcb(ir, { footprints: FOOTPRINTS }).text;
}

// The same parts unturned on the front: the start KiCad changes itself.
const BASE = writeBoard([
	[30, 0, "F"],
	[50, 0, "F"],
]);

const PCBNEW = [
	"import sys, json, pcbnew",
	"b = pcbnew.LoadBoard(sys.argv[1])",
	"for ref, flip, angle in json.loads(sys.argv[3]):",
	"    fp = b.FindFootprintByReference(ref)",
	"    if flip: fp.Flip(fp.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)",
	"    fp.SetOrientationDegrees(angle)",
	"b.Save(sys.argv[2])",
].join("\n");

const dir = skip ? null : fs.mkdtempSync(path.join(os.tmpdir(), "wangle-"));

// KiCad flips (top-bottom, as pcbnew does) and turns each part, then saves.
function pcbnew(text, ops) {
	const src = path.join(dir, "in.kicad_pcb");
	const out = path.join(dir, "out.kicad_pcb");
	fs.writeFileSync(src, text);
	execFileSync(KIPYTHON, ["-I", "-c", PCBNEW, src, out, JSON.stringify(ops)]);
	return fs.readFileSync(out, "utf8");
}

const nodeSym = (n) => (typeof n === "object" && n !== null ? n.sym : n);
const isHead = (n, h) => Array.isArray(n) && nodeSym(n[0]) === h;
const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
const deg = (a) => r4((((Number(a) || 0) % 360) + 360) % 360);

function atOf(node) {
	const at = node.find((c) => isHead(c, "at"));
	return [r4(at[1]), r4(at[2]), deg(at[3])];
}

function layerOf(node) {
	const one = node.find((c) => isHead(c, "layer"))?.[1];
	return (
		one ??
		node
			.find((c) => isHead(c, "layers"))
			?.slice(1)
			.sort()
			.join(" ")
	);
}

// Footprint, pad and Reference/Value (at x y angle) and layer of `ref`.
function footprintAts(text, ref) {
	const fp = parse(text)
		.filter((n) => isHead(n, "footprint"))
		.find((n) => JSON.stringify(n).includes(`"${ref}"`));
	const items = fp.filter(
		(n) =>
			isHead(n, "pad") ||
			(isHead(n, "property") && ["Reference", "Value"].includes(n[1])),
	);
	return [
		["fp", ...atOf(fp), layerOf(fp)],
		...items.map((n) => [String(n[1]), ...atOf(n), layerOf(n)]),
	];
}

function assertSameAts(ours, kicad, refs) {
	for (const ref of refs) {
		assert.deepEqual(footprintAts(ours, ref), footprintAts(kicad, ref), ref);
	}
}

// kicad-cli loads the board and reports each footprint's place.
function kicadPositions(text) {
	const src = path.join(dir, "cli.kicad_pcb");
	const out = path.join(dir, "cli.csv");
	fs.writeFileSync(src, text);
	const args = ["pcb", "export", "pos", "--format", "csv", "--units", "mm"];
	execFileSync(KICLI, [...args, "-o", out, src], { stdio: "pipe" });
	const rows = fs.readFileSync(out, "utf8").trim().split(/\r?\n/).slice(1);
	return rows.sort().map((r) => {
		const c = r.split(",").map((s) => s.replace(/"/g, ""));
		return [c[0], r4(c[3]), r4(c[4]), deg(c[5]), c[6]];
	});
}

describe("board writes match pcbnew angles", { skip }, () => {
	test("new board from IR: 45 degrees front, 30 degrees back", () => {
		const ours = writeBoard([
			[30, 45, "F"],
			[50, 30, "B"],
		]);
		const kicad = pcbnew(BASE, [
			["U1", false, 45],
			["U2", true, 30],
		]);
		assertSameAts(ours, kicad, ["U1", "U2"]);
		assert.deepEqual(kicadPositions(ours), [
			["U1", 30, -20, 45, "top"],
			["U2", 50, -20, 30, "bottom"],
		]);
	});

	test("rotating an existing footprint in place 0 -> 45", () => {
		const edits = [{ op: "move", ref: "U1", x: 30, y: 20, rot: 45 }];
		const res = patchKicadText(BASE, { kind: "pcb", edits });
		assert.equal(res.ok, true, res.error);
		assert.deepEqual(res.skipped, []);
		assertSameAts(res.text, pcbnew(BASE, [["U1", false, 45]]), ["U1"]);
	});

	test("moving an existing footprint front -> back, saved from the editor", () => {
		const start = pcbnew(BASE, [["U1", false, 45]]);
		const { ir } = kicadPcbToIr(start);
		const after = structuredClone(ir);
		const u1 = after.parts.find((p) => p.ref === "U1");
		u1.placement = { ...u1.placement, rot: 30, side: "B" };
		const { pcb, unsupported } = editsFromIrChange(ir, after);
		assert.deepEqual(unsupported, []);
		const res = patchKicadText(start, { kind: "pcb", edits: pcb });
		assert.equal(res.ok, true, res.error);
		assertSameAts(res.text, pcbnew(start, [["U1", true, 30]]), ["U1"]);
		assert.deepEqual(kicadPositions(res.text)[0], [
			"U1",
			30,
			-20,
			30,
			"bottom",
		]);
	});
});
