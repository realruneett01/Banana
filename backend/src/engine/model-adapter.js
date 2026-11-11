const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function sanitizeError(err, apiKey) {
	const rawMessage = err?.message || String(err);
	const shouldRedact = Boolean(apiKey);
	const message = shouldRedact
		? rawMessage.replaceAll(apiKey, "[REDACTED]")
		: rawMessage;
	const safeErr = new Error(message);
	if (err?.status !== undefined) {
		safeErr.status = err.status;
	}
	return safeErr;
}

function resolveToolSchema(tool) {
	return tool.inputSchema || tool.parameters || { type: "object" };
}

function hasTools(tools) {
	return Array.isArray(tools) && tools.length > 0;
}

function mapToolDeclaration(tool) {
	return {
		name: tool.name,
		description: tool.description || "",
		parameters: resolveToolSchema(tool),
	};
}

function mapTools(tools) {
	if (!hasTools(tools)) {
		return undefined;
	}
	return [
		{
			functionDeclarations: tools.map(mapToolDeclaration),
		},
	];
}

function mapCallToFunctionPart(call) {
	return {
		functionCall: {
			name: call.name,
			args: call.input || {},
		},
	};
}

function mapAssistantParts(msg) {
	const parts = [];
	if (msg.content) {
		parts.push({ text: msg.content });
	}
	if (Array.isArray(msg.toolCalls)) {
		parts.push(...msg.toolCalls.map(mapCallToFunctionPart));
	}
	if (parts.length === 0 && msg.text) {
		parts.push({ text: msg.text });
	}
	return parts;
}

function mapToolResponse(content) {
	if (typeof content === "object" && content !== null) {
		return content;
	}
	return { output: content };
}

function isModelRole(role) {
	return role === "assistant" || role === "model";
}

function isToolRole(role) {
	return role === "tool" || role === "function";
}

function mapFunctionResponseMessage(msg) {
	const name = msg.toolName || msg.name || "";
	return {
		role: "function",
		parts: [
			{
				functionResponse: {
					name,
					response: mapToolResponse(msg.content),
				},
			},
		],
	};
}

function mapMessage(msg) {
	if (isModelRole(msg.role)) {
		return { role: "model", parts: mapAssistantParts(msg) };
	}
	if (isToolRole(msg.role)) {
		return mapFunctionResponseMessage(msg);
	}
	return {
		role: "user",
		parts: [{ text: msg.content || "" }],
	};
}

function buildRequestBody({ system, messages, tools }) {
	const body = {
		contents: Array.isArray(messages) ? messages.map(mapMessage) : [],
	};
	if (system) {
		body.systemInstruction = {
			parts: [{ text: system }],
		};
	}
	const mappedTools = mapTools(tools);
	if (mappedTools) {
		body.tools = mappedTools;
	}
	return body;
}

function extractGeminiToolCall(part) {
	if (!part.functionCall) {
		return null;
	}
	return {
		name: part.functionCall.name,
		input: part.functionCall.args || {},
	};
}

function parseCandidateParts(parts) {
	const text = parts
		.filter((p) => p.text)
		.map((p) => p.text)
		.join("");
	const toolCalls = parts.map(extractGeminiToolCall).filter(Boolean);
	return { text, toolCalls };
}

function formatUsage(promptTokens, completionTokens, totalTokens) {
	return {
		promptTokens,
		completionTokens,
		totalTokens: totalTokens ?? promptTokens + completionTokens,
	};
}

function formatModelResponse(parsed, usage) {
	return {
		text: parsed.text,
		toolCalls: parsed.toolCalls,
		usage,
	};
}

function parseGeminiResponse(data) {
	const candidate = data?.candidates?.[0];
	const parts = candidate?.content?.parts || [];
	const parsed = parseCandidateParts(parts);
	const meta = data?.usageMetadata;
	const usage = formatUsage(
		meta?.promptTokenCount ?? 0,
		meta?.candidatesTokenCount ?? 0,
		meta?.totalTokenCount ?? 0,
	);
	return formatModelResponse(parsed, usage);
}

function checkHttpStatus(status, statusText) {
	if (typeof status === "number" && status >= 400) {
		const text = statusText || "";
		const err = new Error(`HTTP error ${status}: ${text}`);
		err.status = status;
		throw err;
	}
}

function checkApiError(error) {
	if (error) {
		const code = error.code ?? 400;
		const message = error.message ?? String(error);
		const err = new Error(`Gemini API error (${code}): ${message}`);
		err.status = Number(code) || 400;
		throw err;
	}
}

function checkResponseStatus(data) {
	if (!data) {
		return;
	}
	checkHttpStatus(data.status, data.statusText);
	checkApiError(data.error);
}

async function defaultTransport(url, body, headers, signal) {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
		signal,
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		const err = new Error(`HTTP error ${response.status}: ${text}`);
		err.status = response.status;
		throw err;
	}
	return response.json();
}

function requireApiKey(envVarName) {
	const key = process.env[envVarName];
	if (!key || key.trim() === "") {
		throw new Error(`${envVarName} environment variable is required`);
	}
	return key.trim();
}

function getGeminiApiKey() {
	return requireApiKey("GEMINI_API_KEY");
}

async function sendModelRequest({
	transport,
	url,
	body,
	headers,
	signal,
	checkStatus,
	parseResponse,
	apiKey,
}) {
	try {
		const data = await transport(url, body, headers, signal);
		checkStatus(data);
		return parseResponse(data);
	} catch (err) {
		throw sanitizeError(err, apiKey);
	}
}

async function executeGeminiGenerate({ transport, model, params }) {
	const apiKey = getGeminiApiKey();
	const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
	const body = buildRequestBody(params);
	const headers = {
		"Content-Type": "application/json",
		"x-goog-api-key": apiKey,
	};
	return sendModelRequest({
		transport,
		url,
		body,
		headers,
		signal: params.signal,
		checkStatus: checkResponseStatus,
		parseResponse: parseGeminiResponse,
		apiKey,
	});
}

function createGeminiAdapter({
	transport = defaultTransport,
	model = "gemini-2.0-flash",
} = {}) {
	return {
		provider: "gemini",
		generate: (params) =>
			executeGeminiGenerate({ transport, model, params: params || {} }),
	};
}

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function encodeToolName(name) {
	return typeof name === "string" ? name.replaceAll(".", "__") : "";
}

function decodeToolName(name) {
	return typeof name === "string" ? name.replaceAll("__", ".") : "";
}

function mapClaudeTool(tool) {
	return {
		name: encodeToolName(tool.name),
		description: tool.description || "",
		input_schema: resolveToolSchema(tool),
	};
}

function mapClaudeTools(tools) {
	if (!hasTools(tools)) {
		return undefined;
	}
	return tools.map(mapClaudeTool);
}

function formatToolContent(content) {
	if (typeof content === "string") {
		return content;
	}
	return JSON.stringify(content ?? null);
}

function hasContentError(content) {
	if (!content || typeof content !== "object") {
		return false;
	}
	return content.error !== undefined;
}

function isToolError(msg) {
	if (typeof msg.is_error === "boolean") {
		return msg.is_error;
	}
	if (typeof msg.isError === "boolean") {
		return msg.isError;
	}
	if (msg.ok === false) {
		return true;
	}
	return Boolean(hasContentError(msg.content) && msg.ok !== true);
}

function findMatchingCallId(assistantCalls, name, usedIds) {
	if (name) {
		const byName = assistantCalls.find(
			(c) => c.name === name && !usedIds.has(c.id),
		);
		if (byName?.id) {
			return byName.id;
		}
	}
	const firstUnused = assistantCalls.find((c) => !usedIds.has(c.id));
	return firstUnused?.id;
}

function getDirectToolId(msg) {
	return msg.tool_use_id || msg.toolCallId || msg.id;
}

function getFallbackToolId(call, name, index) {
	return call?.id || name || `tool_${index + 1}`;
}

function findToolUseId(toolMsg, assistantCalls, index, usedIds) {
	const directId = getDirectToolId(toolMsg);
	if (directId) {
		return directId;
	}
	const name = toolMsg.toolName || toolMsg.name;
	const matchedId = findMatchingCallId(assistantCalls, name, usedIds);
	if (matchedId) {
		return matchedId;
	}
	return getFallbackToolId(assistantCalls[index], name, index);
}

function resolveToolUseId(toolMsg, assistantCalls, index, usedIds) {
	const id = findToolUseId(toolMsg, assistantCalls, index, usedIds);
	usedIds.add(id);
	return id;
}

function mapClaudeToolResult(toolMsg, toolUseId) {
	const block = {
		type: "tool_result",
		tool_use_id: toolUseId,
		content: formatToolContent(toolMsg.content),
	};
	if (isToolError(toolMsg)) {
		block.is_error = true;
	}
	return block;
}

function collectToolGroup(messages, startIndex, assistantCalls) {
	const blocks = [];
	const usedIds = new Set();
	let idx = startIndex;
	let toolIdx = 0;
	while (idx < messages.length && isToolRole(messages[idx].role)) {
		const toolMsg = messages[idx];
		const id = resolveToolUseId(toolMsg, assistantCalls, toolIdx, usedIds);
		blocks.push(mapClaudeToolResult(toolMsg, id));
		toolIdx++;
		idx++;
	}
	return { blocks, nextIndex: idx };
}

function buildToolUseBlock(call) {
	return {
		type: "tool_use",
		id: call.id || `call_${call.name}`,
		name: encodeToolName(call.name),
		input: call.input || {},
	};
}

function buildAssistantBlocks(content, toolCalls) {
	const textBlocks = content ? [{ type: "text", text: content }] : [];
	const callBlocks = toolCalls.map(buildToolUseBlock);
	return [...textBlocks, ...callBlocks];
}

function isPreformattedAssistant(msg) {
	return Array.isArray(msg.content) && !msg.toolCalls;
}

function resolveAssistantText(msg) {
	return msg.content || msg.text || "";
}

function hasToolCalls(msg) {
	return Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
}

function mapClaudeAssistantMessage(msg) {
	if (isPreformattedAssistant(msg)) {
		return { role: "assistant", content: msg.content };
	}
	if (hasToolCalls(msg)) {
		return {
			role: "assistant",
			content: buildAssistantBlocks(msg.content, msg.toolCalls),
		};
	}
	return { role: "assistant", content: resolveAssistantText(msg) };
}

function mapClaudeUserContent(content) {
	return Array.isArray(content) ? content : content || "";
}

function getToolCalls(msg) {
	return Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
}

function mapClaudeMessages(messages) {
	if (!Array.isArray(messages)) {
		return [];
	}
	const result = [];
	let lastAssistantCalls = [];
	let i = 0;
	while (i < messages.length) {
		const msg = messages[i];
		if (isModelRole(msg.role)) {
			result.push(mapClaudeAssistantMessage(msg));
			lastAssistantCalls = getToolCalls(msg);
			i++;
		} else if (isToolRole(msg.role)) {
			const group = collectToolGroup(messages, i, lastAssistantCalls);
			result.push({ role: "user", content: group.blocks });
			i = group.nextIndex;
		} else {
			result.push({ role: "user", content: mapClaudeUserContent(msg.content) });
			i++;
		}
	}
	return result;
}

function buildClaudeRequestBody({ model, maxTokens, system, messages, tools }) {
	const body = {
		model,
		max_tokens: maxTokens,
		messages: mapClaudeMessages(messages),
	};
	if (system) {
		body.system = system;
	}
	const mappedTools = mapClaudeTools(tools);
	if (mappedTools) {
		body.tools = mappedTools;
	}
	return body;
}

function extractClaudeToolCall(block) {
	if (block.type !== "tool_use") {
		return null;
	}
	return {
		id: block.id,
		name: decodeToolName(block.name),
		input: block.input || {},
	};
}

function parseClaudeBlocks(blocks) {
	const text = blocks
		.filter((b) => b.type === "text" && b.text)
		.map((b) => b.text)
		.join("");
	const toolCalls = blocks.map(extractClaudeToolCall).filter(Boolean);
	return { text, toolCalls };
}

function parseClaudeResponse(data) {
	const blocks = Array.isArray(data?.content) ? data.content : [];
	const parsed = parseClaudeBlocks(blocks);
	const usage = formatUsage(
		data?.usage?.input_tokens ?? 0,
		data?.usage?.output_tokens ?? 0,
	);
	return formatModelResponse(parsed, usage);
}

function formatClaudeErrorMessage(data) {
	const message = data.error.message || String(data.error);
	if (data.type === "error") {
		const errType = data.error.type || "api_error";
		return `Claude API error (${errType}): ${message}`;
	}
	return `Claude API error: ${message}`;
}

function checkClaudeApiError(data) {
	if (!data?.error) {
		return;
	}
	const err = new Error(formatClaudeErrorMessage(data));
	err.status = data.status || 400;
	throw err;
}

function checkClaudeResponseStatus(data) {
	if (!data) {
		return;
	}
	checkClaudeApiError(data);
	checkHttpStatus(data.status, data.statusText);
}

function getClaudeApiKey() {
	return requireApiKey("ANTHROPIC_API_KEY");
}

async function executeClaudeGenerate({ transport, model, maxTokens, params }) {
	const apiKey = getClaudeApiKey();
	const body = buildClaudeRequestBody({
		model: params.model || model,
		maxTokens: params.maxTokens || maxTokens,
		system: params.system,
		messages: params.messages,
		tools: params.tools,
	});
	const headers = {
		"content-type": "application/json",
		"x-api-key": apiKey,
		"anthropic-version": ANTHROPIC_VERSION,
	};
	return sendModelRequest({
		transport,
		url: CLAUDE_API_URL,
		body,
		headers,
		signal: params.signal,
		checkStatus: checkClaudeResponseStatus,
		parseResponse: parseClaudeResponse,
		apiKey,
	});
}

export function createClaudeAdapter({
	transport = defaultTransport,
	model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
	maxTokens = 4096,
} = {}) {
	const resolvedModel =
		model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
	return {
		provider: "claude",
		generate: (params) =>
			executeClaudeGenerate({
				transport,
				model: resolvedModel,
				maxTokens,
				params: params || {},
			}),
	};
}

const PROVIDERS = {
	gemini: createGeminiAdapter,
	claude: createClaudeAdapter,
};

export function createModelAdapter({
	provider = "gemini",
	transport,
	model,
} = {}) {
	const factory = PROVIDERS[provider];
	if (!factory || typeof factory !== "function") {
		throw new Error(`unsupported model provider: ${provider}`);
	}
	return factory({ transport, model });
}
