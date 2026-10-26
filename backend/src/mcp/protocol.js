import { callTool, toolList } from "./tools.js";

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = {
	name: "banana",
	title: "Banana Board Designer",
	version: "1.0.0",
};

const INSTRUCTIONS = `Banana designs, edits, checks and simulates KiCad boards.
Typical flow: create_project -> search_symbols / get_symbol (read the real pins) -> edit (parts, nets) with build set -> run_checks -> autoroute -> add_test + run_simulation -> diff / render to review. Connect pins by "REF.PIN" (number or unique name). Power rails are drawn as power symbols; mark off-board supplies with set_net_flags external:true. Every build is a git commit so diff shows exactly what changed.`;

const rpcError = (id, code, message, data) => ({
	jsonrpc: "2.0",
	id: id ?? null,
	error: { code, message, ...(data !== undefined ? { data } : {}) },
});
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });

/** Handles one JSON-RPC message. Returns a response object, or null for notifications. */
export async function handleMessage(msg) {
	if (
		!msg ||
		typeof msg !== "object" ||
		Array.isArray(msg) ||
		msg.jsonrpc !== "2.0" ||
		typeof msg.method !== "string"
	)
		return rpcError(msg?.id, -32600, "Invalid Request");
	const isNotification = msg.id === undefined;
	if (
		!isNotification &&
		typeof msg.id !== "string" &&
		typeof msg.id !== "number"
	)
		return rpcError(
			null,
			-32600,
			"Invalid Request: id must be a string or number",
		);
	if (isNotification) return null; // initialized, cancelled, ... need no reply
	const { id, method, params } = msg;
	switch (method) {
		case "initialize": {
			const asked = params?.protocolVersion;
			return ok(id, {
				protocolVersion: SUPPORTED_VERSIONS.includes(asked)
					? asked
					: SUPPORTED_VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
				instructions: INSTRUCTIONS,
			});
		}
		case "ping":
			return ok(id, {});
		case "tools/list":
			return ok(id, { tools: toolList() });
		case "tools/call": {
			if (!params || typeof params.name !== "string")
				return rpcError(id, -32602, "tools/call needs params.name");
			if (
				params.arguments !== undefined &&
				(params.arguments === null ||
					typeof params.arguments !== "object" ||
					Array.isArray(params.arguments))
			)
				return rpcError(id, -32602, "params.arguments must be an object");
			const r = await callTool(params.name, params.arguments);
			if (r.code === "unknown_tool") return rpcError(id, -32602, r.error);
			const payload = r.ok
				? r.result
				: {
						error: r.error,
						code: r.code,
						...(r.details ? { details: r.details } : {}),
					};
			return ok(id, {
				content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
				...(r.ok ? { structuredContent: payload } : {}),
				isError: !r.ok,
			});
		}
		case "resources/list":
			return ok(id, { resources: [] });
		case "prompts/list":
			return ok(id, { prompts: [] });
		default:
			return rpcError(id, -32601, `Method not found: ${method}`);
	}
}

/** Parses one line of input and returns the serialisable reply (or null). Handles batches. */
export async function handleLine(line) {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return rpcError(null, -32700, "Parse error");
	}
	if (Array.isArray(msg)) {
		if (msg.length === 0)
			return rpcError(null, -32600, "Invalid Request: empty batch");
		const replies = (await Promise.all(msg.map(handleMessage))).filter(Boolean);
		return replies.length ? replies : null;
	}
	return handleMessage(msg);
}
