import { isId, newId } from "./ids.js";
import { validate } from "./schema-lite.js";

const TOOL_SCHEMA = {
	type: "object",
	required: [
		"name",
		"description",
		"inputSchema",
		"outputSchema",
		"permission",
		"handler",
	],
	properties: {
		id: { type: "string" },
		name: { type: "string", minLength: 1 },
		description: { type: "string" },
		inputSchema: { type: "object" },
		outputSchema: { type: "object" },
		permission: { enum: ["read", "write", "destructive"] },
		handler: {},
	},
	additionalProperties: false,
};

function isRecord(value) {
	if (value === null || Array.isArray(value)) {
		return false;
	}
	return typeof value === "object";
}

function checkToolSemantics(def, errors) {
	if (!isRecord(def)) {
		return;
	}
	if (def.handler !== undefined && typeof def.handler !== "function") {
		errors.push("$.handler: must be a function");
	}
	if (def.id !== undefined && !isId(def.id, "tool")) {
		errors.push("$.id: must be a valid tool id");
	}
}

function validateToolDefinition(def) {
	const res = validate(TOOL_SCHEMA, def);
	const errors = [...res.errors];
	checkToolSemantics(def, errors);
	return {
		ok: errors.length === 0,
		errors,
	};
}

function registerTool(tools, def) {
	const validation = validateToolDefinition(def);
	if (!validation.ok) {
		throw new Error(`Invalid tool definition: ${validation.errors.join("; ")}`);
	}
	if (tools.has(def.name)) {
		throw new Error(`Tool already registered: ${def.name}`);
	}
	const id = def.id || newId("tool");
	tools.set(def.name, {
		id,
		name: def.name,
		description: def.description,
		inputSchema: def.inputSchema,
		outputSchema: def.outputSchema,
		permission: def.permission,
		handler: def.handler,
	});
}

function listTools(tools) {
	return Array.from(tools.values()).map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
		permission: tool.permission,
	}));
}

function checkCallPreconditions(tool, name, ctx) {
	if (!tool) {
		return { ok: false, error: `unknown tool: ${name}` };
	}
	if (tool.permission === "destructive" && ctx?.approved !== true) {
		return { ok: false, error: "approval required" };
	}
	return null;
}

function validateCallPayload(schema, data) {
	const res = validate(schema, data);
	if (!res.ok) {
		return { ok: false, error: res.errors.join("; ") };
	}
	return null;
}

function executeHandler(handler, input, ctx) {
	try {
		return { ok: true, value: handler(input, ctx) };
	} catch (err) {
		// Handler threw synchronously; capture message
		return { ok: false, error: err?.message || String(err) };
	}
}

function handleAsyncOutput(promise, outputSchema) {
	return promise.then(
		(asyncOutput) => {
			const err = validateCallPayload(outputSchema, asyncOutput);
			if (err) {
				return err;
			}
			return { ok: true, output: asyncOutput };
		},
		(err) => ({ ok: false, error: err?.message || String(err) }),
	);
}

function callTool(tools, name, input, ctx) {
	const tool = tools.get(name);
	const preError = checkCallPreconditions(tool, name, ctx);
	if (preError) {
		return preError;
	}
	const inError = validateCallPayload(tool.inputSchema, input);
	if (inError) {
		return inError;
	}
	const execResult = executeHandler(tool.handler, input, ctx);
	if (!execResult.ok) {
		return { ok: false, error: execResult.error };
	}
	if (execResult.value && typeof execResult.value.then === "function") {
		return handleAsyncOutput(execResult.value, tool.outputSchema);
	}
	const outError = validateCallPayload(tool.outputSchema, execResult.value);
	if (outError) {
		return outError;
	}
	return { ok: true, output: execResult.value };
}

export function createRegistry() {
	const tools = new Map();
	return {
		register: (def) => registerTool(tools, def),
		list: () => listTools(tools),
		call: (name, input, ctx) => callTool(tools, name, input, ctx),
	};
}
