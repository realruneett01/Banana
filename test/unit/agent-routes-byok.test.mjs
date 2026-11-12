import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import defaultRouter from "../../backend/src/routes/agent-routes.js";

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve(server.address().port);
		});
	});
}

function closeServer(server) {
	return new Promise((resolve) => server.close(resolve));
}

async function sendPost(port, path, payload, headers = {}) {
	return fetch(`http://127.0.0.1:${port}${path}`, {
		body: JSON.stringify(payload),
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		method: "POST",
	});
}

async function postJson(port, path, payload, headers) {
	const res = await sendPost(port, path, payload, headers);
	const text = await res.text();
	const json = text ? JSON.parse(text) : {};
	return { json, rawText: text, status: res.status };
}

async function postStream(port, path, payload, headers) {
	const res = await sendPost(port, path, payload, headers);
	const text = await res.text();
	return { rawText: text, status: res.status };
}

function assertOptionsMatch(actual, expected) {
	assert.ok(actual, "expected factory options to be defined");
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
	assert.equal(res.json?.error, expectedError);
}

function assertKeyNeverEchoed(rawText, secretKey) {
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

describe("agent routes BYOK and ollama", () => {
	let app;
	let server;
	let port;
	let capturedOptions;

	before(async () => {
		app = createApp();
		server = http.createServer(app);
		port = await listen(server);
	});

	after(async () => {
		await closeServer(server);
	});

	beforeEach(() => {
		capturedOptions = undefined;
		defaultRouter.limiter?.store?.clear();
		app.locals.agentModelFactory = (opts) => {
			capturedOptions = opts;
			return { generate: async () => ({ steps: 1, text: "ok" }) };
		};
	});

	test("header key passed through for gemini on run and stream", async () => {
		const key = "test-gemini-key-123456789";
		const headers = { "x-model-api-key": key };
		const payload = { message: "test", provider: "gemini" };

		const runRes = await postJson(port, "/api/agent/run", payload, headers);
		assert.equal(runRes.status, 200);
		assertOptionsMatch(capturedOptions, { apiKey: key, provider: "gemini" });

		capturedOptions = undefined;
		const streamRes = await postStream(
			port,
			"/api/agent/run/stream",
			payload,
			headers,
		);
		assert.equal(streamRes.status, 200);
		assertOptionsMatch(capturedOptions, { apiKey: key, provider: "gemini" });
	});

	for (const tc of INVALID_KEY_CASES) {
		test(`ignores ${tc.name} and leaves apiKey undefined`, async () => {
			const headers = { "x-model-api-key": tc.key };
			const payload = { message: "test", provider: "gemini" };
			const res = await postJson(port, "/api/agent/run", payload, headers);
			assertKeyIgnored(res, capturedOptions);
			assert.equal(capturedOptions?.provider, "gemini");
		});
	}

	test("provider ollama accepted with model 'qwen2.5:7b' on run and stream", async () => {
		const payload = {
			message: "test",
			model: "qwen2.5:7b",
			provider: "ollama",
		};

		const runRes = await postJson(port, "/api/agent/run", payload);
		assert.equal(runRes.status, 200);
		assertOptionsMatch(capturedOptions, {
			model: "qwen2.5:7b",
			provider: "ollama",
		});

		capturedOptions = undefined;
		const streamRes = await postStream(port, "/api/agent/run/stream", payload);
		assert.equal(streamRes.status, 200);
		assertOptionsMatch(capturedOptions, {
			model: "qwen2.5:7b",
			provider: "ollama",
		});
	});

	for (const tc of BAD_MODEL_CASES) {
		test(`rejects bad model (${tc.name}) with 400 on run and stream`, async () => {
			const payload = { message: "test", model: tc.model, provider: "gemini" };
			const runRes = await postJson(port, "/api/agent/run", payload);
			assertError(runRes, 400, "Invalid model");

			const streamRes = await postJson(port, "/api/agent/run/stream", payload);
			assertError(streamRes, 400, "Invalid model");
		});
	}

	for (const tc of UNKNOWN_PROVIDER_CASES) {
		test(`rejects unknown provider (${tc.name}) with 400 on run and stream`, async () => {
			const payload = { message: "test", provider: tc.provider };
			const runRes = await postJson(port, "/api/agent/run", payload);
			assertError(runRes, 400, "Invalid provider");

			const streamRes = await postJson(port, "/api/agent/run/stream", payload);
			assertError(streamRes, 400, "Invalid provider");
		});
	}

	test("response body and stream never contain secret key", async () => {
		const secret = "SUPER-SECRET-API-KEY-VALUE-ABC-999";
		const headers = { "x-model-api-key": secret };
		const payload = { message: "test", provider: "gemini" };

		const runRes = await postJson(port, "/api/agent/run", payload, headers);
		assert.equal(runRes.status, 200);
		assertKeyNeverEchoed(runRes.rawText, secret);

		const streamRes = await postStream(
			port,
			"/api/agent/run/stream",
			payload,
			headers,
		);
		assert.equal(streamRes.status, 200);
		assertKeyNeverEchoed(streamRes.rawText, secret);
	});

	test("error response never leaks secret key from header", async () => {
		const secret = "SUPER-SECRET-API-KEY-VALUE-ABC-999";
		const headers = { "x-model-api-key": secret };
		const payload = { message: "test", model: "invalid model with spaces" };

		const runRes = await postJson(port, "/api/agent/run", payload, headers);
		assert.equal(runRes.status, 400);
		assertKeyNeverEchoed(runRes.rawText, secret);
	});

	test("throwing model 500 error response never leaks secret key", async () => {
		const secret = "SUPER-SECRET-API-KEY-VALUE-ABC-999";
		const headers = { "x-model-api-key": secret };
		app.locals.agentModelFactory = () => ({
			generate: async () => {
				throw new Error("Model failure");
			},
		});
		const payload = { message: "test", provider: "gemini" };

		const runRes = await postJson(port, "/api/agent/run", payload, headers);
		assert.equal(runRes.status, 500);
		assertKeyNeverEchoed(runRes.rawText, secret);
	});

	test("apiKey in body or query is ignored", async () => {
		const payload = {
			apiKey: "body-key-should-be-ignored-12345",
			message: "test",
			provider: "gemini",
		};
		const runRes = await postJson(
			port,
			"/api/agent/run?apiKey=query-key-12345&x-model-api-key=query-key-12345",
			payload,
		);
		assert.equal(runRes.status, 200);
		assert.equal(capturedOptions?.apiKey, undefined);
	});
});
