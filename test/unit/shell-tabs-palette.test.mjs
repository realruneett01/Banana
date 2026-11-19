import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const tabsUrl = new URL(
	"../../frontend/src/shell/EditorTabs.jsx",
	import.meta.url,
);
const paletteUrl = new URL(
	"../../frontend/src/shell/CommandPalette.jsx",
	import.meta.url,
);

async function loadHelperModule(fileUrl, marker) {
	try {
		return await import(fileUrl.href);
	} catch {
		const src = readFileSync(fileUrl, "utf8");
		const start = src.indexOf(`// --- Pure ${marker} helpers ---`);
		const end = src.indexOf(`// --- End pure ${marker} helpers ---`);
		const chunk = src.slice(start, end);
		return await import(`data:text/javascript,${encodeURIComponent(chunk)}`);
	}
}

const { nextTabId } = await loadHelperModule(tabsUrl, "tabs");
const { fuzzyScore, rankCommands } = await loadHelperModule(
	paletteUrl,
	"palette",
);

describe("fuzzyScore", () => {
	const NON_MATCH_CASES = [
		["xyz", "banana"],
		["abc", "acb"],
		["drc", "schematic"],
		[null, "pcb"],
		["pcb", null],
		[123, "test"],
	];

	test("returns null for non-matches or invalid inputs", () => {
		for (const [q, text] of NON_MATCH_CASES) {
			assert.equal(fuzzyScore(q, text), null);
		}
	});

	test("returns zero for empty query string", () => {
		assert.equal(fuzzyScore("", "schematic"), 0);
	});

	const MATCH_CASES = [
		["sch", "schematic"],
		["pcb", "pcb_layout"],
		["3d", "3d_viewer"],
		["DIFF", "diff"],
	];

	test("returns positive score for valid subsequence matches", () => {
		for (const [q, text] of MATCH_CASES) {
			const score = fuzzyScore(q, text);
			assert.ok(typeof score === "number" && score > 0);
		}
	});

	const COMPARISON_CASES = [
		{ high: ["abc", "abcdef"], low: ["abc", "axbycz"] },
		{ high: ["cat", "Cool Blue Cat"], low: ["cat", "Scattered Notes"] },
		{ high: ["pcb", "pcb"], low: ["pcb", "pcb layer view"] },
	];

	test("ranks consecutive, word-start, and exact matches higher", () => {
		for (const { high, low } of COMPARISON_CASES) {
			const higherScore = fuzzyScore(high[0], high[1]);
			const lowerScore = fuzzyScore(low[0], low[1]);
			assert.ok(higherScore > lowerScore);
		}
	});
});

describe("rankCommands", () => {
	const SAMPLE_COMMANDS = [
		{ id: "1", title: "Open Schematic", category: "View", shortcut: "Ctrl+1" },
		{ id: "2", title: "Open PCB", category: "View", shortcut: "Ctrl+2" },
		{ id: "3", title: "Run DRC Check", category: "Tools", shortcut: "F8" },
		{ id: "4", title: "Export Gerber", category: "Fabrication" },
		{ id: "5", title: "Toggle 3D View", category: "View", shortcut: "Alt+3" },
	];

	test("returns empty array for invalid commands input", () => {
		assert.deepEqual(rankCommands(null, "test"), []);
		assert.deepEqual(rankCommands(undefined, "test"), []);
	});

	const FILTER_CASES = [
		{ q: "", minLen: 5, expectedTopId: null },
		{ q: "   ", minLen: 5, expectedTopId: null },
		{ q: "gerber", minLen: 1, expectedTopId: "4" },
		{ q: "fabrication", minLen: 1, expectedTopId: "4" },
		{ q: "pcb", minLen: 1, expectedTopId: "2" },
	];

	test("filters and ranks commands matching title or category", () => {
		for (const { q, minLen, expectedTopId } of FILTER_CASES) {
			const results = rankCommands(SAMPLE_COMMANDS, q);
			assert.ok(results.length >= minLen);
			if (expectedTopId) {
				assert.equal(results[0].id, expectedTopId);
			}
		}
	});
});

describe("nextTabId", () => {
	const TABS = [
		{ id: "tab-sch", title: "Schematic", kind: "schematic" },
		{ id: "tab-pcb", title: "PCB", kind: "pcb" },
		{ id: "tab-3d", title: "3D View", kind: "3d" },
	];

	test("returns null for empty or invalid tabs", () => {
		assert.equal(nextTabId([], "tab-sch", 1), null);
		assert.equal(nextTabId(null, "tab-sch", 1), null);
	});

	test("returns single tab id regardless of active or step", () => {
		const single = [{ id: "solo" }];
		assert.equal(nextTabId(single, "solo", 1), "solo");
		assert.equal(nextTabId(single, "solo", -1), "solo");
		assert.equal(nextTabId(single, "unknown", 1), "solo");
	});

	const NAVIGATION_CASES = [
		["tab-sch", 1, "tab-pcb"],
		["tab-pcb", 1, "tab-3d"],
		["tab-3d", 1, "tab-sch"],
		["tab-3d", -1, "tab-pcb"],
		["tab-pcb", -1, "tab-sch"],
		["tab-sch", -1, "tab-3d"],
		["unknown-id", 1, "tab-sch"],
	];

	test("cycles through tabs forward and backward with wrapping", () => {
		for (const [active, step, expected] of NAVIGATION_CASES) {
			assert.equal(nextTabId(TABS, active, step), expected);
		}
	});
});

describe("source contracts", () => {
	const tabsSrc = readFileSync(tabsUrl, "utf8");
	const paletteSrc = readFileSync(paletteUrl, "utf8");

	const CONTRACT_CASES = [
		[
			tabsSrc,
			[
				"schematic",
				"pcb",
				"3d",
				"holo",
				"diff",
				"fields",
				"footprints",
				"welcome",
				"settings",
				"--bn-tab-h",
			],
		],
		[paletteSrc, ["600px", "slice(0, 12)", "fuzzyScore", "rankCommands"]],
	];

	test("shell components contain required contracts and tokens", () => {
		for (const [source, needles] of CONTRACT_CASES) {
			for (const needle of needles) {
				assert.ok(source.includes(needle));
			}
		}
	});
});
