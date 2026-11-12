import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyFixToIr } from "../../frontend/src/designFixes.js";

function makeResistor(id, ref, value) {
	return {
		id,
		ref,
		value,
		footprint: "Resistor_SMD:R_0805",
		symbol: "Device:R",
		props: {},
	};
}

function makeTestIr() {
	return {
		schemaVersion: 1,
		name: "test-circuit",
		parts: [
			makeResistor("part_r1", "R1", "10k"),
			makeResistor("part_r2", "R2", "1k"),
		],
		nets: [],
	};
}

function createSetValueFix(id, assignments) {
	return {
		id,
		commands: assignments.map(([partId, value]) => ({
			type: "setPartField",
			partId,
			field: "value",
			value,
		})),
	};
}

function assertPartValues(res, expectedValues) {
	assert.equal(res.ok, true);
	for (let i = 0; i < expectedValues.length; i++) {
		assert.equal(res.ir.parts[i].value, expectedValues[i]);
	}
}

function assertFixFailure(res, { checkUndefinedIr = false, desc } = {}) {
	assert.equal(res.ok, false, desc);
	assert.equal(typeof res.error, "string", desc);
	if (checkUndefinedIr) {
		assert.equal(res.ir, undefined, desc);
	}
}

describe("applyFixToIr", () => {
	test("a value-change fix changes only that part", () => {
		const fix = createSetValueFix("fix_1", [["part_r1", "220"]]);
		const res = applyFixToIr(makeTestIr(), fix);
		assertPartValues(res, ["220", "1k"]);
	});

	test("a multi-command fix applies all commands in order", () => {
		const fix = createSetValueFix("fix_multi", [
			["part_r1", "220"],
			["part_r2", "330"],
		]);
		const res = applyFixToIr(makeTestIr(), fix);
		assertPartValues(res, ["220", "330"]);
	});

	test("input ir is not mutated", () => {
		const ir = makeTestIr();
		const cloneBefore = structuredClone(ir);
		const fix = createSetValueFix("fix_1", [["part_r1", "220"]]);
		applyFixToIr(ir, fix);
		assert.deepEqual(ir, cloneBefore);
	});

	test("empty or missing commands return ok:false with string error", () => {
		const ir = makeTestIr();
		const cases = [
			{ fix: null, desc: "null fix" },
			{ fix: {}, desc: "missing commands" },
			{ fix: { commands: [] }, desc: "empty commands" },
			{ fix: { commands: "invalid" }, desc: "non-array commands" },
		];
		for (const c of cases) {
			assertFixFailure(applyFixToIr(ir, c.fix), { desc: c.desc });
		}
	});

	test("non-IR input returns ok:false with string error", () => {
		const fix = createSetValueFix("fix_1", [["part_r1", "220"]]);
		const cases = [null, undefined, "invalid", 123, [], {}, { parts: null }];
		for (const badIr of cases) {
			assertFixFailure(applyFixToIr(badIr, fix));
		}
	});

	test("a failing command returns ok:false with string error and no partial change", () => {
		const fix = createSetValueFix("fix_fail", [["nonexistent_part", "220"]]);
		const res = applyFixToIr(makeTestIr(), fix);
		assertFixFailure(res, { checkUndefinedIr: true });
	});

	test("multi-command fix with one failing command makes no partial changes", () => {
		const fix = createSetValueFix("fix_partial_fail", [
			["part_r1", "220"],
			["nonexistent_part", "330"],
		]);
		const res = applyFixToIr(makeTestIr(), fix);
		assertFixFailure(res, { checkUndefinedIr: true });
	});

	test("unknown command type returns ok:false with string error", () => {
		const res = applyFixToIr(makeTestIr(), {
			id: "fix_unknown",
			commands: [{ type: "unknownCommand" }],
		});
		assertFixFailure(res);
	});

	test("command throwing an error returns ok:false with string error", () => {
		const badIr = {
			parts: [
				{
					get id() {
						throw new Error("Simulated access error");
					},
				},
			],
		};
		const fix = createSetValueFix("fix_throw", [["p1", "1k"]]);
		const res = applyFixToIr(badIr, fix);
		assertFixFailure(res);
	});
});
