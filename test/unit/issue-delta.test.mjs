import assert from "node:assert/strict";
import { test } from "node:test";
import {
	diffIssues,
	issueKey,
} from "../../frontend/src/components/issueDelta.js";
import { useSimulation } from "../../frontend/src/components/useSimulation.js";

// [name, sameKey, pairs of issues]
const KEY_CASES = [
	[
		"issueKey: ignores issue id in key calculation",
		true,
		[
			[
				{ id: "issue_1", kind: "clearance", itemIds: ["net_a", "net_b"] },
				{ id: "issue_2", kind: "clearance", itemIds: ["net_a", "net_b"] },
			],
			[
				{ kind: "thermal", itemIds: ["part_1"] },
				{ id: "issue_3", kind: "thermal", itemIds: ["part_1"] },
			],
			[
				{ id: "issue_4", code: "short_circuit", itemIds: ["net_x"] },
				{ id: "issue_5", code: "short_circuit", itemIds: ["net_x"] },
			],
		],
	],
	[
		"issueKey: ignores itemIds ordering in key calculation",
		true,
		[
			[
				{ id: "i1", kind: "drc", itemIds: ["part_2", "part_1"] },
				{ id: "i2", kind: "drc", itemIds: ["part_1", "part_2"] },
			],
			[
				{ id: "i3", kind: "erc", itemIds: ["z", "a", "m"] },
				{ id: "i4", kind: "erc", itemIds: ["a", "m", "z"] },
			],
		],
	],
	[
		"issueKey: produces distinct keys for different kind, code, or itemIds",
		false,
		[
			[
				{ kind: "clearance", itemIds: ["net_1"] },
				{ kind: "thermal", itemIds: ["net_1"] },
			],
			[
				{ kind: "clearance", itemIds: ["net_1"] },
				{ kind: "clearance", itemIds: ["net_2"] },
			],
			[
				{ kind: "clearance", itemIds: [] },
				{ kind: "clearance", itemIds: ["net_1"] },
			],
		],
	],
];

// [before, after, fixed ids, stillOpen ids, added ids]
const CLASSIFICATION_CASES = [
	[
		[
			{ id: "b1", kind: "clearance", itemIds: ["n1", "n2"] },
			{ id: "b2", kind: "thermal", itemIds: ["p1"] },
		],
		[
			{ id: "a1", kind: "clearance", itemIds: ["n2", "n1"] },
			{ id: "a2", kind: "overvoltage", itemIds: ["p2"] },
		],
		["b2"],
		["a1"],
		["a2"],
	],
	[[{ id: "b1", kind: "erc", itemIds: ["p1"] }], [], ["b1"], [], []],
	[[], [{ id: "a1", kind: "drc", itemIds: ["t1"] }], [], [], ["a1"]],
];

const K1 = { kind: "k1", itemIds: ["i1"] };
const K2 = { kind: "k2", itemIds: ["i2"] };
const K3 = { kind: "k3", itemIds: ["i3"] };

// [test name, [before, after, expected summary][]]
const SUMMARY_CASES = [
	[
		"diffIssues: pluralization for 0, 1, and 2 fixed problems",
		[
			[[K1], [K1], "0 problems fixed, 1 still open, 0 new"],
			[[K1, K2], [K2], "1 problem fixed, 1 still open, 0 new"],
			[[K1, K2, K3], [K3], "2 problems fixed, 1 still open, 0 new"],
		],
	],
	[
		"diffIssues: summary wording across various counts",
		[
			[[], [], "0 problems fixed, 0 still open, 0 new"],
			[
				[
					{ kind: "f1", itemIds: ["1"] },
					{ kind: "s1", itemIds: ["2"] },
					{ kind: "s2", itemIds: ["3"] },
				],
				[
					{ kind: "s1", itemIds: ["2"] },
					{ kind: "s2", itemIds: ["3"] },
					{ kind: "a1", itemIds: ["4"] },
				],
				"1 problem fixed, 2 still open, 1 new",
			],
			[
				[
					{ kind: "f1", itemIds: ["1"] },
					{ kind: "f2", itemIds: ["2"] },
				],
				[
					{ kind: "a1", itemIds: ["3"] },
					{ kind: "a2", itemIds: ["4"] },
				],
				"2 problems fixed, 0 still open, 2 new",
			],
		],
	],
];

const NON_ARRAY_CASES = [
	[null, null],
	[undefined, undefined],
	["invalid", "data"],
	[42, 100],
	[{}, {}],
];

function idsOf(items) {
	return items.map((item) => item.id);
}

for (const [name, sameKey, pairs] of KEY_CASES) {
	test(name, () => {
		for (const [issueA, issueB] of pairs) {
			const same = issueKey(issueA) === issueKey(issueB);
			assert.equal(same, sameKey, `${issueKey(issueA)} vs ${issueKey(issueB)}`);
		}
	});
}

test("diffIssues: classifies issues into fixed, stillOpen, and added", () => {
	for (const [before, after, fixed, open, added] of CLASSIFICATION_CASES) {
		const result = diffIssues(before, after);
		assert.deepEqual(idsOf(result.fixed), fixed);
		assert.deepEqual(idsOf(result.stillOpen), open);
		assert.deepEqual(idsOf(result.added), added);
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

for (const [name, cases] of SUMMARY_CASES) {
	test(name, () => {
		for (const [before, after, expected] of cases) {
			const result = diffIssues(before, after);
			assert.equal(result.summary, expected);
		}
	});
}

test("diffIssues: handles non-array inputs safely", () => {
	const emptyResult = {
		fixed: [],
		stillOpen: [],
		added: [],
		summary: "0 problems fixed, 0 still open, 0 new",
	};
	for (const [before, after] of NON_ARRAY_CASES) {
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
