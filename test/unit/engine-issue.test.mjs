import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import {
	compareRuns,
	ISSUE_SCHEMA,
	issuesForItem,
	validateIssue,
} from "../../backend/src/engine/issue.js";

const VALID_ISSUE_ID = newId("issue");
const VALID_SIM_ID = newId("sim");
const VALID_PART_ID = newId("part");
const VALID_NET_ID = newId("net");

function makeValidIssue(overrides = {}) {
	return {
		id: VALID_ISSUE_ID,
		source: "drc",
		severity: "error",
		itemIds: [VALID_PART_ID, VALID_NET_ID],
		metric: "clearance",
		measured: 0.12,
		limit: 0.2,
		unit: "mm",
		message: "Clearance violation between track and pad",
		suggestion: "Reroute trace or move component",
		simRunId: VALID_SIM_ID,
		commit: "a5f23c1b89ef",
		status: "open",
		...overrides,
	};
}

function createRunIssue(overrides) {
	return makeValidIssue({
		id: newId("issue"),
		...overrides,
	});
}

function omitKey(base, key) {
	const copy = { ...base };
	delete copy[key];
	return copy;
}

function buildViolationCase([desc, action, field, valOrMatch, match]) {
	const mutate =
		action === "missing"
			? (base) => omitKey(base, field)
			: (base) => ({ ...base, [field]: valOrMatch });
	return {
		desc,
		mutate,
		match: match ?? valOrMatch,
	};
}

describe("issue contract exports", () => {
	test("exports expected schema and functions", () => {
		const expectedTypes = [
			[ISSUE_SCHEMA, "object"],
			[validateIssue, "function"],
			[issuesForItem, "function"],
			[compareRuns, "function"],
		];
		for (const [target, expectedType] of expectedTypes) {
			assert.equal(typeof target, expectedType);
		}
	});
});

describe("validateIssue: valid cases", () => {
	const VALID_CASES = [
		{
			desc: "fully populated valid issue",
			issue: makeValidIssue(),
		},
		{
			desc: "minimal valid issue without optional fields",
			issue: {
				id: newId("issue"),
				source: "erc",
				severity: "warning",
				itemIds: [newId("pin")],
				message: "Floating input pin",
				commit: "0123456789abcdef",
				status: "open",
			},
		},
	];

	for (const { desc, issue } of VALID_CASES) {
		test(`accepts ${desc}`, () => {
			const result = validateIssue(issue);
			assert.deepEqual(result, { ok: true, errors: [] });
		});
	}

	test("accepts all valid enum combinations", () => {
		const combos = ["drc", "erc", "sim"].flatMap((source) =>
			["error", "warning", "info"].flatMap((severity) =>
				["open", "fixed", "wontfix"].map((status) => ({
					source,
					severity,
					status,
				})),
			),
		);
		for (const combo of combos) {
			const res = validateIssue(makeValidIssue(combo));
			assert.equal(res.ok, true);
		}
	});
});

describe("validateIssue: rule violations", () => {
	const VIOLATION_SPECS = [
		["missing id", "missing", "id", "$.id: missing"],
		["non-string id", "set", "id", 12345, "$.id: expected string"],
		[
			"invalid issue id kind",
			"set",
			"id",
			newId("part"),
			"$.id: invalid issue id",
		],
		[
			"malformed issue id uuid",
			"set",
			"id",
			"issue_not-a-valid-uuid",
			"$.id: invalid issue id",
		],
		["missing source", "missing", "source", "$.source: missing"],
		[
			"invalid source enum",
			"set",
			"source",
			"unknown_source",
			"$.source: must be one of drc, erc, sim",
		],
		["missing severity", "missing", "severity", "$.severity: missing"],
		[
			"invalid severity enum",
			"set",
			"severity",
			"critical",
			"$.severity: must be one of error, warning, info",
		],
		["missing itemIds", "missing", "itemIds", "$.itemIds: missing"],
		[
			"non-array itemIds",
			"set",
			"itemIds",
			"part_1",
			"$.itemIds: expected array",
		],
		[
			"empty itemIds array",
			"set",
			"itemIds",
			[],
			"$.itemIds: must contain at least 1 item",
		],
		[
			"invalid item id inside itemIds",
			"set",
			"itemIds",
			[newId("part"), "invalid_id"],
			"$.itemIds[1]: invalid id",
		],
		[
			"non-string item inside itemIds",
			"set",
			"itemIds",
			[999],
			"$.itemIds[0]: expected string",
		],
		["missing message", "missing", "message", "$.message: missing"],
		["non-string message", "set", "message", 404, "$.message: expected string"],
		["missing commit", "missing", "commit", "$.commit: missing"],
		["non-string commit", "set", "commit", 12345, "$.commit: expected string"],
		["missing status", "missing", "status", "$.status: missing"],
		[
			"invalid status enum",
			"set",
			"status",
			"resolved",
			"$.status: must be one of open, fixed, wontfix",
		],
		[
			"invalid optional simRunId kind",
			"set",
			"simRunId",
			newId("part"),
			"$.simRunId: invalid sim id",
		],
		[
			"non-string optional simRunId",
			"set",
			"simRunId",
			false,
			"$.simRunId: expected string",
		],
		[
			"non-string optional metric",
			"set",
			"metric",
			42,
			"$.metric: expected string",
		],
		[
			"non-number optional measured",
			"set",
			"measured",
			"0.12",
			"$.measured: expected number",
		],
		[
			"non-number optional limit",
			"set",
			"limit",
			"0.2",
			"$.limit: expected number",
		],
		["non-string optional unit", "set", "unit", 100, "$.unit: expected string"],
		[
			"non-string optional suggestion",
			"set",
			"suggestion",
			["fix"],
			"$.suggestion: expected string",
		],
		[
			"unexpected extra property",
			"set",
			"extraField",
			"disallowed",
			"$.extraField: unexpected property",
		],
	];

	const RULE_VIOLATIONS = VIOLATION_SPECS.map(buildViolationCase);

	for (const { desc, mutate, match } of RULE_VIOLATIONS) {
		test(`detects error: ${desc}`, () => {
			const invalidIssue = mutate(makeValidIssue());
			const res = validateIssue(invalidIssue);
			assert.equal(res.ok, false);
			assert.equal(
				res.errors.some((err) => err.includes(match)),
				true,
				`Expected error matching "${match}", got: ${JSON.stringify(res.errors)}`,
			);
		});
	}
});

describe("validateIssue: garbage input", () => {
	const GARBAGE_VALUES = [
		null,
		undefined,
		123,
		"string",
		true,
		false,
		[],
		[1, 2, 3],
	];

	for (const val of GARBAGE_VALUES) {
		test(`returns ok: false without throwing for: ${typeof val} (${String(val)})`, () => {
			const res = validateIssue(val);
			assert.equal(res.ok, false);
			assert.equal(Array.isArray(res.errors), true);
			assert.equal(res.errors.length > 0, true);
		});
	}
});

describe("issuesForItem", () => {
	const part1 = newId("part");
	const part2 = newId("part");
	const net1 = newId("net");

	const issueA = makeValidIssue({ id: newId("issue"), itemIds: [part1] });
	const issueB = makeValidIssue({
		id: newId("issue"),
		itemIds: [part1, net1],
	});
	const issueC = makeValidIssue({ id: newId("issue"), itemIds: [part2] });

	test("returns all issues containing the target itemId", () => {
		const matched = issuesForItem([issueA, issueB, issueC], part1);
		assert.equal(matched.length, 2);
		assert.equal(matched.includes(issueA), true);
		assert.equal(matched.includes(issueB), true);
		assert.equal(matched.includes(issueC), false);
	});

	test("returns empty array when item is not in any issue", () => {
		const unreferencedId = newId("part");
		const matched = issuesForItem([issueA, issueB], unreferencedId);
		assert.deepEqual(matched, []);
	});

	test("handles garbage and non-array inputs safely", () => {
		const emptyCases = [
			[null, part1],
			[undefined, part1],
			[123, part1],
			[[issueA], null],
			[[issueA], undefined],
			[[issueA], 123],
		];
		for (const [issues, itemId] of emptyCases) {
			assert.deepEqual(issuesForItem(issues, itemId), []);
		}
		assert.deepEqual(issuesForItem([null, undefined, {}, issueA], part1), [
			issueA,
		]);
	});
});

describe("compareRuns", () => {
	const part1 = newId("part");
	const part2 = newId("part");
	const net1 = newId("net");

	test("categorizes fixed, stillOpen, and new issues by source+metric+sorted itemIds", () => {
		const stillOpenBefore = createRunIssue({
			source: "drc",
			metric: "clearance",
			itemIds: [part1, part2],
			commit: "c111111",
		});
		const stillOpenAfter = createRunIssue({
			source: "drc",
			metric: "clearance",
			itemIds: [part2, part1], // reversed order should still match!
			commit: "c222222",
		});
		const fixedIssue = createRunIssue({
			source: "erc",
			metric: "floating-pin",
			itemIds: [part1],
			commit: "c111111",
		});
		const newIssue = createRunIssue({
			source: "sim",
			metric: "thermal",
			itemIds: [net1],
			commit: "c222222",
		});

		const result = compareRuns(
			[stillOpenBefore, fixedIssue],
			[stillOpenAfter, newIssue],
		);
		assert.deepEqual(result, {
			fixed: [fixedIssue],
			stillOpen: [stillOpenAfter],
			new: [newIssue],
		});
	});

	test("handles matching when metric is omitted", () => {
		const beforeIssue = createRunIssue({
			source: "drc",
			metric: undefined,
			itemIds: [part1],
		});
		const afterIssue = createRunIssue({
			source: "drc",
			metric: undefined,
			itemIds: [part1],
		});

		const result = compareRuns([beforeIssue], [afterIssue]);
		assert.deepEqual(result, {
			fixed: [],
			stillOpen: [afterIssue],
			new: [],
		});
	});

	test("distinguishes issues with different sources or metrics", () => {
		const issue1 = createRunIssue({
			source: "drc",
			metric: "clearance",
			itemIds: [part1],
		});
		const issue2 = createRunIssue({
			source: "erc",
			metric: "clearance",
			itemIds: [part1],
		});

		const result = compareRuns([issue1], [issue2]);
		assert.deepEqual(result, {
			fixed: [issue1],
			stillOpen: [],
			new: [issue2],
		});
	});

	test("handles empty and garbage runs safely without throwing", () => {
		const emptyResult = { fixed: [], stillOpen: [], new: [] };
		const emptyCases = [
			[[], []],
			[null, null],
			[undefined, undefined],
			["garbage", 456],
			[
				[null, undefined],
				[123, "abc"],
			],
		];
		for (const [before, after] of emptyCases) {
			assert.deepEqual(compareRuns(before, after), emptyResult);
		}
	});
});
