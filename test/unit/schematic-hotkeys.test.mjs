import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveSchematicAction } from "../../frontend/src/editor/hotkeys.js";

const CASES = [
	[{ key: "w" }, "placeWire"],
	[{ key: "W" }, "placeWire"],
	[{ key: "r" }, "rotate"],
	[{ key: "m" }, "move"],
	[{ key: "g" }, "drag"],
	[{ key: "x" }, "mirrorX"],
	[{ key: "y" }, "mirrorY"],
	[{ key: "e" }, "edit"],
	[{ key: "Delete" }, "delete"],
	[{ key: "Backspace" }, "delete"],
	[{ key: "Escape" }, "cancel"],
	[{ key: "Home" }, "zoomFit"],
	[{ key: "z", ctrlKey: true }, "undo"],
	[{ key: "z", metaKey: true }, "undo"],
	[{ key: "y", ctrlKey: true }, "redo"],
	[{ key: "Z", ctrlKey: true, shiftKey: true }, "redo"],
	[{ key: "+" }, "zoomIn"],
	[{ key: "+", shiftKey: true }, "zoomIn"],
	[{ key: "=" }, "zoomIn"],
	[{ key: "-" }, "zoomOut"],
	[{ key: "F1" }, "zoomIn"],
	[{ key: "F2" }, "zoomOut"],
];

describe("resolveSchematicAction", () => {
	for (const [event, expected] of CASES) {
		test(`${JSON.stringify(event)} -> ${expected}`, () => {
			assert.equal(resolveSchematicAction(event), expected);
		});
	}

	test("unbound keys and modifier-only presses resolve to null", () => {
		assert.equal(resolveSchematicAction({ key: "k" }), null);
		assert.equal(
			resolveSchematicAction({ key: "Shift", shiftKey: true }),
			null,
		);
		assert.equal(resolveSchematicAction({ key: "w", altKey: true }), null);
		assert.equal(resolveSchematicAction(null), null);
	});

	test("keys typed into inputs, textareas and editables are ignored", () => {
		for (const target of [
			{ tagName: "input" },
			{ tagName: "TEXTAREA" },
			{ tagName: "DIV", isContentEditable: true },
		]) {
			assert.equal(resolveSchematicAction({ key: "w", target }), null);
			assert.equal(
				resolveSchematicAction({ key: "z", ctrlKey: true, target }),
				null,
			);
		}
	});

	test("non-typing targets still resolve", () => {
		const target = { tagName: "DIV" };
		assert.equal(resolveSchematicAction({ key: "r", target }), "rotate");
	});
});
