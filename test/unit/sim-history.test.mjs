import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { createSimStore } from "../../backend/src/engine/sim/sim-store.js";

const COMMIT_A = "111111111111";
const COMMIT_B = "222222222222";

const INVALID_GET_CASES = [
	{
		name: "GET /api/sim/runs rejects invalid commit",
		path: "/api/sim/runs?commit=bad",
	},
	{
		name: "GET /api/sim/runs rejects invalid envId",
		path: "/api/sim/runs?envId=bad",
	},
	{
		name: "GET /api/sim/runs rejects invalid kind",
		path: "/api/sim/runs?kind=bad",
	},
	{
		name: "GET /api/sim/runs/:id rejects invalid id",
		path: "/api/sim/runs/not-an-id",
	},
];

function createSimEnv(patch = {}) {
	return {
		id: newId("env"),
		name: "Nominal",
		altitudeM: 0,
		airflowMs: 0,
		ambientC: { min: -10, max: 25 },
		humidityPct: { min: 10, max: 90 },
		...patch,
	};
}

function buildThermalPayload(commit, env, powerW) {
	return {
		kind: "thermal",
		commit,
		env,
		inputs: {
			ir: {
				parts: [
					{
						id: newId("part"),
						ref: "U1",
						value: "LDO",
						symbol: "Reg:LDO",
						footprint: "Pkg:SOT-223",
						props: { powerW, thetaJA: 50, tjMaxC: 125 },
					},
				],
			},
		},
	};
}

async function startTestHarness(simStore) {
	const app = createApp();
	app.locals.simStore = simStore;
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${server.address().port}`;

	const send = async (method, path, body) => {
		const init = { method };
		if (body !== undefined) {
			init.headers = { "Content-Type": "application/json" };
			init.body = JSON.stringify(body);
		}
		const res = await fetch(`${base}${path}`, init);
		const json = await res.json().catch(() => ({}));
		return { status: res.status, json };
	};

	return {
		get: (path) => send("GET", path),
		post: (path, body) => send("POST", path, body),
		patch: (path, body) => send("PATCH", path, body),
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function assertSimRunOk(res) {
	assert.equal(res.status, 200);
	assert.equal(res.json?.run?.status, "done");
}

function assertRunsOk(res) {
	assert.equal(res.status, 200);
	return res.json.runs;
}

function assertRunDetails(res, expectedRunId, expectedIssueIds) {
	assert.equal(res.status, 200);
	assert.equal(res.json.run.id, expectedRunId);
	assert.deepEqual(
		res.json.issues.map((issue) => issue.id),
		expectedIssueIds,
	);
}

function assertNotFound(res, expectedError) {
	assert.deepEqual(
		{ status: res.status, error: res.json?.error },
		{ status: 404, error: expectedError },
	);
}

function assertInvalidRequest(res) {
	assert.deepEqual(
		{ status: res.status, hasErrorString: typeof res.json?.error === "string" },
		{ status: 400, hasErrorString: true },
	);
}

async function verifyIssueStatusUpdate(api, runId, issueId, newStatus) {
	const patchRes = await api.patch(`/api/issues/${issueId}`, {
		status: newStatus,
	});
	assert.deepEqual(
		{ status: patchRes.status, json: patchRes.json },
		{ status: 200, json: { ok: true } },
	);

	const getRes = await api.get(`/api/sim/runs/${runId}`);
	assert.deepEqual(
		{ status: getRes.status, issueStatus: getRes.json.issues[0]?.status },
		{ status: 200, issueStatus: newStatus },
	);
}

describe("sim-history routes", () => {
	let api;
	let store;
	let env;
	let runAId;
	let runBId;
	let runAIssueId;

	before(async () => {
		store = createSimStore({ filename: ":memory:" });
		api = await startTestHarness(store);
		env = createSimEnv();
	});

	after(async () => {
		await api.close();
		store.close();
	});

	describe("simulation run and persistence", () => {
		test("runs thermal sim on commit A (with issues) and persists", async () => {
			const res = await api.post(
				"/api/sim/run",
				buildThermalPayload(COMMIT_A, env, 3.0),
			);
			assertSimRunOk(res);
			assert.ok(Array.isArray(res.json?.issues) && res.json.issues.length > 0);
			runAId = res.json.run.id;
			runAIssueId = res.json.issues[0].id;
		});

		test("runs thermal sim on commit B (low power, no issues) and persists", async () => {
			const res = await api.post(
				"/api/sim/run",
				buildThermalPayload(COMMIT_B, env, 0.1),
			);
			assertSimRunOk(res);
			assert.equal(res.json?.issues?.length, 0);
			runBId = res.json.run.id;
		});
	});

	describe("POST /api/sim/compare", () => {
		test("compares runs across commits and detects fixed issues", async () => {
			const res = await api.post("/api/sim/compare", {
				before: COMMIT_A,
				after: COMMIT_B,
				envId: env.id,
				kind: "thermal",
			});
			assert.equal(res.status, 200);
			assert.deepEqual(
				{
					fixedIds: res.json.fixed.map((item) => item.id),
					stillOpenCount: res.json.stillOpen.length,
					newCount: res.json.new.length,
				},
				{
					fixedIds: [runAIssueId],
					stillOpenCount: 0,
					newCount: 0,
				},
			);
		});
	});

	describe("GET /api/sim/runs list and filters", () => {
		test("lists all simulation runs", async () => {
			const runs = assertRunsOk(await api.get("/api/sim/runs"));
			assert.ok(Array.isArray(runs) && runs.length >= 2);
		});

		test("filters simulation runs by commit", async () => {
			const runs = assertRunsOk(
				await api.get(`/api/sim/runs?commit=${COMMIT_A}`),
			);
			assert.deepEqual(
				runs.map((item) => item.commit),
				[COMMIT_A],
			);
		});

		test("filters simulation runs by envId and kind", async () => {
			const runs = assertRunsOk(
				await api.get(`/api/sim/runs?envId=${env.id}&kind=thermal`),
			);
			assert.equal(runs.length, 2);
		});

		test("accepts empty filter query params", async () => {
			const runs = assertRunsOk(
				await api.get("/api/sim/runs?commit=&envId=&kind="),
			);
			assert.ok(runs.length >= 2);
		});
	});

	describe("GET /api/sim/runs/:id", () => {
		test("retrieves a simulation run with its issues", async () => {
			const res = await api.get(`/api/sim/runs/${runAId}`);
			assertRunDetails(res, runAId, [runAIssueId]);
		});

		test("retrieves a simulation run with no issues", async () => {
			const res = await api.get(`/api/sim/runs/${runBId}`);
			assertRunDetails(res, runBId, []);
		});
	});

	describe("PATCH /api/issues/:id and verification via GET", () => {
		test("updates issue status to fixed and GET shows updated status", async () => {
			await verifyIssueStatusUpdate(api, runAId, runAIssueId, "fixed");
		});

		test("updates issue status to wontfix", async () => {
			await verifyIssueStatusUpdate(api, runAId, runAIssueId, "wontfix");
		});
	});

	describe("404 errors", () => {
		test("GET /api/sim/runs/:id returns 404 for unknown run", async () => {
			const res = await api.get(`/api/sim/runs/${newId("sim")}`);
			assertNotFound(res, "Run not found");
		});

		test("POST /api/sim/compare returns 404 when commit has no run", async () => {
			const res = await api.post("/api/sim/compare", {
				before: "999999999999",
				after: COMMIT_B,
			});
			assert.equal(res.status, 404);
			assert.ok(res.json?.error?.includes("no run for"));
		});

		test("PATCH /api/issues/:id returns 404 for unknown issue", async () => {
			const res = await api.patch(`/api/issues/${newId("issue")}`, {
				status: "fixed",
			});
			assertNotFound(res, "Issue not found");
		});
	});

	describe("validation 400 errors", () => {
		for (const { name, path } of INVALID_GET_CASES) {
			test(name, async () => {
				const res = await api.get(path);
				assertInvalidRequest(res);
			});
		}

		test("POST /api/sim/compare rejects invalid body and commits", async () => {
			const invalidBodies = [
				[],
				{ before: "bad", after: COMMIT_B },
				{ before: COMMIT_A, after: "bad" },
				{ before: COMMIT_A, after: COMMIT_B, envId: "not-an-env" },
			];
			const responses = await Promise.all(
				invalidBodies.map((body) => api.post("/api/sim/compare", body)),
			);
			assert.deepEqual(
				responses.map((r) => r.status),
				[400, 400, 400, 400],
			);
		});

		test("PATCH /api/issues/:id rejects invalid id and status", async () => {
			const invalidRequests = [
				api.patch("/api/issues/not-an-id", { status: "fixed" }),
				api.patch(`/api/issues/${runAIssueId}`, { status: "invalid-status" }),
				api.patch(`/api/issues/${runAIssueId}`, []),
			];
			const responses = await Promise.all(invalidRequests);
			assert.deepEqual(
				responses.map((r) => r.status),
				[400, 400, 400],
			);
		});
	});
});
