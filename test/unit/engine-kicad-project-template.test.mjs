import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createProjectFiles,
	sanitizeProjectName,
} from "../../backend/src/engine/kicad-project-template.js";

// [name, input, expected]
const SANITIZE_CASES = [
	["trims whitespace", "  my_project  ", "my_project"],
	["converts spaces to underscore", "my project", "my_project"],
	["collapses multiple spaces", "my   cool   board", "my_cool_board"],
	["replaces slashes with underscore", "my/sub/project", "my_sub_project"],
	[
		"replaces backslashes with underscore",
		"my\\dir\\project",
		"my_dir_project",
	],
	["handles ../ traversal", "../my_project", "_my_project"],
	["handles bare ../", "../", "_"],
	["strips leading dots", "...my-board", "my-board"],
	["truncates 80 chars to 64", "a".repeat(80), "a".repeat(64)],
	["allows non-reserved starting with CON", "console", "console"],
	["allows non-reserved starting with COM", "com3board", "com3board"],
];

// [name, input]: sanitizeProjectName returns null
const REJECTED_NAME_CASES = [
	["rejects empty string", ""],
	["rejects whitespace only", "    "],
	["rejects only dots", "...."],
	["rejects non-string input", 12345],
	["rejects null input", null],
	["rejects reserved CON", "CON"],
	["rejects reserved con lowercase", "con"],
	["rejects reserved com3", "com3"],
	["rejects reserved COM3 uppercase", "COM3"],
	["rejects reserved AUX", "aux"],
	["rejects reserved NUL", "NUL"],
	["rejects reserved PRN", "prn"],
	["rejects reserved LPT1", "Lpt1"],
];

describe("sanitizeProjectName", () => {
	const cases = [
		...SANITIZE_CASES,
		...REJECTED_NAME_CASES.map(([name, input]) => [name, input, null]),
	];
	for (const [name, input, expected] of cases) {
		test(`handles ${name}`, () => {
			assert.equal(sanitizeProjectName(input), expected);
		});
	}
});

// [name, input]
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
