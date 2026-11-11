import express from "express";
import { createAgent } from "../engine/agent.js";
import { createModelAdapter } from "../engine/model-adapter.js";
import { createRegistry } from "../engine/tool-registry.js";
import { registerCommitTools } from "../engine/tools/commit-tools.js";
import { registerDesignTools } from "../engine/tools/design-tools.js";
import { registerDiffTools } from "../engine/tools/diff-tools.js";
import { registerKicadTools } from "../engine/tools/kicad-tools.js";
import { registerPatchTools } from "../engine/tools/patch-tools.js";
import { registerRouteTools } from "../engine/tools/route-tools.js";

function isPlainObject(val) {
	if (!val || typeof val !== "object") {
		return false;
	}
	return !Array.isArray(val);
}

function isValidMessage(message) {
	if (typeof message !== "string") {
		return false;
	}
	return message.length >= 1 && message.length <= 8000;
}

function isValidApproved(approved) {
	if (approved === undefined) {
		return true;
	}
	return typeof approved === "boolean";
}

function isValidMaxSteps(maxSteps) {
	if (maxSteps === undefined) {
		return true;
	}
	if (!Number.isInteger(maxSteps)) {
		return false;
	}
	return maxSteps >= 1 && maxSteps <= 16;
}

function validateAgentRunBody(body) {
	if (!isPlainObject(body)) {
		return "Request body must be an object";
	}
	if (!isValidMessage(body.message)) {
		return "Invalid message: must be a string of 1-8000 characters";
	}
	if (!isValidApproved(body.approved)) {
		return "Invalid approved: must be a boolean";
	}
	if (!isValidMaxSteps(body.maxSteps)) {
		return "Invalid maxSteps: must be an integer between 1 and 16";
	}
	return null;
}

export function buildHostedRegistry() {
	const registry = createRegistry();
	registerDesignTools(registry);
	return registry;
}

export function buildLocalRegistry(deps = {}) {
	const registry = createRegistry();
	registerDiffTools(registry);
	registerKicadTools(registry);
	registerDesignTools(registry);
	registerRouteTools(registry, deps?.route);
	registerCommitTools(registry, deps?.commit ?? deps);
	registerPatchTools(registry, deps?.patch ?? deps);
	return registry;
}

function resolveModel(req) {
	if (typeof req.app?.locals?.agentModelFactory === "function") {
		return req.app.locals.agentModelFactory();
	}
	return createModelAdapter();
}

function formatRunResponse(result, events) {
	const responseData = {
		text: result?.text ?? "",
		steps: result?.steps ?? 0,
		events,
	};
	if (result?.pendingApproval !== undefined) {
		responseData.pendingApproval = result.pendingApproval;
	}
	return responseData;
}

function createEventCollector() {
	const events = [];
	const onEvent = (event) => {
		if (events.length < 200) {
			events.push(event);
		}
	};
	return { events, onEvent };
}

async function executeAgentRun(req, res, registry) {
	const { message, approved, maxSteps } = req.body;
	const { events, onEvent } = createEventCollector();
	const model = resolveModel(req);
	const agent = createAgent({ model, registry, maxSteps, onEvent });
	const abortController = new AbortController();
	const onDisconnect = () => {
		if (!res.writableEnded) {
			abortController.abort();
		}
	};
	res.on("close", onDisconnect);
	try {
		const result = await agent.run(message, {
			approved,
			signal: abortController.signal,
		});
		return formatRunResponse(result, events);
	} finally {
		res.off("close", onDisconnect);
	}
}

async function handleAgentRun(req, res, registry) {
	const validationError = validateAgentRunBody(req.body);
	if (validationError) {
		return res.status(400).json({ error: validationError });
	}
	try {
		const responseData = await executeAgentRun(req, res, registry);
		return res.status(200).json(responseData);
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces or keys
		if (!res.headersSent) {
			return res.status(500).json({ error: "Agent run failed" });
		}
	}
}

export function createAgentRouter() {
	const router = express.Router();
	let hostedRegistry = null;
	let localRegistry = null;

	function getRegistry(req) {
		if (req.app?.locals?.allowLocalRepos === true) {
			localRegistry ??= buildLocalRegistry();
			return localRegistry;
		}
		hostedRegistry ??= buildHostedRegistry();
		return hostedRegistry;
	}

	router.post(["/agent/run", "/api/agent/run"], (req, res) => {
		handleAgentRun(req, res, getRegistry(req));
	});

	return router;
}

const defaultRouter = createAgentRouter();
export default defaultRouter;
