import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSimApi, parseSseChunk } from "../../frontend/src/simApi.js";

function createFakeFetch(handler) {
	const calls = [];
	const fake = async (url, options = {}) => {
		calls.push({
			url,
			method: options.method || "GET",
			headers: options.headers,
			body: options.body,
			signal: options.signal,
		});
		return handler(url, options);
	};
	fake.calls = calls;
	return fake;
}

function createMockResponse(status, statusText, textFn, jsonFn) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		text: textFn,
		json: jsonFn,
	};
}

function mockJsonResponse(status, data, statusText = "OK") {
	return createMockResponse(
		status,
		statusText,
		async () => JSON.stringify(data),
		async () => data,
	);
}

function mockTextResponse(status, text, statusText = "Error") {
	return createMockResponse(
		status,
		statusText,
		async () => text,
		async () => {
			throw new SyntaxError("Unexpected token in JSON");
		},
	);
}

const mockOkHandler = async () => mockJsonResponse(200, {});

function createClient(handler, options = {}) {
	const fakeFetch = createFakeFetch(handler);
	const api = createSimApi({ ...options, fetchImpl: fakeFetch });
	return { api, fakeFetch };
}

function assertFailure(res, expected) {
	assert.equal(res.ok, false);
	assert.equal(res.status, expected.status);
	assert.equal(res.error, expected.error);
	if ("data" in expected) {
		assert.deepEqual(res.data, expected.data);
	}
}

function assertCall(fakeFetch, expectedUrl, expectedMethod, expectedBody) {
	assert.equal(fakeFetch.calls.length, 1);
	assert.equal(fakeFetch.calls[0].url, expectedUrl);
	assert.equal(fakeFetch.calls[0].method, expectedMethod);
	if (expectedBody !== undefined) {
		assert.deepEqual(JSON.parse(fakeFetch.calls[0].body), expectedBody);
	}
}

const SIM_RUN_INPUT = {
	kind: "thermal",
	env: { ambientC: 25 },
	commit: "a1b2c3d",
	inputs: { ir: {} },
};

const ERC_RUN_INPUT = {
	ir: { parts: [] },
	commit: "a1b2c3d",
};

const AGENT_RUN_INPUT = {
	message: "check design",
	approved: true,
	maxSteps: 3,
};

const COMPARE_INPUT = {
	before: "c1",
	after: "c2",
	envId: "env-1",
	kind: "ir-drop",
};

const SUCCESS_CASES = [
	{
		name: "getKinds",
		call: (api) => api.getKinds(),
		expectedUrl: "/api/sim/kinds",
		expectedMethod: "GET",
		expectedBody: undefined,
		responseData: { kinds: ["ir-drop", "thermal"] },
	},
	{
		name: "runSim",
		call: (api) => api.runSim(SIM_RUN_INPUT),
		expectedUrl: "/api/sim/run",
		expectedMethod: "POST",
		expectedBody: SIM_RUN_INPUT,
		responseData: { run: { id: "sim-1" }, issues: [] },
	},
	{
		name: "runErc",
		call: (api) => api.runErc(ERC_RUN_INPUT),
		expectedUrl: "/api/erc/run",
		expectedMethod: "POST",
		expectedBody: ERC_RUN_INPUT,
		responseData: { issues: [] },
	},
	{
		name: "runAgent",
		call: (api) => api.runAgent(AGENT_RUN_INPUT),
		expectedUrl: "/api/agent/run",
		expectedMethod: "POST",
		expectedBody: AGENT_RUN_INPUT,
		responseData: { text: "done", steps: [] },
	},
	{
		name: "listRuns",
		call: (api) =>
			api.listRuns({
				commit: "a1b2c3d",
				envId: "env-prod",
				kind: "thermal",
			}),
		expectedUrl: "/api/sim/runs?commit=a1b2c3d&envId=env-prod&kind=thermal",
		expectedMethod: "GET",
		expectedBody: undefined,
		responseData: { runs: [{ id: "run-1", commit: "a1b2c3d" }] },
	},
	{
		name: "getRun",
		call: (api) => api.getRun("run-42"),
		expectedUrl: "/api/sim/runs/run-42",
		expectedMethod: "GET",
		expectedBody: undefined,
		responseData: { run: { id: "run-42" }, issues: [] },
	},
	{
		name: "compareCommits",
		call: (api) => api.compareCommits(COMPARE_INPUT),
		expectedUrl: "/api/sim/compare",
		expectedMethod: "POST",
		expectedBody: COMPARE_INPUT,
		responseData: { fixed: [], stillOpen: [], new: [] },
	},
	{
		name: "setIssueStatus",
		call: (api) => api.setIssueStatus("issue-99", "fixed"),
		expectedUrl: "/api/issues/issue-99",
		expectedMethod: "PATCH",
		expectedBody: { status: "fixed" },
		responseData: { ok: true },
	},
];

const METHOD_CALLERS = [
	{ name: "getKinds", invoke: (api, opt) => api.getKinds(opt) },
	{
		name: "runSim",
		invoke: (api, opt) =>
			api.runSim({ kind: "thermal", env: {}, commit: "c0", inputs: {} }, opt),
	},
	{
		name: "runErc",
		invoke: (api, opt) => api.runErc({ ir: {}, commit: "c0" }, opt),
	},
	{
		name: "runAgent",
		invoke: (api, opt) => api.runAgent({ message: "hi" }, opt),
	},
	{
		name: "listRuns",
		invoke: (api, opt) => api.listRuns({ commit: "c0" }, opt),
	},
	{
		name: "getRun",
		invoke: (api, opt) => api.getRun("r0", opt),
	},
	{
		name: "compareCommits",
		invoke: (api, opt) =>
			api.compareCommits({ before: "c0", after: "c1" }, opt),
	},
	{
		name: "setIssueStatus",
		invoke: (api, opt) => api.setIssueStatus("i0", "fixed", opt),
	},
];

const ENCODING_CASES = [
	{
		name: "listRuns encodes query parameters and omits unprovided filters",
		call: (api) =>
			api.listRuns({
				commit: "feat/branch 1",
				kind: "ir&drop",
			}),
		expectedUrl: "/api/sim/runs?commit=feat%2Fbranch+1&kind=ir%26drop",
		expectedMethod: "GET",
	},
	{
		name: "listRuns with no filters uses clean endpoint without query string",
		call: (api) => api.listRuns(),
		expectedUrl: "/api/sim/runs",
		expectedMethod: "GET",
	},
	{
		name: "getRun encodes id using encodeURIComponent",
		call: (api) => api.getRun("sim/test#1"),
		expectedUrl: "/api/sim/runs/sim%2Ftest%231",
		expectedMethod: "GET",
	},
	{
		name: "setIssueStatus encodes id and uses PATCH method",
		call: (api) => api.setIssueStatus("issue/special?key=1", "wontfix"),
		expectedUrl: "/api/issues/issue%2Fspecial%3Fkey%3D1",
		expectedMethod: "PATCH",
	},
];

const JSON_ERROR_PAYLOAD = { error: "Invalid parameters" };

const ERROR_BRANCH_CASES = [
	{
		suffix: "handles HTTP 400 JSON error",
		handler: async () =>
			mockJsonResponse(400, JSON_ERROR_PAYLOAD, "Bad Request"),
		expected: {
			status: 400,
			error: "Invalid parameters",
			data: JSON_ERROR_PAYLOAD,
		},
	},
	{
		suffix: "handles HTTP 500 non-JSON error",
		handler: async () =>
			mockTextResponse(500, "Internal Server Error", "Server Error"),
		expected: {
			status: 500,
			error: "Internal Server Error",
			data: undefined,
		},
	},
	{
		suffix: "handles network failure without throwing",
		handler: async () => {
			throw new Error("Connection refused");
		},
		expected: {
			status: 0,
			error: "Network error: Connection refused",
		},
	},
	{
		suffix: "handles abort error without throwing",
		handler: async () => {
			const err = new Error("The operation was aborted");
			err.name = "AbortError";
			throw err;
		},
		withSignal: true,
		expected: {
			status: 0,
			error: "aborted",
		},
	},
];

describe("createSimApi success cases", () => {
	for (const tc of SUCCESS_CASES) {
		test(`success: ${tc.name}`, async () => {
			const { api, fakeFetch } = createClient(async () =>
				mockJsonResponse(200, tc.responseData),
			);
			const res = await tc.call(api);
			assert.equal(res.ok, true);
			assert.deepEqual(res.data, tc.responseData);
			assertCall(fakeFetch, tc.expectedUrl, tc.expectedMethod, tc.expectedBody);
		});
	}
});

describe("createSimApi encoding and method verification", () => {
	for (const tc of ENCODING_CASES) {
		test(tc.name, async () => {
			const { api, fakeFetch } = createClient(mockOkHandler);
			await tc.call(api);
			assertCall(fakeFetch, tc.expectedUrl, tc.expectedMethod);
		});
	}
});

function registerMethodErrorTests(name, invoke) {
	for (const ec of ERROR_BRANCH_CASES) {
		test(`${name} ${ec.suffix}`, async () => {
			const { api } = createClient(ec.handler);
			const opt = ec.withSignal
				? { signal: new AbortController().signal }
				: undefined;
			const res = await invoke(api, opt);
			assertFailure(res, ec.expected);
		});
	}

	test(`${name} passes abort signal through to fetch`, async () => {
		const controller = new AbortController();
		const { api, fakeFetch } = createClient(mockOkHandler);
		await invoke(api, { signal: controller.signal });
		assert.equal(fakeFetch.calls[0].signal, controller.signal);
	});
}

describe("createSimApi error branches", () => {
	for (const { name, invoke } of METHOD_CALLERS) {
		registerMethodErrorTests(name, invoke);
	}

	test("runSim handles HTTP 422 with failure run data", async () => {
		const body = {
			error: "Simulation thermal runaway",
			run: { id: "sim-fail", status: "failed" },
		};
		const { api } = createClient(async () =>
			mockJsonResponse(422, body, "Unprocessable Entity"),
		);
		const res = await api.runSim({
			kind: "thermal",
			env: {},
			commit: "c1",
			inputs: {},
		});
		assertFailure(res, {
			status: 422,
			error: "Simulation thermal runaway",
			data: body,
		});
	});
});

describe("createSimApi configuration and options", () => {
	test("strips trailing slashes from baseUrl", async () => {
		const { api, fakeFetch } = createClient(mockOkHandler, {
			baseUrl: "https://banana.local:8080///",
		});
		await api.getKinds();
		assert.equal(
			fakeFetch.calls[0].url,
			"https://banana.local:8080/api/sim/kinds",
		);
	});

	test("sends custom headers and Content-Type: application/json", async () => {
		const { api, fakeFetch } = createClient(mockOkHandler, {
			headers: { "x-banana-auth": "secret-token" },
		});
		await api.getKinds();
		assert.deepEqual(fakeFetch.calls[0].headers, {
			"Content-Type": "application/json",
			"x-banana-auth": "secret-token",
		});
	});

	test("runAgent handles optional approved and maxSteps fields", async () => {
		const { api, fakeFetch } = createClient(mockOkHandler);
		await api.runAgent({ message: "step1" });
		assert.deepEqual(JSON.parse(fakeFetch.calls[0].body), {
			message: "step1",
		});

		await api.runAgent({ message: "step2", approved: false, maxSteps: 5 });
		assert.deepEqual(JSON.parse(fakeFetch.calls[1].body), {
			message: "step2",
			approved: false,
			maxSteps: 5,
		});
	});

	test("handles non-JSON body on 200 response", async () => {
		const { api } = createClient(async () =>
			mockTextResponse(200, "Not a JSON object", "OK"),
		);
		const res = await api.getKinds();
		assertFailure(res, { status: 200, error: "Not a JSON object" });
	});

	test("uses data.message when data.error is missing", async () => {
		const { api } = createClient(async () =>
			mockJsonResponse(500, { message: "Internal crash" }),
		);
		const res = await api.getKinds();
		assertFailure(res, { status: 500, error: "Internal crash" });
	});
});

function mockStreamResponse(status, chunks, statusText = "OK") {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(
					typeof chunk === "string" ? encoder.encode(chunk) : chunk,
				);
			}
			controller.close();
		},
	});
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		body: stream,
		text: async () => chunks.join(""),
		json: async () => {
			throw new SyntaxError("Not JSON");
		},
	};
}

const PARSE_SSE_CASES = [
	{
		name: "single frame",
		input: 'event: step\ndata: {"action":"inspect"}\n\n',
		expected: {
			frames: [{ event: "step", data: { action: "inspect" } }],
			rest: "",
		},
	},
	{
		name: "two frames in one chunk",
		input: 'event: step\ndata: {"n":1}\n\nevent: step\ndata: {"n":2}\n\n',
		expected: {
			frames: [
				{ event: "step", data: { n: 1 } },
				{ event: "step", data: { n: 2 } },
			],
			rest: "",
		},
	},
	{
		name: "CRLF line endings",
		input: 'event: step\r\ndata: {"ok":true}\r\n\r\n',
		expected: {
			frames: [{ event: "step", data: { ok: true } }],
			rest: "",
		},
	},
	{
		name: "comment lines ignored",
		input: ': keepalive\nevent: step\n: comment\ndata: {"n":1}\n\n',
		expected: {
			frames: [{ event: "step", data: { n: 1 } }],
			rest: "",
		},
	},
	{
		name: "unknown event ignored",
		input:
			'event: ping\ndata: {"n":0}\n\nevent: result\ndata: {"text":"done"}\n\n',
		expected: {
			frames: [{ event: "result", data: { text: "done" } }],
			rest: "",
		},
	},
];

describe("parseSseChunk incremental parser", () => {
	for (const tc of PARSE_SSE_CASES) {
		test(`parseSseChunk: ${tc.name}`, () => {
			const res = parseSseChunk(tc.input);
			assert.deepEqual(res, tc.expected);
		});
	}

	test("parseSseChunk: frame split across chunks", () => {
		const chunk1 = 'event: step\ndata: {"status":';
		const res1 = parseSseChunk(chunk1);
		assert.deepEqual(res1.frames, []);
		assert.equal(res1.rest, chunk1);

		const chunk2 = '"ok"}\n\n';
		const res2 = parseSseChunk(res1.rest + chunk2);
		assert.deepEqual(res2.frames, [{ event: "step", data: { status: "ok" } }]);
		assert.equal(res2.rest, "");
	});
});

describe("runAgentStream streaming client", () => {
	test("happy path calls onStep in order and resolves with result data", async () => {
		const chunks = [
			'event: step\ndata: {"seq":1}\n\n',
			'event: step\ndata: {"seq":2}\n\n',
			'event: result\ndata: {"text":"finished","events":[{"seq":1},{"seq":2}]}\n\n',
		];
		const { api } = createClient(async () => mockStreamResponse(200, chunks));
		const steps = [];
		const res = await api.runAgentStream(
			{ message: "stream test" },
			{ onStep: (ev) => steps.push(ev) },
		);
		assert.equal(res.ok, true);
		assert.deepEqual(steps, [{ seq: 1 }, { seq: 2 }]);
		assert.equal(res.data.text, "finished");
	});

	test("handles error frame", async () => {
		const chunks = [
			'event: step\ndata: {"seq":1}\n\n',
			'event: error\ndata: {"error":"Tool execution crashed"}\n\n',
		];
		const { api } = createClient(async () => mockStreamResponse(200, chunks));
		const res = await api.runAgentStream({ message: "error test" });
		assert.equal(res.ok, false);
		assert.equal(res.error, "Tool execution crashed");
	});

	test("handles non-200 JSON error", async () => {
		const { api } = createClient(async () =>
			mockJsonResponse(
				400,
				{ error: "Prompt validation failed" },
				"Bad Request",
			),
		);
		const res = await api.runAgentStream({ message: "" });
		assert.equal(res.ok, false);
		assert.equal(res.status, 400);
		assert.equal(res.error, "Prompt validation failed");
	});

	test("handles malformed JSON in frame", async () => {
		const chunks = ["event: step\ndata: {not-valid-json\n\n"];
		const { api } = createClient(async () => mockStreamResponse(200, chunks));
		const res = await api.runAgentStream({ message: "bad json" });
		assert.equal(res.ok, false);
		assert.ok(typeof res.error === "string" && res.error.length > 0);
	});

	test("handles stream ends early without result frame", async () => {
		const chunks = ['event: step\ndata: {"seq":1}\n\n'];
		const { api } = createClient(async () => mockStreamResponse(200, chunks));
		const res = await api.runAgentStream({ message: "early end" });
		assert.equal(res.ok, false);
		assert.ok(typeof res.error === "string" && res.error.length > 0);
	});

	test("falls back to runAgent on 404", async () => {
		const { api, fakeFetch } = createClient(async (url) => {
			if (url.endsWith("/stream")) {
				return mockJsonResponse(404, { error: "Not Found" }, "Not Found");
			}
			return mockJsonResponse(200, { text: "fallback success" });
		});
		const res = await api.runAgentStream({ message: "fallback test" });
		assert.equal(res.ok, true);
		assert.equal(res.data.text, "fallback success");
		assert.equal(fakeFetch.calls.length, 2);
		assert.ok(fakeFetch.calls[0].url.endsWith("/api/agent/run/stream"));
		assert.ok(fakeFetch.calls[1].url.endsWith("/api/agent/run"));
	});

	test("falls back to runAgent on 405", async () => {
		const { api, fakeFetch } = createClient(async (url) => {
			if (url.endsWith("/stream")) {
				return mockJsonResponse(
					405,
					{ error: "Method Not Allowed" },
					"Method Not Allowed",
				);
			}
			return mockJsonResponse(200, { text: "fallback from 405" });
		});
		const res = await api.runAgentStream({ message: "fallback 405 test" });
		assert.equal(res.ok, true);
		assert.equal(res.data.text, "fallback from 405");
		assert.equal(fakeFetch.calls.length, 2);
	});

	test("passes provider in request body for runAgent and runAgentStream", async () => {
		const { api, fakeFetch } = createClient(async () =>
			mockStreamResponse(200, ['event: result\ndata: {"text":"ok"}\n\n']),
		);
		await api.runAgent({ message: "p1", provider: "anthropic" });
		assert.equal(JSON.parse(fakeFetch.calls[0].body).provider, "anthropic");

		await api.runAgentStream({ message: "p2", provider: "google" });
		assert.equal(JSON.parse(fakeFetch.calls[1].body).provider, "google");
	});

	test("handles abort signal without throwing", async () => {
		const controller = new AbortController();
		controller.abort();
		const { api } = createClient(async () =>
			mockStreamResponse(200, ["event: result\ndata: {}\n\n"]),
		);
		const res = await api.runAgentStream(
			{ message: "aborted" },
			{ signal: controller.signal },
		);
		assert.equal(res.ok, false);
		assert.equal(res.error, "aborted");
	});
});
