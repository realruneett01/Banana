import { equal } from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isPanPointer,
	pointerDownTarget,
} from "../../frontend/src/editor/pointerIntent.js";

const verifyExpectations = (fn, pairs) => {
	for (const [args, expected] of pairs) {
		equal(fn(...args), expected);
	}
};

describe("pointerDownTarget", () => {
	test("a pin click in select mode selects the part, never starts a wire", () => {
		verifyExpectations(pointerDownTarget, [[["pin", false], "part"]]);
	});

	test("a pin click in wire mode starts or finishes a wire", () => {
		verifyExpectations(pointerDownTarget, [[["pin", true], "connect"]]);
	});

	test("other hits ignore wire mode; a miss is an empty-canvas click", () => {
		const pairs = [false, true].flatMap((wireMode) => [
			[["part", wireMode], "part"],
			[["wire", wireMode], "wire"],
			[[undefined, wireMode], "empty"],
		]);
		verifyExpectations(pointerDownTarget, pairs);
	});
});

describe("isPanPointer", () => {
	test("middle button pans with or without Space", () => {
		verifyExpectations(isPanPointer, [
			[[1, false], true],
			[[1, true], true],
		]);
	});

	test("left button pans only while Space is held", () => {
		verifyExpectations(isPanPointer, [
			[[0, true], true],
			[[0, false], false],
		]);
	});

	test("right button never pans", () => {
		verifyExpectations(isPanPointer, [[[2, true], false]]);
	});
});
