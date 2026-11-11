import express from "express";
import { validateCircuitIR } from "../engine/circuit-ir.js";
import { runErc } from "../engine/erc.js";
import { runSimulation, SIM_KINDS } from "../engine/sim/run-sim.js";

const router = express.Router();

const COMMIT_HEX_REGEX = /^[0-9a-fA-F]{7,40}$/;

function isPlainObject(val) {
	if (!val || typeof val !== "object") {
		return false;
	}
	return !Array.isArray(val);
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
router.post(["/sim/run", "/api/sim/run"], handleSimRun);
router.post(["/erc/run", "/api/erc/run"], handleErcRun);

export default router;
