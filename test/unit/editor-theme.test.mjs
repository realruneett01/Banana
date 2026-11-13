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
import { assertAllFrozen } from "../helpers/tests_1-asserts.mjs";

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
		assertAllFrozen(
			SCHEMATIC_THEME,
			SCHEMATIC_THEME_DARK,
			PCB_THEME,
			PCB_THEME.layers,
		);
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
		const overrides = {
			background: "#1e1e1e",
			grid: "#4a4a4a",
			cursor: "#e6e6e6",
			label: "#e6e6e6",
			symbolFill: "rgba(0,0,0,0)",
			sheetFill: "rgba(0,0,0,0)",
			wire: SCHEMATIC_THEME.wire,
		};
		for (const [key, expected] of Object.entries(overrides)) {
			assert.equal(SCHEMATIC_THEME_DARK[key], expected);
		}
	});
});

// Rows are [label, ...args, expected]; one test per row.
for (const [suite, kind, cases, resolve] of [
	["getSchematicColor", "schematic", SCHEMATIC_COLOR_CASES, getSchematicColor],
	[
		"getLayerColor",
		"layer",
		LAYER_COLOR_CASES.map(([layer, expected]) => [
			layer,
			PCB_THEME,
			layer,
			expected,
		]),
		getLayerColor,
	],
]) {
	describe(suite, () => {
		for (const [label, ...args] of cases) {
			const expected = args.pop();
			test(`resolves ${kind} color for ${label}`, () => {
				assert.equal(resolve(...args), expected);
			});
		}
	});
}

describe("withOverrides", () => {
	function createPcbOverrides() {
		return withOverrides(PCB_THEME, {
			background: "#112233",
			layers: {
				"F.Cu": "#00ff00",
			},
		});
	}

	test("merges layer properties and maintains untouched layers", () => {
		const updated = createPcbOverrides();
		assert.equal(updated.background, "#112233");
		assert.equal(updated.layers["F.Cu"], "#00ff00");
		assert.equal(updated.layers["B.Cu"], PCB_THEME.layers["B.Cu"]);
	});

	test("leaves original PCB_THEME unchanged", () => {
		createPcbOverrides();
		assert.equal(PCB_THEME.background, "#001023");
		assert.equal(PCB_THEME.layers["F.Cu"], "#c83434");
	});

	test("freezes updated theme and its layers", () => {
		const updated = createPcbOverrides();
		assertAllFrozen(updated, updated.layers);
	});

	test("merges non-layer theme overrides", () => {
		const updated = withOverrides(SCHEMATIC_THEME, { wire: "#ff0000" });
		assert.equal(updated.wire, "#ff0000");
		assert.equal(SCHEMATIC_THEME.wire, "#009600");
		assertAllFrozen(updated);
	});
});
