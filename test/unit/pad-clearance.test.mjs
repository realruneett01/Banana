import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import {
	boardCopperPads,
	padSegmentDistance,
	proposeRoute,
} from "../../frontend/src/editor/routingModel.js";

const ECC83 =
	"C:/Program Files/KiCad/10.0/share/kicad/demos/ecc83/ecc83-pp.kicad_pcb";
const skipEcc83 = fs.existsSync(ECC83) ? false : `missing ${ECC83}`;

// 2 x 1 mm rect pad of net GND at the origin, turned 30 degrees.
const RECT30 = {
	center: [0, 0],
	size: [2, 1],
	rot: 30,
	shape: "rect",
	layers: ["F.Cu"],
	netId: "GND",
};

function route(start, cursor, extra = {}) {
	return proposeRoute({
		start,
		cursor,
		layer: "F.Cu",
		widthMm: 0.25,
		clearanceMm: 0.2,
		netId: "VCC",
		...extra,
	});
}

describe("padSegmentDistance", () => {
	test("circle pad: distance from the rim", () => {
		const pad = { center: [0, 0], size: [2, 2], rot: 0, shape: "circle" };
		assert.ok(Math.abs(padSegmentDistance(pad, [-5, 3], [5, 3]) - 2) < 1e-9);
	});

	test("oval pad: stadium caps are round", () => {
		const pad = { center: [0, 0], size: [4, 2], rot: 0, shape: "oval" };
		// The cap circle is centred at (1, 0) with radius 1.
		const d = padSegmentDistance(pad, [3, 3], [3, 4]);
		assert.ok(Math.abs(d - (Math.hypot(2, 3) - 1)) < 1e-9);
	});

	test("roundrect pad: corner is rounded, edge is flat", () => {
		const pad = { center: [0, 0], size: [2, 2], rot: 0, shape: "roundrect" };
		// Corner radius 0.5 (rx = min(w, h) * 0.25, as the canvas draws it).
		assert.ok(Math.abs(padSegmentDistance(pad, [-5, 2], [5, 2]) - 1) < 1e-9);
		const corner = padSegmentDistance(pad, [2, 2], [2, 2]);
		assert.ok(Math.abs(corner - (Math.hypot(1.5, 1.5) - 0.5)) < 1e-9);
	});

	test("rect pad is turned by its rotation", () => {
		// Local (0.9, 0.4) turned 30 degrees: inside the turned pad, above the unturned one.
		const p = [
			0.9 * Math.cos(Math.PI / 6) - 0.2,
			0.45 + 0.4 * Math.cos(Math.PI / 6),
		];
		assert.ok(padSegmentDistance({ ...RECT30, rot: 0 }, p, p) > 0);
		assert.equal(padSegmentDistance(RECT30, [-3, 0], [3, 0]), 0);
	});
});

describe("proposeRoute pad and via clearance", () => {
	test("a segment through a foreign-net rect pad turned 30 degrees collides", () => {
		const { collisions } = route([-3, 0.3], [3, 0.3], { pads: [RECT30] });
		assert.equal(collisions.length, 1);
		assert.equal(collisions[0].segmentIndex, 0);
		assert.equal(collisions[0].otherNetId, "GND");
		assert.equal(collisions[0].gapMm, 0);
		assert.deepEqual(collisions[0].at, [3, 0.3]);
	});

	test("grazing at exactly the clearance does not collide", () => {
		const pad = { ...RECT30, rot: 0 };
		// Pad top edge y = 0.5; track half width 0.125; clearance 0.2.
		const y = 0.5 + 0.2 + 0.125;
		assert.equal(route([-3, y], [3, y], { pads: [pad] }).collisions.length, 0);
		const closer = route([-3, y - 0.01], [3, y - 0.01], { pads: [pad] });
		assert.equal(closer.collisions.length, 1);
	});

	test("a same-net pad never collides", () => {
		const pads = [{ ...RECT30, netId: "VCC" }];
		assert.equal(route([-3, 0], [3, 0], { pads }).collisions.length, 0);
	});

	test("a pad on another copper layer does not collide", () => {
		const pads = [{ ...RECT30, layers: ["B.Cu"] }];
		assert.equal(route([-3, 0], [3, 0], { pads }).collisions.length, 0);
	});

	test("a foreign via collides, a same-net via does not", () => {
		const via = { at: [0, 0], netId: "GND", sizeMm: 0.6, drillMm: 0.3 };
		const hit = route([-3, 0.4], [3, 0.4], { board: { vias: [via] } });
		assert.equal(hit.collisions.length, 1);
		assert.equal(hit.collisions[0].otherNetId, "GND");
		const own = { board: { vias: [{ ...via, netId: "VCC" }] } };
		assert.equal(route([-3, 0.4], [3, 0.4], own).collisions.length, 0);
	});
});

describe("ecc83 pad clearance", { skip: skipEcc83 }, () => {
	test("a straight segment across U1 between pads of different nets collides", () => {
		const { ir, board } = kicadPcbToIr(fs.readFileSync(ECC83, "utf8"));
		const lookup = (part) => board.footprints?.[part.id] ?? null;
		const pads = boardCopperPads(ir.parts, lookup, ir.nets);
		const u1 = ir.parts.find((p) => p.ref === "U1");
		const own = (n) => pads.find((p) => p.partId === u1.id && p.number === n);
		const [grid, cathode] = [own("2"), own("3")];
		assert.ok(grid.netId && cathode.netId && grid.netId !== cathode.netId);
		const res = proposeRoute({
			start: grid.center,
			cursor: cathode.center,
			layer: "F.Cu",
			widthMm: 0.25,
			clearanceMm: 0.2,
			board,
			pads,
			netId: grid.netId,
		});
		assert.equal(res.collisions.length, 1);
		assert.equal(res.collisions[0].otherNetId, cathode.netId);
	});
});
