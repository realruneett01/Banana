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

const diffParts = (before = [], after = []) =>
	diffIr(makeDesign(before), makeDesign(after));

const diffNets = (before = [], after = []) =>
	diffIr(makeDesign([], before), makeDesign([], after));

// Each case: { title, bucket, before?, after?, value, summary }; before/after
// are item overrides (omitted = no item on that side). Parts are keyed by ref,
// nets by name.
function defineSingleItemCases(group, cases) {
	const [make, diffFn, key] =
		group === "parts"
			? [makePart, diffParts, "ref"]
			: [makeNet, diffNets, "name"];
	const toList = (overrides) => (overrides ? [make(overrides)] : []);
	for (const { title, bucket, before, after, value, summary } of cases) {
		test(title, () => {
			const result = diffFn(toList(before), toList(after));
			assertSingleItem(result, group, bucket, { key, value, summary });
		});
	}
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
		const pinList = changed[checks.pinKey];
		assert.deepEqual(pinList[0], checks.pin);
		const pinCount = pinList.length;
		assert.equal(pinCount, 1);
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
	assert.equal(result.summary, "No changes");
	const emptyStatus = result.isEmpty;
	assert.equal(emptyStatus, true);
}

function assertNoDiffCounts(result) {
	assertEmptyDiff(result);
	for (const key of ["added", "removed", "changed"]) {
		assert.equal(result.parts[key].length, 0);
		assert.equal(result.nets[key].length, 0);
	}
}

function makeMultiChangeBefore() {
	return {
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
}

function makeMultiChangeAfter() {
	return {
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
}

describe("irDiff - parts", () => {
	defineSingleItemCases("parts", [
		{
			title: "detects added part",
			bucket: "added",
			after: { id: "part_added", ref: "C1" },
			value: "C1",
			summary: "1 part added",
		},
		{
			title: "detects removed part",
			bucket: "removed",
			before: { id: "part_rm", ref: "R1" },
			value: "R1",
			summary: "1 part removed",
		},
	]);

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
		{
			title: "detects deep placement changes",
			field: "placement",
			before: { x: 10, y: 20, rot: 0, side: "F" },
			after: { x: 10, y: 20, rot: 90, side: "F" },
		},
		{
			title: "detects deep props changes",
			field: "props",
			before: { sub: { key: "v1" } },
			after: { sub: { key: "v2" } },
		},
	];

	for (const tc of FIELD_CASES) {
		const title = tc.title ?? `detects compared field change: ${tc.field}`;
		test(title, () => {
			const result = diffParts(
				[makePart({ [tc.field]: tc.before })],
				[makePart({ [tc.field]: tc.after })],
			);
			assertPartFieldChange(result, tc);
		});
	}
});

describe("irDiff - nets", () => {
	const VCC_NET = { id: "net_vcc", name: "VCC" };
	defineSingleItemCases("nets", [
		{
			title: "detects added net",
			bucket: "added",
			after: VCC_NET,
			value: "VCC",
			summary: "1 net added",
		},
		{
			title: "detects removed net",
			bucket: "removed",
			before: VCC_NET,
			value: "VCC",
			summary: "1 net removed",
		},
	]);

	const PINS_SINGLE = [{ partId: "part_1", pin: "1" }];
	const PINS_PAIR = [
		{ partId: "part_1", pin: "1" },
		{ partId: "part_2", pin: "1" },
	];
	const PIN_CHANGE_CASES = [
		{
			title: "detects added pin on net",
			before: PINS_SINGLE,
			after: PINS_PAIR,
			checks: {
				pinKey: "addedPins",
				pin: { partId: "part_2", pin: "1" },
				renamedFrom: undefined,
				summary: "1 connection added",
			},
		},
		{
			title: "detects removed pin on net",
			before: PINS_PAIR,
			after: PINS_SINGLE,
			checks: {
				pinKey: "removedPins",
				pin: { partId: "part_2", pin: "1" },
				summary: "1 connection removed",
			},
		},
	];

	for (const tc of PIN_CHANGE_CASES) {
		test(tc.title, () => {
			const result = diffNets(
				[makeNet({ pins: tc.before })],
				[makeNet({ pins: tc.after })],
			);
			assertSingleNetChange(result, tc.checks);
		});
	}

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

	const EMPTY_INPUT_PAIRS = [
		[null, null],
		[undefined, undefined],
		["invalid", 42],
		[null, { parts: [], nets: [] }],
	];

	test("null and non-object inputs treated as empty design", () => {
		for (const [before, after] of EMPTY_INPUT_PAIRS) {
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
		const result = diffIr(makeMultiChangeBefore(), makeMultiChangeAfter());
		assert.equal(
			result.summary,
			"2 parts added, 1 part removed, 1 value changed, 1 connection removed",
		);
		assert.equal(summarizeIrDiff(result), result.summary);
		assert.equal(summarizeIrDiff(null), "No changes");
	});
});
