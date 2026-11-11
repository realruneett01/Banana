import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createModelAdapter } from "../../backend/src/engine/model-adapter.js";

function createMockTransport(responsePayload) {
	let captured = null;
	const transport = async (url, body, headers, signal) => {
		captured = { url, body, headers, signal };
		return responsePayload;
	};
	return { transport, getCaptured: () => captured };
}

async function withEnv(key, value, fn) {
	const prev = process.env[key];
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
	try {
		return await fn();
	} finally {
		if (prev === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = prev;
		}
	}
}

async function withMockFetch(mockFetch, fn) {
	const prevFetch = globalThis.fetch;
	globalThis.fetch = mockFetch;
	try {
		return await fn();
	} finally {
		globalThis.fetch = prevFetch;
	}
}

async function captureGenerate(params, options = {}) {
	const key = options.envKey || "test-key-123";
	return withEnv("GEMINI_API_KEY", key, async () => {
		const mock = createMockTransport(options.response || { candidates: [] });
		const adapter = createModelAdapter({
			transport: mock.transport,
			model: options.model,
		});
		const result = await adapter.generate(params);
		return { captured: mock.getCaptured(), result };
	});
}

describe("module contract", () => {
	test("exports expected createModelAdapter factory", async () => {
		const mod = await import("../../backend/src/engine/model-adapter.js");
		assert.ok(typeof mod.createModelAdapter === "function");
		const keys = Object.keys(mod);
		assert.ok(keys.includes("createModelAdapter"));
	});

	test("instantiates adapter with gemini provider and generate method", () => {
		const adapter = createModelAdapter();
		assert.ok(adapter && adapter.provider === "gemini");
		assert.ok(typeof adapter.generate === "function");
	});
});

describe("provider lookup table and validation", () => {
	const UNSUPPORTED = ["foo", "openai", "bedrock", "unknown", ""];
	for (const prov of UNSUPPORTED) {
		test(`rejects unsupported provider: '${prov}'`, () => {
			assert.throws(
				() => createModelAdapter({ provider: prov }),
				(err) => {
					assert.equal(err.message, `unsupported model provider: ${prov}`);
					return true;
				},
			);
		});
	}

	test("accepts explicitly supported provider 'gemini'", () => {
		const adapter = createModelAdapter({ provider: "gemini" });
		assert.equal(adapter.provider, "gemini");
	});

	test("accepts explicitly supported provider 'claude'", () => {
		const adapter = createModelAdapter({ provider: "claude" });
		assert.equal(adapter.provider, "claude");
	});
});

describe("request mapping: system instruction", () => {
	test("maps system prompt to systemInstruction parts", async () => {
		const { captured } = await captureGenerate({
			system: "You are a hardware designer",
		});
		assert.deepEqual(captured.body.systemInstruction, {
			parts: [{ text: "You are a hardware designer" }],
		});
	});

	test("omits systemInstruction when system is not provided", async () => {
		const { captured } = await captureGenerate({});
		assert.equal(captured.body.systemInstruction, undefined);
	});
});

describe("request mapping: messages", () => {
	const MESSAGE_MAPPING_CASES = [
		{
			label: "user message to user role with text parts",
			input: [{ role: "user", content: "Check DRC rules" }],
			expected: [{ role: "user", parts: [{ text: "Check DRC rules" }] }],
		},
		{
			label: "assistant message with text to model role",
			input: [{ role: "assistant", content: "DRC check in progress" }],
			expected: [{ role: "model", parts: [{ text: "DRC check in progress" }] }],
		},
		{
			label: "assistant message with toolCalls to functionCall parts",
			input: [
				{
					role: "assistant",
					content: "Calling tool",
					toolCalls: [{ name: "run_drc", input: { netlist: "board.net" } }],
				},
			],
			expected: [
				{
					role: "model",
					parts: [
						{ text: "Calling tool" },
						{
							functionCall: {
								name: "run_drc",
								args: { netlist: "board.net" },
							},
						},
					],
				},
			],
		},
		{
			label: "tool message with object content to functionResponse",
			input: [
				{
					role: "tool",
					toolName: "run_drc",
					content: { errors: 0, warnings: 1 },
				},
			],
			expected: [
				{
					role: "function",
					parts: [
						{
							functionResponse: {
								name: "run_drc",
								response: { errors: 0, warnings: 1 },
							},
						},
					],
				},
			],
		},
		{
			label: "tool message with string content to wrapped output",
			input: [
				{
					role: "tool",
					toolName: "echo_log",
					content: "plain output text",
				},
			],
			expected: [
				{
					role: "function",
					parts: [
						{
							functionResponse: {
								name: "echo_log",
								response: { output: "plain output text" },
							},
						},
					],
				},
			],
		},
	];

	for (const item of MESSAGE_MAPPING_CASES) {
		test(`maps ${item.label}`, async () => {
			const { captured } = await captureGenerate({ messages: item.input });
			assert.deepEqual(captured.body.contents, item.expected);
		});
	}
});

describe("request mapping: tools to functionDeclarations", () => {
	test("maps tool definitions to Gemini functionDeclarations", async () => {
		const tools = [
			{
				name: "query_bom",
				description: "Queries bill of materials",
				inputSchema: {
					type: "object",
					properties: { partNumber: { type: "string" } },
					required: ["partNumber"],
				},
				permission: "read",
			},
		];
		const { captured } = await captureGenerate({ tools });
		assert.deepEqual(captured.body.tools, [
			{
				functionDeclarations: [
					{
						name: "query_bom",
						description: "Queries bill of materials",
						parameters: tools[0].inputSchema,
					},
				],
			},
		]);
	});

	test("omits tools field when tools array is empty or undefined", async () => {
		const { captured } = await captureGenerate({ tools: [] });
		assert.equal(captured.body.tools, undefined);
	});
});

describe("request transport details: url, headers and model", () => {
	test("sends api key in x-goog-api-key header and uses default model", async () => {
		const key = "secret-test-key-456";
		const { captured } = await captureGenerate({}, { envKey: key });
		assert.equal(
			captured.url,
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
		);
		assert.equal(captured.headers["x-goog-api-key"], key);
		assert.equal(captured.headers["Content-Type"], "application/json");
		assert.ok(!captured.url.includes(key));
	});

	test("uses custom model when specified", async () => {
		const { captured } = await captureGenerate({}, { model: "gemini-1.5-pro" });
		assert.equal(
			captured.url,
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
		);
	});
});

describe("response mapping: text and functionCall parts", () => {
	const RESPONSE_CASES = [
		{
			label: "text response and usage tokens",
			payload: {
				candidates: [
					{
						content: {
							role: "model",
							parts: [{ text: "Board has 4 layers." }],
						},
					},
				],
				usageMetadata: {
					promptTokenCount: 14,
					candidatesTokenCount: 6,
					totalTokenCount: 20,
				},
			},
			expectedText: "Board has 4 layers.",
			expectedToolCalls: [],
			expectedUsage: {
				promptTokens: 14,
				completionTokens: 6,
				totalTokens: 20,
			},
		},
		{
			label: "functionCall part to toolCalls with name and input",
			payload: {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									functionCall: {
										name: "route_track",
										args: { net: "GND", width: 0.25 },
									},
								},
							],
						},
					},
				],
			},
			expectedText: "",
			expectedToolCalls: [
				{
					name: "route_track",
					input: { net: "GND", width: 0.25 },
				},
			],
			expectedUsage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			},
		},
		{
			label: "mixed text and multiple functionCall parts",
			payload: {
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{ text: "Executing operations: " },
								{ text: "Step 1 & 2." },
								{
									functionCall: {
										name: "place_component",
										args: { ref: "C1" },
									},
								},
								{
									functionCall: {
										name: "place_component",
										args: { ref: "C2" },
									},
								},
							],
						},
					},
				],
			},
			expectedText: "Executing operations: Step 1 & 2.",
			expectedToolCalls: [
				{ name: "place_component", input: { ref: "C1" } },
				{ name: "place_component", input: { ref: "C2" } },
			],
			expectedUsage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			},
		},
		{
			label: "empty candidate parts gracefully",
			payload: { candidates: [] },
			expectedText: "",
			expectedToolCalls: [],
			expectedUsage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			},
		},
	];

	for (const tc of RESPONSE_CASES) {
		test(`maps ${tc.label}`, async () => {
			const { result } = await captureGenerate({}, { response: tc.payload });
			assert.equal(result.text, tc.expectedText);
			assert.deepEqual(result.toolCalls, tc.expectedToolCalls);
			assert.deepEqual(result.usage, tc.expectedUsage);
		});
	}
});

describe("error handling and non-2xx status", () => {
	const ERROR_CASES = [
		{
			label: "transport throws non-2xx error",
			transport: async () => {
				const err = new Error("HTTP error 500: Server unavailable");
				err.status = 500;
				throw err;
			},
			status: 500,
			pattern: /500/,
		},
		{
			label: "transport returns status >= 400",
			transport: async () => ({ status: 404, statusText: "Not Found" }),
			status: 404,
			pattern: /HTTP error 404: Not Found/,
		},
		{
			label: "transport returns Gemini API error object",
			transport: async () => ({
				error: { code: 400, message: "Invalid field in request" },
			}),
			status: 400,
			pattern: /Gemini API error \(400\)/,
		},
	];

	for (const ec of ERROR_CASES) {
		test(`handles ${ec.label}`, async () => {
			await withEnv("GEMINI_API_KEY", "test-key-123", async () => {
				const adapter = createModelAdapter({ transport: ec.transport });
				await assert.rejects(
					() => adapter.generate({}),
					(err) => {
						assert.equal(err.status, ec.status);
						assert.match(err.message, ec.pattern);
						return true;
					},
				);
			});
		});
	}
});

describe("security: api key protection and secret isolation", () => {
	const SENSITIVE_KEY = "AIzaSySecretApiKey_999";

	test("redacts api key if it appears in thrown error message", async () => {
		await withEnv("GEMINI_API_KEY", SENSITIVE_KEY, async () => {
			const leakingTransport = async () => {
				throw new Error(`Failed request with key=${SENSITIVE_KEY}`);
			};
			const adapter = createModelAdapter({ transport: leakingTransport });
			await assert.rejects(
				() => adapter.generate({}),
				(err) => {
					assert.equal(err.message.includes(SENSITIVE_KEY), false);
					assert.match(err.message, /\[REDACTED\]/);
					return true;
				},
			);
		});
	});

	test("never returns api key on adapter or generate result", async () => {
		const { result } = await captureGenerate({}, { envKey: SENSITIVE_KEY });
		const adapter = createModelAdapter({
			transport: createMockTransport({ candidates: [] }).transport,
		});
		assert.equal(adapter.apiKey, undefined);
		assert.ok(!JSON.stringify(adapter).includes(SENSITIVE_KEY));
		assert.ok(!JSON.stringify(result).includes(SENSITIVE_KEY));
	});

	test("throws when GEMINI_API_KEY environment variable is missing", async () => {
		await withEnv("GEMINI_API_KEY", undefined, async () => {
			const { transport } = createMockTransport({ candidates: [] });
			const adapter = createModelAdapter({ transport });
			await assert.rejects(
				() => adapter.generate({}),
				(err) => {
					assert.match(err.message, /GEMINI_API_KEY.*required/);
					return true;
				},
			);
		});
	});
});

describe("default transport", () => {
	test("uses globalThis.fetch and parses json on 2xx", async () => {
		const mockFetch = async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				candidates: [
					{
						content: {
							role: "model",
							parts: [{ text: "via default transport" }],
						},
					},
				],
			}),
		});
		await withMockFetch(mockFetch, async () => {
			await withEnv("GEMINI_API_KEY", "test-key-123", async () => {
				const adapter = createModelAdapter();
				const res = await adapter.generate({});
				assert.equal(res.text, "via default transport");
			});
		});
	});

	test("throws on non-2xx fetch response in default transport", async () => {
		const mockFetch = async () => ({
			ok: false,
			status: 502,
			text: async () => "Bad Gateway",
		});
		await withMockFetch(mockFetch, async () => {
			await withEnv("GEMINI_API_KEY", "test-key-123", async () => {
				const adapter = createModelAdapter();
				await assert.rejects(
					() => adapter.generate({}),
					(err) => {
						assert.equal(err.status, 502);
						assert.match(err.message, /HTTP error 502/);
						return true;
					},
				);
			});
		});
	});
});

describe("abort signal forwarding", () => {
	test("forwards signal to transport call", async () => {
		await withEnv("GEMINI_API_KEY", "test-key-123", async () => {
			const mock = createMockTransport({ candidates: [] });
			const adapter = createModelAdapter({ transport: mock.transport });
			const controller = new AbortController();
			await adapter.generate({ signal: controller.signal });
			assert.equal(mock.getCaptured().signal, controller.signal);
		});
	});
});
