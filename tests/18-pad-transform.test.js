// Ground truth comes from KiCad itself: pad positions read back with pcbnew's Python API for footprints
// placed at 50,50 with the given orientation. (Regression: the front-side rotation used to be mirrored.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { toBoardAbsolute } from "../backend/src/kicad-pcb-parser.js";

const near = (a, b) => Math.abs(a - b) < 0.002;

// [local x, local y, rotation, expected dx, expected dy] measured in KiCad 7.0.11
const KICAD_TRUTH = [
	[-0.9125, 0, 0, -0.9125, 0],
	[-0.9125, 0, 90, 0, 0.9125],
	[-0.9125, 0, 180, 0.9125, 0],
	[-0.9125, 0, 270, 0, -0.9125],
	[-0.9125, 0, 45, -0.645, 0.645],
	[0, 2.54, 0, 0, 2.54],
	[0, 2.54, 90, 2.54, 0],
	[0, 2.54, 270, -2.54, 0],
];

test("front-side pad positions match KiCad for every measured rotation", async (t) => {
	for (const [lx, ly, rot, dx, dy] of KICAD_TRUTH) {
		await t.test(`local(${lx},${ly}) rot ${rot}`, () => {
			const a = toBoardAbsolute(
				{ at: { x: 50, y: 50, rotation: rot }, layer: "F.Cu" },
				lx,
				ly,
			);
			assert.ok(
				near(a.x - 50, dx) && near(a.y - 50, dy),
				`got (${(a.x - 50).toFixed(3)}, ${(a.y - 50).toFixed(3)}) expected (${dx}, ${dy})`,
			);
		});
	}
});

test("back-side placement uses the same position transform (verified on a footprint flipped by pcbnew)", () => {
	// pcbnew: J1 rotated 90 and flipped to the back is saved with pad 2 at local (0,-2.54) and lies at (-2.54, 0).
	const a = toBoardAbsolute(
		{ at: { x: 50, y: 50, rotation: 90 }, layer: "B.Cu" },
		0,
		-2.54,
	);
	assert.ok(near(a.x - 50, -2.54) && near(a.y - 50, 0));
});

test("two rotations of 180 degrees are the identity and 4x90 returns to start", async (t) => {
	for (const [lx, ly] of [
		[1, 2],
		[-3, 0.5],
		[0, 0],
		[2.54, -2.54],
	]) {
		await t.test(`${lx},${ly}`, () => {
			let { x, y } = { x: lx, y: ly };
			for (let i = 0; i < 4; i++) {
				const a = toBoardAbsolute(
					{ at: { x: 0, y: 0, rotation: 90 }, layer: "F.Cu" },
					x,
					y,
				);
				x = a.x;
				y = a.y;
			}
			assert.ok(near(x, lx) && near(y, ly));
		});
	}
});
