import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ideShellUrl = new URL(
	"../../frontend/src/shell/IdeShell.jsx",
	import.meta.url,
);
const splitPaneUrl = new URL(
	"../../frontend/src/shell/SplitPane.jsx",
	import.meta.url,
);

const ideShellSrc = readFileSync(ideShellUrl, "utf8");
const splitPaneSrc = readFileSync(splitPaneUrl, "utf8");

async function loadPureHelpers() {
	const startTag = "// --- Pure IDE Shell helpers ---";
	const endTag = "// --- End Pure IDE Shell helpers ---";
	const start = ideShellSrc.indexOf(startTag);
	const end = ideShellSrc.indexOf(endTag);
	const chunk = ideShellSrc.slice(start, end);
	const base64 = Buffer.from(chunk).toString("base64");
	return import(`data:text/javascript;base64,${base64}`);
}

const { clampSize, gridColumns } = await loadPureHelpers();

const CLAMP_TEST_CASES = [
	{ desc: "in-range value preserved", size: 260, min: 180, max: 480, exp: 260 },
	{ desc: "clamps to min", size: 100, min: 180, max: 480, exp: 180 },
	{ desc: "clamps to max", size: 600, min: 180, max: 480, exp: 480 },
	{ desc: "exact min boundary", size: 180, min: 180, max: 480, exp: 180 },
	{ desc: "exact max boundary", size: 480, min: 180, max: 480, exp: 480 },
	{
		desc: "open upper bound below min",
		size: 50,
		min: 120,
		max: null,
		exp: 120,
	},
	{
		desc: "open upper bound above min",
		size: 300,
		min: 120,
		max: null,
		exp: 300,
	},
	{ desc: "string numeric input", size: "350", min: 180, max: 480, exp: 350 },
	{
		desc: "NaN input falls back to min",
		size: Number.NaN,
		min: 180,
		max: 480,
		exp: 180,
	},
];

describe("clampSize helper", () => {
	for (const { desc, size, min, max, exp } of CLAMP_TEST_CASES) {
		it(`correctly handles ${desc}`, () => {
			assert.equal(clampSize(size, min, max), exp);
		});
	}
});

const GRID_TEST_CASES = [
	{
		desc: "defaults with sidebar open and aux closed",
		opts: undefined,
		exp: "48px 260px 1fr",
	},
	{
		desc: "sidebar open, aux closed",
		opts: { sidebarOpen: true, auxOpen: false },
		exp: "48px 260px 1fr",
	},
	{
		desc: "sidebar closed, aux closed",
		opts: { sidebarOpen: false, auxOpen: false },
		exp: "48px 1fr",
	},
	{
		desc: "both sidebar and aux open",
		opts: { sidebarOpen: true, auxOpen: true },
		exp: "48px 260px 1fr 320px",
	},
	{
		desc: "sidebar closed and aux open",
		opts: { sidebarOpen: false, auxOpen: true },
		exp: "48px 1fr 320px",
	},
	{
		desc: "custom valid sizes",
		opts: {
			sidebarOpen: true,
			auxOpen: true,
			sizes: { sidebar: 350, aux: 450 },
		},
		exp: "48px 350px 1fr 450px",
	},
	{
		desc: "sizes clamped to bounds",
		opts: {
			sidebarOpen: true,
			auxOpen: true,
			sizes: { sidebar: 50, aux: 900 },
		},
		exp: "48px 180px 1fr 560px",
	},
	{
		desc: "custom activity bar width",
		opts: { sidebarOpen: false, auxOpen: false, sizes: { activityBar: 56 } },
		exp: "56px 1fr",
	},
];

describe("gridColumns helper", () => {
	for (const { desc, opts, exp } of GRID_TEST_CASES) {
		it(`computes columns for ${desc}`, () => {
			assert.equal(gridColumns(opts), exp);
		});
	}
});

describe("SplitPane component contract", () => {
	it("exports SplitPane and pure helper clampSize", () => {
		assert.match(splitPaneSrc, /export function SplitPane/);
		assert.match(splitPaneSrc, /export function clampSize/);
		assert.match(splitPaneSrc, /export function ResizeHandle/);
	});

	it("implements pointer capture and dragging styles", () => {
		assert.match(splitPaneSrc, /setPointerCapture/);
		assert.match(splitPaneSrc, /releasePointerCapture/);
		assert.match(splitPaneSrc, /var\(--bn-color-brand/);
		assert.match(splitPaneSrc, /var\(--bn-border-base/);
	});

	it("implements 4px hit area and 1px visible line", () => {
		assert.match(splitPaneSrc, /"4px"/);
		assert.match(splitPaneSrc, /"1px"/);
	});

	it("supports double-click reset to defaultSize", () => {
		assert.match(splitPaneSrc, /onDoubleClick/);
		assert.match(splitPaneSrc, /defaultSize/);
	});
});

describe("IdeShell component contract", () => {
	it("exports IdeShell, clampSize, and gridColumns", () => {
		assert.match(ideShellSrc, /export function IdeShell/);
		assert.match(ideShellSrc, /export function gridColumns/);
		assert.match(ideShellSrc, /export function clampSize/);
	});

	it("configures layout regions and tokens", () => {
		assert.match(ideShellSrc, /var\(--bn-bg-app/);
		assert.match(ideShellSrc, /var\(--bn-bg-surface/);
		assert.match(ideShellSrc, /var\(--bn-bg-editor/);
		assert.match(ideShellSrc, /var\(--bn-status-bar-h,\s*22px\)/);
		assert.match(ideShellSrc, /var\(--bn-activity-bar-w,\s*48px\)/);
	});

	it("handles panel ranges and height constraint", () => {
		assert.match(ideShellSrc, /180,\s*480/); // sidebar range
		assert.match(ideShellSrc, /240,\s*560/); // aux range
		assert.match(ideShellSrc, /0\.6/); // 60 percent of height
		assert.match(ideShellSrc, /120/); // min bottom height
	});

	it("persists sizes in localStorage safely", () => {
		assert.match(ideShellSrc, /localStorage\.getItem/);
		assert.match(ideShellSrc, /localStorage\.setItem/);
		assert.match(ideShellSrc, /try\s*\{/);
		assert.match(ideShellSrc, /catch/);
	});

	it("prevents page scroll and enables internal region scrolling", () => {
		assert.match(ideShellSrc, /overflow:\s*"hidden"/);
		assert.match(ideShellSrc, /overflow:\s*"auto"/);
	});
});
