// Real-browser test of the sign-in flow. Skipped without Playwright or a built UI.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAuth } from "../backend/src/auth/index.js";
import { LoginLimiter } from "../backend/src/auth/rate-limit.js";
import { UserStore } from "../backend/src/auth/user-store.js";
import { createApp } from "../backend/src/server.js";
import { tmpDir } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let playwright = null;
try {
	playwright = createRequire(import.meta.url)("playwright");
} catch {
	/* not installed */
}
const skip = !playwright
	? "playwright not installed"
	: !fs.existsSync(path.join(root, "frontend", "dist", "index.html"))
		? "frontend/dist not built"
		: false;

let server;
let browser;
let base;
let dir;
before(async () => {
	if (skip) return;
	dir = tmpDir();
	const store = new UserStore(path.join(dir, "users.json"));
	await store.create("alice", "correct horse battery", "admin");
	const auth = createAuth({
		enabled: true,
		dataDir: dir,
		store,
		limiter: new LoginLimiter({ maxPerAccount: 50 }),
	});
	await new Promise((r) => {
		server = createApp({ auth }).listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
	browser = await playwright.chromium.launch();
});
after(async () => {
	await browser?.close();
	server?.close();
	if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("anonymous -> login -> app -> sign out -> login", {
	skip,
	timeout: 90000,
}, async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));

	await page.goto(`${base}/`, { waitUntil: "networkidle" });
	assert.match(page.url(), /\/__login\/\?next=%2F$/);
	if (process.env.BANANA_SCREENSHOT_DIR)
		await page.screenshot({
			path: path.join(process.env.BANANA_SCREENSHOT_DIR, "login.png"),
		});

	await page.fill("#username", "alice");
	await page.fill("#password", "wrong password!!");
	await page.click("#submit");
	await page.waitForSelector("#error:not([hidden])");
	assert.match(
		await page.textContent("#error"),
		/Invalid username or password/,
	);
	assert.match(page.url(), /__login/);

	await page.fill("#password", "correct horse battery");
	await Promise.all([page.waitForURL(`${base}/`), page.click("#submit")]);
	await page.waitForSelector("text=alice · Sign out");
	assert.ok((await page.locator("body").innerText()).includes("Banana"));

	await page.click("text=alice · Sign out");
	await page.waitForURL(/__login/);
	await page.goto(`${base}/`, { waitUntil: "networkidle" });
	assert.match(page.url(), /__login/, "session really ended");
	assert.deepEqual(errors, []);
	await page.close();
});

test("login page refuses to redirect to another site via ?next=", {
	skip,
	timeout: 60000,
}, async (t) => {
	for (const next of [
		"//evil.example/x",
		"https://evil.example",
		"/\\evil.example",
		"javascript:alert(1)",
	]) {
		await t.test(next, async () => {
			const page = await browser.newPage();
			await page.goto(`${base}/__login/?next=${encodeURIComponent(next)}`, {
				waitUntil: "networkidle",
			});
			await page.fill("#username", "alice");
			await page.fill("#password", "correct horse battery");
			await Promise.all([
				page.waitForURL((u) => u.origin === base),
				page.click("#submit"),
			]);
			assert.equal(new URL(page.url()).origin, base);
			await page.close();
		});
	}
});
