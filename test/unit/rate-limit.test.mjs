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

function createTestLimiter(overrides = {}) {
	return createRateLimiter({
		windowMs: 60000,
		max: 1,
		now: () => 1000,
		...overrides,
	});
}

function assertHeaders(res, headers) {
	for (const [key, value] of Object.entries(headers)) {
		assert.equal(res.getHeader(key), String(value));
	}
}

function assertAllowed(step, remaining) {
	assert.equal(step.nextCalled, true);
	if (remaining !== undefined) {
		assert.equal(step.res.getHeader("ratelimit-remaining"), String(remaining));
	}
}

function assertBlocked(step, headers) {
	assert.equal(step.nextCalled, false);
	assert.equal(step.res.getStatusCode(), 429);
	if (headers) {
		assert.deepEqual(step.res.getBody(), {
			error: "Too many requests, retry later",
		});
		assertHeaders(step.res, headers);
	}
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
		const limiter = createTestLimiter({ max: 2 });
		const req = createMockReq({ ip: "1.2.3.4" });

		const step1 = dispatch(limiter, req);
		assertAllowed(step1, "1");
		assertHeaders(step1.res, {
			"ratelimit-limit": "2",
			"ratelimit-reset": "60",
		});

		assertAllowed(dispatch(limiter, req), "0");
	});

	test("blocks max+1 with 429 and headers", () => {
		const limiter = createTestLimiter();
		const req = createMockReq({ ip: "1.2.3.4" });

		dispatch(limiter, req);
		assertBlocked(dispatch(limiter, req), {
			"retry-after": "60",
			"ratelimit-limit": "1",
			"ratelimit-remaining": "0",
			"ratelimit-reset": "60",
		});
	});

	test("resets after the window", () => {
		let now = 1000;
		const limiter = createTestLimiter({ now: () => now });
		const req = createMockReq({ ip: "1.2.3.4" });

		dispatch(limiter, req);
		assert.equal(dispatch(limiter, req).nextCalled, false);

		now += 60001;
		assertAllowed(dispatch(limiter, req), "0");
	});

	test("separate keys are independent", () => {
		const limiter = createTestLimiter();
		const reqA = createMockReq({ ip: "10.0.0.1" });
		const reqB = createMockReq({ ip: "10.0.0.2" });

		dispatch(limiter, reqA);
		assertAllowed(dispatch(limiter, reqB), "0");
		assertBlocked(dispatch(limiter, reqA));
	});

	test("maxKeys eviction keeps the Map bounded", () => {
		const limiter = createTestLimiter({ maxKeys: 2 });
		const reqA = createMockReq({ ip: "key-a" });
		const reqB = createMockReq({ ip: "key-b" });
		const reqC = createMockReq({ ip: "key-c" });

		dispatch(limiter, reqA);
		dispatch(limiter, reqB);
		assert.equal(limiter.store.size, 2);

		dispatch(limiter, reqC);
		assert.equal(limiter.store.size, 2);

		assertAllowed(dispatch(limiter, reqA));
	});

	test("skipWhenLocal bypasses for desktop and enforces otherwise", () => {
		const cases = [
			{ allowLocalRepos: true, shouldPass: true },
			{ allowLocalRepos: false, shouldPass: false },
		];
		for (const c of cases) {
			const limiter = createTestLimiter();
			const wrapped = skipWhenLocal(limiter);
			const req = createMockReq({
				ip: "1.1.1.1",
				allowLocalRepos: c.allowLocalRepos,
			});
			dispatch(wrapped, req);
			assert.equal(dispatch(wrapped, req).nextCalled, c.shouldPass);
		}
	});

	test("unknown ip falls back to shared unknown bucket", () => {
		const limiter = createTestLimiter();
		assertAllowed(dispatch(limiter, createMockReq()));
		assertBlocked(dispatch(limiter, createMockReq()));
	});
});
