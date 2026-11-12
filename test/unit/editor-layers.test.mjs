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

const FLIP_LAYER_CASES = [
	{ layer: "F.Cu", expected: "B.Cu" },
	{ layer: "B.Cu", expected: "F.Cu" },
	{ layer: "F.SilkS", expected: "B.SilkS" },
	{ layer: "B.SilkS", expected: "F.SilkS" },
	{ layer: "F.Mask", expected: "B.Mask" },
	{ layer: "B.Paste", expected: "F.Paste" },
	{ layer: "In1.Cu", expected: "In1.Cu" },
	{ layer: "In2.Cu", expected: "In2.Cu" },
	{ layer: "Edge.Cuts", expected: "Edge.Cuts" },
	{ layer: "Dwgs.User", expected: "Dwgs.User" },
	{ layer: "User.1", expected: "User.1" },
	{ layer: "Margin", expected: "Margin" },
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
	for (const { layer, expected } of FLIP_LAYER_CASES) {
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
		assert.equal(Object.isFrozen(state), true);
		assert.equal(Object.isFrozen(state.copper), true);
		assert.equal(Object.isFrozen(state.all), true);
		assert.equal(Object.isFrozen(state.hidden), true);
	});
});

describe("setActive", () => {
	test("updates active layer when valid", () => {
		const state = makeState(4);
		const validUpdated = setActive(state, "In2.Cu");
		assert.equal(validUpdated.active, "In2.Cu");
	});

	test("returns frozen state on valid update", () => {
		const state = makeState(4);
		const validUpdated = setActive(state, "In2.Cu");
		assert.equal(Object.isFrozen(validUpdated), true);
	});

	test("preserves state when layer does not exist", () => {
		const state = makeState(4);
		const invalidUpdated = setActive(state, "NonExistent.Layer");
		assert.equal(invalidUpdated, state);
	});

	test("preserves state when setting currently active layer", () => {
		const state = makeState(4);
		const validUpdated = setActive(state, "In2.Cu");
		const sameUpdated = setActive(validUpdated, "In2.Cu");
		assert.equal(sameUpdated, validUpdated);
	});
});

describe("stepCopper", () => {
	test("moves and wraps forward", () => {
		let state = makeState(4);
		for (const expected of ["In1.Cu", "In2.Cu", "B.Cu", "F.Cu"]) {
			state = stepCopper(state, 1);
			assert.equal(state.active, expected);
		}
	});

	test("moves and wraps backward", () => {
		let state = makeState(4);
		for (const expected of ["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"]) {
			state = stepCopper(state, -1);
			assert.equal(state.active, expected);
		}
	});

	test("resets to F.Cu if active is not copper", () => {
		const state = makeState(4);
		const userState = setActive(state, "Edge.Cuts");
		const stepped = stepCopper(userState, 1);
		assert.equal(stepped.active, "F.Cu");
	});
});

describe("jumpCopper", () => {
	test("jumps to bottom copper layer", () => {
		const state = makeState(4);
		const bottomState = jumpCopper(state, "bottom");
		assert.equal(bottomState.active, "B.Cu");
	});

	test("jumps to top copper layer", () => {
		const state = makeState(4);
		const bottomState = jumpCopper(state, "bottom");
		const topState = jumpCopper(bottomState, "top");
		assert.equal(topState.active, "F.Cu");
	});

	test("preserves state for invalid target", () => {
		const state = makeState(4);
		const unchanged = jumpCopper(state, "invalid");
		assert.equal(unchanged, state);
	});
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

	test("moves active layer to end when active is non-copper", () => {
		const state = makeState(4);
		const edgeActive = setActive(state, "Edge.Cuts");
		const orderEdge = drawOrder(edgeActive);
		assert.equal(orderEdge[orderEdge.length - 1], "Edge.Cuts");
		assert.equal(orderEdge.indexOf("B.Cu") < orderEdge.indexOf("F.Cu"), true);
	});

	test("moves active layer to end when active is back copper", () => {
		const state = makeState(4);
		const bCuActive = setActive(state, "B.Cu");
		const orderBCu = drawOrder(bCuActive);
		assert.equal(orderBCu[orderBCu.length - 1], "B.Cu");
	});
});
