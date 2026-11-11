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

test("1. writes one JSON line per call with standard fields", () => {
	const ctx = createTestContext();
	ctx.logger.info("first line");
	ctx.logger.info("second line");
	assert.strictEqual(ctx.lines.length, 2);
	const data = ctx.readJson(0);
	assert.strictEqual(data.level, "info");
	assert.strictEqual(data.msg, "first line");
	assert.strictEqual(data.time, "2026-01-01T00:00:00.000Z");
});

test("2. level filtering drops lower levels by default (info threshold)", () => {
	const ctx = createTestContext();
	ctx.logger.debug("debug message");
	assert.strictEqual(ctx.lines.length, 0);
	ctx.logger.info("info message");
	assert.strictEqual(ctx.lines.length, 1);
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
	const prev = process.env.LOG_LEVEL;
	try {
		process.env.LOG_LEVEL = "error";
		const ctx = createTestContext();
		ctx.logger.warn("warn message");
		assert.strictEqual(ctx.lines.length, 0);
		ctx.logger.error("error message");
		assert.strictEqual(ctx.lines.length, 1);
	} finally {
		process.env.LOG_LEVEL = prev;
	}
});

test("5. child logger includes parent base and merges bindings", () => {
	const ctx = createTestContext({ base: { app: "banana" } });
	const childLogger = ctx.logger.child({ service: "solver" });
	childLogger.info("child action", { extra: 42 });
	const data = ctx.readJson(0);
	assert.strictEqual(data.app, "banana");
	assert.strictEqual(data.service, "solver");
	assert.strictEqual(data.extra, 42);
	assert.strictEqual(data.msg, "child action");
});

test("6. nested child loggers accumulate bindings across generations", () => {
	const ctx = createTestContext();
	const level1 = ctx.logger.child({ gen: 1 });
	const level2 = level1.child({ gen: 2 });
	level2.info("deep");
	const data = ctx.readJson(0);
	assert.strictEqual(data.gen, 2);
});

test("7. error serialization outside production includes name, message, stack", () => {
	const prev = process.env.NODE_ENV;
	try {
		process.env.NODE_ENV = "development";
		const ctx = createTestContext();
		const err = new Error("boom");
		ctx.logger.error({ err }, "failed");
		const data = ctx.readJson(0);
		assert.strictEqual(data.err.name, "Error");
		assert.strictEqual(data.err.message, "boom");
		assert.ok(typeof data.err.stack === "string");
	} finally {
		process.env.NODE_ENV = prev;
	}
});

test("8. error serialization in production includes name and message ONLY", () => {
	const prev = process.env.NODE_ENV;
	try {
		process.env.NODE_ENV = "production";
		const ctx = createTestContext();
		const err = new TypeError("invalid input");
		ctx.logger.error({ err }, "type failure");
		const data = ctx.readJson(0);
		assert.strictEqual(data.err.name, "TypeError");
		assert.strictEqual(data.err.message, "invalid input");
		assert.strictEqual(data.err.stack, undefined);
	} finally {
		process.env.NODE_ENV = prev;
	}
});

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
		const ctx = createTestContext();
		ctx.logger.info({ [key]: "sensitive-value" }, "login");
		const data = ctx.readJson(0);
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
		const ctx = createTestContext();
		ctx.logger.info({ note: item.val });
		const data = ctx.readJson(0);
		assert.strictEqual(data.note, item.expected);
	}
});

test("11. redaction traverses nested objects and arrays", () => {
	const ctx = createTestContext();
	ctx.logger.info({
		nested: {
			users: [
				{ name: "alice", password: "p1" },
				{ name: "bob", token: "t1" },
			],
		},
	});
	const data = ctx.readJson(0);
	assert.strictEqual(data.nested.users[0].password, "[REDACTED]");
	assert.strictEqual(data.nested.users[1].token, "[REDACTED]");
	assert.strictEqual(data.nested.users[0].name, "alice");
});

test("12. recursion stops beyond depth 5 with placeholder", () => {
	const ctx = createTestContext();
	const deep = { l1: { l2: { l3: { l4: { l5: { l6: "too-deep" } } } } } };
	ctx.logger.info({ deep });
	const data = ctx.readJson(0);
	assert.strictEqual(data.deep.l1.l2.l3.l4.l5, "[DEPTH_EXCEEDED]");
});

test("13. strings longer than 2000 characters are truncated with marker", () => {
	const ctx = createTestContext();
	const longStr = "x".repeat(2500);
	ctx.logger.info({ payload: longStr });
	const data = ctx.readJson(0);
	assert.ok(data.payload.length < 2500);
	assert.ok(data.payload.startsWith("x".repeat(2000)));
	assert.ok(data.payload.includes("[TRUNCATED]"));
});

test("14. absolute paths under user home directory are reduced to basename", () => {
	const ctx = createTestContext();
	const secretPath = path.join(
		os.homedir(),
		"documents",
		"circuit-secret.kicad",
	);
	ctx.logger.info({ path: secretPath }, `saving to ${secretPath}`);
	const data = ctx.readJson(0);
	assert.strictEqual(data.path, "circuit-secret.kicad");
	assert.strictEqual(data.msg, "saving to circuit-secret.kicad");
});

test("15. metric logs level metric with finite numeric value and tags", () => {
	const ctx = createTestContext();
	ctx.logger.metric("ai.tokens", 1500, { model: "claude-3-5" });
	assert.strictEqual(ctx.lines.length, 1);
	const data = ctx.readJson(0);
	assert.strictEqual(data.level, "metric");
	assert.strictEqual(data.name, "ai.tokens");
	assert.strictEqual(data.value, 1500);
	assert.strictEqual(data.model, "claude-3-5");
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
	const ctx = createTestContext();
	const mw = ctx.logger.requestLogger();
	const { req, res } = createFakeReqRes({
		method: "GET",
		url: "/api/circuits?secret_token=12345&filter=active",
		headers: { authorization: "Bearer secret", "x-banana-auth": "secret" },
	});
	let nextCalled = false;
	mw(req, res, () => {
		nextCalled = true;
	});
	assert.strictEqual(nextCalled, true);
	assert.strictEqual(ctx.lines.length, 0);
	res.emit("finish");
	assert.strictEqual(ctx.lines.length, 1);
	const data = ctx.readJson(0);
	assert.strictEqual(data.method, "GET");
	assert.strictEqual(data.path, "/api/circuits");
	assert.strictEqual(data.status, 200);
	assert.ok(typeof data.duration === "number");
	assert.ok(typeof data.requestId === "string");
	assert.strictEqual(data.headers, undefined);
	assert.strictEqual(data.body, undefined);
});

test("18. requestLogger validates and accepts conformant x-request-id", () => {
	const ctx = createTestContext();
	const mw = ctx.logger.requestLogger();
	const validId = "custom-req-id_12345";
	const { req, res } = createFakeReqRes({
		headers: { "x-request-id": validId },
	});
	mw(req, res, () => {});
	res.emit("finish");
	const data = ctx.readJson(0);
	assert.strictEqual(data.requestId, validId);
});

test("19. requestLogger generates UUID for invalid or missing x-request-id", () => {
	const invalidIds = ["bad id with spaces", "a".repeat(65), "drop;table", ""];
	for (const badId of invalidIds) {
		const ctx = createTestContext();
		const mw = ctx.logger.requestLogger();
		const { req, res } = createFakeReqRes({
			headers: { "x-request-id": badId },
		});
		mw(req, res, () => {});
		res.emit("finish");
		const data = ctx.readJson(0);
		assert.notStrictEqual(data.requestId, badId);
		assert.ok(/^[0-9a-f-]{36}$/i.test(data.requestId));
	}
});

test("20. circular references do not throw and are replaced by [CIRCULAR]", () => {
	const ctx = createTestContext();
	const obj = { name: "cycle" };
	obj.self = obj;
	assert.doesNotThrow(() => {
		ctx.logger.info({ cycle: obj });
	});
	const data = ctx.readJson(0);
	assert.strictEqual(data.cycle.self, "[CIRCULAR]");
});

test("21. BigInt values do not throw and are replaced by [BIGINT]", () => {
	const ctx = createTestContext();
	assert.doesNotThrow(() => {
		ctx.logger.info({ big: 9007199254740991000n });
	});
	const data = ctx.readJson(0);
	assert.strictEqual(data.big, "[BIGINT]");
});

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
	assert.strictEqual(typeof logger.info, "function");
	assert.strictEqual(typeof logger.error, "function");
	assert.strictEqual(typeof logger.metric, "function");
	assert.strictEqual(typeof logger.requestLogger, "function");
});
