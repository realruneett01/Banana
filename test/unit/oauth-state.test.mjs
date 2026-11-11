import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { config } from "../../backend/src/config.js";
import { getOAuthAuthorizeUrl } from "../../backend/src/github-service.js";
import githubRouter, {
	createStateStore,
	getDynamicOrigin,
	stateStore,
} from "../../backend/src/routes/github-routes.js";

async function assertInvalidOAuthState(res) {
	assert.equal(res.status, 400);
	assert.equal(await res.text(), "Invalid OAuth state");
}

function assertRedirectFragment(res, key, expectedValue) {
	assert.equal(res.status, 302);
	const location = res.headers.get("location");
	if (expectedValue) {
		assert.equal(location, expectedValue);
	} else {
		assert.ok(location.startsWith(`https://banana.app/#${key}=`));
	}
	assert.doesNotMatch(location, new RegExp(`/\\?${key}=`));
}

describe("OAuth State & Origin Hardening", () => {
	describe("getOAuthAuthorizeUrl state validation", () => {
		const originalClientId = config.githubClientId;

		before(() => {
			config.githubClientId = "test-client-id";
		});

		after(() => {
			config.githubClientId = originalClientId;
		});

		const invalidStates = [undefined, null, ""];
		for (const stateVal of invalidStates) {
			it(`throws when state is ${JSON.stringify(stateVal)}`, () => {
				assert.throws(
					() => getOAuthAuthorizeUrl(stateVal, "https://banana.app/callback"),
					/OAuth state is required/i,
				);
			});
		}

		it("generates authorize url containing given state", () => {
			const state = "abc123state";
			const url = getOAuthAuthorizeUrl(state, "https://banana.app/callback");
			assert.match(url, /state=abc123state/);
			assert.doesNotMatch(url, /banana_auth/);
		});
	});

	describe("createStateStore helper unit tests", () => {
		it("issues 32-character hex state", () => {
			const store = createStateStore();
			const state = store.generate();
			assert.equal(typeof state, "string");
			assert.equal(state.length, 32);
			assert.match(state, /^[0-9a-f]{32}$/);
		});

		it("accepts state once, rejects on reuse, unknown, or expired", () => {
			let nowTime = 1_000_000;
			const store = createStateStore({
				ttlMs: 60_000,
				now: () => nowTime,
			});

			const state1 = store.generate();
			assert.equal(store.consume(state1), true, "accepted once");
			assert.equal(store.consume(state1), false, "rejected on reuse");
			assert.equal(
				store.consume("unknown-state-xyz"),
				false,
				"rejected on unknown",
			);

			const state2 = store.generate();
			nowTime += 70_000; // advance past TTL
			assert.equal(store.consume(state2), false, "rejected on expired");
		});

		it("enforces capacity limit by evicting oldest entry", () => {
			const store = createStateStore({ maxEntries: 3 });
			store.set("state-1");
			store.set("state-2");
			store.set("state-3");
			assert.equal(store.size, 3);

			store.set("state-4");
			assert.equal(store.size, 3);
			const evictionCases = [
				["state-1", false, "oldest evicted"],
				["state-2", true, "newer preserved"],
				["state-3", true, "newer preserved"],
				["state-4", true, "newest preserved"],
			];
			for (const [key, expected, desc] of evictionCases) {
				assert.equal(store.consume(key), expected, desc);
			}
		});
	});

	describe("getDynamicOrigin", () => {
		const originalEnv = { ...process.env };

		after(() => {
			process.env = { ...originalEnv };
		});

		const proxyCases = [
			{
				name: "ignores X-Forwarded headers when TRUST_PROXY is unset or not 1",
				trustProxy: undefined,
				forwardedHost: "attacker.evil.com",
				expected: "http://banana.internal:3000",
			},
			{
				name: "respects X-Forwarded headers when TRUST_PROXY === '1'",
				trustProxy: "1",
				forwardedHost: "banana.onrender.com",
				expected: "https://banana.onrender.com",
			},
		];
		for (const tc of proxyCases) {
			it(tc.name, () => {
				if (tc.trustProxy !== undefined) {
					process.env.TRUST_PROXY = tc.trustProxy;
				} else {
					delete process.env.TRUST_PROXY;
				}
				delete process.env.FRONTEND_URL;
				const req = {
					protocol: "http",
					headers: {
						host: "banana.internal:3000",
						"x-forwarded-host": tc.forwardedHost,
						"x-forwarded-proto": "https",
					},
					get: (h) =>
						h.toLowerCase() === "host" ? "banana.internal:3000" : null,
				};
				const origin = getDynamicOrigin(req);
				assert.equal(origin, tc.expected);
			});
		}

		const frontendCases = [
			{ url: "http://localhost:5173", expected: "http://localhost:5173" },
			{ url: "http://localhost:5173/", expected: "http://localhost:5173" },
			{ url: "https://banana.app", expected: "https://banana.app" },
		];
		for (const tc of frontendCases) {
			it(`uses FRONTEND_URL when set (${tc.url})`, () => {
				process.env.FRONTEND_URL = tc.url;
				const req = {
					protocol: "http",
					headers: { host: "127.0.0.1:5000" },
					get: () => "127.0.0.1:5000",
				};
				assert.equal(getDynamicOrigin(req), tc.expected);
			});
		}
	});

	describe("Express Route Integration", () => {
		let server;
		let baseUrl;
		const originalEnv = { ...process.env };
		const originalClientId = config.githubClientId;
		const originalClientSecret = config.githubClientSecret;

		before(async () => {
			const app = express();
			app.use("/api", githubRouter);

			await new Promise((resolve) => {
				server = http.createServer(app).listen(0, "127.0.0.1", () => {
					baseUrl = `http://127.0.0.1:${server.address().port}`;
					resolve();
				});
			});
		});

		after(async () => {
			process.env = { ...originalEnv };
			config.githubClientId = originalClientId;
			config.githubClientSecret = originalClientSecret;
			if (server) {
				await new Promise((resolve) => server.close(resolve));
			}
		});

		it("GET /api/auth/github/url generates random state and ignores client-supplied state", async () => {
			config.githubClientId = "test-client-id";
			delete process.env.FRONTEND_URL;
			const res = await fetch(
				`${baseUrl}/api/auth/github/url?state=attacker_supplied_state`,
			);
			assert.equal(res.status, 200);
			const data = await res.json();
			assert.equal(data.configured, true);
			assert.doesNotMatch(data.url, /attacker_supplied_state/);

			const match = data.url.match(/state=([0-9a-f]{32})/);
			assert.ok(match, "url must contain 32-hex state");
			const issuedState = match[1];
			assert.equal(
				stateStore.consume(issuedState),
				true,
				"issued state in store",
			);
		});

		const rejectionCases = [
			{ name: "missing state", query: "code=testcode" },
			{
				name: "unknown state",
				query: "code=testcode&state=unknown_hex_val",
			},
			{
				name: "expired state",
				query: "code=testcode&state=expired_state_12345",
				setup: () => {
					stateStore.set("expired_state_12345", Date.now() - 11 * 60 * 1000);
				},
			},
		];
		for (const tc of rejectionCases) {
			it(`GET /api/auth/github/callback rejects ${tc.name}`, async () => {
				tc.setup?.();
				const res = await fetch(
					`${baseUrl}/api/auth/github/callback?${tc.query}`,
				);
				await assertInvalidOAuthState(res);
			});
		}

		it("GET /api/auth/github/callback accepts state once and rejects reuse", async () => {
			const validState = stateStore.generate();
			process.env.FRONTEND_URL = "http://localhost:5173";

			// First callback request consumes the state
			const res1 = await fetch(
				`${baseUrl}/api/auth/github/callback?code=c1&state=${validState}`,
				{ redirect: "manual" },
			);
			assert.equal(res1.status, 302);
			const loc1 = res1.headers.get("location");
			assert.match(loc1, /^http:\/\/localhost:5173\/#/);

			// Second callback request with identical state must be rejected
			const res2 = await fetch(
				`${baseUrl}/api/auth/github/callback?code=c1&state=${validState}`,
				{ redirect: "manual" },
			);
			await assertInvalidOAuthState(res2);
		});

		it("redirects with URL fragment #github_error= on exchange failure", async () => {
			const validState = stateStore.generate();
			process.env.FRONTEND_URL = "https://banana.app";
			config.githubClientId = ""; // forces exchangeCodeForToken to fail

			const res = await fetch(
				`${baseUrl}/api/auth/github/callback?code=bad_code&state=${validState}`,
				{ redirect: "manual" },
			);
			assertRedirectFragment(res, "github_error");
		});

		it("redirects with URL fragment #github_token= on exchange success", async () => {
			const validState = stateStore.generate();
			process.env.FRONTEND_URL = "https://banana.app";
			config.githubClientId = "test-client-id";
			config.githubClientSecret = "test-client-secret";

			const originalFetch = globalThis.fetch;
			globalThis.fetch = async (url, opts) => {
				if (typeof url === "string" && url.includes("access_token")) {
					return new Response(
						JSON.stringify({ access_token: "gho_super_secret_token" }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				return originalFetch(url, opts);
			};

			try {
				const res = await originalFetch(
					`${baseUrl}/api/auth/github/callback?code=valid_code&state=${validState}`,
					{ redirect: "manual" },
				);
				assertRedirectFragment(
					res,
					"github_token",
					"https://banana.app/#github_token=gho_super_secret_token",
				);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
