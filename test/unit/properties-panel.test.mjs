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

describe("reference validation logic", () => {
	test("isValidReference accepts letters followed by digits or ?", () => {
		assert.equal(isValidReference("R1"), true);
		assert.equal(isValidReference("C12"), true);
		assert.equal(isValidReference("U?"), true);
		assert.equal(isValidReference("D?"), true);
		assert.equal(isValidReference("SW100"), true);
		assert.equal(isValidReference("LED1"), true);
		assert.equal(isValidReference(" R1 "), true);
	});

	test("isValidReference rejects non-compliant reference formats", () => {
		assert.equal(isValidReference(""), false);
		assert.equal(isValidReference("   "), false);
		assert.equal(isValidReference("1R"), false);
		assert.equal(isValidReference("R"), false);
		assert.equal(isValidReference("R1A"), false);
		assert.equal(isValidReference("R!"), false);
		assert.equal(isValidReference("R?1"), false);
		assert.equal(isValidReference(null), false);
		assert.equal(isValidReference(undefined), false);
		assert.equal(isValidReference(123), false);
	});

	test("isUniqueReference detects duplicates across other parts", () => {
		const other = ["R2", "R3", "C1", "U1"];
		assert.equal(isUniqueReference("R1", other), true);
		assert.equal(isUniqueReference("R2", other), false);
		assert.equal(isUniqueReference("R2 ", other), false);
	});

	test("isUniqueReference allows wildcard unannotated references ending with ?", () => {
		const other = ["R?", "C?"];
		assert.equal(isUniqueReference("R?", other), true);
		assert.equal(isUniqueReference("C?", other), true);
	});

	test("validateReference produces appropriate valid, error and hint states", () => {
		const other = ["R2", "C1"];
		const validUnique = validateReference("R1", other);
		assert.equal(validUnique.valid, true);
		assert.equal(validUnique.error, "");
		assert.equal(validUnique.isUnique, true);
		assert.equal(validUnique.hint, "");

		const validDuplicate = validateReference("R2", other);
		assert.equal(validDuplicate.valid, true);
		assert.equal(validDuplicate.error, "");
		assert.equal(validDuplicate.isUnique, false);
		assert.equal(validDuplicate.hint, "Reference already in use");

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
		assert.deepEqual(extractOtherRefs(parts, "p1"), ["R2", "C1"]);
		assert.deepEqual(extractOtherRefs(parts, "p2"), ["R1", "C1"]);
		assert.deepEqual(extractOtherRefs(parts, "non-existent"), [
			"R1",
			"R2",
			"C1",
		]);
	});

	test("handles null, missing, or malformed parts list gracefully", () => {
		assert.deepEqual(extractOtherRefs(null, "p1"), []);
		assert.deepEqual(extractOtherRefs([], "p1"), []);
		assert.deepEqual(extractOtherRefs([null, { id: "p2" }], "p1"), []);
	});
});

describe("command builder functions", () => {
	test("buildFieldEditCommand creates setPartField for valid fields", () => {
		const cmdRef = buildFieldEditCommand("part_u1", "ref", "U9");
		assert.deepEqual(cmdRef, {
			type: "setPartField",
			partId: "part_u1",
			field: "ref",
			value: "U9",
		});

		const cmdVal = buildFieldEditCommand("part_u1", "value", "LM358");
		assert.deepEqual(cmdVal, {
			type: "setPartField",
			partId: "part_u1",
			field: "value",
			value: "LM358",
		});

		const cmdFp = buildFieldEditCommand(
			"part_u1",
			"footprint",
			"Package_SO:SOIC-8",
		);
		assert.deepEqual(cmdFp, {
			type: "setPartField",
			partId: "part_u1",
			field: "footprint",
			value: "Package_SO:SOIC-8",
		});
	});

	test("buildFieldEditCommand returns null for datasheet or unknown fields", () => {
		assert.equal(
			buildFieldEditCommand("part_u1", "datasheet", "https://example.com"),
			null,
		);
		assert.equal(buildFieldEditCommand("part_u1", "unknown", "val"), null);
		assert.equal(buildFieldEditCommand("", "ref", "R1"), null);
		assert.equal(buildFieldEditCommand("part_u1", "ref", 123), null);
	});

	test("buildFlipCommand builds valid flipPart command", () => {
		assert.deepEqual(buildFlipCommand("part_u1"), {
			type: "flipPart",
			partId: "part_u1",
		});
		assert.equal(buildFlipCommand(null), null);
	});

	test("getLayerLabel formats PCB side and layer correctly", () => {
		assert.equal(getLayerLabel("F"), "Top (F.Cu)");
		assert.equal(getLayerLabel("B"), "Bottom (B.Cu)");
		assert.equal(getLayerLabel(undefined), "Top (F.Cu)");
	});

	test("getDatasheetValue retrieves datasheet from various schema locations", () => {
		assert.equal(
			getDatasheetValue({ datasheet: "https://ds.example.com" }),
			"https://ds.example.com",
		);
		assert.equal(
			getDatasheetValue({ props: { Datasheet: "https://kicad-ds.com" } }),
			"https://kicad-ds.com",
		);
		assert.equal(
			getDatasheetValue({ props: { datasheet: "https://lower-ds.com" } }),
			"https://lower-ds.com",
		);
		assert.equal(getDatasheetValue({}), "");
		assert.equal(getDatasheetValue(null), "");
	});
});

describe("integration with editorModel dispatch and undo/redo", () => {
	function makeDoc() {
		return {
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
		};
	}

	test("field edit command executes and un-does cleanly via editorModel", () => {
		const editor = createEditor(makeDoc());
		const cmd = buildFieldEditCommand("part_u1", "ref", "U100");
		editor.dispatch(cmd);

		assert.equal(editor.state.ir.parts[0].ref, "U100");
		assert.equal(editor.canUndo, true);

		editor.undo();
		assert.equal(editor.state.ir.parts[0].ref, "U1");
		assert.equal(editor.canRedo, true);

		editor.redo();
		assert.equal(editor.state.ir.parts[0].ref, "U100");
	});

	test("flipPart command executes and un-does cleanly via editorModel", () => {
		const editor = createEditor(makeDoc());
		const flip = buildFlipCommand("part_u1");
		editor.dispatch(flip);

		assert.equal(editor.state.ir.parts[0].placement.side, "B");
		assert.equal(editor.canUndo, true);

		editor.undo();
		assert.equal(editor.state.ir.parts[0].placement.side, "F");
	});
});
