import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createModelAdapter,
	createOllamaAdapter,
} from "../../backend/src/engine/model-adapter.js";

function setOrClearEnv(key, value) {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}

async function withEnv(key, value, fn) {
	const prev = process.env[key];
	setOrClearEnv(key, value);
	try {
		return await fn();
	} finally {
		setOrClearEnv(key, prev);
	}
}

async function withEnvs(entries, fn) {
	const prevs = {};
	for (const [k, v] of Object.entries(entries)) {
		prevs[k] = process.env[k];
		setOrClearEnv(k, v);
	}
	try {
		return await fn();
	} finally {
		for (const [k, v] of Object.entries(prevs)) {
			setOrClearEnv(k, v);
		}
	}
}

function createMockTransport(responsePayload) {
	let captured = null;
	const transport = async (url, body, headers, signal) => {
		captured = { url, body, headers, signal };
		return responsePayload;
	};
	return { transport, getCaptured: () => captured };
}

const GEMINI_BYOK_CASES = [
	{
		label: "uses valid BYO key in x-goog-api-key header",
		apiKey: "byo-gemini-key-1",
		envKey: "env-gemini-key",
		expectedHeader: "byo-gemini-key-1",
	},
	{
		label: "falls back to env key when apiKey is undefined",
		apiKey: undefined,
		envKey: "env-gemini-key",
		expectedHeader: "env-gemini-key",
	},
	{
		label: "falls back to env key when apiKey has internal whitespace",
		apiKey: "byo key with spaces",
		envKey: "env-gemini-key",
		expectedHeader: "env-gemini-key",
	},
	{
		label: "falls back to env key when apiKey exceeds 300 chars",
		apiKey: "k".repeat(301),
		envKey: "env-gemini-key",
		expectedHeader: "env-gemini-key",
	},
	{
		label: "trims surrounding whitespace from BYO key",
		apiKey: "  trimmed-gemini-key  ",
		envKey: "env-gemini-key",
		expectedHeader: "trimmed-gemini-key",
	},
];

describe("gemini BYOK header resolution", () => {
	for (const tc of GEMINI_BYOK_CASES) {
		test(tc.label, async () => {
			await withEnv("GEMINI_API_KEY", tc.envKey, async () => {
				const mock = createMockTransport({ candidates: [] });
				const adapter = createModelAdapter({
					provider: "gemini",
					transport: mock.transport,
					apiKey: tc.apiKey,
				});
				await adapter.generate({});
				const captured = mock.getCaptured();
				assert.equal(captured.headers["x-goog-api-key"], tc.expectedHeader);
			});
		});
	}
});

const CLAUDE_BYOK_CASES = [
	{
		label: "uses valid BYO key in x-api-key header",
		apiKey: "byo-claude-key-1",
		envKey: "env-claude-key",
		expectedHeader: "byo-claude-key-1",
	},
	{
		label: "falls back to env key when apiKey is undefined",
		apiKey: undefined,
		envKey: "env-claude-key",
		expectedHeader: "env-claude-key",
	},
	{
		label: "falls back to env key when apiKey has internal whitespace",
		apiKey: "invalid key with spaces",
		envKey: "env-claude-key",
		expectedHeader: "env-claude-key",
	},
	{
		label: "falls back to env key when apiKey exceeds 300 chars",
		apiKey: "c".repeat(301),
		envKey: "env-claude-key",
		expectedHeader: "env-claude-key",
	},
	{
		label: "trims surrounding whitespace from BYO key",
		apiKey: "  trimmed-claude-key  ",
		envKey: "env-claude-key",
		expectedHeader: "trimmed-claude-key",
	},
];

describe("claude BYOK header resolution", () => {
	for (const tc of CLAUDE_BYOK_CASES) {
		test(tc.label, async () => {
			await withEnv("ANTHROPIC_API_KEY", tc.envKey, async () => {
				const mock = createMockTransport({ content: [] });
				const adapter = createModelAdapter({
					provider: "claude",
					transport: mock.transport,
					apiKey: tc.apiKey,
				});
				await adapter.generate({});
				const captured = mock.getCaptured();
				assert.equal(captured.headers["x-api-key"], tc.expectedHeader);
			});
		});
	}
});

const REDACTION_CASES = [
	{
		provider: "gemini",
		apiKey: "secret-byo-gemini-token",
		envKey: "env-fallback-key",
		envVar: "GEMINI_API_KEY",
	},
	{
		provider: "claude",
		apiKey: "secret-byo-claude-token",
		envKey: "env-fallback-key",
		envVar: "ANTHROPIC_API_KEY",
	},
];

describe("error redaction for BYO keys", () => {
	for (const tc of REDACTION_CASES) {
		test(`redacts BYO key in ${tc.provider} transport error`, async () => {
			await withEnv(tc.envVar, tc.envKey, async () => {
				const leakingTransport = async () => {
					throw new Error(`Connection error for auth token: ${tc.apiKey}`);
				};
				const adapter = createModelAdapter({
					provider: tc.provider,
					transport: leakingTransport,
					apiKey: tc.apiKey,
				});
				await assert.rejects(
					() => adapter.generate({}),
					(err) => {
						assert.ok(!err.message.includes(tc.apiKey));
						assert.match(err.message, /\[REDACTED\]/);
						return true;
					},
				);
			});
		});
	}
});

describe("ollama adapter registration", () => {
	test("createModelAdapter returns ollama adapter", () => {
		const adapter = createModelAdapter({ provider: "ollama" });
		assert.equal(adapter.provider, "ollama");
		assert.equal(typeof adapter.generate, "function");
	});

	test("createOllamaAdapter returns ollama adapter", () => {
		const adapter = createOllamaAdapter();
		assert.equal(adapter.provider, "ollama");
		assert.equal(typeof adapter.generate, "function");
	});
});

const OLLAMA_MODEL_CASES = [
	{
		label: "defaults to qwen2.5:7b when neither option nor env is set",
		optionModel: undefined,
		envModel: undefined,
		expected: "qwen2.5:7b",
	},
	{
		label: "respects process.env.OLLAMA_MODEL",
		optionModel: undefined,
		envModel: "llama3:8b",
		expected: "llama3:8b",
	},
	{
		label: "prefers options.model over env",
		optionModel: "mistral:7b",
		envModel: "llama3:8b",
		expected: "mistral:7b",
	},
];

describe("ollama model selection", () => {
	for (const tc of OLLAMA_MODEL_CASES) {
		test(tc.label, async () => {
			await withEnv("OLLAMA_MODEL", tc.envModel, async () => {
				const mock = createMockTransport({ message: { content: "ok" } });
				const adapter = createModelAdapter({
					provider: "ollama",
					transport: mock.transport,
					model: tc.optionModel,
				});
				await adapter.generate({});
				const captured = mock.getCaptured();
				assert.equal(captured.body.model, tc.expected);
			});
		});
	}
});

describe("ollama chat request and tool call response", () => {
	test("posts to 127.0.0.1:11434/api/chat with model and converts tool call reply", async () => {
		const mockResponse = {
			model: "qwen2.5:7b",
			message: {
				role: "assistant",
				content: "Checking routing",
				tool_calls: [
					{
						function: {
							name: "check_drc",
							arguments: { net: "GND", clearance: 0.2 },
						},
					},
				],
			},
			prompt_eval_count: 55,
			eval_count: 22,
		};
		const mock = createMockTransport(mockResponse);
		const adapter = createModelAdapter({
			provider: "ollama",
			transport: mock.transport,
		});
		const tools = [
			{
				name: "check_drc",
				description: "Run DRC check",
				parameters: {
					type: "object",
					properties: { net: { type: "string" } },
				},
			},
		];
		const messages = [
			{ role: "user", content: "Inspect GND net" },
			{ role: "assistant", content: "Working on it" },
		];
		const result = await adapter.generate({
			system: "You are a PCB designer",
			messages,
			tools,
		});

		const captured = mock.getCaptured();
		assert.equal(captured.url, "http://127.0.0.1:11434/api/chat");
		assert.equal(captured.headers["Content-Type"], "application/json");
		assert.equal(captured.body.model, "qwen2.5:7b");
		assert.equal(captured.body.stream, false);
		assert.deepEqual(captured.body.messages, [
			{ role: "system", content: "You are a PCB designer" },
			{ role: "user", content: "Inspect GND net" },
			{ role: "assistant", content: "Working on it" },
		]);
		assert.deepEqual(captured.body.tools, [
			{
				type: "function",
				function: {
					name: "check_drc",
					description: "Run DRC check",
					parameters: {
						type: "object",
						properties: { net: { type: "string" } },
					},
				},
			},
		]);

		assert.equal(result.text, "Checking routing");
		assert.deepEqual(result.toolCalls, [
			{
				name: "check_drc",
				input: { net: "GND", clearance: 0.2 },
			},
		]);
		assert.deepEqual(result.usage, {
			promptTokens: 55,
			completionTokens: 22,
			totalTokens: 77,
		});
	});
});

const OLLAMA_URL_CASES = [
	{
		label: "throws when pointing to remote example.com by default",
		url: "http://example.com:11434",
		allowRemote: undefined,
		shouldThrow: true,
	},
	{
		label: "allows remote example.com when OLLAMA_ALLOW_REMOTE=1",
		url: "http://example.com:11434",
		allowRemote: "1",
		shouldThrow: false,
		expectedUrl: "http://example.com:11434/api/chat",
	},
	{
		label: "allows 127.0.0.1 with port",
		url: "http://127.0.0.1:11434",
		allowRemote: undefined,
		shouldThrow: false,
		expectedUrl: "http://127.0.0.1:11434/api/chat",
	},
	{
		label: "allows localhost with port",
		url: "http://localhost:11434",
		allowRemote: undefined,
		shouldThrow: false,
		expectedUrl: "http://localhost:11434/api/chat",
	},
	{
		label: "allows [::1] with port",
		url: "http://[::1]:11434",
		allowRemote: undefined,
		shouldThrow: false,
		expectedUrl: "http://[::1]:11434/api/chat",
	},
	{
		label: "throws when protocol is ftp",
		url: "ftp://127.0.0.1:11434",
		allowRemote: "1",
		shouldThrow: true,
	},
	{
		label: "throws when URL is malformed",
		url: "invalid-url",
		allowRemote: "1",
		shouldThrow: true,
	},
];

describe("ollama URL validation and remote restriction", () => {
	for (const tc of OLLAMA_URL_CASES) {
		test(tc.label, async () => {
			const envSettings = {
				OLLAMA_URL: tc.url,
				OLLAMA_ALLOW_REMOTE: tc.allowRemote,
			};
			await withEnvs(envSettings, async () => {
				const mock = createMockTransport({ message: { content: "ok" } });
				const adapter = createModelAdapter({
					provider: "ollama",
					transport: mock.transport,
				});
				if (tc.shouldThrow) {
					await assert.rejects(
						() => adapter.generate({}),
						(err) => {
							assert.equal(
								err.message,
								"Ollama URL must point to this machine",
							);
							return true;
						},
					);
				} else {
					await adapter.generate({});
					const captured = mock.getCaptured();
					assert.equal(captured.url, tc.expectedUrl);
				}
			});
		});
	}
});
