import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { createSimStore } from "../../backend/src/engine/sim/sim-store.js";

const COMMIT_A = "111111111111";
const COMMIT_B = "222222222222";

function makeValidEnv(overrides = {}) {
	return Object.assign(
		{ id: newId("env"), altitudeM: 0, airflowMs: 0, name: "Nominal" },
		{ ambientC: { min: -10, max: 25 }, humidityPct: { min: 10, max: 90 } },
		overrides,
	);
}

function makeThermalInputs(powerW = 3.0) {
	const part = {
		id: newId("part"),
		ref: "U1",
		value: "LDO",
		symbol: "Reg:LDO",
		footprint: "Pkg:SOT-223",
		props: { powerW, thetaJA: 50, tjMaxC: 125 },
	};
	return { ir: { parts: [part] } };
}

function bootServer(app) {
	const server = http.createServer(app);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, port: server.address().port });
		});
	});
}

const shutdownServer = (server) =>
	new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}
		server.close(resolve);
	});

async function requestJson(port, path, options = {}) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

const getJson = (port, path) => requestJson(port, path);

const postJson = (port, path, body) =>
	requestJson(port, path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

const patchJson = (port, path, body) =>
	requestJson(port, path, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

describe("sim-history routes", () => {
	let server;
	let port;
	let store;
	let env;
	let runAId;
	let runBId;
	let runAIssueId;

	before(async () => {
		store = createSimStore({ filename: ":memory:" });
		const app = createApp();
		app.locals.simStore = store;
		const started = await bootServer(app);
		server = started.server;
		port = started.port;
		env = makeValidEnv();
	});

	after(async () => {
		await shutdownServer(server);
		store.close();
	});

	describe("simulation run and persistence", () => {
		test("runs thermal sim on commit A (with issues) and persists", async () => {
			const body = {
				kind: "thermal",
				commit: COMMIT_A,
				env,
				inputs: makeThermalInputs(3.0),
			};
			const { status, json } = await postJson(port, "/api/sim/run", body);
			assert.equal(status, 200);
			assert.equal(json?.run?.status, "done");
			assert.ok(Array.isArray(json?.issues) && json.issues.length > 0);
			runAId = json.run.id;
			runAIssueId = json.issues[0].id;
		});

		test("runs thermal sim on commit B (low power, no issues) and persists", async () => {
			const body = {
				kind: "thermal",
				commit: COMMIT_B,
				env,
				inputs: makeThermalInputs(0.1),
			};
			const { status, json } = await postJson(port, "/api/sim/run", body);
			assert.equal(status, 200);
			assert.equal(json?.run?.status, "done");
			assert.equal(json?.issues?.length, 0);
			runBId = json.run.id;
		});
	});

	describe("POST /api/sim/compare", () => {
		test("compares runs across commits and detects fixed issues", async () => {
			const body = {
				before: COMMIT_A,
				after: COMMIT_B,
				envId: env.id,
				kind: "thermal",
			};
			const { status, json } = await postJson(port, "/api/sim/compare", body);
			assert.equal(status, 200);
			assert.equal(json.fixed.length, 1);
			assert.equal(json.fixed[0].id, runAIssueId);
			assert.equal(json.stillOpen.length, 0);
			assert.equal(json.new.length, 0);
		});
	});

	describe("GET /api/sim/runs list and filters", () => {
		test("lists all simulation runs", async () => {
			const { status, json } = await getJson(port, "/api/sim/runs");
			assert.equal(status, 200);
			assert.ok(Array.isArray(json.runs));
			assert.ok(json.runs.length >= 2);
		});

		test("filters simulation runs by commit", async () => {
			const { status, json } = await getJson(
				port,
				`/api/sim/runs?commit=${COMMIT_A}`,
			);
			assert.equal(status, 200);
			assert.equal(json.runs.length, 1);
			assert.equal(json.runs[0].commit, COMMIT_A);
		});

		test("filters simulation runs by envId and kind", async () => {
			const { status, json } = await getJson(
				port,
				`/api/sim/runs?envId=${env.id}&kind=thermal`,
			);
			assert.equal(status, 200);
			assert.equal(json.runs.length, 2);
		});

		test("accepts empty filter query params", async () => {
			const { status, json } = await getJson(
				port,
				"/api/sim/runs?commit=&envId=&kind=",
			);
			assert.equal(status, 200);
			assert.ok(json.runs.length >= 2);
		});
	});

	describe("GET /api/sim/runs/:id", () => {
		test("retrieves a simulation run with its issues", async () => {
			const { status, json } = await getJson(port, `/api/sim/runs/${runAId}`);
			assert.equal(status, 200);
			assert.equal(json.run.id, runAId);
			assert.equal(json.issues.length, 1);
			assert.equal(json.issues[0].id, runAIssueId);
		});

		test("retrieves a simulation run with no issues", async () => {
			const { status, json } = await getJson(port, `/api/sim/runs/${runBId}`);
			assert.equal(status, 200);
			assert.equal(json.run.id, runBId);
			assert.equal(json.issues.length, 0);
		});
	});

	describe("PATCH /api/issues/:id and verification via GET", () => {
		test("updates issue status to fixed and GET shows updated status", async () => {
			const patchRes = await patchJson(port, `/api/issues/${runAIssueId}`, {
				status: "fixed",
			});
			assert.equal(patchRes.status, 200);
			assert.deepEqual(patchRes.json, { ok: true });

			const getRes = await getJson(port, `/api/sim/runs/${runAId}`);
			assert.equal(getRes.status, 200);
			assert.equal(getRes.json.issues[0].status, "fixed");
		});

		test("updates issue status to wontfix", async () => {
			const patchRes = await patchJson(port, `/api/issues/${runAIssueId}`, {
				status: "wontfix",
			});
			assert.equal(patchRes.status, 200);
			assert.deepEqual(patchRes.json, { ok: true });

			const getRes = await getJson(port, `/api/sim/runs/${runAId}`);
			assert.equal(getRes.status, 200);
			assert.equal(getRes.json.issues[0].status, "wontfix");
		});
	});

	describe("404 errors", () => {
		test("GET /api/sim/runs/:id returns 404 for unknown run", async () => {
			const unknownSimId = newId("sim");
			const { status, json } = await getJson(
				port,
				`/api/sim/runs/${unknownSimId}`,
			);
			assert.equal(status, 404);
			assert.equal(json.error, "Run not found");
		});

		test("POST /api/sim/compare returns 404 when commit has no run", async () => {
			const body = { before: "999999999999", after: COMMIT_B };
			const { status, json } = await postJson(port, "/api/sim/compare", body);
			assert.equal(status, 404);
			assert.ok(json.error.includes("no run for"));
		});

		test("PATCH /api/issues/:id returns 404 for unknown issue", async () => {
			const unknownIssueId = newId("issue");
			const { status, json } = await patchJson(
				port,
				`/api/issues/${unknownIssueId}`,
				{ status: "fixed" },
			);
			assert.equal(status, 404);
			assert.equal(json.error, "Issue not found");
		});
	});

	describe("validation 400 errors", () => {
		test("GET /api/sim/runs rejects invalid commit", async () => {
			const { status, json } = await getJson(port, "/api/sim/runs?commit=bad");
			assert.equal(status, 400);
			assert.ok(typeof json.error === "string");
		});

		test("GET /api/sim/runs rejects invalid envId", async () => {
			const { status, json } = await getJson(port, "/api/sim/runs?envId=bad");
			assert.equal(status, 400);
			assert.ok(typeof json.error === "string");
		});

		test("GET /api/sim/runs rejects invalid kind", async () => {
			const { status, json } = await getJson(port, "/api/sim/runs?kind=bad");
			assert.equal(status, 400);
			assert.ok(typeof json.error === "string");
		});

		test("GET /api/sim/runs/:id rejects invalid id", async () => {
			const { status, json } = await getJson(port, "/api/sim/runs/not-an-id");
			assert.equal(status, 400);
			assert.ok(typeof json.error === "string");
		});

		test("POST /api/sim/compare rejects invalid body and commits", async () => {
			const res1 = await postJson(port, "/api/sim/compare", []);
			assert.equal(res1.status, 400);
			const res2 = await postJson(port, "/api/sim/compare", {
				before: "bad",
				after: COMMIT_B,
			});
			assert.equal(res2.status, 400);
			const res3 = await postJson(port, "/api/sim/compare", {
				before: COMMIT_A,
				after: "bad",
			});
			assert.equal(res3.status, 400);
			const res4 = await postJson(port, "/api/sim/compare", {
				before: COMMIT_A,
				after: COMMIT_B,
				envId: "not-an-env",
			});
			assert.equal(res4.status, 400);
		});

		test("PATCH /api/issues/:id rejects invalid id and status", async () => {
			const res1 = await patchJson(port, "/api/issues/not-an-id", {
				status: "fixed",
			});
			assert.equal(res1.status, 400);
			const res2 = await patchJson(port, `/api/issues/${runAIssueId}`, {
				status: "invalid-status",
			});
			assert.equal(res2.status, 400);
			const res3 = await patchJson(port, `/api/issues/${runAIssueId}`, []);
			assert.equal(res3.status, 400);
		});
	});
});
