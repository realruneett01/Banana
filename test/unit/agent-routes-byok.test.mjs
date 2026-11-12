import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import defaultRouter from "../../backend/src/routes/agent-routes.js";

async function startServer() {
	const app = createApp();
	const server = http.createServer(app);
	const port = await new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
	return {
		app,
		port,
		stop: () => new Promise((resolve) => server.close(resolve)),
	};
}

async function requestEndpoint(port, path, payload, headers = {}) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		body: JSON.stringify(payload),
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		method: "POST",
	});
	const rawText = await res.text();
	let json = {};
	try {
		json = JSON.parse(rawText);
	} catch {
		// Non-JSON response body (e.g. streaming SSE text)
	}
	return { json, rawText, status: res.status };
}

function assertOptionsMatch(actual, expected) {
	assert.ok(actual, "expected factory options to be defined");
	assert.equal(typeof actual, "object");
	for (const [k, v] of Object.entries(expected)) {
		assert.equal(actual[k], v);
	}
}

function assertKeyIgnored(res, actualOptions) {
	assert.equal(res.status, 200);
	assert.equal(actualOptions?.apiKey, undefined);
}

function assertError(res, expectedStatus, expectedError) {
	assert.equal(res.status, expectedStatus);
	assert.ok(res.json !== undefined, "expected json to be defined");
	assert.equal(res.json?.error, expectedError);
}

function assertKeyNeverEchoed(rawText, secretKey) {
	assert.ok(rawText !== undefined, "expected rawText to be defined");
	assert.equal(rawText.includes(secretKey), false);
}

const INVALID_KEY_CASES = [
	{ key: "", name: "empty string" },
	{ key: "12345", name: "5-character key" },
	{ key: "123456789", name: "9-character key" },
	{ key: "key with spaces", name: "whitespace in key" },
	{ key: "key\twith\ttab", name: "tab character in key" },
	{ key: "a".repeat(301), name: "301-character key" },
];

const BAD_MODEL_CASES = [
	{ model: "", name: "empty string" },
	{ model: "qwen 2.5:7b", name: "contains space" },
	{ model: "model;bad", name: "invalid characters" },
	{ model: "a".repeat(81), name: "exceeds 80 chars" },
	{ model: 123, name: "number value" },
	{ model: true, name: "boolean value" },
	{ model: { name: "qwen" }, name: "object value" },
];

const UNKNOWN_PROVIDER_CASES = [
	{ name: "openai", provider: "openai" },
	{ name: "anthropic", provider: "anthropic" },
	{ name: "number", provider: 999 },
];

const REJECTED_REQUEST_CASES = [
	...BAD_MODEL_CASES.map((tc) => ({
		error: "Invalid model",
		name: `bad model (${tc.name})`,
		payload: { message: "test", model: tc.model, provider: "gemini" },
	})),
	...UNKNOWN_PROVIDER_CASES.map((tc) => ({
		error: "Invalid provider",
		name: `unknown provider (${tc.name})`,
		payload: { message: "test", provider: tc.provider },
	})),
];

const VALID_PASSTHROUGH_CASES = [
	{
		expected: {
			apiKey: "test-gemini-key-123456789",
			provider: "gemini",
		},
		headers: { "x-model-api-key": "test-gemini-key-123456789" },
		name: "header key passed through for gemini",
		payload: { message: "test", provider: "gemini" },
	},
	{
		expected: {
			model: "qwen2.5:7b",
			provider: "ollama",
		},
		headers: {},
		name: "provider ollama accepted with model 'qwen2.5:7b'",
		payload: {
			message: "test",
			model: "qwen2.5:7b",
			provider: "ollama",
		},
	},
];

const SECRET_KEY = "SUPER-SECRET-API-KEY-VALUE-ABC-999";

const SECRET_LEAK_CASES = [
	{
		expectedStatus: 200,
		name: "response body never contains secret key",
		path: "/api/agent/run",
		payload: { message: "test", provider: "gemini" },
	},
	{
		expectedStatus: 200,
		name: "stream response never contains secret key",
		path: "/api/agent/run/stream",
		payload: { message: "test", provider: "gemini" },
	},
	{
		expectedStatus: 400,
		name: "error response never leaks secret key from header",
		path: "/api/agent/run",
		payload: { message: "test", model: "invalid model with spaces" },
	},
	{
		expectedStatus: 500,
		name: "throwing model 500 error response never leaks secret key",
		path: "/api/agent/run",
		payload: { message: "test", provider: "gemini" },
		setup: (app) => {
			app.locals.agentModelFactory = () => ({
				generate: async () => {
					throw new Error("Model failure");
				},
			});
		},
	},
];

describe("agent routes BYOK and ollama", () => {
	let harness;
	let capturedOptions;

	before(async () => {
		harness = await startServer();
	});

	after(async () => {
		await harness.stop();
	});

	beforeEach(() => {
		capturedOptions = undefined;
		defaultRouter.limiter?.store?.clear();
		harness.app.locals.agentModelFactory = (opts) => {
			capturedOptions = opts;
			return { generate: async () => ({ steps: 1, text: "ok" }) };
		};
	});

	for (const tc of VALID_PASSTHROUGH_CASES) {
		for (const path of ["/api/agent/run", "/api/agent/run/stream"]) {
			test(`${tc.name} on ${path}`, async () => {
				capturedOptions = undefined;
				const res = await requestEndpoint(
					harness.port,
					path,
					tc.payload,
					tc.headers,
				);
				assert.equal(res.status, 200);
				assert.ok(res.rawText !== undefined);
				assertOptionsMatch(capturedOptions, tc.expected);
			});
		}
	}

	for (const tc of INVALID_KEY_CASES) {
		test(`ignores ${tc.name} and leaves apiKey undefined`, async () => {
			const headers = { "x-model-api-key": tc.key };
			const payload = { message: "test", provider: "gemini" };
			const res = await requestEndpoint(
				harness.port,
				"/api/agent/run",
				payload,
				headers,
			);
			assertKeyIgnored(res, capturedOptions);
			assert.equal(capturedOptions?.provider, "gemini");
			assert.ok(capturedOptions !== undefined);
		});
	}

	for (const tc of REJECTED_REQUEST_CASES) {
		test(`rejects ${tc.name} with 400 on run and stream`, async () => {
			const runRes = await requestEndpoint(
				harness.port,
				"/api/agent/run",
				tc.payload,
			);
			assertError(runRes, 400, tc.error);

			const streamRes = await requestEndpoint(
				harness.port,
				"/api/agent/run/stream",
				tc.payload,
			);
			assertError(streamRes, 400, tc.error);
		});
	}

	for (const tc of SECRET_LEAK_CASES) {
		test(tc.name, async () => {
			if (tc.setup) {
				tc.setup(harness.app);
			}
			const headers = { "x-model-api-key": SECRET_KEY };
			const res = await requestEndpoint(
				harness.port,
				tc.path,
				tc.payload,
				headers,
			);
			assert.equal(res.status, tc.expectedStatus);
			assertKeyNeverEchoed(res.rawText, SECRET_KEY);
		});
	}

	test("apiKey in body or query is ignored", async () => {
		const payload = {
			apiKey: "body-key-should-be-ignored-12345",
			message: "test",
			provider: "gemini",
		};
		const runRes = await requestEndpoint(
			harness.port,
			"/api/agent/run?apiKey=query-key-12345&x-model-api-key=query-key-12345",
			payload,
		);
		assert.equal(runRes.status, 200);
		assert.equal(capturedOptions?.apiKey, undefined);
		assert.equal(capturedOptions?.provider, "gemini");
	});
});
