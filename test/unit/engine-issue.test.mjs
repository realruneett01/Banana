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

describe("issue contract exports", () => {
	test("exports expected schema and functions", () => {
		assert.equal(typeof ISSUE_SCHEMA, "object");
		assert.equal(typeof validateIssue, "function");
		assert.equal(typeof issuesForItem, "function");
		assert.equal(typeof compareRuns, "function");
	});
});

describe("validateIssue: valid cases", () => {
	test("accepts fully populated valid issue", () => {
		const issue = makeValidIssue();
		const result = validateIssue(issue);
		assert.equal(result.ok, true);
		assert.deepEqual(result.errors, []);
	});

	test("accepts minimal valid issue without optional fields", () => {
		const issue = {
			id: newId("issue"),
			source: "erc",
			severity: "warning",
			itemIds: [newId("pin")],
			message: "Floating input pin",
			commit: "0123456789abcdef",
			status: "open",
		};
		const result = validateIssue(issue);
		assert.equal(result.ok, true);
		assert.deepEqual(result.errors, []);
	});

	test("accepts all valid enum combinations", () => {
		const sources = ["drc", "erc", "sim"];
		const severities = ["error", "warning", "info"];
		const statuses = ["open", "fixed", "wontfix"];

		for (const source of sources) {
			for (const severity of severities) {
				for (const status of statuses) {
					const issue = makeValidIssue({ source, severity, status });
					const res = validateIssue(issue);
					assert.equal(res.ok, true);
				}
			}
		}
	});
});

describe("validateIssue: rule violations", () => {
	const RULE_VIOLATIONS = [
		{
			desc: "missing id",
			mutate: (base) => {
				const { id, ...rest } = base;
				return rest;
			},
			match: "$.id: missing",
		},
		{
			desc: "non-string id",
			mutate: (base) => ({ ...base, id: 12345 }),
			match: "$.id: expected string",
		},
		{
			desc: "invalid issue id kind",
			mutate: (base) => ({ ...base, id: newId("part") }),
			match: "$.id: invalid issue id",
		},
		{
			desc: "malformed issue id uuid",
			mutate: (base) => ({ ...base, id: "issue_not-a-valid-uuid" }),
			match: "$.id: invalid issue id",
		},
		{
			desc: "missing source",
			mutate: (base) => {
				const { source, ...rest } = base;
				return rest;
			},
			match: "$.source: missing",
		},
		{
			desc: "invalid source enum",
			mutate: (base) => ({ ...base, source: "unknown_source" }),
			match: "$.source: must be one of drc, erc, sim",
		},
		{
			desc: "missing severity",
			mutate: (base) => {
				const { severity, ...rest } = base;
				return rest;
			},
			match: "$.severity: missing",
		},
		{
			desc: "invalid severity enum",
			mutate: (base) => ({ ...base, severity: "critical" }),
			match: "$.severity: must be one of error, warning, info",
		},
		{
			desc: "missing itemIds",
			mutate: (base) => {
				const { itemIds, ...rest } = base;
				return rest;
			},
			match: "$.itemIds: missing",
		},
		{
			desc: "non-array itemIds",
			mutate: (base) => ({ ...base, itemIds: "part_1" }),
			match: "$.itemIds: expected array",
		},
		{
			desc: "empty itemIds array",
			mutate: (base) => ({ ...base, itemIds: [] }),
			match: "$.itemIds: must contain at least 1 item",
		},
		{
			desc: "invalid item id inside itemIds",
			mutate: (base) => ({ ...base, itemIds: [newId("part"), "invalid_id"] }),
			match: "$.itemIds[1]: invalid id",
		},
		{
			desc: "non-string item inside itemIds",
			mutate: (base) => ({ ...base, itemIds: [999] }),
			match: "$.itemIds[0]: expected string",
		},
		{
			desc: "missing message",
			mutate: (base) => {
				const { message, ...rest } = base;
				return rest;
			},
			match: "$.message: missing",
		},
		{
			desc: "non-string message",
			mutate: (base) => ({ ...base, message: 404 }),
			match: "$.message: expected string",
		},
		{
			desc: "missing commit",
			mutate: (base) => {
				const { commit, ...rest } = base;
				return rest;
			},
			match: "$.commit: missing",
		},
		{
			desc: "non-string commit",
			mutate: (base) => ({ ...base, commit: 12345 }),
			match: "$.commit: expected string",
		},
		{
			desc: "missing status",
			mutate: (base) => {
				const { status, ...rest } = base;
				return rest;
			},
			match: "$.status: missing",
		},
		{
			desc: "invalid status enum",
			mutate: (base) => ({ ...base, status: "resolved" }),
			match: "$.status: must be one of open, fixed, wontfix",
		},
		{
			desc: "invalid optional simRunId kind",
			mutate: (base) => ({ ...base, simRunId: newId("part") }),
			match: "$.simRunId: invalid sim id",
		},
		{
			desc: "non-string optional simRunId",
			mutate: (base) => ({ ...base, simRunId: false }),
			match: "$.simRunId: expected string",
		},
		{
			desc: "non-string optional metric",
			mutate: (base) => ({ ...base, metric: 42 }),
			match: "$.metric: expected string",
		},
		{
			desc: "non-number optional measured",
			mutate: (base) => ({ ...base, measured: "0.12" }),
			match: "$.measured: expected number",
		},
		{
			desc: "non-number optional limit",
			mutate: (base) => ({ ...base, limit: "0.2" }),
			match: "$.limit: expected number",
		},
		{
			desc: "non-string optional unit",
			mutate: (base) => ({ ...base, unit: 100 }),
			match: "$.unit: expected string",
		},
		{
			desc: "non-string optional suggestion",
			mutate: (base) => ({ ...base, suggestion: ["fix"] }),
			match: "$.suggestion: expected string",
		},
		{
			desc: "unexpected extra property",
			mutate: (base) => ({ ...base, extraField: "disallowed" }),
			match: "$.extraField: unexpected property",
		},
	];

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
		assert.deepEqual(issuesForItem(null, part1), []);
		assert.deepEqual(issuesForItem(undefined, part1), []);
		assert.deepEqual(issuesForItem(123, part1), []);
		assert.deepEqual(issuesForItem([issueA], null), []);
		assert.deepEqual(issuesForItem([issueA], undefined), []);
		assert.deepEqual(issuesForItem([issueA], 123), []);
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
		const stillOpenBefore = makeValidIssue({
			id: newId("issue"),
			source: "drc",
			metric: "clearance",
			itemIds: [part1, part2],
			commit: "c111111",
		});
		const stillOpenAfter = makeValidIssue({
			id: newId("issue"),
			source: "drc",
			metric: "clearance",
			itemIds: [part2, part1], // reversed order should still match!
			commit: "c222222",
		});

		const fixedIssue = makeValidIssue({
			id: newId("issue"),
			source: "erc",
			metric: "floating-pin",
			itemIds: [part1],
			commit: "c111111",
		});

		const newIssue = makeValidIssue({
			id: newId("issue"),
			source: "sim",
			metric: "thermal",
			itemIds: [net1],
			commit: "c222222",
		});

		const before = [stillOpenBefore, fixedIssue];
		const after = [stillOpenAfter, newIssue];

		const result = compareRuns(before, after);

		assert.equal(result.fixed.length, 1);
		assert.equal(result.fixed[0], fixedIssue);

		assert.equal(result.stillOpen.length, 1);
		assert.equal(result.stillOpen[0], stillOpenAfter);

		assert.equal(result.new.length, 1);
		assert.equal(result.new[0], newIssue);
	});

	test("handles matching when metric is omitted", () => {
		const beforeIssue = makeValidIssue({
			id: newId("issue"),
			source: "drc",
			metric: undefined,
			itemIds: [part1],
		});
		const afterIssue = makeValidIssue({
			id: newId("issue"),
			source: "drc",
			metric: undefined,
			itemIds: [part1],
		});

		const result = compareRuns([beforeIssue], [afterIssue]);
		assert.equal(result.fixed.length, 0);
		assert.equal(result.stillOpen.length, 1);
		assert.equal(result.new.length, 0);
	});

	test("distinguishes issues with different sources or metrics", () => {
		const issue1 = makeValidIssue({
			id: newId("issue"),
			source: "drc",
			metric: "clearance",
			itemIds: [part1],
		});
		const issue2 = makeValidIssue({
			id: newId("issue"),
			source: "erc",
			metric: "clearance",
			itemIds: [part1],
		});

		const result = compareRuns([issue1], [issue2]);
		assert.equal(result.fixed.length, 1);
		assert.equal(result.fixed[0], issue1);
		assert.equal(result.stillOpen.length, 0);
		assert.equal(result.new.length, 1);
		assert.equal(result.new[0], issue2);
	});

	test("handles empty and garbage runs safely without throwing", () => {
		assert.deepEqual(compareRuns([], []), {
			fixed: [],
			stillOpen: [],
			new: [],
		});
		assert.deepEqual(compareRuns(null, null), {
			fixed: [],
			stillOpen: [],
			new: [],
		});
		assert.deepEqual(compareRuns(undefined, undefined), {
			fixed: [],
			stillOpen: [],
			new: [],
		});
		assert.deepEqual(compareRuns("garbage", 456), {
			fixed: [],
			stillOpen: [],
			new: [],
		});
		assert.deepEqual(compareRuns([null, undefined], [123, "abc"]), {
			fixed: [],
			stillOpen: [],
			new: [],
		});
	});
});
