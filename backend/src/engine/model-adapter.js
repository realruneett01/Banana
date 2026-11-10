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

const PROVIDERS = {
	gemini: createGeminiAdapter,
	claude: null,
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
