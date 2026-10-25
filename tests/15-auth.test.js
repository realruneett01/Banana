import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { createAuth } from "../backend/src/auth/index.js";
import { LoginLimiter } from "../backend/src/auth/rate-limit.js";
import { signSession, verifySession } from "../backend/src/auth/session.js";
import {
	UserStore,
	hashPassword,
	validatePassword,
	validateUsername,
	verifyPassword,
} from "../backend/src/auth/user-store.js";
import { createApp } from "../backend/src/server.js";
import { int, pick, rng, tmpDir } from "./helpers.js";

const PW = "correct horse battery";

test("usernames: accepted and rejected shapes", async (t) => {
	for (const n of ["alice", "bob.smith", "a-b_c", "user123", "ALICE", "abc"])
		await t.test(`accepts ${n}`, () => assert.equal(validateUsername(n), true));
	for (const n of [
		"",
		"ab",
		"-abc",
		".abc",
		"a b",
		"a/b",
		"a@b",
		"../x",
		"x".repeat(41),
		"é",
		null,
		undefined,
		5,
		"a\nb",
	])
		await t.test(`rejects ${JSON.stringify(n)}`, () =>
			assert.equal(validateUsername(n), false),
		);
});

test("passwords: length rules", async (t) => {
	for (const [p, ok] of [
		["x".repeat(10), true],
		["x".repeat(9), false],
		["", false],
		["x".repeat(256), true],
		["x".repeat(257), false],
		[null, false],
		[12345678901, false],
		["pässwörd-ünï", true],
	])
		await t.test(JSON.stringify(String(p).slice(0, 12)), () =>
			assert.equal(validatePassword(p) === null, ok),
		);
});

test("hashing: salted, verifiable, rejects tampering", async (t) => {
	const a = await hashPassword(PW);
	const b = await hashPassword(PW);
	assert.notEqual(a, b, "salts differ");
	assert.ok(!a.includes(PW));
	await t.test("correct", async () =>
		assert.equal(await verifyPassword(PW, a), true),
	);
	await t.test("wrong", async () =>
		assert.equal(await verifyPassword(`${PW}x`, a), false),
	);
	await t.test("empty", async () =>
		assert.equal(await verifyPassword("", a), false),
	);
	for (const bad of [
		"",
		"plain",
		"scrypt$1",
		"md5$1$2$3$a$b",
		"scrypt$16384$8$1$!!!$!!!",
		null,
		undefined,
	])
		await t.test(`garbage hash ${JSON.stringify(bad)}`, async () =>
			assert.equal(await verifyPassword(PW, bad), false),
		);
});

test("sessions: signed, expiring, tamper-proof (300 fuzzed tokens)", async (t) => {
	const secret = "s".repeat(48);
	const good = signSession(
		{ u: "alice", v: 1, exp: Date.now() + 60000 },
		secret,
	);
	await t.test("valid", () =>
		assert.equal(verifySession(good, secret).u, "alice"),
	);
	await t.test("wrong secret", () =>
		assert.equal(verifySession(good, "t".repeat(48)), null),
	);
	await t.test("expired", () =>
		assert.equal(
			verifySession(signSession({ u: "a", v: 1, exp: 1000 }, secret), secret),
			null,
		),
	);
	await t.test("missing fields", () =>
		assert.equal(verifySession(signSession({ u: "a" }, secret), secret), null),
	);
	await t.test("payload swapped", () => {
		const evil = signSession(
			{ u: "admin", v: 1, exp: Date.now() + 60000 },
			"x".repeat(48),
		);
		assert.equal(
			verifySession(`${evil.split(".")[0]}.${good.split(".")[1]}`, secret),
			null,
		);
	});
	const r = rng(9);
	for (let i = 0; i < 300; i++) {
		const junk = Array.from({ length: int(r, 0, 4) }, () =>
			Buffer.from(
				Array.from({ length: int(r, 0, 20) }, () => int(r, 0, 255)),
			).toString(pick(r, ["base64url", "hex", "utf8"])),
		).join(pick(r, [".", ".", "..", ""]));
		await t.test(`junk ${i}`, () =>
			assert.equal(verifySession(junk, secret), null),
		);
	}
	for (const v of [null, undefined, 5, {}, []])
		await t.test(`non-string ${typeof v}`, () =>
			assert.equal(verifySession(v, secret), null),
		);
});

test("limiter: blocks after N failures, per account and per IP, and expires", () => {
	let now = 0;
	const l = new LoginLimiter({
		maxPerAccount: 3,
		maxPerIp: 6,
		windowMs: 1000,
		now: () => now,
	});
	for (let i = 0; i < 3; i++) {
		assert.equal(l.check("1.1.1.1", "a").allowed, true);
		l.fail("1.1.1.1", "a");
	}
	assert.equal(l.check("1.1.1.1", "a").allowed, false);
	assert.equal(
		l.check("1.1.1.1", "b").allowed,
		true,
		"other account not blocked yet",
	);
	assert.equal(l.check("2.2.2.2", "a").allowed, true, "other IP not blocked");
	for (const u of ["b", "c", "d"]) l.fail("1.1.1.1", u);
	assert.equal(l.check("1.1.1.1", "zzz").allowed, false, "IP-wide block");
	now = 1500;
	assert.equal(l.check("1.1.1.1", "a").allowed, true, "window expired");
	l.fail("3.3.3.3", "a");
	l.success("3.3.3.3", "a");
	assert.equal(l.check("3.3.3.3", "a").allowed, true);
});

test("user store: lifecycle, persistence, file permissions", async () => {
	const dir = tmpDir();
	const file = path.join(dir, "users.json");
	const s = new UserStore(file);
	await s.create("Alice", PW, "admin");
	await assert.rejects(s.create("alice", PW), /already exists/);
	await assert.rejects(s.create("bob", "short"), /at least/);
	await assert.rejects(s.create("x", PW), /Username/);
	await assert.rejects(s.create("bob", PW, "root"), /Role/);
	assert.ok(await s.authenticate("ALICE", PW));
	assert.equal(await s.authenticate("alice", "nope"), null);
	assert.equal(await s.authenticate("ghost", PW), null);
	assert.equal(await s.authenticate("alice", undefined), null);
	assert.equal(await s.authenticate("alice", { $ne: 1 }), null);
	const again = new UserStore(file);
	assert.equal(again.count, 1);
	assert.ok(
		!fs.readFileSync(file, "utf8").includes(PW),
		"no plaintext password on disk",
	);
	if (process.platform !== "win32")
		assert.equal(fs.statSync(file).mode & 0o077, 0, "file is owner-only");
	const v = again.find("alice").tokenVersion;
	await again.setPassword("alice", "another long password");
	assert.equal(again.find("alice").tokenVersion, v + 1);
	assert.equal(await again.authenticate("alice", PW), null);
	again.setDisabled("alice", true);
	assert.equal(
		await again.authenticate("alice", "another long password"),
		null,
	);
	again.remove("alice");
	assert.equal(again.count, 0);
	assert.throws(() => again.remove("alice"), /No such user/);
});

test("user store: corrupt database is reported, not silently emptied", () => {
	const dir = tmpDir();
	const file = path.join(dir, "users.json");
	fs.writeFileSync(file, "{ not json");
	assert.throws(() => new UserStore(file), /Cannot read user database/);
});

let server;
let base;
let store;
let dir;
before(async () => {
	dir = tmpDir();
	store = new UserStore(path.join(dir, "users.json"));
	await store.create("alice", PW, "admin");
	const auth = createAuth({
		enabled: true,
		dataDir: dir,
		store,
		limiter: new LoginLimiter({ maxPerAccount: 5, maxPerIp: 1000 }),
	});
	await new Promise((r) => {
		server = createApp({ auth }).listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
	server.close();
	fs.rmSync(dir, { recursive: true, force: true });
});

const login = (username, password, extra = {}) =>
	fetch(`${base}/api/session/login`, {
		method: "POST",
		headers: { "content-type": "application/json", ...extra },
		body: JSON.stringify({ username, password }),
	});
const cookieOf = (res) => res.headers.get("set-cookie")?.split(";")[0];

test("anonymous visitors only see the login page; the app code is not served", async (t) => {
	for (const p of ["/", "/index.html", "/assets/anything.js", "/some/route"]) {
		await t.test(p, async () => {
			const r = await fetch(base + p, { redirect: "manual" });
			assert.equal(r.status, 302);
			assert.match(r.headers.get("location"), /^\/__login\/\?next=/);
		});
	}
	await t.test("login page is public", async () => {
		const r = await fetch(`${base}/__login/`);
		assert.equal(r.status, 200);
		assert.match(await r.text(), /Sign in/);
	});
	await t.test("login assets public", async () =>
		assert.equal((await fetch(`${base}/__login/login.js`)).status, 200),
	);
	await t.test("unknown login path 404", async () =>
		assert.equal((await fetch(`${base}/__login/nope.txt`)).status, 404),
	);
	await t.test("path traversal out of login dir", async () => {
		const r = await fetch(`${base}/__login/..%2f..%2fconfig.js`);
		assert.ok([400, 403, 404].includes(r.status), `status ${r.status}`);
	});
	await t.test("POST to a page is 401", async () =>
		assert.equal(
			(await fetch(`${base}/`, { method: "POST", redirect: "manual" })).status,
			401,
		),
	);
});

test("API requires a session; health check and session probe stay open", async (t) => {
	for (const p of [
		"/api/git/commits?repoPath=/tmp",
		"/api/github/repos",
		"/api/ai/status",
		"/api/board/pads",
	]) {
		await t.test(p, async () => {
			const r = await fetch(base + p);
			assert.equal(r.status, 401);
			assert.equal((await r.json()).loginRequired, true);
		});
	}
	await t.test("health", async () =>
		assert.ok(
			[200, 500, 503].includes(
				(await fetch(`${base}/api/health-check`)).status,
			),
		),
	);
	await t.test("session probe", async () => {
		const b = await (await fetch(`${base}/api/session`)).json();
		assert.deepEqual([b.enabled, b.authenticated], [true, false]);
	});
	await t.test("forged cookie", async () =>
		assert.equal(
			(
				await fetch(`${base}/api/ai/status`, {
					headers: { cookie: "banana_session=a.b" },
				})
			).status,
			401,
		),
	);
});

test("login: wrong credentials are indistinguishable, bad input is rejected", async (t) => {
	const wrongPw = await login("alice", "wrong password!");
	const noUser = await login("nobody", "wrong password!");
	assert.equal(wrongPw.status, 401);
	assert.equal(noUser.status, 401);
	assert.deepEqual(await wrongPw.json(), await noUser.json());
	for (const body of [
		{},
		{ username: "alice" },
		{ password: PW },
		{ username: { $ne: "" }, password: { $ne: "" } },
		{ username: "alice", password: ["x"] },
		{ username: 5, password: 5 },
		{ username: "alice", password: null },
	]) {
		await t.test(JSON.stringify(body), async () =>
			assert.equal((await login(body.username, body.password)).status, 401),
		);
	}
	await t.test("form-encoded rejected", async () => {
		const r = await fetch(`${base}/api/session/login`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: `username=alice&password=${PW}`,
		});
		assert.equal(r.status, 415);
	});
	await t.test("cross-origin login blocked", async () =>
		assert.equal(
			(await login("alice", PW, { origin: "https://evil.example" })).status,
			403,
		),
	);
});

test("login success: cookie flags, access, logout", async () => {
	const ok = await login("ALICE", PW);
	assert.equal(ok.status, 200);
	const sc = ok.headers.get("set-cookie");
	assert.match(sc, /HttpOnly/);
	assert.match(sc, /SameSite=Strict/);
	assert.ok(!sc.includes(PW));
	const cookie = cookieOf(ok);
	assert.equal(
		(await fetch(`${base}/api/ai/status`, { headers: { cookie } })).status,
		200,
	);
	const page = await fetch(base, { headers: { cookie } });
	assert.equal(page.status, 200);
	assert.match(await page.text(), /<div id="root"/);
	const me = await (
		await fetch(`${base}/api/session`, { headers: { cookie } })
	).json();
	assert.deepEqual(
		[me.authenticated, me.user.username, me.user.role],
		[true, "alice", "admin"],
	);
	const out = await fetch(`${base}/api/session/logout`, {
		method: "POST",
		headers: { cookie },
	});
	assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
});

test("state-changing API calls from another origin are refused even with a valid cookie", async () => {
	const cookie = cookieOf(await login("alice", PW));
	const r = await fetch(`${base}/api/git/init`, {
		method: "POST",
		headers: {
			cookie,
			origin: "https://evil.example",
			"content-type": "application/json",
		},
		body: JSON.stringify({ repoPath: "/tmp" }),
	});
	assert.equal(r.status, 403);
});

test("password change, disable and delete end existing sessions immediately", async () => {
	await store.create("carol", PW);
	const cookie = cookieOf(await login("carol", PW));
	assert.equal(
		(await fetch(`${base}/api/ai/status`, { headers: { cookie } })).status,
		200,
	);
	await store.setPassword("carol", "a brand new password");
	assert.equal(
		(await fetch(`${base}/api/ai/status`, { headers: { cookie } })).status,
		401,
	);
	const c2 = cookieOf(await login("carol", "a brand new password"));
	store.setDisabled("carol", true);
	assert.equal(
		(await fetch(`${base}/api/ai/status`, { headers: { cookie: c2 } })).status,
		401,
	);
	assert.equal((await login("carol", "a brand new password")).status, 401);
	store.setDisabled("carol", false);
	const c3 = cookieOf(await login("carol", "a brand new password"));
	store.remove("carol");
	assert.equal(
		(await fetch(`${base}/api/ai/status`, { headers: { cookie: c3 } })).status,
		401,
	);
});

test("brute force is throttled with 429 + Retry-After, and a correct password is then also refused", async () => {
	await store.create("dave", PW);
	for (let i = 0; i < 5; i++)
		assert.equal((await login("dave", `wrong-${i}-password`)).status, 401);
	const blocked = await login("dave", PW);
	assert.equal(blocked.status, 429);
	assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("with auth disabled the app is open (desktop mode)", async () => {
	const open = createApp({ auth: createAuth({ enabled: false }) });
	const s = await new Promise((r) => {
		const x = open.listen(0, "127.0.0.1", () => r(x));
	});
	try {
		const url = `http://127.0.0.1:${s.address().port}`;
		assert.equal((await fetch(`${url}/api/ai/status`)).status, 200);
		assert.equal(
			(await fetch(`${url}/__login/`, { redirect: "manual" })).status,
			200,
		);
	} finally {
		s.close();
	}
});
