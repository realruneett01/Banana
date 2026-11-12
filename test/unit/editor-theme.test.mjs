import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	getLayerColor,
	getSchematicColor,
	PCB_THEME,
	SCHEMATIC_THEME,
	SCHEMATIC_THEME_DARK,
	withOverrides,
} from "../../frontend/src/editor/theme.js";

const LAYER_COLOR_CASES = [
	["F.Cu", PCB_THEME.layers["F.Cu"]],
	["In5.Cu", PCB_THEME.layers["In1.Cu"]],
	["In6.Cu", PCB_THEME.layers["In2.Cu"]],
	["In7.Cu", PCB_THEME.layers["In3.Cu"]],
	["In8.Cu", PCB_THEME.layers["In4.Cu"]],
	["In30.Cu", PCB_THEME.layers["In2.Cu"]],
	["In31.Cu", "#94a3b8"],
	["User.1", PCB_THEME.layers["Dwgs.User"]],
	["User.3", PCB_THEME.layers["Dwgs.User"]],
	["User.9", PCB_THEME.layers["Dwgs.User"]],
	["User.10", "#94a3b8"],
	["unknown", "#94a3b8"],
];

const SCHEMATIC_COLOR_CASES = [
	["present key", SCHEMATIC_THEME, "wire", "#009600"],
	["fallback to default theme", {}, "wire", "#009600"],
	["fallback on null theme", null, "wire", "#009600"],
	[
		"missing key fallback to magenta",
		SCHEMATIC_THEME,
		"nonExistentKey",
		"#ff00ff",
	],
	["custom key in theme", { customKey: "#123456" }, "customKey", "#123456"],
];

describe("editor theme definitions", () => {
	test("themes are frozen", () => {
		assert.equal(Object.isFrozen(SCHEMATIC_THEME), true);
		assert.equal(Object.isFrozen(SCHEMATIC_THEME_DARK), true);
		assert.equal(Object.isFrozen(PCB_THEME), true);
		assert.equal(Object.isFrozen(PCB_THEME.layers), true);
	});

	test("SCHEMATIC_THEME_DARK contains identical keys to SCHEMATIC_THEME", () => {
		const darkKeys = Object.keys(SCHEMATIC_THEME_DARK);
		const lightKeys = Object.keys(SCHEMATIC_THEME);
		assert.equal(darkKeys.length, lightKeys.length);
		const lightKeySet = new Set(lightKeys);
		for (const key of darkKeys) {
			assert.equal(lightKeySet.has(key), true, `Missing key: ${key}`);
		}
	});

	test("SCHEMATIC_THEME_DARK overrides specific colors", () => {
		assert.equal(SCHEMATIC_THEME_DARK.background, "#1e1e1e");
		assert.equal(SCHEMATIC_THEME_DARK.grid, "#4a4a4a");
		assert.equal(SCHEMATIC_THEME_DARK.cursor, "#e6e6e6");
		assert.equal(SCHEMATIC_THEME_DARK.label, "#e6e6e6");
		assert.equal(SCHEMATIC_THEME_DARK.symbolFill, "rgba(0,0,0,0)");
		assert.equal(SCHEMATIC_THEME_DARK.sheetFill, "rgba(0,0,0,0)");
		assert.equal(SCHEMATIC_THEME_DARK.wire, SCHEMATIC_THEME.wire);
	});
});

describe("getSchematicColor", () => {
	test("resolves colors according to priority rules", () => {
		for (const [, theme, key, expected] of SCHEMATIC_COLOR_CASES) {
			assert.equal(getSchematicColor(theme, key), expected);
		}
	});
});

describe("getLayerColor", () => {
	test("resolves layer colors from table cases", () => {
		for (const [layer, expected] of LAYER_COLOR_CASES) {
			assert.equal(getLayerColor(PCB_THEME, layer), expected);
		}
	});
});

describe("withOverrides", () => {
	test("merges layers and leaves original unchanged", () => {
		const overrides = {
			background: "#112233",
			layers: {
				"F.Cu": "#00ff00",
			},
		};
		const updated = withOverrides(PCB_THEME, overrides);

		assert.equal(updated.background, "#112233");
		assert.equal(updated.layers["F.Cu"], "#00ff00");
		assert.equal(updated.layers["B.Cu"], PCB_THEME.layers["B.Cu"]);

		assert.equal(PCB_THEME.background, "#001023");
		assert.equal(PCB_THEME.layers["F.Cu"], "#c83434");

		assert.equal(Object.isFrozen(updated), true);
		assert.equal(Object.isFrozen(updated.layers), true);
	});

	test("merges non-layer theme overrides", () => {
		const updated = withOverrides(SCHEMATIC_THEME, { wire: "#ff0000" });
		assert.equal(updated.wire, "#ff0000");
		assert.equal(SCHEMATIC_THEME.wire, "#009600");
		assert.equal(Object.isFrozen(updated), true);
	});
});
