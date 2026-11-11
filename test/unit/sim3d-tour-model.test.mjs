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
			{ kind: "value_drift", id: "f-drift" },
			{ kind: "open_trace", id: "f-open-trace" },
			{ kind: "short_nets", id: "f-short-nets" },
			{ kind: "missing_ground", id: "f-ground" },
			{ kind: "overvoltage", id: "f-overvolt" },
			{ kind: "part_open", id: "f-part-open" },
			{ kind: "reverse_polarity", id: "f-rev-pol" },
			{ kind: "part_short", id: "f-part-short" },
		];

		const steps = buildTour(inputFaults);
		checkStepCountAndHealthyFirst(steps, 9);

		const orderedKinds = steps.slice(1).map((s) => s.fault?.kind);
		assert.deepEqual(orderedKinds, EXPECTED_SEVERITY_ORDER);
	});

	test("uses info label and plainEnglish when provided on fault", () => {
		const faults = [
			{
				kind: "short_nets",
				id: "f1",
				info: {
					label: "Short Circuit",
					plainEnglish: "Two copper tracks are touching.",
				},
			},
		];
		const steps = buildTour(faults);
		assert.equal(steps[1].title, "Short Circuit");
		assert.equal(steps[1].intro, "Two copper tracks are touching.");
		assert.ok(steps[1].question.length > 0);
	});

	test("puts unknown fault kinds at the end", () => {
		const faults = [
			{ kind: "unknown_custom", id: "f-custom" },
			{ kind: "short_nets", id: "f-short" },
		];
		const steps = buildTour(faults);
		assert.equal(steps[0].id, "healthy");
		assert.equal(steps[1].fault.kind, "short_nets");
		assert.equal(steps[2].fault.kind, "unknown_custom");
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
				{ id: "healthy", verdict: "survives" },
				{ id: "f1", verdict: "survives" },
				{ id: "f2", verdict: "gets damaged" },
				{ id: "f3", verdict: "survives" },
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
