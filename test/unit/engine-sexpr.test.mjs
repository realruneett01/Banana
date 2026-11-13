import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import { parse, serialize, sym, TAB } from "../../backend/src/engine/sexpr.js";

const NUMBER_CASES = [
	{ input: 1, expected: "1" },
	{ input: 1.5, expected: "1.5" },
	{ input: 0.1 + 0.2, expected: "0.3" },
	{ input: -0, expected: "0" },
	{ input: 0, expected: "0" },
	{ input: 20250114, expected: "20250114" },
	{ input: 1.1234567, expected: "1.123457" },
	{ input: 2.5, expected: "2.5" },
];

const ESCAPE_CASES = [
	{ input: "plain", expected: '"plain"' },
	{ input: "back\\slash", expected: '"back\\\\slash"' },
	{ input: 'with "quotes"', expected: '"with \\"quotes\\""' },
	{ input: "line1\nline2", expected: '"line1\\nline2"' },
	{ input: "line1\r\nline2", expected: '"line1\\r\\nline2"' },
];

const ERROR_CASES = [
	{ input: "(foo))", pattern: /offset 5/ },
	{ input: "(foo (bar)", pattern: /offset 0/ },
	{ input: '(foo "unterminated)', pattern: /offset 5/ },
];

describe("sym", () => {
	test("returns symbol object", () => {
		assert.deepEqual(sym("kicad_sch"), { sym: "kicad_sch" });
		assert.deepEqual(sym("at"), { sym: "at" });
		assert.deepEqual(sym("uuid"), { sym: "uuid" });
	});
});

describe("serialize number formatting", () => {
	test("formats numbers correctly", () => {
		for (const { input, expected } of NUMBER_CASES) {
			assert.equal(serialize(input), expected);
		}
	});

	test("throws on non-finite numbers", () => {
		const invalid = [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		];
		for (const val of invalid) {
			assert.throws(() => serialize(val), TypeError);
		}
	});
});

describe("serialize string escaping", () => {
	test("escapes special characters", () => {
		for (const { input, expected } of ESCAPE_CASES) {
			assert.equal(serialize(input), expected);
		}
	});
});

describe("serialize booleans and symbols", () => {
	test("formats booleans as yes or no", () => {
		assert.equal(serialize(true), "yes");
		assert.equal(serialize(false), "no");
	});

	test("formats symbols bare unquoted", () => {
		assert.equal(serialize(sym("kicad_sch")), "kicad_sch");
		assert.equal(serialize(sym("at")), "at");
	});
});

describe("serialize layout", () => {
	test("prints atom-only lists on one line", () => {
		const list = [sym("at"), 10, 20, 90];
		assert.equal(serialize(list), "(at 10 20 90)");
		assert.equal(serialize([]), "()");
	});

	test("prints multi-line layout for kicad_sch tree", () => {
		const tree = [
			sym("kicad_sch"),
			[sym("version"), 20250114],
			[sym("uuid"), "da9eec26-8758-459a-a1d2-45ce8e0b2c67"],
			[sym("lib_symbols")],
		];
		const expected = [
			"(kicad_sch",
			"\t(version 20250114)",
			'\t(uuid "da9eec26-8758-459a-a1d2-45ce8e0b2c67")',
			"\t(lib_symbols)",
			")",
		].join("\n");
		assert.equal(serialize(tree), expected);
	});

	test("supports custom indent option", () => {
		const tree = [sym("kicad_sch"), [sym("version"), 1]];
		assert.equal(
			serialize(tree, { indent: "  " }),
			"(kicad_sch\n  (version 1)\n)",
		);
		assert.equal(TAB, "\t");
	});
});

describe("parse errors", () => {
	test("throws with offset for unbalanced parens and unterminated strings", () => {
		for (const { input, pattern } of ERROR_CASES) {
			assert.throws(() => parse(input), pattern);
		}
	});

	test("an unterminated string anywhere wins over an earlier paren error", () => {
		assert.throws(
			() => parse('(a)) "open'),
			/^Error: Unterminated string starting at offset 5$/,
		);
		const deep = `${"(".repeat(1001)} "open`;
		assert.throws(
			() => parse(deep),
			/Unterminated string starting at offset 1002/,
		);
	});

	test("treats any Unicode whitespace as a separator and keeps escapes", () => {
		assert.deepEqual(parse('(a b "x\\ty\\q")'), [
			{ sym: "a" },
			{ sym: "b" },
			"x\tyq",
		]);
	});

	test("throws TypeError for non-string input", () => {
		assert.throws(() => parse(123), TypeError);
	});
});

describe("roundtrip parse(serialize(x))", () => {
	test("preserves deep equality for nested trees", () => {
		const tree = [
			sym("kicad_sch"),
			[sym("version"), 20250114],
			[sym("uuid"), "abc-123"],
			[
				sym("lib_symbols"),
				[
					sym("symbol"),
					"Connector:TestPoint",
					[sym("pin_numbers"), [sym("hide"), sym("yes")]],
				],
			],
			[sym("sheet_instances"), [sym("path"), "/", [sym("page"), "1"]]],
		];
		const serialized = serialize(tree);
		const parsed = parse(serialized);
		assert.deepEqual(parsed, tree);
	});

	test("preserves empty lists and escaped strings", () => {
		const tree = [sym("test"), "", "line1\nline2", '"quoted"', []];
		assert.deepEqual(parse(serialize(tree)), tree);
	});
});

describe("issue contract integration", () => {
	test("serializes valid issue without error", () => {
		const issueId = newId("issue");
		const partId = newId("part");
		const issue = {
			id: issueId,
			source: "drc",
			severity: "error",
			itemIds: [partId],
			message: "Clearance error",
			commit: "0123456789abcdef0123456789abcdef01234567",
			status: "open",
		};
		const validation = validateIssue(issue);
		assert.equal(validation.ok, true);

		const sexprTree = [
			sym("issue"),
			[sym("id"), issue.id],
			[sym("source"), issue.source],
			[sym("severity"), issue.severity],
			[sym("message"), issue.message],
			[sym("status"), issue.status],
		];
		const roundtrip = parse(serialize(sexprTree));
		assert.deepEqual(roundtrip, sexprTree);
	});
});
