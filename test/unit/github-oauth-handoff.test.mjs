import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import {
	createGithubRouter,
	createHandoffStore,
	stateStore,
} from "../../backend/src/routes/github-routes.js";

async function startServer(app) {
	return new Promise((resolve) => {
		const server = http.createServer(app).listen(0, "127.0.0.1", () => {
			const baseUrl = `http://127.0.0.1:${server.address().port}`;
			resolve({ server, baseUrl });
		});
	});
}

async function stopServer(server) {
	if (!server) return;
	await new Promise((resolve) => server.close(resolve));
}

describe("HandoffStore Unit Tests", () => {
	it("issues 64-char hex code and stores token", () => {
		const store = createHandoffStore();
		const code = store.put("token-123");
		assert.equal(typeof code, "string");
		assert.equal(code.length, 64);
		assert.match(code, /^[0-9a-f]{64}$/);
	});

	it("returns token once then null on reuse, unknown, or expired", () => {
		let nowTime = 1_000_000;
		const store = createHandoffStore({
			ttlMs: 60_000,
			now: () => nowTime,
		});
		const code = store.put("token-abc");
		assert.equal(store.take(code), "token-abc", "first take returns token");
		assert.equal(store.take(code), null, "second take returns null");
		assert.equal(store.take("unknown-code-123"), null, "unknown returns null");

		const code2 = store.put("token-def");
		nowTime += 70_000;
		assert.equal(store.take(code2), null, "expired returns null");
	});

	it("enforces capacity limit by evicting oldest entry", () => {
		const store = createHandoffStore({ maxEntries: 3 });
		const c1 = store.put("t1");
		const c2 = store.put("t2");
		const c3 = store.put("t3");
		assert.equal(store.size, 3);

		const c4 = store.put("t4");
		assert.equal(store.size, 3);
		const testCases = [
			[c1, null, "oldest evicted"],
			[c2, "t2", "newer preserved"],
			[c3, "t3", "newer preserved"],
			[c4, "t4", "newest preserved"],
		];
		for (const [key, expected, desc] of testCases) {
			assert.equal(store.take(key), expected, desc);
		}
	});
});

describe("OAuth Callback & Handoff Integration", () => {
	let server;
	let baseUrl;
	let customStore;
	let fakeTime;
	const originalEnv = { ...process.env };
	const FAKE_TOKEN = "gho_super_secret_test_token_98765";

	before(async () => {
		fakeTime = 1_000_000;
		customStore = createHandoffStore({
			now: () => fakeTime,
			ttlMs: 60_000,
		});

		const testRouter = createGithubRouter({
			exchangeCodeForToken: async (code) => {
				if (code === "throw_error") {
					throw new Error("sensitive_internal_error_code_xyz");
				}
				return FAKE_TOKEN;
			},
			handoffStore: customStore,
		});

		const app = express();
		app.use("/api", testRouter);
		const instance = await startServer(app);
		server = instance.server;
		baseUrl = instance.baseUrl;
	});

	after(async () => {
		process.env = { ...originalEnv };
		await stopServer(server);
	});

	it("redirect location contains github_handoff and never the token", async () => {
		process.env.FRONTEND_URL = "https://banana.app";
		const state = stateStore.generate();
		const res = await fetch(
			`${baseUrl}/api/auth/github/callback?code=good_code&state=${state}`,
			{ redirect: "manual" },
		);
		assert.equal(res.status, 302);
		const location = res.headers.get("location");
		assert.match(
			location,
			/^https:\/\/banana\.app\/#github_handoff=[0-9a-f]{64}$/,
		);
		assert.doesNotMatch(location, new RegExp(FAKE_TOKEN));
		assert.doesNotMatch(location, /github_token/);
	});

	it("handoff returns token once then 400 with Cache-Control: no-store", async () => {
		const code = customStore.put("token_single_use");
		const postHandoff = (c) =>
			fetch(`${baseUrl}/api/auth/github/handoff`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code: c }),
			});

		const res1 = await postHandoff(code);
		assert.equal(res1.status, 200);
		assert.equal(res1.headers.get("cache-control"), "no-store");
		const data1 = await res1.json();
		assert.deepEqual(data1, { token: "token_single_use" });

		const res2 = await postHandoff(code);
		assert.equal(res2.status, 400);
		const data2 = await res2.json();
		assert.deepEqual(data2, { error: "Invalid handoff code" });
	});

	it("expired code (fake clock) returns 400", async () => {
		const code = customStore.put("token_to_expire");
		fakeTime += 70_000;
		const res = await fetch(`${baseUrl}/api/auth/github/handoff`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		});
		assert.equal(res.status, 400);
		const data = await res.json();
		assert.deepEqual(data, { error: "Invalid handoff code" });
	});

	const malformedCases = [
		{ name: "empty object", body: {} },
		{ name: "null code", body: { code: null } },
		{ name: "numeric code", body: { code: 12345 } },
		{ name: "short string", body: { code: "abc" } },
		{ name: "63 hex characters", body: { code: "a".repeat(63) } },
		{ name: "65 hex characters", body: { code: "a".repeat(65) } },
		{ name: "non-hex characters", body: { code: "g".repeat(64) } },
		{ name: "unknown valid 64-hex", body: { code: "f".repeat(64) } },
	];
	for (const tc of malformedCases) {
		it(`rejects ${tc.name} with 400 Invalid handoff code`, async () => {
			const res = await fetch(`${baseUrl}/api/auth/github/handoff`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(tc.body),
			});
			assert.equal(res.status, 400);
			const data = await res.json();
			assert.deepEqual(data, { error: "Invalid handoff code" });
		});
	}

	it("error redirect has fixed oauth_failed and no error message text", async () => {
		process.env.FRONTEND_URL = "https://banana.app";
		const state = stateStore.generate();
		const res = await fetch(
			`${baseUrl}/api/auth/github/callback?code=throw_error&state=${state}`,
			{ redirect: "manual" },
		);
		assert.equal(res.status, 302);
		const location = res.headers.get("location");
		assert.equal(location, "https://banana.app/#github_error=oauth_failed");
		assert.doesNotMatch(location, /sensitive_internal_error_code_xyz/);
	});

	it("responds 500 FRONTEND_URL must be configured in production without FRONTEND_URL", async () => {
		process.env.NODE_ENV = "production";
		delete process.env.FRONTEND_URL;
		const res = await fetch(
			`${baseUrl}/api/auth/github/callback?code=good_code&state=any`,
		);
		assert.equal(res.status, 500);
		const text = await res.text();
		assert.equal(text, "FRONTEND_URL must be configured");
	});
});
