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

function simThermal({ parts, envOverrides = {}, commit, simRunId } = {}) {
	const env = makeEnv(envOverrides);
	const partList = Array.isArray(parts) ? parts : [parts];
	const options = { ir: { parts: partList }, env };
	if (commit !== undefined) {
		options.commit = commit;
	}
	if (simRunId !== undefined) {
		options.simRunId = simRunId;
	}
	return runThermal(options);
}

function runFactorSuite(fn, cases) {
	for (const { input, expected } of cases) {
		test(`computes factor for ${JSON.stringify(input)}`, () => {
			assert.equal(fn(input), expected);
		});
	}
}

function assertThresholdIssue(issues, expectedSeverity, relationPhrase) {
	if (expectedSeverity === null) {
		assert.equal(issues.length, 0);
		return;
	}
	assert.equal(issues.length, 1);
	assert.equal(issues[0].severity, expectedSeverity);
	assert.equal(issues[0].message.includes(relationPhrase), true);
}

function assertEmptyRun(output) {
	assert.deepEqual(
		{ resultsCount: output.results.length, issuesCount: output.issues.length },
		{ resultsCount: 0, issuesCount: 0 },
	);
}

function verifyThermalIssue(issue, expectedMeta) {
	const check = validateIssue(issue);
	assert.equal(
		check.ok,
		true,
		`validateIssue failed: ${check.errors.join(", ")}`,
	);
	assert.deepEqual(
		{
			commit: issue.commit,
			metric: issue.metric,
			simRunId: issue.simRunId,
			source: issue.source,
			status: issue.status,
			suggestion: issue.suggestion,
			unit: issue.unit,
		},
		{
			commit: expectedMeta.commit,
			metric: "tj",
			simRunId: expectedMeta.simRunId,
			source: "sim",
			status: "open",
			suggestion: "reduce power, add copper or a heatsink, or increase airflow",
			unit: "C",
		},
	);
}

describe("airflowFactor", () => {
	runFactorSuite(airflowFactor, [
		{ input: { airflowMs: 0 }, expected: 1 },
		{ input: { airflowMs: 4 }, expected: 0.5 },
		{ input: { airflowMs: 12 }, expected: 0.25 },
		{ input: { airflowMs: -5 }, expected: 1 },
		{ input: 4, expected: 0.5 },
		{ input: undefined, expected: 1 },
	]);
});

describe("altitudeFactor", () => {
	runFactorSuite(altitudeFactor, [
		{ input: { altitudeM: 0 }, expected: 1 },
		{ input: { altitudeM: 1000 }, expected: 1.1 },
		{ input: { altitudeM: 3000 }, expected: 1.3 },
		{ input: { altitudeM: -500 }, expected: 1 },
		{ input: 2000, expected: 1.2 },
		{ input: undefined, expected: 1 },
	]);
});

describe("runThermal: hand-computed Tj", () => {
	test("calculates Tj and result structure accurately for known part", () => {
		const part = makePart({
			ref: "U1",
			props: { powerW: 1.5, thetaJA: 40, tjMaxC: 125 },
		});
		const envOverrides = {
			ambientC: { min: -10, max: 25 },
			airflowMs: 0,
			altitudeM: 0,
		};
		const { results, issues } = simThermal({
			parts: part,
			envOverrides,
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
	const ENV_CASES = [
		{
			title: "airflow lowers Tj",
			powerW: 2.0,
			firstEnv: { ambientC: { min: 0, max: 30 }, airflowMs: 0 },
			secondEnv: { ambientC: { min: 0, max: 30 }, airflowMs: 3 },
			expectedFirst: 130,
			expectedSecond: 87.1,
			isDecreasing: true,
		},
		{
			title: "altitude raises Tj",
			powerW: 1.0,
			firstEnv: { ambientC: { min: 0, max: 25 }, altitudeM: 0 },
			secondEnv: { ambientC: { min: 0, max: 25 }, altitudeM: 2000 },
			expectedFirst: 75,
			expectedSecond: 85,
			isDecreasing: false,
		},
	];

	for (const tc of ENV_CASES) {
		test(tc.title, () => {
			const part = makePart({ props: { powerW: tc.powerW, thetaJA: 50 } });
			const res1 = simThermal({ parts: part, envOverrides: tc.firstEnv });
			const res2 = simThermal({ parts: part, envOverrides: tc.secondEnv });
			const val1 = res1.results[0].value;
			const val2 = res2.results[0].value;

			assert.equal(val1, tc.expectedFirst);
			assert.equal(val2, tc.expectedSecond);
			assert.equal(tc.isDecreasing ? val2 < val1 : val2 > val1, true);
		});
	}
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
			const { results, issues } = simThermal({
				parts: part,
				commit: "a1b2c3d",
				simRunId: newId("sim"),
			});

			assert.equal(results[0].value, tc.expectedTj);
			assertThresholdIssue(issues, tc.expectedSeverity, tc.relationPhrase);
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
			const outcome = simThermal({ parts: part });
			assertEmptyRun(outcome);
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
		const meta = { commit: "c1a2b3d4e5f6", simRunId: newId("sim") };

		const { issues } = simThermal({
			parts: [warningPart, errorPart],
			...meta,
		});

		assert.equal(issues.length, 2);
		for (const issue of issues) {
			verifyThermalIssue(issue, meta);
		}
	});
});
