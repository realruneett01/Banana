import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { createRegistry } from "../engine/tool-registry.js";
import { registerCommitTools } from "../engine/tools/commit-tools.js";
import { registerDesignTools } from "../engine/tools/design-tools.js";
import { registerDiffTools } from "../engine/tools/diff-tools.js";
import { registerKicadTools } from "../engine/tools/kicad-tools.js";
import { registerRouteTools } from "../engine/tools/route-tools.js";
import { createMcpServer } from "./server.js";

const MIN_TOKEN_LENGTH = 32;
const SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_HOSTS = ["127.0.0.1", "localhost"];

function envList(name) {
	return String(process.env[name] || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function hostnameOf(hostHeader) {
	try {
		return new URL(`http://${hostHeader}`).hostname;
	} catch {
		return "";
	}
}

function bearerMatches(header, expected) {
	const given = Buffer.from(String(header || "").replace(/^Bearer /, ""));
	return (
		given.length === expected.length && crypto.timingSafeEqual(given, expected)
	);
}

function createGuard({ token, allowedHosts, allowedOrigins }) {
	const expected = Buffer.from(token);
	return (req, res, next) => {
		if (!allowedHosts.includes(hostnameOf(req.headers.host))) {
			return res.status(403).json({ error: "Forbidden: Invalid Host header" });
		}
		const origin = req.headers.origin;
		if (origin && !allowedOrigins.includes(origin)) {
			return res.status(403).json({ error: "Forbidden: Invalid Origin" });
		}
		if (!bearerMatches(req.headers.authorization, expected)) {
			res.set("WWW-Authenticate", 'Bearer realm="banana-mcp"');
			return res.status(401).json({ error: "Unauthorized" });
		}
		next();
	};
}

function createDefaultRegistry() {
	const registry = createRegistry();
	registerDiffTools(registry);
	registerKicadTools(registry);
	registerDesignTools(registry);
	registerRouteTools(registry);
	registerCommitTools(registry);
	return registry;
}

function createSessionStore(maxSessions) {
	const sessions = new Map();
	const drop = (id) => {
		const entry = sessions.get(id);
		sessions.delete(id);
		entry?.transport.close().catch(() => {});
	};
	const sweep = () => {
		const cutoff = Date.now() - SESSION_TTL_MS;
		for (const [id, entry] of sessions) {
			if (entry.lastSeen < cutoff) drop(id);
		}
	};
	const add = (id, transport) => {
		while (sessions.size >= maxSessions) drop(sessions.keys().next().value);
		sessions.set(id, { transport, lastSeen: Date.now() });
	};
	const get = (id) => {
		const entry = sessions.get(id);
		if (entry) entry.lastSeen = Date.now();
		return entry?.transport;
	};
	return { add, get, drop, sweep };
}

async function openSession(store, createServer) {
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: () => crypto.randomUUID(),
		onsessioninitialized: (id) => store.add(id, transport),
	});
	transport.onclose = () => {
		if (transport.sessionId) store.drop(transport.sessionId);
	};
	await createServer().connect(transport);
	return transport;
}

function rpcError(res, status, message) {
	return res
		.status(status)
		.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

function createHandler(store, createServer) {
	return async (req, res) => {
		store.sweep();
		const sid = req.headers["mcp-session-id"];
		if (sid) {
			const transport = store.get(sid);
			if (!transport) return rpcError(res, 404, "Session not found");
			return transport.handleRequest(req, res, req.body);
		}
		if (req.method !== "POST" || !isInitializeRequest(req.body)) {
			return rpcError(res, 400, "Missing Mcp-Session-Id header");
		}
		const transport = await openSession(store, createServer);
		return transport.handleRequest(req, res, req.body);
	};
}

/**
 * Streamable HTTP endpoint at /mcp for web AI clients. Disabled (404) unless a bearer token of
 * at least 32 chars is configured (BANANA_MCP_TOKEN). Extra hosts/origins come from
 * BANANA_MCP_ALLOWED_HOSTS / BANANA_MCP_ALLOWED_ORIGINS (comma lists).
 */
export function createMcpHttpRouter(options = {}) {
	const token = options.token ?? process.env.BANANA_MCP_TOKEN ?? "";
	const router = express.Router();
	if (token.length < MIN_TOKEN_LENGTH) {
		router.all("/mcp", (_req, res) => res.status(404).end());
		return router;
	}
	const guard = createGuard({
		token,
		allowedHosts: [...DEFAULT_HOSTS, ...envList("BANANA_MCP_ALLOWED_HOSTS")],
		allowedOrigins: envList("BANANA_MCP_ALLOWED_ORIGINS"),
	});
	const store = createSessionStore(options.maxSessions ?? 50);
	const createServer =
		options.createServer ??
		(() => createMcpServer({ registry: createDefaultRegistry() }));
	const handler = createHandler(store, createServer);
	router.all("/mcp", express.json({ limit: "1mb" }), guard, handler);
	return router;
}
