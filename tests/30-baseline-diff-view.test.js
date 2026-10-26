// BASELINE GUARD for the pre-existing diff view. These assertions describe behaviour that existed before the
// Studio work and must never change: changed = yellow, added = green, deleted = red, unchanged = grey,
// for any pair of commits, in the API payload and in the rendered UI.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { hasKicad, tmpDir } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projects = tmpDir("banana-baseline-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const P = await import("../backend/src/design/project.js");
const { createApp } = await import("../backend/src/server.js");

const skip = !hasKicad()
	? "kicad-cli not installed"
	: findLibraryRoot("symbols") && findLibraryRoot("footprints")
		? false
		: "KiCad libraries not installed";
let playwright = null;
try {
	playwright = createRequire(import.meta.url)("playwright");
} catch {
	/* optional */
}
const skipUi =
	skip ||
	(!playwright
		? "playwright not installed"
		: !fs.existsSync(path.join(root, "frontend", "dist", "index.html"))
			? "frontend/dist not built"
			: false);

// Palette as defined in backend/src/svg-styler.js (DIFF_PALETTE). Changing it is a regression.
const COLORS = {
	changed: "FACC15",
	added: "22C55E",
	deleted: "EF4444",
	greyTrace: "4B5563",
	greyPad: "374151",
};
const R = "Resistor_SMD:R_0805_2012Metric";

let server;
let base;
let repo;
let first;
let second;
before(async () => {
	if (skip) return;
	await P.createProject("guard", "baseline");
	const d = P.loadDesign("guard");
	for (const [i, v] of ["1k", "2k", "3k"].entries())
		d.addPart({
			symbol: "Device:R",
			value: v,
			footprint: R,
			at: { x: 30 + i * 10, y: 30 },
		});
	d.connect("A", ["R1.2", "R2.1"]);
	d.connect("B", ["R2.2", "R3.1"]);
	d.connect("C", ["R1.1", "R3.2"]);
	d.setBoard(60, 30);
	P.saveDesign("guard", d);
	await P.autoRoute("guard");
	first = (await P.build("guard", "v1")).commit;
	const d2 = P.loadDesign("guard");
	d2.place("R1", 30, 40, 0); // changed (moved)
	d2.removePart("R3"); // deleted
	d2.addPart({
		symbol: "Device:R",
		value: "4k",
		footprint: R,
		at: { x: 50, y: 20 },
	}); // added
	d2.clearRouting();
	P.saveDesign("guard", d2);
	second = (await P.build("guard", "v2")).commit;
	repo = path.join(projects, "guard");
	server = await new Promise((resolve) => {
		const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
	server?.close();
	fs.rmSync(projects, { recursive: true, force: true });
});

const diff = async (b, t) => {
	const r = await fetch(`${base}/api/diff/process`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			repoPath: repo,
			baseCommit: b,
			targetCommit: t,
			relativeFilePath: "guard.kicad_pcb",
		}),
	});
	assert.equal(r.status, 200, await r.clone().text());
	return r.json();
};
// The annotated, ready-to-display SVGs are payload.sideBySide.{base,target}; the grey for unchanged parts is applied by
// the front-end's Side-by-Side stylesheet to elements the backend tags with class "diff-unchanged".
const allSvg = (list) => list.map((s) => s.content).join("\n");
const count = (text, re) => (text.match(re) ?? []).length;
const klass = (name) => new RegExp(`class="[^"]*\\b${name}\\b`, "g");

test("BASELINE: moved part is yellow, added part green, removed part red, unchanged tagged for grey (API payload)", {
	skip,
	timeout: 120000,
}, async () => {
	const d = await diff(first, second);
	const baseSvg = allSvg(d.sideBySide.base);
	const targetSvg = allSvg(d.sideBySide.target);
	assert.ok(
		count(targetSvg, new RegExp(COLORS.changed, "gi")) > 0,
		"changed (yellow #FACC15) present on target",
	);
	assert.ok(
		count(targetSvg, new RegExp(COLORS.added, "gi")) > 0,
		"added (green #22C55E) present on target",
	);
	assert.ok(
		count(baseSvg, new RegExp(COLORS.deleted, "gi")) > 0,
		"deleted (red #EF4444) present on base",
	);
	assert.ok(
		count(targetSvg, klass("diff-changed")) > 0 &&
			count(targetSvg, klass("diff-added")) > 0 &&
			count(baseSvg, klass("diff-deleted")) > 0,
		"class tags present",
	);
	assert.ok(
		count(targetSvg, klass("diff-unchanged")) > 0 &&
			count(baseSvg, klass("diff-unchanged")) > 0,
		"unchanged elements tagged diff-unchanged on both sides",
	);
	const actions = d.modifications.map((m) => `${m.action}:${m.refDes ?? ""}`);
	assert.ok(actions.includes("CHANGED:R1"), actions.join());
	assert.ok(
		actions.some((a) => a.startsWith("ADDED")) &&
			actions.some((a) => a.startsWith("DELETED")),
		actions.join(),
	);
	assert.equal(d.telemetry.layersProcessed, 7);
});

test("BASELINE: identical commits show no change colours at all, everything unchanged", {
	skip,
	timeout: 120000,
}, async () => {
	const d = await diff(second, second);
	const text = allSvg(d.sideBySide.base) + allSvg(d.sideBySide.target);
	for (const c of ["changed", "added", "deleted"]) {
		assert.equal(
			count(text, new RegExp(COLORS[c], "gi")),
			0,
			`${c} colour must not appear`,
		);
		assert.equal(
			count(text, klass(`diff-${c}`)),
			0,
			`diff-${c} class must not appear`,
		);
	}
	assert.ok(count(text, klass("diff-unchanged")) > 0);
	assert.deepEqual(d.modifications, []);
});

test("BASELINE: comparing in the opposite direction still highlights both sides (red on the old, green on the new)", {
	skip,
	timeout: 120000,
}, async () => {
	for (const [from, to] of [
		[first, second],
		[second, first],
	]) {
		const d = await diff(from, to);
		assert.ok(d.modifications.length > 0);
		assert.ok(
			count(allSvg(d.sideBySide.base), new RegExp(COLORS.deleted, "gi")) > 0,
			"base side has red",
		);
		assert.ok(
			count(allSvg(d.sideBySide.target), new RegExp(COLORS.added, "gi")) > 0,
			"target side has green",
		);
		assert.ok(
			count(allSvg(d.sideBySide.base), klass("diff-unchanged")) > 0,
			"unchanged on base",
		);
	}
});

test("BASELINE: the existing diff UI renders yellow/green/red and grey-for-unchanged in Side by Side mode", {
	skip: skipUi,
	timeout: 180000,
}, async () => {
	const browser = await playwright.chromium.launch();
	try {
		const page = await browser.newPage({
			viewport: { width: 1500, height: 900 },
		});
		const errors = [];
		page.on("pageerror", (e) => errors.push(e.message));
		await page.addInitScript(
			({ repoPath }) => {
				localStorage.setItem("banana:sourceMode", "local");
				localStorage.setItem("banana:lastRepoPath", repoPath);
			},
			{ repoPath: repo },
		);
		await page.goto(base, { waitUntil: "networkidle" });
		await page.waitForSelector("text=Fetch and Render Diff");
		await page.waitForTimeout(1500);
		await page.getByText("Side by Side", { exact: true }).click();
		await page.getByRole("button", { name: /Fetch and Render Diff/ }).click();
		await page.waitForSelector(".mode-side-by-side .diff-unchanged", {
			state: "attached",
			timeout: 90000,
		});
		const colors = await page.evaluate(() => {
			const paint = (sel) => {
				const el = [...document.querySelectorAll(sel)].find(
					(e) =>
						["path", "circle", "rect", "line", "polyline", "polygon"].includes(
							e.tagName.toLowerCase(),
						) || e.querySelector?.("path"),
				);
				if (!el) return null;
				const target = [
					"path",
					"circle",
					"rect",
					"line",
					"polyline",
					"polygon",
				].includes(el.tagName.toLowerCase())
					? el
					: el.querySelector("path");
				const cs = getComputedStyle(target);
				return { stroke: cs.stroke, fill: cs.fill };
			};
			return {
				changed: paint(".mode-side-by-side .diff-changed"),
				added: paint(".mode-side-by-side .diff-added"),
				deleted: paint(".mode-side-by-side .diff-deleted"),
				unchanged: paint(".mode-side-by-side .diff-unchanged"),
			};
		});
		const has = (p, rgb) =>
			p && (p.stroke.includes(rgb) || p.fill.includes(rgb));
		// Side-by-Side stylesheet colours as shipped: yellow #ffff00, green #00ff66, red #ff3366 (the palette baked into the SVG is #FACC15/#22C55E/#EF4444).
		assert.ok(
			["rgb(255, 255, 0)", "rgb(250, 204, 21)"].some((c) =>
				has(colors.changed, c),
			),
			`changed colour ${JSON.stringify(colors.changed)}`,
		);
		assert.ok(
			["rgb(0, 255, 102)", "rgb(34, 197, 94)"].some((c) =>
				has(colors.added, c),
			),
			`added colour ${JSON.stringify(colors.added)}`,
		);
		assert.ok(
			["rgb(255, 51, 102)", "rgb(239, 68, 68)"].some((c) =>
				has(colors.deleted, c),
			),
			`deleted colour ${JSON.stringify(colors.deleted)}`,
		);
		assert.ok(
			["rgb(113, 113, 122)", "rgb(82, 82, 91)", "rgb(148, 163, 184)"].some(
				(g) => has(colors.unchanged, g),
			),
			`unchanged must be grey ${JSON.stringify(colors.unchanged)}`,
		);
		if (process.env.BANANA_SCREENSHOT_DIR)
			await page.screenshot({
				path: path.join(process.env.BANANA_SCREENSHOT_DIR, "baseline-diff.png"),
			});
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
	}
});
