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

function joinPath(base, key) {
	if (!base || base === "$") {
		return base ? `$.${key}` : key;
	}
	return `${base}.${key}`;
}

function hasMinMax(obj) {
	if (!obj || typeof obj !== "object") {
		return false;
	}
	return typeof obj.min === "number" && typeof obj.max === "number";
}

function hasFromTo(obj) {
	if (!obj || typeof obj !== "object") {
		return false;
	}
	return typeof obj.fromHz === "number" && typeof obj.toHz === "number";
}

function checkEnvSemantics(env, path, errors) {
	if (!env || typeof env !== "object") {
		return;
	}
	if (typeof env.id === "string" && !isId(env.id, "env")) {
		errors.push(`${joinPath(path, "id")}: must be an env id`);
	}
	if (hasMinMax(env.ambientC) && env.ambientC.min > env.ambientC.max) {
		errors.push(`${joinPath(path, "ambientC")}: min must be <= max`);
	}
	if (hasMinMax(env.humidityPct) && env.humidityPct.min > env.humidityPct.max) {
		errors.push(`${joinPath(path, "humidityPct")}: min must be <= max`);
	}
	if (hasFromTo(env.vibration) && env.vibration.fromHz > env.vibration.toHz) {
		errors.push(`${joinPath(path, "vibration")}: fromHz must be <= toHz`);
	}
}

function checkSimSemantics(run, path, errors) {
	if (!run || typeof run !== "object") {
		return;
	}
	if (typeof run.id === "string" && !isId(run.id, "sim")) {
		errors.push(`${joinPath(path, "id")}: must be a sim id`);
	}
	if (typeof run.envId === "string" && !isId(run.envId, "env")) {
		errors.push(`${joinPath(path, "envId")}: must be an env id`);
	}
}

export function validateEnvironment(env, path = "$") {
	try {
		const result = validate(ENVIRONMENT_SCHEMA, env, path);
		const errors = [...result.errors];
		checkEnvSemantics(env, path, errors);
		return { ok: errors.length === 0, errors };
	} catch (err) {
		// Broad catch to guarantee validator never throws on malformed input
		return {
			ok: false,
			errors: [`${path}: unexpected error: ${err?.message || String(err)}`],
		};
	}
}

export function validateSimRun(run, path = "$") {
	try {
		const result = validate(SIM_RUN_SCHEMA, run, path);
		const errors = [...result.errors];
		checkSimSemantics(run, path, errors);
		return { ok: errors.length === 0, errors };
	} catch (err) {
		// Broad catch to guarantee validator never throws on malformed input
		return {
			ok: false,
			errors: [`${path}: unexpected error: ${err?.message || String(err)}`],
		};
	}
}
