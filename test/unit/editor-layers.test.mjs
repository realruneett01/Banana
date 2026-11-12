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
	[1, ["F.Cu"]],
	[2, ["F.Cu", "B.Cu"]],
	[4, ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]],
	[6, ["F.Cu", "In1.Cu", "In2.Cu", "In3.Cu", "In4.Cu", "B.Cu"]],
];

const INVALID_COPPER_CASES = [3, 0, -2, 34, 1.5, "4", null, undefined];

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

const LAYER_KIND_CASES = [
	["F.Cu", "copper"],
	["In1.Cu", "copper"],
	["B.Cu", "copper"],
	["Edge.Cuts", "edge"],
	["Dwgs.User", "user"],
	["Cmts.User", "user"],
	["Eco1.User", "user"],
	["Eco2.User", "user"],
	["User.1", "user"],
	["User.9", "user"],
	["F.SilkS", "tech"],
	["B.SilkS", "tech"],
	["F.Mask", "tech"],
	["F.Paste", "tech"],
	["F.Adhes", "tech"],
	["Margin", "tech"],
	["F.CrtYd", "tech"],
	["F.Fab", "tech"],
];

describe("copperLayers", () => {
	test("generates expected layers for valid counts", () => {
		for (const [count, expected] of VALID_COPPER_CASES) {
			assert.deepEqual(copperLayers(count), expected);
		}
	});

	test("throws RangeError for invalid counts", () => {
		for (const count of INVALID_COPPER_CASES) {
			assert.throws(() => copperLayers(count), RangeError);
		}
	});
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
	test("swaps F and B prefixes and leaves others unchanged", () => {
		for (const [input, expected] of FLIP_LAYER_CASES) {
			assert.equal(flipLayer(input), expected);
		}
	});
});

describe("layerKind", () => {
	test("identifies kind for copper, edge, user, and tech layers", () => {
		for (const [layer, expected] of LAYER_KIND_CASES) {
			assert.equal(layerKind(layer), expected);
		}
	});
});

describe("createLayerState and setActive", () => {
	test("initializes default state as frozen", () => {
		const state = createLayerState();
		assert.equal(state.active, "F.Cu");
		assert.equal(state.highContrast, false);
		assert.deepEqual(state.hidden, []);
		assert.deepEqual(state.copper, ["F.Cu", "B.Cu"]);
		assert.equal(Object.isFrozen(state), true);
		assert.equal(Object.isFrozen(state.copper), true);
		assert.equal(Object.isFrozen(state.all), true);
		assert.equal(Object.isFrozen(state.hidden), true);
	});

	test("setActive updates active layer when valid or preserves state", () => {
		const state = createLayerState({ copperCount: 4 });
		const validUpdated = setActive(state, "In2.Cu");
		assert.equal(validUpdated.active, "In2.Cu");
		assert.equal(Object.isFrozen(validUpdated), true);

		const invalidUpdated = setActive(state, "NonExistent.Layer");
		assert.equal(invalidUpdated, state);

		const sameUpdated = setActive(validUpdated, "In2.Cu");
		assert.equal(sameUpdated, validUpdated);
	});
});

describe("stepCopper and jumpCopper", () => {
	test("stepCopper moves and wraps in both directions", () => {
		let state = createLayerState({ copperCount: 4 });
		const forwardOrder = ["In1.Cu", "In2.Cu", "B.Cu", "F.Cu"];
		for (const expected of forwardOrder) {
			state = stepCopper(state, 1);
			assert.equal(state.active, expected);
		}

		const backwardOrder = ["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"];
		for (const expected of backwardOrder) {
			state = stepCopper(state, -1);
			assert.equal(state.active, expected);
		}
	});

	test("stepCopper resets to F.Cu if active is not copper", () => {
		const state = createLayerState({ copperCount: 4 });
		const userState = setActive(state, "Edge.Cuts");
		const stepped = stepCopper(userState, 1);
		assert.equal(stepped.active, "F.Cu");
	});

	test("jumpCopper jumps to top and bottom copper layers", () => {
		const state = createLayerState({ copperCount: 4 });
		const bottomState = jumpCopper(state, "bottom");
		assert.equal(bottomState.active, "B.Cu");

		const topState = jumpCopper(bottomState, "top");
		assert.equal(topState.active, "F.Cu");

		const unchanged = jumpCopper(state, "invalid");
		assert.equal(unchanged, state);
	});
});

describe("layer visibility", () => {
	test("toggleVisible and setVisible maintain state.all order in hidden", () => {
		const state = createLayerState({ copperCount: 2 });
		assert.equal(isVisible(state, "F.Cu"), true);

		const hidden1 = setVisible(state, "F.Mask", false);
		const hidden2 = setVisible(hidden1, "F.Cu", false);
		assert.equal(isVisible(hidden2, "F.Cu"), false);
		assert.equal(isVisible(hidden2, "F.Mask"), false);
		assert.equal(isVisible(hidden2, "B.Cu"), true);

		assert.deepEqual(hidden2.hidden, ["F.Cu", "F.Mask"]);

		const toggled = toggleVisible(hidden2, "F.Cu");
		assert.equal(isVisible(toggled, "F.Cu"), true);
		assert.deepEqual(toggled.hidden, ["F.Mask"]);

		const revealed = setVisible(toggled, "F.Mask", true);
		assert.deepEqual(revealed.hidden, []);
	});

	test("showOnly hides all layers except specified ones in sorted order", () => {
		const state = createLayerState({ copperCount: 2 });
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
		const state = createLayerState({ copperCount: 2 });
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
		const state = createLayerState({ copperCount: 2 });
		const hiddenState = setVisible(state, "B.SilkS", false);
		const order = drawOrder(hiddenState);
		assert.equal(order.includes("B.SilkS"), false);
	});

	test("moves active layer to end when active is non-copper or back copper", () => {
		const state = createLayerState({ copperCount: 4 });
		const edgeActive = setActive(state, "Edge.Cuts");
		const orderEdge = drawOrder(edgeActive);
		assert.equal(orderEdge[orderEdge.length - 1], "Edge.Cuts");
		assert.equal(orderEdge.indexOf("B.Cu") < orderEdge.indexOf("F.Cu"), true);

		const bCuActive = setActive(state, "B.Cu");
		const orderBCu = drawOrder(bCuActive);
		assert.equal(orderBCu[orderBCu.length - 1], "B.Cu");
	});
});
