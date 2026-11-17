import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createProjectFiles,
	sanitizeProjectName,
} from "../../backend/src/engine/kicad-project-template.js";

const sanitizeCase = (name, input, expected) => ({ name, input, expected });
const rejectCase = (name, input) => ({
	name: `rejects ${name}`,
	input,
	expected: null,
});

const SANITIZE_CASES = [
	sanitizeCase("trims whitespace", "  my_project  ", "my_project"),
	sanitizeCase("converts spaces to underscore", "my project", "my_project"),
	sanitizeCase(
		"collapses multiple spaces",
		"my   cool   board",
		"my_cool_board",
	),
	sanitizeCase(
		"replaces slashes with underscore",
		"my/sub/project",
		"my_sub_project",
	),
	sanitizeCase(
		"replaces backslashes with underscore",
		"my\\dir\\project",
		"my_dir_project",
	),
	sanitizeCase("handles ../ traversal", "../my_project", "_my_project"),
	sanitizeCase("handles bare ../", "../", "_"),
	sanitizeCase("strips leading dots", "...my-board", "my-board"),
	sanitizeCase("truncates 80 chars to 64", "a".repeat(80), "a".repeat(64)),
	sanitizeCase("allows non-reserved starting with CON", "console", "console"),
	sanitizeCase(
		"allows non-reserved starting with COM",
		"com3board",
		"com3board",
	),
];

const REJECTED_BASE = [
	{ name: "rejects empty string", input: "", expected: null },
	{ name: "rejects whitespace only", input: "    ", expected: null },
	{ name: "rejects only dots", input: "....", expected: null },
	{ name: "rejects non-string input", input: 12345, expected: null },
	{ name: "rejects null input", input: null, expected: null },
];

const RESERVED_CASES = [
	rejectCase("reserved CON", "CON"),
	rejectCase("reserved con lowercase", "con"),
	rejectCase("reserved com3", "com3"),
	rejectCase("reserved COM3 uppercase", "COM3"),
	rejectCase("reserved AUX", "aux"),
	rejectCase("reserved NUL", "NUL"),
	rejectCase("reserved PRN", "prn"),
	rejectCase("reserved LPT1", "Lpt1"),
];

describe("sanitizeProjectName", () => {
	const cases = [...SANITIZE_CASES, ...REJECTED_BASE, ...RESERVED_CASES];
	for (const { name, input, expected } of cases) {
		test(`handles ${name}`, () => {
			assert.equal(sanitizeProjectName(input), expected);
		});
	}
});

const INVALID_PROJECT_CASES = [
	["empty name", ""],
	["reserved name CON", "CON"],
	["reserved name com3", "com3"],
	["only whitespace", "   "],
	["only dots", "..."],
	["non-string", null],
];

describe("createProjectFiles validation", () => {
	for (const [name, input] of INVALID_PROJECT_CASES) {
		test(`rejects ${name}`, () => {
			const res = createProjectFiles(input);
			assert.deepEqual(res, {
				ok: false,
				error: "Invalid project name",
			});
		});
	}
});

function createFixture(name, options) {
	const res = createProjectFiles(name, options);
	assert.equal(res.ok, true);
	return res;
}

function buildExpectedPro(base) {
	return {
		meta: { filename: `${base}.kicad_pro`, version: 1 },
		board: {},
		schematic: {},
		libraries: {
			pinned_footprint_libs: [],
			pinned_symbol_libs: [],
		},
		sheets: [],
		text_variables: {},
	};
}

function assertProFile(content, base) {
	assert.ok(content.endsWith("\n"));
	assert.deepEqual(JSON.parse(content), buildExpectedPro(base));
}

describe("createProjectFiles file generation", () => {
	test("creates valid project files with defaults", () => {
		const res = createFixture("My Project");
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
		const res = createFixture("Custom Board", { boardW: 120, boardH: 90 });
		assert.ok(res.files["Custom_Board.kicad_pcb"].includes("(end 120 90)"));
	});
});
