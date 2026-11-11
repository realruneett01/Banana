import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	maxCurrentA,
	runTraceCurrent,
} from "../../backend/src/engine/sim/trace-current.js";

const COMMIT_HASH = "e4d3c2b1a09876543210fedcba09876543210fed";

function makeEnv(maxAmbientC = 25) {
	return {
		id: newId("env"),
		name: "Standard Lab",
		ambientC: { min: 20, max: maxAmbientC },
		humidityPct: { min: 30, max: 60 },
		altitudeM: 100,
	};
}

function makeTrack(overrides = {}) {
	return {
		id: newId("trace"),
		widthMm: 0.254,
		thicknessUm: 35,
		layer: "F.Cu",
		currentA: 0.5,
		...overrides,
	};
}

describe("maxCurrentA (IPC-2221)", () => {
	test("known IPC-2221 value: 0.254 mm wide, 35 um, external, dT 10 C gives ~1.0 A with tolerance", () => {
		const capacity = maxCurrentA({
			widthMm: 0.254,
			thicknessUm: 35,
			external: true,
			tempRiseC: 10,
		});
		assert.ok(
			capacity >= 0.8 && capacity <= 1.2,
			`expected ~1.0 A with tolerance, got ${capacity}`,
		);
	});

	test("internal traces have lower capacity than external traces", () => {
		const opts = { widthMm: 0.5, thicknessUm: 35, tempRiseC: 10 };
		const external = maxCurrentA({ ...opts, external: true });
		const internal = maxCurrentA({ ...opts, external: false });
		assert.ok(internal < external);
		assert.equal(Math.round((internal / external) * 100) / 100, 0.5);
	});

	test("higher temperature rise and thicker copper increase current capacity", () => {
		const base = maxCurrentA({ widthMm: 0.5, thicknessUm: 35, tempRiseC: 10 });
		const higherTemp = maxCurrentA({
			widthMm: 0.5,
			thicknessUm: 35,
			tempRiseC: 20,
		});
		const thickerCu = maxCurrentA({
			widthMm: 0.5,
			thicknessUm: 70,
			tempRiseC: 10,
		});
		assert.ok(higherTemp > base);
		assert.ok(thickerCu > base);
	});

	test("returns zero when inputs are non-positive or non-numbers", () => {
		const cases = [
			{ widthMm: 0, thicknessUm: 35, tempRiseC: 10 },
			{ widthMm: -0.5, thicknessUm: 35, tempRiseC: 10 },
			{ widthMm: 0.5, thicknessUm: 0, tempRiseC: 10 },
			{ widthMm: 0.5, thicknessUm: 35, tempRiseC: 0 },
			{ widthMm: 0.5, thicknessUm: 35, tempRiseC: -5 },
		];
		for (const c of cases) {
			assert.equal(maxCurrentA(c), 0);
		}
	});

	test("applies default parameter values when omitted", () => {
		const withDefaults = maxCurrentA({ widthMm: 0.254 });
		const explicit = maxCurrentA({
			widthMm: 0.254,
			thicknessUm: 35,
			external: true,
			tempRiseC: 10,
		});
		assert.equal(withDefaults, explicit);
	});
});

describe("runTraceCurrent", () => {
	test("identifies external vs internal layers", () => {
		const env = makeEnv(25);
		const fCuTrack = makeTrack({ layer: "F.Cu" });
		const bCuTrack = makeTrack({ layer: "B.Cu" });
		const inTrack = makeTrack({ layer: "In1.Cu" });

		const { results } = runTraceCurrent({
			tracks: [fCuTrack, bCuTrack, inTrack],
			env,
			commit: COMMIT_HASH,
		});

		assert.equal(results.length, 3);
		assert.equal(results[0].value, results[1].value);
		assert.ok(results[2].value < results[0].value);
	});

	test("hot ambient lowers effective dT and reduces current capacity", () => {
		const track = makeTrack({ widthMm: 0.5 });
		const coolEnv = makeEnv(25);
		const hotEnv = makeEnv(100);

		const coolRun = runTraceCurrent({
			tracks: [track],
			env: coolEnv,
			commit: COMMIT_HASH,
			tempRiseC: 20,
		});
		const hotRun = runTraceCurrent({
			tracks: [track],
			env: hotEnv,
			commit: COMMIT_HASH,
			tempRiseC: 20,
		});

		assert.ok(hotRun.results[0].value < coolRun.results[0].value);
	});

	test("effective dT <= 0 sets limit to 0 and flags currentA > 0 as error", () => {
		const hotEnv = makeEnv(105);
		const activeTrack = makeTrack({ currentA: 1.2 });
		const idleTrack = makeTrack({ currentA: 0 });

		const { results, issues } = runTraceCurrent({
			tracks: [activeTrack, idleTrack],
			env: hotEnv,
			commit: COMMIT_HASH,
		});

		assert.equal(results[0].value, 0);
		assert.equal(results[1].value, 0);
		assert.equal(issues.length, 1);
		assert.equal(issues[0].severity, "error");
		assert.equal(issues[0].limit, 0);
		assert.equal(issues[0].measured, 1.2);
	});

	test("thresholds: flags errors, warnings, and compliant tracks correctly", () => {
		const env = makeEnv(25);
		const simRunId = newId("sim");
		const safeTrack = makeTrack({ currentA: 0.5 });
		const warnTrack = makeTrack({ currentA: 0.75 });
		const errorTrack = makeTrack({ currentA: 1.5 });

		const { issues } = runTraceCurrent({
			tracks: [safeTrack, warnTrack, errorTrack],
			env,
			commit: COMMIT_HASH,
			simRunId,
		});

		assert.equal(issues.length, 2);
		assert.equal(issues[0].severity, "warning");
		assert.equal(issues[0].itemIds[0], warnTrack.id);
		assert.equal(issues[1].severity, "error");
		assert.equal(issues[1].itemIds[0], errorTrack.id);
	});

	test("all generated issues pass validateIssue and adhere to issue contract", () => {
		const env = makeEnv(25);
		const simRunId = newId("sim");
		const violatingTrack = makeTrack({ currentA: 2.5 });

		const { issues } = runTraceCurrent({
			tracks: [violatingTrack],
			env,
			commit: COMMIT_HASH,
			simRunId,
		});

		assert.equal(issues.length, 1);
		const issue = issues[0];
		assert.equal(issue.source, "sim");
		assert.equal(issue.metric, "current");
		assert.equal(issue.unit, "A");
		assert.equal(issue.suggestion, "widen the trace or use thicker copper");
		assert.equal(issue.status, "open");
		assert.equal(issue.commit, COMMIT_HASH);
		assert.equal(issue.simRunId, simRunId);

		const validation = validateIssue(issue);
		assert.equal(
			validation.ok,
			true,
			`Validation failed: ${validation.errors.join("; ")}`,
		);
	});

	test("handles empty tracks gracefully", () => {
		const env = makeEnv(25);
		const { results, issues } = runTraceCurrent({
			tracks: [],
			env,
			commit: COMMIT_HASH,
		});
		assert.deepEqual(results, []);
		assert.deepEqual(issues, []);
	});
});
