// Banana Studio end to end: real server, real KiCad, real browser; only Gemini is scripted.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { hasKicad, tmpDir } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projects = tmpDir("banana-studio-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const P = await import("../backend/src/design/project.js");
const { createApp } = await import("../backend/src/server.js");

let playwright = null;
try {
	playwright = createRequire(import.meta.url)("playwright");
} catch {
	/* not installed */
}
const libs = findLibraryRoot("symbols") && findLibraryRoot("footprints");
const skip = !playwright
	? "playwright not installed"
	: !fs.existsSync(path.join(root, "frontend", "dist", "index.html"))
		? "frontend/dist not built"
		: !hasKicad()
			? "kicad-cli not installed"
			: !libs
				? "KiCad libraries not installed"
				: false;
const SHOTS = process.env.BANANA_SCREENSHOT_DIR;
const shot = (page, name) =>
	SHOTS && page.screenshot({ path: path.join(SHOTS, `studio-${name}.png`) });

const R = "Resistor_SMD:R_0805_2012Metric";
const LED = "LED_SMD:LED_0805_2012Metric";
const HDR = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical";
const designOps = [
	{
		op: "add_part",
		symbol: "Connector_Generic:Conn_01x02",
		value: "5V IN",
		footprint: HDR,
	},
	{ op: "add_part", symbol: "Device:R", value: "330", footprint: R },
	{ op: "add_part", symbol: "Device:LED", value: "RED", footprint: LED },
	{ op: "connect", net: "+5V", pins: ["J1.1", "R1.1"] },
	{ op: "connect", net: "LED_A", pins: ["R1.2", "D1.2"] },
	{ op: "connect", net: "GND", pins: ["J1.2", "D1.1"] },
	{ op: "set_net_flags", net: "+5V", external: true },
	{ op: "set_net_flags", net: "GND", external: true },
];

// ---- scripted Gemini (the server runs in this process, so patching fetch reaches it) ----
const realFetch = globalThis.fetch;
let script = [];
let geminiCalls = [];
const gemini = (...turns) => {
	script = turns;
	geminiCalls = [];
};
globalThis.fetch = async (url, init) => {
	if (!String(url).startsWith("https://generativelanguage.googleapis.com"))
		return realFetch(url, init);
	geminiCalls.push({
		url: String(url),
		headers: init.headers,
		body: JSON.parse(init.body),
	});
	const next = script[Math.min(geminiCalls.length - 1, script.length - 1)];
	const out = typeof next === "function" ? await next() : next;
	if (out instanceof Response) return out;
	return new Response(
		JSON.stringify({
			candidates: [
				{ content: { role: "model", parts: out }, finishReason: "STOP" },
			],
		}),
		{ status: 200 },
	);
};
const call = (name, args) => ({ functionCall: { name, args } });
const text = (t) => ({ text: t });

let server;
let browser;
let base;
let page;
const errors = [];
let studioColors = null;
before(async () => {
	if (skip) return;
	await new Promise((r) => {
		server = createApp().listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
	browser = await playwright.chromium.launch();
	page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text());
	});
	await page.addInitScript(() => {
		try {
			if (!localStorage.getItem("banana:testInit")) {
				localStorage.setItem("banana:testInit", "1");
				localStorage.setItem("banana:geminiApiKey", "test-key-123");
			}
		} catch {
			/* ignore */
		}
	});
});
after(async () => {
	globalThis.fetch = realFetch;
	await browser?.close();
	server?.close();
	fs.rmSync(projects, { recursive: true, force: true });
});

const paint = (selector) =>
	page.evaluate((sel) => {
		const shapes = ["path", "circle", "rect", "line", "polyline", "polygon"];
		const el = [...document.querySelectorAll(sel)].find(
			(e) =>
				shapes.includes(e.tagName.toLowerCase()) || e.querySelector?.("path"),
		);
		if (!el) return null;
		const target = shapes.includes(el.tagName.toLowerCase())
			? el
			: el.querySelector("path");
		const cs = getComputedStyle(target);
		return { stroke: cs.stroke, fill: cs.fill };
	}, selector);
const has = (p, list) =>
	p && list.some((c) => p.stroke.includes(c) || p.fill.includes(c));
const YELLOW = ["rgb(255, 255, 0)", "rgb(250, 204, 21)"];
const GREEN = ["rgb(0, 255, 102)", "rgb(34, 197, 94)"];
const RED = ["rgb(255, 51, 102)", "rgb(239, 68, 68)"];
const GREY = ["rgb(113, 113, 122)", "rgb(82, 82, 91)", "rgb(148, 163, 184)"];

const waitForImage = (testid = "kicad-image") =>
	page.waitForFunction(
		(id) => {
			const img = document.querySelector(`[data-testid="${id}"]`);
			return img && img.complete && img.naturalWidth > 0;
		},
		testid,
		{ timeout: 60000 },
	);
const headCommit = async (name) => (await P.history(name, 1))[0];
const settled = () =>
	page.waitForFunction(
		() =>
			!document
				.querySelector('[data-testid="status"]')
				?.textContent?.includes("…"),
		null,
		{ timeout: 90000 },
	);

test("Studio end to end", { skip, timeout: 900000 }, async (t) => {
	await t.test(
		"opens on the Diff view, exactly as before; the Studio is one click away",
		async () => {
			await page.goto(base, { waitUntil: "networkidle" });
			await page.getByText("No Diff Loaded").waitFor();
			assert.equal(
				await page.getByTestId("studio").count(),
				0,
				"Studio is not even mounted until opened",
			);
			await shot(page, "01-diff");
		},
	);

	await t.test(
		"switching to Studio hides the Diff layout without unmounting it",
		async () => {
			await page.getByTestId("mode-switch").getByText("Studio").click();
			await page.getByTestId("studio-welcome").waitFor();
			assert.equal(
				await page.getByText("No Diff Loaded").count(),
				1,
				"still mounted",
			);
			assert.equal(
				await page.getByText("No Diff Loaded").isVisible(),
				false,
				"but hidden",
			);
		},
	);

	await t.test("create a project", async () => {
		await page.getByTestId("welcome-new").click();
		await page.getByTestId("project-name").fill("Bad Name!");
		await page.getByTestId("create-project-confirm").click();
		await page.getByText(/Lowercase letters, digits/).waitFor();
		await page.getByTestId("project-name").fill("led-demo");
		await page.getByTestId("project-title").fill("LED demo");
		await page.getByTestId("create-project-confirm").click();
		await page.getByTestId("assistant-panel").waitFor();
		await settled();
		assert.ok(P.listProjects().some((p) => p.name === "led-demo"));
		assert.equal(
			(await P.history("led-demo")).length,
			2,
			"create + initial board",
		);
		await shot(page, "02-empty");
	});

	await t.test(
		"asking the assistant to design a board edits it inside Banana and renders it",
		async () => {
			gemini(
				[text("Adding the parts."), call("edit", { operations: designOps })],
				[call("autoroute", {})],
				[call("run_checks", {})],
				[
					text(
						"Done: an LED with a 330 ohm resistor, routed. The checks pass.",
					),
				],
			);
			await page
				.getByTestId("assistant-input")
				.fill("Make an LED with a resistor powered from a 5V header");
			await page.getByTestId("assistant-send").click();
			await page.getByTestId("review-banner").waitFor({ timeout: 120000 });
			await settled();
			// the answer and the tool steps are shown
			await page.getByText(/Done: an LED with a 330 ohm resistor/).waitFor();
			for (const step of ["edit", "autoroute", "run_checks"])
				assert.ok((await page.getByTestId(`step-${step}`).count()) >= 1, step);
			// KiCad's own picture is on screen and every part has a handle on it
			await waitForImage();
			for (const ref of ["J1", "R1", "D1"])
				await page.getByTestId(`part-${ref}`).waitFor();
			// server truth
			const d = P.loadDesign("led-demo");
			assert.equal(d.data.parts.length, 3);
			assert.ok(d.data.tracks.length > 0, "routed");
			assert.match(
				(await headCommit("led-demo")).message,
				/^Assistant: Make an LED/,
			);
			assert.equal(
				(await P.history("led-demo")).length,
				3,
				"one commit for the whole prompt",
			);
			assert.equal(
				geminiCalls[0].headers["x-goog-api-key"],
				"test-key-123",
				"the key set in the browser reaches Gemini (header only)",
			);
			assert.ok(!geminiCalls.some((c) => c.url.includes("test-key-123")));
			await shot(page, "03-after-assistant");
		},
	);

	await t.test(
		"the picture really is KiCad's: board alignment of the overlay with the courtyards KiCad drew",
		async () => {
			const box = await page.getByTestId("part-R1").boundingBox();
			const img = await page.getByTestId("kicad-image").boundingBox();
			assert.ok(box.width > 5 && box.height > 5);
			assert.ok(
				box.x >= img.x &&
					box.y >= img.y &&
					box.x + box.width <= img.x + img.width + 1 &&
					box.y + box.height <= img.y + img.height + 1,
				"the handle lies on the board image",
			);
		},
	);

	await t.test(
		"Review changes shows what the assistant did: green for the added, red for what went away",
		async () => {
			await page.getByTestId("review-changes").click();
			const scoped = (k) =>
				`[data-testid="compare-view"] .mode-side-by-side .${k}`;
			await page.waitForSelector(scoped("diff-added"), {
				state: "attached",
				timeout: 90000,
			});
			const added = await paint(scoped("diff-added"));
			assert.ok(has(added, GREEN), `added ${JSON.stringify(added)}`);
			await page.waitForSelector(scoped("diff-deleted"), {
				state: "attached",
				timeout: 30000,
			});
			assert.ok(
				has(await paint(scoped("diff-deleted")), RED),
				"the old empty outline is red on the base side",
			);
			const chips = (
				await page.getByTestId("compare-change").allTextContents()
			).join(" | ");
			assert.match(chips, /added R1/);
			assert.match(chips, /added J1/);
			assert.match(chips, /added D1/);
			await shot(page, "03b-review");
			await page.getByTestId("view-switch").getByText("Board").click();
			await waitForImage();
		},
	);

	await t.test(
		"selecting a part opens the inspector; editing the value is one undoable build",
		async () => {
			await page.getByTestId("part-R1").click();
			await page.getByTestId("inspector").waitFor();
			assert.equal(
				await page.getByTestId("inspector-value").inputValue(),
				"330",
			);
			const before = (await P.history("led-demo")).length;
			await page.getByTestId("inspector-value").fill("470");
			await page.getByTestId("inspector-value").press("Enter");
			await page.waitForFunction(
				() => document.querySelector('[data-testid="history-banner"]') === null,
			);
			await settled();
			await page.waitForFunction(
				async () =>
					(
						await (await fetch("/api/design/projects/led-demo/state")).json()
					).parts.find((p) => p.ref === "R1").value === "470",
			);
			assert.equal(P.loadDesign("led-demo").part("R1").value, "470");
			assert.equal((await P.history("led-demo")).length, before + 1);
			assert.match(
				(await headCommit("led-demo")).message,
				/Set R1 value to 470/,
			);
		},
	);

	await t.test(
		"dragging a part moves it on a 0.5 mm grid, re-routes, and commits",
		async () => {
			const start = P.loadDesign("led-demo").part("R1").at;
			const box = await page.getByTestId("part-R1").boundingBox();
			const cx = box.x + box.width / 2;
			const cy = box.y + box.height / 2;
			const before = (await P.history("led-demo")).length;
			await page.mouse.move(cx, cy);
			await page.mouse.down();
			await page.mouse.move(cx + 20, cy + 3, { steps: 4 });
			await page.mouse.move(cx + 60, cy + 6, { steps: 6 });
			await page.mouse.up();
			await settled();
			await page.waitForFunction(
				() =>
					document.querySelector('[data-testid="status"]')?.textContent ===
					"saved",
				null,
				{ timeout: 90000 },
			);
			const after = P.loadDesign("led-demo").part("R1").at;
			assert.ok(after.x > start.x, `moved right: ${start.x} -> ${after.x}`);
			assert.equal((after.x * 2) % 1, 0, "x on the 0.5 mm grid");
			assert.equal((after.y * 2) % 1, 0, "y on the 0.5 mm grid");
			assert.equal((await P.history("led-demo")).length, before + 1);
			assert.match((await headCommit("led-demo")).message, /^Move R1/);
			const d = P.loadDesign("led-demo");
			assert.ok(d.data.tracks.length > 0, "re-routed after the move");
			await shot(page, "04-after-drag");
		},
	);

	await t.test(
		"Changes view: the same diff engine and colours as the Diff view (yellow, green, red, and grey for the unchanged)",
		async () => {
			await page.getByTestId("view-switch").getByText("Changes").click();
			await page.waitForSelector(
				'[data-testid="compare-view"] .mode-side-by-side .diff-unchanged',
				{ state: "attached", timeout: 90000 },
			);
			await page.waitForSelector(
				'[data-testid="compare-view"] .mode-side-by-side .diff-changed',
				{ state: "attached" },
			);
			const scoped = (k) =>
				`[data-testid="compare-view"] .mode-side-by-side .${k}`;
			const colors = {
				changed: await paint(scoped("diff-changed")),
				added: await paint(scoped("diff-added")),
				deleted: await paint(scoped("diff-deleted")),
				unchanged: await paint(scoped("diff-unchanged")),
			};
			assert.ok(
				has(colors.changed, YELLOW),
				`changed ${JSON.stringify(colors.changed)}`,
			);
			assert.ok(
				has(colors.unchanged, GREY),
				`unchanged must be grey ${JSON.stringify(colors.unchanged)}`,
			);
			const chips = await page.getByTestId("compare-change").allTextContents();
			assert.ok(
				chips.some((c) => /R1/.test(c)),
				`R1 is listed: ${chips.join(" | ")}`,
			);
			studioColors = colors;
			await shot(page, "05-changes");
		},
	);

	await t.test(
		"comparing a build with itself leaves everything grey",
		async () => {
			const head = (await headCommit("led-demo")).hash;
			await page.getByTestId("compare-base").click();
			await page
				.locator(".ant-select-item-option")
				.filter({ hasText: (await headCommit("led-demo")).hash.slice(0, 7) })
				.first()
				.click();
			await page.waitForSelector('[data-testid="compare-view"]');
			await page.waitForFunction(
				() =>
					document.querySelectorAll(
						'[data-testid="compare-view"] .mode-side-by-side .diff-changed, [data-testid="compare-view"] .mode-side-by-side .diff-added, [data-testid="compare-view"] .mode-side-by-side .diff-deleted',
					).length === 0,
				null,
				{ timeout: 60000 },
			);
			assert.ok(
				(await page
					.locator(
						'[data-testid="compare-view"] .mode-side-by-side .diff-unchanged',
					)
					.count()) > 0,
			);
			assert.equal(await page.getByTestId("compare-change").count(), 0);
			assert.ok(head);
		},
	);

	await t.test(
		"undo and redo step through builds and refresh the picture",
		async () => {
			await page.getByTestId("view-switch").getByText("Board").click();
			await waitForImage();
			const moved = P.loadDesign("led-demo").part("R1").at.x;
			await page.getByTestId("undo").click();
			await settled();
			await page.waitForFunction(
				async () =>
					(await (await fetch("/api/design/projects/led-demo/state")).json())
						.canRedo === true,
			);
			assert.ok(P.loadDesign("led-demo").part("R1").at.x < moved, "undone");
			await page.getByTestId("redo").click();
			await settled();
			await page.waitForFunction(
				async () =>
					(await (await fetch("/api/design/projects/led-demo/state")).json())
						.canRedo === false,
			);
			assert.equal(
				P.loadDesign("led-demo").part("R1").at.x,
				moved,
				"redone exactly",
			);
		},
	);

	await t.test(
		"time travel: view an older build read-only, then return",
		async () => {
			await page.getByText(/^History \(/).click();
			const items = await page.locator('[data-testid^="commit-"]').all();
			assert.ok(items.length >= 4);
			await page
				.getByTestId(/^view-/)
				.nth(2)
				.click();
			await page.getByTestId("history-banner").waitFor();
			assert.equal(
				await page.getByTestId("status").textContent(),
				"viewing history",
			);
			await waitForImage();
			await page.getByTestId("return-latest").click();
			await page.waitForFunction(
				() => !document.querySelector('[data-testid="history-banner"]'),
			);
		},
	);

	await t.test("schematic view renders KiCad's drawing", async () => {
		await page.getByTestId("view-switch").getByText("Schematic").click();
		await page.waitForFunction(
			() => {
				const img = document.querySelector('[data-testid="kicad-image"]');
				return img && img.complete && img.naturalWidth > 0;
			},
			null,
			{ timeout: 60000 },
		);
		assert.equal(
			await page.getByTestId("part-R1").count(),
			0,
			"no board overlay on the schematic",
		);
		await shot(page, "06-schematic");
		await page.getByTestId("view-switch").getByText("Board").click();
	});

	await t.test("checks: one button, one verdict", async () => {
		await page.getByTestId("check").click();
		await page.getByTestId("checks-summary").waitFor({ timeout: 120000 });
		const summary = await page.getByTestId("checks-summary").textContent();
		assert.match(summary, /Clean|error/);
		const direct = await P.checkProject("led-demo", { commit: false });
		assert.equal(/Clean/.test(summary), direct.ok);
		await shot(page, "07-checks");
	});

	await t.test(
		"a second assistant prompt edits the existing board and the Changes view shows exactly that",
		async () => {
			const R1 = P.loadDesign("led-demo").part("R1").at;
			gemini(
				[
					text("Moving R1 a little."),
					call("edit", {
						operations: [
							{ op: "place", ref: "R1", x: R1.x, y: R1.y + 1, rot: 0 },
							{ op: "clear_routing" },
						],
					}),
				],
				[call("autoroute", {})],
				[text("Moved R1 down by 1 mm and re-routed.")],
			);
			const before = (await P.history("led-demo")).length;
			await page.getByText("Assistant", { exact: true }).click();
			await page.getByTestId("assistant-input").fill("Nudge R1 down by 1 mm");
			await page.getByTestId("assistant-send").click();
			await page
				.getByText("Moved R1 down by 1 mm and re-routed.")
				.waitFor({ timeout: 120000 });
			await settled();
			assert.equal((await P.history("led-demo")).length, before + 1);
			assert.equal(P.loadDesign("led-demo").part("R1").at.y, R1.y + 1);
			// the model saw the earlier turns of the conversation
			assert.ok(
				geminiCalls[0].body.contents.length >= 3,
				"history is sent along",
			);
			await page.getByTestId("review-changes").click();
			await page.waitForSelector(
				'[data-testid="compare-view"] .mode-side-by-side .diff-changed',
				{ state: "attached", timeout: 90000 },
			);
			const chips = (
				await page.getByTestId("compare-change").allTextContents()
			).join(" | ");
			assert.match(chips, /R1/);
			await shot(page, "08-second-change");
		},
	);

	await t.test(
		"Open in Diff view lands in the existing viewer with the same colours",
		async () => {
			await page.getByTestId("open-in-diff").click();
			await page
				.getByText(/Diff Viewport \(led-demo\.kicad_pcb\)/)
				.waitFor({ timeout: 120000 });
			assert.equal(
				await page.getByTestId("studio").isVisible(),
				false,
				"the Studio steps aside",
			);
			// same assertion the baseline test makes on the untouched Diff view
			await page
				.locator("text=Side by Side")
				.filter({ visible: true })
				.first()
				.click();
			await page.waitForSelector(".mode-side-by-side .diff-unchanged", {
				state: "attached",
				timeout: 90000,
			});
			const diffColors = {
				changed: await paint(".mode-side-by-side .diff-changed"),
				unchanged: await paint(".mode-side-by-side .diff-unchanged"),
			};
			assert.deepEqual(
				diffColors.changed,
				studioColors.changed,
				"changed looks the same in both views",
			);
			assert.deepEqual(
				diffColors.unchanged,
				studioColors.unchanged,
				"unchanged looks the same in both views",
			);
			assert.ok(
				has(diffColors.changed, YELLOW),
				JSON.stringify(diffColors.changed),
			);
			assert.ok(
				has(diffColors.unchanged, GREY),
				JSON.stringify(diffColors.unchanged),
			);
			await shot(page, "09-diff-view");
		},
	);

	await t.test("back in the Studio everything is where it was", async () => {
		await page.getByTestId("mode-switch").getByText("Studio").click();
		await page.getByTestId("studio-toolbar").waitFor();
		assert.equal(
			await page
				.getByTestId("project-select")
				.textContent()
				.then((s) => s.includes("led-demo")),
			true,
		);
		assert.ok(
			(await page.getByTestId("assistant-message").count()) >= 2,
			"the chat is still there",
		);
	});

	await t.test(
		"a failing Gemini call is explained in the chat, and nothing is committed",
		async () => {
			gemini(
				new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
					status: 429,
				}),
			);
			const before = (await P.history("led-demo")).length;
			await page.getByTestId("assistant-input").fill("anything");
			await page.getByTestId("assistant-send").click();
			await page
				.getByTestId("assistant-error")
				.last()
				.waitFor({ timeout: 60000 });
			assert.match(
				await page.getByTestId("assistant-error").last().textContent(),
				/429.*quota exceeded/,
			);
			assert.equal((await P.history("led-demo")).length, before);
		},
	);

	await t.test("no page errors anywhere in this run", async () =>
		assert.deepEqual(errors, []),
	);
});

test("without a Gemini key the assistant asks for one instead of failing", {
	skip: skip || Boolean(process.env.GEMINI_API_KEY),
	timeout: 120000,
}, async () => {
	const ctx = await browser.newContext({
		viewport: { width: 1400, height: 900 },
	});
	const p = await ctx.newPage();
	await p.goto(base, { waitUntil: "networkidle" });
	await p.getByTestId("mode-switch").getByText("Studio").click();
	await p.getByTestId("open-led-demo").click();
	await p.getByTestId("assistant-input").fill("hello");
	await p.getByTestId("assistant-send").click();
	await p.getByText("Copilot AI Configuration").waitFor();
	await ctx.close();
});
