import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const place = (x, y, rot = 0, side = "F") => ({ x, y, rot, side });

function createPart(patch = {}) {
	return {
		id: "part_1",
		ref: "R1",
		value: "10k",
		footprint: "Resistor_SMD:R_0603",
		placement: place(0, 0),
		props: {},
		...patch,
	};
}

function createIr({ parts = [], nets = [] } = {}) {
	return { parts, nets };
}

function singleComponentIr(patch = {}) {
	return createIr({ parts: [createPart(patch)] });
}

function buildNetWithPins(name, pinTuples) {
	return {
		id: `net_${name.toLowerCase()}`,
		name,
		pins: pinTuples.map(([partId, pin]) => ({ partId, pin })),
	};
}

function freezeIr(overrides) {
	const frozenPart = Object.freeze(
		createPart({
			...overrides,
			placement: Object.freeze(overrides.placement),
			props: Object.freeze({}),
		}),
	);
	return Object.freeze({
		parts: [frozenPart],
		nets: [
			Object.freeze({ id: "net_gnd", name: "GND", pins: Object.freeze([]) }),
		],
	});
}

const moveCase = (name, beforeAt, afterAt, rot) => ({
	name,
	before: singleComponentIr({ placement: beforeAt }),
	after: singleComponentIr({ placement: afterAt }),
	canSaveInPlace: true,
	sch: [],
	pcb: [{ op: "move", ref: "R1", x: afterAt.x, y: afterAt.y, rot }],
	summary: "1 position will be saved",
});

const unsupp = (name, before, after, expectedSentence) => ({
	name,
	before,
	after,
	expectedSentence,
});

const emptyCase = (name, before, after) => ({
	name,
	before,
	after,
	canSaveInPlace: false,
	sch: [],
	pcb: [],
	summary: "Nothing to save",
});

function makeRefFixture(values) {
	const items = [
		{ id: "p3", ref: "R3", value: values[0] },
		{ id: "p1", ref: "R1", value: values[1] },
		{ id: "p2", ref: "R2", value: values[2] },
	];
	return createIr({ parts: items.map((p) => createPart(p)) });
}

const SUPPORTED_CASES = [
	{
		name: "value change produces setValue edit in both sch and pcb",
		before: singleComponentIr({ value: "10k" }),
		after: singleComponentIr({ value: "20k" }),
		canSaveInPlace: true,
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [{ op: "setValue", ref: "R1", value: "20k" }],
		summary: "1 value will be saved",
	},
	moveCase(
		"move produces move edit in pcb only",
		place(0, 0),
		place(10, 20),
		0,
	),
	moveCase(
		"rot-only change produces move edit in pcb only",
		place(10, 20),
		place(10, 20, 90),
		90,
	),
	{
		name: "side flip produces a move edit carrying the new side",
		before: singleComponentIr({ placement: place(0, 0) }),
		after: singleComponentIr({ placement: place(0, 0, 0, "B") }),
		canSaveInPlace: true,
		sch: [],
		pcb: [{ op: "move", ref: "R1", x: 0, y: 0, rot: 0, side: "B" }],
		summary: "1 position will be saved",
	},
	{
		name: "value plus move on one part produces edits in both sch and pcb",
		before: singleComponentIr({ value: "10k", placement: place(0, 0) }),
		after: singleComponentIr({ value: "20k", placement: place(10, 20, 90) }),
		canSaveInPlace: true,
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [
			{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 },
			{ op: "setValue", ref: "R1", value: "20k" },
		],
		summary: "1 value and 1 position will be saved",
	},
];

const UNSUPPORTED_CASES = [
	unsupp(
		"added part without library symbol unsupported",
		createIr(),
		singleComponentIr({ id: "r5", ref: "R5" }),
		"R5 has no library symbol",
	),
	unsupp(
		"pin removed from a net unsupported",
		createIr({
			nets: [
				buildNetWithPins("VCC", [
					["p1", "1"],
					["p2", "2"],
				]),
			],
		}),
		createIr({
			nets: [buildNetWithPins("VCC", [["p1", "1"]])],
		}),
		"connection VCC lost a pin",
	),
	unsupp(
		"non-finite coordinates unsupported",
		singleComponentIr({ id: "r1", ref: "R1", placement: place(0, 0) }),
		singleComponentIr({ id: "r1", ref: "R1", placement: place(Number.NaN, 0) }),
		"R1 has non-finite coordinates",
	),
];

const unchangedIr = createIr({
	parts: [createPart()],
	nets: [buildNetWithPins("GND", [["part_1", "1"]])],
});

const EMPTY_CASES = [
	emptyCase(
		"no change returns canSaveInPlace false and Nothing to save",
		unchangedIr,
		unchangedIr,
	),
	emptyCase(
		"null inputs return canSaveInPlace false and Nothing to save",
		null,
		null,
	),
];

function verifyEditResult(actual, expected) {
	assert.deepEqual(
		{
			canSaveInPlace: actual.canSaveInPlace,
			summary: actual.summary,
			sch: actual.sch,
			pcb: actual.pcb,
			unsupported: actual.unsupported,
		},
		{
			canSaveInPlace: expected.canSaveInPlace,
			summary: expected.summary,
			sch: expected.sch,
			pcb: expected.pcb,
			unsupported: [],
		},
	);
}

function runEditCase(tc) {
	test(tc.name, () => {
		const res = editsFromIrChange(tc.before, tc.after);
		verifyEditResult(res, tc);
	});
}

function runUnsupportedCase(tc) {
	test(`unsupported case: ${tc.name}`, () => {
		const res = editsFromIrChange(tc.before, tc.after);
		assert.deepEqual(
			{
				canSaveInPlace: res.canSaveInPlace,
				summary: res.summary,
				hasExpectedSentence: res.unsupported.includes(tc.expectedSentence),
			},
			{
				canSaveInPlace: false,
				summary: "Nothing to save",
				hasExpectedSentence: true,
			},
		);
	});
}

describe("kicadEdits - supported in-place edits", () => {
	for (const tc of SUPPORTED_CASES) {
		runEditCase(tc);
	}

	test("deterministic order sorts edits by ref", () => {
		const before = makeRefFixture(["30k", "10k", "20k"]);
		const after = makeRefFixture(["33k", "11k", "22k"]);
		const res = editsFromIrChange(before, after);
		assert.equal(res.summary, "3 values will be saved");
		assert.deepEqual(
			[res.sch.map((e) => e.ref), res.pcb.map((e) => e.ref)],
			[
				["R1", "R2", "R3"],
				["R1", "R2", "R3"],
			],
		);
	});

	test("inputs are not mutated", () => {
		const before = freezeIr({ value: "10k", placement: place(0, 0) });
		const after = freezeIr({ value: "20k", placement: place(10, 10) });
		const res = editsFromIrChange(before, after);
		assert.deepEqual(
			{
				canSaveInPlace: res.canSaveInPlace,
				beforeVal: before.parts[0].value,
				afterVal: after.parts[0].value,
			},
			{
				canSaveInPlace: true,
				beforeVal: "10k",
				afterVal: "20k",
			},
		);
	});
});

describe("kicadEdits - unsupported and edge cases", () => {
	for (const tc of UNSUPPORTED_CASES) {
		runUnsupportedCase(tc);
	}

	for (const tc of EMPTY_CASES) {
		runEditCase(tc);
	}
});
