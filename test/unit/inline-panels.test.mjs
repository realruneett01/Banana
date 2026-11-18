import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const chatbotUrl = new URL(
	"../../frontend/src/ChatbotDrawer.jsx",
	import.meta.url,
);
const simUrl = new URL(
	"../../frontend/src/components/SimulationDrawer.jsx",
	import.meta.url,
);

async function loadChromeHelper(fileUrl) {
	try {
		const mod = await import(fileUrl.href);
		return mod.panelChrome;
	} catch (_err) {
		// ponytail: Node does not natively execute .jsx files; fallback to extracting pure JS block
		const src = readFileSync(fileUrl, "utf8");
		const start = src.indexOf("// --- Pure panel chrome helpers ---");
		const end = src.indexOf("// --- End pure panel chrome helpers ---");
		const chunk = src.slice(start, end);
		const mod = await import(
			`data:text/javascript,${encodeURIComponent(chunk)}`
		);
		return mod.panelChrome;
	}
}

const chatbotChrome = await loadChromeHelper(chatbotUrl);
const simChrome = await loadChromeHelper(simUrl);

const CHROME_CASES = [
	{
		label: "default options",
		input: undefined,
		expected: {
			isInline: false,
			wrapper: "drawer",
			showHeader: false,
			showClose: false,
			headerHeight: undefined,
		},
	},
	{
		label: "drawer mode with title",
		input: { inline: false, title: "Title" },
		expected: {
			isInline: false,
			wrapper: "drawer",
			showHeader: true,
			showClose: false,
			headerHeight: undefined,
		},
	},
	{
		label: "drawer mode with title and onClose",
		input: { inline: false, title: "Title", onClose: () => {} },
		expected: {
			isInline: false,
			wrapper: "drawer",
			showHeader: true,
			showClose: true,
			headerHeight: undefined,
		},
	},
	{
		label: "inline mode without onClose",
		input: { inline: true, title: "Title" },
		expected: {
			isInline: true,
			wrapper: "inline",
			showHeader: true,
			showClose: false,
			headerHeight: 30,
		},
	},
	{
		label: "inline mode with onClose",
		input: { inline: true, title: "Title", onClose: () => {} },
		expected: {
			isInline: true,
			wrapper: "inline",
			showHeader: true,
			showClose: true,
			headerHeight: 30,
		},
	},
	{
		label: "inline mode with no title and no onClose",
		input: { inline: true },
		expected: {
			isInline: true,
			wrapper: "inline",
			showHeader: false,
			showClose: false,
			headerHeight: 30,
		},
	},
	{
		label: "inline mode with no title but onClose",
		input: { inline: true, onClose: () => {} },
		expected: {
			isInline: true,
			wrapper: "inline",
			showHeader: true,
			showClose: true,
			headerHeight: 30,
		},
	},
];

function verifyChrome(actual, expected) {
	assert.equal(actual.isInline, expected.isInline);
	assert.equal(actual.wrapper, expected.wrapper);
	assert.equal(actual.showHeader, expected.showHeader);
	assert.equal(actual.showClose, expected.showClose);
	assert.equal(actual.headerHeight, expected.headerHeight);
}

describe("inline panels chrome helper", () => {
	it("chatbot panelChrome matches expectations across all modes", () => {
		for (const tc of CHROME_CASES) {
			const res = chatbotChrome(tc.input);
			verifyChrome(res, tc.expected);
		}
	});

	it("simulation panelChrome matches expectations across all modes", () => {
		for (const tc of CHROME_CASES) {
			const res = simChrome(tc.input);
			verifyChrome(res, tc.expected);
		}
	});
});
