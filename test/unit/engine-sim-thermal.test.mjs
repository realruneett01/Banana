import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	airflowFactor,
	altitudeFactor,
	runThermal,
} from "../../backend/src/engine/sim/thermal.js";

function makePart(overrides = {}) {
	const props =
		overrides.props === undefined
			? { powerW: 1.0, thetaJA: 50 }
			: overrides.props;
	return {
		id: newId("part"),
		ref: "U1",
		value: "LDO",
		symbol: "Regulator:LDO",
		footprint: "Package_TO_SOT_SMD:SOT-223",
		props,
		...overrides,
	};
}

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

describe("airflowFactor", () => {
	const CASES = [
		{ input: { airflowMs: 0 }, expected: 1 },
		{ input: { airflowMs: 4 }, expected: 0.5 },
		{ input: { airflowMs: 12 }, expected: 0.25 },
		{ input: { airflowMs: -5 }, expected: 1 },
		{ input: 4, expected: 0.5 },
		{ input: undefined, expected: 1 },
	];

	for (const { input, expected } of CASES) {
		test(`computes factor for ${JSON.stringify(input)}`, () => {
			assert.equal(airflowFactor(input), expected);
		});
	}
});

describe("altitudeFactor", () => {
	const CASES = [
		{ input: { altitudeM: 0 }, expected: 1 },
		{ input: { altitudeM: 1000 }, expected: 1.1 },
		{ input: { altitudeM: 3000 }, expected: 1.3 },
		{ input: { altitudeM: -500 }, expected: 1 },
		{ input: 2000, expected: 1.2 },
		{ input: undefined, expected: 1 },
	];

	for (const { input, expected } of CASES) {
		test(`computes factor for ${JSON.stringify(input)}`, () => {
			assert.equal(altitudeFactor(input), expected);
		});
	}
});

describe("runThermal: hand-computed Tj", () => {
	test("calculates Tj and result structure accurately for known part", () => {
		const part = makePart({
			ref: "U1",
			props: { powerW: 1.5, thetaJA: 40, tjMaxC: 125 },
		});
		const env = makeEnv({
			ambientC: { min: -10, max: 25 },
			airflowMs: 0,
			altitudeM: 0,
		});

		const { results, issues } = runThermal({
			ir: { parts: [part] },
			env,
			commit: "c111111",
			simRunId: newId("sim"),
		});

		assert.equal(results.length, 1);
		assert.deepEqual(results[0], {
			itemId: part.id,
			metric: "tj",
			value: 85,
			unit: "C",
		});
		assert.equal(issues.length, 0);
	});
});

describe("runThermal: environmental influences", () => {
	test("airflow lowers Tj", () => {
		const part = makePart({ props: { powerW: 2.0, thetaJA: 50 } });
		const stillEnv = makeEnv({ ambientC: { min: 0, max: 30 }, airflowMs: 0 });
		const windEnv = makeEnv({ ambientC: { min: 0, max: 30 }, airflowMs: 3 });

		const stillRes = runThermal({ ir: { parts: [part] }, env: stillEnv });
		const windRes = runThermal({ ir: { parts: [part] }, env: windEnv });

		assert.equal(stillRes.results[0].value, 130);
		assert.equal(windRes.results[0].value, 87.1);
		assert.equal(windRes.results[0].value < stillRes.results[0].value, true);
	});

	test("altitude raises Tj", () => {
		const part = makePart({ props: { powerW: 1.0, thetaJA: 50 } });
		const seaEnv = makeEnv({ ambientC: { min: 0, max: 25 }, altitudeM: 0 });
		const mntEnv = makeEnv({ ambientC: { min: 0, max: 25 }, altitudeM: 2000 });

		const seaRes = runThermal({ ir: { parts: [part] }, env: seaEnv });
		const mntRes = runThermal({ ir: { parts: [part] }, env: mntEnv });

		assert.equal(seaRes.results[0].value, 75);
		assert.equal(mntRes.results[0].value, 85);
		assert.equal(mntRes.results[0].value > seaRes.results[0].value, true);
	});
});

describe("runThermal: warning vs error thresholds", () => {
	const THRESHOLD_CASES = [
		{
			desc: "safe below 90% tjMax",
			props: { powerW: 1.0, thetaJA: 50, tjMaxC: 100 },
			expectedSeverity: null,
			expectedTj: 75,
		},
		{
			desc: "warning above 90% tjMax and <= tjMax",
			props: { powerW: 1.4, thetaJA: 50, tjMaxC: 100 },
			expectedSeverity: "warning",
			expectedTj: 95,
			relationPhrase: "is within 10% of",
		},
		{
			desc: "error above tjMax",
			props: { powerW: 1.6, thetaJA: 50, tjMaxC: 100 },
			expectedSeverity: "error",
			expectedTj: 105,
			relationPhrase: "exceeds",
		},
		{
			desc: "default tjMax 125 gives warning",
			props: { powerW: 1.8, thetaJA: 50 },
			expectedSeverity: "warning",
			expectedTj: 115,
			relationPhrase: "is within 10% of",
		},
		{
			desc: "default tjMax 125 gives error",
			props: { powerW: 2.1, thetaJA: 50 },
			expectedSeverity: "error",
			expectedTj: 130,
			relationPhrase: "exceeds",
		},
	];

	for (const tc of THRESHOLD_CASES) {
		test(`evaluates ${tc.desc}`, () => {
			const part = makePart({ props: tc.props });
			const env = makeEnv();
			const { results, issues } = runThermal({
				ir: { parts: [part] },
				env,
				commit: "a1b2c3d",
				simRunId: newId("sim"),
			});

			assert.equal(results[0].value, tc.expectedTj);
			if (tc.expectedSeverity === null) {
				assert.equal(issues.length, 0);
				return;
			}
			assert.equal(issues.length, 1);
			assert.equal(issues[0].severity, tc.expectedSeverity);
			assert.equal(issues[0].message.includes(tc.relationPhrase), true);
		});
	}
});

describe("runThermal: skipped parts", () => {
	const SKIPPED_PROPS = [
		{ desc: "missing powerW", props: { thetaJA: 50 } },
		{ desc: "missing thetaJA", props: { powerW: 1.0 } },
		{ desc: "string powerW", props: { powerW: "1.0", thetaJA: 50 } },
		{ desc: "null thetaJA", props: { powerW: 1.0, thetaJA: null } },
		{ desc: "NaN powerW", props: { powerW: Number.NaN, thetaJA: 50 } },
		{ desc: "missing props", props: undefined },
	];

	for (const { desc, props } of SKIPPED_PROPS) {
		test(`skips part with ${desc}`, () => {
			const part = makePart({ props });
			const env = makeEnv();
			const { results, issues } = runThermal({
				ir: { parts: [part] },
				env,
			});
			assert.equal(results.length, 0);
			assert.equal(issues.length, 0);
		});
	}
});

describe("runThermal: validateIssue contract", () => {
	test("every generated issue passes validateIssue and has correct properties", () => {
		const warningPart = makePart({
			ref: "U1",
			props: { powerW: 1.8, thetaJA: 50 },
		});
		const errorPart = makePart({
			ref: "U2",
			props: { powerW: 2.2, thetaJA: 50 },
		});
		const env = makeEnv();
		const commit = "c1a2b3d4e5f6";
		const simRunId = newId("sim");

		const { issues } = runThermal({
			ir: { parts: [warningPart, errorPart] },
			env,
			commit,
			simRunId,
		});

		assert.equal(issues.length, 2);
		for (const issue of issues) {
			const res = validateIssue(issue);
			assert.equal(
				res.ok,
				true,
				`validateIssue failed: ${res.errors.join(", ")}`,
			);
			assert.equal(issue.source, "sim");
			assert.equal(issue.metric, "tj");
			assert.equal(issue.unit, "C");
			assert.equal(issue.status, "open");
			assert.equal(issue.commit, commit);
			assert.equal(issue.simRunId, simRunId);
			assert.equal(
				issue.suggestion,
				"reduce power, add copper or a heatsink, or increase airflow",
			);
		}
	});
});
