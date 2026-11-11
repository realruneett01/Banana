import express from "express";
import { validateCircuitIR } from "../engine/circuit-ir.js";
import { runErc } from "../engine/erc.js";
import { isId } from "../engine/ids.js";
import { runSimulation, SIM_KINDS } from "../engine/sim/run-sim.js";
import { createSimStore } from "../engine/sim/sim-store.js";

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
	} catch (_err) {
		// Store errors must not break simulation response
	}
}

function isPlainObject(val) {
	if (!val || typeof val !== "object") {
		return false;
	}
	return !Array.isArray(val);
}

function isValidFilterParam(val, validator) {
	if (val === undefined || val === "") {
		return true;
	}
	return typeof val === "string" && validator(val);
}

function validateSimRunParams(body) {
	const { kind, env, commit, inputs } = body || {};
	if (typeof kind !== "string" || !SIM_KINDS.includes(kind)) {
		return "Invalid simulation kind";
	}
	if (typeof commit !== "string" || !COMMIT_HEX_REGEX.test(commit)) {
		return "Invalid commit: must be a 7-40 char hex string";
	}
	if (!isPlainObject(env) || !isPlainObject(inputs)) {
		return "env and inputs must be objects";
	}
	return null;
}

function validateRunsQuery(query) {
	const { commit, envId, kind } = query || {};
	if (!isValidFilterParam(commit, (v) => COMMIT_HEX_REGEX.test(v))) {
		return "Invalid commit parameter";
	}
	if (!isValidFilterParam(envId, (v) => isId(v, "env"))) {
		return "Invalid envId parameter";
	}
	if (!isValidFilterParam(kind, (v) => SIM_KINDS.includes(v))) {
		return "Invalid kind parameter";
	}
	return null;
}

function extractRunFilters(query) {
	const { commit, envId, kind } = query || {};
	const filters = {};
	if (commit) filters.commit = commit;
	if (envId) filters.envId = envId;
	if (kind) filters.kind = kind;
	return filters;
}

function validateCompareBody(body) {
	if (!isPlainObject(body)) {
		return "Request body must be an object";
	}
	const { before, after, envId, kind } = body;
	if (typeof before !== "string" || !COMMIT_HEX_REGEX.test(before)) {
		return "Invalid before commit";
	}
	if (typeof after !== "string" || !COMMIT_HEX_REGEX.test(after)) {
		return "Invalid after commit";
	}
	if (!isValidFilterParam(envId, (v) => isId(v, "env"))) {
		return "Invalid envId";
	}
	if (!isValidFilterParam(kind, (v) => SIM_KINDS.includes(v))) {
		return "Invalid kind";
	}
	return null;
}

function validatePatchIssue(id, body) {
	if (!isId(id, "issue")) {
		return "Invalid issue id";
	}
	if (!isPlainObject(body) || !VALID_ISSUE_STATUSES.has(body.status)) {
		return "Invalid status: must be open, fixed, or wontfix";
	}
	return null;
}

function handleSimKinds(_req, res) {
	res.status(200).json({ kinds: SIM_KINDS });
}

async function handleSimRun(req, res) {
	const err = validateSimRunParams(req.body);
	if (err) {
		return res.status(400).json({ error: err });
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
		return res.status(200).json({
			run: result.run,
			issues: result.issues,
		});
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Simulation execution failed" });
	}
}

function handleListSimRuns(req, res) {
	const err = validateRunsQuery(req.query);
	if (err) {
		return res.status(400).json({ error: err });
	}

	try {
		const filters = extractRunFilters(req.query);
		const runs = getStore(req).listRuns(filters);
		return res.status(200).json({ runs });
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Failed to list simulation runs" });
	}
}

function handleGetSimRun(req, res) {
	const { id } = req.params;
	if (!isId(id, "sim")) {
		return res.status(400).json({ error: "Invalid simulation run id" });
	}

	try {
		const data = getStore(req).getRun(id);
		if (!data) {
			return res.status(404).json({ error: "Run not found" });
		}
		return res.status(200).json({
			run: data.run,
			issues: data.issues,
		});
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Failed to get simulation run" });
	}
}

function handleCompareSimRuns(req, res) {
	const err = validateCompareBody(req.body);
	if (err) {
		return res.status(400).json({ error: err });
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
		return res.status(500).json({ error: "Failed to compare simulation runs" });
	}
}

function handlePatchIssue(req, res) {
	const err = validatePatchIssue(req.params.id, req.body);
	if (err) {
		return res.status(400).json({ error: err });
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
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Failed to update issue status" });
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
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "ERC execution failed" });
	}
}

router.get(["/sim/kinds", "/api/sim/kinds"], handleSimKinds);
router.get(["/sim/runs", "/api/sim/runs"], handleListSimRuns);
router.get(["/sim/runs/:id", "/api/sim/runs/:id"], handleGetSimRun);
router.post(["/sim/run", "/api/sim/run"], handleSimRun);
router.post(["/sim/compare", "/api/sim/compare"], handleCompareSimRuns);
router.patch(["/issues/:id", "/api/issues/:id"], handlePatchIssue);
router.post(["/erc/run", "/api/erc/run"], handleErcRun);

export default router;
