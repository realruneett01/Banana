import assert from "node:assert/strict";
import http from "node:http";
import { describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createGithubDeviceRouter } from "../../backend/src/routes/github-device-routes.js";

const DEFAULT_CLIENT_ID = "Ov23liZc6GZz7Cg8Y1sZ";
const CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

function mockResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	};
}

function createFakeFetch(handler) {
	const calls = [];
	const fn = async (url, options) => {
		calls.push({ url, options });
		return handler(url, options);
	};
	fn.calls = calls;
	return fn;
}

function createTestServer(router) {
	const app = express();
	app.use(express.json());
	app.use("/api", router);
	const server = http.createServer(app);
	return {
		start: () =>
			new Promise((resolve) => {
				server.listen(0, "127.0.0.1", () => {
					resolve(server.address().port);
				});
			}),
		stop: () =>
			new Promise((resolve) => {
				server.close(resolve);
			}),
	};
}

async function withServer(router, fn) {
	const testSrv = createTestServer(router);
	const port = await testSrv.start();
	try {
		await fn(port);
	} finally {
		await testSrv.stop();
	}
}

async function withMultiServer(routers, fn) {
	const app = express();
	app.use(express.json());
	for (const r of routers) {
		app.use("/api", r);
	}
	const server = http.createServer(app);
	const port = await new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve(server.address().port));
	});
	try {
		await fn(port);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function postApi(port, path, body = {}) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, headers: res.headers, data };
}

function assertJsonResponse(res, expectedStatus, expectedData) {
	assert.equal(res.status, expectedStatus);
	assert.deepEqual(res.data, expectedData);
	assert.equal(res.headers.get("cache-control"), "no-store");
}

function assertFetchCall(call, expectedUrl, expectedPayload) {
	assert.equal(call.url, expectedUrl);
	assert.equal(call.options.redirect, "error");
	assert.ok(call.options.signal);
	assert.deepEqual(JSON.parse(call.options.body), expectedPayload);
}

describe("GitHub Device Flow Relay Routes", () => {
	test("code endpoint passes through GitHub response with default client_id", async () => {
		const payload = {
			device_code: "dev_123",
			user_code: "WDJB-MJHT",
			verification_uri: "https://github.com/login/device",
			expires_in: 900,
			interval: 5,
		};
		const fakeFetch = createFakeFetch(async () => mockResponse(200, payload));
		const router = createGithubDeviceRouter({ fetchImpl: fakeFetch });

		await withServer(router, async (port) => {
			const res = await postApi(port, "/api/github/device/code", {});
			assertJsonResponse(res, 200, payload);
			assert.equal(fakeFetch.calls.length, 1);
			assertFetchCall(fakeFetch.calls[0], CODE_URL, {
				client_id: DEFAULT_CLIENT_ID,
				scope: "repo,read:user",
			});
		});
	});

	test("code endpoint uses custom client_id and ignores client_id or url in request body", async () => {
		const fakeFetch = createFakeFetch(async () =>
			mockResponse(200, { device_code: "dev_abc" }),
		);
		const customId = "custom_client_id_456";
		const router = createGithubDeviceRouter({
			fetchImpl: fakeFetch,
			clientId: customId,
		});

		await withServer(router, async (port) => {
			const maliciousBody = {
				client_id: "evil_id",
				url: "https://evil.com/login",
				extra: "drop",
			};
			const res = await postApi(port, "/api/github/device/code", maliciousBody);
			assert.equal(res.status, 200);

			const sent = JSON.parse(fakeFetch.calls[0].options.body);
			assert.equal(sent.client_id, customId);
			assert.equal(sent.url, undefined);
		});
	});

	test("token endpoint validates device_code: rejects bad chars, empty, too long, missing", async () => {
		const fakeFetch = createFakeFetch(async () =>
			mockResponse(200, { access_token: "gho_test" }),
		);
		const router = createGithubDeviceRouter({ fetchImpl: fakeFetch });

		const invalidCases = [
			{},
			{ device_code: "" },
			{ device_code: "   " },
			{ device_code: "bad code spaces" },
			{ device_code: "bad;semi" },
			{ device_code: "bad/slash" },
			{ device_code: "bad?query" },
			{ device_code: "a".repeat(101) },
			{ device_code: 12345 },
			{ device_code: null },
		];

		await withServer(router, async (port) => {
			for (const body of invalidCases) {
				const res = await postApi(port, "/api/github/device/token", body);
				assert.equal(res.status, 400);
				assert.equal(res.headers.get("cache-control"), "no-store");
			}
			assert.equal(fakeFetch.calls.length, 0);
		});
	});

	test("token endpoint accepts valid device_code and passes through authorization_pending", async () => {
		const pendingPayload = {
			error: "authorization_pending",
			error_description: "The authorization request is still pending.",
		};
		const fakeFetch = createFakeFetch(async () =>
			mockResponse(200, pendingPayload),
		);
		const router = createGithubDeviceRouter({ fetchImpl: fakeFetch });

		await withServer(router, async (port) => {
			const validCode = "Valid_Code-123";
			const res = await postApi(port, "/api/github/device/token", {
				device_code: validCode,
			});
			assertJsonResponse(res, 200, pendingPayload);
			assert.equal(fakeFetch.calls.length, 1);
			assertFetchCall(fakeFetch.calls[0], TOKEN_URL, {
				client_id: DEFAULT_CLIENT_ID,
				device_code: validCode,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			});
		});
	});

	test("token endpoint passes through access_token and ignores body client_id or url", async () => {
		const tokenPayload = {
			access_token: "gho_mock_token_xyz",
			token_type: "bearer",
			scope: "repo,read:user",
		};
		const fakeFetch = createFakeFetch(async () =>
			mockResponse(200, tokenPayload),
		);
		const router = createGithubDeviceRouter({ fetchImpl: fakeFetch });

		await withServer(router, async (port) => {
			const res = await postApi(port, "/api/github/device/token", {
				device_code: "valid-device-code",
				client_id: "attacker_id",
				url: "https://attacker.site",
				grant_type: "password",
			});
			assertJsonResponse(res, 200, tokenPayload);

			const sent = JSON.parse(fakeFetch.calls[0].options.body);
			assert.equal(sent.client_id, DEFAULT_CLIENT_ID);
			assert.equal(sent.device_code, "valid-device-code");
			assert.equal(sent.url, undefined);
		});
	});

	test("upstream non-2xx status is preserved", async () => {
		const statusScenarios = [
			{
				path: "/api/github/device/code",
				body: {},
				status: 403,
				payload: { error: "unsupported_grant_type" },
			},
			{
				path: "/api/github/device/token",
				body: { device_code: "some-code" },
				status: 400,
				payload: { error: "expired_token" },
			},
		];

		for (const scenario of statusScenarios) {
			const fakeFetch = createFakeFetch(async () =>
				mockResponse(scenario.status, scenario.payload),
			);
			const router = createGithubDeviceRouter({ fetchImpl: fakeFetch });
			await withServer(router, async (port) => {
				const res = await postApi(port, scenario.path, scenario.body);
				assertJsonResponse(res, scenario.status, scenario.payload);
			});
		}
	});

	test("network error or timeout in upstream fetch returns 502 GitHub unreachable", async () => {
		const endpoints = [
			["/api/github/device/code", {}],
			["/api/github/device/token", { device_code: "some-code" }],
		];
		const failingFetch = createFakeFetch(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		const router = createGithubDeviceRouter({ fetchImpl: failingFetch });

		await withServer(router, async (port) => {
			for (const [path, body] of endpoints) {
				const res = await postApi(port, path, body);
				assertJsonResponse(res, 502, { error: "GitHub unreachable" });
			}
		});
	});

	test("rate limit -> 429 on the 31st request in a minute across endpoints", async () => {
		let mockNow = 10000;
		const fakeFetch = createFakeFetch(async () =>
			mockResponse(200, { ok: true }),
		);
		const router = createGithubDeviceRouter({
			fetchImpl: fakeFetch,
			now: () => mockNow,
		});

		await withServer(router, async (port) => {
			for (let i = 0; i < 15; i++) {
				const rCode = await postApi(port, "/api/github/device/code", {});
				assert.equal(rCode.status, 200);
				const rToken = await postApi(port, "/api/github/device/token", {
					device_code: "code123",
				});
				assert.equal(rToken.status, 200);
			}

			const res31 = await postApi(port, "/api/github/device/code", {});
			assert.equal(res31.status, 429);
			assert.equal(res31.headers.get("cache-control"), "no-store");

			mockNow += 61000;
			const resAfterWindow = await postApi(port, "/api/github/device/code", {});
			assert.equal(resAfterWindow.status, 200);
		});
	});

	test("createApp integration: mounts github device routes under /api", async () => {
		const app = createApp();
		const server = http.createServer(app);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = server.address().port;

		try {
			const res = await postApi(port, "/api/github/device/token", {});
			assert.equal(res.status, 400);
			assert.equal(res.headers.get("cache-control"), "no-store");
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	test("does not rate-limit or add no-store header to subsequent /api routes", async () => {
		const dummyRouter = express.Router();
		dummyRouter.get("/dummy", (_req, res) => res.json({ ok: true }));
		const fakeFetch = createFakeFetch(async () =>
			mockResponse(200, { ok: true }),
		);
		const deviceRouter = createGithubDeviceRouter({ fetchImpl: fakeFetch });

		await withMultiServer([deviceRouter, dummyRouter], async (port) => {
			for (let i = 0; i < 40; i++) {
				const res = await fetch(`http://127.0.0.1:${port}/api/dummy`);
				assert.equal(res.status, 200);
				assert.notEqual(res.headers.get("cache-control"), "no-store");
			}

			for (let i = 0; i < 30; i++) {
				const res = await postApi(port, "/api/github/device/code", {});
				assert.equal(res.status, 200);
				assert.equal(res.headers.get("cache-control"), "no-store");
			}
			const res31 = await postApi(port, "/api/github/device/code", {});
			assert.equal(res31.status, 429);
			assert.equal(res31.headers.get("cache-control"), "no-store");
		});
	});
});
