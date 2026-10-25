// Loads the built UI in headless Chromium and fails on any uncaught page error.
// Skipped when Playwright/Chromium or frontend/dist are not available.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../backend/src/server.js";

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
before(async () => {
	if (skip) return;
	await new Promise((r) => {
		server = createApp().listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
	browser = await playwright.chromium.launch();
});
after(async () => {
	await browser?.close();
	server?.close();
});

test("UI loads, renders, and raises no page errors", {
	skip,
	timeout: 60000,
}, async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(base, { waitUntil: "networkidle" });
	const bodyText = await page.locator("body").innerText();
	assert.ok(bodyText.length > 0, "page rendered content");
	assert.deepEqual(errors, []);
	await page.close();
});

test("GitHub login fragment is consumed and removed from the URL", {
	skip,
	timeout: 60000,
}, async () => {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	// The backend would reject a fake token and the UI would then (correctly) discard it.
	await page.route("**/api/auth/github/verify*", (route) =>
		route.fulfill({
			json: { authenticated: true, user: { login: "tester", name: "Tester" } },
		}),
	);
	await page.route("**/api/github/repos*", (route) =>
		route.fulfill({ json: { repos: [] } }),
	);
	await page.goto(`${base}/#github_token=fake_token_123`, {
		waitUntil: "networkidle",
	});
	const stored = await page.evaluate(() =>
		localStorage.getItem("banana:githubToken"),
	);
	assert.equal(stored, "fake_token_123");
	assert.ok(!page.url().includes("fake_token_123"), page.url());
	assert.deepEqual(errors, []);
	await page.close();
});

test("SPA fallback serves the app for client-side routes but JSON 404 for API", {
	skip,
}, async () => {
	assert.match(
		await (await fetch(`${base}/some/route`)).text(),
		/<div id="root"/,
	);
	assert.equal((await fetch(`${base}/api/missing`)).status, 404);
});
