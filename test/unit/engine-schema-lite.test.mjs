import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validate } from "../../backend/src/engine/schema-lite.js";

function assertValid(res) {
	assert.equal(res.ok, true);
	assert.deepEqual(res.errors, []);
}

function assertInvalid(res, errors) {
	assert.equal(res.ok, false);
	assert.deepEqual(res.errors, errors);
}

function assertTypeError(res, type) {
	assert.equal(res.ok, false);
	assert.equal(res.errors.length, 1);
	assert.match(res.errors[0], new RegExp(`^\\$: expected ${type}`));
}

function assertMatchError(res, pattern) {
	assert.equal(res.ok, false);
	assert.match(res.errors[0], pattern);
}

function assertSafeValidation(fn) {
	assert.doesNotThrow(() => {
		const res = fn();
		assert.equal(typeof res.ok, "boolean");
		assert.equal(Array.isArray(res.errors), true);
	});
}

function assertInvalidPatternDoesNotThrow(schema, value) {
	assert.doesNotThrow(() => {
		const res = validate(schema, value);
		assert.equal(res.ok, false);
	});
}

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
			assertValid(validate({ type }, value));
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
			assertTypeError(validate({ type }, value), type);
		});
	}
});

describe("schema-lite: required keyword", () => {
	const schema = {
		type: "object",
		required: ["id", "name"],
	};

	test("passes when all required keys are present", () => {
		assertValid(validate(schema, { id: "p1", name: "R1" }));
	});

	const FAIL_CASES = [
		{ name: "fails when required key is missing", value: { id: "p1" } },
		{
			name: "fails when required key is undefined",
			value: { id: "p1", name: undefined },
		},
	];

	for (const { name, value } of FAIL_CASES) {
		test(name, () => {
			assertInvalid(validate(schema, value), ["$.name: missing"]);
		});
	}
});

describe("schema-lite: properties keyword", () => {
	const schema = {
		type: "object",
		properties: {
			count: { type: "integer" },
			label: { type: "string" },
		},
	};

	const PASS_CASES = [
		{
			name: "passes when properties match schema",
			value: { count: 10, label: "test" },
		},
		{ name: "ignores omitted optional properties", value: { count: 10 } },
	];

	for (const { name, value } of PASS_CASES) {
		test(name, () => {
			assertValid(validate(schema, value));
		});
	}

	test("fails on invalid property type with child path", () => {
		assertInvalid(validate(schema, { count: "ten" }), [
			"$.count: expected integer",
		]);
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
		assertValid(validate(schema, { id: "abc" }));
	});

	test("fails when extra property is present", () => {
		assertInvalid(validate(schema, { id: "abc", extra: 123 }), [
			"$.extra: unexpected property",
		]);
	});
});

describe("schema-lite: items keyword", () => {
	const schema = {
		type: "array",
		items: { type: "number" },
	};

	test("passes when array items match schema", () => {
		assertValid(validate(schema, [1, 2, 3.5]));
	});

	test("fails when an item does not match", () => {
		assertInvalid(validate(schema, [1, "two", 3]), ["$[1]: expected number"]);
	});
});

describe("schema-lite: enum keyword", () => {
	const schema = { enum: ["red", "green", "blue"] };

	test("passes for allowed enum value", () => {
		const res = validate(schema, "green");
		assert.equal(res.ok, true);
	});

	test("fails for value outside enum", () => {
		assertMatchError(
			validate(schema, "yellow"),
			/^\$: must be one of red, green, blue$/,
		);
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

	const FAIL_CASES = [
		{ name: "fails below minimum", value: -1, errors: ["$: must be >= 0"] },
		{ name: "fails above maximum", value: 101, errors: ["$: must be <= 100"] },
	];

	for (const { name, value, errors } of FAIL_CASES) {
		test(name, () => {
			assertInvalid(validate(schema, value), errors);
		});
	}
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

	const FAIL_CASES = [
		{
			name: "fails when shorter than minLength",
			value: "AB",
			errors: ["$: must be at least 3 characters"],
		},
		{
			name: "fails when pattern does not match",
			value: "abc",
			errors: ["$: must match pattern ^[A-Z]+$"],
		},
	];

	for (const { name, value, errors } of FAIL_CASES) {
		test(name, () => {
			assertInvalid(validate(schema, value), errors);
		});
	}
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

	const SAMPLE_IR = {
		parts: [
			{ id: "part_1", ref: "R1" },
			{ id: "part_2", ref: "C1" },
			{ ref: "U1" },
		],
	};

	const CASES = [
		{
			name: "validates deeply nested structure",
			args: [circuitSchema, SAMPLE_IR],
			expected: ["$.parts[2].id: missing"],
		},
		{
			name: "supports unrooted path prefix when requested",
			args: [circuitSchema, SAMPLE_IR, ""],
			expected: ["parts[2].id: missing"],
		},
	];

	for (const { name, args, expected } of CASES) {
		test(name, () => {
			assertInvalid(validate(...args), expected);
		});
	}
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
			assertSafeValidation(() => validate({ type: "object" }, input));
		});

		test(`does not throw for weird schema: ${String(input)}`, () => {
			assertSafeValidation(() => validate(input, { a: 1 }));
		});
	}

	test("does not throw on invalid regex pattern in schema", () => {
		assertInvalidPatternDoesNotThrow(
			{ type: "string", pattern: "[invalid(" },
			"hello",
		);
	});

	test("empty schema accepts any value", () => {
		assertValid(validate({}, { any: "data" }));
	});
});
