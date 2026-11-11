import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";

describe("API Security and Hardening (Phase 7 / T7.3)", () => {
	const TEST_SECRET = "banana-test-per-launch-secret-xyz123";
	let server;
	let testPort;

	function sendHttpRequest({ path = "/api/health-check", headers = {} }) {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{
					hostname: "127.0.0.1",
					port: testPort,
					path,
					method: "GET",
					headers,
				},
				(res) => {
					let data = "";
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						resolve({
							status: res.statusCode,
							body: parseJsonOrNull(data),
							raw: data,
						});
					});
				},
			);
			req.on("error", reject);
			req.end();
		});
	}

	before(async () => {
		const app = createApp({
			apiSecret: TEST_SECRET,
			validateHost: (host) => {
				return (
					host === `127.0.0.1:${testPort}` || host === `localhost:${testPort}`
				);
			},
		});

		await new Promise((resolve) => {
			server = app.listen(0, "127.0.0.1", () => {
				testPort = server.address().port;
				resolve();
			});
		});
	});

	after(async () => {
		if (server) {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	// Each case: auth header (undefined = omitted), Host prefix, expected status, and the body check.
	const CASES = [
		{
			name: "rejects API request without x-banana-auth header (401 Unauthorized)",
			auth: undefined,
			host: "127.0.0.1",
			status: 401,
			error: /Unauthorized/,
		},
		{
			name: "rejects API request with wrong x-banana-auth header (401 Unauthorized)",
			auth: "wrong-secret-token",
			host: "127.0.0.1",
			status: 401,
			error: /Unauthorized/,
		},
		{
			name: "accepts API request with valid x-banana-auth header (200 OK)",
			auth: TEST_SECRET,
			host: "127.0.0.1",
			status: 200,
		},
		{
			name: "blocks DNS rebinding attack with invalid Host header (403 Forbidden)",
			auth: TEST_SECRET,
			host: "attacker-evil-site.com",
			status: 403,
			error: /Forbidden: Invalid Host header/,
		},
		{
			name: "allows requests with valid localhost Host header",
			auth: TEST_SECRET,
			host: "localhost",
			status: 200,
		},
	];

	for (const c of CASES) {
		test(c.name, async () => {
			const headers = { Host: `${c.host}:${testPort}` };
			if (c.auth !== undefined) headers["x-banana-auth"] = c.auth;
			const res = await sendHttpRequest({ headers });
			assertResponse(res, c);
		});
	}
});

function parseJsonOrNull(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null; // non-JSON body: tests assert on status and fail on body checks explicitly
	}
}

function assertResponse(res, expected) {
	assert.equal(res.status, expected.status);
	if (expected.error) {
		assert.match(res.body.error, expected.error);
	} else {
		assert.equal(res.body.status, "healthy");
	}
}
