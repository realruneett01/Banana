import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAgent } from "../../backend/src/engine/agent.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";

function makeToolSchema(requiredProp, propType = "string") {
	if (!requiredProp) {
		return { type: "object", properties: {} };
	}
	return {
		type: "object",
		required: [requiredProp],
		properties: { [requiredProp]: { type: propType } },
	};
}

function createToolFixture({
	name,
	description,
	permission = "read",
	handler,
	inProp,
	outProp,
	outType,
	overrides = {},
}) {
	return {
		name,
		description,
		inputSchema: makeToolSchema(inProp),
		outputSchema: makeToolSchema(outProp, outType),
		permission,
		handler,
		...overrides,
	};
}

function createEchoTool(overrides = {}) {
	return createToolFixture({
		name: "echo_tool",
		description: "Echoes input text",
		handler: (input) => ({ echo: input.text }),
		inProp: "text",
		outProp: "echo",
		overrides,
	});
}

function createDestructiveTool() {
	return createToolFixture({
		name: "destroy_data",
		description: "Destroys specified target",
		permission: "destructive",
		handler: () => ({ deleted: true }),
		inProp: "target",
		outProp: "deleted",
		outType: "boolean",
	});
}

function createFailingTool() {
	return createToolFixture({
		name: "fail_tool",
		description: "Always throws an error",
		handler: () => {
			throw new Error("handler explosion");
		},
	});
}

function createScriptedModel(script) {
	let index = 0;
	const capturedCalls = [];
	return {
		generate: async (params) => {
			const messages = Array.isArray(params.messages)
				? [...params.messages]
				: [];
			capturedCalls.push({ ...params, messages });
			if (params.signal?.aborted) {
				const err = new Error("Aborted");
				err.name = "AbortError";
				throw err;
			}
			const step = script[index++];
			if (!step) {
				return { text: "fallback text", toolCalls: [] };
			}
			return typeof step === "function" ? step(params) : step;
		},
		getCalls: () => capturedCalls,
	};
}

function assertResult(res, expected) {
	if (expected.text instanceof RegExp) {
		assert.match(res.text, expected.text);
	} else if (expected.text !== undefined) {
		assert.equal(res.text, expected.text);
	}
	if (expected.steps !== undefined) {
		assert.equal(res.steps, expected.steps);
	}
	if ("pendingApproval" in expected) {
		assert.deepEqual(res.pendingApproval, expected.pendingApproval);
	}
}

function assertDoneEvent(events, expected) {
	const doneEvent = events.find((e) => e.type === "done");
	assert.ok(doneEvent);
	if (expected.steps !== undefined) {
		assert.equal(doneEvent.steps, expected.steps);
	}
	if (expected.text) {
		assert.match(doneEvent.text, expected.text);
	}
	if ("pendingApproval" in expected) {
		assert.deepEqual(doneEvent.pendingApproval, expected.pendingApproval);
	}
	return doneEvent;
}

function setupAgentHarness(options = {}) {
	const {
		script = [],
		tools = [],
		system,
		maxSteps = 8,
		trackEvents = true,
	} = options;
	const events = [];
	const registry = tools.length > 0 ? createRegistry() : undefined;
	for (const tool of tools) {
		registry.register(tool);
	}
	const model = createScriptedModel(script);
	const onEvent = trackEvents ? (ev) => events.push(ev) : undefined;
	const agent = createAgent({ model, registry, system, maxSteps, onEvent });
	return { agent, model, registry, events };
}

describe("module contract", () => {
	test("exports createAgent as a function", () => {
		assert.equal(typeof createAgent, "function");
	});

	test("throws if model is missing or invalid", () => {
		const invalidOptions = [{}, { model: {} }];
		for (const opt of invalidOptions) {
			assert.throws(() => createAgent(opt), /model.*required/i);
		}
	});
});

describe("single-step execution", () => {
	test("returns text and step count when no tools are called", async () => {
		const { agent, events } = setupAgentHarness({
			script: [{ text: "Hello from agent", toolCalls: [] }],
		});

		const res = await agent.run("Hello");
		assertResult(res, {
			text: "Hello from agent",
			steps: 1,
			pendingApproval: undefined,
		});
		assert.deepEqual(
			events.map((e) => e.type),
			["step", "done"],
		);
	});
});

describe("multi-step tool execution", () => {
	test("executes tool, feeds output back to model, and completes", async () => {
		const { agent, model, events } = setupAgentHarness({
			tools: [createEchoTool()],
			system: "You are a test agent",
			script: [
				{
					text: "Calling echo",
					toolCalls: [{ name: "echo_tool", input: { text: "banana" } }],
				},
				{ text: "Done with echo: banana", toolCalls: [] },
			],
		});

		const res = await agent.run("Please echo banana");
		assertResult(res, { text: "Done with echo: banana", steps: 2 });

		const calls = model.getCalls();
		assert.equal(calls.length, 2);
		assert.equal(calls[0].system, "You are a test agent");

		const secondStepMessages = calls[1].messages;
		assert.equal(secondStepMessages.length, 3);
		assert.equal(secondStepMessages[0].role, "user");
		assert.equal(secondStepMessages[1].role, "assistant");
		assert.equal(secondStepMessages[2].role, "tool");
		assert.deepEqual(secondStepMessages[2].content, { echo: "banana" });

		assert.deepEqual(
			events.map((e) => e.type),
			["step", "tool_call", "tool_result", "step", "done"],
		);
	});
});

describe("maxSteps cap", () => {
	test("stops and appends note when maxSteps is hit", async () => {
		const repeatEcho = {
			text: "looping",
			toolCalls: [{ name: "echo_tool", input: { text: "repeat" } }],
		};
		const { agent, events } = setupAgentHarness({
			tools: [createEchoTool()],
			maxSteps: 2,
			script: [repeatEcho, repeatEcho, repeatEcho],
		});

		const res = await agent.run("Loop forever");
		assertResult(res, { steps: 2, text: /max steps/i });
		assertDoneEvent(events, { steps: 2, text: /max steps/i });
	});
});

describe("destructive tool approval required", () => {
	const targetLayer = { target: "layer_1" };
	const approvalPayload = { name: "destroy_data", input: targetLayer };
	const deleteCall = {
		text: "Attempting delete",
		toolCalls: [{ name: "destroy_data", input: targetLayer }],
	};

	const APPROVAL_CASES = [
		{
			title: "stops and returns pendingApproval when approval is missing",
			approved: false,
			script: [deleteCall],
			expected: { steps: 1, pendingApproval: approvalPayload },
			checkDoneEvent: true,
		},
		{
			title: "executes destructive tool when approved is true",
			approved: true,
			script: [deleteCall, { text: "Deleted successfully", toolCalls: [] }],
			expected: {
				steps: 2,
				pendingApproval: undefined,
				text: "Deleted successfully",
			},
			checkDoneEvent: false,
		},
	];

	for (const tc of APPROVAL_CASES) {
		test(tc.title, async () => {
			const { agent, events } = setupAgentHarness({
				tools: [createDestructiveTool()],
				script: tc.script,
				trackEvents: tc.checkDoneEvent,
			});

			const res = await agent.run("Delete layer 1", { approved: tc.approved });
			assertResult(res, tc.expected);
			if (tc.checkDoneEvent) {
				assertDoneEvent(events, {
					pendingApproval: tc.expected.pendingApproval,
				});
			}
		});
	}
});

describe("tool error handling", () => {
	test("feeds tool error back to model and does not throw", async () => {
		const { agent, model } = setupAgentHarness({
			tools: [createFailingTool()],
			script: [
				{
					text: "Calling bad tool",
					toolCalls: [{ name: "fail_tool", input: {} }],
				},
				{ text: "Recovered from tool failure", toolCalls: [] },
			],
			trackEvents: false,
		});

		const res = await agent.run("Trigger fail");
		assertResult(res, { steps: 2, text: "Recovered from tool failure" });

		const calls = model.getCalls();
		const toolMsg = calls[1].messages.find((m) => m.role === "tool");
		assert.ok(toolMsg);
		assert.equal(toolMsg.name, "fail_tool");
		assert.match(toolMsg.content.error, /handler explosion/);
	});
});

describe("abort signal and unhandled errors", () => {
	test("propagates error when model throws without swallowing", async () => {
		const failingModel = {
			generate: async () => {
				throw new Error("HTTP 500 Network crash");
			},
		};
		const agent = createAgent({ model: failingModel });
		await assert.rejects(() => agent.run("Fail now"), /Network crash/);
	});

	test("honors abort signal", async () => {
		const { agent } = setupAgentHarness({
			script: [{ text: "ok", toolCalls: [] }],
			trackEvents: false,
		});
		const controller = new AbortController();
		controller.abort();

		await assert.rejects(
			() => agent.run("Aborted call", { signal: controller.signal }),
			/Abort/i,
		);
	});
});
