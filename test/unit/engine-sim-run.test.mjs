import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateSimRun } from "../../backend/src/engine/environment-sim.js";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	runSimulation,
	SIM_KINDS,
} from "../../backend/src/engine/sim/run-sim.js";

const COMMIT = "a1b2c3d4e5f6";

function makeEnv(overrides = {}) {
	return {
		id: newId("env"),
		name: "Nominal",
		ambientC: { min: -10, max: 25 },
		humidityPct: { min: 10, max: 90 },
		altitudeM: 0,
		airflowMs: 0,
		...overrides,
	};
}

function verifyRunAndIssues(res, expectedKind) {
	assert.equal(res.run.status, "done");
	assert.equal(res.run.kind, expectedKind);
	assert.equal(res.run.commit, COMMIT);
	assert.equal(validateSimRun(res.run).ok, true);
	assert.ok(res.issues.length > 0);
	for (const issue of res.issues) {
		assert.equal(validateIssue(issue).ok, true);
		assert.equal(issue.simRunId, res.run.id);
		assert.equal(issue.commit, COMMIT);
	}
}

describe("SIM_KINDS", () => {
	test("exports supported simulation kinds", () => {
		assert.deepEqual(SIM_KINDS, ["thermal", "trace-current", "ir-drop"]);
	});
});

describe("runSimulation - thermal", () => {
	test("runs thermal simulator and returns valid run and issues", async () => {
		const env = makeEnv();
		const part = {
			id: newId("part"),
			ref: "U1",
			value: "LDO",
			symbol: "Reg:LDO",
			footprint: "Pkg:SOT-223",
			props: { powerW: 3.0, thetaJA: 50, tjMaxC: 125 },
		};
		const inputs = { ir: { parts: [part] } };
		const res = await runSimulation({
			kind: "thermal",
			env,
			commit: COMMIT,
			inputs,
		});
		verifyRunAndIssues(res, "thermal");
	});
});

describe("runSimulation - trace-current", () => {
	test("runs trace-current simulator and returns valid run and issues", async () => {
		const env = makeEnv();
		const track = {
			id: newId("trace"),
			widthMm: 0.254,
			thicknessUm: 35,
			layer: "F.Cu",
			currentA: 5.0,
		};
		const inputs = { tracks: [track] };
		const res = await runSimulation({
			kind: "trace-current",
			env,
			commit: COMMIT,
			inputs,
		});
		verifyRunAndIssues(res, "trace-current");
	});
});

describe("runSimulation - ir-drop", () => {
	test("runs ir-drop simulator and returns valid run and issues", async () => {
		const env = makeEnv();
		const netId = newId("net");
		const track = {
			id: newId("trace"),
			netId,
			lengthMm: 100,
			widthMm: 0.254,
			thicknessUm: 35,
			currentA: 2.0,
		};
		const inputs = { tracks: [track], railLimits: { [netId]: 0.05 } };
		const res = await runSimulation({
			kind: "ir-drop",
			env,
			commit: COMMIT,
			inputs,
		});
		verifyRunAndIssues(res, "ir-drop");
	});
});

describe("runSimulation - validation failures", () => {
	test("fails when env is invalid and provides joined errors", async () => {
		const invalidEnv = makeEnv({ ambientC: { min: 40, max: 20 } });
		const res = await runSimulation({
			kind: "thermal",
			env: invalidEnv,
			commit: COMMIT,
		});
		assert.equal(res.run.status, "failed");
		assert.deepEqual(res.run.results, []);
		assert.deepEqual(res.issues, []);
		assert.ok(typeof res.error === "string");
		assert.ok(res.error.includes("ambientC"));
	});

	test("fails when simulation kind is unknown", async () => {
		const env = makeEnv();
		const res = await runSimulation({
			kind: "unknown-kind",
			env,
			commit: COMMIT,
		});
		assert.equal(res.run.status, "failed");
		assert.deepEqual(res.run.results, []);
		assert.deepEqual(res.issues, []);
		assert.ok(typeof res.error === "string");
		assert.ok(res.error.includes("unknown simulation kind"));
	});
});

describe("runSimulation - error handling and timestamps", () => {
	test("fails gracefully when simulator throws", async () => {
		const env = makeEnv();
		const res = await runSimulation({
			kind: "trace-current",
			env,
			commit: COMMIT,
			inputs: { tracks: [null] },
		});
		assert.equal(res.run.status, "failed");
		assert.deepEqual(res.run.results, []);
		assert.deepEqual(res.issues, []);
		assert.ok(typeof res.error === "string");
		assert.ok(res.error.length > 0);
	});

	test("respects injected now() for timestamps", async () => {
		const env = makeEnv();
		let tick = 0;
		const fixedNow = () => `2026-11-11T12:00:0${tick++}.000Z`;
		const res = await runSimulation({
			kind: "thermal",
			env,
			commit: COMMIT,
			inputs: { ir: { parts: [] } },
			now: fixedNow,
		});
		assert.equal(res.run.status, "done");
		assert.equal(res.run.startedAt, "2026-11-11T12:00:00.000Z");
		assert.equal(res.run.finishedAt, "2026-11-11T12:00:01.000Z");
	});
});
