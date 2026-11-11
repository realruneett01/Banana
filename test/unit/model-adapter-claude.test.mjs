import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createClaudeAdapter,
	createModelAdapter,
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

async function captureClaudeGenerate(params, options = {}) {
	const apiKey = options.envKey ?? "test-claude-key-123";
	return withEnv("ANTHROPIC_API_KEY", apiKey, async () => {
		let captured = null;
		const adapter = createModelAdapter({
			provider: "claude",
			model: options.model,
			transport: async (url, body, headers, signal) => {
				captured = { url, body, headers, signal };
				return options.response ?? { content: [] };
			},
		});
		const result = await adapter.generate(params);
		return { captured, result };
	});
}

function assertValidClaudeAdapter(adapter) {
	assert.equal(adapter.provider, "claude");
	assert.equal(typeof adapter.generate, "function");
}

function assertSanitizedError(err, secret, requiredSubstr) {
	assert.ok(!err.message.includes(secret));
	assert.ok(err.message.includes("[REDACTED]"));
	if (requiredSubstr) {
		assert.ok(err.message.includes(requiredSubstr));
	}
}

function toolUseBlock(id, name, input = {}) {
	return {
		type: "tool_use",
		id,
		name,
		input,
	};
}

function toolResultBlock(id, content, isError = false) {
	const payload =
		typeof content === "string" ? content : JSON.stringify(content);
	const block = {
		type: "tool_result",
		tool_use_id: id,
		content: payload,
	};
	if (isError) {
		block.is_error = true;
	}
	return block;
}

describe("claude adapter instantiation and provider registration", () => {
	test("createModelAdapter({ provider: 'claude' }) returns claude adapter", () => {
		assertValidClaudeAdapter(createModelAdapter({ provider: "claude" }));
	});

	test("createClaudeAdapter direct factory creates claude adapter", () => {
		assertValidClaudeAdapter(createClaudeAdapter());
	});

	const MODEL_CASES = [
		{
			title: "uses default model claude-sonnet-5-5",
			run: () => captureClaudeGenerate({}),
			expected: "claude-sonnet-5-5",
		},
		{
			title: "respects ANTHROPIC_MODEL environment variable",
			run: () =>
				withEnv("ANTHROPIC_MODEL", "claude-haiku-custom", () =>
					captureClaudeGenerate({}),
				),
			expected: "claude-haiku-custom",
		},
		{
			title: "uses custom model when specified in adapter options",
			run: () => captureClaudeGenerate({}, { model: "claude-opus-4-0" }),
			expected: "claude-opus-4-0",
		},
	];

	for (const { title, run, expected } of MODEL_CASES) {
		test(title, async () => {
			const { captured } = await run();
			assert.equal(captured.body.model, expected);
		});
	}
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
		const prompt = "You are a PCB expert";
		const withSys = await captureClaudeGenerate({ system: prompt });
		const withoutSys = await captureClaudeGenerate({});
		assert.equal(withSys.captured.body.system, prompt);
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
		for (const payload of [{ tools: [] }, {}]) {
			const { captured } = await captureClaudeGenerate(payload);
			assert.equal(captured.body.tools, undefined);
		}
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
						toolUseBlock("call_drc_1", "pcb__drc__run", {
							clearanceMm: 0.15,
						}),
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
						toolUseBlock("call_ir_1", "ir__validate"),
						toolUseBlock("call_drc_2", "pcb__drc"),
					],
				},
				{
					role: "user",
					content: [
						toolResultBlock("call_ir_1", { valid: true }),
						toolResultBlock("call_drc_2", { errors: 0 }),
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
					content: [toolUseBlock("call_fail_1", "ir__parse")],
				},
				{
					role: "user",
					content: [
						toolResultBlock(
							"call_fail_1",
							{ error: "Syntax error on line 4" },
							true,
						),
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
					content: [toolResultBlock("custom_call_99", "custom output")],
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
	const ZERO_USAGE = {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
	};

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
			expectedUsage: ZERO_USAGE,
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
			expectedUsage: ZERO_USAGE,
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
			assert.deepEqual(
				{
					text: result.text,
					calls: result.toolCalls,
					usage: result.usage,
				},
				{
					text: expectedText,
					calls: expectedCalls,
					usage: expectedUsage,
				},
			);
		});
	}
});

describe("error handling and security redaction", () => {
	const SENSITIVE_KEY = "sk-ant-api03-SECRET_KEY_999";

	const MISSING_KEY_CASES = [
		{
			title: "throws when ANTHROPIC_API_KEY environment variable is missing",
			val: undefined,
		},
		{
			title: "throws when ANTHROPIC_API_KEY is whitespace only",
			val: "   ",
		},
	];

	for (const { title, val } of MISSING_KEY_CASES) {
		test(title, async () => {
			await withEnv("ANTHROPIC_API_KEY", val, async () => {
				const adapter = createModelAdapter({ provider: "claude" });
				await assert.rejects(
					() => adapter.generate({}),
					/ANTHROPIC_API_KEY environment variable is required/,
				);
			});
		});
	}

	const ERROR_REDACTION_CASES = [
		{
			title: "redacts api key if transport error message contains it",
			transport: async () => {
				throw new Error(`Failed to authenticate with key ${SENSITIVE_KEY}`);
			},
			verify: (err) => assertSanitizedError(err, SENSITIVE_KEY),
		},
		{
			title: "handles Claude API error structure and sanitizes message",
			transport: async () => ({
				type: "error",
				error: {
					type: "authentication_error",
					message: `Invalid API key: ${SENSITIVE_KEY}`,
				},
			}),
			verify: (err) =>
				assertSanitizedError(err, SENSITIVE_KEY, "authentication_error"),
		},
		{
			title: "handles non-2xx status code from transport",
			transport: async () => ({
				status: 429,
				statusText: `Too Many Requests for ${SENSITIVE_KEY}`,
			}),
			verify: (err) => {
				assert.equal(err.status, 429);
				assertSanitizedError(err, SENSITIVE_KEY);
			},
		},
	];

	for (const { title, transport, verify } of ERROR_REDACTION_CASES) {
		test(title, async () => {
			await withEnv("ANTHROPIC_API_KEY", SENSITIVE_KEY, async () => {
				const adapter = createModelAdapter({
					provider: "claude",
					transport,
				});
				await assert.rejects(
					() => adapter.generate({}),
					(err) => {
						verify(err);
						return true;
					},
				);
			});
		});
	}

	test("never leaks api key on adapter or result object", async () => {
		const { result } = await captureClaudeGenerate(
			{},
			{ envKey: SENSITIVE_KEY },
		);
		const serialized = JSON.stringify(result);
		assert.ok(!serialized.includes(SENSITIVE_KEY));
	});
});
