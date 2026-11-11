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

function mapToolDeclaration(tool) {
	const schema = tool.inputSchema || tool.parameters || { type: "object" };
	return {
		name: tool.name,
		description: tool.description || "",
		parameters: schema,
	};
}

function mapTools(tools) {
	if (!Array.isArray(tools) || tools.length === 0) {
		return undefined;
	}
	return [
		{
			functionDeclarations: tools.map(mapToolDeclaration),
		},
	];
}

function mapAssistantParts(msg) {
	const parts = [];
	if (msg.content) {
		parts.push({ text: msg.content });
	}
	if (Array.isArray(msg.toolCalls)) {
		for (const call of msg.toolCalls) {
			parts.push({
				functionCall: {
					name: call.name,
					args: call.input || {},
				},
			});
		}
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

function mapMessage(msg) {
	if (isModelRole(msg.role)) {
		return { role: "model", parts: mapAssistantParts(msg) };
	}
	if (isToolRole(msg.role)) {
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

function parseCandidateParts(parts) {
	const textParts = [];
	const toolCalls = [];
	for (const part of parts) {
		if (part.text) {
			textParts.push(part.text);
		}
		if (part.functionCall) {
			toolCalls.push({
				name: part.functionCall.name,
				input: part.functionCall.args || {},
			});
		}
	}
	return { text: textParts.join(""), toolCalls };
}

function parseGeminiResponse(data) {
	const candidate = data?.candidates?.[0];
	const parts = candidate?.content?.parts || [];
	const parsed = parseCandidateParts(parts);
	const usage = {
		promptTokens: data?.usageMetadata?.promptTokenCount ?? 0,
		completionTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
		totalTokens: data?.usageMetadata?.totalTokenCount ?? 0,
	};
	return {
		text: parsed.text,
		toolCalls: parsed.toolCalls,
		usage,
	};
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

function getGeminiApiKey() {
	const key = process.env.GEMINI_API_KEY;
	if (!key || key.trim() === "") {
		throw new Error("GEMINI_API_KEY environment variable is required");
	}
	return key.trim();
}

async function executeGeminiGenerate({ transport, model, params }) {
	const apiKey = getGeminiApiKey();
	const url = `${GEMINI_API_BASE}/models/${model}:generateContent`;
	const body = buildRequestBody(params);
	const headers = {
		"Content-Type": "application/json",
		"x-goog-api-key": apiKey,
	};
	try {
		const data = await transport(url, body, headers, params.signal);
		checkResponseStatus(data);
		return parseGeminiResponse(data);
	} catch (err) {
		throw sanitizeError(err, apiKey);
	}
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
	const schema = tool.inputSchema || tool.parameters || { type: "object" };
	return {
		name: encodeToolName(tool.name),
		description: tool.description || "",
		input_schema: schema,
	};
}

function mapClaudeTools(tools) {
	if (!Array.isArray(tools) || tools.length === 0) {
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
	const content = msg.content;
	const hasErr =
		content && typeof content === "object" && content.error !== undefined;
	return Boolean(hasErr && msg.ok !== true);
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

function resolveToolUseId(toolMsg, assistantCalls, index, usedIds) {
	const directId = toolMsg.tool_use_id || toolMsg.toolCallId || toolMsg.id;
	if (directId) {
		usedIds.add(directId);
		return directId;
	}
	const name = toolMsg.toolName || toolMsg.name;
	const matchedId = findMatchingCallId(assistantCalls, name, usedIds);
	if (matchedId) {
		usedIds.add(matchedId);
		return matchedId;
	}
	const fallbackId = assistantCalls[index]?.id || name || `tool_${index + 1}`;
	usedIds.add(fallbackId);
	return fallbackId;
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

function mapClaudeAssistantMessage(msg) {
	if (Array.isArray(msg.content) && !msg.toolCalls) {
		return { role: "assistant", content: msg.content };
	}
	const hasCalls = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
	if (!hasCalls) {
		return { role: "assistant", content: msg.content || msg.text || "" };
	}
	const blocks = [];
	if (msg.content) {
		blocks.push({ type: "text", text: msg.content });
	}
	for (const call of msg.toolCalls) {
		blocks.push({
			type: "tool_use",
			id: call.id || `call_${call.name}`,
			name: encodeToolName(call.name),
			input: call.input || {},
		});
	}
	return { role: "assistant", content: blocks };
}

function mapClaudeUserContent(content) {
	return Array.isArray(content) ? content : content || "";
}

function mapClaudeMessages(messages) {
	if (!Array.isArray(messages) || messages.length === 0) {
		return [];
	}
	const result = [];
	let lastAssistantCalls = [];
	let i = 0;
	while (i < messages.length) {
		const msg = messages[i];
		if (isModelRole(msg.role)) {
			result.push(mapClaudeAssistantMessage(msg));
			lastAssistantCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
			i++;
		} else if (isToolRole(msg.role)) {
			const { blocks, nextIndex } = collectToolGroup(
				messages,
				i,
				lastAssistantCalls,
			);
			result.push({ role: "user", content: blocks });
			i = nextIndex;
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

function parseClaudeBlocks(blocks) {
	const textParts = [];
	const toolCalls = [];
	for (const block of blocks) {
		if (block.type === "text" && block.text) {
			textParts.push(block.text);
		}
		if (block.type === "tool_use") {
			toolCalls.push({
				id: block.id,
				name: decodeToolName(block.name),
				input: block.input || {},
			});
		}
	}
	return { text: textParts.join(""), toolCalls };
}

function parseClaudeResponse(data) {
	const blocks = Array.isArray(data?.content) ? data.content : [];
	const parsed = parseClaudeBlocks(blocks);
	const promptTokens = data?.usage?.input_tokens ?? 0;
	const completionTokens = data?.usage?.output_tokens ?? 0;
	const usage = {
		promptTokens,
		completionTokens,
		totalTokens: promptTokens + completionTokens,
	};
	return {
		text: parsed.text,
		toolCalls: parsed.toolCalls,
		usage,
	};
}

function checkClaudeApiError(data) {
	if (data?.type === "error" && data.error) {
		const errType = data.error.type || "api_error";
		const message = data.error.message || String(data.error);
		const err = new Error(`Claude API error (${errType}): ${message}`);
		err.status = data.status || 400;
		throw err;
	}
	if (data?.error) {
		const message = data.error.message || String(data.error);
		const err = new Error(`Claude API error: ${message}`);
		err.status = data.status || 400;
		throw err;
	}
}

function checkClaudeResponseStatus(data) {
	if (!data) {
		return;
	}
	checkClaudeApiError(data);
	checkHttpStatus(data.status, data.statusText);
}

function getClaudeApiKey() {
	const key = process.env.ANTHROPIC_API_KEY;
	if (!key || key.trim() === "") {
		throw new Error("ANTHROPIC_API_KEY environment variable is required");
	}
	return key.trim();
}

async function executeClaudeGenerate({ transport, model, maxTokens, params }) {
	const apiKey = getClaudeApiKey();
	const url = CLAUDE_API_URL;
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
	try {
		const data = await transport(url, body, headers, params.signal);
		checkClaudeResponseStatus(data);
		return parseClaudeResponse(data);
	} catch (err) {
		throw sanitizeError(err, apiKey);
	}
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
