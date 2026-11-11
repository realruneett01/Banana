import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function isRecord(value) {
	if (value === null || typeof value !== "object") {
		return false;
	}
	return !Array.isArray(value);
}

function isPlainObject(value) {
	if (!isRecord(value)) {
		return false;
	}
	return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeInputSchema(schema) {
	if (!isRecord(schema)) {
		return { type: "object" };
	}
	return { ...schema, type: "object" };
}

function mapTool(tool) {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: normalizeInputSchema(tool.inputSchema),
		annotations: {
			readOnlyHint: tool.permission === "read",
			destructiveHint: tool.permission === "destructive",
		},
	};
}

function formatSuccess(output) {
	const text = JSON.stringify(output) ?? "";
	const res = {
		content: [{ type: "text", text }],
	};
	if (isPlainObject(output)) {
		res.structuredContent = output;
	}
	return res;
}

function formatFailure(error) {
	const text =
		typeof error === "string"
			? error
			: error?.message || String(error ?? "error");
	return {
		content: [{ type: "text", text }],
		isError: true,
	};
}

async function handleCallTool(registry, approveDestructive, request) {
	try {
		const { name, arguments: args } = request?.params ?? {};
		if (!name) {
			return formatFailure("Tool name is required");
		}
		const res = await registry.call(name, args ?? {}, {
			approved: approveDestructive,
			via: "mcp",
		});
		if (!res?.ok) {
			return formatFailure(res?.error ?? "tool call failed");
		}
		return formatSuccess(res.output);
	} catch (err) {
		// Handler or registry threw unexpectedly; return structured error result
		return formatFailure(err?.message || String(err));
	}
}

export function createMcpServer(options = {}) {
	const {
		registry,
		name = "banana",
		version = "0.1.0",
		approveDestructive = false,
	} = options;

	const server = new Server({ name, version }, { capabilities: { tools: {} } });

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: (registry?.list?.() ?? []).map(mapTool),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) =>
		handleCallTool(registry, approveDestructive, request),
	);

	return server;
}
