import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createProjectFiles,
	sanitizeProjectName,
} from "../../backend/src/engine/kicad-project-template.js";

const SANITIZE_CASES = [
	{ name: "trims whitespace", input: "  my_project  ", expected: "my_project" },
	{
		name: "converts spaces to underscore",
		input: "my project",
		expected: "my_project",
	},
	{
		name: "collapses multiple spaces",
		input: "my   cool   board",
		expected: "my_cool_board",
	},
	{
		name: "replaces slashes with underscore",
		input: "my/sub/project",
		expected: "my_sub_project",
	},
	{
		name: "replaces backslashes with underscore",
		input: "my\\dir\\project",
		expected: "my_dir_project",
	},
	{
		name: "handles ../ traversal",
		input: "../my_project",
		expected: "_my_project",
	},
	{ name: "handles bare ../", input: "../", expected: "_" },
	{
		name: "strips leading dots",
		input: "...my-board",
		expected: "my-board",
	},
	{
		name: "truncates 80 chars to 64",
		input: "a".repeat(80),
		expected: "a".repeat(64),
	},
	{ name: "rejects empty string", input: "", expected: null },
	{ name: "rejects whitespace only", input: "    ", expected: null },
	{ name: "rejects only dots", input: "....", expected: null },
	{ name: "rejects non-string input", input: 12345, expected: null },
	{ name: "rejects null input", input: null, expected: null },
	{ name: "rejects reserved CON", input: "CON", expected: null },
	{ name: "rejects reserved con lowercase", input: "con", expected: null },
	{ name: "rejects reserved com3", input: "com3", expected: null },
	{ name: "rejects reserved COM3 uppercase", input: "COM3", expected: null },
	{ name: "rejects reserved AUX", input: "aux", expected: null },
	{ name: "rejects reserved NUL", input: "NUL", expected: null },
	{ name: "rejects reserved PRN", input: "prn", expected: null },
	{ name: "rejects reserved LPT1", input: "Lpt1", expected: null },
	{
		name: "allows non-reserved starting with CON",
		input: "console",
		expected: "console",
	},
	{
		name: "allows non-reserved starting with COM",
		input: "com3board",
		expected: "com3board",
	},
];

describe("sanitizeProjectName", () => {
	for (const { name, input, expected } of SANITIZE_CASES) {
		test(`handles ${name}`, () => {
			assert.equal(sanitizeProjectName(input), expected);
		});
	}
});

const INVALID_PROJECT_CASES = [
	{ name: "empty name", input: "" },
	{ name: "reserved name CON", input: "CON" },
	{ name: "reserved name com3", input: "com3" },
	{ name: "only whitespace", input: "   " },
	{ name: "only dots", input: "..." },
	{ name: "non-string", input: null },
];

describe("createProjectFiles validation", () => {
	for (const { name, input } of INVALID_PROJECT_CASES) {
		test(`rejects ${name}`, () => {
			const res = createProjectFiles(input);
			assert.deepEqual(res, {
				ok: false,
				error: "Invalid project name",
			});
		});
	}
});

function assertProFile(content, base) {
	assert.ok(content.endsWith("\n"));
	const parsed = JSON.parse(content);
	assert.equal(parsed.meta.filename, `${base}.kicad_pro`);
	assert.equal(parsed.meta.version, 1);
	assert.deepEqual(parsed.board, {});
	assert.deepEqual(parsed.schematic, {});
	assert.deepEqual(parsed.sheets, []);
	assert.deepEqual(parsed.text_variables, {});
	assert.deepEqual(parsed.libraries, {
		pinned_footprint_libs: [],
		pinned_symbol_libs: [],
	});
}

describe("createProjectFiles file generation", () => {
	test("creates valid project files with defaults", () => {
		const res = createProjectFiles("My Project");
		assert.equal(res.ok, true);
		assert.equal(res.base, "My_Project");

		const expectedKeys = [
			"My_Project.kicad_pro",
			"My_Project.kicad_sch",
			"My_Project.kicad_pcb",
		];
		assert.deepEqual(Object.keys(res.files).sort(), expectedKeys.sort());

		assert.ok(res.files["My_Project.kicad_sch"].startsWith("(kicad_sch"));
		assert.ok(res.files["My_Project.kicad_pcb"].startsWith("(kicad_pcb"));
		assertProFile(res.files["My_Project.kicad_pro"], "My_Project");
	});

	test("respects custom board dimensions", () => {
		const res = createProjectFiles("Custom Board", { boardW: 120, boardH: 90 });
		assert.equal(res.ok, true);
		assert.ok(res.files["Custom_Board.kicad_pcb"].includes("(end 120 90)"));
	});
});
