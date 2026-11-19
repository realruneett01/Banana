import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	ENVIRONMENT_SCHEMA,
	SIM_RUN_SCHEMA,
	validateEnvironment,
	validateSimRun,
} from "../../backend/src/engine/environment-sim.js";
import { newId } from "../../backend/src/engine/ids.js";

function makeValidEnv() {
	return {
		id: newId("env"),
		name: "Office ambient",
		ambientC: { min: 18, max: 28 },
		humidityPct: { min: 30, max: 70 },
		altitudeM: 50,
	};
}

function makeValidSimRun() {
	return {
		id: newId("sim"),
		commit: "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4",
		envId: newId("env"),
		kind: "thermal",
		status: "done",
		startedAt: "2026-11-10T10:00:00Z",
		finishedAt: "2026-11-10T10:05:00Z",
		results: [
			{
				itemId: newId("part"),
				metric: "temp_max",
				value: 62.4,
				unit: "C",
			},
		],
	};
}

const PRIMITIVE_INPUTS = [
	null,
	undefined,
	123,
	"string",
	true,
	false,
	Number.NaN,
];
const NON_PRIMITIVE_INPUTS = [{}, [], () => {}, Symbol("sym")];
const RESILIENCE_INPUTS = [...PRIMITIVE_INPUTS, ...NON_PRIMITIVE_INPUTS];

function withoutKey(obj, key) {
	const copy = { ...obj };
	delete copy[key];
	return copy;
}

function assertValid(res) {
	assert.deepEqual(
		{ ok: res.ok, errors: res.errors },
		{ ok: true, errors: [] },
	);
}

function assertInvalid(res, expectedPath) {
	const matched = res.errors.some((err) => err.startsWith(expectedPath));
	assert.deepEqual(
		{ ok: res.ok, hasErrors: res.errors.length > 0, matched },
		{ ok: false, hasErrors: true, matched: true },
		`Expected error for path ${expectedPath}, got: ${res.errors.join(", ")}`,
	);
}

function assertResilient(validate, input) {
	assert.doesNotThrow(() => {
		const res = validate(input);
		assert.deepEqual(
			[typeof res.ok, Array.isArray(res.errors), res.ok],
			["boolean", true, false],
		);
	});
}

function assertSchemaRootType(schema) {
	assert.deepEqual(
		{
			type: schema.type,
			additionalProperties: schema.additionalProperties,
		},
		{ type: "object", additionalProperties: false },
	);
}

function createMissingPropCases(factory, props) {
	return props.map((prop) => [
		`rejects missing ${prop}`,
		() => withoutKey(factory(), prop),
		`$.${prop}`,
	]);
}

function createMutationCases(factory, mutations) {
	return mutations.map(([reason, patch, path]) => [
		`rejects ${reason}`,
		() => {
			const diff = typeof patch === "function" ? patch() : patch;
			return { ...factory(), ...diff };
		},
		path,
	]);
}

function createFieldCases(factory, prefix, field, values) {
	return values.map((val) => [
		`${prefix} ${val}`,
		() => ({ ...factory(), [field]: val }),
	]);
}

const ENV_VALID_CASES = [
	["accepts minimal valid environment", () => makeValidEnv()],
	[
		"accepts complete valid environment with optional fields",
		() => ({
			...makeValidEnv(),
			vibration: { psdG2Hz: 0.04, fromHz: 20, toHz: 2000 },
			shockG: 40,
			airflowMs: 2.5,
		}),
	],
	[
		"accepts boundary when min equals max",
		() => ({
			...makeValidEnv(),
			ambientC: { min: 25, max: 25 },
			humidityPct: { min: 50, max: 50 },
			vibration: { psdG2Hz: 0.01, fromHz: 100, toHz: 100 },
		}),
	],
];

const ENV_MUTATIONS = [
	[
		"invalid id kind (part_* instead of env_*)",
		() => ({ id: newId("part") }),
		"$.id",
	],
	["malformed id string", { id: "invalid-id" }, "$.id"],
	["wrong name type", { name: 42 }, "$.name"],
	["ambientC min > max", { ambientC: { min: 40, max: 20 } }, "$.ambientC"],
	["ambientC missing max", { ambientC: { min: 20 } }, "$.ambientC.max"],
	[
		"humidityPct min > max",
		{ humidityPct: { min: 80, max: 40 } },
		"$.humidityPct",
	],
	[
		"vibration fromHz > toHz",
		{ vibration: { psdG2Hz: 0.04, fromHz: 2000, toHz: 20 } },
		"$.vibration",
	],
	[
		"vibration missing toHz",
		{ vibration: { psdG2Hz: 0.04, fromHz: 20 } },
		"$.vibration.toHz",
	],
	["unexpected extra property", { extraField: "not-allowed" }, "$.extraField"],
];

const ENV_INVALID_CASES = [
	...createMissingPropCases(makeValidEnv, [
		"id",
		"name",
		"ambientC",
		"humidityPct",
		"altitudeM",
	]),
	...createMutationCases(makeValidEnv, ENV_MUTATIONS),
];

const SIM_VALID_KINDS = [
	"trace-current",
	"ir-drop",
	"impedance",
	"spice",
	"thermal",
];
const SIM_VALID_STATUSES = ["queued", "running", "done", "failed"];

const SIM_VALID_CASES = [
	["accepts valid full simulation run", () => makeValidSimRun()],
	[
		"accepts short 7-hex commit",
		() => ({ ...makeValidSimRun(), commit: "34b1983" }),
	],
	[
		"accepts run without optional finishedAt",
		() => withoutKey(makeValidSimRun(), "finishedAt"),
	],
	[
		"accepts run with empty results array",
		() => ({ ...makeValidSimRun(), status: "queued", results: [] }),
	],
	...createFieldCases(makeValidSimRun, "accepts kind", "kind", SIM_VALID_KINDS),
	...createFieldCases(
		makeValidSimRun,
		"accepts status",
		"status",
		SIM_VALID_STATUSES,
	),
];

const SIM_MUTATIONS = [
	[
		"invalid id kind (env_* instead of sim_*)",
		() => ({ id: newId("env") }),
		"$.id",
	],
	["malformed id string", { id: "bad-id" }, "$.id"],
	["commit too short (< 7 hex)", { commit: "123456" }, "$.commit"],
	[
		"commit too long (> 40 hex)",
		() => ({ commit: "a".repeat(41) }),
		"$.commit",
	],
	["commit non-hex character", { commit: "123456g" }, "$.commit"],
	[
		"invalid envId kind (sim_* instead of env_*)",
		() => ({ envId: newId("sim") }),
		"$.envId",
	],
	["invalid kind enum", { kind: "magic-sim" }, "$.kind"],
	["invalid status enum", { status: "paused" }, "$.status"],
	[
		"result missing unit",
		{ results: [{ itemId: "part_1", metric: "temp", value: 50 }] },
		"$.results[0].unit",
	],
	[
		"result non-number value",
		{
			results: [{ itemId: "part_1", metric: "temp", value: "high", unit: "C" }],
		},
		"$.results[0].value",
	],
	["unexpected extra property", { extraProp: 123 }, "$.extraProp"],
];

const SIM_INVALID_CASES = [
	...createMissingPropCases(makeValidSimRun, [
		"id",
		"commit",
		"envId",
		"startedAt",
		"results",
	]),
	...createMutationCases(makeValidSimRun, SIM_MUTATIONS),
];

function runValidTests(validator, cases) {
	for (const [name, createPayload] of cases) {
		test(name, () => assertValid(validator(createPayload())));
	}
}

function runInvalidTests(validator, cases) {
	for (const [name, createPayload, path] of cases) {
		test(name, () => assertInvalid(validator(createPayload()), path));
	}
}

function runResilienceTests(validator) {
	for (const input of RESILIENCE_INPUTS) {
		test(`never throws on: ${String(input)}`, () => {
			assertResilient(validator, input);
		});
	}
}

function registerValidationSuites({
	title,
	validator,
	validCases,
	invalidCases,
}) {
	describe(`${title}: valid cases`, () => {
		runValidTests(validator, validCases);
	});
	describe(`${title}: invalid rule cases`, () => {
		runInvalidTests(validator, invalidCases);
	});
	describe(`${title}: garbage input resilience`, () => {
		runResilienceTests(validator);
	});
}

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/environment-sim.js");
		const expected = [
			"ENVIRONMENT_SCHEMA",
			"SIM_RUN_SCHEMA",
			"validateEnvironment",
			"validateSimRun",
		];
		assert.deepEqual(Object.keys(mod).sort(), expected);
	});

	test("exported schemas define expected root types", () => {
		assertSchemaRootType(ENVIRONMENT_SCHEMA);
		assertSchemaRootType(SIM_RUN_SCHEMA);
	});
});

registerValidationSuites({
	title: "validateEnvironment",
	validator: validateEnvironment,
	validCases: ENV_VALID_CASES,
	invalidCases: ENV_INVALID_CASES,
});

registerValidationSuites({
	title: "validateSimRun",
	validator: validateSimRun,
	validCases: SIM_VALID_CASES,
	invalidCases: SIM_INVALID_CASES,
});
