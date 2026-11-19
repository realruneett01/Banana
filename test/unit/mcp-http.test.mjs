import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createMcpHttpRouter } from "../../backend/src/mcp/http.js";

const TOKEN = "t".repeat(40);
const INIT = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "1" },
	},
};
const ACCEPT = "application/json, text/event-stream";

async function listen(routerOptions) {
	const app = express();
	app.use(express.json());
	app.use(createMcpHttpRouter(routerOptions));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});
	return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function post(base, body, headers = {}) {
	return fetch(`${base}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: ACCEPT,
			authorization: `Bearer ${TOKEN}`,
			...headers,
		},
		body: JSON.stringify(body),
	});
}

async function rpcResult(res) {
	const text = await res.text();
	const data = text.match(/^data: (.*)$/m)?.[1] ?? text;
	return JSON.parse(data);
}

async function initSession(base) {
	const res = await post(base, INIT);
	assert.equal(res.status, 200);
	await res.text();
	return res.headers.get("mcp-session-id");
}

describe("MCP HTTP router: disabled", () => {
	let ctx;
	before(async () => {
		ctx = await listen({ token: "" });
	});
	after(() => ctx.server.close());

	test("no token configured -> 404", async () => {
		const res = await post(ctx.base, INIT);
		assert.equal(res.status, 404);
	});

	test("short token -> 404", async () => {
		ctx.server.close();
		ctx = await listen({ token: "short" });
		const res = await post(ctx.base, INIT);
		assert.equal(res.status, 404);
	});
});

describe("MCP HTTP router: enabled", () => {
	let ctx;
	before(async () => {
		ctx = await listen({ token: TOKEN, maxSessions: 2 });
	});
	after(() => ctx.server.close());

	test("wrong or missing bearer -> 401 with WWW-Authenticate", async () => {
		for (const authorization of [`Bearer ${"x".repeat(40)}`, ""]) {
			const res = await post(ctx.base, INIT, { authorization });
			assert.equal(res.status, 401);
			assert.match(res.headers.get("www-authenticate"), /^Bearer/);
		}
	});

	test("foreign Host -> 403", async () => {
		// fetch drops a custom Host header, so use node:http directly
		const status = await new Promise((resolve, reject) => {
			const req = http.request(`${ctx.base}/mcp`, {
				method: "POST",
				headers: {
					host: "evil.example",
					"content-type": "application/json",
					accept: ACCEPT,
					authorization: `Bearer ${TOKEN}`,
				},
			});
			req.on("response", (r) => resolve(r.statusCode) || r.resume());
			req.on("error", reject);
			req.end(JSON.stringify(INIT));
		});
		assert.equal(status, 403);
	});

	test("foreign Origin -> 403", async () => {
		const res = await post(ctx.base, INIT, { origin: "https://evil.example" });
		assert.equal(res.status, 403);
	});

	test("initialize returns a session; tools/list works in it", async () => {
		const sid = await initSession(ctx.base);
		assert.ok(sid);
		const res = await post(
			ctx.base,
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
			{ "mcp-session-id": sid, "mcp-protocol-version": "2025-06-18" },
		);
		assert.equal(res.status, 200);
		const msg = await rpcResult(res);
		assert.ok(msg.result.tools.length > 0);
		assert.ok(msg.result.tools.some((t) => t.name === "erc.project"));
	});

	test("unknown session -> 404; non-initialize without session -> 400", async () => {
		const unknown = await post(
			ctx.base,
			{ jsonrpc: "2.0", id: 3, method: "tools/list" },
			{ "mcp-session-id": "nope" },
		);
		assert.equal(unknown.status, 404);
		const missing = await post(ctx.base, {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/list",
		});
		assert.equal(missing.status, 400);
	});

	test("session cap evicts the oldest session", async () => {
		const first = await initSession(ctx.base);
		await initSession(ctx.base);
		await initSession(ctx.base);
		const res = await post(
			ctx.base,
			{ jsonrpc: "2.0", id: 5, method: "tools/list" },
			{ "mcp-session-id": first },
		);
		assert.equal(res.status, 404);
	});
});
