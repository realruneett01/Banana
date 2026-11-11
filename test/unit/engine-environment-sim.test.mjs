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

const WEIRD_INPUTS = [
	null,
	undefined,
	123,
	"string",
	true,
	false,
	Number.NaN,
	{},
	[],
	() => {},
	Symbol("sym"),
];

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

function runGarbageInputCases(validate) {
	for (const input of WEIRD_INPUTS) {
		test(`never throws on: ${String(input)}`, () => {
			assertResilient(validate, input);
		});
	}
}

const ENV_INVALID_CASES = [
	...["id", "name", "ambientC", "humidityPct", "altitudeM"].map((prop) => [
		`rejects missing ${prop}`,
		() => withoutKey(makeValidEnv(), prop),
		`$.${prop}`,
	]),
	[
		"rejects invalid id kind (part_* instead of env_*)",
		() => ({ ...makeValidEnv(), id: newId("part") }),
		"$.id",
	],
	[
		"rejects malformed id string",
		() => ({ ...makeValidEnv(), id: "invalid-id" }),
		"$.id",
	],
	[
		"rejects wrong name type",
		() => ({ ...makeValidEnv(), name: 42 }),
		"$.name",
	],
	[
		"rejects ambientC min > max",
		() => ({ ...makeValidEnv(), ambientC: { min: 40, max: 20 } }),
		"$.ambientC",
	],
	[
		"rejects ambientC missing max",
		() => ({ ...makeValidEnv(), ambientC: { min: 20 } }),
		"$.ambientC.max",
	],
	[
		"rejects humidityPct min > max",
		() => ({ ...makeValidEnv(), humidityPct: { min: 80, max: 40 } }),
		"$.humidityPct",
	],
	[
		"rejects vibration fromHz > toHz",
		() => ({
			...makeValidEnv(),
			vibration: { psdG2Hz: 0.04, fromHz: 2000, toHz: 20 },
		}),
		"$.vibration",
	],
	[
		"rejects vibration missing toHz",
		() => ({
			...makeValidEnv(),
			vibration: { psdG2Hz: 0.04, fromHz: 20 },
		}),
		"$.vibration.toHz",
	],
	[
		"rejects unexpected extra property",
		() => ({ ...makeValidEnv(), extraField: "not-allowed" }),
		"$.extraField",
	],
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
	...SIM_VALID_KINDS.map((kind) => [
		`accepts kind ${kind}`,
		() => ({ ...makeValidSimRun(), kind }),
	]),
	...SIM_VALID_STATUSES.map((status) => [
		`accepts status ${status}`,
		() => ({ ...makeValidSimRun(), status }),
	]),
];

const SIM_INVALID_CASES = [
	...["id", "commit", "envId", "startedAt", "results"].map((prop) => [
		`rejects missing ${prop}`,
		() => withoutKey(makeValidSimRun(), prop),
		`$.${prop}`,
	]),
	[
		"rejects invalid id kind (env_* instead of sim_*)",
		() => ({ ...makeValidSimRun(), id: newId("env") }),
		"$.id",
	],
	[
		"rejects malformed id string",
		() => ({ ...makeValidSimRun(), id: "bad-id" }),
		"$.id",
	],
	[
		"rejects commit too short (< 7 hex)",
		() => ({ ...makeValidSimRun(), commit: "123456" }),
		"$.commit",
	],
	[
		"rejects commit too long (> 40 hex)",
		() => ({ ...makeValidSimRun(), commit: "a".repeat(41) }),
		"$.commit",
	],
	[
		"rejects commit non-hex character",
		() => ({ ...makeValidSimRun(), commit: "123456g" }),
		"$.commit",
	],
	[
		"rejects invalid envId kind (sim_* instead of env_*)",
		() => ({ ...makeValidSimRun(), envId: newId("sim") }),
		"$.envId",
	],
	[
		"rejects invalid kind enum",
		() => ({ ...makeValidSimRun(), kind: "magic-sim" }),
		"$.kind",
	],
	[
		"rejects invalid status enum",
		() => ({ ...makeValidSimRun(), status: "paused" }),
		"$.status",
	],
	[
		"rejects result missing unit",
		() => ({
			...makeValidSimRun(),
			results: [{ itemId: "part_1", metric: "temp", value: 50 }],
		}),
		"$.results[0].unit",
	],
	[
		"rejects result non-number value",
		() => ({
			...makeValidSimRun(),
			results: [{ itemId: "part_1", metric: "temp", value: "high", unit: "C" }],
		}),
		"$.results[0].value",
	],
	[
		"rejects unexpected extra property",
		() => ({ ...makeValidSimRun(), extraProp: 123 }),
		"$.extraProp",
	],
];

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
		for (const schema of [ENVIRONMENT_SCHEMA, SIM_RUN_SCHEMA]) {
			assert.deepEqual(
				{
					type: schema.type,
					additionalProperties: schema.additionalProperties,
				},
				{ type: "object", additionalProperties: false },
			);
		}
	});
});

describe("validateEnvironment: valid cases", () => {
	const CASES = [
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

	for (const [name, createPayload] of CASES) {
		test(name, () => {
			assertValid(validateEnvironment(createPayload()));
		});
	}
});

describe("validateEnvironment: invalid rule cases", () => {
	const CASES = ENV_INVALID_CASES;
	for (const [name, createPayload, path] of CASES) {
		test(name, () => {
			assertInvalid(validateEnvironment(createPayload()), path);
		});
	}
});

describe("validateEnvironment: garbage input resilience", () => {
	runGarbageInputCases(validateEnvironment);
});

describe("validateSimRun: valid cases", () => {
	const CASES = SIM_VALID_CASES;
	for (const [name, createPayload] of CASES) {
		test(name, () => {
			assertValid(validateSimRun(createPayload()));
		});
	}
});

describe("validateSimRun: invalid rule cases", () => {
	const CASES = SIM_INVALID_CASES;
	for (const [name, createPayload, path] of CASES) {
		test(name, () => {
			assertInvalid(validateSimRun(createPayload()), path);
		});
	}
});

describe("validateSimRun: garbage input resilience", () => {
	runGarbageInputCases(validateSimRun);
});
