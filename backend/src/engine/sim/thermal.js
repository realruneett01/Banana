import { newId } from "../ids.js";

export function airflowFactor(env) {
	const raw = typeof env === "number" ? env : env?.airflowMs;
	const airflowMs = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
	return 1 / (1 + 0.25 * Math.max(0, airflowMs));
}

export function altitudeFactor(env) {
	const raw = typeof env === "number" ? env : env?.altitudeM;
	const altitudeM = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
	return 1 + (0.1 * Math.max(0, altitudeM)) / 1000;
}

function isFiniteNumber(val) {
	return typeof val === "number" && Number.isFinite(val);
}

function hasThermalProps(props) {
	if (!props) {
		return false;
	}
	return isFiniteNumber(props.powerW) && isFiniteNumber(props.thetaJA);
}

function computeTj(props, env) {
	const ambientMax =
		typeof env?.ambientC?.max === "number" ? env.ambientC.max : 25;
	const thetaEff = props.thetaJA * airflowFactor(env) * altitudeFactor(env);
	const rawTj = ambientMax + props.powerW * thetaEff;
	return Math.round(rawTj * 10) / 10;
}

function createThermalIssue({ part, tj, tjMax, env, context }) {
	const severity = tj > tjMax ? "error" : "warning";
	const ambientMax =
		typeof env?.ambientC?.max === "number" ? env.ambientC.max : 25;
	const ref = part.ref || part.id;
	const relation = severity === "error" ? "exceeds" : "is within 10% of";
	const message = `${ref} junction temperature ${tj} C ${relation} ${tjMax} C at ambient ${ambientMax} C`;

	return {
		id: newId("issue"),
		source: "sim",
		severity,
		itemIds: [part.id],
		metric: "tj",
		measured: tj,
		limit: tjMax,
		unit: "C",
		message,
		suggestion: "reduce power, add copper or a heatsink, or increase airflow",
		...(context.simRunId !== undefined ? { simRunId: context.simRunId } : {}),
		commit: context.commit,
		status: "open",
	};
}

function evaluatePartThermal(part, env, context) {
	const props = part.props;
	const tj = computeTj(props, env);
	const tjMax = isFiniteNumber(props.tjMaxC) ? props.tjMaxC : 125;
	const result = { itemId: part.id, metric: "tj", value: tj, unit: "C" };
	if (tj <= 0.9 * tjMax) {
		return { result, issue: null };
	}
	const issue = createThermalIssue({ part, tj, tjMax, env, context });
	return { result, issue };
}

export function runThermal(options = {}) {
	const { ir, env, commit = "", simRunId } = options;
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const results = [];
	const issues = [];
	const context = { commit, simRunId };

	for (const part of parts) {
		if (!hasThermalProps(part?.props)) {
			continue;
		}
		const evaluated = evaluatePartThermal(part, env, context);
		results.push(evaluated.result);
		if (evaluated.issue) {
			issues.push(evaluated.issue);
		}
	}

	return { results, issues };
}
