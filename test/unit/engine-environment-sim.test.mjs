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

function assertValid(res) {
	assert.equal(res.ok, true);
	assert.deepEqual(res.errors, []);
}

function assertInvalid(res, expectedPath) {
	assert.equal(res.ok, false);
	assert.equal(res.errors.length > 0, true);
	const matched = res.errors.some((err) => err.startsWith(expectedPath));
	assert.equal(
		matched,
		true,
		`Expected error for path ${expectedPath}, got: ${res.errors.join(", ")}`,
	);
}

function assertResilient(validate, input) {
	assert.doesNotThrow(() => {
		const res = validate(input);
		assert.equal(typeof res.ok, "boolean");
		assert.equal(Array.isArray(res.errors), true);
		assert.equal(res.ok, false);
	});
}

function runGarbageInputCases(validate) {
	for (const input of WEIRD_INPUTS) {
		test(`never throws on: ${String(input)}`, () => {
			assertResilient(validate, input);
		});
	}
}

function runEnumCases(field, values) {
	for (const val of values) {
		test(`accepts ${field} ${val}`, () => {
			const run = { ...makeValidSimRun(), [field]: val };
			assert.equal(validateSimRun(run).ok, true);
		});
	}
}

function testFieldRejections({
	missingFields,
	mutations,
	makeValid,
	validate,
}) {
	for (const prop of missingFields) {
		test(`rejects missing ${prop}`, () => {
			const entity = makeValid();
			delete entity[prop];
			assertInvalid(validate(entity), `$.${prop}`);
		});
	}
	for (const [label, mutate, expectedPath] of mutations) {
		test(`rejects ${label}`, () => {
			const entity = makeValid();
			mutate(entity);
			assertInvalid(validate(entity), expectedPath);
		});
	}
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
	test("accepts minimal valid environment", () => {
		assertValid(validateEnvironment(makeValidEnv()));
	});

	test("accepts complete valid environment with optional fields", () => {
		const env = {
			...makeValidEnv(),
			vibration: { psdG2Hz: 0.04, fromHz: 20, toHz: 2000 },
			shockG: 40,
			airflowMs: 2.5,
		};
		assertValid(validateEnvironment(env));
	});

	test("accepts boundary when min equals max", () => {
		const env = {
			...makeValidEnv(),
			ambientC: { min: 25, max: 25 },
			humidityPct: { min: 50, max: 50 },
			vibration: { psdG2Hz: 0.01, fromHz: 100, toHz: 100 },
		};
		assertValid(validateEnvironment(env));
	});
});

describe("validateEnvironment: invalid rule cases", () => {
	const MISSING_ENV_FIELDS = [
		"id",
		"name",
		"ambientC",
		"humidityPct",
		"altitudeM",
	];
	const ENV_MUTATIONS = [
		[
			"invalid id kind (part_* instead of env_*)",
			(e) => {
				e.id = newId("part");
			},
			"$.id",
		],
		[
			"malformed id string",
			(e) => {
				e.id = "invalid-id";
			},
			"$.id",
		],
		[
			"wrong name type",
			(e) => {
				e.name = 42;
			},
			"$.name",
		],
		[
			"ambientC min > max",
			(e) => {
				e.ambientC = { min: 40, max: 20 };
			},
			"$.ambientC",
		],
		[
			"ambientC missing max",
			(e) => {
				e.ambientC = { min: 20 };
			},
			"$.ambientC.max",
		],
		[
			"humidityPct min > max",
			(e) => {
				e.humidityPct = { min: 80, max: 40 };
			},
			"$.humidityPct",
		],
		[
			"vibration fromHz > toHz",
			(e) => {
				e.vibration = { psdG2Hz: 0.04, fromHz: 2000, toHz: 20 };
			},
			"$.vibration",
		],
		[
			"vibration missing toHz",
			(e) => {
				e.vibration = { psdG2Hz: 0.04, fromHz: 20 };
			},
			"$.vibration.toHz",
		],
		[
			"unexpected extra property",
			(e) => {
				e.extraField = "not-allowed";
			},
			"$.extraField",
		],
	];

	testFieldRejections({
		missingFields: MISSING_ENV_FIELDS,
		mutations: ENV_MUTATIONS,
		makeValid: makeValidEnv,
		validate: validateEnvironment,
	});
});

describe("validateEnvironment: garbage input resilience", () => {
	runGarbageInputCases(validateEnvironment);
});

describe("validateSimRun: valid cases", () => {
	test("accepts valid full simulation run", () => {
		assertValid(validateSimRun(makeValidSimRun()));
	});

	test("accepts short 7-hex commit", () => {
		assertValid(validateSimRun({ ...makeValidSimRun(), commit: "34b1983" }));
	});

	test("accepts run without optional finishedAt", () => {
		const run = makeValidSimRun();
		delete run.finishedAt;
		assertValid(validateSimRun(run));
	});

	test("accepts run with empty results array", () => {
		assertValid(
			validateSimRun({ ...makeValidSimRun(), status: "queued", results: [] }),
		);
	});

	const KINDS = ["trace-current", "ir-drop", "impedance", "spice", "thermal"];
	runEnumCases("kind", KINDS);

	const STATUSES = ["queued", "running", "done", "failed"];
	runEnumCases("status", STATUSES);
});

describe("validateSimRun: invalid rule cases", () => {
	const MISSING_SIM_FIELDS = ["id", "commit", "envId", "startedAt", "results"];
	const SIM_MUTATIONS = [
		[
			"invalid id kind (env_* instead of sim_*)",
			(r) => {
				r.id = newId("env");
			},
			"$.id",
		],
		[
			"malformed id string",
			(r) => {
				r.id = "bad-id";
			},
			"$.id",
		],
		[
			"commit too short (< 7 hex)",
			(r) => {
				r.commit = "123456";
			},
			"$.commit",
		],
		[
			"commit too long (> 40 hex)",
			(r) => {
				r.commit = "a".repeat(41);
			},
			"$.commit",
		],
		[
			"commit non-hex character",
			(r) => {
				r.commit = "123456g";
			},
			"$.commit",
		],
		[
			"invalid envId kind (sim_* instead of env_*)",
			(r) => {
				r.envId = newId("sim");
			},
			"$.envId",
		],
		[
			"invalid kind enum",
			(r) => {
				r.kind = "magic-sim";
			},
			"$.kind",
		],
		[
			"invalid status enum",
			(r) => {
				r.status = "paused";
			},
			"$.status",
		],
		[
			"result missing unit",
			(r) => {
				r.results = [{ itemId: "part_1", metric: "temp", value: 50 }];
			},
			"$.results[0].unit",
		],
		[
			"result non-number value",
			(r) => {
				r.results = [
					{ itemId: "part_1", metric: "temp", value: "high", unit: "C" },
				];
			},
			"$.results[0].value",
		],
		[
			"unexpected extra property",
			(r) => {
				r.extraProp = 123;
			},
			"$.extraProp",
		],
	];

	testFieldRejections({
		missingFields: MISSING_SIM_FIELDS,
		mutations: SIM_MUTATIONS,
		makeValid: makeValidSimRun,
		validate: validateSimRun,
	});
});

describe("validateSimRun: garbage input resilience", () => {
	runGarbageInputCases(validateSimRun);
});
