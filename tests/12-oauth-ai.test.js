import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.GITHUB_CLIENT_ID = "cid";
process.env.GITHUB_CLIENT_SECRET = "csecret";
process.env.GEMINI_API_KEY = "";
const { createApp } = await import("../backend/src/server.js");

const realFetch = globalThis.fetch;
let server;
let base;
let outbound = [];
let outboundHandler = () => new Response("unmocked", { status: 500 });

before(async () => {
	await new Promise((r) => {
		server = createApp().listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
	globalThis.fetch = (url, init) => {
		if (String(url).startsWith(base)) return realFetch(url, init);
		outbound.push({ url: String(url), init });
		return Promise.resolve(outboundHandler(String(url), init));
	};
});
after(() => {
	globalThis.fetch = realFetch;
	server.close();
});

async function login() {
	const r = await fetch(`${base}/api/auth/github/url`);
	const body = await r.json();
	const state = new URL(body.url).searchParams.get("state");
	const cookie = r.headers.get("set-cookie").split(";")[0];
	return { body, state, cookie };
}

test("OAuth: URL carries a random state and the callback completes only with the matching cookie", async () => {
	const a = await login();
	const b = await login();
	assert.match(a.state, /^[0-9a-f]{32}$/);
	assert.notEqual(a.state, b.state);
	outboundHandler = () =>
		new Response(JSON.stringify({ access_token: "gho_abc 123" }), {
			status: 200,
		});
	const r = await fetch(
		`${base}/api/auth/github/callback?code=thecode&state=${a.state}`,
		{ headers: { cookie: a.cookie }, redirect: "manual" },
	);
	assert.equal(r.status, 302);
	const loc = r.headers.get("location");
	assert.ok(loc.includes("#github_token=gho_abc%20123"), loc);
	assert.ok(
		!loc.includes("?github_token"),
		"token must not be in the query string",
	);
});

test("OAuth: state from one login cannot be used with another login's cookie", async () => {
	const a = await login();
	const b = await login();
	const r = await fetch(
		`${base}/api/auth/github/callback?code=c&state=${a.state}`,
		{ headers: { cookie: b.cookie }, redirect: "manual" },
	);
	assert.equal(r.status, 400);
});

test("OAuth: GitHub error becomes a fragment error redirect, not a crash", async () => {
	const a = await login();
	outboundHandler = () =>
		new Response(
			JSON.stringify({
				error: "bad_verification_code",
				error_description: "expired",
			}),
			{ status: 200 },
		);
	const r = await fetch(
		`${base}/api/auth/github/callback?code=c&state=${a.state}`,
		{ headers: { cookie: a.cookie }, redirect: "manual" },
	);
	assert.equal(r.status, 302);
	assert.match(r.headers.get("location"), /#github_error=.*expired/);
});

function sse(lines, { trailingNewline = true } = {}) {
	return new Response(lines.join("\n") + (trailingNewline ? "\n" : ""), {
		status: 200,
	});
}
const chunk = (t) =>
	`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}`;
const events = (text) =>
	text
		.split("\n\n")
		.filter(Boolean)
		.map((e) => JSON.parse(e.replace(/^data: /, "")));

async function chat(body, headers = {}) {
	const r = await fetch(`${base}/api/ai/chat`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
	return events(await r.text());
}

test("AI: no key -> clear key-required error event", async () => {
	const ev = await chat({ messages: [{ role: "user", content: "hi" }] });
	assert.equal(ev.at(-1).isKeyRequired, true);
});

test("AI: streams chunks, key goes in a header and not in the URL", async () => {
	outbound = [];
	outboundHandler = () => sse([chunk("Hel"), "", chunk("lo")]);
	const ev = await chat(
		{ messages: [{ role: "user", content: "hi" }] },
		{ "x-gemini-api-key": "KEY123" },
	);
	assert.equal(
		ev
			.filter((e) => e.text)
			.map((e) => e.text)
			.join(""),
		"Hello",
	);
	assert.equal(ev.at(-1).done, true);
	assert.ok(!outbound[0].url.includes("KEY123"));
	assert.equal(outbound[0].init.headers["x-goog-api-key"], "KEY123");
});

test("AI: last event without trailing newline is not lost", async () => {
	outboundHandler = () =>
		sse([chunk("A"), chunk("B")], { trailingNewline: false });
	const ev = await chat(
		{ messages: [{ role: "user", content: "x" }] },
		{ "x-gemini-api-key": "k" },
	);
	assert.equal(
		ev
			.filter((e) => e.text)
			.map((e) => e.text)
			.join(""),
		"AB",
	);
});

test("AI: malicious model names never reach the URL", async (t) => {
	for (const model of [
		"../../v1/files",
		"gemini?x=1",
		"a/b",
		"m#frag",
		"x y",
		"m:generate",
	]) {
		await t.test(model, async () => {
			outbound = [];
			outboundHandler = () => sse([chunk("x")]);
			const ev = await chat(
				{ messages: [{ role: "user", content: "x" }], model },
				{ "x-gemini-api-key": "k" },
			);
			assert.ok(ev.at(-1).error, "error event");
			assert.ok(
				!outbound.some((o) => o.url.includes(model)),
				"model not used in a request",
			);
		});
	}
});

test("AI: upstream errors and 404 fallback", async () => {
	outbound = [];
	let n = 0;
	outboundHandler = () =>
		n++ === 0
			? new Response(JSON.stringify({ error: { message: "nf" } }), {
					status: 404,
				})
			: sse([chunk("ok")]);
	const ev = await chat(
		{ messages: [{ role: "user", content: "x" }] },
		{ "x-gemini-api-key": "k" },
	);
	assert.equal(ev.at(-1).done, true);
	assert.equal(outbound.length, 2);
	outboundHandler = () =>
		new Response(JSON.stringify({ error: { message: "quota" } }), {
			status: 429,
		});
	const ev2 = await chat(
		{ messages: [{ role: "user", content: "x" }] },
		{ "x-gemini-api-key": "k" },
	);
	assert.match(ev2.at(-1).error, /quota/);
});

test("AI: bad message payloads produce an error event, not a hang", async (t) => {
	for (const messages of ["str", 5, { a: 1 }, [null], [5]]) {
		await t.test(JSON.stringify(messages), async () => {
			outboundHandler = () => sse([chunk("x")]);
			const ev = await chat({ messages }, { "x-gemini-api-key": "k" });
			assert.ok(ev.length >= 1);
		});
	}
});
