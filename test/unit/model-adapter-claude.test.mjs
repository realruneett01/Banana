import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createClaudeAdapter,
	createModelAdapter,
} from "../../backend/src/engine/model-adapter.js";

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

async function captureClaudeGenerate(params, options = {}) {
	const key = options.envKey || "test-claude-key-123";
	return withEnv("ANTHROPIC_API_KEY", key, async () => {
		const mock = createMockTransport(options.response || { content: [] });
		const adapter = createModelAdapter({
			provider: "claude",
			transport: mock.transport,
			model: options.model,
		});
		const result = await adapter.generate(params);
		return { captured: mock.getCaptured(), result };
	});
}

describe("claude adapter instantiation and provider registration", () => {
	test("createModelAdapter({ provider: 'claude' }) returns claude adapter", () => {
		const adapter = createModelAdapter({ provider: "claude" });
		assert.equal(adapter.provider, "claude");
		assert.equal(typeof adapter.generate, "function");
	});

	test("createClaudeAdapter direct factory creates claude adapter", () => {
		const adapter = createClaudeAdapter();
		assert.equal(adapter.provider, "claude");
		assert.equal(typeof adapter.generate, "function");
	});

	test("uses default model claude-sonnet-5-5", async () => {
		const { captured } = await captureClaudeGenerate({});
		assert.equal(captured.body.model, "claude-sonnet-5-5");
	});

	test("respects ANTHROPIC_MODEL environment variable", async () => {
		await withEnv("ANTHROPIC_MODEL", "claude-haiku-custom", async () => {
			const { captured } = await captureClaudeGenerate({});
			assert.equal(captured.body.model, "claude-haiku-custom");
		});
	});

	test("uses custom model when specified in adapter options", async () => {
		const { captured } = await captureClaudeGenerate(
			{},
			{ model: "claude-opus-4-0" },
		);
		assert.equal(captured.body.model, "claude-opus-4-0");
	});
});

describe("request shape: endpoint, headers and settings", () => {
	test("sends POST to api.anthropic.com with required headers", async () => {
		const { captured } = await captureClaudeGenerate(
			{},
			{ envKey: "my-sec-key" },
		);
		assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
		assert.equal(captured.headers["content-type"], "application/json");
		assert.equal(captured.headers["x-api-key"], "my-sec-key");
		assert.equal(captured.headers["anthropic-version"], "2023-06-01");
	});

	test("sets default max_tokens to 4096", async () => {
		const { captured } = await captureClaudeGenerate({});
		assert.equal(captured.body.max_tokens, 4096);
	});

	test("maps system instruction when provided and omits when absent", async () => {
		const withSys = await captureClaudeGenerate({
			system: "You are a PCB expert",
		});
		assert.equal(withSys.captured.body.system, "You are a PCB expert");

		const withoutSys = await captureClaudeGenerate({});
		assert.equal(withoutSys.captured.body.system, undefined);
	});

	test("forwards abort signal to transport", async () => {
		const controller = new AbortController();
		const { captured } = await captureClaudeGenerate({
			signal: controller.signal,
		});
		assert.equal(captured.signal, controller.signal);
	});
});

describe("request mapping: tools and name encoding", () => {
	const TOOL_CASES = [
		{
			label: "replaces dots with double underscores in tool names",
			tools: [
				{
					name: "ir.validate",
					description: "Validate netlist IR",
					inputSchema: {
						type: "object",
						properties: { net: { type: "string" } },
					},
				},
				{
					name: "pcb.layers.count",
					description: "Count board layers",
					parameters: { type: "object" },
				},
			],
			expected: [
				{
					name: "ir__validate",
					description: "Validate netlist IR",
					input_schema: {
						type: "object",
						properties: { net: { type: "string" } },
					},
				},
				{
					name: "pcb__layers__count",
					description: "Count board layers",
					input_schema: { type: "object" },
				},
			],
		},
		{
			label: "preserves names without dots",
			tools: [
				{
					name: "run_drc",
					description: "Run DRC checks",
				},
			],
			expected: [
				{
					name: "run_drc",
					description: "Run DRC checks",
					input_schema: { type: "object" },
				},
			],
		},
	];

	for (const { label, tools, expected } of TOOL_CASES) {
		test(label, async () => {
			const { captured } = await captureClaudeGenerate({ tools });
			assert.deepEqual(captured.body.tools, expected);
		});
	}

	test("omits tools field when tools array is empty or undefined", async () => {
		const emptyRes = await captureClaudeGenerate({ tools: [] });
		assert.equal(emptyRes.captured.body.tools, undefined);

		const undefRes = await captureClaudeGenerate({});
		assert.equal(undefRes.captured.body.tools, undefined);
	});
});

describe("request mapping: messages and tool results grouping", () => {
	const MESSAGE_CASES = [
		{
			label: "maps user message directly",
			messages: [{ role: "user", content: "Optimize traces" }],
			expected: [{ role: "user", content: "Optimize traces" }],
		},
		{
			label: "maps assistant text message",
			messages: [{ role: "assistant", content: "Trace optimization ready" }],
			expected: [{ role: "assistant", content: "Trace optimization ready" }],
		},
		{
			label: "maps assistant toolCalls with name encoding and id preservation",
			messages: [
				{
					role: "assistant",
					content: "Calling DRC",
					toolCalls: [
						{
							id: "call_drc_1",
							name: "pcb.drc.run",
							input: { clearanceMm: 0.15 },
						},
					],
				},
			],
			expected: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Calling DRC" },
						{
							type: "tool_use",
							id: "call_drc_1",
							name: "pcb__drc__run",
							input: { clearanceMm: 0.15 },
						},
					],
				},
			],
		},
		{
			label: "groups consecutive tool results into one user message",
			messages: [
				{ role: "user", content: "Check board" },
				{
					role: "assistant",
					content: "Checking",
					toolCalls: [
						{ id: "call_ir_1", name: "ir.validate", input: {} },
						{ id: "call_drc_2", name: "pcb.drc", input: {} },
					],
				},
				{
					role: "tool",
					name: "ir.validate",
					content: { valid: true },
				},
				{
					role: "tool",
					name: "pcb.drc",
					content: { errors: 0 },
				},
			],
			expected: [
				{ role: "user", content: "Check board" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Checking" },
						{
							type: "tool_use",
							id: "call_ir_1",
							name: "ir__validate",
							input: {},
						},
						{
							type: "tool_use",
							id: "call_drc_2",
							name: "pcb__drc",
							input: {},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_ir_1",
							content: JSON.stringify({ valid: true }),
						},
						{
							type: "tool_result",
							tool_use_id: "call_drc_2",
							content: JSON.stringify({ errors: 0 }),
						},
					],
				},
			],
		},
		{
			label: "marks tool result is_error true when execution failed",
			messages: [
				{
					role: "assistant",
					toolCalls: [{ id: "call_fail_1", name: "ir.parse", input: {} }],
				},
				{
					role: "tool",
					name: "ir.parse",
					content: { error: "Syntax error on line 4" },
				},
			],
			expected: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_fail_1",
							name: "ir__parse",
							input: {},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_fail_1",
							content: JSON.stringify({ error: "Syntax error on line 4" }),
							is_error: true,
						},
					],
				},
			],
		},
		{
			label: "uses explicit tool_use_id on tool message if present",
			messages: [
				{
					role: "tool",
					tool_use_id: "custom_call_99",
					name: "ir.validate",
					content: "custom output",
				},
			],
			expected: [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "custom_call_99",
							content: "custom output",
						},
					],
				},
			],
		},
	];

	for (const { label, messages, expected } of MESSAGE_CASES) {
		test(label, async () => {
			const { captured } = await captureClaudeGenerate({ messages });
			assert.deepEqual(captured.body.messages, expected);
		});
	}
});

describe("response mapping: text and tool_use blocks", () => {
	const RESPONSE_CASES = [
		{
			label: "maps text block and token usage",
			payload: {
				content: [{ type: "text", text: "Routing completed without errors." }],
				usage: { input_tokens: 150, output_tokens: 30 },
			},
			expectedText: "Routing completed without errors.",
			expectedCalls: [],
			expectedUsage: {
				promptTokens: 150,
				completionTokens: 30,
				totalTokens: 180,
			},
		},
		{
			label: "maps tool_use block reversing name mapping and keeping id",
			payload: {
				content: [
					{
						type: "tool_use",
						id: "toolu_01AbCd",
						name: "ir__validate",
						input: { netlist: "sample.net" },
					},
				],
			},
			expectedText: "",
			expectedCalls: [
				{
					id: "toolu_01AbCd",
					name: "ir.validate",
					input: { netlist: "sample.net" },
				},
			],
			expectedUsage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			},
		},
		{
			label: "maps mixed text and multiple tool_use blocks",
			payload: {
				content: [
					{ type: "text", text: "Running simulation..." },
					{
						type: "tool_use",
						id: "toolu_01",
						name: "sim__thermal",
						input: { temp: 25 },
					},
					{ type: "text", text: " and checking DRC" },
					{
						type: "tool_use",
						id: "toolu_02",
						name: "pcb__drc__clearance",
						input: { minGap: 0.2 },
					},
				],
			},
			expectedText: "Running simulation... and checking DRC",
			expectedCalls: [
				{
					id: "toolu_01",
					name: "sim.thermal",
					input: { temp: 25 },
				},
				{
					id: "toolu_02",
					name: "pcb.drc.clearance",
					input: { minGap: 0.2 },
				},
			],
			expectedUsage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
			},
		},
	];

	for (const {
		label,
		payload,
		expectedText,
		expectedCalls,
		expectedUsage,
	} of RESPONSE_CASES) {
		test(label, async () => {
			const { result } = await captureClaudeGenerate({}, { response: payload });
			assert.equal(result.text, expectedText);
			assert.deepEqual(result.toolCalls, expectedCalls);
			assert.deepEqual(result.usage, expectedUsage);
		});
	}
});

describe("error handling and security redaction", () => {
	const SENSITIVE_KEY = "sk-ant-api03-SECRET_KEY_999";

	test("throws when ANTHROPIC_API_KEY environment variable is missing", async () => {
		await withEnv("ANTHROPIC_API_KEY", undefined, async () => {
			const adapter = createModelAdapter({ provider: "claude" });
			await assert.rejects(
				() => adapter.generate({}),
				/ANTHROPIC_API_KEY environment variable is required/,
			);
		});
	});

	test("throws when ANTHROPIC_API_KEY is whitespace only", async () => {
		await withEnv("ANTHROPIC_API_KEY", "   ", async () => {
			const adapter = createModelAdapter({ provider: "claude" });
			await assert.rejects(
				() => adapter.generate({}),
				/ANTHROPIC_API_KEY environment variable is required/,
			);
		});
	});

	test("redacts api key if transport error message contains it", async () => {
		await withEnv("ANTHROPIC_API_KEY", SENSITIVE_KEY, async () => {
			const failingTransport = async () => {
				throw new Error(`Failed to authenticate with key ${SENSITIVE_KEY}`);
			};
			const adapter = createModelAdapter({
				provider: "claude",
				transport: failingTransport,
			});
			await assert.rejects(
				() => adapter.generate({}),
				(err) => {
					assert.ok(!err.message.includes(SENSITIVE_KEY));
					assert.ok(err.message.includes("[REDACTED]"));
					return true;
				},
			);
		});
	});

	test("handles Claude API error structure and sanitizes message", async () => {
		await withEnv("ANTHROPIC_API_KEY", SENSITIVE_KEY, async () => {
			const mock = createMockTransport({
				type: "error",
				error: {
					type: "authentication_error",
					message: `Invalid API key: ${SENSITIVE_KEY}`,
				},
			});
			const adapter = createModelAdapter({
				provider: "claude",
				transport: mock.transport,
			});
			await assert.rejects(
				() => adapter.generate({}),
				(err) => {
					assert.ok(!err.message.includes(SENSITIVE_KEY));
					assert.ok(err.message.includes("[REDACTED]"));
					assert.ok(err.message.includes("authentication_error"));
					return true;
				},
			);
		});
	});

	test("handles non-2xx status code from transport", async () => {
		await withEnv("ANTHROPIC_API_KEY", SENSITIVE_KEY, async () => {
			const mock = createMockTransport({
				status: 429,
				statusText: `Too Many Requests for ${SENSITIVE_KEY}`,
			});
			const adapter = createModelAdapter({
				provider: "claude",
				transport: mock.transport,
			});
			await assert.rejects(
				() => adapter.generate({}),
				(err) => {
					assert.equal(err.status, 429);
					assert.ok(!err.message.includes(SENSITIVE_KEY));
					assert.ok(err.message.includes("[REDACTED]"));
					return true;
				},
			);
		});
	});

	test("never leaks api key on adapter or result object", async () => {
		const { result } = await captureClaudeGenerate(
			{},
			{ envKey: SENSITIVE_KEY },
		);
		const serialized = JSON.stringify(result);
		assert.ok(!serialized.includes(SENSITIVE_KEY));
	});
});
