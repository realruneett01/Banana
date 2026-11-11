import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildTour,
	stepVerdict,
	tourSummary,
} from "../../frontend/src/components/sim3d/tourModel.js";

describe("tourModel - buildTour", () => {
	test("returns healthy circuit step as first step when faults is empty or null", () => {
		const stepsEmpty = buildTour([]);
		assert.equal(stepsEmpty.length, 1);
		assert.equal(stepsEmpty[0].id, "healthy");
		assert.equal(stepsEmpty[0].fault, null);
		assert.ok(stepsEmpty[0].title);
		assert.ok(stepsEmpty[0].intro);
		assert.ok(stepsEmpty[0].question);

		const stepsNull = buildTour(null);
		assert.equal(stepsNull.length, 1);
		assert.equal(stepsNull[0].id, "healthy");
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
		assert.equal(steps.length, 9);
		assert.equal(steps[0].id, "healthy");

		const orderedKinds = steps.slice(1).map((s) => s.fault?.kind);
		const expectedOrder = [
			"short_nets",
			"overvoltage",
			"reverse_polarity",
			"missing_ground",
			"part_short",
			"open_trace",
			"part_open",
			"value_drift",
		];
		assert.deepEqual(orderedKinds, expectedOrder);
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

	test("returns 'survives' when currents stay within normal bounds", () => {
		const faulty = {
			partCurrents: {
				R1: 0.021,
				D1: 0.021,
				V1: -0.021,
			},
		};
		const res = stepVerdict(healthy, faulty);
		assert.equal(res.verdict, "survives");
		assert.match(res.text, /survived|safe|within/i);
	});

	test("returns 'gets damaged' when any part current exceeds 2x healthy", () => {
		const faulty = {
			partCurrents: {
				R1: 0.045,
				D1: 0.02,
				V1: -0.045,
			},
		};
		const res = stepVerdict(healthy, faulty);
		assert.equal(res.verdict, "gets damaged");
		assert.match(res.text, /damage|overload|burn|exceed/i);
	});

	test("returns 'gets damaged' when part current exceeds rating", () => {
		const faulty = {
			partCurrents: {
				R1: 0.028,
				D1: 0.035,
			},
		};
		const ratings = {
			D1: 0.03,
		};
		const res = stepVerdict(healthy, faulty, ratings);
		assert.equal(res.verdict, "gets damaged");
		assert.match(res.text, /rating|damage|limit/i);

		const resObj = stepVerdict(healthy, faulty, {
			D1: { maxCurrentA: 0.03 },
		});
		assert.equal(resObj.verdict, "gets damaged");
	});

	test("handles negative currents from SPICE using absolute values", () => {
		const faulty = {
			partCurrents: {
				R1: 0.02,
				D1: 0.02,
				V1: -0.08,
			},
		};
		const res = stepVerdict(healthy, faulty);
		assert.equal(res.verdict, "gets damaged");
	});

	test("returns 'stops working' when key load current drops below 10%", () => {
		const faulty = {
			partCurrents: {
				R1: 0.001,
				D1: 0.0005,
				V1: -0.001,
			},
		};
		const res = stepVerdict(healthy, faulty);
		assert.equal(res.verdict, "stops working");
		assert.match(res.text, /stopped working|power|load/i);
	});

	test("respects explicit keyLoad option", () => {
		const customHealthy = {
			partCurrents: {
				MAIN_LOAD: 0.1,
				AUX: 0.05,
			},
		};
		const customFaulty = {
			partCurrents: {
				MAIN_LOAD: 0.005,
				AUX: 0.05,
			},
		};
		const res = stepVerdict(customHealthy, customFaulty, {
			keyLoad: "MAIN_LOAD",
		});
		assert.equal(res.verdict, "stops working");
	});

	test("prioritizes 'gets damaged' over 'stops working' if both conditions occur", () => {
		const faulty = {
			partCurrents: {
				R1: 0.08,
				D1: 0.0,
			},
		};
		const res = stepVerdict(healthy, faulty);
		assert.equal(res.verdict, "gets damaged");
	});

	test("handles null or missing simulation results gracefully", () => {
		const resNullFaulty = stepVerdict(healthy, null);
		assert.equal(resNullFaulty.verdict, "stops working");

		const resNullHealthy = stepVerdict(null, { partCurrents: { D1: 0.05 } });
		assert.ok(
			["survives", "stops working", "gets damaged"].includes(
				resNullHealthy.verdict,
			),
		);
	});
});

describe("tourModel - tourSummary", () => {
	test("formats score as 'x of y problems your board handles'", () => {
		const verdicts = [
			{ id: "healthy", verdict: "survives" },
			{ id: "f1", verdict: "survives" },
			{ id: "f2", verdict: "gets damaged" },
			{ id: "f3", verdict: "survives" },
		];
		const summary = tourSummary(verdicts);
		assert.equal(summary.score, "2 of 3 problems your board handles");
		assert.ok(Array.isArray(summary.tips));
		assert.ok(summary.tips.length > 0);
	});

	test("handles string array of verdicts", () => {
		const verdicts = ["survives", "stops working", "survives", "survives"];
		const summary = tourSummary(verdicts);
		assert.equal(summary.score, "3 of 4 problems your board handles");
	});

	test("handles empty or null verdicts gracefully", () => {
		const summaryEmpty = tourSummary([]);
		assert.equal(summaryEmpty.score, "0 of 0 problems your board handles");
		assert.ok(summaryEmpty.tips.length > 0);

		const summaryNull = tourSummary(null);
		assert.equal(summaryNull.score, "0 of 0 problems your board handles");
	});

	test("handles all problems surviving with praise tips", () => {
		const verdicts = ["survives", "survives"];
		const summary = tourSummary(verdicts);
		assert.equal(summary.score, "2 of 2 problems your board handles");
		assert.ok(summary.tips.some((tip) => /all|survived|great/i.test(tip)));
	});

	test("handles damaged and stopped problems with helpful protection tips", () => {
		const verdicts = ["gets damaged", "stops working"];
		const summary = tourSummary(verdicts);
		assert.equal(summary.score, "0 of 2 problems your board handles");
		assert.ok(summary.tips.some((tip) => /resistor|fuse|protect/i.test(tip)));
	});
});
