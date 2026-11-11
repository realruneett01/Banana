import assert from "node:assert/strict";
import { test } from "node:test";
import { commitsFromRuns } from "../../frontend/src/components/runCommits.js";

const DEDUPE_CASES = [
	{
		name: "dedupes duplicate commits keeping first occurrence",
		runs: [
			{ commit: "commit-a" },
			{ commit: "commit-b" },
			{ commit: "commit-a" },
		],
		expected: [{ sha: "commit-a" }, { sha: "commit-b" }],
	},
	{
		name: "handles all runs sharing a single commit",
		runs: [
			{ commit: "commit-x" },
			{ commit: "commit-x" },
			{ commit: "commit-x" },
		],
		expected: [{ sha: "commit-x" }],
	},
];

const ORDER_CASES = [
	{
		name: "preserves newest first order of distinct runs",
		runs: [
			{ commit: "c_newest" },
			{ commit: "c_middle" },
			{ commit: "c_oldest" },
		],
		expected: [{ sha: "c_newest" }, { sha: "c_middle" }, { sha: "c_oldest" }],
	},
	{
		name: "keeps earlier occurrence when newer run duplicates older",
		runs: [
			{ commit: "c_recent" },
			{ commit: "c_older" },
			{ commit: "c_recent" },
		],
		expected: [{ sha: "c_recent" }, { sha: "c_older" }],
	},
];

const SKIP_CASES = [
	{
		name: "skips runs missing commit string or having non-string values",
		runs: [
			{ commit: "c_valid_1" },
			{ commit: "" },
			{ commit: null },
			{ commit: undefined },
			{ commit: 12345 },
			{},
			{ otherField: "test" },
			{ commit: "c_valid_2" },
		],
		expected: [{ sha: "c_valid_1" }, { sha: "c_valid_2" }],
	},
	{
		name: "handles array containing non-object entries",
		runs: [null, undefined, "not-an-object", 42, { commit: "valid_sha" }],
		expected: [{ sha: "valid_sha" }],
	},
];

const NON_ARRAY_CASES = [
	{ name: "null", input: null },
	{ name: "undefined", input: undefined },
	{ name: "plain object", input: { commit: "123" } },
	{ name: "string", input: "c1,c2" },
	{ name: "number", input: 42 },
	{ name: "boolean", input: true },
];

const SHA_VALIDATION_CASES = [
	{
		name: "standard runs produce commit objects with sha property",
		runs: [
			{ commit: "sha-alpha" },
			{ commit: "sha-beta" },
			{ commit: "sha-gamma" },
		],
	},
	{
		name: "runs using alternative sha field produce commit objects with sha",
		runs: [{ sha: "sha-delta" }, { sha: "sha-epsilon" }],
	},
];

test("commitsFromRuns: dedupes runs by commit", () => {
	for (const { runs, expected } of DEDUPE_CASES) {
		assert.deepEqual(commitsFromRuns(runs), expected);
	}
});

test("commitsFromRuns: orders newest first", () => {
	for (const { runs, expected } of ORDER_CASES) {
		assert.deepEqual(commitsFromRuns(runs), expected);
	}
});

test("commitsFromRuns: skips missing commits", () => {
	for (const { runs, expected } of SKIP_CASES) {
		assert.deepEqual(commitsFromRuns(runs), expected);
	}
});

test("commitsFromRuns: returns empty array for non-array inputs", () => {
	for (const { input } of NON_ARRAY_CASES) {
		assert.deepEqual(commitsFromRuns(input), []);
	}
});

test("commitsFromRuns: every item has sha", () => {
	for (const { runs } of SHA_VALIDATION_CASES) {
		const items = commitsFromRuns(runs);
		assert.ok(items.length > 0);
		for (const item of items) {
			assert.equal(typeof item.sha, "string");
			assert.ok(item.sha.length > 0);
		}
	}
});
