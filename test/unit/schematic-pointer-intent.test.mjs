import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isPanPointer,
	pointerDownTarget,
} from "../../frontend/src/editor/pointerIntent.js";

const assertTarget = (target, wireMode, expected) => {
	assert.equal(pointerDownTarget(target, wireMode), expected);
};

describe("pointerDownTarget", () => {
	test("a pin click in select mode selects the part, never starts a wire", () => {
		assertTarget("pin", false, "part");
	});

	test("a pin click in wire mode starts or finishes a wire", () => {
		assertTarget("pin", true, "connect");
	});

	test("other hits ignore wire mode; a miss is an empty-canvas click", () => {
		for (const wireMode of [false, true]) {
			assertTarget("part", wireMode, "part");
			assertTarget("wire", wireMode, "wire");
			assertTarget(undefined, wireMode, "empty");
		}
	});
});

describe("isPanPointer", () => {
	test("middle button pans with or without Space", () => {
		for (const space of [false, true]) {
			assert.equal(isPanPointer(1, space), true);
		}
	});

	test("left button pans only while Space is held", () => {
		assert.equal(isPanPointer(0, true), true);
		assert.equal(isPanPointer(0, false), false);
	});

	test("right button never pans", () => {
		assert.equal(isPanPointer(2, true), false);
	});
});
