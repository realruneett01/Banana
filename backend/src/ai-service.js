/**
 * Banana 2.0 — AI Hardware Copilot Service
 * Powered by Google Gemini 2.0 Flash
 */

import { buildSystemPrompt } from "./ai-prompt.js";
import { config } from "./config.js";

export { buildSystemPrompt };

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function parseErrorResponse(response) {
	const errorText = await response.text();
	let parsedMessage = errorText;
	try {
		const errJson = JSON.parse(errorText);
		if (errJson.error?.message) {
			parsedMessage = errJson.error.message;
		}
	} catch (err) {
		console.debug("[Banana Copilot] Non-JSON error body:", err.message);
	}
	const err = new Error(
		`Gemini API error (${response.status}): ${parsedMessage}`,
	);
	err.status = response.status;
	return err;
}

export function resolveModelsToTry(model) {
	let target = (model || config.geminiModel || "gemini-3-flash-preview").trim();
	if (target.includes("preievew")) {
		target = target.replace("preievew", "preview");
	}

	if (target === "gemini-3-flash-preview") {
		return [
			target,
			"gemini-3-flash",
			"gemini-2.0-flash-preview",
			"gemini-2.0-flash",
		];
	}
	return [target, "gemini-3-flash-preview", "gemini-2.0-flash-preview"];
}

function parseSseLine(line) {
	const trimmed = line.trim();
	if (!trimmed?.startsWith("data:")) return null;

	const jsonStr = trimmed.slice(5).trim();
	if (!jsonStr || jsonStr === "[DONE]") return null;

	try {
		const data = JSON.parse(jsonStr);
		return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
	} catch (err) {
		console.debug("[Banana Copilot] Malformed SSE line:", err.message);
		return null;
	}
}

function processSseLines(lines, onChunk) {
	if (!onChunk) return;
	for (const line of lines) {
		const textChunk = parseSseLine(line);
		if (textChunk) {
			onChunk(textChunk);
		}
	}
}

async function readSseStream(stream, onChunk) {
	const reader = stream.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";
		processSseLines(lines, onChunk);
	}
	// A final event without a trailing newline must not be dropped.
	buffer += decoder.decode();
	if (buffer.trim()) processSseLines([buffer], onChunk);
}

async function executeModelStream({
	currentModel,
	resolvedKey,
	contents,
	systemInstruction,
	onChunk,
}) {
	if (!/^[A-Za-z0-9._-]{1,100}$/.test(currentModel)) {
		throw new Error(
			`Invalid model name: ${JSON.stringify(String(currentModel).slice(0, 60))}`,
		);
	}
	const url = `${GEMINI_API_BASE}/models/${currentModel}:streamGenerateContent?alt=sse`;

	const response = await fetch(url, {
		method: "POST",
		// Key travels in a header, never in the URL (URLs end up in logs and error messages).
		headers: {
			"Content-Type": "application/json",
			"x-goog-api-key": resolvedKey,
		},
		body: JSON.stringify({
			contents,
			systemInstruction: {
				parts: [{ text: systemInstruction }],
			},
			generationConfig: {
				temperature: 0.4,
				maxOutputTokens: 2048,
				topP: 0.95,
			},
		}),
	});

	if (!response.ok) {
		throw await parseErrorResponse(response);
	}

	await readSseStream(response.body, onChunk);
	return { modelUsed: currentModel };
}

function prepareGeminiContents(messages) {
	return messages.map((msg) => ({
		role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
		parts: [{ text: msg.content || msg.text || "" }],
	}));
}

async function trySingleModelStream(currentModel, streamParams) {
	try {
		const result = await executeModelStream({ ...streamParams, currentModel });
		return { ok: true, result };
	} catch (err) {
		const is404 = err.status === 404 || err.message?.includes("404");
		return { ok: false, err, is404 };
	}
}

async function tryStreamWithFallback(modelsToTry, streamParams) {
	let lastError = null;
	for (const currentModel of modelsToTry) {
		const attempt = await trySingleModelStream(currentModel, streamParams);
		if (attempt.ok) {
			return attempt.result;
		}
		lastError = attempt.err;
		if (attempt.is404) {
			console.warn(
				`[Banana Copilot] Model ${currentModel} returned 404, falling back...`,
			);
			continue;
		}
		throw attempt.err;
	}
	throw (
		lastError ||
		new Error("Failed to generate response with available Gemini models.")
	);
}

export async function streamGeminiChat({
	messages = [],
	boardContext = {},
	apiKey = null,
	model = null,
	onChunk,
}) {
	const resolvedKey =
		apiKey || config.geminiApiKey || process.env.GEMINI_API_KEY;

	if (!resolvedKey || resolvedKey.trim() === "") {
		throw new Error(
			"GEMINI_API_KEY_REQUIRED: No Gemini API key provided. Please enter your Gemini API key in the Copilot Settings or add GEMINI_API_KEY to backend/.env.",
		);
	}

	const modelsToTry = resolveModelsToTry(model);
	const systemInstruction = buildSystemPrompt(boardContext);
	const contents = prepareGeminiContents(messages);

	return tryStreamWithFallback(modelsToTry, {
		resolvedKey,
		contents,
		systemInstruction,
		onChunk,
	});
}
