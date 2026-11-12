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
import { createRateLimiter, skipWhenLocal } from "../rate-limit.js";

const ALLOWED_PROVIDERS = new Set(["gemini", "claude", "ollama"]);
const API_KEY_PATTERN = /^\S{10,300}$/;
const MODEL_NAME_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

const SSE_HEADERS = {
	"Content-Type": "text/event-stream",
	"Cache-Control": "no-cache, no-transform",
	Connection: "keep-alive",
	"X-Accel-Buffering": "no",
};

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

function isValidProvider(provider) {
	if (provider === undefined) {
		return true;
	}
	return typeof provider === "string" && ALLOWED_PROVIDERS.has(provider);
}

function isValidModel(model) {
	if (model === undefined) {
		return true;
	}
	return typeof model === "string" && MODEL_NAME_PATTERN.test(model);
}

const BODY_VALIDATORS = [
	{
		check: (b) => isValidMessage(b.message),
		error: "Invalid message: must be a string of 1-8000 characters",
	},
	{
		check: (b) => isValidApproved(b.approved),
		error: "Invalid approved: must be a boolean",
	},
	{
		check: (b) => isValidMaxSteps(b.maxSteps),
		error: "Invalid maxSteps: must be an integer between 1 and 16",
	},
	{
		check: (b) => isValidProvider(b.provider),
		error: "Invalid provider",
	},
	{
		check: (b) => isValidModel(b.model),
		error: "Invalid model",
	},
];

function validateAgentRunBody(body) {
	if (!isPlainObject(body)) {
		return "Request body must be an object";
	}
	for (const { check, error } of BODY_VALIDATORS) {
		if (!check(body)) {
			return error;
		}
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

function extractApiKey(req) {
	const key = req?.headers?.["x-model-api-key"];
	if (typeof key === "string" && API_KEY_PATTERN.test(key)) {
		return key;
	}
	return undefined;
}

function buildModelOptions(req, provider) {
	const options = {};
	if (provider !== undefined) {
		options.provider = provider;
		if (req?.body?.model !== undefined) {
			options.model = req.body.model;
		}
	}
	const apiKey = extractApiKey(req);
	if (apiKey !== undefined) {
		options.apiKey = apiKey;
	}
	return Object.keys(options).length > 0 ? options : undefined;
}

function resolveModel(req, provider) {
	const options = buildModelOptions(req, provider);
	if (typeof req.app?.locals?.agentModelFactory === "function") {
		return req.app.locals.agentModelFactory(options);
	}
	return createModelAdapter(options);
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

function createEventCollector(onStep) {
	const events = [];
	const onEvent = (event) => {
		if (events.length < 200) {
			events.push(event);
			onStep?.(event);
		}
	};
	return { events, onEvent };
}

function canWrite(res) {
	return Boolean(res.writable && !res.writableEnded && !res.destroyed);
}

function writeSseFrame(res, eventName, data) {
	if (canWrite(res)) {
		res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
	}
}

function writeSsePing(res) {
	if (canWrite(res)) {
		res.write(": ping\n\n");
	}
}

async function executeAgentRun(req, res, registry, onStep) {
	const { message, approved, maxSteps, provider } = req.body;
	const { events, onEvent } = createEventCollector(onStep);
	const model = resolveModel(req, provider);
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

async function handleAgentRunStream(req, res, registry) {
	const validationError = validateAgentRunBody(req.body);
	if (validationError) {
		return res.status(400).json({ error: validationError });
	}
	res.writeHead(200, SSE_HEADERS);
	const pingTimer = setInterval(() => writeSsePing(res), 15000);
	const stopPing = () => clearInterval(pingTimer);
	res.on("close", stopPing);
	try {
		const onStep = (event) => writeSseFrame(res, "step", event);
		const responseData = await executeAgentRun(req, res, registry, onStep);
		writeSseFrame(res, "result", responseData);
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces or keys
		writeSseFrame(res, "error", { error: "Agent run failed" });
	} finally {
		stopPing();
		res.off("close", stopPing);
		if (canWrite(res)) {
			res.end();
		}
	}
}

const passThrough = (_req, _res, next) => next();

export function createAgentRouter({ limiter } = {}) {
	const router = express.Router();
	const routeLimiter = limiter ?? passThrough;
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

	router.post(["/agent/run", "/api/agent/run"], routeLimiter, (req, res) => {
		handleAgentRun(req, res, getRegistry(req));
	});

	router.post(
		["/agent/run/stream", "/api/agent/run/stream"],
		routeLimiter,
		(req, res) => {
			handleAgentRunStream(req, res, getRegistry(req));
		},
	);

	return router;
}

const defaultRateLimiter = createRateLimiter({ windowMs: 60000, max: 10 });
const defaultRouter = createAgentRouter({
	limiter: skipWhenLocal(defaultRateLimiter),
});
defaultRouter.limiter = defaultRateLimiter;
export default defaultRouter;
