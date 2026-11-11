import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffIr, summarizeIrDiff } from "../../frontend/src/irDiff.js";

function makePart(overrides = {}) {
	return {
		id: "part_1",
		ref: "R1",
		value: "10k",
		footprint: "Resistor_SMD:R_0402",
		placement: { x: 0, y: 0, rot: 0, side: "F" },
		props: { tolerance: "5%" },
		...overrides,
	};
}

function makeNet(overrides = {}) {
	return {
		id: "net_1",
		name: "GND",
		pins: [{ partId: "part_1", pin: "1" }],
		...overrides,
	};
}

describe("irDiff - parts", () => {
	test("detects added part", () => {
		const before = { parts: [], nets: [] };
		const after = {
			parts: [makePart({ id: "part_added", ref: "C1" })],
			nets: [],
		};
		const result = diffIr(before, after);

		assert.equal(result.isEmpty, false);
		assert.equal(result.parts.added.length, 1);
		assert.equal(result.parts.added[0].ref, "C1");
		assert.equal(result.summary, "1 part added");
	});

	test("detects removed part", () => {
		const before = {
			parts: [makePart({ id: "part_rm", ref: "R1" })],
			nets: [],
		};
		const after = { parts: [], nets: [] };
		const result = diffIr(before, after);

		assert.equal(result.isEmpty, false);
		assert.equal(result.parts.removed.length, 1);
		assert.equal(result.parts.removed[0].ref, "R1");
		assert.equal(result.summary, "1 part removed");
	});

	test("detects changed part metadata", () => {
		const before = {
			parts: [makePart({ id: "part_1", ref: "R1", value: "10k" })],
			nets: [],
		};
		const after = {
			parts: [makePart({ id: "part_1", ref: "R1", value: "20k" })],
			nets: [],
		};
		const result = diffIr(before, after);

		assert.equal(result.isEmpty, false);
		assert.equal(result.parts.changed.length, 1);
		assert.equal(result.parts.changed[0].id, "part_1");
		assert.equal(result.parts.changed[0].ref, "R1");
		assert.deepEqual(result.parts.changed[0].fields, [
			{ field: "value", before: "10k", after: "20k" },
		]);
		assert.equal(result.summary, "1 value changed");
	});

	const FIELD_CASES = [
		{ field: "ref", beforeVal: "R1", afterVal: "R2", summary: "1 ref changed" },
		{
			field: "value",
			beforeVal: "10k",
			afterVal: "20k",
			summary: "1 value changed",
		},
		{
			field: "footprint",
			beforeVal: "R_0402",
			afterVal: "R_0603",
			summary: "1 footprint changed",
		},
		{
			field: "placement",
			beforeVal: { x: 0, y: 0, rot: 0, side: "F" },
			afterVal: { x: 5, y: 5, rot: 0, side: "F" },
			summary: "1 placement changed",
		},
		{
			field: "props",
			beforeVal: { tolerance: "5%" },
			afterVal: { tolerance: "1%" },
			summary: "1 prop changed",
		},
	];

	for (const { field, beforeVal, afterVal, summary } of FIELD_CASES) {
		test(`detects compared field change: ${field}`, () => {
			const before = { parts: [makePart({ [field]: beforeVal })], nets: [] };
			const after = { parts: [makePart({ [field]: afterVal })], nets: [] };
			const result = diffIr(before, after);

			assert.equal(result.parts.changed.length, 1);
			assert.deepEqual(result.parts.changed[0].fields, [
				{ field, before: beforeVal, after: afterVal },
			]);
			assert.equal(result.summary, summary);
		});
	}

	test("detects deep placement changes", () => {
		const before = {
			parts: [makePart({ placement: { x: 10, y: 20, rot: 0, side: "F" } })],
			nets: [],
		};
		const after = {
			parts: [makePart({ placement: { x: 10, y: 20, rot: 90, side: "F" } })],
			nets: [],
		};
		const result = diffIr(before, after);

		assert.equal(result.parts.changed.length, 1);
		assert.deepEqual(result.parts.changed[0].fields[0], {
			field: "placement",
			before: { x: 10, y: 20, rot: 0, side: "F" },
			after: { x: 10, y: 20, rot: 90, side: "F" },
		});
	});

	test("detects deep props changes", () => {
		const before = {
			parts: [makePart({ props: { sub: { key: "v1" } } })],
			nets: [],
		};
		const after = {
			parts: [makePart({ props: { sub: { key: "v2" } } })],
			nets: [],
		};
		const result = diffIr(before, after);

		assert.equal(result.parts.changed.length, 1);
		assert.deepEqual(result.parts.changed[0].fields[0], {
			field: "props",
			before: { sub: { key: "v1" } },
			after: { sub: { key: "v2" } },
		});
	});
});

describe("irDiff - nets", () => {
	test("detects added net", () => {
		const before = { parts: [], nets: [] };
		const after = {
			parts: [],
			nets: [makeNet({ id: "net_vcc", name: "VCC" })],
		};
		const result = diffIr(before, after);

		assert.equal(result.isEmpty, false);
		assert.equal(result.nets.added.length, 1);
		assert.equal(result.nets.added[0].name, "VCC");
		assert.equal(result.summary, "1 net added");
	});

	test("detects removed net", () => {
		const before = {
			parts: [],
			nets: [makeNet({ id: "net_vcc", name: "VCC" })],
		};
		const after = { parts: [], nets: [] };
		const result = diffIr(before, after);

		assert.equal(result.isEmpty, false);
		assert.equal(result.nets.removed.length, 1);
		assert.equal(result.nets.removed[0].name, "VCC");
		assert.equal(result.summary, "1 net removed");
	});

	test("detects added pin on net", () => {
		const before = {
			parts: [],
			nets: [makeNet({ pins: [{ partId: "part_1", pin: "1" }] })],
		};
		const after = {
			parts: [],
			nets: [
				makeNet({
					pins: [
						{ partId: "part_1", pin: "1" },
						{ partId: "part_2", pin: "1" },
					],
				}),
			],
		};
		const result = diffIr(before, after);

		assert.equal(result.nets.changed.length, 1);
		assert.equal(result.nets.changed[0].addedPins.length, 1);
		assert.deepEqual(result.nets.changed[0].addedPins[0], {
			partId: "part_2",
			pin: "1",
		});
		assert.equal(result.nets.changed[0].renamedFrom, undefined);
		assert.equal(result.summary, "1 connection added");
	});

	test("detects removed pin on net", () => {
		const before = {
			parts: [],
			nets: [
				makeNet({
					pins: [
						{ partId: "part_1", pin: "1" },
						{ partId: "part_2", pin: "1" },
					],
				}),
			],
		};
		const after = {
			parts: [],
			nets: [makeNet({ pins: [{ partId: "part_1", pin: "1" }] })],
		};
		const result = diffIr(before, after);

		assert.equal(result.nets.changed.length, 1);
		assert.equal(result.nets.changed[0].removedPins.length, 1);
		assert.deepEqual(result.nets.changed[0].removedPins[0], {
			partId: "part_2",
			pin: "1",
		});
		assert.equal(result.summary, "1 connection removed");
	});

	test("detects net rename", () => {
		const before = {
			parts: [],
			nets: [makeNet({ id: "net_1", name: "OLD_NET" })],
		};
		const after = {
			parts: [],
			nets: [makeNet({ id: "net_1", name: "NEW_NET" })],
		};
		const result = diffIr(before, after);

		assert.equal(result.nets.changed.length, 1);
		assert.equal(result.nets.changed[0].name, "NEW_NET");
		assert.equal(result.nets.changed[0].renamedFrom, "OLD_NET");
		assert.equal(result.summary, "1 net renamed");
	});
});

describe("irDiff - edge cases and invariants", () => {
	test("identical designs give isEmpty true and No changes", () => {
		const design = {
			parts: [makePart({ id: "part_1", ref: "R1" })],
			nets: [makeNet({ id: "net_1", name: "GND" })],
		};
		const result = diffIr(design, design);

		assert.equal(result.isEmpty, true);
		assert.equal(result.parts.added.length, 0);
		assert.equal(result.parts.removed.length, 0);
		assert.equal(result.parts.changed.length, 0);
		assert.equal(result.nets.added.length, 0);
		assert.equal(result.nets.removed.length, 0);
		assert.equal(result.nets.changed.length, 0);
		assert.equal(result.summary, "No changes");
	});

	test("null and non-object inputs treated as empty design", () => {
		const cases = [
			[null, null],
			[undefined, undefined],
			["invalid", 42],
			[null, { parts: [], nets: [] }],
		];
		for (const [before, after] of cases) {
			const result = diffIr(before, after);
			assert.equal(result.isEmpty, true);
			assert.equal(result.summary, "No changes");
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
		const before = { parts: [], nets: [] };
		const after = {
			parts: [
				makePart({ id: "p3", ref: "U1" }),
				makePart({ id: "p1", ref: "C2" }),
				makePart({ id: "p2", ref: "C1" }),
			],
			nets: [
				makeNet({ id: "n3", name: "VCC" }),
				makeNet({ id: "n1", name: "CLK" }),
				makeNet({ id: "n2", name: "DATA" }),
			],
		};
		const result = diffIr(before, after);

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
