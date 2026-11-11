import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	airflowFactor,
	altitudeFactor,
	runThermal,
} from "../../backend/src/engine/sim/thermal.js";

const ISSUE_COMPARISON_KEYS = [
	"commit",
	"metric",
	"simRunId",
	"source",
	"status",
	"suggestion",
	"unit",
];

function makePart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "U1",
		value: "LDO",
		symbol: "Regulator:LDO",
		footprint: "Package_TO_SOT_SMD:SOT-223",
		props: { powerW: 1.0, thetaJA: 50 },
		...overrides,
	};
}

function makeEnv(overrides = {}) {
	const base = {
		airflowMs: 0,
		altitudeM: 0,
		ambientC: { min: -10, max: 25 },
		humidityPct: { min: 10, max: 90 },
		name: "Nominal",
	};
	return Object.assign({ id: newId("env") }, base, overrides);
}

function simThermal({ parts, envOverrides = {}, commit, simRunId } = {}) {
	const ir = { parts: Array.isArray(parts) ? parts : [parts] };
	const env = makeEnv(envOverrides);
	return runThermal({
		ir,
		env,
		...(commit !== undefined && { commit }),
		...(simRunId !== undefined && { simRunId }),
	});
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
	const actual = Object.fromEntries(
		ISSUE_COMPARISON_KEYS.map((key) => [key, issue[key]]),
	);
	assert.deepEqual(actual, {
		commit: expectedMeta.commit,
		metric: "tj",
		simRunId: expectedMeta.simRunId,
		source: "sim",
		status: "open",
		suggestion: "reduce power, add copper or a heatsink, or increase airflow",
		unit: "C",
	});
}

const FACTOR_TEST_SPECS = [
	[
		"airflowFactor",
		airflowFactor,
		[
			[{ airflowMs: 0 }, 1],
			[{ airflowMs: 4 }, 0.5],
			[{ airflowMs: 12 }, 0.25],
			[{ airflowMs: -5 }, 1],
			[4, 0.5],
			[undefined, 1],
		],
	],
	[
		"altitudeFactor",
		altitudeFactor,
		[
			[{ altitudeM: 0 }, 1],
			[{ altitudeM: 1000 }, 1.1],
			[{ altitudeM: 3000 }, 1.3],
			[{ altitudeM: -500 }, 1],
			[2000, 1.2],
			[undefined, 1],
		],
	],
];

for (const [suiteName, fn, cases] of FACTOR_TEST_SPECS) {
	describe(suiteName, () => {
		for (const [input, expected] of cases) {
			test(`computes factor for ${JSON.stringify(input)}`, () => {
				assert.equal(fn(input), expected);
			});
		}
	});
}

describe("runThermal: hand-computed Tj", () => {
	test("calculates Tj and result structure accurately for known part", () => {
		const part = makePart({
			ref: "U1",
			props: { powerW: 1.5, thetaJA: 40, tjMaxC: 125 },
		});
		const { results, issues } = simThermal({
			parts: part,
			envOverrides: {
				ambientC: { min: -10, max: 25 },
				airflowMs: 0,
				altitudeM: 0,
			},
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
		[
			"airflow lowers Tj",
			2.0,
			{ ambientC: { min: 0, max: 30 }, airflowMs: 0 },
			{ ambientC: { min: 0, max: 30 }, airflowMs: 3 },
			130,
			87.1,
			true,
		],
		[
			"altitude raises Tj",
			1.0,
			{ ambientC: { min: 0, max: 25 }, altitudeM: 0 },
			{ ambientC: { min: 0, max: 25 }, altitudeM: 2000 },
			75,
			85,
			false,
		],
	];

	for (const [
		title,
		powerW,
		firstEnv,
		secondEnv,
		exp1,
		exp2,
		isDecreasing,
	] of ENV_CASES) {
		test(title, () => {
			const part = makePart({ props: { powerW, thetaJA: 50 } });
			const val1 = simThermal({ parts: part, envOverrides: firstEnv })
				.results[0].value;
			const val2 = simThermal({ parts: part, envOverrides: secondEnv })
				.results[0].value;

			assert.equal(val1, exp1);
			assert.equal(val2, exp2);
			assert.equal(isDecreasing ? val2 < val1 : val2 > val1, true);
		});
	}
});

describe("runThermal: warning vs error thresholds", () => {
	const THRESHOLD_CASES = [
		[
			"safe below 90% tjMax",
			{ powerW: 1.0, thetaJA: 50, tjMaxC: 100 },
			null,
			75,
			undefined,
		],
		[
			"warning above 90% tjMax and <= tjMax",
			{ powerW: 1.4, thetaJA: 50, tjMaxC: 100 },
			"warning",
			95,
			"is within 10% of",
		],
		[
			"error above tjMax",
			{ powerW: 1.6, thetaJA: 50, tjMaxC: 100 },
			"error",
			105,
			"exceeds",
		],
		[
			"default tjMax 125 gives warning",
			{ powerW: 1.8, thetaJA: 50 },
			"warning",
			115,
			"is within 10% of",
		],
		[
			"default tjMax 125 gives error",
			{ powerW: 2.1, thetaJA: 50 },
			"error",
			130,
			"exceeds",
		],
	];

	for (const [
		desc,
		props,
		expectedSeverity,
		expectedTj,
		relationPhrase,
	] of THRESHOLD_CASES) {
		test(`evaluates ${desc}`, () => {
			const { results, issues } = simThermal({
				parts: makePart({ props }),
				commit: "a1b2c3d",
				simRunId: newId("sim"),
			});

			assert.equal(results[0].value, expectedTj);
			assertThresholdIssue(issues, expectedSeverity, relationPhrase);
		});
	}
});

describe("runThermal: skipped parts", () => {
	const SKIPPED_CASES = [
		["missing powerW", { thetaJA: 50 }],
		["missing thetaJA", { powerW: 1.0 }],
		["string powerW", { powerW: "1.0", thetaJA: 50 }],
		["null thetaJA", { powerW: 1.0, thetaJA: null }],
		["NaN powerW", { powerW: Number.NaN, thetaJA: 50 }],
		["missing props", undefined],
	];

	for (const [desc, props] of SKIPPED_CASES) {
		test(`skips part with ${desc}`, () => {
			assertEmptyRun(simThermal({ parts: makePart({ props }) }));
		});
	}
});

describe("runThermal: validateIssue contract", () => {
	test("every generated issue passes validateIssue and has correct properties", () => {
		const parts = [
			makePart({ ref: "U1", props: { powerW: 1.8, thetaJA: 50 } }),
			makePart({ ref: "U2", props: { powerW: 2.2, thetaJA: 50 } }),
		];
		const meta = { commit: "c1a2b3d4e5f6", simRunId: newId("sim") };
		const { issues } = simThermal({ parts, ...meta });

		assert.equal(issues.length, 2);
		for (const issue of issues) {
			verifyThermalIssue(issue, meta);
		}
	});
});
