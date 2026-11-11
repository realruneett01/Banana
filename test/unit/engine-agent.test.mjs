import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";

function createEchoTool(overrides = {}) {
	return {
		name: "echo_tool",
		description: "Echoes input text",
		inputSchema: {
			type: "object",
			required: ["text"],
			properties: { text: { type: "string" } },
		},
		outputSchema: {
			type: "object",
			required: ["echo"],
			properties: { echo: { type: "string" } },
		},
		permission: "read",
		handler: (input) => ({ echo: input.text }),
		...overrides,
	};
}

function createDestructiveTool() {
	return {
		name: "destroy_data",
		description: "Destroys specified target",
		inputSchema: {
			type: "object",
			required: ["target"],
			properties: { target: { type: "string" } },
		},
		outputSchema: {
			type: "object",
			required: ["deleted"],
			properties: { deleted: { type: "boolean" } },
		},
		permission: "destructive",
		handler: () => ({ deleted: true }),
	};
}

function createFailingTool() {
	return {
		name: "fail_tool",
		description: "Always throws an error",
		inputSchema: {
			type: "object",
			properties: {},
		},
		outputSchema: {
			type: "object",
			properties: {},
		},
		permission: "read",
		handler: () => {
			throw new Error("handler explosion");
		},
	};
}

function createScriptedModel(script) {
	let index = 0;
	const capturedCalls = [];
	return {
		generate: async (params) => {
			capturedCalls.push({
				...params,
				messages: Array.isArray(params.messages) ? [...params.messages] : [],
			});
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

describe("module contract", () => {
	test("exports createAgent as a function", async () => {
		const mod = await import("../../backend/src/engine/agent.js");
		assert.equal(typeof mod.createAgent, "function");
	});

	test("throws if model is missing or invalid", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		assert.throws(() => createAgent({}), /model.*required/i);
		assert.throws(() => createAgent({ model: {} }), /model.*required/i);
	});
});

describe("single-step execution", () => {
	test("returns text and step count when no tools are called", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const events = [];
		const model = createScriptedModel([
			{ text: "Hello from agent", toolCalls: [] },
		]);
		const agent = createAgent({
			model,
			onEvent: (ev) => events.push(ev),
		});

		const res = await agent.run("Hello");
		assert.equal(res.text, "Hello from agent");
		assert.equal(res.steps, 1);
		assert.equal(res.pendingApproval, undefined);
		assert.equal(events.length, 2);
		assert.equal(events[0].type, "step");
		assert.equal(events[1].type, "done");
	});
});

describe("multi-step tool execution", () => {
	test("executes tool, feeds output back to model, and completes", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const registry = createRegistry();
		registry.register(createEchoTool());

		const events = [];
		const model = createScriptedModel([
			{
				text: "Calling echo",
				toolCalls: [{ name: "echo_tool", input: { text: "banana" } }],
			},
			{ text: "Done with echo: banana", toolCalls: [] },
		]);

		const agent = createAgent({
			model,
			registry,
			system: "You are a test agent",
			onEvent: (ev) => events.push(ev),
		});

		const res = await agent.run("Please echo banana");
		assert.equal(res.text, "Done with echo: banana");
		assert.equal(res.steps, 2);

		const calls = model.getCalls();
		assert.equal(calls.length, 2);
		assert.equal(calls[0].system, "You are a test agent");

		const secondStepMessages = calls[1].messages;
		assert.equal(secondStepMessages.length, 3);
		assert.equal(secondStepMessages[0].role, "user");
		assert.equal(secondStepMessages[1].role, "assistant");
		assert.equal(secondStepMessages[2].role, "tool");
		assert.deepEqual(secondStepMessages[2].content, { echo: "banana" });

		const eventTypes = events.map((e) => e.type);
		assert.deepEqual(eventTypes, [
			"step",
			"tool_call",
			"tool_result",
			"step",
			"done",
		]);
	});
});

describe("maxSteps cap", () => {
	test("stops and appends note when maxSteps is hit", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const registry = createRegistry();
		registry.register(createEchoTool());

		const events = [];
		const infiniteToolResponse = {
			text: "looping",
			toolCalls: [{ name: "echo_tool", input: { text: "repeat" } }],
		};
		const model = createScriptedModel([
			infiniteToolResponse,
			infiniteToolResponse,
			infiniteToolResponse,
		]);

		const agent = createAgent({
			model,
			registry,
			maxSteps: 2,
			onEvent: (ev) => events.push(ev),
		});

		const res = await agent.run("Loop forever");
		assert.equal(res.steps, 2);
		assert.match(res.text, /max steps/i);

		const doneEvent = events.find((e) => e.type === "done");
		assert.ok(doneEvent);
		assert.equal(doneEvent.steps, 2);
		assert.match(doneEvent.text, /max steps/i);
	});
});

describe("destructive tool approval required", () => {
	test("stops and returns pendingApproval when approval is missing", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const registry = createRegistry();
		registry.register(createDestructiveTool());

		const events = [];
		const model = createScriptedModel([
			{
				text: "Attempting delete",
				toolCalls: [{ name: "destroy_data", input: { target: "layer_1" } }],
			},
		]);

		const agent = createAgent({
			model,
			registry,
			onEvent: (ev) => events.push(ev),
		});

		const res = await agent.run("Delete layer 1", { approved: false });
		assert.equal(res.steps, 1);
		assert.deepEqual(res.pendingApproval, {
			name: "destroy_data",
			input: { target: "layer_1" },
		});

		const doneEvent = events.find((e) => e.type === "done");
		assert.ok(doneEvent);
		assert.deepEqual(doneEvent.pendingApproval, {
			name: "destroy_data",
			input: { target: "layer_1" },
		});
	});

	test("executes destructive tool when approved is true", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const registry = createRegistry();
		registry.register(createDestructiveTool());

		const model = createScriptedModel([
			{
				text: "Attempting delete",
				toolCalls: [{ name: "destroy_data", input: { target: "layer_1" } }],
			},
			{ text: "Deleted successfully", toolCalls: [] },
		]);

		const agent = createAgent({ model, registry });
		const res = await agent.run("Delete layer 1", { approved: true });

		assert.equal(res.steps, 2);
		assert.equal(res.pendingApproval, undefined);
		assert.equal(res.text, "Deleted successfully");
	});
});

describe("tool error handling", () => {
	test("feeds tool error back to model and does not throw", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const registry = createRegistry();
		registry.register(createFailingTool());

		const events = [];
		const model = createScriptedModel([
			{
				text: "Calling bad tool",
				toolCalls: [{ name: "fail_tool", input: {} }],
			},
			{ text: "Recovered from tool failure", toolCalls: [] },
		]);

		const agent = createAgent({
			model,
			registry,
			onEvent: (ev) => events.push(ev),
		});

		const res = await agent.run("Trigger fail");
		assert.equal(res.steps, 2);
		assert.equal(res.text, "Recovered from tool failure");

		const calls = model.getCalls();
		const toolMsg = calls[1].messages.find((m) => m.role === "tool");
		assert.ok(toolMsg);
		assert.equal(toolMsg.name, "fail_tool");
		assert.match(toolMsg.content.error, /handler explosion/);
	});
});

describe("abort signal and unhandled errors", () => {
	test("propagates error when model throws without swallowing", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const failingModel = {
			generate: async () => {
				throw new Error("HTTP 500 Network crash");
			},
		};
		const agent = createAgent({ model: failingModel });
		await assert.rejects(() => agent.run("Fail now"), /Network crash/);
	});

	test("honors abort signal", async () => {
		const { createAgent } = await import("../../backend/src/engine/agent.js");
		const model = createScriptedModel([{ text: "ok", toolCalls: [] }]);
		const agent = createAgent({ model });
		const controller = new AbortController();
		controller.abort();

		await assert.rejects(
			() => agent.run("Aborted call", { signal: controller.signal }),
			/Abort/i,
		);
	});
});
