import { validateEnvironment } from "../environment-sim.js";
import { newId } from "../ids.js";
import { runIrDrop } from "./ir-drop.js";
import { runThermal } from "./thermal.js";
import { runTraceCurrent } from "./trace-current.js";

export const SIM_KINDS = Object.freeze(["thermal", "trace-current", "ir-drop"]);

const SIMULATORS = {
	thermal: (opts) => runThermal(opts),
	"trace-current": (opts) => runTraceCurrent(opts),
	"ir-drop": (opts) => runIrDrop(opts),
};

const defaultNow = () => new Date().toISOString();

function makeRun(spec) {
	return {
		id: spec.id,
		commit: spec.commit,
		envId: spec.envId,
		kind: spec.kind,
		status: spec.status,
		startedAt: spec.startedAt,
		finishedAt: spec.finishedAt,
		results: spec.results,
	};
}

function collectValidationErrors(env, kind) {
	const errors = [];
	const envRes = validateEnvironment(env);
	if (!envRes.ok) {
		errors.push(...envRes.errors);
	}
	if (!Object.hasOwn(SIMULATORS, kind)) {
		errors.push(`unknown simulation kind: ${kind}`);
	}
	return errors;
}

function failSimulation(spec) {
	return {
		run: makeRun({
			id: spec.simRunId,
			commit: spec.commit,
			envId: spec.env?.id ?? "",
			kind: spec.kind,
			status: "failed",
			startedAt: spec.startedAt,
			finishedAt: spec.finishedAt,
			results: [],
		}),
		issues: [],
		error: spec.error,
	};
}

async function executeSimulation(spec) {
	const { kind, env, commit, inputs, simRunId, startedAt, now } = spec;
	try {
		const runner = SIMULATORS[kind];
		const simInputs = { ...(inputs || {}), env, commit, simRunId };
		const { results = [], issues = [] } = (await runner(simInputs)) || {};
		const run = makeRun({
			id: simRunId,
			commit,
			envId: env.id,
			kind,
			status: "done",
			startedAt,
			finishedAt: now(),
			results,
		});
		return { run, issues };
	} catch (err) {
		// Broad catch to guarantee simulator failure never crashes runner
		return failSimulation({
			simRunId,
			commit,
			env,
			kind,
			startedAt,
			finishedAt: now(),
			error: err?.message || String(err),
		});
	}
}

export async function runSimulation(spec = {}) {
	const { kind, env, commit, inputs = {}, now = defaultNow } = spec;
	const simRunId = newId("sim");
	const startedAt = now();
	const errors = collectValidationErrors(env, kind);
	if (errors.length > 0) {
		return failSimulation({
			simRunId,
			commit,
			env,
			kind,
			startedAt,
			finishedAt: now(),
			error: errors.join("; "),
		});
	}
	return executeSimulation({
		kind,
		env,
		commit,
		inputs,
		simRunId,
		startedAt,
		now,
	});
}
