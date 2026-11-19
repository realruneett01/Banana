import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	copperLayers,
	createLayerState,
	drawOrder,
	flipLayer,
	isVisible,
	jumpCopper,
	layerKind,
	NON_COPPER_LAYERS,
	setActive,
	setVisible,
	showOnly,
	stepCopper,
	toggleVisible,
} from "../../frontend/src/editor/layers.js";
import { assertAllFrozen } from "../helpers/tests_1-asserts.mjs";

const VALID_COPPER_CASES = [
	{ count: 1, expected: ["F.Cu"] },
	{ count: 2, expected: ["F.Cu", "B.Cu"] },
	{ count: 4, expected: ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] },
	{
		count: 6,
		expected: ["F.Cu", "In1.Cu", "In2.Cu", "In3.Cu", "In4.Cu", "B.Cu"],
	},
];

const INVALID_COPPER_CASES = [3, 0, -2, 34, 1.5, "4", null, undefined];

// [layer, expected] pairs
const FLIP_LAYER_CASES = [
	["F.Cu", "B.Cu"],
	["B.Cu", "F.Cu"],
	["F.SilkS", "B.SilkS"],
	["B.SilkS", "F.SilkS"],
	["F.Mask", "B.Mask"],
	["B.Paste", "F.Paste"],
	["In1.Cu", "In1.Cu"],
	["In2.Cu", "In2.Cu"],
	["Edge.Cuts", "Edge.Cuts"],
	["Dwgs.User", "Dwgs.User"],
	["User.1", "User.1"],
	["Margin", "Margin"],
];

const LAYER_KIND_GROUPS = [
	{ kind: "copper", layers: ["F.Cu", "In1.Cu", "B.Cu"] },
	{ kind: "edge", layers: ["Edge.Cuts"] },
	{
		kind: "user",
		layers: [
			"Dwgs.User",
			"Cmts.User",
			"Eco1.User",
			"Eco2.User",
			"User.1",
			"User.9",
		],
	},
	{
		kind: "tech",
		layers: [
			"F.SilkS",
			"B.SilkS",
			"F.Mask",
			"F.Paste",
			"F.Adhes",
			"Margin",
			"F.CrtYd",
			"F.Fab",
		],
	},
];

const makeState = (copperCount = 2) => createLayerState({ copperCount });

describe("copperLayers", () => {
	for (const { count, expected } of VALID_COPPER_CASES) {
		test(`generates expected layers for valid count ${count}`, () => {
			assert.deepEqual(copperLayers(count), expected);
		});
	}

	for (const count of INVALID_COPPER_CASES) {
		test(`throws RangeError for invalid count ${String(count)}`, () => {
			assert.throws(() => copperLayers(count), RangeError);
		});
	}
});

describe("NON_COPPER_LAYERS", () => {
	test("is a frozen array starting with F.Adhes and ending with User.9", () => {
		assert.equal(Object.isFrozen(NON_COPPER_LAYERS), true);
		assert.equal(NON_COPPER_LAYERS[0], "F.Adhes");
		assert.equal(NON_COPPER_LAYERS[NON_COPPER_LAYERS.length - 1], "User.9");
		assert.equal(NON_COPPER_LAYERS.length, 27);
	});
});

describe("flipLayer", () => {
	for (const [layer, expected] of FLIP_LAYER_CASES) {
		test(`swaps ${layer} to ${expected}`, () => {
			assert.equal(flipLayer(layer), expected);
		});
	}
});

describe("layerKind", () => {
	for (const { kind, layers } of LAYER_KIND_GROUPS) {
		for (const layer of layers) {
			test(`identifies kind for ${layer} as ${kind}`, () => {
				assert.equal(layerKind(layer), kind);
			});
		}
	}
});

describe("createLayerState", () => {
	test("initializes default state properties", () => {
		const state = makeState();
		assert.equal(state.active, "F.Cu");
		assert.equal(state.highContrast, false);
		assert.deepEqual(state.hidden, []);
		assert.deepEqual(state.copper, ["F.Cu", "B.Cu"]);
	});

	test("freezes default state and its collections", () => {
		const state = makeState();
		assertAllFrozen(state, state.copper, state.all, state.hidden);
	});
});

/** Registers a test asserting the active layer after `run` on a 4-layer state. */
function testActiveAfter(title, run, expected) {
	test(title, () => {
		assert.equal(run(makeState(4)).active, expected);
	});
}

/** Registers a test asserting `run` returns the 4-layer state unchanged. */
function testUnchanged(title, run) {
	test(title, () => {
		const state = makeState(4);
		assert.equal(run(state), state);
	});
}

/** Registers a test stepping copper by `dir` and asserting each active layer. */
function testWalk(title, dir, expectedLayers) {
	test(title, () => {
		let state = makeState(4);
		for (const expected of expectedLayers) {
			state = stepCopper(state, dir);
			assert.equal(state.active, expected);
		}
	});
}

describe("setActive", () => {
	testActiveAfter(
		"updates active layer when valid",
		(state) => setActive(state, "In2.Cu"),
		"In2.Cu",
	);

	test("returns frozen state on valid update", () => {
		assertAllFrozen(setActive(makeState(4), "In2.Cu"));
	});

	testUnchanged("preserves state when layer does not exist", (state) =>
		setActive(state, "NonExistent.Layer"),
	);

	test("preserves state when setting currently active layer", () => {
		const validUpdated = setActive(makeState(4), "In2.Cu");
		const sameUpdated = setActive(validUpdated, "In2.Cu");
		assert.equal(sameUpdated, validUpdated);
	});
});

describe("stepCopper", () => {
	testWalk("moves and wraps forward", 1, ["In1.Cu", "In2.Cu", "B.Cu", "F.Cu"]);
	testWalk("moves and wraps backward", -1, [
		"B.Cu",
		"In2.Cu",
		"In1.Cu",
		"F.Cu",
	]);
	testActiveAfter(
		"resets to F.Cu if active is not copper",
		(state) => stepCopper(setActive(state, "Edge.Cuts"), 1),
		"F.Cu",
	);
});

describe("jumpCopper", () => {
	testActiveAfter(
		"jumps to bottom copper layer",
		(state) => jumpCopper(state, "bottom"),
		"B.Cu",
	);
	testActiveAfter(
		"jumps to top copper layer",
		(state) => jumpCopper(jumpCopper(state, "bottom"), "top"),
		"F.Cu",
	);
	testUnchanged("preserves state for invalid target", (state) =>
		jumpCopper(state, "invalid"),
	);
});

describe("layer visibility", () => {
	test("setVisible hides layers and maintains state.all order in hidden", () => {
		const state = makeState();
		assert.equal(isVisible(state, "F.Cu"), true);

		const hidden1 = setVisible(state, "F.Mask", false);
		const hidden2 = setVisible(hidden1, "F.Cu", false);
		assert.equal(isVisible(hidden2, "F.Cu"), false);
		assert.equal(isVisible(hidden2, "F.Mask"), false);
		assert.equal(isVisible(hidden2, "B.Cu"), true);
		assert.deepEqual(hidden2.hidden, ["F.Cu", "F.Mask"]);
	});

	test("toggleVisible and setVisible reveal hidden layers", () => {
		const state = makeState();
		const hidden1 = setVisible(state, "F.Mask", false);
		const hidden2 = setVisible(hidden1, "F.Cu", false);

		const toggled = toggleVisible(hidden2, "F.Cu");
		assert.equal(isVisible(toggled, "F.Cu"), true);
		assert.deepEqual(toggled.hidden, ["F.Mask"]);

		const revealed = setVisible(toggled, "F.Mask", true);
		assert.deepEqual(revealed.hidden, []);
	});

	test("showOnly hides all layers except specified ones in sorted order", () => {
		const state = makeState();
		const onlyFCu = showOnly(state, ["F.Cu"]);
		assert.equal(isVisible(onlyFCu, "F.Cu"), true);
		assert.equal(isVisible(onlyFCu, "B.Cu"), false);
		assert.equal(onlyFCu.hidden.includes("F.Cu"), false);

		const expectedHidden = state.all.filter((l) => l !== "F.Cu");
		assert.deepEqual(onlyFCu.hidden, expectedHidden);
	});
});

describe("drawOrder", () => {
	test("puts visible layers bottom to top with active layer last", () => {
		const state = makeState();
		const order = drawOrder(state);

		assert.equal(order[order.length - 1], "F.Cu");

		const bCuIdx = order.indexOf("B.Cu");
		const fCuIdx = order.indexOf("F.Cu");
		assert.equal(bCuIdx !== -1, true);
		assert.equal(fCuIdx !== -1, true);
		assert.equal(bCuIdx < fCuIdx, true);

		const bSilkIdx = order.indexOf("B.SilkS");
		assert.equal(bSilkIdx < bCuIdx, true);
	});

	test("excludes hidden layers from drawOrder", () => {
		const state = makeState();
		const hiddenState = setVisible(state, "B.SilkS", false);
		const order = drawOrder(hiddenState);
		assert.equal(order.includes("B.SilkS"), false);
	});

	const orderWithActive = (layer) => drawOrder(setActive(makeState(4), layer));

	test("moves active layer to end when active is non-copper", () => {
		const orderEdge = orderWithActive("Edge.Cuts");
		assert.equal(orderEdge.at(-1), "Edge.Cuts");
		assert.equal(orderEdge.indexOf("B.Cu") < orderEdge.indexOf("F.Cu"), true);
	});

	test("moves active layer to end when active is back copper", () => {
		assert.equal(orderWithActive("B.Cu").at(-1), "B.Cu");
	});
});
