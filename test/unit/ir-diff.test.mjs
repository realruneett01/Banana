import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffIr, summarizeIrDiff } from "../../frontend/src/irDiff.js";

const BASE_PART = {
	id: "part_1",
	ref: "R1",
	value: "10k",
	footprint: "Resistor_SMD:R_0402",
	placement: { x: 0, y: 0, rot: 0, side: "F" },
	props: { tolerance: "5%" },
};

const BASE_NET = {
	id: "net_1",
	name: "GND",
	pins: [{ partId: "part_1", pin: "1" }],
};

const makePart = (overrides = {}) => ({ ...BASE_PART, ...overrides });
const makeNet = (overrides = {}) => ({ ...BASE_NET, ...overrides });
const makeDesign = (parts = [], nets = []) => ({ parts, nets });

function diffParts(before = [], after = []) {
	return diffIr(makeDesign(before), makeDesign(after));
}

function diffNets(before = [], after = []) {
	return diffIr(makeDesign([], before), makeDesign([], after));
}

function assertSingleItem(result, group, bucket, spec) {
	assert.equal(result.isEmpty, false);
	const target = result[group][bucket];
	assert.equal(target.length, 1);
	assert.equal(target[0][spec.key], spec.value);
	assert.equal(result.summary, spec.summary);
}

function assertPartFieldChange(result, expected) {
	if (expected.isEmpty !== undefined) {
		assert.equal(result.isEmpty, expected.isEmpty);
	}
	assert.equal(result.parts.changed.length, 1);
	const target = result.parts.changed[0];
	if (expected.id !== undefined) assert.equal(target.id, expected.id);
	if (expected.ref !== undefined) assert.equal(target.ref, expected.ref);
	assert.deepEqual(target.fields, [
		{ field: expected.field, before: expected.before, after: expected.after },
	]);
	if (expected.summary !== undefined) {
		assert.equal(result.summary, expected.summary);
	}
}

function assertSingleNetChange(result, checks) {
	assert.equal(result.nets.changed.length, 1);
	const changed = result.nets.changed[0];
	if (checks.pinKey) {
		assert.equal(changed[checks.pinKey].length, 1);
		assert.deepEqual(changed[checks.pinKey][0], checks.pin);
	}
	if (checks.name !== undefined) {
		assert.equal(changed.name, checks.name);
	}
	if ("renamedFrom" in checks) {
		assert.equal(changed.renamedFrom, checks.renamedFrom);
	}
	assert.equal(result.summary, checks.summary);
}

function assertEmptyDiff(result) {
	assert.equal(result.isEmpty, true);
	assert.equal(result.summary, "No changes");
}

function assertNoDiffCounts(result) {
	assertEmptyDiff(result);
	for (const key of ["added", "removed", "changed"]) {
		assert.equal(result.parts[key].length, 0);
		assert.equal(result.nets[key].length, 0);
	}
}

describe("irDiff - parts", () => {
	test("detects added part", () => {
		const result = diffParts([], [makePart({ id: "part_added", ref: "C1" })]);
		assertSingleItem(result, "parts", "added", {
			key: "ref",
			value: "C1",
			summary: "1 part added",
		});
	});

	test("detects removed part", () => {
		const result = diffParts([makePart({ id: "part_rm", ref: "R1" })], []);
		assertSingleItem(result, "parts", "removed", {
			key: "ref",
			value: "R1",
			summary: "1 part removed",
		});
	});

	test("detects changed part metadata", () => {
		const result = diffParts(
			[makePart({ id: "part_1", ref: "R1", value: "10k" })],
			[makePart({ id: "part_1", ref: "R1", value: "20k" })],
		);
		assertPartFieldChange(result, {
			isEmpty: false,
			id: "part_1",
			ref: "R1",
			field: "value",
			before: "10k",
			after: "20k",
			summary: "1 value changed",
		});
	});

	const FIELD_CASES = [
		{ field: "ref", before: "R1", after: "R2", summary: "1 ref changed" },
		{
			field: "value",
			before: "10k",
			after: "20k",
			summary: "1 value changed",
		},
		{
			field: "footprint",
			before: "R_0402",
			after: "R_0603",
			summary: "1 footprint changed",
		},
		{
			field: "placement",
			before: { x: 0, y: 0, rot: 0, side: "F" },
			after: { x: 5, y: 5, rot: 0, side: "F" },
			summary: "1 placement changed",
		},
		{
			field: "props",
			before: { tolerance: "5%" },
			after: { tolerance: "1%" },
			summary: "1 prop changed",
		},
	];

	for (const tc of FIELD_CASES) {
		test(`detects compared field change: ${tc.field}`, () => {
			const result = diffParts(
				[makePart({ [tc.field]: tc.before })],
				[makePart({ [tc.field]: tc.after })],
			);
			assertPartFieldChange(result, tc);
		});
	}

	test("detects deep placement changes", () => {
		const result = diffParts(
			[makePart({ placement: { x: 10, y: 20, rot: 0, side: "F" } })],
			[makePart({ placement: { x: 10, y: 20, rot: 90, side: "F" } })],
		);
		assertPartFieldChange(result, {
			field: "placement",
			before: { x: 10, y: 20, rot: 0, side: "F" },
			after: { x: 10, y: 20, rot: 90, side: "F" },
		});
	});

	test("detects deep props changes", () => {
		const result = diffParts(
			[makePart({ props: { sub: { key: "v1" } } })],
			[makePart({ props: { sub: { key: "v2" } } })],
		);
		assertPartFieldChange(result, {
			field: "props",
			before: { sub: { key: "v1" } },
			after: { sub: { key: "v2" } },
		});
	});
});

describe("irDiff - nets", () => {
	test("detects added net", () => {
		const result = diffNets([], [makeNet({ id: "net_vcc", name: "VCC" })]);
		assertSingleItem(result, "nets", "added", {
			key: "name",
			value: "VCC",
			summary: "1 net added",
		});
	});

	test("detects removed net", () => {
		const result = diffNets([makeNet({ id: "net_vcc", name: "VCC" })], []);
		assertSingleItem(result, "nets", "removed", {
			key: "name",
			value: "VCC",
			summary: "1 net removed",
		});
	});

	test("detects added pin on net", () => {
		const result = diffNets(
			[makeNet({ pins: [{ partId: "part_1", pin: "1" }] })],
			[
				makeNet({
					pins: [
						{ partId: "part_1", pin: "1" },
						{ partId: "part_2", pin: "1" },
					],
				}),
			],
		);
		assertSingleNetChange(result, {
			pinKey: "addedPins",
			pin: { partId: "part_2", pin: "1" },
			renamedFrom: undefined,
			summary: "1 connection added",
		});
	});

	test("detects removed pin on net", () => {
		const result = diffNets(
			[
				makeNet({
					pins: [
						{ partId: "part_1", pin: "1" },
						{ partId: "part_2", pin: "1" },
					],
				}),
			],
			[makeNet({ pins: [{ partId: "part_1", pin: "1" }] })],
		);
		assertSingleNetChange(result, {
			pinKey: "removedPins",
			pin: { partId: "part_2", pin: "1" },
			summary: "1 connection removed",
		});
	});

	test("detects net rename", () => {
		const result = diffNets(
			[makeNet({ id: "net_1", name: "OLD_NET" })],
			[makeNet({ id: "net_1", name: "NEW_NET" })],
		);
		assertSingleNetChange(result, {
			name: "NEW_NET",
			renamedFrom: "OLD_NET",
			summary: "1 net renamed",
		});
	});
});

describe("irDiff - edge cases and invariants", () => {
	test("identical designs give isEmpty true and No changes", () => {
		const design = makeDesign(
			[makePart({ id: "part_1", ref: "R1" })],
			[makeNet({ id: "net_1", name: "GND" })],
		);
		assertNoDiffCounts(diffIr(design, design));
	});

	test("null and non-object inputs treated as empty design", () => {
		const cases = [
			[null, null],
			[undefined, undefined],
			["invalid", 42],
			[null, { parts: [], nets: [] }],
		];
		for (const [before, after] of cases) {
			assertEmptyDiff(diffIr(before, after));
		}
	});

	test("inputs are not mutated", () => {
		const part = Object.freeze(
			makePart({ placement: Object.freeze({ x: 0, y: 0, rot: 0, side: "F" }) }),
		);
		const net = Object.freeze(
			makeNet({ pins: Object.freeze([{ partId: "part_1", pin: "1" }]) }),
		);
		const before = Object.freeze({
			parts: Object.freeze([part]),
			nets: Object.freeze([net]),
		});
		const after = Object.freeze({
			parts: Object.freeze([]),
			nets: Object.freeze([]),
		});

		assert.doesNotThrow(() => {
			diffIr(before, after);
		});
	});

	test("deterministic ordering of parts and nets", () => {
		const result = diffIr(
			makeDesign(),
			makeDesign(
				[
					makePart({ id: "p3", ref: "U1" }),
					makePart({ id: "p1", ref: "C2" }),
					makePart({ id: "p2", ref: "C1" }),
				],
				[
					makeNet({ id: "n3", name: "VCC" }),
					makeNet({ id: "n1", name: "CLK" }),
					makeNet({ id: "n2", name: "DATA" }),
				],
			),
		);

		assert.deepEqual(
			result.parts.added.map((p) => p.ref),
			["C1", "C2", "U1"],
		);
		assert.deepEqual(
			result.nets.added.map((n) => n.name),
			["CLK", "DATA", "VCC"],
		);
	});

	test("summarizeIrDiff formats complex multi-change sentence", () => {
		const before = {
			parts: [
				makePart({ id: "p_rm", ref: "R9" }),
				makePart({ id: "p_mod", ref: "R1", value: "10k" }),
			],
			nets: [
				makeNet({
					id: "n_mod",
					name: "SIG",
					pins: [
						{ partId: "p1", pin: "1" },
						{ partId: "p2", pin: "2" },
					],
				}),
			],
		};
		const after = {
			parts: [
				makePart({ id: "p_mod", ref: "R1", value: "20k" }),
				makePart({ id: "p_add1", ref: "C1" }),
				makePart({ id: "p_add2", ref: "C2" }),
			],
			nets: [
				makeNet({
					id: "n_mod",
					name: "SIG",
					pins: [{ partId: "p1", pin: "1" }],
				}),
			],
		};
		const result = diffIr(before, after);

		assert.equal(
			result.summary,
			"2 parts added, 1 part removed, 1 value changed, 1 connection removed",
		);
		assert.equal(summarizeIrDiff(result), result.summary);
		assert.equal(summarizeIrDiff(null), "No changes");
	});
});
