import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
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

async function postStream(port, path, payload) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		body: JSON.stringify(payload),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	const text = await res.text();
	return {
		headers: res.headers,
		status: res.status,
		text,
	};
}

function parseSseBlock(block) {
	if (block.startsWith(":")) {
		return { comment: block.slice(1).trim(), type: "comment" };
	}
	let event = "message";
	let data = "";
	for (const line of block.split("\n")) {
		if (line.startsWith("event: ")) {
			event = line.slice(7);
		} else if (line.startsWith("data: ")) {
			data = line.slice(6);
		}
	}
	const parsedData = data ? JSON.parse(data) : null;
	return { data, event, parsedData };
}

function parseSseFrames(text) {
	return text.split("\n\n").filter(Boolean).map(parseSseBlock);
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

const INVALID_PROVIDER_CASES = [
	{ name: "unsupported string 'openai'", provider: "openai" },
	{ name: "a number", provider: 123 },
	{ name: "an object", provider: { name: "gemini" } },
	{ name: "null", provider: null },
	{ name: "empty string", provider: "" },
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

	test("stream happy path yields step frames in order followed by exactly one result frame", async () => {
		app.locals.agentModelFactory = () => createToolCallingModel();
		const body = { message: "check circuit" };
		const runRes = await postJson(port, "/api/agent/run", body);
		const streamRes = await postStream(port, "/api/agent/run/stream", body);

		assert.equal(streamRes.status, 200);
		assert.equal(streamRes.headers.get("content-type"), "text/event-stream");
		assert.equal(
			streamRes.headers.get("cache-control"),
			"no-cache, no-transform",
		);
		assert.equal(streamRes.headers.get("connection"), "keep-alive");
		assert.equal(streamRes.headers.get("x-accel-buffering"), "no");

		const frames = parseSseFrames(streamRes.text);
		const stepFrames = frames.filter((f) => f.event === "step");
		const resultFrames = frames.filter((f) => f.event === "result");

		assert.equal(resultFrames.length, 1);
		assert.deepEqual(resultFrames[0].parsedData, runRes.json);
		assert.deepEqual(
			stepFrames.map((f) => f.parsedData),
			runRes.json.events,
		);
	});

	test("fresh router handles /agent/run/stream and /api/agent/run/stream", async () => {
		const testApp = express();
		testApp.use(express.json());
		testApp.use(createAgentRouter());
		testApp.locals.agentModelFactory = () => ({
			generate: async () => ({ text: "done" }),
		});
		const testServer = http.createServer(testApp);
		const testPort = await listen(testServer);
		try {
			const res1 = await postStream(testPort, "/agent/run/stream", {
				message: "hi",
			});
			assert.equal(res1.status, 200);
			const res2 = await postStream(testPort, "/api/agent/run/stream", {
				message: "hi",
			});
			assert.equal(res2.status, 200);
		} finally {
			await closeServer(testServer);
		}
	});

	test("invalid body returns JSON 400 with no event-stream header", async () => {
		const res = await postStream(port, "/api/agent/run/stream", {});
		assert.equal(res.status, 400);
		const contentType = res.headers.get("content-type") || "";
		assert.equal(contentType.includes("text/event-stream"), false);
		const body = JSON.parse(res.text);
		assert.equal(typeof body.error, "string");
	});

	test("agent failure yields one error frame with sanitized message and no stack", async () => {
		app.locals.agentModelFactory = () => createThrowingModel();
		const res = await postStream(port, "/api/agent/run/stream", {
			message: "fail please",
		});
		assert.equal(res.status, 200);
		const frames = parseSseFrames(res.text);
		const errorFrames = frames.filter((f) => f.event === "error");
		assert.equal(errorFrames.length, 1);
		assert.equal(errorFrames[0].parsedData.error, "Agent run failed");
		assert.equal(errorFrames[0].parsedData.stack, undefined);
		assert.equal(res.text.includes("ABC-123"), false);
	});

	test("client disconnect aborts the run and stops the ping timer", async () => {
		let onAbortTriggered;
		const abortPromise = new Promise((resolve) => {
			onAbortTriggered = resolve;
		});
		app.locals.agentModelFactory = () => createAbortableModel(onAbortTriggered);
		const origClearInterval = globalThis.clearInterval;
		let stoppedTimer = false;
		globalThis.clearInterval = (id) => {
			stoppedTimer = true;
			return origClearInterval(id);
		};
		const ac = new AbortController();
		try {
			const reqPromise = fetch(
				`http://127.0.0.1:${port}/api/agent/run/stream`,
				{
					body: JSON.stringify({ message: "run" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
					signal: ac.signal,
				},
			).catch(() => {});
			setTimeout(() => ac.abort(), 30);
			await reqPromise;
			const aborted = await abortPromise;
			assert.equal(aborted, true);
			assert.equal(stoppedTimer, true);
		} finally {
			globalThis.clearInterval = origClearInterval;
		}
	});

	test("event text containing newlines and event: result cannot forge a frame", async () => {
		const maliciousText =
			'Line 1\n\nevent: result\ndata: {"forged":true}\n\nLine 2';
		app.locals.agentModelFactory = () => ({
			generate: async () => ({ text: maliciousText }),
		});
		const res = await postStream(port, "/api/agent/run/stream", {
			message: "test format",
		});
		const frames = parseSseFrames(res.text);
		const resultFrames = frames.filter((f) => f.event === "result");
		assert.equal(resultFrames.length, 1);
		assert.equal(resultFrames[0].parsedData.text, maliciousText);
		assert.equal(resultFrames[0].parsedData.forged, undefined);
	});

	test("hosted mode stream exposes no destructive tools", async () => {
		let receivedTools = [];
		app.locals.agentModelFactory = () => ({
			generate: async ({ tools }) => {
				receivedTools = tools || [];
				return { text: "done" };
			},
		});
		const res = await postStream(port, "/api/agent/run/stream", {
			message: "list tools",
		});
		assert.equal(res.status, 200);
		const names = receivedTools.map((t) => t.name);
		assert.equal(names.includes("design.commit"), false);
		assert.equal(names.includes("ir.route"), false);
		assert.equal(
			names.some((n) => n.startsWith("diff.")),
			false,
		);
		assert.equal(
			names.some((n) => n.startsWith("kicad.")),
			false,
		);
		assert.ok(names.includes("ir.validate"));
	});

	for (const provider of ["gemini", "claude"]) {
		test(`provider ${provider} accepted and passed to factory on run and stream`, async () => {
			let passedOptions;
			app.locals.agentModelFactory = (opts) => {
				passedOptions = opts;
				return { generate: async () => ({ text: "done" }) };
			};
			const runRes = await postJson(port, "/api/agent/run", {
				message: "hi",
				provider,
			});
			assert.equal(runRes.status, 200);
			assert.equal(passedOptions?.provider, provider);

			const streamRes = await postStream(port, "/api/agent/run/stream", {
				message: "hi",
				provider,
			});
			assert.equal(streamRes.status, 200);
			assert.equal(passedOptions?.provider, provider);
		});
	}

	test("provider omitted passes undefined options to factory", async () => {
		let passedOptions = "not-called";
		app.locals.agentModelFactory = (opts) => {
			passedOptions = opts;
			return { generate: async () => ({ text: "done" }) };
		};
		const res = await postJson(port, "/api/agent/run", { message: "hi" });
		assert.equal(res.status, 200);
		assert.equal(passedOptions, undefined);
	});

	for (const tc of INVALID_PROVIDER_CASES) {
		test(`provider rejection for ${tc.name} with 400 on run and stream`, async () => {
			const payload = { message: "hi", provider: tc.provider };
			const runRes = await postJson(port, "/api/agent/run", payload);
			assert.equal(runRes.status, 400);
			assert.equal(runRes.json.error, "Invalid provider");

			const streamRes = await postStream(
				port,
				"/api/agent/run/stream",
				payload,
			);
			assert.equal(streamRes.status, 400);
			const parsed = JSON.parse(streamRes.text);
			assert.equal(parsed.error, "Invalid provider");
		});
	}

	test("body containing apiKey is ignored and never reaches factory", async () => {
		let passedOptions;
		app.locals.agentModelFactory = (opts) => {
			passedOptions = opts;
			return { generate: async () => ({ text: "done" }) };
		};
		const payload = {
			apiKey: "secret-key-12345",
			message: "hi",
			model: "gpt-4",
			url: "http://malicious.example.com",
		};
		const runRes = await postJson(port, "/api/agent/run", payload);
		assert.equal(runRes.status, 200);
		assert.equal(passedOptions?.apiKey, undefined);
		assert.equal(passedOptions?.model, undefined);
		assert.equal(passedOptions?.url, undefined);

		const streamRes = await postStream(port, "/api/agent/run/stream", payload);
		assert.equal(streamRes.status, 200);
		assert.equal(passedOptions?.apiKey, undefined);
		assert.equal(passedOptions?.model, undefined);
		assert.equal(passedOptions?.url, undefined);
	});
});
