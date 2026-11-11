import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { createAgentRouter } from "../../backend/src/routes/agent-routes.js";

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve(port);
		});
	});
}

function closeServer(server) {
	return new Promise((resolve) => server.close(resolve));
}

async function postJson(port, path, body) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

function makeValidCircuitIR() {
	return {
		schemaVersion: 1,
		name: "TestCircuit",
		parts: [],
		nets: [],
		constraints: [],
	};
}

function createToolCallingModel() {
	let callCount = 0;
	return {
		generate: async () => {
			callCount += 1;
			if (callCount === 1) {
				return {
					text: "Validating IR...",
					toolCalls: [
						{
							name: "ir.validate",
							input: { ir: makeValidCircuitIR() },
						},
					],
				};
			}
			return {
				text: "Circuit IR is valid and ready.",
			};
		},
	};
}

function createDiffCallingModel() {
	let callCount = 0;
	return {
		generate: async () => {
			callCount += 1;
			if (callCount === 1) {
				return {
					text: "Comparing files...",
					toolCalls: [
						{
							name: "diff.compare_files",
							input: {
								basePath: "C:/fake/base.kicad_pcb",
								targetPath: "C:/fake/target.kicad_pcb",
							},
						},
					],
				};
			}
			return {
				text: "Diff completed.",
			};
		},
	};
}

function createThrowingModel() {
	return {
		generate: async () => {
			throw new Error("Secret API key ABC-123 failed: internal crash");
		},
	};
}

const VALIDATION_CASES = [
	{ name: "missing message", body: {}, expected: 400 },
	{ name: "non-string message", body: { message: 123 }, expected: 400 },
	{ name: "empty message", body: { message: "" }, expected: 400 },
	{
		name: "too long message",
		body: { message: "a".repeat(8001) },
		expected: 400,
	},
	{ name: "maxSteps < 1", body: { message: "hi", maxSteps: 0 }, expected: 400 },
	{
		name: "maxSteps > 16",
		body: { message: "hi", maxSteps: 17 },
		expected: 400,
	},
	{
		name: "maxSteps float",
		body: { message: "hi", maxSteps: 2.5 },
		expected: 400,
	},
	{
		name: "maxSteps string",
		body: { message: "hi", maxSteps: "4" },
		expected: 400,
	},
	{
		name: "approved non-boolean string",
		body: { message: "hi", approved: "true" },
		expected: 400,
	},
	{
		name: "approved non-boolean number",
		body: { message: "hi", approved: 1 },
		expected: 400,
	},
];

describe("agent-routes", () => {
	let app;
	let server;
	let port;

	before(async () => {
		app = createApp();
		server = http.createServer(app);
		port = await listen(server);
	});

	after(async () => {
		await closeServer(server);
	});

	test("createAgentRouter named export returns fresh router", () => {
		const freshRouter = createAgentRouter();
		assert.equal(typeof freshRouter, "function");
	});

	for (const tc of VALIDATION_CASES) {
		test(`validation rejects ${tc.name} with 400`, async () => {
			const res = await postJson(port, "/api/agent/run", tc.body);
			assert.equal(res.status, tc.expected);
			assert.ok(typeof res.json.error === "string");
		});
	}

	test("fake model returns 200 with text and steps 1", async () => {
		app.locals.agentModelFactory = () => ({
			generate: async () => ({ text: "done" }),
		});
		const res = await postJson(port, "/api/agent/run", { message: "hello" });
		assert.equal(res.status, 200);
		assert.equal(res.json.text, "done");
		assert.equal(res.json.steps, 1);
		assert.ok(Array.isArray(res.json.events));
		assert.ok(res.json.events.length > 0);
	});

	test("fake model with tool call runs ir.validate and returns follow-up", async () => {
		app.locals.agentModelFactory = () => createToolCallingModel();
		const res = await postJson(port, "/api/agent/run", {
			message: "check circuit",
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.text, "Circuit IR is valid and ready.");
		assert.equal(res.json.steps, 2);
		const toolCall = res.json.events.find((e) => e.type === "tool_call");
		assert.equal(toolCall?.name, "ir.validate");
		const toolResult = res.json.events.find((e) => e.type === "tool_result");
		assert.equal(toolResult?.name, "ir.validate");
		assert.equal(toolResult?.ok, true);
	});

	test("throwing model returns 500 with generic error and no stack", async () => {
		app.locals.agentModelFactory = () => createThrowingModel();
		const res = await postJson(port, "/api/agent/run", {
			message: "trigger error",
		});
		assert.equal(res.status, 500);
		assert.equal(res.json.error, "Agent run failed");
		assert.equal(res.json.stack, undefined);
		const bodyString = JSON.stringify(res.json);
		assert.equal(bodyString.includes("ABC-123"), false);
	});

	test("aborts agent run when client disconnects", async () => {
		let onAbortTriggered;
		const abortPromise = new Promise((resolve) => {
			onAbortTriggered = resolve;
		});
		app.locals.agentModelFactory = () => ({
			generate: async ({ signal }) => {
				return new Promise((resolve, reject) => {
					const timer = setTimeout(() => resolve({ text: "done" }), 1000);
					signal.addEventListener("abort", () => {
						clearTimeout(timer);
						onAbortTriggered(true);
						const err = new Error("aborted");
						err.name = "AbortError";
						reject(err);
					});
				});
			},
		});
		const ac = new AbortController();
		const reqPromise = fetch(`http://127.0.0.1:${port}/api/agent/run`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "run" }),
			signal: ac.signal,
		}).catch(() => {});
		setTimeout(() => ac.abort(), 30);
		await reqPromise;
		const aborted = await abortPromise;
		assert.equal(aborted, true);
	});

	test("hosted mode rejects diff.compare_files as unknown tool", async () => {
		delete app.locals.allowLocalRepos;
		app.locals.agentModelFactory = () => createDiffCallingModel();
		const res = await postJson(port, "/api/agent/run", {
			message: "compare files",
		});
		assert.equal(res.status, 200);
		const toolResult = res.json.events.find(
			(e) => e.type === "tool_result" && e.name === "diff.compare_files",
		);
		assert.ok(toolResult);
		assert.equal(toolResult.ok, false);
		assert.equal(toolResult.error, "unknown tool: diff.compare_files");
	});

	test("local mode reaches diff tool when allowLocalRepos is true", async () => {
		app.locals.allowLocalRepos = true;
		app.locals.agentModelFactory = () => createDiffCallingModel();
		const res = await postJson(port, "/api/agent/run", {
			message: "compare files",
		});
		delete app.locals.allowLocalRepos;
		assert.equal(res.status, 200);
		const toolResult = res.json.events.find(
			(e) => e.type === "tool_result" && e.name === "diff.compare_files",
		);
		assert.ok(toolResult);
		assert.equal(toolResult.ok, false);
		assert.notEqual(toolResult.error, "unknown tool: diff.compare_files");
	});
});
