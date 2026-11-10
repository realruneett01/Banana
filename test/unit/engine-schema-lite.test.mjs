import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validate } from "../../backend/src/engine/schema-lite.js";

describe("schema-lite: type keyword", () => {
	const PASS_CASES = [
		{ type: "object", value: {} },
		{ type: "array", value: [] },
		{ type: "string", value: "hello" },
		{ type: "number", value: 3.14 },
		{ type: "integer", value: 42 },
		{ type: "boolean", value: true },
		{ type: "null", value: null },
	];

	for (const { type, value } of PASS_CASES) {
		test(`accepts valid ${type}`, () => {
			const res = validate({ type }, value);
			assert.equal(res.ok, true);
			assert.deepEqual(res.errors, []);
		});
	}

	const FAIL_CASES = [
		{ type: "object", value: [] },
		{ type: "object", value: null },
		{ type: "array", value: {} },
		{ type: "string", value: 123 },
		{ type: "number", value: "123" },
		{ type: "number", value: Number.NaN },
		{ type: "integer", value: 3.14 },
		{ type: "boolean", value: "true" },
		{ type: "null", value: undefined },
	];

	for (const { type, value } of FAIL_CASES) {
		test(`rejects invalid ${type}`, () => {
			const res = validate({ type }, value);
			assert.equal(res.ok, false);
			assert.equal(res.errors.length, 1);
			assert.match(res.errors[0], new RegExp(`^\\$: expected ${type}`));
		});
	}
});

describe("schema-lite: required keyword", () => {
	const schema = {
		type: "object",
		required: ["id", "name"],
	};

	test("passes when all required keys are present", () => {
		const res = validate(schema, { id: "p1", name: "R1" });
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("fails when required key is missing", () => {
		const res = validate(schema, { id: "p1" });
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$.name: missing"]);
	});

	test("fails when required key is undefined", () => {
		const res = validate(schema, { id: "p1", name: undefined });
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$.name: missing"]);
	});
});

describe("schema-lite: properties keyword", () => {
	const schema = {
		type: "object",
		properties: {
			count: { type: "integer" },
			label: { type: "string" },
		},
	};

	test("passes when properties match schema", () => {
		const res = validate(schema, { count: 10, label: "test" });
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("ignores omitted optional properties", () => {
		const res = validate(schema, { count: 10 });
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("fails on invalid property type with child path", () => {
		const res = validate(schema, { count: "ten" });
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$.count: expected integer"]);
	});
});

describe("schema-lite: additionalProperties keyword", () => {
	const schema = {
		type: "object",
		properties: {
			id: { type: "string" },
		},
		additionalProperties: false,
	};

	test("passes when only declared properties exist", () => {
		const res = validate(schema, { id: "abc" });
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("fails when extra property is present", () => {
		const res = validate(schema, { id: "abc", extra: 123 });
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$.extra: unexpected property"]);
	});
});

describe("schema-lite: items keyword", () => {
	const schema = {
		type: "array",
		items: { type: "number" },
	};

	test("passes when array items match schema", () => {
		const res = validate(schema, [1, 2, 3.5]);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("fails when an item does not match", () => {
		const res = validate(schema, [1, "two", 3]);
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$[1]: expected number"]);
	});
});

describe("schema-lite: enum keyword", () => {
	const schema = { enum: ["red", "green", "blue"] };

	test("passes for allowed enum value", () => {
		const res = validate(schema, "green");
		assert.equal(res.ok, true);
	});

	test("fails for value outside enum", () => {
		const res = validate(schema, "yellow");
		assert.equal(res.ok, false);
		assert.match(res.errors[0], /^\$: must be one of red, green, blue$/);
	});
});

describe("schema-lite: minimum and maximum keywords", () => {
	const schema = { type: "number", minimum: 0, maximum: 100 };

	test("passes within range", () => {
		const res = validate(schema, 50);
		assert.equal(res.ok, true);
	});

	test("passes at boundaries", () => {
		assert.equal(validate(schema, 0).ok, true);
		assert.equal(validate(schema, 100).ok, true);
	});

	test("fails below minimum", () => {
		const res = validate(schema, -1);
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$: must be >= 0"]);
	});

	test("fails above maximum", () => {
		const res = validate(schema, 101);
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$: must be <= 100"]);
	});
});

describe("schema-lite: minLength and pattern keywords", () => {
	const schema = {
		type: "string",
		minLength: 3,
		pattern: "^[A-Z]+$",
	};

	test("passes when meeting length and pattern", () => {
		const res = validate(schema, "ABC");
		assert.equal(res.ok, true);
	});

	test("fails when shorter than minLength", () => {
		const res = validate(schema, "AB");
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$: must be at least 3 characters"]);
	});

	test("fails when pattern does not match", () => {
		const res = validate(schema, "abc");
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$: must match pattern ^[A-Z]+$"]);
	});
});

describe("schema-lite: nested paths", () => {
	const circuitSchema = {
		type: "object",
		required: ["parts"],
		properties: {
			parts: {
				type: "array",
				items: {
					type: "object",
					required: ["id", "ref"],
					properties: {
						id: { type: "string" },
						ref: { type: "string" },
					},
				},
			},
		},
	};

	test("validates deeply nested structure", () => {
		const ir = {
			parts: [
				{ id: "part_1", ref: "R1" },
				{ id: "part_2", ref: "C1" },
				{ ref: "U1" },
			],
		};
		const res = validate(circuitSchema, ir);
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["$.parts[2].id: missing"]);
	});

	test("supports unrooted path prefix when requested", () => {
		const ir = {
			parts: [
				{ id: "part_1", ref: "R1" },
				{ id: "part_2", ref: "C1" },
				{ ref: "U1" },
			],
		};
		const res = validate(circuitSchema, ir, "");
		assert.equal(res.ok, false);
		assert.deepEqual(res.errors, ["parts[2].id: missing"]);
	});
});

describe("schema-lite: never throws on weird input", () => {
	const WEIRD_INPUTS = [
		null,
		undefined,
		123,
		"weird",
		true,
		Number.NaN,
		() => {},
		Symbol("sym"),
		{},
		[],
	];

	for (const input of WEIRD_INPUTS) {
		test(`does not throw for weird value: ${String(input)}`, () => {
			assert.doesNotThrow(() => {
				const res = validate({ type: "object" }, input);
				assert.equal(typeof res.ok, "boolean");
				assert.equal(Array.isArray(res.errors), true);
			});
		});

		test(`does not throw for weird schema: ${String(input)}`, () => {
			assert.doesNotThrow(() => {
				const res = validate(input, { a: 1 });
				assert.equal(typeof res.ok, "boolean");
				assert.equal(Array.isArray(res.errors), true);
			});
		});
	}

	test("does not throw on invalid regex pattern in schema", () => {
		assert.doesNotThrow(() => {
			const res = validate({ type: "string", pattern: "[invalid(" }, "hello");
			assert.equal(res.ok, false);
		});
	});

	test("empty schema accepts any value", () => {
		const res = validate({}, { any: "data" });
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});
});
