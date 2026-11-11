import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSimApi } from "../../frontend/src/simApi.js";

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

function mockJsonResponse(status, data, statusText = "OK") {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		text: async () => JSON.stringify(data),
		json: async () => data,
	};
}

function mockTextResponse(status, text, statusText = "Error") {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		text: async () => text,
		json: async () => {
			throw new SyntaxError("Unexpected token in JSON");
		},
	};
}

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
		call: (api) =>
			api.runSim({
				kind: "thermal",
				env: { ambientC: 25 },
				commit: "a1b2c3d",
				inputs: { ir: {} },
			}),
		expectedUrl: "/api/sim/run",
		expectedMethod: "POST",
		expectedBody: {
			kind: "thermal",
			env: { ambientC: 25 },
			commit: "a1b2c3d",
			inputs: { ir: {} },
		},
		responseData: { run: { id: "sim-1" }, issues: [] },
	},
	{
		name: "runErc",
		call: (api) =>
			api.runErc({
				ir: { parts: [] },
				commit: "a1b2c3d",
			}),
		expectedUrl: "/api/erc/run",
		expectedMethod: "POST",
		expectedBody: {
			ir: { parts: [] },
			commit: "a1b2c3d",
		},
		responseData: { issues: [] },
	},
	{
		name: "runAgent",
		call: (api) =>
			api.runAgent({
				message: "check design",
				approved: true,
				maxSteps: 3,
			}),
		expectedUrl: "/api/agent/run",
		expectedMethod: "POST",
		expectedBody: {
			message: "check design",
			approved: true,
			maxSteps: 3,
		},
		responseData: { text: "done", steps: [] },
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
];

describe("createSimApi success cases", () => {
	for (const tc of SUCCESS_CASES) {
		test(`success: ${tc.name}`, async () => {
			const fakeFetch = createFakeFetch(async () =>
				mockJsonResponse(200, tc.responseData),
			);
			const api = createSimApi({ fetchImpl: fakeFetch });
			const res = await tc.call(api);
			assert.equal(res.ok, true);
			assert.deepEqual(res.data, tc.responseData);
			assert.equal(fakeFetch.calls.length, 1);
			assert.equal(fakeFetch.calls[0].url, tc.expectedUrl);
			assert.equal(fakeFetch.calls[0].method, tc.expectedMethod);
			if (tc.expectedBody !== undefined) {
				assert.deepEqual(JSON.parse(fakeFetch.calls[0].body), tc.expectedBody);
			}
		});
	}
});

describe("createSimApi error branches", () => {
	for (const { name, invoke } of METHOD_CALLERS) {
		test(`${name} handles HTTP 400 JSON error`, async () => {
			const payload = { error: "Invalid parameters" };
			const fakeFetch = createFakeFetch(async () =>
				mockJsonResponse(400, payload, "Bad Request"),
			);
			const api = createSimApi({ fetchImpl: fakeFetch });
			const res = await invoke(api);
			assert.equal(res.ok, false);
			assert.equal(res.status, 400);
			assert.equal(res.error, "Invalid parameters");
			assert.deepEqual(res.data, payload);
		});

		test(`${name} handles HTTP 500 non-JSON error`, async () => {
			const fakeFetch = createFakeFetch(async () =>
				mockTextResponse(500, "Internal Server Error", "Server Error"),
			);
			const api = createSimApi({ fetchImpl: fakeFetch });
			const res = await invoke(api);
			assert.equal(res.ok, false);
			assert.equal(res.status, 500);
			assert.equal(res.error, "Internal Server Error");
			assert.equal(res.data, undefined);
		});

		test(`${name} handles network failure without throwing`, async () => {
			const fakeFetch = createFakeFetch(async () => {
				throw new Error("Connection refused");
			});
			const api = createSimApi({ fetchImpl: fakeFetch });
			const res = await invoke(api);
			assert.equal(res.ok, false);
			assert.equal(res.status, 0);
			assert.equal(res.error, "Network error: Connection refused");
		});

		test(`${name} handles abort error without throwing`, async () => {
			const fakeFetch = createFakeFetch(async () => {
				const err = new Error("The operation was aborted");
				err.name = "AbortError";
				throw err;
			});
			const controller = new AbortController();
			const api = createSimApi({ fetchImpl: fakeFetch });
			const res = await invoke(api, { signal: controller.signal });
			assert.equal(res.ok, false);
			assert.equal(res.status, 0);
			assert.equal(res.error, "aborted");
		});

		test(`${name} passes abort signal through to fetch`, async () => {
			const fakeFetch = createFakeFetch(async () => mockJsonResponse(200, {}));
			const controller = new AbortController();
			const api = createSimApi({ fetchImpl: fakeFetch });
			await invoke(api, { signal: controller.signal });
			assert.equal(fakeFetch.calls[0].signal, controller.signal);
		});
	}

	test("runSim handles HTTP 422 with failure run data", async () => {
		const body = {
			error: "Simulation thermal runaway",
			run: { id: "sim-fail", status: "failed" },
		};
		const fakeFetch = createFakeFetch(async () =>
			mockJsonResponse(422, body, "Unprocessable Entity"),
		);
		const api = createSimApi({ fetchImpl: fakeFetch });
		const res = await api.runSim({
			kind: "thermal",
			env: {},
			commit: "c1",
			inputs: {},
		});
		assert.equal(res.ok, false);
		assert.equal(res.status, 422);
		assert.equal(res.error, "Simulation thermal runaway");
		assert.deepEqual(res.data, body);
	});
});

describe("createSimApi configuration and options", () => {
	test("strips trailing slashes from baseUrl", async () => {
		const fakeFetch = createFakeFetch(async () => mockJsonResponse(200, {}));
		const api = createSimApi({
			baseUrl: "https://banana.local:8080///",
			fetchImpl: fakeFetch,
		});
		await api.getKinds();
		assert.equal(
			fakeFetch.calls[0].url,
			"https://banana.local:8080/api/sim/kinds",
		);
	});

	test("sends custom headers and Content-Type: application/json", async () => {
		const fakeFetch = createFakeFetch(async () => mockJsonResponse(200, {}));
		const api = createSimApi({
			headers: { "x-banana-auth": "secret-token" },
			fetchImpl: fakeFetch,
		});
		await api.getKinds();
		assert.deepEqual(fakeFetch.calls[0].headers, {
			"Content-Type": "application/json",
			"x-banana-auth": "secret-token",
		});
	});

	test("runAgent handles optional approved and maxSteps fields", async () => {
		const fakeFetch = createFakeFetch(async () => mockJsonResponse(200, {}));
		const api = createSimApi({ fetchImpl: fakeFetch });
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
		const fakeFetch = createFakeFetch(async () =>
			mockTextResponse(200, "Not a JSON object", "OK"),
		);
		const api = createSimApi({ fetchImpl: fakeFetch });
		const res = await api.getKinds();
		assert.equal(res.ok, false);
		assert.equal(res.status, 200);
		assert.equal(res.error, "Not a JSON object");
	});

	test("uses data.message when data.error is missing", async () => {
		const fakeFetch = createFakeFetch(async () =>
			mockJsonResponse(500, { message: "Internal crash" }),
		);
		const api = createSimApi({ fetchImpl: fakeFetch });
		const res = await api.getKinds();
		assert.equal(res.ok, false);
		assert.equal(res.status, 500);
		assert.equal(res.error, "Internal crash");
	});
});
