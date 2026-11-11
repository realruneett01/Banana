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
	const run1 = makeRun({
		startedAt: "2026-01-01T10:00:00.000Z",
		commit: "1111111",
		envId: env1,
		kind: "thermal",
	});
	const run2 = makeRun({
		startedAt: "2026-01-01T12:00:00.000Z",
		commit: "2222222",
		envId: env1,
		kind: "thermal",
	});
	const run3 = makeRun({
		startedAt: "2026-01-01T14:00:00.000Z",
		commit: "2222222",
		envId: env2,
		kind: "ir-drop",
	});
	store.saveRun(run1, []);
	store.saveRun(run2, []);
	store.saveRun(run3, []);
	return { run1, run2, run3, env1 };
}

function setupCompareFixture(store) {
	const envId = newId("env");
	const partA = newId("part");
	const partB = newId("part");
	const partC = newId("part");
	const before = "1111111";
	const after = "2222222";

	const issueA = makeIssue({
		source: "sim",
		metric: "temp",
		itemIds: [partA],
		commit: before,
	});
	const issueB = makeIssue({
		source: "sim",
		metric: "drop",
		itemIds: [partB],
		commit: before,
	});
	const issueB2 = makeIssue({
		source: "sim",
		metric: "drop",
		itemIds: [partB],
		commit: after,
	});
	const issueC = makeIssue({
		source: "sim",
		metric: "current",
		itemIds: [partC],
		commit: after,
	});

	const runBefore = makeRun({
		commit: before,
		envId,
		kind: "thermal",
		startedAt: "2026-01-01T10:00:00.000Z",
	});
	const runAfter = makeRun({
		commit: after,
		envId,
		kind: "thermal",
		startedAt: "2026-01-01T11:00:00.000Z",
	});

	store.saveRun(runBefore, [issueA, issueB]);
	store.saveRun(runAfter, [issueB2, issueC]);
	return { before, after, envId, issueA, issueB2, issueC };
}

describe("engine-sim-store", () => {
	test("save and get round-trip", () => {
		const store = createSimStore();
		const run = makeRun();
		const issue1 = makeIssue({ simRunId: run.id, commit: run.commit });
		const issue2 = makeIssue({ simRunId: run.id, commit: run.commit });

		store.saveRun(run, [issue1, issue2]);
		const found = store.getRun(run.id);

		assert.ok(found);
		assert.deepEqual(found.run, run);
		assert.deepEqual(found.issues, [issue1, issue2]);
		assert.equal(store.getRun("sim_nonexistent"), null);
		store.close();
	});

	test("invalid run throws", () => {
		const store = createSimStore();
		const invalidRun = { id: "not-a-valid-id" };
		const validIssue = makeIssue();

		assert.throws(
			() => store.saveRun(invalidRun, [validIssue]),
			/Validation failed/,
		);

		const validRun = makeRun();
		assert.throws(
			() => store.saveRun(validRun, [{ id: "bad_issue" }]),
			/Validation failed/,
		);
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
		const issue2 = makeIssue({ simRunId: run.id });
		const issue3 = makeIssue({ simRunId: run.id });
		store.saveRun(updatedRun, [issue2, issue3]);

		const res = store.getRun(run.id);
		assert.equal(res.run.status, "done");
		assert.deepEqual(res.issues, [issue2, issue3]);
		store.close();
	});

	test("list filters and ordering", () => {
		const store = createSimStore();
		const { run1, run2, run3, env1 } = setupListFixture(store);

		const allRuns = store.listRuns();
		assert.deepEqual(
			allRuns.map((r) => r.id),
			[run3.id, run2.id, run1.id],
		);

		const commitRuns = store.listRuns({ commit: "2222222" });
		assert.deepEqual(
			commitRuns.map((r) => r.id),
			[run3.id, run2.id],
		);

		const envRuns = store.listRuns({ envId: env1 });
		assert.deepEqual(
			envRuns.map((r) => r.id),
			[run2.id, run1.id],
		);

		const comboRuns = store.listRuns({ commit: "2222222", kind: "thermal" });
		assert.deepEqual(
			comboRuns.map((r) => r.id),
			[run2.id],
		);
		store.close();
	});

	test("latestRun", () => {
		const store = createSimStore();
		const envId = newId("env");
		const run1 = makeRun({
			startedAt: "2026-01-01T08:00:00.000Z",
			envId,
			kind: "thermal",
		});
		const run2 = makeRun({
			startedAt: "2026-01-01T09:00:00.000Z",
			envId,
			kind: "thermal",
		});
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

		assert.equal(diff.fixed.length, 1);
		assert.equal(diff.fixed[0].id, issueA.id);
		assert.equal(diff.stillOpen.length, 1);
		assert.equal(diff.stillOpen[0].id, issueB2.id);
		assert.equal(diff.new.length, 1);
		assert.equal(diff.new[0].id, issueC.id);
		store.close();
	});

	test("missing side throws", () => {
		const store = createSimStore();
		const envId = newId("env");
		const run = makeRun({ commit: "1111111", envId, kind: "thermal" });
		store.saveRun(run, []);

		assert.throws(
			() =>
				store.compareCommits({
					before: "missing_commit",
					after: "1111111",
					envId,
					kind: "thermal",
				}),
			/no run for missing_commit/,
		);

		assert.throws(
			() =>
				store.compareCommits({
					before: "1111111",
					after: "missing_commit",
					envId,
					kind: "thermal",
				}),
			/no run for missing_commit/,
		);
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
