import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getLayerColor } from "../../frontend/src/utils/diffLayerUtils.js";

const LAYER_COLOR_CASES = [
	{ layer: "F.Cu", expected: "#c83232", category: "front copper" },
	{ layer: "B.Cu", expected: "#3232c8", category: "back copper" },
	{ layer: "In1.Cu", expected: "#c86432", category: "inner copper 1" },
	{ layer: "In2.Cu", expected: "#c86432", category: "inner copper 2" },
	{ layer: "In3.Cu", expected: "#c86432", category: "inner copper 3" },
	{ layer: "In4.Cu", expected: "#c86432", category: "inner copper 4" },
	{ layer: "F.SilkS", expected: "#00aaaa", category: "front silkscreen" },
	{ layer: "B.SilkS", expected: "#00aaaa", category: "back silkscreen" },
	{ layer: "F.Mask", expected: "#800080", category: "front mask" },
	{ layer: "B.Mask", expected: "#800080", category: "back mask" },
	{ layer: "Edge.Cuts", expected: "#c8c800", category: "board outline" },
];

const FALLBACK_CASES = [
	{ input: "Unknown.Layer", desc: "unknown layer name" },
	{ input: "F.Paste", desc: "unmapped paste layer" },
	{ input: "Margin", desc: "margin layer" },
	{ input: "", desc: "empty string" },
	{ input: null, desc: "null input" },
	{ input: undefined, desc: "undefined input" },
];

describe("getLayerColor", () => {
	describe("standard KiCad layers", () => {
		for (const { layer, expected, category } of LAYER_COLOR_CASES) {
			test(`maps ${layer} (${category}) to ${expected}`, () => {
				assert.equal(getLayerColor(layer), expected);
			});
		}
	});

	describe("fallback behavior", () => {
		for (const { input, desc } of FALLBACK_CASES) {
			test(`returns fallback #8a91a3 for ${desc}`, () => {
				assert.equal(getLayerColor(input), "#8a91a3");
			});
		}
	});
});
