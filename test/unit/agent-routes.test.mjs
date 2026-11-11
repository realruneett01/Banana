import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import {
	buildHostedRegistry,
	buildLocalRegistry,
	createAgentRouter,
} from "../../backend/src/routes/agent-routes.js";

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

async function postJson(port, path, payload) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		body: JSON.stringify(payload),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	const data = await res.json().catch(() => ({}));
	return { json: data, status: res.status };
}

function makeValidCircuitIR() {
	return {
		constraints: [],
		name: "TestCircuit",
		nets: [],
		parts: [],
		schemaVersion: 1,
	};
}

function createTwoStepModel(toolCall, step1Text, step2Text) {
	let callCount = 0;
	return {
		generate: async () => {
			callCount += 1;
			if (callCount === 1) {
				return {
					text: step1Text,
					toolCalls: [toolCall],
				};
			}
			return { text: step2Text };
		},
	};
}

function createToolCallingModel() {
	return createTwoStepModel(
		{ input: { ir: makeValidCircuitIR() }, name: "ir.validate" },
		"Validating IR...",
		"Circuit IR is valid and ready.",
	);
}

function createDiffCallingModel() {
	return createTwoStepModel(
		{
			input: {
				basePath: "C:/fake/base.kicad_pcb",
				targetPath: "C:/fake/target.kicad_pcb",
			},
			name: "diff.compare_files",
		},
		"Comparing files...",
		"Diff completed.",
	);
}

function createCommitCallingModel() {
	return {
		generate: async () => ({
			text: "Committing design...",
			toolCalls: [
				{
					input: {
						baseName: "MyBoard",
						boardH: 80,
						boardW: 100,
						ir: makeValidCircuitIR(),
						message: "Initial design",
						repoPath: "C:/fake/repo",
					},
					name: "design.commit",
				},
			],
		}),
	};
}

function createThrowingModel() {
	return {
		generate: async () => {
			throw new Error("Secret API key ABC-123 failed: internal crash");
		},
	};
}

function createAbortableModel(onAbort) {
	return {
		generate: ({ signal }) =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(() => resolve({ text: "done" }), 1000);
				signal.addEventListener("abort", () => {
					clearTimeout(timer);
					onAbort(true);
					const err = new Error("aborted");
					err.name = "AbortError";
					reject(err);
				});
			}),
	};
}

async function runWithLocals(app, port, { allowLocalRepos, body, factory }) {
	if (allowLocalRepos) {
		app.locals.allowLocalRepos = true;
	} else {
		delete app.locals.allowLocalRepos;
	}
	app.locals.agentModelFactory = factory;
	try {
		return await postJson(port, "/api/agent/run", body);
	} finally {
		delete app.locals.allowLocalRepos;
	}
}

function assertErrorResponse(res, expectedStatus) {
	assert.equal(res.status, expectedStatus);
	assert.equal(typeof res.json?.error, "string");
}

function assertRunStatus(res, { steps, text }) {
	assert.equal(res.status, 200);
	assert.equal(res.json?.text, text);
	assert.equal(res.json?.steps, steps);
}

function assertHasEvents(events) {
	assert.ok(Array.isArray(events));
	assert.ok(events.length > 0);
}

function assertToolEvent(event, { name, ok }) {
	assert.equal(event?.name, name);
	if (ok !== undefined) {
		assert.equal(event?.ok, ok);
	}
}

function assertServerError(res, expectedMsg) {
	assert.equal(res.status, 500);
	assert.equal(res.json?.error, expectedMsg);
	assert.equal(res.json?.stack, undefined);
}

function assertToolFailed(toolResult, expectedError, { exact = true } = {}) {
	assert.ok(toolResult);
	assert.equal(toolResult.ok, false);
	if (exact) {
		assert.equal(toolResult.error, expectedError);
	} else {
		assert.notEqual(toolResult.error, expectedError);
	}
}

function assertPendingApproval(res, expected) {
	assert.equal(res.status, 200);
	if (!expected) {
		assert.equal(res.json?.pendingApproval, undefined);
		return;
	}
	assert.ok(res.json?.pendingApproval);
	assert.equal(res.json?.pendingApproval.name, expected.name);
	assert.equal(res.json?.pendingApproval.input?.baseName, expected.baseName);
}

function assertHasLocalTools(names) {
	assert.ok(names.includes("design.commit"));
	assert.ok(names.includes("ir.route"));
}

async function fetchDiffToolResult(app, port, allowLocalRepos) {
	const res = await runWithLocals(app, port, {
		allowLocalRepos,
		body: { message: "compare files" },
		factory: () => createDiffCallingModel(),
	});
	assert.equal(res.status, 200);
	return res.json.events.find(
		(e) => e.type === "tool_result" && e.name === "diff.compare_files",
	);
}

async function runCommitRequest(app, port, bodyExtras = {}) {
	return runWithLocals(app, port, {
		allowLocalRepos: true,
		body: { message: "commit design", ...bodyExtras },
		factory: () => createCommitCallingModel(),
	});
}

const VALIDATION_CASES = [
	{ body: {}, expected: 400, name: "missing message" },
	{ body: { message: 123 }, expected: 400, name: "non-string message" },
	{ body: { message: "" }, expected: 400, name: "empty message" },
	{
		body: { message: "a".repeat(8001) },
		expected: 400,
		name: "too long message",
	},
	{ body: { maxSteps: 0, message: "hi" }, expected: 400, name: "maxSteps < 1" },
	{
		body: { maxSteps: 17, message: "hi" },
		expected: 400,
		name: "maxSteps > 16",
	},
	{
		body: { maxSteps: 2.5, message: "hi" },
		expected: 400,
		name: "maxSteps float",
	},
	{
		body: { maxSteps: "4", message: "hi" },
		expected: 400,
		name: "maxSteps string",
	},
	{
		body: { approved: "true", message: "hi" },
		expected: 400,
		name: "approved non-boolean string",
	},
	{
		body: { approved: 1, message: "hi" },
		expected: 400,
		name: "approved non-boolean number",
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
			assertErrorResponse(res, tc.expected);
		});
	}

	test("fake model returns 200 with text and steps 1", async () => {
		app.locals.agentModelFactory = () => ({
			generate: async () => ({ text: "done" }),
		});
		const res = await postJson(port, "/api/agent/run", { message: "hello" });
		assertRunStatus(res, { steps: 1, text: "done" });
		assertHasEvents(res.json.events);
	});

	test("fake model with tool call runs ir.validate and returns follow-up", async () => {
		app.locals.agentModelFactory = () => createToolCallingModel();
		const res = await postJson(port, "/api/agent/run", {
			message: "check circuit",
		});
		assertRunStatus(res, {
			steps: 2,
			text: "Circuit IR is valid and ready.",
		});
		const toolCall = res.json.events.find((e) => e.type === "tool_call");
		assertToolEvent(toolCall, { name: "ir.validate" });
		const toolResult = res.json.events.find((e) => e.type === "tool_result");
		assertToolEvent(toolResult, { name: "ir.validate", ok: true });
	});

	test("throwing model returns 500 with generic error and no stack", async () => {
		app.locals.agentModelFactory = () => createThrowingModel();
		const res = await postJson(port, "/api/agent/run", {
			message: "trigger error",
		});
		assertServerError(res, "Agent run failed");
		const bodyString = JSON.stringify(res.json);
		assert.equal(bodyString.includes("ABC-123"), false);
	});

	test("aborts agent run when client disconnects", async () => {
		let onAbortTriggered;
		const abortPromise = new Promise((resolve) => {
			onAbortTriggered = resolve;
		});
		app.locals.agentModelFactory = () => createAbortableModel(onAbortTriggered);
		const ac = new AbortController();
		const reqPromise = fetch(`http://127.0.0.1:${port}/api/agent/run`, {
			body: JSON.stringify({ message: "run" }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
			signal: ac.signal,
		}).catch(() => {});
		setTimeout(() => ac.abort(), 30);
		await reqPromise;
		const aborted = await abortPromise;
		assert.equal(aborted, true);
	});

	test("hosted mode rejects diff.compare_files as unknown tool", async () => {
		const toolResult = await fetchDiffToolResult(app, port, false);
		assertToolFailed(toolResult, "unknown tool: diff.compare_files", {
			exact: true,
		});
	});

	test("local mode reaches diff tool when allowLocalRepos is true", async () => {
		const toolResult = await fetchDiffToolResult(app, port, true);
		assertToolFailed(toolResult, "unknown tool: diff.compare_files", {
			exact: false,
		});
	});

	test("hosted registry has no design.commit, ir.route, diff.*, or kicad.* tools", () => {
		const registry = buildHostedRegistry();
		const toolNames = registry.list().map((t) => t.name);
		assert.equal(toolNames.includes("design.commit"), false);
		assert.equal(toolNames.includes("ir.route"), false);
		assert.equal(
			toolNames.some((n) => n.startsWith("diff.")),
			false,
		);
		assert.equal(
			toolNames.some((n) => n.startsWith("kicad.")),
			false,
		);
		assert.ok(toolNames.includes("ir.validate"));
	});

	test("local mode lists design.commit and ir.route", async () => {
		let receivedTools = [];
		const res = await runWithLocals(app, port, {
			allowLocalRepos: true,
			body: { message: "list tools" },
			factory: () => ({
				generate: async ({ tools }) => {
					receivedTools = tools || [];
					return { text: "done" };
				},
			}),
		});
		assert.equal(res.status, 200);
		const names = receivedTools.map((t) => t.name);
		assertHasLocalTools(names);
	});

	test("design.commit without approved returns pendingApproval through agent", async () => {
		const res = await runCommitRequest(app, port);
		assertPendingApproval(res, {
			baseName: "MyBoard",
			name: "design.commit",
		});
	});

	test("design.commit with approved:true reaches the tool", async () => {
		const res = await runCommitRequest(app, port, { approved: true });
		assertPendingApproval(res, null);
		const toolResult = res.json.events.find(
			(e) => e.type === "tool_result" && e.name === "design.commit",
		);
		assertToolFailed(toolResult, "approval required", { exact: false });
	});

	test("buildLocalRegistry registers commit and route tools with deps", async () => {
		const fakeExec = async () => ({ stdout: "abc1234\n" });
		const fakeFs = { mkdir: async () => {}, writeFile: async () => {} };
		const registry = buildLocalRegistry({
			commit: { execFileFn: fakeExec, fsImpl: fakeFs },
		});
		const names = registry.list().map((t) => t.name);
		assertHasLocalTools(names);
	});
});
