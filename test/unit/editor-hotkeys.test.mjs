import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createHotkeyDispatcher,
	eventToKeySpec,
	isTypingTarget,
	mergeBindings,
	PCB_HOTKEYS,
	SCHEMATIC_HOTKEYS,
} from "../../frontend/src/editor/hotkeys.js";

const KEY_SPEC_CASES = [
	{ event: { key: "a" }, expected: "a", name: "plain key" },
	{ event: { key: "s", ctrlKey: true }, expected: "ctrl+s", name: "ctrl" },
	{
		event: { key: "k", metaKey: true },
		expected: "ctrl+k",
		name: "meta as ctrl",
	},
	{
		event: { key: "b", shiftKey: true, altKey: true },
		expected: "shift+alt+b",
		name: "shift+alt ordering",
	},
	{
		event: { key: "Control", ctrlKey: true },
		expected: "",
		name: "modifier-only Control",
	},
	{
		event: { key: "Shift", shiftKey: true },
		expected: "",
		name: "modifier-only Shift",
	},
	{
		event: { key: "Alt", altKey: true },
		expected: "",
		name: "modifier-only Alt",
	},
	{
		event: { key: "Meta", metaKey: true },
		expected: "",
		name: "modifier-only Meta",
	},
	{ event: { key: " " }, expected: "space", name: "space mapped to space" },
	{
		event: { key: " ", ctrlKey: true },
		expected: "ctrl+space",
		name: "ctrl+space",
	},
];

for (const { event, expected, name } of KEY_SPEC_CASES) {
	test(`eventToKeySpec: ${name}`, () => {
		assert.equal(eventToKeySpec(event), expected);
	});
}

const TYPING_TARGET_CASES = [
	{ target: { tagName: "INPUT" }, expected: true, name: "INPUT element" },
	{
		target: { tagName: "textarea" },
		expected: true,
		name: "TEXTAREA lowercase tag",
	},
	{ target: { tagName: "SELECT" }, expected: true, name: "SELECT element" },
	{
		target: { tagName: "DIV", isContentEditable: true },
		expected: true,
		name: "isContentEditable true",
	},
	{
		target: { tagName: "DIV", isContentEditable: false },
		expected: false,
		name: "regular DIV",
	},
	{ target: { tagName: "BODY" }, expected: false, name: "BODY tag" },
	{ target: null, expected: false, name: "null target" },
];

for (const { target, expected, name } of TYPING_TARGET_CASES) {
	test(`isTypingTarget: ${name}`, () => {
		assert.equal(isTypingTarget(target), expected);
	});
}

describe("mergeBindings", () => {
	test("applies overrides, lowercases values, ignores unknown actions, and freezes result", () => {
		const defaults = { placeWire: "w", move: "m", undo: "ctrl+z" };
		const overrides = { placeWire: "SHIFT+W", unknownAction: "ctrl+x" };
		const merged = mergeBindings(defaults, overrides);

		assert.equal(merged.placeWire, "shift+w");
		assert.equal(merged.move, "m");
		assert.equal(merged.undo, "ctrl+z");
		assert.equal("unknownAction" in merged, false);
		assert.equal(Object.isFrozen(merged), true);
	});
});

describe("createHotkeyDispatcher", () => {
	test("calls matching handler and preventDefault", () => {
		let invokedAction = null;
		let prevented = false;
		const bindings = { placeWire: "w", move: "m" };
		const handlers = {
			placeWire: () => {
				invokedAction = "placeWire";
			},
		};
		const dispatch = createHotkeyDispatcher(bindings, handlers);
		const event = {
			key: "w",
			preventDefault: () => {
				prevented = true;
			},
		};

		const result = dispatch(event);
		assert.equal(result, true);
		assert.equal(invokedAction, "placeWire");
		assert.equal(prevented, true);
	});

	test("returns false for unbound key and leaves preventDefault uncalled", () => {
		let prevented = false;
		const bindings = { placeWire: "w" };
		const handlers = { placeWire: () => {} };
		const dispatch = createHotkeyDispatcher(bindings, handlers);
		const event = {
			key: "m",
			preventDefault: () => {
				prevented = true;
			},
		};

		const result = dispatch(event);
		assert.equal(result, false);
		assert.equal(prevented, false);
	});

	test("ignores typing targets and returns false", () => {
		let invoked = false;
		const bindings = { placeWire: "w" };
		const handlers = {
			placeWire: () => {
				invoked = true;
			},
		};
		const dispatch = createHotkeyDispatcher(bindings, handlers);
		const event = {
			key: "w",
			target: { tagName: "INPUT" },
			preventDefault: () => {},
		};

		const result = dispatch(event);
		assert.equal(result, false);
		assert.equal(invoked, false);
	});

	test("returns false when handler for matching action is not a function", () => {
		let prevented = false;
		const bindings = { placeWire: "w" };
		const handlers = { placeWire: null };
		const dispatch = createHotkeyDispatcher(bindings, handlers);
		const event = {
			key: "w",
			preventDefault: () => {
				prevented = true;
			},
		};

		const result = dispatch(event);
		assert.equal(result, false);
		assert.equal(prevented, false);
	});
});

describe("hotkey constants", () => {
	test("SCHEMATIC_HOTKEYS and PCB_HOTKEYS are frozen and contain expected bindings", () => {
		assert.equal(Object.isFrozen(SCHEMATIC_HOTKEYS), true);
		assert.equal(Object.isFrozen(PCB_HOTKEYS), true);
		assert.equal(SCHEMATIC_HOTKEYS.placeWire, "w");
		assert.equal(SCHEMATIC_HOTKEYS.placeGlobalLabel, "ctrl+l");
		assert.equal(PCB_HOTKEYS.routeTrack, "x");
		assert.equal(PCB_HOTKEYS.unfillZones, "ctrl+b");
	});
});
