import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isPanPointer,
	pointerDownTarget,
} from "../../frontend/src/editor/pointerIntent.js";

describe("pointerDownTarget", () => {
	test("a pin click in select mode selects the part, never starts a wire", () => {
		assert.equal(pointerDownTarget("pin", false), "part");
	});

	test("a pin click in wire mode starts or finishes a wire", () => {
		assert.equal(pointerDownTarget("pin", true), "connect");
	});

	test("other hits ignore wire mode; a miss is an empty-canvas click", () => {
		for (const wireMode of [false, true]) {
			assert.equal(pointerDownTarget("part", wireMode), "part");
			assert.equal(pointerDownTarget("wire", wireMode), "wire");
			assert.equal(pointerDownTarget(undefined, wireMode), "empty");
		}
	});
});

describe("isPanPointer", () => {
	test("middle button pans with or without Space", () => {
		assert.equal(isPanPointer(1, false), true);
		assert.equal(isPanPointer(1, true), true);
	});

	test("left button pans only while Space is held", () => {
		assert.equal(isPanPointer(0, true), true);
		assert.equal(isPanPointer(0, false), false);
	});

	test("right button never pans", () => {
		assert.equal(isPanPointer(2, true), false);
	});
});
