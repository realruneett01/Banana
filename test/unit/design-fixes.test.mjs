import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyFixToIr } from "../../frontend/src/designFixes.js";

function makeTestIr() {
	return {
		schemaVersion: 1,
		name: "test-circuit",
		parts: [
			{
				id: "part_r1",
				ref: "R1",
				value: "10k",
				footprint: "Resistor_SMD:R_0805",
				symbol: "Device:R",
				props: {},
			},
			{
				id: "part_r2",
				ref: "R2",
				value: "1k",
				footprint: "Resistor_SMD:R_0805",
				symbol: "Device:R",
				props: {},
			},
		],
		nets: [],
	};
}

describe("applyFixToIr", () => {
	test("a value-change fix changes only that part", () => {
		const ir = makeTestIr();
		const fix = {
			id: "fix_1",
			commands: [
				{
					type: "setPartField",
					partId: "part_r1",
					field: "value",
					value: "220",
				},
			],
		};
		const res = applyFixToIr(ir, fix);
		assert.equal(res.ok, true);
		assert.equal(res.ir.parts[0].value, "220");
		assert.equal(res.ir.parts[1].value, "1k");
	});

	test("a multi-command fix applies all commands in order", () => {
		const ir = makeTestIr();
		const fix = {
			id: "fix_multi",
			commands: [
				{
					type: "setPartField",
					partId: "part_r1",
					field: "value",
					value: "220",
				},
				{
					type: "setPartField",
					partId: "part_r2",
					field: "value",
					value: "330",
				},
			],
		};
		const res = applyFixToIr(ir, fix);
		assert.equal(res.ok, true);
		assert.equal(res.ir.parts[0].value, "220");
		assert.equal(res.ir.parts[1].value, "330");
	});

	test("input ir is not mutated", () => {
		const ir = makeTestIr();
		const cloneBefore = structuredClone(ir);
		const fix = {
			id: "fix_1",
			commands: [
				{
					type: "setPartField",
					partId: "part_r1",
					field: "value",
					value: "220",
				},
			],
		};
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
			const res = applyFixToIr(ir, c.fix);
			assert.equal(res.ok, false, c.desc);
			assert.equal(typeof res.error, "string", c.desc);
		}
	});

	test("non-IR input returns ok:false with string error", () => {
		const fix = {
			id: "fix_1",
			commands: [
				{
					type: "setPartField",
					partId: "part_r1",
					field: "value",
					value: "220",
				},
			],
		};
		const cases = [null, undefined, "invalid", 123, [], {}, { parts: null }];
		for (const badIr of cases) {
			const res = applyFixToIr(badIr, fix);
			assert.equal(res.ok, false);
			assert.equal(typeof res.error, "string");
		}
	});

	test("a failing command returns ok:false with string error and no partial change", () => {
		const ir = makeTestIr();
		const fix = {
			id: "fix_fail",
			commands: [
				{
					type: "setPartField",
					partId: "nonexistent_part",
					field: "value",
					value: "220",
				},
			],
		};
		const res = applyFixToIr(ir, fix);
		assert.equal(res.ok, false);
		assert.equal(typeof res.error, "string");
		assert.equal(res.ir, undefined);
	});

	test("multi-command fix with one failing command makes no partial changes", () => {
		const ir = makeTestIr();
		const fix = {
			id: "fix_partial_fail",
			commands: [
				{
					type: "setPartField",
					partId: "part_r1",
					field: "value",
					value: "220",
				},
				{
					type: "setPartField",
					partId: "nonexistent_part",
					field: "value",
					value: "330",
				},
			],
		};
		const res = applyFixToIr(ir, fix);
		assert.equal(res.ok, false);
		assert.equal(typeof res.error, "string");
		assert.equal(res.ir, undefined);
	});

	test("unknown command type returns ok:false with string error", () => {
		const ir = makeTestIr();
		const fix = {
			id: "fix_unknown",
			commands: [{ type: "unknownCommand" }],
		};
		const res = applyFixToIr(ir, fix);
		assert.equal(res.ok, false);
		assert.equal(typeof res.error, "string");
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
		const fix = {
			id: "fix_throw",
			commands: [
				{
					type: "setPartField",
					partId: "p1",
					field: "value",
					value: "1k",
				},
			],
		};
		const res = applyFixToIr(badIr, fix);
		assert.equal(res.ok, false);
		assert.equal(typeof res.error, "string");
	});
});
