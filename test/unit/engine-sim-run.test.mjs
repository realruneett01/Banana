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

function makeTrack(overrides = {}) {
	return {
		id: newId("trace"),
		widthMm: 0.254,
		thicknessUm: 35,
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

function verifyFailedRun(res, errorMatch = "") {
	assert.equal(res.run.status, "failed");
	assert.deepEqual(res.run.results, []);
	assert.deepEqual(res.issues, []);
	assert.equal(typeof res.error, "string");
	assert.ok(res.error.length > 0);
	if (errorMatch) {
		assert.ok(res.error.includes(errorMatch));
	}
}

async function executeSim(kind, inputs = {}, options = {}) {
	return runSimulation({
		kind,
		env: makeEnv(),
		commit: COMMIT,
		inputs,
		...options,
	});
}

async function runAndVerify(kind, inputs) {
	const res = await executeSim(kind, inputs);
	verifyRunAndIssues(res, kind);
}

describe("SIM_KINDS", () => {
	test("exports supported simulation kinds", () => {
		assert.deepEqual(SIM_KINDS, ["thermal", "trace-current", "ir-drop"]);
	});
});

describe("runSimulation - thermal", () => {
	test("runs thermal simulator and returns valid run and issues", async () => {
		const part = {
			id: newId("part"),
			ref: "U1",
			value: "LDO",
			symbol: "Reg:LDO",
			footprint: "Pkg:SOT-223",
			props: { powerW: 3.0, thetaJA: 50, tjMaxC: 125 },
		};
		await runAndVerify("thermal", { ir: { parts: [part] } });
	});
});

describe("runSimulation - trace-current", () => {
	test("runs trace-current simulator and returns valid run and issues", async () => {
		const track = makeTrack({ layer: "F.Cu", currentA: 5.0 });
		await runAndVerify("trace-current", { tracks: [track] });
	});
});

describe("runSimulation - ir-drop", () => {
	test("runs ir-drop simulator and returns valid run and issues", async () => {
		const netId = newId("net");
		const track = makeTrack({ netId, lengthMm: 100, currentA: 2.0 });
		await runAndVerify("ir-drop", {
			tracks: [track],
			railLimits: { [netId]: 0.05 },
		});
	});
});

describe("runSimulation - validation failures", () => {
	const VALIDATION_CASES = [
		{
			name: "fails when env is invalid and provides joined errors",
			kind: "thermal",
			options: { env: makeEnv({ ambientC: { min: 40, max: 20 } }) },
			match: "ambientC",
		},
		{
			name: "fails when simulation kind is unknown",
			kind: "unknown-kind",
			options: {},
			match: "unknown simulation kind",
		},
	];

	for (const { name, kind, options, match } of VALIDATION_CASES) {
		test(name, async () => {
			const res = await executeSim(kind, {}, options);
			verifyFailedRun(res, match);
		});
	}
});

describe("runSimulation - error handling and timestamps", () => {
	test("fails gracefully when simulator throws", async () => {
		const res = await executeSim("trace-current", { tracks: [null] });
		verifyFailedRun(res);
	});

	test("respects injected now() for timestamps", async () => {
		let tick = 0;
		const fixedNow = () => `2026-11-11T12:00:0${tick++}.000Z`;
		const res = await executeSim(
			"thermal",
			{ ir: { parts: [] } },
			{ now: fixedNow },
		);
		assert.equal(res.run.status, "done");
		assert.equal(res.run.startedAt, "2026-11-11T12:00:00.000Z");
		assert.equal(res.run.finishedAt, "2026-11-11T12:00:01.000Z");
	});
});
