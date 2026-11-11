import crypto from "node:crypto";
import os from "node:os";

const LOG_LEVELS = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const SENSITIVE_KEY_PATTERN =
	/authorization|cookie|token|secret|password|api[-_]?key|client_secret/i;

const KEY_PATTERNS =
	/sk-ant-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]+|ghp_[0-9A-Za-z]+|gho_[0-9A-Za-z]+|github_pat_[0-9A-Za-z_]+|Bearer\s+[A-Za-z0-9_\-.~+/]+=*/g;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_STRING_LENGTH = 2000;
const TRUNCATION_MARKER = "... [TRUNCATED]";
const MAX_DEPTH = 5;

function getHomePattern() {
	const home = os.homedir();
	if (!home) return null;
	const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = escaped.replace(/\\\\|\//g, "[\\\\/]");
	return new RegExp(`${pattern}[\\\\/][^\\s"']+`, "g");
}

const HOME_DIR_PATTERN = getHomePattern();

function getPathBasename(p) {
	const segments = p.split(/[\\/]/).filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1] : p;
}

function sanitizeHomePaths(str) {
	if (!HOME_DIR_PATTERN) return str;
	return str.replace(HOME_DIR_PATTERN, (match) => getPathBasename(match));
}

function sanitizeString(str) {
	if (typeof str !== "string") return str;
	let result = str.replace(KEY_PATTERNS, "[REDACTED]");
	result = sanitizeHomePaths(result);
	if (result.length > MAX_STRING_LENGTH) {
		result = result.slice(0, MAX_STRING_LENGTH) + TRUNCATION_MARKER;
	}
	return result;
}

function isErrorLike(val) {
	if (!val || typeof val !== "object") return false;
	return val instanceof Error || typeof val.message === "string";
}

function serializeError(err, isProd) {
	const name = err.name || "Error";
	const message = sanitizeString(err.message || String(err));
	if (isProd) {
		return { name, message };
	}
	const stack = err.stack ? sanitizeString(err.stack) : undefined;
	return { name, message, stack };
}

function redactPrimitive(val) {
	if (typeof val === "string") {
		return sanitizeString(val);
	}
	if (typeof val === "bigint") {
		return "[BIGINT]";
	}
	if (typeof val === "symbol") {
		return "[SYMBOL]";
	}
	if (typeof val === "function") {
		return "[FUNCTION]";
	}
	return val;
}

function redactArray(arr, ctx) {
	ctx.seen.add(arr);
	const nextCtx = { depth: ctx.depth + 1, seen: ctx.seen, isProd: ctx.isProd };
	const result = arr.map((item) => redactValue(item, nextCtx));
	ctx.seen.delete(arr);
	return result;
}

function redactProperty(key, val, ctx) {
	if (SENSITIVE_KEY_PATTERN.test(key)) {
		return "[REDACTED]";
	}
	if (key === "err" && isErrorLike(val)) {
		return serializeError(val, ctx.isProd);
	}
	const nextCtx = { depth: ctx.depth + 1, seen: ctx.seen, isProd: ctx.isProd };
	return redactValue(val, nextCtx);
}

function redactObject(obj, ctx) {
	ctx.seen.add(obj);
	const result = {};
	for (const [key, val] of Object.entries(obj)) {
		result[key] = redactProperty(key, val, ctx);
	}
	ctx.seen.delete(obj);
	return result;
}

function redactValue(val, ctx) {
	if (val === null || typeof val !== "object") {
		return redactPrimitive(val);
	}
	if (ctx.seen.has(val)) {
		return "[CIRCULAR]";
	}
	if (ctx.depth > MAX_DEPTH) {
		return "[DEPTH_EXCEEDED]";
	}
	if (Array.isArray(val)) {
		return redactArray(val, ctx);
	}
	return redactObject(val, ctx);
}

function normalizeLogArgs(arg1, arg2) {
	if (typeof arg1 === "string") {
		const fields = arg2 && typeof arg2 === "object" ? { ...arg2 } : {};
		return { msg: arg1, fields };
	}
	if (isErrorLike(arg1)) {
		const msg = typeof arg2 === "string" ? arg2 : arg1.message;
		return { msg, fields: { err: arg1 } };
	}
	if (arg1 && typeof arg1 === "object") {
		const fields = { ...arg1 };
		const msg = typeof arg2 === "string" ? arg2 : fields.msg || "";
		delete fields.msg;
		return { msg, fields };
	}
	return { msg: String(arg1 ?? ""), fields: {} };
}

function resolveTime(clock) {
	if (typeof clock === "function") {
		const val = clock();
		return val instanceof Date ? val.toISOString() : String(val);
	}
	if (clock instanceof Date) {
		return clock.toISOString();
	}
	if (typeof clock === "string") {
		return clock;
	}
	return new Date().toISOString();
}

function serializePayload(payload) {
	try {
		return JSON.stringify(payload);
	} catch {
		// Logger must never throw: serialize fallback placeholder
		return JSON.stringify({
			time: payload.time,
			level: payload.level,
			msg: payload.msg,
			placeholder: "[UNSERIALIZABLE]",
		});
	}
}

function writeToSink(sink, line) {
	try {
		const out = `${line}\n`;
		if (typeof sink === "function") {
			sink(out);
		} else if (Array.isArray(sink)) {
			sink.push(out);
		}
	} catch {
		// Logger must never throw: swallow failing sink
	}
}

function resolveLevelPriority(levelName) {
	const normalized = String(levelName || "").toLowerCase();
	return LOG_LEVELS[normalized] ?? LOG_LEVELS.info;
}

function shouldLog(callLevel, configuredLevel) {
	const callPriority = LOG_LEVELS[callLevel] ?? 0;
	const threshold = resolveLevelPriority(configuredLevel);
	return callPriority >= threshold;
}

function resolveRequestId(req) {
	const header =
		req.headers?.["x-request-id"] ||
		(typeof req.get === "function" ? req.get("x-request-id") : undefined);
	if (typeof header === "string" && REQUEST_ID_PATTERN.test(header)) {
		return header;
	}
	return crypto.randomUUID();
}

function resolveRequestPath(req) {
	const raw = req.path || req.url || "/";
	return raw.split("?")[0] || "/";
}

function attachFinishListener(res, onFinish) {
	if (typeof res.once === "function") {
		res.once("finish", onFinish);
	} else if (typeof res.on === "function") {
		res.on("finish", onFinish);
	}
}

function createRequestMiddleware(logFn) {
	return (req, res, next) => {
		const start = Date.now();
		const reqId = resolveRequestId(req);
		if (typeof res.setHeader === "function") {
			res.setHeader("x-request-id", reqId);
		}
		attachFinishListener(res, () => {
			const duration = Date.now() - start;
			const cleanPath = resolveRequestPath(req);
			const fields = {
				method: req.method,
				path: cleanPath,
				status: res.statusCode || 200,
				duration,
				requestId: reqId,
			};
			logFn(fields, `${req.method} ${cleanPath}`);
		});
		if (typeof next === "function") {
			next();
		}
	};
}

function emitLog(callLevel, arg1, arg2, state) {
	if (!shouldLog(callLevel, state.currentLevel)) return;
	const { msg, fields } = normalizeLogArgs(arg1, arg2);
	const time = resolveTime(state.clock);
	const raw = { time, level: callLevel, msg, ...state.base, ...fields };
	const ctx = { depth: 0, seen: new Set(), isProd: state.isProd };
	const payload = redactObject(raw, ctx);
	writeToSink(state.sink, serializePayload(payload));
}

function emitMetric(name, value, tags, state) {
	if (typeof value !== "number" || !Number.isFinite(value)) return;
	const time = resolveTime(state.clock);
	const metricFields = { name: String(name), value, ...state.base };
	if (tags && typeof tags === "object") {
		Object.assign(metricFields, tags);
		metricFields.tags = tags;
	}
	const ctx = { depth: 0, seen: new Set(), isProd: state.isProd };
	const payload = redactObject({ time, level: "metric", ...metricFields }, ctx);
	writeToSink(state.sink, serializePayload(payload));
}

export function createLogger({
	sink = process.stdout.write.bind(process.stdout),
	level = process.env.LOG_LEVEL || "info",
	clock = () => new Date(),
	base = {},
} = {}) {
	const currentLevel = level;
	const isProd = process.env.NODE_ENV === "production";
	const state = { sink, currentLevel, clock, base, isProd };

	return {
		debug: (a1, a2) => emitLog("debug", a1, a2, state),
		info: (a1, a2) => emitLog("info", a1, a2, state),
		warn: (a1, a2) => emitLog("warn", a1, a2, state),
		error: (a1, a2) => emitLog("error", a1, a2, state),
		child: (bindings = {}) =>
			createLogger({
				sink,
				level: currentLevel,
				clock,
				base: { ...base, ...bindings },
			}),
		metric: (name, value, tags) => emitMetric(name, value, tags, state),
		requestLogger: () =>
			createRequestMiddleware((f, m) => emitLog("info", f, m, state)),
	};
}

export const logger = createLogger();
export default logger;
