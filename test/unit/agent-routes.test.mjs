import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import {
	createRateLimiter,
	skipWhenLocal,
} from "../../backend/src/rate-limit.js";
import defaultRouter, {
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

async function sendPost(port, path, payload, signal) {
	return fetch(`http://127.0.0.1:${port}${path}`, {
		body: JSON.stringify(payload),
		headers: { "Content-Type": "application/json" },
		method: "POST",
		...(signal ? { signal } : {}),
	});
}

async function postJson(port, path, payload) {
	const res = await sendPost(port, path, payload);
	const data = await res.json().catch(() => ({}));
	return { json: data, status: res.status };
}

async function postStream(port, path, payload) {
	const res = await sendPost(port, path, payload);
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

function createDoneModel(text = "done") {
	return { generate: async () => ({ text }) };
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

function createToolCapturingModel(onCapture) {
	return {
		generate: async ({ tools }) => {
			onCapture(tools || []);
			return { text: "done" };
		},
	};
}

function createOptionsCapturingFactory(onCapture, text = "done") {
	return (opts) => {
		onCapture(opts);
		return createDoneModel(text);
	};
}

async function runAgent(app, port, factory, { message, stream = false }) {
	app.locals.agentModelFactory = factory;
	if (stream) return postStream(port, "/api/agent/run/stream", { message });
	return postJson(port, "/api/agent/run", { message });
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

async function runDualEndpoints(port, payload) {
	const runRes = await postJson(port, "/api/agent/run", payload);
	const streamRes = await postStream(port, "/api/agent/run/stream", payload);
	return { runRes, streamRes };
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

function assertHostedToolExclusions(toolNames) {
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
}

function assertProviderPassed(resStatus, options, provider) {
	assert.equal(resStatus, 200);
	assert.equal(options?.provider, provider);
}

function assertInvalidProvider(status, error) {
	assert.equal(status, 400);
	assert.equal(error, "Invalid provider");
}

function assertDisallowedOptionsIgnored(resStatus, options) {
	assert.equal(resStatus, 200);
	assert.equal(options?.apiKey, undefined);
	assert.equal(options?.model, undefined);
	assert.equal(options?.url, undefined);
}

function assertRateLimitRejected(res) {
	assert.equal(res.status, 429);
	assert.equal(res.json?.error, "Too many requests, retry later");
}

function assertRateLimitHeaders(res, { limit, remaining, retryAfter, status }) {
	assert.equal(res.status, status);
	assert.equal(res.headers.get("ratelimit-limit"), limit);
	assert.equal(res.headers.get("ratelimit-remaining"), remaining);
	assert.ok(res.headers.get("ratelimit-reset"));
	if (retryAfter) {
		assert.ok(res.headers.get("retry-after"));
	}
}

function findEvent(events, type, name) {
	return events.find((e) => e.type === type && (!name || e.name === name));
}

async function fetchDiffToolResult(app, port, allowLocalRepos) {
	const res = await runWithLocals(app, port, {
		allowLocalRepos,
		body: { message: "compare files" },
		factory: () => createDiffCallingModel(),
	});
	assert.equal(res.status, 200);
	return findEvent(res.json.events, "tool_result", "diff.compare_files");
}

async function runCommitRequest(app, port, bodyExtras = {}) {
	return runWithLocals(app, port, {
		allowLocalRepos: true,
		body: { message: "commit design", ...bodyExtras },
		factory: () => createCommitCallingModel(),
	});
}

async function runWithAbort(app, port, urlPath) {
	let onAbortTriggered;
	const abortPromise = new Promise((resolve) => {
		onAbortTriggered = resolve;
	});
	app.locals.agentModelFactory = () => createAbortableModel(onAbortTriggered);
	const ac = new AbortController();
	const reqPromise = sendPost(
		port,
		urlPath,
		{ message: "run" },
		ac.signal,
	).catch(() => {
		// Expected abort rejection on client disconnect
	});
	setTimeout(() => ac.abort(), 30);
	await reqPromise;
	return abortPromise;
}

async function withTestServer(router, locals, fn) {
	const testApp = express();
	testApp.use(express.json());
	testApp.use(router);
	Object.assign(testApp.locals, locals);
	const testServer = http.createServer(testApp);
	const testPort = await listen(testServer);
	try {
		await fn(testPort);
	} finally {
		await closeServer(testServer);
	}
}

async function withRateLimitServer({ limiter, locals = {} }, fn) {
	return withTestServer(createAgentRouter({ limiter }), locals, fn);
}

async function withLimiterServer(max, fn, options = {}) {
	const limiter = options.skipLocal
		? skipWhenLocal(createRateLimiter({ max, windowMs: 60000 }))
		: createRateLimiter({ max, windowMs: 60000 });
	const locals = {
		agentModelFactory: () => {
			if (options.onCall) {
				options.onCall();
			}
			return createDoneModel("ok");
		},
		...(options.allowLocalRepos ? { allowLocalRepos: true } : {}),
	};
	return withRateLimitServer({ limiter, locals }, fn);
}

async function withCountingLimiter(max, fn) {
	let calls = 0;
	await withLimiterServer(max, fn, {
		onCall: () => {
			calls += 1;
		},
	});
	return calls;
}

async function postExpect(post, port, body, status) {
	const path = post === postJson ? "/agent/run" : "/agent/run/stream";
	const res = await post(port, path, body);
	assert.equal(res.status, status);
	return res;
}

const VALIDATION_CASES = [
	["missing message", {}],
	["non-string message", { message: 123 }],
	["empty message", { message: "" }],
	["too long message", { message: "a".repeat(8001) }],
	["maxSteps < 1", { maxSteps: 0, message: "hi" }],
	["maxSteps > 16", { maxSteps: 17, message: "hi" }],
	["maxSteps float", { maxSteps: 2.5, message: "hi" }],
	["maxSteps string", { maxSteps: "4", message: "hi" }],
	["approved non-boolean string", { approved: "true", message: "hi" }],
	["approved non-boolean number", { approved: 1, message: "hi" }],
].map(([name, body]) => ({ body, expected: 400, name }));

const INVALID_PROVIDER_CASES = [
	{ name: "unsupported string 'openai'", provider: "openai" },
	{ name: "a number", provider: 123 },
	{ name: "an object", provider: { name: "gemini" } },
	{ name: "null", provider: null },
	{ name: "empty string", provider: "" },
];

const DIFF_TOOL_CASES = [
	{
		allowLocalRepos: false,
		exact: true,
		name: "hosted mode rejects diff.compare_files as unknown tool",
	},
	{
		allowLocalRepos: true,
		exact: false,
		name: "local mode reaches diff tool when allowLocalRepos is true",
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

	beforeEach(() => {
		defaultRouter.limiter?.store?.clear();
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
		const res = await runAgent(app, port, () => createDoneModel(), {
			message: "hello",
		});
		assertRunStatus(res, { steps: 1, text: "done" });
		assertHasEvents(res.json.events);
	});

	test("fake model with tool call runs ir.validate and returns follow-up", async () => {
		const res = await runAgent(app, port, () => createToolCallingModel(), {
			message: "check circuit",
		});
		assertRunStatus(res, {
			steps: 2,
			text: "Circuit IR is valid and ready.",
		});
		const toolCall = findEvent(res.json.events, "tool_call");
		assertToolEvent(toolCall, { name: "ir.validate" });
		const toolResult = findEvent(res.json.events, "tool_result");
		assertToolEvent(toolResult, { name: "ir.validate", ok: true });
	});

	test("throwing model returns 500 with generic error and no stack", async () => {
		const res = await runAgent(app, port, () => createThrowingModel(), {
			message: "trigger error",
		});
		assertServerError(res, "Agent run failed");
		const bodyString = JSON.stringify(res.json);
		assert.equal(bodyString.includes("ABC-123"), false);
	});

	test("aborts agent run when client disconnects", async () => {
		const aborted = await runWithAbort(app, port, "/api/agent/run");
		assert.equal(aborted, true);
	});

	for (const tc of DIFF_TOOL_CASES) {
		test(tc.name, async () => {
			const toolResult = await fetchDiffToolResult(
				app,
				port,
				tc.allowLocalRepos,
			);
			assertToolFailed(toolResult, "unknown tool: diff.compare_files", {
				exact: tc.exact,
			});
		});
	}

	test("hosted registry has no design.commit, ir.route, diff.*, or kicad.* tools", () => {
		const registry = buildHostedRegistry();
		const toolNames = registry.list().map((t) => t.name);
		assertHostedToolExclusions(toolNames);
	});

	test("local mode lists design.commit and ir.route", async () => {
		let receivedTools = [];
		const res = await runWithLocals(app, port, {
			allowLocalRepos: true,
			body: { message: "list tools" },
			factory: () =>
				createToolCapturingModel((tools) => {
					receivedTools = tools;
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
		const toolResult = findEvent(
			res.json.events,
			"tool_result",
			"design.commit",
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
		await withTestServer(
			createAgentRouter(),
			{
				agentModelFactory: () => createDoneModel(),
			},
			async (testPort) => {
				for (const path of ["/agent/run/stream", "/api/agent/run/stream"]) {
					const res = await postStream(testPort, path, { message: "hi" });
					assert.equal(res.status, 200);
				}
			},
		);
	});

	test("invalid body returns JSON 400 with no event-stream header", async () => {
		const res = await postStream(port, "/api/agent/run/stream", {});
		assert.equal(res.status, 400);
		const isSse = (res.headers.get("content-type") || "").includes(
			"text/event-stream",
		);
		assert.equal(isSse, false);
		const body = JSON.parse(res.text);
		assert.equal(typeof body.error, "string");
	});

	test("agent failure yields one error frame with sanitized message and no stack", async () => {
		const res = await runAgent(app, port, () => createThrowingModel(), {
			message: "fail please",
			stream: true,
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
		const origClearInterval = globalThis.clearInterval;
		let stoppedTimer = false;
		globalThis.clearInterval = (id) => {
			stoppedTimer = true;
			return origClearInterval(id);
		};
		try {
			const aborted = await runWithAbort(app, port, "/api/agent/run/stream");
			assert.equal(aborted, true);
			assert.equal(stoppedTimer, true);
		} finally {
			globalThis.clearInterval = origClearInterval;
		}
	});

	test("event text containing newlines and event: result cannot forge a frame", async () => {
		const maliciousText =
			'Line 1\n\nevent: result\ndata: {"forged":true}\n\nLine 2';
		const res = await runAgent(
			app,
			port,
			() => createDoneModel(maliciousText),
			{ message: "test format", stream: true },
		);
		const frames = parseSseFrames(res.text);
		const resultFrames = frames.filter((f) => f.event === "result");
		assert.equal(resultFrames.length, 1);
		assert.equal(resultFrames[0].parsedData.text, maliciousText);
		assert.equal(resultFrames[0].parsedData.forged, undefined);
	});

	test("hosted mode stream exposes no destructive tools", async () => {
		let receivedTools = [];
		app.locals.agentModelFactory = () =>
			createToolCapturingModel((tools) => {
				receivedTools = tools;
			});
		const res = await postStream(port, "/api/agent/run/stream", {
			message: "list tools",
		});
		assert.equal(res.status, 200);
		const names = receivedTools.map((t) => t.name);
		assertHostedToolExclusions(names);
	});

	for (const provider of ["gemini", "claude"]) {
		test(`provider ${provider} accepted and passed to factory on run and stream`, async () => {
			let passedOptions;
			app.locals.agentModelFactory = createOptionsCapturingFactory((opts) => {
				passedOptions = opts;
			});
			const payload = { message: "hi", provider };
			const { runRes, streamRes } = await runDualEndpoints(port, payload);
			assertProviderPassed(runRes.status, passedOptions, provider);
			assertProviderPassed(streamRes.status, passedOptions, provider);
		});
	}

	test("provider omitted passes undefined options to factory", async () => {
		let passedOptions = "not-called";
		app.locals.agentModelFactory = createOptionsCapturingFactory((opts) => {
			passedOptions = opts;
		});
		const res = await postJson(port, "/api/agent/run", { message: "hi" });
		assert.equal(res.status, 200);
		assert.equal(passedOptions, undefined);
	});

	for (const tc of INVALID_PROVIDER_CASES) {
		test(`provider rejection for ${tc.name} with 400 on run and stream`, async () => {
			const payload = { message: "hi", provider: tc.provider };
			const { runRes, streamRes } = await runDualEndpoints(port, payload);
			assertInvalidProvider(runRes.status, runRes.json.error);
			const parsed = JSON.parse(streamRes.text);
			assertInvalidProvider(streamRes.status, parsed.error);
		});
	}

	test("body containing apiKey is ignored and never reaches factory", async () => {
		let passedOptions;
		app.locals.agentModelFactory = createOptionsCapturingFactory((opts) => {
			passedOptions = opts;
		});
		const payload = {
			apiKey: "secret-key-12345",
			message: "hi",
			model: "gpt-4",
			url: "http://malicious.example.com",
		};
		const { runRes, streamRes } = await runDualEndpoints(port, payload);
		assertDisallowedOptionsIgnored(runRes.status, passedOptions);
		assertDisallowedOptionsIgnored(streamRes.status, passedOptions);
	});

	describe("rate limiting", () => {
		test("third request to /agent/run exceeds max 2 and halts model calls", async () => {
			const callCount = await withCountingLimiter(2, async (p) => {
				await postExpect(postJson, p, { message: "msg1" }, 200);
				await postExpect(postJson, p, { message: "msg2" }, 200);
				const r3 = await postJson(p, "/agent/run", { message: "msg3" });
				assertRateLimitRejected(r3);
			});
			assert.equal(callCount, 2);
		});

		test("third request to /agent/run/stream returns JSON 429 instead of SSE", async () => {
			const callCount = await withCountingLimiter(2, async (p) => {
				const r1 = await postExpect(postStream, p, { message: "m1" }, 200);
				assert.equal(r1.headers.get("content-type"), "text/event-stream");
				await postExpect(postStream, p, { message: "m2" }, 200);
				const r3 = await postExpect(postStream, p, { message: "m3" }, 429);
				const contentType = r3.headers.get("content-type") || "";
				assert.equal(contentType.includes("text/event-stream"), false);
				const body = JSON.parse(r3.text);
				assert.equal(body.error, "Too many requests, retry later");
			});
			assert.equal(callCount, 2);
		});

		test("/agent/run and /agent/run/stream share one budget", async () => {
			await withLimiterServer(2, async (p) => {
				await postExpect(postJson, p, { message: "run" }, 200);
				await postExpect(postStream, p, { message: "stream" }, 200);
				await postExpect(postJson, p, { message: "exceeded" }, 429);
				await postExpect(postStream, p, { message: "exceeded" }, 429);
			});
		});

		test("local mode with skipWhenLocal does not limit requests", async () => {
			await withLimiterServer(
				2,
				async (p) => {
					for (let i = 0; i < 5; i++) {
						const res = await postJson(p, "/agent/run", {
							message: `hi ${i}`,
						});
						assert.equal(res.status, 200);
					}
				},
				{ allowLocalRepos: true, skipLocal: true },
			);
		});

		test("rate limit response headers match standard format", async () => {
			await withLimiterServer(2, async (p) => {
				const r1 = await sendPost(p, "/agent/run", { message: "hi" });
				assertRateLimitHeaders(r1, {
					limit: "2",
					remaining: "1",
					status: 200,
				});

				await postJson(p, "/agent/run", { message: "hi" });
				const r3 = await sendPost(p, "/agent/run", { message: "hi" });
				assertRateLimitHeaders(r3, {
					limit: "2",
					remaining: "0",
					retryAfter: true,
					status: 429,
				});
			});
		});

		test("limited request rejects with 429 before body validation", async () => {
			await withLimiterServer(1, async (p) => {
				const r1 = await postJson(p, "/agent/run", { message: "valid" });
				assert.equal(r1.status, 200);
				const r2 = await postJson(p, "/agent/run", {});
				assertRateLimitRejected(r2);
			});
		});
	});
});
