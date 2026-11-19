import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createLogger, logger } from "../../backend/src/logger.js";

function createTestContext(options = {}) {
	const lines = [];
	const sink = (line) => lines.push(line);
	const clock = options.clock || (() => "2026-01-01T00:00:00.000Z");
	const instance = createLogger({ sink, clock, ...options });
	return {
		logger: instance,
		lines,
		readJson: (idx = 0) => JSON.parse(lines[idx]),
	};
}

function createFakeReqRes(opts = {}) {
	const listeners = {};
	const req = {
		method: opts.method || "GET",
		url: opts.url || "/api/test",
		headers: opts.headers || {},
	};
	const res = {
		statusCode: opts.statusCode || 200,
		setHeader: () => {},
		on: (evt, fn) => {
			listeners[evt] = fn;
		},
		emit: (evt) => {
			if (listeners[evt]) listeners[evt]();
		},
	};
	return { req, res };
}

function assertPropertyMatch(target, expected, mapper = (v) => v) {
	for (const [key, value] of Object.entries(expected)) {
		assert.strictEqual(mapper(target[key]), value);
	}
}

function assertExactProps(target, expected) {
	assertPropertyMatch(target, expected);
}

function assertTypes(target, expectedTypes) {
	assertPropertyMatch(target, expectedTypes, (value) => typeof value);
}

function assertErrorInfo(errData, { name, message, expectStack }) {
	assertExactProps(errData, { name, message });
	const stackMatches = expectStack
		? typeof errData.stack === "string"
		: errData.stack === undefined;
	assert.strictEqual(stackMatches, true);
}

function assertGeneratedUuid(actualId, rejectedId) {
	assert.notStrictEqual(actualId, rejectedId);
	const matchesUuid = /^[0-9a-f-]{36}$/i.test(actualId);
	assert.strictEqual(matchesUuid, true);
}

function assertTruncatedPayload(payload, prefix) {
	for (const check of [
		payload.length < 2500,
		payload.startsWith(prefix),
		payload.includes("[TRUNCATED]"),
	]) {
		assert.strictEqual(check, true);
	}
}

function withEnv(name, value, action) {
	const prev = process.env[name];
	try {
		process.env[name] = value;
		return action();
	} finally {
		process.env[name] = prev;
	}
}

function captureLoggedError({ env, err, msg }) {
	return withEnv("NODE_ENV", env, () => {
		const ctx = createTestContext();
		ctx.logger.error({ err }, msg);
		return ctx.readJson(0);
	});
}

function logSingleJson(payload, msg) {
	const ctx = createTestContext();
	assert.doesNotThrow(() => {
		ctx.logger.info(payload, msg);
	});
	return ctx.readJson(0);
}

function logSafePayload(payload) {
	return logSingleJson(payload);
}

function runRequestFlow(opts = {}) {
	const ctx = createTestContext();
	const mw = ctx.logger.requestLogger();
	const { req, res } = createFakeReqRes(opts);
	let nextCalled = false;
	mw(req, res, () => {
		nextCalled = true;
	});
	return {
		ctx,
		res,
		nextCalled: () => nextCalled,
		finish: () => {
			res.emit("finish");
			return ctx.readJson(0);
		},
	};
}

function getFinishedRequestId(headerValue) {
	return runRequestFlow({
		headers: { "x-request-id": headerValue },
	}).finish().requestId;
}

function assertFilterThreshold(ctx, dropMethod, keepMethod) {
	ctx.logger[dropMethod](`${dropMethod} message`);
	assert.strictEqual(ctx.lines.length, 0);
	ctx.logger[keepMethod](`${keepMethod} message`);
	assert.strictEqual(ctx.lines.length, 1);
}

function assertLogOutput(ctx, expectedCount, expectedProps, idx = 0) {
	assert.ok(ctx.lines);
	assert.strictEqual(ctx.lines.length, expectedCount);
	assertExactProps(ctx.readJson(idx), expectedProps);
}

test("1. writes one JSON line per call with standard fields", () => {
	const ctx = createTestContext();
	ctx.logger.info("first line");
	ctx.logger.info("second line");
	assert.ok(ctx);
	assertLogOutput(ctx, 2, {
		level: "info",
		msg: "first line",
		time: "2026-01-01T00:00:00.000Z",
	});
});

test("2. level filtering drops lower levels by default (info threshold)", () => {
	const ctx = createTestContext();
	assert.ok(ctx);
	assertFilterThreshold(ctx, "debug", "info");
});

test("3. level filtering respects custom level parameter", () => {
	const cases = [
		{ level: "debug", method: "debug", expected: 1 },
		{ level: "warn", method: "info", expected: 0 },
		{ level: "warn", method: "warn", expected: 1 },
		{ level: "error", method: "warn", expected: 0 },
		{ level: "error", method: "error", expected: 1 },
	];
	for (const item of cases) {
		const ctx = createTestContext({ level: item.level });
		ctx.logger[item.method]("test message");
		assert.strictEqual(ctx.lines.length, item.expected);
	}
});

test("4. level filtering respects LOG_LEVEL environment variable", () => {
	withEnv("LOG_LEVEL", "error", () => {
		const ctx = createTestContext();
		assert.ok(ctx);
		assertFilterThreshold(ctx, "warn", "error");
	});
});

test("5. child logger includes parent base and merges bindings", () => {
	const ctx = createTestContext({ base: { app: "banana" } });
	const childLogger = ctx.logger.child({ service: "solver" });
	childLogger.info("child action", { extra: 42 });
	assertExactProps(ctx.readJson(0), {
		app: "banana",
		service: "solver",
		extra: 42,
		msg: "child action",
	});
});

test("6. nested child loggers accumulate bindings across generations", () => {
	const ctx = createTestContext();
	const level1 = ctx.logger.child({ gen: 1 });
	const level2 = level1.child({ gen: 2 });
	level2.info("deep");
	const data = ctx.readJson(0);
	assert.strictEqual(data.gen, 2);
});

const errorCases = [
	{
		title:
			"7. error serialization outside production includes name, message, stack",
		env: "development",
		err: new Error("boom"),
		msg: "failed",
		expected: { name: "Error", message: "boom", expectStack: true },
	},
	{
		title:
			"8. error serialization in production includes name and message ONLY",
		env: "production",
		err: new TypeError("invalid input"),
		msg: "type failure",
		expected: {
			name: "TypeError",
			message: "invalid input",
			expectStack: false,
		},
	},
];
for (const tc of errorCases) {
	test(tc.title, () => {
		const data = captureLoggedError(tc);
		assertErrorInfo(data.err, tc.expected);
	});
}

test("9. redaction replaces sensitive keys with [REDACTED]", () => {
	const sensitiveKeys = [
		"authorization",
		"cookie",
		"token",
		"secret",
		"password",
		"api_key",
		"apiKey",
		"client_secret",
	];
	for (const key of sensitiveKeys) {
		const data = logSingleJson({ [key]: "sensitive-value" }, "login");
		assert.strictEqual(data[key], "[REDACTED]");
	}
});

test("10. redaction masks known secret patterns in string values", () => {
	const patterns = [
		{
			val: "using sk-ant-api03-secret123 key",
			expected: "using [REDACTED] key",
		},
		{ val: "found AIzaSyD9xK1234567890 key", expected: "found [REDACTED] key" },
		{ val: "ghp_ABC1234567890xyz", expected: "[REDACTED]" },
		{ val: "gho_ABC1234567890xyz", expected: "[REDACTED]" },
		{ val: "github_pat_11AA22BB33CC", expected: "[REDACTED]" },
		{ val: "Bearer eyJhbGciOi...", expected: "[REDACTED]" },
	];
	for (const item of patterns) {
		const data = logSingleJson({ note: item.val });
		assert.strictEqual(data.note, item.expected);
	}
});

test("11. redaction traverses nested objects and arrays", () => {
	const data = logSingleJson({
		nested: {
			users: [
				{ name: "alice", password: "p1" },
				{ name: "bob", token: "t1" },
			],
		},
	});
	const { users } = data.nested;
	const expectedUsers = [
		{ name: "alice", password: "[REDACTED]" },
		{ token: "[REDACTED]" },
	];
	for (let i = 0; i < expectedUsers.length; i++) {
		assertExactProps(users[i], expectedUsers[i]);
	}
});

test("12. recursion stops beyond depth 5 with placeholder", () => {
	const deep = { l1: { l2: { l3: { l4: { l5: { l6: "too-deep" } } } } } };
	const data = logSingleJson({ deep });
	assert.strictEqual(data.deep.l1.l2.l3.l4.l5, "[DEPTH_EXCEEDED]");
});

test("13. strings longer than 2000 characters are truncated with marker", () => {
	const data = logSingleJson({ payload: "x".repeat(2500) });
	assertTruncatedPayload(data.payload, "x".repeat(2000));
});

test("14. absolute paths under user home directory are reduced to basename", () => {
	const secretPath = path.join(
		os.homedir(),
		"documents",
		"circuit-secret.kicad",
	);
	const data = logSingleJson({ path: secretPath }, `saving to ${secretPath}`);
	assertExactProps(data, {
		path: "circuit-secret.kicad",
		msg: "saving to circuit-secret.kicad",
	});
});

test("15. metric logs level metric with finite numeric value and tags", () => {
	const ctx = createTestContext();
	ctx.logger.metric("ai.tokens", 1500, { model: "claude-3-5" });
	assert.ok(ctx);
	assertLogOutput(ctx, 1, {
		level: "metric",
		name: "ai.tokens",
		value: 1500,
		model: "claude-3-5",
	});
});

test("16. metric drops non-finite and non-numeric values", () => {
	const badValues = [
		NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		"100",
		null,
		undefined,
	];
	for (const val of badValues) {
		const ctx = createTestContext();
		ctx.logger.metric("bad.metric", val);
		assert.strictEqual(ctx.lines.length, 0);
	}
});

test("17. requestLogger logs finished request without query string or headers", () => {
	const flow = runRequestFlow({
		method: "GET",
		url: "/api/circuits?secret_token=12345&filter=active",
		headers: { authorization: "Bearer secret", "x-banana-auth": "secret" },
	});
	assert.strictEqual(flow.nextCalled(), true);
	const beforeFinish = flow.ctx.lines.length;
	assert.strictEqual(beforeFinish, 0);
	const data = flow.finish();
	assert.strictEqual(flow.ctx.lines.length, 1);
	assertExactProps(data, {
		method: "GET",
		path: "/api/circuits",
		status: 200,
		headers: undefined,
		body: undefined,
	});
	assertTypes(data, { duration: "number", requestId: "string" });
});

test("18. requestLogger validates and accepts conformant x-request-id", () => {
	const validId = "custom-req-id_12345";
	assert.strictEqual(getFinishedRequestId(validId), validId);
});

test("19. requestLogger generates UUID for invalid or missing x-request-id", () => {
	const invalidIds = ["bad id with spaces", "a".repeat(65), "drop;table", ""];
	for (const badId of invalidIds) {
		assertGeneratedUuid(getFinishedRequestId(badId), badId);
	}
});

const safePayloadCases = [
	{
		title:
			"20. circular references do not throw and are replaced by [CIRCULAR]",
		payload: () => {
			const obj = { name: "cycle" };
			obj.self = obj;
			return { cycle: obj };
		},
		verify: (data) => assert.strictEqual(data.cycle.self, "[CIRCULAR]"),
	},
	{
		title: "21. BigInt values do not throw and are replaced by [BIGINT]",
		payload: () => ({ big: 9007199254740991000n }),
		verify: (data) => assert.strictEqual(data.big, "[BIGINT]"),
	},
];
for (const tc of safePayloadCases) {
	test(tc.title, () => {
		const data = logSafePayload(tc.payload());
		tc.verify(data);
	});
}

test("22. throwing sink is swallowed and does not throw", () => {
	const failingSink = () => {
		throw new Error("disk write error");
	};
	const instance = createLogger({ sink: failingSink });
	assert.doesNotThrow(() => {
		instance.info("will fail silently");
		instance.error("will also fail silently");
		instance.metric("metric.fail", 1);
	});
});

test("23. default shared logger instance is exported and functional", () => {
	assert.ok(logger);
	for (const method of ["info", "error", "metric", "requestLogger"]) {
		assert.strictEqual(typeof logger[method], "function");
	}
});
