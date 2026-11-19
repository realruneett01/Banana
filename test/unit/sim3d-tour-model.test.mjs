import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildTour,
	stepVerdict,
	tourSummary,
} from "../../frontend/src/components/sim3d/tourModel.js";

function checkStepCountAndHealthyFirst(steps, expectedLength) {
	assert.equal(steps.length, expectedLength);
	assert.equal(steps[0].id, "healthy");
}

function verifyHealthyStepFields(step) {
	assert.equal(step.fault, null);
	assert.ok(step.title);
	assert.ok(step.intro);
	assert.ok(step.question);
}

function verifyStepDetails(step, expectedTitle, expectedIntro) {
	assert.deepEqual(
		[step.title, step.intro, step.question.length > 0],
		[expectedTitle, expectedIntro, true],
	);
}

function verifyVerdict(res, expectedVerdict, pattern) {
	assert.equal(res.verdict, expectedVerdict);
	if (pattern) {
		assert.match(res.text, pattern);
	}
}

function verifySummary(summary, expectedScore, tipVerifier) {
	assert.equal(summary.score, expectedScore);
	if (!tipVerifier) return;
	if (typeof tipVerifier === "function") {
		assert.ok(tipVerifier(summary.tips));
		return;
	}
	assert.ok(summary.tips.some((tip) => tipVerifier.test(tip)));
}

function buildTestFault(kind, id, info = null) {
	return info ? { kind, id, info } : { kind, id };
}

function buildVerdict(id, verdict) {
	return { id, verdict };
}

const EXPECTED_SEVERITY_ORDER = [
	"short_nets",
	"overvoltage",
	"reverse_polarity",
	"missing_ground",
	"part_short",
	"open_trace",
	"part_open",
	"value_drift",
];

describe("tourModel - buildTour", () => {
	test("returns healthy circuit step as first step when faults is empty or null", () => {
		const stepsEmpty = buildTour([]);
		checkStepCountAndHealthyFirst(stepsEmpty, 1);
		verifyHealthyStepFields(stepsEmpty[0]);

		const stepsNull = buildTour(null);
		checkStepCountAndHealthyFirst(stepsNull, 1);
	});

	test("orders faults strictly by severity with healthy step first", () => {
		const inputFaults = [
			buildTestFault("value_drift", "f-drift"),
			buildTestFault("open_trace", "f-open-trace"),
			buildTestFault("short_nets", "f-short-nets"),
			buildTestFault("missing_ground", "f-ground"),
			buildTestFault("overvoltage", "f-overvolt"),
			buildTestFault("part_open", "f-part-open"),
			buildTestFault("reverse_polarity", "f-rev-pol"),
			buildTestFault("part_short", "f-part-short"),
		];

		const steps = buildTour(inputFaults);
		checkStepCountAndHealthyFirst(steps, 9);

		const orderedKinds = steps.slice(1).map((s) => s.fault?.kind);
		assert.deepEqual(orderedKinds, EXPECTED_SEVERITY_ORDER);
	});

	test("uses info label and plainEnglish when provided on fault", () => {
		const faults = [
			buildTestFault("short_nets", "f1", {
				label: "Short Circuit",
				plainEnglish: "Two copper tracks are touching.",
			}),
		];
		const steps = buildTour(faults);
		verifyStepDetails(
			steps[1],
			"Short Circuit",
			"Two copper tracks are touching.",
		);
	});

	test("puts unknown fault kinds at the end", () => {
		const faults = [
			buildTestFault("unknown_custom", "f-custom"),
			buildTestFault("short_nets", "f-short"),
		];
		const steps = buildTour(faults);
		assert.equal(steps[0].id, "healthy");
		assert.deepEqual(
			[steps[1].fault.kind, steps[2].fault.kind],
			["short_nets", "unknown_custom"],
		);
	});
});

describe("tourModel - stepVerdict", () => {
	const healthy = {
		partCurrents: {
			R1: 0.02,
			D1: 0.02,
			V1: -0.02,
		},
	};

	const STEP_VERDICT_CASES = [
		{
			name: "returns 'survives' when currents stay within normal bounds",
			faulty: { R1: 0.021, D1: 0.021, V1: -0.021 },
			verdict: "survives",
			pattern: /survived|safe|within/i,
		},
		{
			name: "returns 'gets damaged' when any part current exceeds 2x healthy",
			faulty: { R1: 0.045, D1: 0.02, V1: -0.045 },
			verdict: "gets damaged",
			pattern: /damage|overload|burn|exceed/i,
		},
		{
			name: "returns 'gets damaged' when part current exceeds rating",
			faulty: { R1: 0.028, D1: 0.035 },
			opts: { D1: 0.03 },
			verdict: "gets damaged",
			pattern: /rating|damage|limit/i,
			extraOpts: { D1: { maxCurrentA: 0.03 } },
		},
		{
			name: "handles negative currents from SPICE using absolute values",
			faulty: { R1: 0.02, D1: 0.02, V1: -0.08 },
			verdict: "gets damaged",
		},
		{
			name: "returns 'stops working' when key load current drops below 10%",
			faulty: { R1: 0.001, D1: 0.0005, V1: -0.001 },
			verdict: "stops working",
			pattern: /stopped working|power|load/i,
		},
		{
			name: "respects explicit keyLoad option",
			healthy: { MAIN_LOAD: 0.1, AUX: 0.05 },
			faulty: { MAIN_LOAD: 0.005, AUX: 0.05 },
			opts: { keyLoad: "MAIN_LOAD" },
			verdict: "stops working",
		},
		{
			name: "prioritizes 'gets damaged' over 'stops working' if both conditions occur",
			faulty: { R1: 0.08, D1: 0.0 },
			verdict: "gets damaged",
		},
		{
			name: "handles null or missing simulation results gracefully",
			custom: () => {
				const resNullFaulty = stepVerdict(healthy, null);
				verifyVerdict(resNullFaulty, "stops working");

				const resNullHealthy = stepVerdict(null, {
					partCurrents: { D1: 0.05 },
				});
				const allowed = new Set(["survives", "stops working", "gets damaged"]);
				assert.ok(allowed.has(resNullHealthy.verdict));
			},
		},
	];

	for (const tc of STEP_VERDICT_CASES) {
		test(tc.name, () => {
			if (tc.custom) {
				tc.custom();
				return;
			}
			const h = tc.healthy ? { partCurrents: tc.healthy } : healthy;
			const f = tc.faulty ? { partCurrents: tc.faulty } : null;
			const res = stepVerdict(h, f, tc.opts);
			verifyVerdict(res, tc.verdict, tc.pattern);
			if (tc.extraOpts) {
				const resObj = stepVerdict(h, f, tc.extraOpts);
				assert.equal(resObj.verdict, tc.verdict);
			}
		});
	}
});

describe("tourModel - tourSummary", () => {
	const TOUR_SUMMARY_CASES = [
		{
			name: "formats score as 'x of y problems your board handles'",
			verdicts: [
				buildVerdict("healthy", "survives"),
				buildVerdict("f1", "survives"),
				buildVerdict("f2", "gets damaged"),
				buildVerdict("f3", "survives"),
			],
			score: "2 of 3 problems your board handles",
			verifier: (tips) => Array.isArray(tips) && tips.length > 0,
		},
		{
			name: "handles string array of verdicts",
			verdicts: ["survives", "stops working", "survives", "survives"],
			score: "3 of 4 problems your board handles",
		},
		{
			name: "handles empty or null verdicts gracefully",
			runs: [
				{
					input: [],
					score: "0 of 0 problems your board handles",
					verifier: (tips) => tips.length > 0,
				},
				{ input: null, score: "0 of 0 problems your board handles" },
			],
		},
		{
			name: "handles all problems surviving with praise tips",
			verdicts: ["survives", "survives"],
			score: "2 of 2 problems your board handles",
			verifier: /all|survived|great/i,
		},
		{
			name: "handles damaged and stopped problems with helpful protection tips",
			verdicts: ["gets damaged", "stops working"],
			score: "0 of 2 problems your board handles",
			verifier: /resistor|fuse|protect/i,
		},
	];

	for (const tc of TOUR_SUMMARY_CASES) {
		test(tc.name, () => {
			const runs = tc.runs ?? [
				{
					input: tc.verdicts,
					score: tc.score,
					verifier: tc.verifier,
				},
			];
			for (const r of runs) {
				verifySummary(tourSummary(r.input), r.score, r.verifier);
			}
		});
	}
});
