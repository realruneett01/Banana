import express from "express";
import { validateCircuitIR } from "../engine/circuit-ir.js";
import { runErc } from "../engine/erc.js";
import { isId } from "../engine/ids.js";
import { runSimulation, SIM_KINDS } from "../engine/sim/run-sim.js";
import { createSimStore } from "../engine/sim/sim-store.js";
import { runConfinedProjectErc } from "../engine/tools/kicad-tools.js";

const router = express.Router();

const COMMIT_HEX_REGEX = /^[0-9a-fA-F]{7,40}$/;
const VALID_ISSUE_STATUSES = new Set(["open", "fixed", "wontfix"]);

let defaultStore = null;

function getStore(req) {
	if (req?.app?.locals?.simStore) {
		return req.app.locals.simStore;
	}
	if (!defaultStore) {
		defaultStore = createSimStore({
			filename: process.env.SIM_DB || ":memory:",
		});
	}
	return defaultStore;
}

function saveRunSafe(store, run, issues) {
	try {
		store.saveRun(run, issues || []);
	} catch (err) {
		// Store errors must not break simulation response
		console.warn("Failed to persist simulation run:", err?.message);
	}
}

function isPlainObject(val) {
	if (!val || typeof val !== "object") {
		return false;
	}
	return !Array.isArray(val);
}

function isValidCommitHex(val) {
	return typeof val === "string" && COMMIT_HEX_REGEX.test(val);
}

function isValidSimKind(val) {
	return typeof val === "string" && SIM_KINDS.includes(val);
}

function isValidFilterParam(val, validator) {
	if (val === undefined || val === "") {
		return true;
	}
	return typeof val === "string" && validator(val);
}

function findFirstError(rules) {
	const failed = rules.find(([isInvalid]) => isInvalid);
	return failed ? failed[1] : null;
}

function validateSimRunParams(body) {
	const { kind, env, commit, inputs } = body || {};
	const hasValidObjects = isPlainObject(env) && isPlainObject(inputs);
	return findFirstError([
		[!isValidSimKind(kind), "Invalid simulation kind"],
		[
			!isValidCommitHex(commit),
			"Invalid commit: must be a 7-40 char hex string",
		],
		[!hasValidObjects, "env and inputs must be objects"],
	]);
}

function validateRunsQuery(query) {
	const { commit, envId, kind } = query || {};
	return findFirstError([
		[!isValidFilterParam(commit, isValidCommitHex), "Invalid commit parameter"],
		[
			!isValidFilterParam(envId, (v) => isId(v, "env")),
			"Invalid envId parameter",
		],
		[!isValidFilterParam(kind, isValidSimKind), "Invalid kind parameter"],
	]);
}

function extractRunFilters(query) {
	const { commit, envId, kind } = query || {};
	return Object.fromEntries(
		Object.entries({ commit, envId, kind }).filter(([, val]) => Boolean(val)),
	);
}

function validateCompareBody(body) {
	if (!isPlainObject(body)) {
		return "Request body must be an object";
	}
	const { before, after, envId, kind } = body;
	return findFirstError([
		[!isValidCommitHex(before), "Invalid before commit"],
		[!isValidCommitHex(after), "Invalid after commit"],
		[!isValidFilterParam(envId, (v) => isId(v, "env")), "Invalid envId"],
		[!isValidFilterParam(kind, isValidSimKind), "Invalid kind"],
	]);
}

function validatePatchIssue(id, body) {
	const hasValidStatus =
		isPlainObject(body) && VALID_ISSUE_STATUSES.has(body.status);
	return findFirstError([
		[!isId(id, "issue"), "Invalid issue id"],
		[!hasValidStatus, "Invalid status: must be open, fixed, or wontfix"],
	]);
}

function sendBadRequest(res, error) {
	return res.status(400).json({ error });
}

function sendInternalError(res, message, err) {
	// Broad catch to guarantee route never leaks stack traces
	console.error(message, err?.message);
	return res.status(500).json({ error: message });
}

function formatRunResult(data) {
	return {
		run: data.run,
		issues: data.issues,
	};
}

function handleSimKinds(_req, res) {
	res.status(200).json({ kinds: SIM_KINDS });
}

async function handleSimRun(req, res) {
	const err = validateSimRunParams(req.body);
	if (err) {
		return sendBadRequest(res, err);
	}

	try {
		const { kind, env, commit, inputs } = req.body;
		const result = await runSimulation({ kind, env, commit, inputs });
		saveRunSafe(getStore(req), result.run, result.issues);
		if (result.run.status === "failed") {
			return res.status(422).json({
				error: result.error || "Simulation failed",
				run: result.run,
			});
		}
		return res.status(200).json(formatRunResult(result));
	} catch (err) {
		// Broad catch to guarantee route never leaks stack traces
		return sendInternalError(res, "Simulation execution failed", err);
	}
}

function handleListSimRuns(req, res) {
	const err = validateRunsQuery(req.query);
	if (err) {
		return sendBadRequest(res, err);
	}

	try {
		const filters = extractRunFilters(req.query);
		const runs = getStore(req).listRuns(filters);
		return res.status(200).json({ runs });
	} catch (err) {
		// Broad catch to guarantee route never leaks stack traces
		return sendInternalError(res, "Failed to list simulation runs", err);
	}
}

function handleGetSimRun(req, res) {
	const { id } = req.params;
	if (!isId(id, "sim")) {
		return sendBadRequest(res, "Invalid simulation run id");
	}

	try {
		const data = getStore(req).getRun(id);
		if (!data) {
			return res.status(404).json({ error: "Run not found" });
		}
		return res.status(200).json(formatRunResult(data));
	} catch (err) {
		// Broad catch to guarantee route never leaks stack traces
		return sendInternalError(res, "Failed to get simulation run", err);
	}
}

function handleCompareSimRuns(req, res) {
	const err = validateCompareBody(req.body);
	if (err) {
		return sendBadRequest(res, err);
	}

	try {
		const { before, after, envId, kind } = req.body;
		const diff = getStore(req).compareCommits({ before, after, envId, kind });
		return res.status(200).json(diff);
	} catch (err) {
		if (err?.message?.includes("no run for")) {
			return res.status(404).json({ error: err.message });
		}
		// Broad catch to guarantee route never leaks stack traces
		return sendInternalError(res, "Failed to compare simulation runs", err);
	}
}

function handlePatchIssue(req, res) {
	const err = validatePatchIssue(req.params.id, req.body);
	if (err) {
		return sendBadRequest(res, err);
	}

	try {
		const updated = getStore(req).setIssueStatus(
			req.params.id,
			req.body.status,
		);
		if (!updated) {
			return res.status(404).json({ error: "Issue not found" });
		}
		return res.status(200).json({ ok: true });
	} catch (err) {
		// Broad catch to guarantee route never leaks stack traces
		return sendInternalError(res, "Failed to update issue status", err);
	}
}

function handleErcRun(req, res) {
	const { ir, commit } = req.body || {};
	const validation = validateCircuitIR(ir);
	if (!validation.ok) {
		return res.status(400).json({
			error: "Invalid circuit IR",
			errors: validation.errors,
		});
	}

	try {
		const commitRef = typeof commit === "string" ? commit : "";
		const issues = runErc(ir, { commit: commitRef });
		return res.status(200).json({ issues });
	} catch (err) {
		// Broad catch to guarantee route never leaks stack traces
		return sendInternalError(res, "ERC execution failed", err);
	}
}

// Reads local files, so desktop-only like the project routes; the root
// sheet must resolve inside app.locals.projectsRoot (default: home dir).
async function handleErcProject(req, res) {
	const locals = req.app?.locals ?? {};
	if (locals.allowLocalRepos !== true) {
		return res
			.status(403)
			.json({ error: "Project ERC is only available in the desktop app" });
	}
	const { path: schPath, commit } = req.body || {};
	try {
		const report = await runConfinedProjectErc({
			projectsRoot: locals.projectsRoot,
			schPath,
			commit: typeof commit === "string" ? commit : "",
		});
		return res.status(200).json(report);
	} catch (err) {
		return sendBadRequest(res, err.message);
	}
}

const ROUTE_DEFS = [
	["get", "/sim/kinds", handleSimKinds],
	["get", "/sim/runs", handleListSimRuns],
	["get", "/sim/runs/:id", handleGetSimRun],
	["post", "/sim/run", handleSimRun],
	["post", "/sim/compare", handleCompareSimRuns],
	["patch", "/issues/:id", handlePatchIssue],
	["post", "/erc/run", handleErcRun],
	["post", "/erc/project", handleErcProject],
];

for (const [method, routePath, handler] of ROUTE_DEFS) {
	router[method]([routePath, `/api${routePath}`], handler);
}

export default router;
