import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { boxSelect } from "../../frontend/src/editor/boxSelect.js";
import { partItems } from "../../frontend/src/editor/partBounds.js";
import { partBox } from "../../frontend/src/editor/schematicGeometry.js";

const RES_SYMBOL = {
	graphics: [
		[{ sym: "rectangle" }, [{ sym: "start" }, -2, 1], [{ sym: "end" }, 2, -1]],
	],
	pins: [
		{ number: "1", name: "~", at: [-3.81, 0, 0], length: 1.27 },
		{ number: "2", name: "~", at: [3.81, 0, 180], length: 1.27 },
	],
};

const round2 = (v) => Math.round(v * 100) / 100;
const corners = (b) => [b.minX, b.minY, b.maxX, b.maxY].map(round2);

function makeIr() {
	return {
		parts: [
			{ id: "r1", symbol: "Device:R", placement: { x: 10, y: 20, rot: 0 } },
			{ id: "u1", pins: ["1", "2"], placement: { x: 50, y: 20, rot: 0 } },
			{ id: "u2", pins: ["1", "2"], placement: { x: 50, y: 60, rot: 90 } },
		],
		nets: [],
	};
}

const CACHE = { "Device:R": RES_SYMBOL };

describe("partItems", () => {
	test("gives one item per placed part", () => {
		const items = partItems(makeIr(), CACHE);
		assert.deepEqual(
			items.map((i) => i.id),
			["r1", "u1", "u2"],
		);
	});

	test("symbol part bbox covers body and pins", () => {
		const [r1] = partItems(makeIr(), CACHE);
		assert.deepEqual(corners(r1.bbox), [6.19, 19, 13.81, 21]);
	});

	test("box part bbox matches partBox; rot 90 swaps size", () => {
		const items = partItems(makeIr(), CACHE);
		const box = partBox(makeIr().parts[1]);
		assert.deepEqual(
			corners(items[1].bbox),
			[box.x, box.y, box.x + box.width, box.y + box.height].map(round2),
		);
		const u2 = items[2].bbox;
		assert.equal(round2(u2.maxX - u2.minX), round2(box.height));
		assert.equal(round2(u2.maxY - u2.minY), round2(box.width));
	});

	test("handles missing ir and missing symbol cache", () => {
		assert.deepEqual(partItems(null, null), []);
		const items = partItems(makeIr(), undefined);
		assert.equal(items.length, 3);
		assert.ok(Number.isFinite(items[0].bbox.minX));
	});
});

const BOX_CASES = [
	["LTR selects only fully enclosed parts", [0, 10, 70, 30], ["r1", "u1"]],
	["LTR partly over a part does not select it", [0, 10, 11, 30], []],
	["RTL selects touching parts", [11, 30, 0, 10], ["r1"]],
	["RTL over both rows touches all", [51, 61, 9, 19], ["r1", "u1", "u2"]],
];

describe("boxSelect over partItems", () => {
	const items = partItems(makeIr(), CACHE);
	for (const [name, [x1, y1, x2, y2], expected] of BOX_CASES) {
		test(name, () => {
			const ids = boxSelect(items, { x: x1, y: y1 }, { x: x2, y: y2 });
			assert.deepEqual(ids, expected);
		});
	}
});
