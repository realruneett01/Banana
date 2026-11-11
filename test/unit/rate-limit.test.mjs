import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createRateLimiter,
	defaultKey,
	skipWhenLocal,
} from "../../backend/src/rate-limit.js";

function createMockReq({ ip, remoteAddress, allowLocalRepos } = {}) {
	return {
		ip,
		socket: remoteAddress ? { remoteAddress } : undefined,
		app: {
			locals: {
				allowLocalRepos,
			},
		},
	};
}

function createMockRes() {
	const headers = new Map();
	let statusCode = 200;
	let responseBody = null;
	return {
		setHeader(name, value) {
			headers.set(name.toLowerCase(), String(value));
			return this;
		},
		getHeader(name) {
			return headers.get(name.toLowerCase());
		},
		status(code) {
			statusCode = code;
			return this;
		},
		json(data) {
			responseBody = data;
			return this;
		},
		getStatusCode: () => statusCode,
		getBody: () => responseBody,
	};
}

function dispatch(limiter, req) {
	const res = createMockRes();
	let nextCalled = false;
	limiter(req, res, () => {
		nextCalled = true;
	});
	return { res, nextCalled };
}

describe("rate limiter", () => {
	test("defaultKey resolves client IP with fallbacks", () => {
		const cases = [
			{ req: { ip: "192.168.1.1" }, expected: "192.168.1.1" },
			{
				req: { socket: { remoteAddress: "10.0.0.1" } },
				expected: "10.0.0.1",
			},
			{ req: {}, expected: "unknown" },
			{ req: null, expected: "unknown" },
		];
		for (const c of cases) {
			assert.equal(defaultKey(c.req), c.expected);
		}
	});

	test("allows up to max requests with rate limit headers", () => {
		const nowMs = 1000;
		const limiter = createRateLimiter({
			windowMs: 60000,
			max: 2,
			now: () => nowMs,
		});
		const req = createMockReq({ ip: "1.2.3.4" });

		const step1 = dispatch(limiter, req);
		assert.equal(step1.nextCalled, true);
		assert.equal(step1.res.getHeader("ratelimit-limit"), "2");
		assert.equal(step1.res.getHeader("ratelimit-remaining"), "1");
		assert.equal(step1.res.getHeader("ratelimit-reset"), "60");

		const step2 = dispatch(limiter, req);
		assert.equal(step2.nextCalled, true);
		assert.equal(step2.res.getHeader("ratelimit-remaining"), "0");
	});

	test("blocks max+1 with 429 and headers", () => {
		const nowMs = 1000;
		const limiter = createRateLimiter({
			windowMs: 60000,
			max: 1,
			now: () => nowMs,
		});
		const req = createMockReq({ ip: "1.2.3.4" });

		dispatch(limiter, req);
		const blocked = dispatch(limiter, req);

		assert.equal(blocked.nextCalled, false);
		assert.equal(blocked.res.getStatusCode(), 429);
		assert.deepEqual(blocked.res.getBody(), {
			error: "Too many requests, retry later",
		});
		assert.equal(blocked.res.getHeader("retry-after"), "60");
		assert.equal(blocked.res.getHeader("ratelimit-limit"), "1");
		assert.equal(blocked.res.getHeader("ratelimit-remaining"), "0");
		assert.equal(blocked.res.getHeader("ratelimit-reset"), "60");
	});

	test("resets after the window", () => {
		let nowMs = 1000;
		const limiter = createRateLimiter({
			windowMs: 60000,
			max: 1,
			now: () => nowMs,
		});
		const req = createMockReq({ ip: "1.2.3.4" });

		dispatch(limiter, req);
		const blocked = dispatch(limiter, req);
		assert.equal(blocked.nextCalled, false);

		nowMs += 60001;
		const resetCall = dispatch(limiter, req);
		assert.equal(resetCall.nextCalled, true);
		assert.equal(resetCall.res.getHeader("ratelimit-remaining"), "0");
	});

	test("separate keys are independent", () => {
		const nowMs = 1000;
		const limiter = createRateLimiter({
			windowMs: 60000,
			max: 1,
			now: () => nowMs,
		});
		const reqA = createMockReq({ ip: "10.0.0.1" });
		const reqB = createMockReq({ ip: "10.0.0.2" });

		dispatch(limiter, reqA);
		const callB = dispatch(limiter, reqB);
		assert.equal(callB.nextCalled, true);
		assert.equal(callB.res.getHeader("ratelimit-remaining"), "0");

		const blockedA = dispatch(limiter, reqA);
		assert.equal(blockedA.nextCalled, false);
		assert.equal(blockedA.res.getStatusCode(), 429);
	});

	test("maxKeys eviction keeps the Map bounded", () => {
		const nowMs = 1000;
		const limiter = createRateLimiter({
			windowMs: 60000,
			max: 1,
			maxKeys: 2,
			now: () => nowMs,
		});
		const reqA = createMockReq({ ip: "key-a" });
		const reqB = createMockReq({ ip: "key-b" });
		const reqC = createMockReq({ ip: "key-c" });

		dispatch(limiter, reqA);
		dispatch(limiter, reqB);
		assert.equal(limiter.store.size, 2);

		dispatch(limiter, reqC);
		assert.equal(limiter.store.size, 2);

		const reqAAfterEviction = dispatch(limiter, reqA);
		assert.equal(reqAAfterEviction.nextCalled, true);
	});

	test("skipWhenLocal bypasses for desktop and enforces otherwise", () => {
		const cases = [
			{ allowLocalRepos: true, shouldPass: true },
			{ allowLocalRepos: false, shouldPass: false },
		];
		for (const c of cases) {
			const limiter = createRateLimiter({
				windowMs: 60000,
				max: 1,
				now: () => 1000,
			});
			const wrapped = skipWhenLocal(limiter);
			const req = createMockReq({
				ip: "1.1.1.1",
				allowLocalRepos: c.allowLocalRepos,
			});
			dispatch(wrapped, req);
			const second = dispatch(wrapped, req);
			assert.equal(second.nextCalled, c.shouldPass);
		}
	});

	test("unknown ip falls back to shared unknown bucket", () => {
		const limiter = createRateLimiter({
			windowMs: 60000,
			max: 1,
			now: () => 1000,
		});
		const req1 = createMockReq();
		const req2 = createMockReq();

		const first = dispatch(limiter, req1);
		assert.equal(first.nextCalled, true);

		const second = dispatch(limiter, req2);
		assert.equal(second.nextCalled, false);
		assert.equal(second.res.getStatusCode(), 429);
	});
});
