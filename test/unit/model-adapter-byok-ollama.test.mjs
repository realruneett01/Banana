import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createModelAdapter,
	createOllamaAdapter,
} from "../../backend/src/engine/model-adapter.js";

// Sets (or deletes, for undefined) each env var; returns the previous values.
function applyEnv(entries) {
	const previous = {};
	for (const [key, value] of Object.entries(entries)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return previous;
}

async function withEnvs(entries, fn) {
	const previous = applyEnv(entries);
	try {
		return await fn();
	} finally {
		applyEnv(previous);
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

// Runs one generate({}) through a mock transport and returns the request it sent.
async function captureRequest(options, reply) {
	const mock = createMockTransport(reply);
	const adapter = createModelAdapter({ ...options, transport: mock.transport });
	await adapter.generate({});
	return mock.getCaptured();
}

const OLLAMA_REPLY = { message: { content: "ok" } };

const BYOK_PROVIDERS = [
	{
		provider: "gemini",
		envVar: "GEMINI_API_KEY",
		header: "x-goog-api-key",
		reply: { candidates: [] },
		keys: ["byo-gemini-key-1", "env-gemini-key", "byo key with spaces", "k"],
	},
	{
		provider: "claude",
		envVar: "ANTHROPIC_API_KEY",
		header: "x-api-key",
		keys: [
			"byo-claude-key-1",
			"env-claude-key",
			"invalid key with spaces",
			"c",
		],
		reply: { content: [] },
	},
];

// [label, apiKey, expected header value]
function byokCases({ provider, header, keys }) {
	const [byo, env, spaced, longChar] = keys;
	const trimmed = `trimmed-${provider}-key`;
	return [
		[`uses valid BYO key in ${header} header`, byo, byo],
		["falls back to env key when apiKey is undefined", undefined, env],
		["falls back to env key when apiKey has internal whitespace", spaced, env],
		[
			"falls back to env key when apiKey exceeds 300 chars",
			longChar.repeat(301),
			env,
		],
		["trims surrounding whitespace from BYO key", `  ${trimmed}  `, trimmed],
	];
}

for (const p of BYOK_PROVIDERS) {
	describe(`${p.provider} BYOK header resolution`, () => {
		for (const [label, apiKey, expected] of byokCases(p)) {
			test(label, () =>
				withEnvs({ [p.envVar]: p.keys[1] }, async () => {
					const options = { provider: p.provider, apiKey };
					const captured = await captureRequest(options, p.reply);
					assert.equal(captured.headers[p.header], expected);
				}),
			);
		}
	});
}

describe("error redaction for BYO keys", () => {
	for (const { provider, envVar } of BYOK_PROVIDERS) {
		const apiKey = `secret-byo-${provider}-token`;
		test(`redacts BYO key in ${provider} transport error`, () =>
			withEnvs({ [envVar]: "env-fallback-key" }, async () => {
				const leakingTransport = async () => {
					throw new Error(`Connection error for auth token: ${apiKey}`);
				};
				const adapter = createModelAdapter({
					provider,
					transport: leakingTransport,
					apiKey,
				});
				await assert.rejects(
					() => adapter.generate({}),
					(err) => {
						assert.ok(!err.message.includes(apiKey));
						assert.match(err.message, /\[REDACTED\]/);
						return true;
					},
				);
			}));
	}
});

describe("ollama adapter registration", () => {
	const FACTORIES = [
		["createModelAdapter", () => createModelAdapter({ provider: "ollama" })],
		["createOllamaAdapter", () => createOllamaAdapter()],
	];
	for (const [name, factory] of FACTORIES) {
		test(`${name} returns ollama adapter`, () => {
			const adapter = factory();
			assert.equal(adapter.provider, "ollama");
			assert.equal(typeof adapter.generate, "function");
		});
	}
});

// [label, options.model, OLLAMA_MODEL env, expected model]
const OLLAMA_MODEL_CASES = [
	[
		"defaults to qwen2.5:7b when neither option nor env is set",
		undefined,
		undefined,
		"qwen2.5:7b",
	],
	["respects process.env.OLLAMA_MODEL", undefined, "llama3:8b", "llama3:8b"],
	["prefers options.model over env", "mistral:7b", "llama3:8b", "mistral:7b"],
];

describe("ollama model selection", () => {
	for (const [label, model, envModel, expected] of OLLAMA_MODEL_CASES) {
		test(label, () =>
			withEnvs({ OLLAMA_MODEL: envModel }, async () => {
				const options = { provider: "ollama", model };
				const captured = await captureRequest(options, OLLAMA_REPLY);
				assert.equal(captured.body.model, expected);
			}),
		);
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

// [label, OLLAMA_URL, OLLAMA_ALLOW_REMOTE, shouldThrow]; allowed URLs post to <url>/api/chat.
const OLLAMA_URL_CASES = [
	[
		"throws when pointing to remote example.com by default",
		"http://example.com:11434",
		undefined,
		true,
	],
	[
		"allows remote example.com when OLLAMA_ALLOW_REMOTE=1",
		"http://example.com:11434",
		"1",
		false,
	],
	["allows 127.0.0.1 with port", "http://127.0.0.1:11434", undefined, false],
	["allows localhost with port", "http://localhost:11434", undefined, false],
	["allows [::1] with port", "http://[::1]:11434", undefined, false],
	["throws when protocol is ftp", "ftp://127.0.0.1:11434", "1", true],
	["throws when URL is malformed", "invalid-url", "1", true],
];

describe("ollama URL validation and remote restriction", () => {
	for (const [label, url, allowRemote, shouldThrow] of OLLAMA_URL_CASES) {
		test(label, () =>
			withEnvs(
				{ OLLAMA_URL: url, OLLAMA_ALLOW_REMOTE: allowRemote },
				async () => {
					const request = captureRequest({ provider: "ollama" }, OLLAMA_REPLY);
					if (shouldThrow) {
						await assert.rejects(request, {
							message: "Ollama URL must point to this machine",
						});
						return;
					}
					assert.equal((await request).url, `${url}/api/chat`);
				},
			),
		);
	}
});
