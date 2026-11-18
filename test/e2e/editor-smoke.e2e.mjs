import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

function resolveChromePath() {
	if (process.env.PW_CHROME) return process.env.PW_CHROME;
	return path.join(
		process.env.LOCALAPPDATA || "",
		"ms-playwright",
		"chromium-1228",
		"chrome-win64",
		"chrome.exe",
	);
}

async function getSvgArea(svg) {
	const box = await svg.boundingBox();
	return box ? box.width * box.height : -1;
}

async function findLargestSvg(svgs) {
	let largest = null;
	let maxArea = -1;
	for (const svg of svgs) {
		const area = await getSvgArea(svg);
		if (area > maxArea) {
			maxArea = area;
			largest = svg;
		}
	}
	return { largest, maxArea };
}

async function getMainCanvas(page) {
	const start = Date.now();
	while (Date.now() - start < 5000) {
		const svgs = await page.locator("svg").all();
		const { largest, maxArea } = await findLargestSvg(svgs);
		if (largest && maxArea > 1000) return largest;
		await page.waitForTimeout(100);
	}
	throw new Error("Drawing canvas svg not found");
}

async function clickCanvas(svg, dx = 0, dy = 0, options = {}) {
	const box = await svg.boundingBox();
	if (!box) throw new Error("Canvas bounding box missing");
	await svg.click({
		...options,
		timeout: 5000,
		position: {
			x: box.width / 2 + dx,
			y: box.height / 2 + dy,
		},
	});
}

function getToolPalette(page) {
	return page.locator(
		"aside[aria-label='PCB tools'], aside[aria-label='Schematic tools']",
	);
}

async function waitAndClick(locator, timeout = 5000) {
	await locator.waitFor({ state: "visible", timeout });
	await locator.click({ timeout });
}

async function clickToolButton(page, name) {
	const palette = getToolPalette(page);
	await waitAndClick(
		palette.getByRole("button", { name, exact: true }).first(),
	);
}

function getAntdModal(page) {
	return page.locator(".ant-modal-wrap:visible .ant-modal");
}

async function assertNoUnexpectedDialog(page) {
	const modal = getAntdModal(page).last();
	const isVisible = await modal.isVisible().catch(() => false);
	if (isVisible) {
		await page.keyboard.press("Escape").catch(() => {});
		throw new Error("dialog appeared");
	}
}

async function clickOkOrEnter(page, modal) {
	const okBtn = modal.getByRole("button", { name: "OK", exact: true }).first();
	const hasOk = await okBtn.isVisible().catch(() => false);
	const canClickOk = hasOk && !(await okBtn.isDisabled());
	if (canClickOk) {
		await okBtn.click({ timeout: 5000 });
		return;
	}
	await page.keyboard.press("Enter");
}

async function handlePourModalIfOpen(page) {
	const modal = getAntdModal(page).last();
	await modal.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
	if (!(await modal.isVisible().catch(() => false))) return;
	await clickOkOrEnter(page, modal);
	await modal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function tryExpandPanel(page) {
	const toggle = page
		.getByRole("button", { name: "Toggle board summary", exact: true })
		.first();
	if (await toggle.isVisible().catch(() => false)) {
		await toggle.click({ timeout: 2000 }).catch(() => {});
	}
}

function parseStatCount(text, label) {
	const m = text.match(new RegExp(`${label}[^0-9]*([0-9]+)`, "i"));
	return m ? Number.parseInt(m[1], 10) : -1;
}

async function extractStatNumber(page, label) {
	const panel = page
		.locator(
			"aside[aria-label='Properties panel'], [aria-label='Board summary']",
		)
		.first();
	if (!(await panel.isVisible().catch(() => false))) {
		await tryExpandPanel(page);
	}
	const text = await panel.innerText().catch(() => "");
	const val = parseStatCount(text, label);
	if (val >= 0) return val;
	const altPanel = page.locator("aside, main").first();
	const altText = await altPanel.innerText().catch(() => "");
	return parseStatCount(altText, label);
}

async function readPanelCount(page, label) {
	return await extractStatNumber(page, label);
}

async function waitForPanelCount(page, label, expected) {
	const start = Date.now();
	let last = -1;
	const isMatch =
		typeof expected === "function" ? expected : (v) => v === expected;
	while (Date.now() - start < 5000) {
		const val = await readPanelCount(page, label);
		if (isMatch(val)) return val;
		last = val;
		await page.waitForTimeout(200);
	}
	throw new Error(`Expected ${label} ${expected}, got ${last}`);
}

async function saveFailureScreenshot(page, id) {
	try {
		await fs.mkdir(".playwright-mcp/e2e", { recursive: true });
		await page.screenshot({ path: `.playwright-mcp/e2e/${id}.png` });
	} catch (_err) {
		return;
	}
}

async function prepareFreshEditor(page, docType) {
	const baseUrl = process.env.BANANA_URL || "http://localhost:5173/";
	await page.goto(baseUrl, { timeout: 5000 });
	await waitAndClick(
		page.getByRole("button", { name: "Editor", exact: true }).first(),
	);

	const isSch = docType === "schematic";
	const newBtn = page
		.getByRole("button", {
			name: isSch ? "New schematic" : "New PCB",
			exact: true,
		})
		.last();
	await waitAndClick(newBtn);

	const tab = page
		.getByRole("tab", { name: isSch ? "Schematic" : "PCB", exact: true })
		.first();
	await waitAndClick(tab);

	const svg = await getMainCanvas(page);
	await svg.waitFor({ state: "visible", timeout: 5000 });
}

async function placeResistorAndLed(page, dx = 40) {
	await clickToolButton(page, "Resistor");
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -dx, 0);
	await clickToolButton(page, "LED");
	await clickCanvas(svg, dx, 0);
	return svg;
}

async function checkPcbPart(page) {
	await placeResistorAndLed(page, 60);
	await waitForPanelCount(page, "Components", 2);
}

async function dragOutline(page, svg) {
	const box = await svg.boundingBox();
	if (!box) return;
	const sx = box.x + box.width / 2 - 100;
	const sy = box.y + box.height / 2 - 80;
	const ex = box.x + box.width / 2 + 100;
	const ey = box.y + box.height / 2 + 80;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(ex, ey, { steps: 5 });
	await page.mouse.up();
}

async function checkPcbOutline(page) {
	await clickToolButton(page, "Board outline (rectangle)");
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -100, -80);
	await clickCanvas(svg, 100, 80);
	const outline = svg.locator("polygon, .pcb-edge-cuts polygon");
	if ((await outline.count()) === 0) {
		await dragOutline(page, svg);
	}
	await outline.first().waitFor({ state: "visible", timeout: 5000 });
}

async function getElementCenter(locator, name = "Element") {
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${name} bounding box missing`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function connectPcbPads(page, startPad, endPad) {
	const start = await getElementCenter(startPad, "Pcb pad");
	const end = await getElementCenter(endPad, "Pcb pad");
	await page.mouse.click(start.x, start.y);
	await page.mouse.click(end.x, end.y);
	await page.mouse.dblclick(end.x, end.y);
}

async function checkPcbTrack(page) {
	const svg = await placeResistorAndLed(page, 55);
	const pads = svg.locator("g[role='button'] g:has(text)");
	await pads.first().waitFor({ state: "visible", timeout: 5000 });
	const count = await pads.count();
	await clickToolButton(page, "Route track");
	await connectPcbPads(page, pads.first(), pads.nth(count - 1));

	const track = svg.locator(".pcb-tracks path");
	await track.first().waitFor({ state: "visible", timeout: 5000 });
}

async function checkPcbVia(page) {
	await clickToolButton(page, "Via");
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, 0, 40);
	const via = svg.locator(".pcb-vias circle, g.pcb-vias circle");
	if ((await via.count()) === 0) {
		await clickToolButton(page, "Route track");
		await clickCanvas(svg, 0, 40);
		await clickToolButton(page, "Via");
		await clickCanvas(svg, 0, 40, { clickCount: 2 });
	}
	await via.first().waitFor({ state: "visible", timeout: 5000 });
}

async function placeToolAndAssertText(page, step) {
	const { tool, pos, text, selector = "text" } = step;
	await clickToolButton(page, tool);
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, pos[0], pos[1]);
	await assertNoUnexpectedDialog(page);
	const el = svg.locator(selector).filter({ hasText: text });
	await el.first().waitFor({ state: "visible", timeout: 5000 });
}

async function checkPcbText(page) {
	await placeToolAndAssertText(page, {
		tool: "Text",
		pos: [0, -40],
		text: "TEXT",
		selector: "[class*='pcb-graphics'] text, text",
	});
}

async function checkPcbZone(page) {
	await clickToolButton(page, "Filled zone");
	await handlePourModalIfOpen(page);
	const svg = await getMainCanvas(page);
	const corners = [
		[-50, -50],
		[50, -50],
		[50, 50],
		[-50, 50],
	];
	for (const [x, y] of corners) {
		await clickCanvas(svg, x, y);
	}
	await page.keyboard.press("Escape");
	const zone = svg.locator(".pcb-zones polygon, polygon[points]");
	await zone.first().waitFor({ state: "visible", timeout: 5000 });
}

async function addPcbGraphic(page, svg, config) {
	await clickToolButton(page, config.tool);
	await clickCanvas(svg, config.p1[0], config.p1[1]);
	await clickCanvas(svg, config.p2[0], config.p2[1]);
}

async function waitForCountIncrease(
	page,
	locator,
	beforeCount,
	timeout = 5000,
) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const current = await locator.count();
		if (current > beforeCount) return current;
		await page.waitForTimeout(100);
	}
	throw new Error(`Count did not increase from ${beforeCount}`);
}

const PCB_GRAPHIC_STEPS = Object.freeze([
	{
		tool: "Line",
		sel: "[class*='pcb-graphics'] line, line",
		p1: [-80, -30],
		p2: [-40, -10],
	},
	{
		tool: "Rectangle",
		sel: "[class*='pcb-graphics'] rect, rect",
		p1: [-80, 10],
		p2: [-40, 30],
	},
	{
		tool: "Circle",
		sel: "[class*='pcb-graphics'] circle, circle",
		p1: [20, -30],
		p2: [35, -30],
	},
	{
		tool: "Dimension",
		sel: ".pcb-graphic-dimension, text:has-text('mm')",
		p1: [20, 10],
		p2: [50, 20],
	},
]);

async function checkPcbGraphics(page) {
	const svg = await getMainCanvas(page);
	for (const step of PCB_GRAPHIC_STEPS) {
		const loc = svg.locator(step.sel);
		const before = await loc.count();
		await addPcbGraphic(page, svg, step);
		await waitForCountIncrease(page, loc, before);
	}
}

async function checkSchPart(page) {
	const svg = await placeResistorAndLed(page, 40);
	const resPart = svg.locator(".schematic-part, text:has-text('R')").first();
	await resPart.waitFor({ state: "visible", timeout: 5000 });
	const ledPart = svg.locator(".schematic-part, text:has-text('LED')").first();
	await ledPart.waitFor({ state: "visible", timeout: 5000 });
	const fpBox = svg.locator("text:has-text('LED_0603_1608Metric')");
	if ((await fpBox.count()) > 0) {
		throw new Error("PCB footprint box shown on schematic");
	}
}

async function connectPinsByCenter(page, p1, p2) {
	const c1 = await getElementCenter(p1, "Pin");
	const c2 = await getElementCenter(p2, "Pin");
	await page.mouse.click(c1.x, c1.y);
	await page.mouse.click(c2.x, c2.y);
}

async function checkSchWire(page) {
	const svg = await placeResistorAndLed(page, 40);
	const pins = svg.locator(".schematic-part circle, circle[r='0.65']");
	await pins.first().waitFor({ state: "visible", timeout: 5000 });
	const pinCount = await pins.count();

	await clickToolButton(page, "Wire");
	const wireLoc = svg.locator(
		".schematic-wire, .schematic-annotations-layer line",
	);
	const wireBefore = await wireLoc.count();

	if (pinCount >= 2) {
		await connectPinsByCenter(page, pins.first(), pins.nth(pinCount - 1));
	} else {
		await clickCanvas(svg, -30, 0);
		await clickCanvas(svg, 30, 0);
	}

	await waitForCountIncrease(page, wireLoc, wireBefore);
	await waitForPanelCount(page, "Nets", (n) => n >= 1);
}

const SCH_LABEL_STEPS = Object.freeze([
	{
		tool: "Net label",
		pos: [-20, -50],
		text: "NET1",
		selector: ".schematic-annotation text, text",
	},
	{
		tool: "Text",
		pos: [20, -50],
		text: "TEXT",
		selector: ".schematic-annotation text, text",
	},
]);

async function checkSchLabel(page) {
	for (const step of SCH_LABEL_STEPS) {
		await placeToolAndAssertText(page, step);
	}
}

const SCH_POWER_STEPS = Object.freeze([
	{ tool: "GND", pos: [-40, 50], text: "GND" },
	{ tool: "VCC", pos: [40, 50], text: "VCC" },
]);

async function checkSchPower(page) {
	for (const step of SCH_POWER_STEPS) {
		await placeToolAndAssertText(page, step);
	}
}

async function getScaleTransform(g) {
	const val = await g.getAttribute("transform");
	return val || "";
}

async function checkNavZoom(page) {
	const svg = await getMainCanvas(page);
	const g = svg.locator("g[transform*='scale']").first();
	const initT = await getScaleTransform(g);
	await svg.hover();
	await page.mouse.wheel(0, -120);
	await page.waitForTimeout(200);
	const zoomT = await getScaleTransform(g);
	if (zoomT === initT) throw new Error("Zoom did not change transform");
	await page.keyboard.press("Home");
	await page.waitForTimeout(200);
	const fitT = await getScaleTransform(g);
	if (fitT === zoomT) throw new Error("Home did not restore fit");
}

async function getButtonLabel(btn) {
	const aria = await btn.getAttribute("aria-label");
	if (aria) return aria;
	const text = await btn.textContent();
	return text || "";
}

async function assertButtonNotClipped(btn) {
	const box = await btn.boundingBox();
	if (!box) return;
	if (box.x + box.width > 1280) {
		const label = await getButtonLabel(btn);
		throw new Error(`Button '${label.trim()}' is clipped`);
	}
}

async function checkLayout(page) {
	await page.setViewportSize({ width: 1280, height: 900 });
	const svg = await getMainCanvas(page);
	const box = await svg.boundingBox();
	if (!box || box.width < 700) throw new Error("Canvas svg width < 700 px");
	const buttons = await page.locator("button:visible").all();
	for (const btn of buttons) {
		await assertButtonNotClipped(btn);
	}
}

function isWasmUrl(url) {
	if (url.endsWith(".wasm")) return true;
	const clean = url.split(/[?#]/)[0];
	return clean.endsWith(".wasm");
}

async function closeEditor(page) {
	const closeBtn = page.getByRole("button", { name: "Close" }).first();
	if (await closeBtn.isVisible().catch(() => false)) {
		await closeBtn.click({ timeout: 5000 });
	} else {
		const headerBtn = page
			.locator(".ant-drawer-header button, .ant-drawer-close")
			.first();
		await headerBtn.click({ timeout: 5000 });
	}
	await page
		.locator(".ant-drawer-open")
		.waitFor({ state: "hidden", timeout: 5000 })
		.catch(() => {}); // ponytail: ignore timeout if drawer already hidden
}

async function openStudio3D(page) {
	await waitAndClick(
		page.getByRole("button", { name: "3D Studio", exact: true }),
	);
}

function collectStudioFailures({ canvasVisible, hasModel200, hasWasm200 }) {
	const failures = [];
	if (!canvasVisible) failures.push("canvas element not visible");
	if (!hasModel200) failures.push("no 200 response from /api/models");
	if (!hasWasm200) failures.push("no 200 response for .wasm");
	return failures.join(", ");
}

async function checkCanvasVisible(page, currentlyVisible) {
	if (currentlyVisible) return true;
	const canvas = page.locator("canvas").first();
	return await canvas.isVisible().catch(() => false);
}

function isStudioReady(canvasVisible, netState) {
	return canvasVisible && netState.hasModel200 && netState.hasWasm200;
}

function assertNoError(getPageError) {
	const err = getPageError();
	if (err) throw new Error(`pageerror: ${err}`);
}

async function waitForStudioConditions(page, netState, getPageError) {
	const start = Date.now();
	let canvasVisible = false;

	while (Date.now() - start < 20000) {
		assertNoError(getPageError);
		canvasVisible = await checkCanvasVisible(page, canvasVisible);
		if (isStudioReady(canvasVisible, netState)) return;
		await page.waitForTimeout(200);
	}

	assertNoError(getPageError);
	const failure = collectStudioFailures({
		canvasVisible,
		hasModel200: netState.hasModel200,
		hasWasm200: netState.hasWasm200,
	});
	throw new Error(failure);
}

function createResponseTracker(netState) {
	return (res) => {
		try {
			if (res.status() !== 200) return;
			const url = res.url();
			if (url.includes("/api/models")) netState.hasModel200 = true;
			if (isWasmUrl(url)) netState.hasWasm200 = true;
		} catch (_err) {
			return;
		}
	};
}

function createPageErrorTracker(errorRef) {
	return (err) => {
		if (!errorRef.current) errorRef.current = err?.message || String(err);
	};
}

async function checkStudio3D(page) {
	const netState = { hasModel200: false, hasWasm200: false };
	const errorRef = { current: null };
	const onResponse = createResponseTracker(netState);
	const onPageError = createPageErrorTracker(errorRef);

	page.on("response", onResponse);
	page.on("pageerror", onPageError);
	try {
		await prepareFreshEditor(page, "pcb");
		await checkPcbPart(page);
		await closeEditor(page);
		await openStudio3D(page);
		await waitForStudioConditions(page, netState, () => errorRef.current);
	} finally {
		page.off("response", onResponse);
		page.off("pageerror", onPageError);
	}
}

const CHECKS = [
	{ id: "pcb_part", docType: "pcb", run: checkPcbPart },
	{ id: "pcb_outline", docType: "pcb", run: checkPcbOutline },
	{ id: "pcb_track", docType: "pcb", run: checkPcbTrack },
	{ id: "pcb_via", docType: "pcb", run: checkPcbVia },
	{ id: "pcb_text", docType: "pcb", run: checkPcbText },
	{ id: "pcb_zone", docType: "pcb", run: checkPcbZone },
	{ id: "pcb_graphics", docType: "pcb", run: checkPcbGraphics },
	{ id: "sch_part", docType: "schematic", run: checkSchPart },
	{ id: "sch_wire", docType: "schematic", run: checkSchWire },
	{ id: "sch_label", docType: "schematic", run: checkSchLabel },
	{ id: "sch_power", docType: "schematic", run: checkSchPower },
	{ id: "nav_zoom", docType: "pcb", run: checkNavZoom },
	{ id: "layout", docType: "pcb", run: checkLayout },
	{ id: "studio_3d", run: checkStudio3D },
];

async function runCheck(check, page) {
	try {
		if (check.docType && check.id !== "studio_3d") {
			await prepareFreshEditor(page, check.docType);
		}
		await check.run(page);
		console.log(`PASS ${check.id}`);
		return true;
	} catch (err) {
		const reason = (err?.message || String(err)).split("\n")[0].slice(0, 80);
		console.log(`FAIL ${check.id} ${reason}`);
		await saveFailureScreenshot(page, check.id);
		return false;
	} finally {
		// ponytail: dismiss any leftover dialog to guarantee clean test boundary
		const modal = getAntdModal(page).last();
		if (await modal.isVisible().catch(() => false)) {
			await page.keyboard.press("Escape").catch(() => {});
		}
	}
}

function attachErrorListeners(page, pageErrors) {
	const record = (prefix, text) => {
		if (pageErrors.length < 10) {
			pageErrors.push(`ERR ${prefix}: ${String(text).slice(0, 150)}`);
		}
	};
	page.on("pageerror", (err) => record("pageerror", err?.message || err));
	page.on("console", (msg) => {
		if (msg.type() === "error") record("console", msg.text());
	});
}

async function runAllChecks(page) {
	let pass = 0;
	let fail = 0;
	for (const check of CHECKS) {
		const ok = await runCheck(check, page);
		if (ok) pass++;
		else fail++;
	}
	return { pass, fail };
}

async function main() {
	const browser = await chromium.launch({
		executablePath: resolveChromePath(),
		headless: true,
	});
	const pageErrors = [];
	let results = { pass: 0, fail: CHECKS.length };
	try {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 900 },
		});
		page.setDefaultTimeout(5000);
		page.setDefaultNavigationTimeout(5000);
		attachErrorListeners(page, pageErrors);
		results = await runAllChecks(page);
	} finally {
		// ponytail: ensure browser process cleanup even if test execution crashes
		await browser.close().catch(() => {});
	}
	for (const err of pageErrors) console.log(err);
	console.log(`SUMMARY pass=${results.pass} fail=${results.fail}`);
	process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(`FAIL fatal ${err.message}`);
	process.exit(1);
});
