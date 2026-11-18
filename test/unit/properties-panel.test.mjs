import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createEditor } from "../../frontend/src/editor/editorModel.js";

const panelUrl = new URL(
	"../../frontend/src/editor/PropertiesPanel.jsx",
	import.meta.url,
);
const panelSrc = readFileSync(panelUrl, "utf8");

async function loadHelpers() {
	try {
		return await import(panelUrl.href);
	} catch {
		// JSX component cannot be imported directly in plain Node ESM
		const startMarker = "// --- Pure properties helpers ---";
		const endMarker = "// --- End pure properties helpers ---";
		const start = panelSrc.indexOf(startMarker);
		const end = panelSrc.indexOf(endMarker);
		const chunk = panelSrc.slice(start, end);
		return await import(
			`data:text/javascript;base64,${Buffer.from(chunk).toString("base64")}`
		);
	}
}

const {
	isValidReference,
	isUniqueReference,
	validateReference,
	extractOtherRefs,
	buildFieldEditCommand,
	buildFlipCommand,
	getLayerLabel,
	getDatasheetValue,
} = await loadHelpers();

function checkRefValidity(cases, expected) {
	for (const ref of cases) {
		assert.equal(isValidReference(ref), expected);
	}
}

function checkUniqueness(cases, other) {
	for (const [ref, expected] of cases) {
		assert.equal(isUniqueReference(ref, other), expected);
	}
}

function assertRefValidation(actual, expected) {
	assert.deepEqual(
		{
			valid: actual.valid,
			error: actual.error,
			isUnique: actual.isUnique,
			hint: actual.hint,
		},
		expected,
	);
}

function createTestEditor() {
	return createEditor({
		schemaVersion: 1,
		name: "prop-test",
		parts: [
			{
				id: "part_u1",
				ref: "U1",
				value: "NE555",
				symbol: "Timer:NE555",
				footprint: "Package_SO:SOIC-8",
				props: { Datasheet: "http://example.com/ne555.pdf" },
				placement: { x: 10, y: 20, rot: 0, side: "F" },
			},
		],
		nets: [],
		constraints: [],
	});
}

describe("reference validation logic", () => {
	test("isValidReference accepts letters followed by digits or ?", () => {
		checkRefValidity(["R1", "C12", "U?", "D?", "SW100", "LED1", " R1 "], true);
	});

	test("isValidReference rejects non-compliant reference formats", () => {
		checkRefValidity(
			["", "   ", "1R", "R", "R1A", "R!", "R?1", null, undefined, 123],
			false,
		);
	});

	test("isUniqueReference detects duplicates across other parts", () => {
		checkUniqueness(
			[
				["R1", true],
				["R2", false],
				["R2 ", false],
			],
			["R2", "R3", "C1", "U1"],
		);
	});

	test("isUniqueReference allows wildcard unannotated references ending with ?", () => {
		checkUniqueness(
			[
				["R?", true],
				["C?", true],
			],
			["R?", "C?"],
		);
	});

	test("validateReference produces appropriate valid, error and hint states", () => {
		const other = ["R2", "C1"];
		assertRefValidation(validateReference("R1", other), {
			valid: true,
			error: "",
			isUnique: true,
			hint: "",
		});
		assertRefValidation(validateReference("R2", other), {
			valid: true,
			error: "",
			isUnique: false,
			hint: "Reference already in use",
		});
		const invalidFormat = validateReference("123", other);
		assert.equal(invalidFormat.valid, false);
		assert.match(invalidFormat.error, /letters followed by digits or \?/);
	});
});

describe("extractOtherRefs", () => {
	test("extracts references of parts excluding current part id", () => {
		const parts = [
			{ id: "p1", ref: "R1" },
			{ id: "p2", ref: "R2" },
			{ id: "p3", ref: "C1" },
		];
		const testCases = [
			["p1", ["R2", "C1"]],
			["p2", ["R1", "C1"]],
			["non-existent", ["R1", "R2", "C1"]],
		];
		for (const [id, expected] of testCases) {
			assert.deepEqual(extractOtherRefs(parts, id), expected);
		}
	});

	test("handles null, missing, or malformed parts list gracefully", () => {
		const invalidInputs = [null, [], [null, { id: "p2" }]];
		for (const input of invalidInputs) {
			assert.deepEqual(extractOtherRefs(input, "p1"), []);
		}
	});
});

describe("command builder functions", () => {
	test("buildFieldEditCommand creates setPartField for valid fields", () => {
		const validFields = [
			["ref", "U9"],
			["value", "LM358"],
			["footprint", "Package_SO:SOIC-8"],
		];
		for (const [field, value] of validFields) {
			assert.deepEqual(buildFieldEditCommand("part_u1", field, value), {
				type: "setPartField",
				partId: "part_u1",
				field,
				value,
			});
		}
	});

	test("buildFieldEditCommand returns null for datasheet or unknown fields", () => {
		const invalidCases = [
			["part_u1", "datasheet", "https://example.com"],
			["part_u1", "unknown", "val"],
			["", "ref", "R1"],
			["part_u1", "ref", 123],
		];
		for (const [partId, field, val] of invalidCases) {
			assert.equal(buildFieldEditCommand(partId, field, val), null);
		}
	});

	test("buildFlipCommand builds valid flipPart command", () => {
		assert.deepEqual(buildFlipCommand("part_u1"), {
			type: "flipPart",
			partId: "part_u1",
		});
		assert.equal(buildFlipCommand(null), null);
	});

	test("getLayerLabel formats PCB side and layer correctly", () => {
		const layerCases = [
			["F", "Top (F.Cu)"],
			["B", "Bottom (B.Cu)"],
			[undefined, "Top (F.Cu)"],
		];
		for (const [side, expected] of layerCases) {
			assert.equal(getLayerLabel(side), expected);
		}
	});

	test("getDatasheetValue retrieves datasheet from various schema locations", () => {
		const datasheetCases = [
			[{ datasheet: "https://ds.example.com" }, "https://ds.example.com"],
			[
				{ props: { Datasheet: "https://kicad-ds.com" } },
				"https://kicad-ds.com",
			],
			[
				{ props: { datasheet: "https://lower-ds.com" } },
				"https://lower-ds.com",
			],
			[{}, ""],
			[null, ""],
		];
		for (const [input, expected] of datasheetCases) {
			assert.equal(getDatasheetValue(input), expected);
		}
	});
});

describe("integration with editorModel dispatch and undo/redo", () => {
	test("field edit command executes and un-does cleanly via editorModel", () => {
		const editor = createTestEditor();
		editor.dispatch(buildFieldEditCommand("part_u1", "ref", "U100"));
		assert.deepEqual(
			{ ref: editor.state.ir.parts[0].ref, canUndo: editor.canUndo },
			{ ref: "U100", canUndo: true },
		);

		editor.undo();
		assert.deepEqual(
			{ ref: editor.state.ir.parts[0].ref, canRedo: editor.canRedo },
			{ ref: "U1", canRedo: true },
		);

		editor.redo();
		assert.equal(editor.state.ir.parts[0].ref, "U100");
	});

	test("flipPart command executes and un-does cleanly via editorModel", () => {
		const editor = createTestEditor();
		editor.dispatch(buildFlipCommand("part_u1"));
		assert.deepEqual(
			{
				side: editor.state.ir.parts[0].placement.side,
				canUndo: editor.canUndo,
			},
			{ side: "B", canUndo: true },
		);

		editor.undo();
		assert.equal(editor.state.ir.parts[0].placement.side, "F");
	});
});
