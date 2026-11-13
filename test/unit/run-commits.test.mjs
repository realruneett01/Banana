import assert from "node:assert/strict";
import { test } from "node:test";
import { commitsFromRuns } from "../../frontend/src/components/runCommits.js";

const runsOf = (...ids) => ids.map((commit) => ({ commit }));
const shasOf = (...ids) => ids.map((sha) => ({ sha }));

const DEDUPE_CASES = [
	// dedupes duplicate commits keeping first occurrence
	[runsOf("commit-a", "commit-b", "commit-a"), shasOf("commit-a", "commit-b")],
	// handles all runs sharing a single commit
	[runsOf("commit-x", "commit-x", "commit-x"), shasOf("commit-x")],
];

const ORDER_CASES = [
	// preserves newest first order of distinct runs
	[
		runsOf("c_newest", "c_middle", "c_oldest"),
		shasOf("c_newest", "c_middle", "c_oldest"),
	],
	// keeps earlier occurrence when newer run duplicates older
	[runsOf("c_recent", "c_older", "c_recent"), shasOf("c_recent", "c_older")],
];

const SKIP_CASES = [
	// skips runs missing commit string or having non-string values
	[
		[
			...runsOf("c_valid_1", "", null, undefined, 12345),
			{},
			{ otherField: "test" },
			...runsOf("c_valid_2"),
		],
		shasOf("c_valid_1", "c_valid_2"),
	],
	// handles array containing non-object entries
	[
		[null, undefined, "not-an-object", 42, ...runsOf("valid_sha")],
		shasOf("valid_sha"),
	],
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
	// standard runs produce commit objects with sha property
	runsOf("sha-alpha", "sha-beta", "sha-gamma"),
	// runs using alternative sha field produce commit objects with sha
	shasOf("sha-delta", "sha-epsilon"),
];

const assertCases = (cases) => {
	for (const [runs, expected] of cases) {
		assert.deepEqual(commitsFromRuns(runs), expected);
	}
};

test("commitsFromRuns: dedupes runs by commit", () =>
	assertCases(DEDUPE_CASES));

test("commitsFromRuns: orders newest first", () => assertCases(ORDER_CASES));

test("commitsFromRuns: skips missing commits", () => assertCases(SKIP_CASES));

test("commitsFromRuns: returns empty array for non-array inputs", () => {
	for (const { input } of NON_ARRAY_CASES) {
		assert.deepEqual(commitsFromRuns(input), []);
	}
});

test("commitsFromRuns: every item has sha", () => {
	for (const runs of SHA_VALIDATION_CASES) {
		const items = commitsFromRuns(runs);
		assert.ok(items.length > 0);
		for (const item of items) {
			assert.equal(typeof item.sha, "string");
			assert.ok(item.sha.length > 0);
		}
	}
});
