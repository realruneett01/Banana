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

async function getMainCanvas(page) {
	const svgs = await page.locator("svg").all();
	let largest = null;
	let maxArea = -1;
	for (const svg of svgs) {
		const area = await getSvgArea(svg);
		if (area > maxArea) {
			maxArea = area;
			largest = svg;
		}
	}
	if (!largest) throw new Error("Drawing canvas svg not found");
	return largest;
}

async function clickCanvas(svg, dx = 0, dy = 0, options = {}) {
	const box = await svg.boundingBox();
	if (!box) throw new Error("Canvas bounding box missing");
	await svg.click({
		...options,
		position: {
			x: box.width / 2 + dx,
			y: box.height / 2 + dy,
		},
	});
}

async function handleTextModalIfOpen(page, text) {
	const modal = page.locator(".ant-modal:visible, [role='dialog']:visible");
	const isOpen = await modal.isVisible({ timeout: 500 }).catch(() => false);
	if (!isOpen) return;
	const input = modal.locator("input");
	await input.fill(text);
	await modal.getByRole("button", { name: "OK" }).click();
}

async function handlePourModalIfOpen(page) {
	const modal = page.locator(".ant-modal:visible");
	const isOpen = await modal.isVisible({ timeout: 1000 }).catch(() => false);
	if (!isOpen) return;
	const netSelect = modal.locator("#net-select, .ant-select");
	await netSelect.waitFor({ state: "visible", timeout: 2000 });
	const okBtn = modal.getByRole("button", { name: "OK" });
	if (await okBtn.isDisabled()) throw new Error("Pour modal OK is disabled");
	await okBtn.click();
}

async function saveFailureScreenshot(page, id) {
	try {
		await fs.mkdir(".playwright-mcp/e2e", { recursive: true });
		await page.screenshot({ path: `.playwright-mcp/e2e/${id}.png` });
	} catch {
		// ponytail: ignore screenshot errors to preserve primary test report
	}
}

async function openEditorAndNewPcb(page) {
	const baseUrl = process.env.BANANA_URL || "http://localhost:5173/";
	await page.goto(baseUrl);
	await page.getByRole("button", { name: "Editor" }).click();
	const newPcbBtn = page.getByRole("button", { name: "New PCB" }).last();
	await newPcbBtn.waitFor({ state: "visible", timeout: 4000 });
	await newPcbBtn.click();
	await page.getByRole("tab", { name: "PCB" }).click();
}

async function checkPcbPart(page) {
	await page.getByRole("button", { name: "Resistor", exact: true }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -60, 0);
	await page.getByRole("button", { name: "LED", exact: true }).click();
	await clickCanvas(svg, 60, 0);
	const summary = page.locator("section[aria-label='Board summary']");
	const countEl = summary.locator("span").filter({ hasText: /^2$/ });
	await countEl.first().waitFor({ state: "visible", timeout: 3000 });
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
	await page.getByRole("button", { name: "Board outline (rectangle)" }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -100, -80);
	await clickCanvas(svg, 100, 80);
	const outline = svg.locator("polygon, .pcb-edge-cuts polygon");
	if ((await outline.count()) === 0) {
		await dragOutline(page, svg);
	}
	await outline.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkPcbTrack(page) {
	await page.getByRole("button", { name: "Route track" }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -55, 0);
	await clickCanvas(svg, 55, 0);
	await clickCanvas(svg, 55, 0, { clickCount: 2 });
	const track = svg.locator(
		".pcb-tracks line, .pcb-tracks path, g.pcb-tracks *",
	);
	await track.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkPcbVia(page) {
	await page.getByRole("button", { name: "Via" }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, 0, 40);
	const via = svg.locator(".pcb-vias circle, g.pcb-vias circle");
	if ((await via.count()) === 0) {
		await page.getByRole("button", { name: "Route track" }).click();
		await clickCanvas(svg, 0, 40);
		await page.getByRole("button", { name: "Via" }).click();
		await clickCanvas(svg, 0, 40, { clickCount: 2 });
	}
	await via.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkPcbText(page) {
	await page.getByRole("button", { name: "Text", exact: true }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, 0, -40);
	await handleTextModalIfOpen(page, "TEXT");
	const textEl = svg.locator("text").filter({ hasText: "TEXT" });
	await textEl.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkPcbZone(page) {
	await page.getByRole("button", { name: "Filled zone" }).click();
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
	await handlePourModalIfOpen(page);
	const zone = svg.locator(".pcb-zones polygon, polygon[points]");
	await zone.first().waitFor({ state: "visible", timeout: 3000 });
}

async function addPcbGraphic(page, svg, toolName, p1, p2) {
	await page.getByRole("button", { name: toolName, exact: true }).click();
	await clickCanvas(svg, p1[0], p1[1]);
	await clickCanvas(svg, p2[0], p2[1]);
}

async function checkPcbGraphics(page) {
	const svg = await getMainCanvas(page);
	await addPcbGraphic(page, svg, "Line", [-80, -30], [-40, -30]);
	await svg
		.locator("line")
		.first()
		.waitFor({ state: "visible", timeout: 3000 });
	await addPcbGraphic(page, svg, "Rectangle", [-80, 10], [-40, 30]);
	await svg
		.locator("rect")
		.first()
		.waitFor({ state: "visible", timeout: 3000 });
	await addPcbGraphic(page, svg, "Circle", [20, -30], [35, -30]);
	await svg
		.locator("circle")
		.first()
		.waitFor({ state: "visible", timeout: 3000 });
	await addPcbGraphic(page, svg, "Dimension", [20, 10], [50, 10]);
	const dim = svg.locator(".pcb-graphic-dimension, text:has-text('mm')");
	await dim.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkSchPart(page) {
	await page.getByRole("tab", { name: "Schematic" }).click();
	await page.getByRole("button", { name: "Resistor", exact: true }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -40, 0);
	await page.getByRole("button", { name: "LED", exact: true }).click();
	await clickCanvas(svg, 40, 0);
	const resPart = svg.locator(".schematic-part, text:has-text('R')").first();
	await resPart.waitFor({ state: "visible", timeout: 3000 });
	const ledPart = svg.locator(".schematic-part, text:has-text('LED')").first();
	await ledPart.waitFor({ state: "visible", timeout: 3000 });
	const fpBox = svg.locator("text:has-text('LED_0603_1608Metric')");
	if ((await fpBox.count()) > 0)
		throw new Error("PCB footprint box shown on schematic");
}

async function checkSchWire(page) {
	await page.getByRole("button", { name: "Wire", exact: true }).click();
	const svg = await getMainCanvas(page);
	const pins = await svg.locator("circle[r='0.65']").all();
	if (pins.length >= 2) {
		await pins[0].click({ force: true });
		await pins[pins.length - 1].click({ force: true });
	} else {
		await clickCanvas(svg, -30, 0);
		await clickCanvas(svg, 30, 0);
	}
	const wire = svg.locator(".schematic-wire, [stroke*='9600']");
	await wire.first().waitFor({ state: "visible", timeout: 3000 });
	const netsVal = page
		.locator("section[aria-label='Board summary']")
		.getByText(/^[1-9]\d*$/);
	await netsVal.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkSchLabel(page) {
	await page.getByRole("button", { name: "Net label", exact: true }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -20, -50);
	await handleTextModalIfOpen(page, "NET1");
	const net1 = svg.locator("text").filter({ hasText: "NET1" });
	await net1.first().waitFor({ state: "visible", timeout: 3000 });

	await page.getByRole("button", { name: "Text", exact: true }).click();
	await clickCanvas(svg, 20, -50);
	await handleTextModalIfOpen(page, "TEXT");
	const txt = svg.locator("text").filter({ hasText: "TEXT" });
	await txt.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkSchPower(page) {
	await page.getByRole("button", { name: "GND", exact: true }).click();
	const svg = await getMainCanvas(page);
	await clickCanvas(svg, -40, 50);
	await page.getByRole("button", { name: "VCC", exact: true }).click();
	await clickCanvas(svg, 40, 50);
	const gnd = svg.locator("text").filter({ hasText: "GND" });
	await gnd.first().waitFor({ state: "visible", timeout: 3000 });
	const vcc = svg.locator("text").filter({ hasText: "VCC" });
	await vcc.first().waitFor({ state: "visible", timeout: 3000 });
}

async function checkNavZoom(page) {
	const svg = await getMainCanvas(page);
	const g = svg.locator("g[transform*='scale']").first();
	const initT = (await g.getAttribute("transform")) || "";
	await svg.hover();
	await page.mouse.wheel(0, -120);
	await page.waitForTimeout(200);
	const zoomT = (await g.getAttribute("transform")) || "";
	if (zoomT === initT) throw new Error("Zoom did not change transform");
	await page.keyboard.press("Home");
	await page.waitForTimeout(200);
	const fitT = (await g.getAttribute("transform")) || "";
	if (fitT === zoomT) throw new Error("Home did not restore fit");
}

async function assertButtonNotClipped(btn) {
	const box = await btn.boundingBox();
	if (!box) return;
	if (box.x + box.width > 1280) {
		const label =
			(await btn.getAttribute("aria-label")) || (await btn.textContent()) || "";
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

const CHECKS = [
	{ id: "pcb_part", run: checkPcbPart },
	{ id: "pcb_outline", run: checkPcbOutline },
	{ id: "pcb_track", run: checkPcbTrack },
	{ id: "pcb_via", run: checkPcbVia },
	{ id: "pcb_text", run: checkPcbText },
	{ id: "pcb_zone", run: checkPcbZone },
	{ id: "pcb_graphics", run: checkPcbGraphics },
	{ id: "sch_part", run: checkSchPart },
	{ id: "sch_wire", run: checkSchWire },
	{ id: "sch_label", run: checkSchLabel },
	{ id: "sch_power", run: checkSchPower },
	{ id: "nav_zoom", run: checkNavZoom },
	{ id: "layout", run: checkLayout },
];

async function runCheck(check, page, state) {
	try {
		if (!state.ready) {
			await openEditorAndNewPcb(page);
			state.ready = true;
		}
		await check.run(page);
		console.log(`PASS ${check.id}`);
		return true;
	} catch (err) {
		const reason = (err?.message || String(err)).split("\n")[0].slice(0, 80);
		console.log(`FAIL ${check.id} ${reason}`);
		await saveFailureScreenshot(page, check.id);
		return false;
	}
}

function attachErrorListeners(page, pageErrors) {
	page.on("pageerror", (err) => {
		const text = String(err?.message || err).slice(0, 150);
		if (pageErrors.length < 10) pageErrors.push(`ERR pageerror: ${text}`);
	});
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			const text = msg.text().slice(0, 150);
			if (pageErrors.length < 10) pageErrors.push(`ERR console: ${text}`);
		}
	});
}

async function runAllChecks(page, state) {
	let pass = 0;
	let fail = 0;
	for (const check of CHECKS) {
		const ok = await runCheck(check, page, state);
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
		attachErrorListeners(page, pageErrors);
		results = await runAllChecks(page, { ready: false });
	} finally {
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
