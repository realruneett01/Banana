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

function checkTable(rows, run, assertFn = assert.equal) {
	rows.forEach(([given, expected]) => {
		assertFn(run(given), expected);
	});
}

function makeEditorFixture() {
	const editor = createEditor({
		parts: [
			{
				id: "part_u1",
				ref: "U1",
				placement: { side: "F" },
			},
		],
	});
	return {
		editor,
		firstPart: () => editor.state.ir.parts[0],
	};
}

describe("reference validation logic", () => {
	test("isValidReference accepts letters followed by digits or ?", () => {
		checkTable(
			["R1", "C12", "U?", "D?", "SW100", "LED1", " R1 "].map((ref) => [
				ref,
				true,
			]),
			isValidReference,
		);
	});

	test("isValidReference rejects non-compliant reference formats", () => {
		checkTable(
			["", "   ", "1R", "R", "R1A", "R!", "R?1", null, undefined, 123].map(
				(ref) => [ref, false],
			),
			isValidReference,
		);
	});

	test("isUniqueReference detects duplicates across other parts", () => {
		checkTable(
			[
				["R1", true],
				["R2", false],
				["R2 ", false],
			],
			(ref) => isUniqueReference(ref, ["R2", "R3", "C1", "U1"]),
		);
	});

	test("isUniqueReference allows wildcard unannotated references ending with ?", () => {
		checkTable(
			[
				["R?", true],
				["C?", true],
			],
			(ref) => isUniqueReference(ref, ["R?", "C?"]),
		);
	});

	test("validateReference produces appropriate valid, error and hint states", () => {
		const other = ["R2", "C1"];
		checkTable(
			[
				["R1", { valid: true, error: "", isUnique: true, hint: "" }],
				[
					"R2",
					{
						valid: true,
						error: "",
						isUnique: false,
						hint: "Reference already in use",
					},
				],
			],
			(ref) => {
				const res = validateReference(ref, other);
				return {
					valid: res.valid,
					error: res.error,
					isUnique: res.isUnique,
					hint: res.hint,
				};
			},
			assert.deepEqual,
		);
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
		checkTable(
			[
				["p1", ["R2", "C1"]],
				["p2", ["R1", "C1"]],
				["non-existent", ["R1", "R2", "C1"]],
			],
			(id) => extractOtherRefs(parts, id),
			assert.deepEqual,
		);
	});

	test("handles null, missing, or malformed parts list gracefully", () => {
		checkTable(
			[null, [], [null, { id: "p2" }]].map((input) => [input, []]),
			(input) => extractOtherRefs(input, "p1"),
			assert.deepEqual,
		);
	});
});

describe("command builder functions", () => {
	test("buildFieldEditCommand creates setPartField for valid fields", () => {
		checkTable(
			[
				["ref", "U9"],
				["value", "LM358"],
				["footprint", "Package_SO:SOIC-8"],
			].map(([field, value]) => [
				[field, value],
				{ type: "setPartField", partId: "part_u1", field, value },
			]),
			([field, value]) => buildFieldEditCommand("part_u1", field, value),
			assert.deepEqual,
		);
	});

	test("buildFieldEditCommand returns null for datasheet or unknown fields", () => {
		checkTable(
			[
				["part_u1", "datasheet", "https://example.com"],
				["part_u1", "unknown", "val"],
				["", "ref", "R1"],
				["part_u1", "ref", 123],
			].map((args) => [args, null]),
			([partId, field, val]) => buildFieldEditCommand(partId, field, val),
		);
	});

	test("buildFlipCommand builds valid flipPart command", () => {
		assert.deepEqual(buildFlipCommand("part_u1"), {
			type: "flipPart",
			partId: "part_u1",
		});
		assert.equal(buildFlipCommand(null), null);
	});

	test("getLayerLabel formats PCB side and layer correctly", () => {
		checkTable(
			[
				["F", "Top (F.Cu)"],
				["B", "Bottom (B.Cu)"],
				[undefined, "Top (F.Cu)"],
			],
			getLayerLabel,
		);
	});

	test("getDatasheetValue retrieves datasheet from various schema locations", () => {
		checkTable(
			[
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
			],
			getDatasheetValue,
		);
	});
});

describe("integration with editorModel dispatch and undo/redo", () => {
	test("field edit command executes and un-does cleanly via editorModel", () => {
		const { editor, firstPart } = makeEditorFixture();
		editor.dispatch(buildFieldEditCommand("part_u1", "ref", "U100"));
		assert.deepEqual(
			{ ref: firstPart().ref, canUndo: editor.canUndo },
			{ ref: "U100", canUndo: true },
		);

		editor.undo();
		assert.deepEqual(
			{ ref: firstPart().ref, canRedo: editor.canRedo },
			{ ref: "U1", canRedo: true },
		);

		editor.redo();
		assert.equal(firstPart().ref, "U100");
	});

	test("flipPart command executes and un-does cleanly via editorModel", () => {
		const { editor, firstPart } = makeEditorFixture();
		editor.dispatch(buildFlipCommand("part_u1"));
		assert.deepEqual(
			{
				side: firstPart().placement.side,
				canUndo: editor.canUndo,
			},
			{ side: "B", canUndo: true },
		);

		editor.undo();
		assert.equal(firstPart().placement.side, "F");
	});
});
