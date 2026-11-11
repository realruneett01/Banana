import { isId } from "./ids.js";
import { validate } from "./schema-lite.js";

export const ENVIRONMENT_SCHEMA = {
	type: "object",
	required: ["id", "name", "ambientC", "humidityPct", "altitudeM"],
	additionalProperties: false,
	properties: {
		id: { type: "string" },
		name: { type: "string" },
		ambientC: {
			type: "object",
			required: ["min", "max"],
			additionalProperties: false,
			properties: {
				min: { type: "number" },
				max: { type: "number" },
			},
		},
		humidityPct: {
			type: "object",
			required: ["min", "max"],
			additionalProperties: false,
			properties: {
				min: { type: "number" },
				max: { type: "number" },
			},
		},
		altitudeM: { type: "number" },
		vibration: {
			type: "object",
			required: ["psdG2Hz", "fromHz", "toHz"],
			additionalProperties: false,
			properties: {
				psdG2Hz: { type: "number" },
				fromHz: { type: "number" },
				toHz: { type: "number" },
			},
		},
		shockG: { type: "number" },
		airflowMs: { type: "number" },
	},
};

export const SIM_RUN_SCHEMA = {
	type: "object",
	required: ["id", "commit", "envId", "kind", "status", "startedAt", "results"],
	additionalProperties: false,
	properties: {
		id: { type: "string" },
		commit: {
			type: "string",
			pattern: "^[0-9a-fA-F]{7,40}$",
		},
		envId: { type: "string" },
		kind: {
			type: "string",
			enum: ["trace-current", "ir-drop", "impedance", "spice", "thermal"],
		},
		status: {
			type: "string",
			enum: ["queued", "running", "done", "failed"],
		},
		startedAt: { type: "string" },
		finishedAt: { type: "string" },
		results: {
			type: "array",
			items: {
				type: "object",
				required: ["itemId", "metric", "value", "unit"],
				additionalProperties: false,
				properties: {
					itemId: { type: "string" },
					metric: { type: "string" },
					value: { type: "number" },
					unit: { type: "string" },
				},
			},
		},
	},
};

const ENV_RANGE_CHECKS = [
	{ prop: "ambientC", low: "min", high: "max" },
	{ prop: "humidityPct", low: "min", high: "max" },
	{ prop: "vibration", low: "fromHz", high: "toHz" },
];

function formatPath(base, segment) {
	if (!base || base === "$") {
		return base ? `$.${segment}` : segment;
	}
	return `${base}.${segment}`;
}

function checkFieldId(value, fieldPath, kind, errors) {
	if (typeof value === "string" && !isId(value, kind)) {
		const article = kind === "env" ? "an" : "a";
		errors.push(`${fieldPath}: must be ${article} ${kind} id`);
	}
}

function validateRangeOrder(target, spec, targetPath, errors) {
	if (!target || typeof target !== "object") {
		return;
	}
	const lowVal = target[spec.low];
	const highVal = target[spec.high];
	if (typeof lowVal !== "number" || typeof highVal !== "number") {
		return;
	}
	if (lowVal > highVal) {
		errors.push(`${targetPath}: ${spec.low} must be <= ${spec.high}`);
	}
}

function checkEnvSemantics(env, path, errors) {
	if (!env || typeof env !== "object") {
		return;
	}
	checkFieldId(env.id, formatPath(path, "id"), "env", errors);
	for (const check of ENV_RANGE_CHECKS) {
		const target = env[check.prop];
		validateRangeOrder(target, check, formatPath(path, check.prop), errors);
	}
}

function checkSimSemantics(run, path, errors) {
	if (!run || typeof run !== "object") {
		return;
	}
	checkFieldId(run.id, formatPath(path, "id"), "sim", errors);
	checkFieldId(run.envId, formatPath(path, "envId"), "env", errors);
}

function runValidation(schema, data, path, semanticCheck) {
	try {
		const parsed = validate(schema, data, path);
		const errors = [...parsed.errors];
		semanticCheck(data, path, errors);
		return { ok: errors.length === 0, errors };
	} catch (err) {
		// Broad catch to guarantee validator never throws on malformed input
		const detail = err?.message || String(err);
		return {
			ok: false,
			errors: [`${path}: unexpected error: ${detail}`],
		};
	}
}

export function validateEnvironment(env, path = "$") {
	return runValidation(ENVIRONMENT_SCHEMA, env, path, checkEnvSemantics);
}

export function validateSimRun(run, path = "$") {
	return runValidation(SIM_RUN_SCHEMA, run, path, checkSimSemantics);
}
