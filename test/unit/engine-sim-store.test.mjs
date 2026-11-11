import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { createSimStore } from "../../backend/src/engine/sim/sim-store.js";

function makeRun(overrides = {}) {
	const runId = overrides.id || newId("sim");
	return {
		id: runId,
		commit: "a1b2c3d4e5f6",
		envId: newId("env"),
		kind: "thermal",
		status: "done",
		startedAt: "2026-01-01T10:00:00.000Z",
		finishedAt: "2026-01-01T10:01:00.000Z",
		results: [
			{
				itemId: newId("part"),
				metric: "temp",
				value: 45.2,
				unit: "C",
			},
		],
		...overrides,
	};
}

function makeIssue(overrides = {}) {
	return {
		id: newId("issue"),
		source: "sim",
		severity: "warning",
		itemIds: [newId("part")],
		metric: "temp",
		measured: 85,
		limit: 70,
		unit: "C",
		message: "temperature high",
		commit: "a1b2c3d4e5f6",
		status: "open",
		...overrides,
	};
}

function setupListFixture(store) {
	const env1 = newId("env");
	const env2 = newId("env");
	const specs = [
		["2026-01-01T10:00:00.000Z", "1111111", env1, "thermal"],
		["2026-01-01T12:00:00.000Z", "2222222", env1, "thermal"],
		["2026-01-01T14:00:00.000Z", "2222222", env2, "ir-drop"],
	];
	const [run1, run2, run3] = specs.map(([startedAt, commit, envId, kind]) => {
		const run = makeRun({ startedAt, commit, envId, kind });
		store.saveRun(run, []);
		return run;
	});
	return { run1, run2, run3, env1 };
}

function setupCompareFixture(store) {
	const envId = newId("env");
	const [partA, partB, partC] = [newId("part"), newId("part"), newId("part")];
	const before = "1111111";
	const after = "2222222";

	const [issueA, issueB, issueB2, issueC] = [
		["temp", partA, before],
		["drop", partB, before],
		["drop", partB, after],
		["current", partC, after],
	].map(([metric, itemId, commit]) =>
		makeIssue({ metric, itemIds: [itemId], commit }),
	);

	const [runBefore, runAfter] = [
		{ commit: before, startedAt: "2026-01-01T10:00:00.000Z" },
		{ commit: after, startedAt: "2026-01-01T11:00:00.000Z" },
	].map((opts) => makeRun({ ...opts, envId, kind: "thermal" }));

	store.saveRun(runBefore, [issueA, issueB]);
	store.saveRun(runAfter, [issueB2, issueC]);
	return { before, after, envId, issueA, issueB2, issueC };
}

describe("engine-sim-store", () => {
	test("save and get round-trip", () => {
		const store = createSimStore();
		const run = makeRun();
		const issues = [1, 2].map(() =>
			makeIssue({ simRunId: run.id, commit: run.commit }),
		);

		store.saveRun(run, issues);
		const found = store.getRun(run.id);

		assert.ok(found);
		assert.deepEqual(found.run, run);
		assert.deepEqual(found.issues, issues);
		assert.equal(store.getRun("sim_nonexistent"), null);
		store.close();
	});

	test("invalid run throws", () => {
		const store = createSimStore();
		const cases = [
			[{ id: "not-a-valid-id" }, [makeIssue()]],
			[makeRun(), [{ id: "bad_issue" }]],
		];
		for (const [run, issues] of cases) {
			assert.throws(() => store.saveRun(run, issues), /Validation failed/);
		}
		store.close();
	});

	test("replace on re-save", () => {
		const store = createSimStore();
		const run = makeRun({ status: "running" });
		const issue1 = makeIssue({ simRunId: run.id });

		store.saveRun(run, [issue1]);
		assert.equal(store.getRun(run.id).run.status, "running");
		assert.equal(store.getRun(run.id).issues.length, 1);

		const updatedRun = { ...run, status: "done" };
		const nextIssues = [1, 2].map(() => makeIssue({ simRunId: run.id }));
		store.saveRun(updatedRun, nextIssues);

		const res = store.getRun(run.id);
		assert.equal(res.run.status, "done");
		assert.deepEqual(res.issues, nextIssues);
		store.close();
	});

	test("list filters and ordering", () => {
		const store = createSimStore();
		const { run1, run2, run3, env1 } = setupListFixture(store);

		const cases = [
			{ filter: undefined, expected: [run3.id, run2.id, run1.id] },
			{ filter: { commit: "2222222" }, expected: [run3.id, run2.id] },
			{ filter: { envId: env1 }, expected: [run2.id, run1.id] },
			{ filter: { commit: "2222222", kind: "thermal" }, expected: [run2.id] },
		];
		for (const { filter, expected } of cases) {
			const runs = store.listRuns(filter);
			assert.deepEqual(
				runs.map((r) => r.id),
				expected,
			);
		}
		store.close();
	});

	test("latestRun", () => {
		const store = createSimStore();
		const envId = newId("env");
		const [run1, run2] = [
			"2026-01-01T08:00:00.000Z",
			"2026-01-01T09:00:00.000Z",
		].map((startedAt) => makeRun({ startedAt, envId, kind: "thermal" }));
		const issue = makeIssue({ simRunId: run2.id });

		store.saveRun(run1, []);
		store.saveRun(run2, [issue]);

		const latest = store.latestRun({ envId, kind: "thermal" });
		assert.ok(latest);
		assert.equal(latest.run.id, run2.id);
		assert.deepEqual(latest.issues, [issue]);
		assert.equal(store.latestRun({ commit: "9999999" }), null);
		store.close();
	});

	test("compareCommits returns fixed/stillOpen/new for fixture", () => {
		const store = createSimStore();
		const { before, after, envId, issueA, issueB2, issueC } =
			setupCompareFixture(store);

		const diff = store.compareCommits({
			before,
			after,
			envId,
			kind: "thermal",
		});

		const cases = [
			[diff.fixed, issueA.id],
			[diff.stillOpen, issueB2.id],
			[diff.new, issueC.id],
		];
		for (const [list, id] of cases) {
			assert.equal(list.length, 1);
			assert.equal(list[0].id, id);
		}
		store.close();
	});

	test("missing side throws", () => {
		const store = createSimStore();
		const envId = newId("env");
		const run = makeRun({ commit: "1111111", envId, kind: "thermal" });
		store.saveRun(run, []);

		const commitPairs = [
			{ before: "missing_commit", after: "1111111" },
			{ before: "1111111", after: "missing_commit" },
		];
		for (const { before, after } of commitPairs) {
			assert.throws(
				() =>
					store.compareCommits({
						before,
						after,
						envId,
						kind: "thermal",
					}),
				/no run for missing_commit/,
			);
		}
		store.close();
	});

	test("setIssueStatus", () => {
		const store = createSimStore();
		const run = makeRun();
		const issue = makeIssue({
			simRunId: run.id,
			commit: run.commit,
			status: "open",
		});
		store.saveRun(run, [issue]);

		assert.equal(store.setIssueStatus(issue.id, "fixed"), true);
		assert.equal(store.getRun(run.id).issues[0].status, "fixed");
		assert.equal(store.setIssueStatus("issue_missing", "wontfix"), false);

		assert.throws(
			() => store.setIssueStatus(issue.id, "invalid_status"),
			/invalid status/,
		);
		store.close();
	});
});
