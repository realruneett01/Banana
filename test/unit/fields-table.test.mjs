import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createEditor } from "../../frontend/src/editor/editorModel.js";
import {
	buildRows,
	editsToCommand,
	sortRefs,
} from "../../frontend/src/editor/fieldsTable.js";

const PART_SPECS = [
	["p_r10", "R10", "10k", "R_0805"],
	["p_r1", "R1", "10k", "R_0805"],
	["p_r2", "R2", "10k", "R_0805"],
	[
		"p_c1",
		"C1",
		"100nF",
		"C_0603",
		{ Datasheet: "https://example.com/c1.pdf", tolerance: "5%" },
	],
	["p_c2", "C2", "100nF", "C_0603"],
	["p_u1", "U1", "NE555", "SOIC-8"],
];

function buildTestIr() {
	return {
		schemaVersion: 1,
		name: "fields-test",
		parts: PART_SPECS.map(([id, ref, value, footprint, props]) => ({
			id,
			ref,
			value,
			footprint,
			symbol: "Device:R",
			props: props ?? {},
		})),
		nets: [],
	};
}

function verifyBatch(cmd, expectedIds) {
	assert.equal(cmd?.type, "batch");
	const actualIds = (cmd?.commands ?? []).map((c) => c.partId);
	assert.deepEqual(actualIds, expectedIds);
}

function verifyGroupRow(row, expectedQty, expectedRefs) {
	assert.equal(row?.qty, expectedQty);
	assert.deepEqual(row?.refs, expectedRefs);
}

function verifyPartValues(parts, refs, expectedValue) {
	for (const ref of refs) {
		const part = parts.find((p) => p.ref === ref);
		assert.equal(part?.value, expectedValue);
	}
}

describe("natural ref sort", () => {
	test("sortRefs orders alphanumeric references naturally (R2 before R10)", () => {
		const raw = ["R10", "R2", "R1", "C2", "C1", "R20", "U1"];
		assert.deepEqual(sortRefs(raw), [
			"C1",
			"C2",
			"R1",
			"R2",
			"R10",
			"R20",
			"U1",
		]);
	});

	test("sortRefs handles empty or non-array input", () => {
		assert.deepEqual(sortRefs([]), []);
		assert.deepEqual(sortRefs(null), []);
	});

	test("buildRows sorts rows in natural order by first reference", () => {
		const rows = buildRows(buildTestIr(), { groupBy: [] });
		assert.deepEqual(
			rows.map((r) => r.refs[0]),
			["C1", "C2", "R1", "R2", "R10", "U1"],
		);
	});
});

describe("grouping and quantities", () => {
	test("groups symbols by Value and Footprint with correct quantities", () => {
		const rows = buildRows(buildTestIr(), {
			groupBy: ["value", "footprint"],
		});
		assert.equal(rows.length, 3);
		verifyGroupRow(
			rows.find((r) => r.value === "10k"),
			3,
			["R1", "R2", "R10"],
		);
		verifyGroupRow(
			rows.find((r) => r.value === "100nF"),
			2,
			["C1", "C2"],
		);
	});

	test("ungrouped rows produce individual rows with qty = 1", () => {
		const rows = buildRows(buildTestIr(), { groupBy: [] });
		assert.equal(rows.length, 6);
		const allSingles = rows.every((r) => r.qty === 1 && r.refs.length === 1);
		assert.equal(allSingles, true);
	});

	test("default grouping groups by value and footprint when unspecified", () => {
		assert.equal(buildRows(buildTestIr()).length, 3);
	});

	test("extracts datasheet and custom properties correctly", () => {
		const rows = buildRows(buildTestIr(), { groupBy: [] });
		const c1 = rows.find((r) => r.refs[0] === "C1");
		assert.equal(
			`${c1?.datasheet}::${c1?.custom?.tolerance}`,
			"https://example.com/c1.pdf::5%",
		);
	});
});

describe("grouped edit fans out to all refs", () => {
	test("grouped row edit fans out setPartField to every part in the group", () => {
		const ir = buildTestIr();
		const rows = buildRows(ir, { groupBy: ["value", "footprint"] });
		const resistorRow = rows.find((r) => r.value === "10k");
		const cmd = editsToCommand(ir, [
			{ key: resistorRow?.key, field: "value", value: "22k" },
		]);
		verifyBatch(cmd, ["p_r1", "p_r2", "p_r10"]);
		const allMatch = cmd.commands.every(
			(c) =>
				c.type === "setPartField" && c.field === "value" && c.value === "22k",
		);
		assert.equal(allMatch, true);
	});

	test("grouped edit fans out with explicit refs array", () => {
		const ir = buildTestIr();
		const cmd = editsToCommand(ir, [
			{ refs: ["C1", "C2"], field: "footprint", value: "C_0805" },
		]);
		verifyBatch(cmd, ["p_c1", "p_c2"]);
	});

	test("applying grouped batch command updates IR in editor and undos in one step", () => {
		const ir = buildTestIr();
		const editor = createEditor(ir);
		const testRefs = ["R1", "R2", "R10"];
		const cmd = editsToCommand(ir, [
			{ refs: testRefs, field: "value", value: "47k" },
		]);
		editor.dispatch(cmd);
		verifyPartValues(editor.state.ir.parts, testRefs, "47k");

		editor.undo();
		verifyPartValues(editor.state.ir.parts, testRefs, "10k");
	});
});

const NO_OP_CASES = [
	["unchanged cell value", [{ ref: "R1", field: "value", value: "10k" }]],
	[
		"non-setPartField fields",
		[
			{ ref: "R1", field: "qty", value: 99 },
			{ ref: "R1", field: "customField", value: "xyz" },
		],
	],
];

describe("no-op edits produce no command", () => {
	for (const [desc, edits] of NO_OP_CASES) {
		test(`${desc} produces no command`, () => {
			const cmd = editsToCommand(buildTestIr(), edits);
			assert.equal(cmd?.commands?.length, 0);
		});
	}

	test("part that already matches new value is excluded from batch commands", () => {
		const cmd = editsToCommand(buildTestIr(), [
			{ refs: ["R1", "U1"], field: "value", value: "NE555" },
		]);
		verifyBatch(cmd, ["p_r1"]);
	});
});
