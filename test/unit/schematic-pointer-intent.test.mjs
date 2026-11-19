import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isPanPointer,
	pointerDownTarget,
} from "../../frontend/src/editor/pointerIntent.js";

describe("pointerDownTarget", () => {
	const targetCases = [
		[
			"a pin click in select mode selects the part, never starts a wire",
			() => assert.equal(pointerDownTarget("pin", false), "part"),
		],
		[
			"a pin click in wire mode starts or finishes a wire",
			() => assert.equal(pointerDownTarget("pin", true), "connect"),
		],
		[
			"other hits ignore wire mode; a miss is an empty-canvas click",
			() => {
				for (const wireMode of [false, true]) {
					for (const [target, expected] of [
						["part", "part"],
						["wire", "wire"],
						[undefined, "empty"],
					]) {
						assert.equal(pointerDownTarget(target, wireMode), expected);
					}
				}
			},
		],
	];

	for (const [name, execute] of targetCases) {
		test(name, execute);
	}
});

describe("isPanPointer", () => {
	const panMatrix = [
		[
			"middle button pans with or without Space",
			[
				[1, false, true],
				[1, true, true],
			],
		],
		[
			"left button pans only while Space is held",
			[
				[0, true, true],
				[0, false, false],
			],
		],
		["right button never pans", [[2, true, false]]],
	];

	for (const [name, matrix] of panMatrix) {
		test(name, () => {
			for (const [button, space, expected] of matrix) {
				assert.equal(isPanPointer(button, space), expected);
			}
		});
	}
});
