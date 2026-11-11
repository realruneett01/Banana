import assert from "node:assert/strict";
import { test } from "node:test";
import {
	diffIssues,
	issueKey,
} from "../../frontend/src/components/issueDelta.js";
import { useSimulation } from "../../frontend/src/components/useSimulation.js";

const KEY_ID_CASES = [
	{
		issueA: { id: "issue_1", kind: "clearance", itemIds: ["net_a", "net_b"] },
		issueB: { id: "issue_2", kind: "clearance", itemIds: ["net_a", "net_b"] },
	},
	{
		issueA: { kind: "thermal", itemIds: ["part_1"] },
		issueB: { id: "issue_3", kind: "thermal", itemIds: ["part_1"] },
	},
	{
		issueA: { id: "issue_4", code: "short_circuit", itemIds: ["net_x"] },
		issueB: { id: "issue_5", code: "short_circuit", itemIds: ["net_x"] },
	},
];

const KEY_ORDER_CASES = [
	{
		issueA: { id: "i1", kind: "drc", itemIds: ["part_2", "part_1"] },
		issueB: { id: "i2", kind: "drc", itemIds: ["part_1", "part_2"] },
	},
	{
		issueA: { id: "i3", kind: "erc", itemIds: ["z", "a", "m"] },
		issueB: { id: "i4", kind: "erc", itemIds: ["a", "m", "z"] },
	},
];

const KEY_DISTINCTION_CASES = [
	{
		issueA: { kind: "clearance", itemIds: ["net_1"] },
		issueB: { kind: "thermal", itemIds: ["net_1"] },
	},
	{
		issueA: { kind: "clearance", itemIds: ["net_1"] },
		issueB: { kind: "clearance", itemIds: ["net_2"] },
	},
	{
		issueA: { kind: "clearance", itemIds: [] },
		issueB: { kind: "clearance", itemIds: ["net_1"] },
	},
];

const CLASSIFICATION_CASES = [
	{
		before: [
			{ id: "b1", kind: "clearance", itemIds: ["n1", "n2"] },
			{ id: "b2", kind: "thermal", itemIds: ["p1"] },
		],
		after: [
			{ id: "a1", kind: "clearance", itemIds: ["n2", "n1"] },
			{ id: "a2", kind: "overvoltage", itemIds: ["p2"] },
		],
		expectedFixedIds: ["b2"],
		expectedStillOpenIds: ["a1"],
		expectedAddedIds: ["a2"],
	},
	{
		before: [{ id: "b1", kind: "erc", itemIds: ["p1"] }],
		after: [],
		expectedFixedIds: ["b1"],
		expectedStillOpenIds: [],
		expectedAddedIds: [],
	},
	{
		before: [],
		after: [{ id: "a1", kind: "drc", itemIds: ["t1"] }],
		expectedFixedIds: [],
		expectedStillOpenIds: [],
		expectedAddedIds: ["a1"],
	},
];

const PLURALIZATION_CASES = [
	{
		fixed: [],
		stillOpen: [{ kind: "k1", itemIds: ["i1"] }],
		added: [],
		expected: "0 problems fixed, 1 still open, 0 new",
	},
	{
		fixed: [{ kind: "k1", itemIds: ["i1"] }],
		stillOpen: [{ kind: "k2", itemIds: ["i2"] }],
		added: [],
		expected: "1 problem fixed, 1 still open, 0 new",
	},
	{
		fixed: [
			{ kind: "k1", itemIds: ["i1"] },
			{ kind: "k2", itemIds: ["i2"] },
		],
		stillOpen: [{ kind: "k3", itemIds: ["i3"] }],
		added: [],
		expected: "2 problems fixed, 1 still open, 0 new",
	},
];

const SUMMARY_COUNT_CASES = [
	{
		before: [],
		after: [],
		expected: "0 problems fixed, 0 still open, 0 new",
	},
	{
		before: [
			{ kind: "f1", itemIds: ["1"] },
			{ kind: "s1", itemIds: ["2"] },
			{ kind: "s2", itemIds: ["3"] },
		],
		after: [
			{ kind: "s1", itemIds: ["2"] },
			{ kind: "s2", itemIds: ["3"] },
			{ kind: "a1", itemIds: ["4"] },
		],
		expected: "1 problem fixed, 2 still open, 1 new",
	},
	{
		before: [
			{ kind: "f1", itemIds: ["1"] },
			{ kind: "f2", itemIds: ["2"] },
		],
		after: [
			{ kind: "a1", itemIds: ["3"] },
			{ kind: "a2", itemIds: ["4"] },
		],
		expected: "2 problems fixed, 0 still open, 2 new",
	},
];

const NON_ARRAY_CASES = [
	{ before: null, after: null },
	{ before: undefined, after: undefined },
	{ before: "invalid", after: "data" },
	{ before: 42, after: 100 },
	{ before: {}, after: {} },
];

function idsOf(items) {
	return items.map((item) => item.id);
}

test("issueKey: ignores issue id in key calculation", () => {
	for (const { issueA, issueB } of KEY_ID_CASES) {
		assert.equal(issueKey(issueA), issueKey(issueB));
	}
});

test("issueKey: ignores itemIds ordering in key calculation", () => {
	for (const { issueA, issueB } of KEY_ORDER_CASES) {
		assert.equal(issueKey(issueA), issueKey(issueB));
	}
});

test("issueKey: produces distinct keys for different kind, code, or itemIds", () => {
	for (const { issueA, issueB } of KEY_DISTINCTION_CASES) {
		assert.notEqual(issueKey(issueA), issueKey(issueB));
	}
});

test("diffIssues: classifies issues into fixed, stillOpen, and added", () => {
	for (const c of CLASSIFICATION_CASES) {
		const result = diffIssues(c.before, c.after);
		assert.deepEqual(idsOf(result.fixed), c.expectedFixedIds);
		assert.deepEqual(idsOf(result.stillOpen), c.expectedStillOpenIds);
		assert.deepEqual(idsOf(result.added), c.expectedAddedIds);
	}
});

test("diffIssues: preserves object references for classified issues", () => {
	const b1 = { id: "b1", kind: "k1", itemIds: ["1"] };
	const b2 = { id: "b2", kind: "k2", itemIds: ["2"] };
	const a2 = { id: "a2", kind: "k2", itemIds: ["2"], note: "updated" };
	const a3 = { id: "a3", kind: "k3", itemIds: ["3"] };

	const result = diffIssues([b1, b2], [a2, a3]);
	assert.equal(result.fixed[0], b1);
	assert.equal(result.stillOpen[0], a2);
	assert.equal(result.added[0], a3);
});

test("diffIssues: pluralization for 0, 1, and 2 fixed problems", () => {
	for (const { fixed, stillOpen, added, expected } of PLURALIZATION_CASES) {
		const before = [...fixed, ...stillOpen];
		const after = [...stillOpen, ...added];
		const result = diffIssues(before, after);
		assert.equal(result.summary, expected);
	}
});

test("diffIssues: summary wording across various counts", () => {
	for (const { before, after, expected } of SUMMARY_COUNT_CASES) {
		const result = diffIssues(before, after);
		assert.equal(result.summary, expected);
	}
});

test("diffIssues: handles non-array inputs safely", () => {
	const emptyResult = {
		fixed: [],
		stillOpen: [],
		added: [],
		summary: "0 problems fixed, 0 still open, 0 new",
	};
	for (const { before, after } of NON_ARRAY_CASES) {
		assert.deepEqual(diffIssues(before, after), emptyResult);
	}
});

test("diffIssues: does not mutate before or after arrays", () => {
	const before = Object.freeze([
		Object.freeze({ id: "b1", kind: "k1", itemIds: Object.freeze(["2", "1"]) }),
	]);
	const after = Object.freeze([
		Object.freeze({ id: "a1", kind: "k1", itemIds: Object.freeze(["1", "2"]) }),
	]);

	const result = diffIssues(before, after);
	assert.equal(result.stillOpen.length, 1);
	assert.equal(before.length, 1);
	assert.equal(after.length, 1);
});

test("diffIssues: does not mutate itemIds in issue objects", () => {
	const itemIdsA = ["z", "a", "m"];
	const itemIdsB = ["m", "z", "a"];
	const issueA = { id: "i1", kind: "k1", itemIds: itemIdsA };
	const issueB = { id: "i2", kind: "k1", itemIds: itemIdsB };

	diffIssues([issueA], [issueB]);
	assert.deepEqual(itemIdsA, ["z", "a", "m"]);
	assert.deepEqual(itemIdsB, ["m", "z", "a"]);
});

test("useSimulation: exports hook function", () => {
	assert.equal(typeof useSimulation, "function");
});
