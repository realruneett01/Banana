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

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/environment-sim.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, [
			"ENVIRONMENT_SCHEMA",
			"SIM_RUN_SCHEMA",
			"validateEnvironment",
			"validateSimRun",
		]);
	});

	test("exported schemas define expected root types", () => {
		assert.equal(ENVIRONMENT_SCHEMA.type, "object");
		assert.equal(ENVIRONMENT_SCHEMA.additionalProperties, false);
		assert.equal(SIM_RUN_SCHEMA.type, "object");
		assert.equal(SIM_RUN_SCHEMA.additionalProperties, false);
	});
});

describe("validateEnvironment: valid cases", () => {
	test("accepts minimal valid environment", () => {
		const env = makeValidEnv();
		const res = validateEnvironment(env);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("accepts complete valid environment with optional fields", () => {
		const env = {
			...makeValidEnv(),
			vibration: { psdG2Hz: 0.04, fromHz: 20, toHz: 2000 },
			shockG: 40,
			airflowMs: 2.5,
		};
		const res = validateEnvironment(env);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("accepts boundary when min equals max", () => {
		const env = {
			...makeValidEnv(),
			ambientC: { min: 25, max: 25 },
			humidityPct: { min: 50, max: 50 },
			vibration: { psdG2Hz: 0.01, fromHz: 100, toHz: 100 },
		};
		const res = validateEnvironment(env);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});
});

describe("validateEnvironment: invalid rule cases", () => {
	const ENV_INVALID_CASES = [
		{
			label: "missing id",
			patch: (e) => delete e.id,
			expectedPath: "$.id",
		},
		{
			label: "invalid id kind (part_* instead of env_*)",
			patch: (e) => {
				e.id = newId("part");
			},
			expectedPath: "$.id",
		},
		{
			label: "malformed id string",
			patch: (e) => {
				e.id = "invalid-id";
			},
			expectedPath: "$.id",
		},
		{
			label: "missing name",
			patch: (e) => delete e.name,
			expectedPath: "$.name",
		},
		{
			label: "wrong name type",
			patch: (e) => {
				e.name = 42;
			},
			expectedPath: "$.name",
		},
		{
			label: "missing ambientC",
			patch: (e) => delete e.ambientC,
			expectedPath: "$.ambientC",
		},
		{
			label: "ambientC min > max",
			patch: (e) => {
				e.ambientC = { min: 40, max: 20 };
			},
			expectedPath: "$.ambientC",
		},
		{
			label: "ambientC missing max",
			patch: (e) => {
				e.ambientC = { min: 20 };
			},
			expectedPath: "$.ambientC.max",
		},
		{
			label: "missing humidityPct",
			patch: (e) => delete e.humidityPct,
			expectedPath: "$.humidityPct",
		},
		{
			label: "humidityPct min > max",
			patch: (e) => {
				e.humidityPct = { min: 80, max: 40 };
			},
			expectedPath: "$.humidityPct",
		},
		{
			label: "missing altitudeM",
			patch: (e) => delete e.altitudeM,
			expectedPath: "$.altitudeM",
		},
		{
			label: "vibration fromHz > toHz",
			patch: (e) => {
				e.vibration = { psdG2Hz: 0.04, fromHz: 2000, toHz: 20 };
			},
			expectedPath: "$.vibration",
		},
		{
			label: "vibration missing toHz",
			patch: (e) => {
				e.vibration = { psdG2Hz: 0.04, fromHz: 20 };
			},
			expectedPath: "$.vibration.toHz",
		},
		{
			label: "unexpected extra property",
			patch: (e) => {
				e.extraField = "not-allowed";
			},
			expectedPath: "$.extraField",
		},
	];

	for (const { label, patch, expectedPath } of ENV_INVALID_CASES) {
		test(`rejects ${label}`, () => {
			const env = makeValidEnv();
			patch(env);
			const res = validateEnvironment(env);
			assert.equal(res.ok, false);
			assert.equal(res.errors.length > 0, true);
			const matched = res.errors.some((err) => err.startsWith(expectedPath));
			assert.equal(
				matched,
				true,
				`Expected error for path ${expectedPath}, got: ${res.errors.join(", ")}`,
			);
		});
	}
});

describe("validateEnvironment: garbage input resilience", () => {
	for (const input of WEIRD_INPUTS) {
		test(`never throws on: ${String(input)}`, () => {
			assert.doesNotThrow(() => {
				const res = validateEnvironment(input);
				assert.equal(typeof res.ok, "boolean");
				assert.equal(Array.isArray(res.errors), true);
				assert.equal(res.ok, false);
			});
		});
	}
});

describe("validateSimRun: valid cases", () => {
	test("accepts valid full simulation run", () => {
		const run = makeValidSimRun();
		const res = validateSimRun(run);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("accepts short 7-hex commit", () => {
		const run = {
			...makeValidSimRun(),
			commit: "34b1983",
		};
		const res = validateSimRun(run);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("accepts run without optional finishedAt", () => {
		const run = makeValidSimRun();
		delete run.finishedAt;
		const res = validateSimRun(run);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("accepts run with empty results array", () => {
		const run = {
			...makeValidSimRun(),
			status: "queued",
			results: [],
		};
		const res = validateSimRun(run);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	const KINDS = ["trace-current", "ir-drop", "impedance", "spice", "thermal"];
	for (const kind of KINDS) {
		test(`accepts kind ${kind}`, () => {
			const run = { ...makeValidSimRun(), kind };
			assert.equal(validateSimRun(run).ok, true);
		});
	}

	const STATUSES = ["queued", "running", "done", "failed"];
	for (const status of STATUSES) {
		test(`accepts status ${status}`, () => {
			const run = { ...makeValidSimRun(), status };
			assert.equal(validateSimRun(run).ok, true);
		});
	}
});

describe("validateSimRun: invalid rule cases", () => {
	const SIM_INVALID_CASES = [
		{
			label: "missing id",
			patch: (r) => delete r.id,
			expectedPath: "$.id",
		},
		{
			label: "invalid id kind (env_* instead of sim_*)",
			patch: (r) => {
				r.id = newId("env");
			},
			expectedPath: "$.id",
		},
		{
			label: "malformed id string",
			patch: (r) => {
				r.id = "bad-id";
			},
			expectedPath: "$.id",
		},
		{
			label: "missing commit",
			patch: (r) => delete r.commit,
			expectedPath: "$.commit",
		},
		{
			label: "commit too short (< 7 hex)",
			patch: (r) => {
				r.commit = "123456";
			},
			expectedPath: "$.commit",
		},
		{
			label: "commit too long (> 40 hex)",
			patch: (r) => {
				r.commit = "a".repeat(41);
			},
			expectedPath: "$.commit",
		},
		{
			label: "commit non-hex character",
			patch: (r) => {
				r.commit = "123456g";
			},
			expectedPath: "$.commit",
		},
		{
			label: "missing envId",
			patch: (r) => delete r.envId,
			expectedPath: "$.envId",
		},
		{
			label: "invalid envId kind (sim_* instead of env_*)",
			patch: (r) => {
				r.envId = newId("sim");
			},
			expectedPath: "$.envId",
		},
		{
			label: "invalid kind enum",
			patch: (r) => {
				r.kind = "magic-sim";
			},
			expectedPath: "$.kind",
		},
		{
			label: "invalid status enum",
			patch: (r) => {
				r.status = "paused";
			},
			expectedPath: "$.status",
		},
		{
			label: "missing startedAt",
			patch: (r) => delete r.startedAt,
			expectedPath: "$.startedAt",
		},
		{
			label: "missing results",
			patch: (r) => delete r.results,
			expectedPath: "$.results",
		},
		{
			label: "result missing unit",
			patch: (r) => {
				r.results = [{ itemId: "part_1", metric: "temp", value: 50 }];
			},
			expectedPath: "$.results[0].unit",
		},
		{
			label: "result non-number value",
			patch: (r) => {
				r.results = [
					{ itemId: "part_1", metric: "temp", value: "high", unit: "C" },
				];
			},
			expectedPath: "$.results[0].value",
		},
		{
			label: "unexpected extra property",
			patch: (r) => {
				r.extraProp = 123;
			},
			expectedPath: "$.extraProp",
		},
	];

	for (const { label, patch, expectedPath } of SIM_INVALID_CASES) {
		test(`rejects ${label}`, () => {
			const run = makeValidSimRun();
			patch(run);
			const res = validateSimRun(run);
			assert.equal(res.ok, false);
			assert.equal(res.errors.length > 0, true);
			const matched = res.errors.some((err) => err.startsWith(expectedPath));
			assert.equal(
				matched,
				true,
				`Expected error for path ${expectedPath}, got: ${res.errors.join(", ")}`,
			);
		});
	}
});

describe("validateSimRun: garbage input resilience", () => {
	for (const input of WEIRD_INPUTS) {
		test(`never throws on: ${String(input)}`, () => {
			assert.doesNotThrow(() => {
				const res = validateSimRun(input);
				assert.equal(typeof res.ok, "boolean");
				assert.equal(Array.isArray(res.errors), true);
				assert.equal(res.ok, false);
			});
		});
	}
});
