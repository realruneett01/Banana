// Browser tests for the download website (served from a temp copy with a fake release).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteSrc = path.join(root, "website");
let playwright = null;
try {
	playwright = createRequire(import.meta.url)("playwright");
} catch {
	/* not installed */
}
const skip = !playwright ? "playwright not installed" : false;

const TYPES = {
	".html": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	".svg": "image/svg+xml",
};
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

function serve(dir) {
	return new Promise((resolve) => {
		const s = http.createServer((req, res) => {
			const rel = decodeURIComponent(req.url.split("?")[0]);
			let file = path.join(dir, rel === "/" ? "index.html" : rel);
			if (
				!file.startsWith(dir) ||
				!fs.existsSync(file) ||
				fs.statSync(file).isDirectory()
			) {
				res.writeHead(404);
				return res.end("not found");
			}
			res.writeHead(200, {
				"content-type": TYPES[path.extname(file)] || "application/octet-stream",
				"content-security-policy": CSP,
			});
			fs.createReadStream(file).pipe(res);
		});
		s.listen(0, "127.0.0.1", () => resolve(s));
	});
}

function makeSite(manifest, payload) {
	const dir = tmpDir("banana-site-");
	for (const f of ["index.html", "styles.css", "site.js", "favicon.svg"])
		fs.copyFileSync(path.join(siteSrc, f), path.join(dir, f));
	if (payload) {
		fs.mkdirSync(path.join(dir, "downloads"));
		fs.writeFileSync(
			path.join(dir, "downloads", "banana-9.9.9-portable.zip"),
			payload,
		);
	}
	if (manifest)
		fs.writeFileSync(path.join(dir, "releases.json"), JSON.stringify(manifest));
	return dir;
}

const payload = crypto.randomBytes(4096);
const sha = crypto.createHash("sha256").update(payload).digest("hex");
const goodManifest = {
	version: "9.9.9",
	released: "2026-01-02",
	assets: [
		{ name: "banana-9.9.9-portable.zip", bytes: payload.length, sha256: sha },
	],
};

let browser;
const servers = [];
const dirs = [];
async function site(manifest, withPayload = true) {
	const dir = makeSite(manifest, withPayload ? payload : null);
	dirs.push(dir);
	const s = await serve(dir);
	servers.push(s);
	return `http://127.0.0.1:${s.address().port}/`;
}
before(async () => {
	if (!skip) browser = await playwright.chromium.launch();
});
after(async () => {
	await browser?.close();
	for (const s of servers) s.close();
	for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test("download is gated by the terms checkbox and delivers the exact published file", {
	skip,
	timeout: 60000,
}, async () => {
	const url = await site(goodManifest);
	const page = await browser.newPage({ acceptDownloads: true });
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await page.goto(url, { waitUntil: "networkidle" });

	const btn = page.locator("#dl-buttons a", { hasText: "Download for" });
	assert.equal(await btn.getAttribute("aria-disabled"), "true");
	assert.equal(
		await btn.getAttribute("href"),
		null,
		"no link target before accepting terms",
	);
	await btn.click({ force: true });
	assert.equal(
		await page.evaluate(() => document.activeElement.id),
		"terms",
		"clicking a locked button focuses the checkbox",
	);

	assert.ok((await page.textContent("#dl-title")).includes("9.9.9"));
	assert.ok((await page.textContent(".hash code")).includes(sha));

	await page.check("#terms");
	assert.equal(await btn.getAttribute("aria-disabled"), null);
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		btn.click(),
	]);
	assert.equal(download.suggestedFilename(), "banana-9.9.9-portable.zip");
	const saved = fs.readFileSync(await download.path());
	assert.equal(
		crypto.createHash("sha256").update(saved).digest("hex"),
		sha,
		"downloaded bytes match the published checksum",
	);

	// install snippets use the real file name
	assert.ok(
		(await page.locator("code.copy").first().textContent()).includes(
			"banana-9.9.9-portable.zip",
		) ||
			(await page.locator("#panel-win code.copy").textContent()).includes(
				"9.9.9",
			),
	);
	assert.deepEqual(errors, []);
	await page.close();
});

test("no published release -> clear 'not available' state, nothing downloadable", {
	skip,
	timeout: 60000,
}, async () => {
	const url = await site(null, false);
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: "networkidle" });
	assert.match(
		await page.textContent("#dl-meta"),
		/No release has been published/,
	);
	assert.equal(await page.locator("#dl-buttons a").count(), 0);
	assert.equal(await page.locator("#terms").isDisabled(), true);
	await page.close();
});

test("malformed or hostile manifests are rejected", {
	skip,
	timeout: 90000,
}, async (t) => {
	const bad = [
		[
			"version with markup",
			{ ...goodManifest, version: "<img src=x onerror=alert(1)>" },
		],
		["no assets", { version: "1.0.0", assets: [] }],
		["assets not an array", { version: "1.0.0", assets: "x" }],
		["null", null],
	];
	for (const [name, manifest] of bad) {
		await t.test(name, async () => {
			const url = await site(manifest, false);
			const page = await browser.newPage();
			let dialog = false;
			page.on("dialog", (d) => {
				dialog = true;
				d.dismiss();
			});
			await page.goto(url, { waitUntil: "networkidle" });
			assert.match(
				await page.textContent("#dl-meta"),
				/No release has been published/,
			);
			assert.equal(dialog, false);
			await page.close();
		});
	}
	await t.test(
		"asset names that are not plain file names are dropped, not rendered",
		async () => {
			const evil = {
				version: "1.0.0",
				released: "x",
				assets: [
					{
						name: 'a"><script>window.__x=1</script>.zip',
						bytes: 1,
						sha256: "0".repeat(64),
					},
				],
			};
			const url = await site(evil, false);
			const page = await browser.newPage();
			await page.goto(url, { waitUntil: "networkidle" });
			assert.equal(await page.evaluate(() => window.__x), undefined);
			assert.equal(await page.locator("#dl-buttons script").count(), 0);
			assert.match(
				await page.textContent("#dl-meta"),
				/No release has been published/,
			);
			await page.close();
		},
	);
});

test("page works on a phone: no horizontal scroll, tabs reachable by keyboard", {
	skip,
	timeout: 60000,
}, async () => {
	const url = await site(goodManifest);
	const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
	await page.goto(url, { waitUntil: "networkidle" });
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);

	await page.focus('.tab[aria-selected="true"]');
	await page.keyboard.press("ArrowRight");
	const selected = await page.getAttribute(
		'.tab[aria-selected="true"]',
		"data-os",
	);
	assert.ok(["windows", "macos", "linux"].includes(selected));
	const visiblePanels = await page
		.locator('[role="tabpanel"]:not([hidden])')
		.count();
	assert.equal(visiblePanels, 1);
	await page.close();
});

test("slider moves the reveal line", { skip, timeout: 60000 }, async () => {
	const url = await site(goodManifest);
	const page = await browser.newPage({ reducedMotion: "reduce" });
	await page.goto(url, { waitUntil: "networkidle" });
	await page.locator("#compare").fill("80");
	assert.equal(Number(await page.getAttribute("#divider", "x1")), 448);
	await page.locator("#compare").fill("10");
	assert.equal(Number(await page.getAttribute("#divider", "x1")), 56);
	await page.close();
});

const platformManifest = {
	version: "9.9.9",
	released: "2026-01-02",
	assets: [
		{
			name: "banana-9.9.9-portable.zip",
			bytes: 10,
			sha256: "a".repeat(64),
			os: "any",
			arch: "any",
			label: "Any system (Node.js not included)",
			bundlesNode: false,
		},
		{
			name: "banana-9.9.9-windows-x64.zip",
			bytes: 40e6,
			sha256: "b".repeat(64),
			os: "windows",
			arch: "x64",
			label: "Windows (64-bit)",
			bundlesNode: true,
		},
		{
			name: "banana-9.9.9-windows-arm64.zip",
			bytes: 30e6,
			sha256: "c".repeat(64),
			os: "windows",
			arch: "arm64",
			label: "Windows on ARM",
			bundlesNode: true,
		},
		{
			name: "banana-9.9.9-macos-arm64.zip",
			bytes: 37e6,
			sha256: "d".repeat(64),
			os: "macos",
			arch: "arm64",
			label: "macOS (Apple silicon)",
			bundlesNode: true,
		},
		{
			name: "banana-9.9.9-macos-x64.zip",
			bytes: 38e6,
			sha256: "e".repeat(64),
			os: "macos",
			arch: "x64",
			label: "macOS (Intel)",
			bundlesNode: true,
		},
		{
			name: "banana-9.9.9-linux-x64.zip",
			bytes: 43e6,
			sha256: "f".repeat(64),
			os: "linux",
			arch: "x64",
			label: "Linux (x64)",
			bundlesNode: true,
		},
		{ name: "SHA256SUMS", bytes: 9, sha256: "1".repeat(64) },
	],
};

test("the download matches the visitor's operating system", {
	skip,
	timeout: 90000,
}, async (t) => {
	const cases = [
		[
			"Win32",
			"Windows",
			"banana-9.9.9-windows-x64.zip",
			/Download for Windows \(64-bit\)/,
			/includes Node\.js/,
		],
		[
			"MacIntel",
			"macOS",
			"banana-9.9.9-macos-arm64.zip",
			/Download for macOS \(Apple silicon\)/,
			/includes Node\.js/,
		],
		[
			"Linux x86_64",
			"Linux",
			"banana-9.9.9-linux-x64.zip",
			/Download for Linux \(x64\)/,
			/includes Node\.js/,
		],
		[
			"Plan9",
			null,
			"banana-9.9.9-portable.zip",
			/Download for any system/,
			/needs Node\.js/,
		],
	];
	for (const [platform, name, expectedFile, buttonText, metaText] of cases) {
		await t.test(String(name || platform), async () => {
			const url = await site(platformManifest, false);
			const page = await browser.newPage();
			await page.addInitScript((p) => {
				Object.defineProperty(navigator, "platform", { get: () => p });
				Object.defineProperty(navigator, "userAgentData", {
					get: () => undefined,
				});
			}, platform);
			await page.goto(url, { waitUntil: "networkidle" });
			const primary = page.locator("#dl-buttons a.btn-primary");
			assert.match(await primary.textContent(), buttonText);
			assert.equal(
				await primary.getAttribute("data-href"),
				`downloads/${expectedFile}`,
			);
			assert.match(await page.textContent("#dl-meta"), metaText);
			assert.equal((await page.textContent(".hash code")).length, 64);
			if (name === "macOS")
				assert.equal(
					await page
						.locator("#dl-buttons a", { hasText: "macOS (Intel)" })
						.count(),
					1,
					"Intel alternative offered",
				);
			assert.ok(
				(await page.locator(".more a").count()) >= 3,
				"other systems listed",
			);
			await page.close();
		});
	}
});
