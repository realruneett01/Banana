import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import cors from "cors";
import express from "express";
import {
	accessGuard,
	corsOptionsFor,
	isLoopbackHost,
	loginHandler,
	tokensMatch,
} from "../backend/src/access-control.js";

let server;
let base;
const TOKEN = "s3cret-token";
before(async () => {
	const app = express();
	app.use(cors(corsOptionsFor("https://banana.example.com")));
	app.get("/login", loginHandler(TOKEN));
	app.use("/api", accessGuard(TOKEN));
	app.get("/api/health-check", (_q, r) => r.json({ ok: 1 }));
	app.get("/api/data", (_q, r) => r.json({ secret: 1 }));
	await new Promise((r) => {
		server = app.listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("tokensMatch", async (t) => {
	for (const [p, e] of [
		[TOKEN, true],
		["", false],
		["x", false],
		[`${TOKEN}x`, false],
		[undefined, false],
		[null, false],
		[5, false],
		[TOKEN.toUpperCase(), false],
	])
		await t.test(String(p), () => assert.equal(tokensMatch(TOKEN, p), e));
});

test("isLoopbackHost", async (t) => {
	for (const [h, e] of [
		["127.0.0.1", true],
		["localhost", true],
		["LOCALHOST", true],
		["::1", true],
		["0.0.0.0", false],
		["192.168.1.5", false],
		["example.com", false],
	])
		await t.test(h, () => assert.equal(isLoopbackHost(h), e));
});

test("API requires the token; health check stays open", async (t) => {
	await t.test("health open", async () =>
		assert.equal((await fetch(`${base}/api/health-check`)).status, 200),
	);
	await t.test("no token", async () =>
		assert.equal((await fetch(`${base}/api/data`)).status, 401),
	);
	await t.test("wrong header", async () =>
		assert.equal(
			(
				await fetch(`${base}/api/data`, {
					headers: { "x-banana-token": "nope" },
				})
			).status,
			401,
		),
	);
	await t.test("right header", async () =>
		assert.equal(
			(
				await fetch(`${base}/api/data`, {
					headers: { "x-banana-token": TOKEN },
				})
			).status,
			200,
		),
	);
	await t.test("wrong cookie", async () =>
		assert.equal(
			(
				await fetch(`${base}/api/data`, {
					headers: { cookie: "banana_access=bad" },
				})
			).status,
			401,
		),
	);
	await t.test("malformed cookie does not crash", async () =>
		assert.equal(
			(
				await fetch(`${base}/api/data`, {
					headers: { cookie: "banana_access=%E0%A4%A" },
				})
			).status,
			401,
		),
	);
});

test("login sets an HttpOnly SameSite=Strict cookie that unlocks the API", async () => {
	const bad = await fetch(`${base}/login?token=wrong`, { redirect: "manual" });
	assert.equal(bad.status, 401);
	const ok = await fetch(`${base}/login?token=${TOKEN}`, {
		redirect: "manual",
	});
	assert.equal(ok.status, 302);
	const cookie = ok.headers.get("set-cookie");
	assert.match(cookie, /HttpOnly/);
	assert.match(cookie, /SameSite=Strict/);
	const r = await fetch(`${base}/api/data`, {
		headers: { cookie: cookie.split(";")[0] },
	});
	assert.equal(r.status, 200);
});

function preflight(origin, host) {
	return new Promise((resolve, reject) => {
		const u = new URL(base);
		const req = http.request(
			{
				host: u.hostname,
				port: u.port,
				path: "/api/health-check",
				method: "GET",
				headers: { origin, ...(host ? { host } : {}) },
			},
			(res) => {
				res.resume();
				resolve(res.headers["access-control-allow-origin"] ?? null);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

test("CORS only allows same-origin, loopback and the configured frontend", async (t) => {
	await t.test("evil origin blocked", async () =>
		assert.equal(await preflight("https://evil.example"), null),
	);
	await t.test("evil lookalike blocked", async () =>
		assert.equal(await preflight("https://banana.example.com.evil.io"), null),
	);
	await t.test("configured frontend allowed", async () =>
		assert.equal(
			await preflight("https://banana.example.com"),
			"https://banana.example.com",
		),
	);
	await t.test("vite dev allowed", async () =>
		assert.equal(
			await preflight("http://localhost:5173"),
			"http://localhost:5173",
		),
	);
	await t.test("loopback ip allowed", async () =>
		assert.equal(
			await preflight("http://127.0.0.1:5173"),
			"http://127.0.0.1:5173",
		),
	);
	await t.test("same origin allowed", async () =>
		assert.equal(await preflight(base), base),
	);
});
