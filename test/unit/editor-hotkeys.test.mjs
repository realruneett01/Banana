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

const MODIFIER_CASES = [
	["Control", "ctrlKey"],
	["Shift", "shiftKey"],
	["Alt", "altKey"],
	["Meta", "metaKey"],
].map(([key, prop]) => ({
	event: { key, [prop]: true },
	expected: "",
	name: `modifier-only ${key}`,
}));

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
	...MODIFIER_CASES,
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

function dispatchCase({ bindings, handlerValue, eventProps }) {
	let invokedAction = null;
	let prevented = false;
	const handlers =
		handlerValue !== undefined
			? { placeWire: handlerValue }
			: {
					placeWire: () => {
						invokedAction = "placeWire";
					},
				};
	const dispatch = createHotkeyDispatcher(bindings, handlers);
	const event = {
		preventDefault: () => {
			prevented = true;
		},
		...eventProps,
	};
	const result = dispatch(event);
	return { result, invokedAction, prevented };
}

const DISPATCHER_CASES = [
	{
		name: "calls matching handler and preventDefault",
		bindings: { placeWire: "w", move: "m" },
		eventProps: { key: "w" },
		expectedResult: true,
		expectedAction: "placeWire",
		expectedPrevented: true,
	},
	{
		name: "returns false for unbound key and leaves preventDefault uncalled",
		bindings: { placeWire: "w" },
		handlerValue: () => {},
		eventProps: { key: "m" },
	},
	{
		name: "ignores typing targets and returns false",
		bindings: { placeWire: "w" },
		eventProps: { key: "w", target: { tagName: "INPUT" } },
	},
	{
		name: "returns false when handler for matching action is not a function",
		bindings: { placeWire: "w" },
		handlerValue: null,
		eventProps: { key: "w" },
	},
];

describe("createHotkeyDispatcher", () => {
	for (const tc of DISPATCHER_CASES) {
		test(tc.name, () => {
			const { result, invokedAction, prevented } = dispatchCase(tc);
			assert.equal(result, tc.expectedResult ?? false);
			assert.equal(invokedAction, tc.expectedAction ?? null);
			assert.equal(prevented, tc.expectedPrevented ?? false);
		});
	}
});

describe("hotkey constants", () => {
	test("SCHEMATIC_HOTKEYS is frozen and contains expected bindings", () => {
		assert.equal(Object.isFrozen(SCHEMATIC_HOTKEYS), true);
		assert.equal(SCHEMATIC_HOTKEYS.placeWire, "w");
		assert.equal(SCHEMATIC_HOTKEYS.placeGlobalLabel, "ctrl+l");
	});

	test("PCB_HOTKEYS is frozen and contains expected bindings", () => {
		assert.equal(Object.isFrozen(PCB_HOTKEYS), true);
		assert.equal(PCB_HOTKEYS.routeTrack, "x");
		assert.equal(PCB_HOTKEYS.unfillZones, "ctrl+b");
	});
});
