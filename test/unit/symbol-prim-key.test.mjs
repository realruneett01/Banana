import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getPrimKey } from "../../frontend/src/editor/symbolRender.js";

const cases = [
	{
		label: "arc",
		a: { type: "arc", d: "M 1 2 A 3 3 0 0 1 4 5" },
		b: { type: "arc", d: "M 1 2 A 3 3 0 0 1 4 5" },
	},
	{
		label: "circle",
		a: { type: "circle", cx: 1, cy: 2 },
		b: { type: "circle", cx: 1, cy: 2 },
	},
	{
		label: "rect",
		a: { type: "rect", x: 0, y: 0, width: 10 },
		b: { type: "rect", x: 0, y: 0, width: 10 },
	},
	{
		label: "pin (same number)",
		a: { type: "pin", number: 1 },
		b: { type: "pin", number: 1 },
	},
];

describe("getPrimKey", () => {
	for (const { label, a, b } of cases) {
		test(`identical ${label} primitives get distinct keys`, () => {
			assert.notEqual(getPrimKey(a, 0), getPrimKey(b, 1));
		});

		test(`${label} key is stable for same prim and idx`, () => {
			assert.equal(getPrimKey(a, 0), getPrimKey(a, 0));
		});
	}

	test("type prefix is preserved in key", () => {
		assert.match(getPrimKey({ type: "arc", d: "x" }, 0), /^arc-/);
		assert.match(getPrimKey({ type: "circle", cx: 0, cy: 0 }, 0), /^circle-/);
		assert.match(
			getPrimKey({ type: "rect", x: 0, y: 0, width: 1 }, 0),
			/^rect-/,
		);
		assert.match(getPrimKey({ type: "pin", number: 3 }, 0), /^pin-/);
	});
});
