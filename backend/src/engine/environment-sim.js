import { isId } from "./ids.js";
import { validate } from "./schema-lite.js";

function makeObjectSchema(required, fieldDefs) {
	const properties = {};
	for (const [key, value] of Object.entries(fieldDefs)) {
		properties[key] = typeof value === "string" ? { type: value } : value;
	}
	return {
		type: "object",
		required,
		additionalProperties: false,
		properties,
	};
}

const MIN_MAX_SCHEMA = makeObjectSchema(["min", "max"], {
	min: "number",
	max: "number",
});

export const ENVIRONMENT_SCHEMA = makeObjectSchema(
	["id", "name", "ambientC", "humidityPct", "altitudeM"],
	{
		id: "string",
		name: "string",
		ambientC: MIN_MAX_SCHEMA,
		humidityPct: MIN_MAX_SCHEMA,
		altitudeM: "number",
		vibration: makeObjectSchema(["psdG2Hz", "fromHz", "toHz"], {
			psdG2Hz: "number",
			fromHz: "number",
			toHz: "number",
		}),
		shockG: "number",
		airflowMs: "number",
	},
);

export const SIM_RUN_SCHEMA = makeObjectSchema(
	["id", "commit", "envId", "kind", "status", "startedAt", "results"],
	{
		id: "string",
		commit: {
			type: "string",
			pattern: "^[0-9a-fA-F]{7,40}$",
		},
		envId: "string",
		kind: {
			type: "string",
			enum: ["trace-current", "ir-drop", "impedance", "spice", "thermal"],
		},
		status: {
			type: "string",
			enum: ["queued", "running", "done", "failed"],
		},
		startedAt: "string",
		finishedAt: "string",
		results: {
			type: "array",
			items: makeObjectSchema(["itemId", "metric", "value", "unit"], {
				itemId: "string",
				metric: "string",
				value: "number",
				unit: "string",
			}),
		},
	},
);

const RANGE_RULES = [
	{ prop: "ambientC", low: "min", high: "max" },
	{ prop: "humidityPct", low: "min", high: "max" },
	{ prop: "vibration", low: "fromHz", high: "toHz" },
];

const ENV_ID_RULES = [{ prop: "id", kind: "env" }];
const SIM_ID_RULES = [
	{ prop: "id", kind: "sim" },
	{ prop: "envId", kind: "env" },
];

function subPath(base, prop) {
	return base ? `${base}.${prop}` : prop;
}

function checkRecordId(val, fieldPath, kind, errors) {
	if (typeof val !== "string" || isId(val, kind)) {
		return;
	}
	const article = kind === "env" ? "an" : "a";
	errors.push(`${fieldPath}: must be ${article} ${kind} id`);
}

function validateFieldIds(record, path, idRules, errors) {
	for (const { prop, kind } of idRules) {
		checkRecordId(record[prop], subPath(path, prop), kind, errors);
	}
}

function checkSingleRange(target, spec, targetPath, errors) {
	if (!target || typeof target !== "object") {
		return;
	}
	const minVal = target[spec.low];
	const maxVal = target[spec.high];
	if (typeof minVal !== "number" || typeof maxVal !== "number") {
		return;
	}
	if (minVal > maxVal) {
		errors.push(`${targetPath}: ${spec.low} must be <= ${spec.high}`);
	}
}

function checkEnvSemantics(env, path, errors) {
	if (!env || typeof env !== "object") {
		return;
	}
	validateFieldIds(env, path, ENV_ID_RULES, errors);
	for (const rule of RANGE_RULES) {
		checkSingleRange(env[rule.prop], rule, subPath(path, rule.prop), errors);
	}
}

function checkSimSemantics(run, path, errors) {
	if (!run || typeof run !== "object") {
		return;
	}
	validateFieldIds(run, path, SIM_ID_RULES, errors);
}

function executeValidation(schema, payload, path, applySemantics) {
	try {
		const outcome = validate(schema, payload, path);
		const issues = outcome.errors.slice();
		applySemantics(payload, path, issues);
		return { ok: issues.length === 0, errors: issues };
	} catch (err) {
		// Broad catch to guarantee validator never throws on malformed input
		const detail = err?.message ?? String(err);
		return { ok: false, errors: [`${path}: unexpected error: ${detail}`] };
	}
}

export function validateEnvironment(env, path = "$") {
	return executeValidation(ENVIRONMENT_SCHEMA, env, path, checkEnvSemantics);
}

export function validateSimRun(run, path = "$") {
	return executeValidation(SIM_RUN_SCHEMA, run, path, checkSimSemantics);
}
