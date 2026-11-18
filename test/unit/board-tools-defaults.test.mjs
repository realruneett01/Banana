import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const boardToolsUrl = new URL(
	"../../frontend/src/editor/BoardTools.jsx",
	import.meta.url,
);
const boardToolsSrc = readFileSync(boardToolsUrl, "utf8");

async function loadDefaultNetFunction() {
	try {
		// When runner supports .jsx extension directly
		const mod = await import(boardToolsUrl.href);
		return mod.getDefaultNetId;
	} catch {
		// Bare node --test does not register .jsx extension: extract pure ESM chunk
		const start = boardToolsSrc.indexOf("const PREFERRED_NET_NAMES");
		const end = boardToolsSrc.indexOf("function isCopperLayer");
		const chunk = boardToolsSrc.slice(start, end);
		const mod = await import(
			`data:text/javascript,${encodeURIComponent(chunk)}`
		);
		return mod.getDefaultNetId;
	}
}

const getDefaultNetId = await loadDefaultNetFunction();

const EMPTY_OR_INVALID_CASES = [
	{ name: "undefined", input: undefined, expected: "" },
	{ name: "null", input: null, expected: "" },
	{ name: "empty array", input: [], expected: "" },
	{ name: "not an array", input: "GND", expected: "" },
];

const GND_MATCH_CASES = [
	{
		name: "uppercase GND name",
		nets: [{ name: "GND" }],
		expected: "GND",
	},
	{
		name: "lowercase gnd name",
		nets: [{ name: "gnd" }],
		expected: "gnd",
	},
	{
		name: "mixed case Gnd name",
		nets: [{ name: "Gnd" }],
		expected: "Gnd",
	},
	{
		name: "net id is returned when id exists",
		nets: [{ id: "net_gnd_1", name: "GND" }],
		expected: "net_gnd_1",
	},
	{
		name: "match by id when name is absent",
		nets: [{ id: "GND" }],
		expected: "GND",
	},
];

const PRIORITY_CASES = [
	{
		name: "GND takes precedence over GNDD, GNDA, and 0V",
		nets: [{ name: "0V" }, { name: "GNDA" }, { name: "GNDD" }, { name: "GND" }],
		expected: "GND",
	},
	{
		name: "GNDD takes precedence over GNDA and 0V",
		nets: [{ name: "0V" }, { name: "GNDA" }, { name: "GNDD" }],
		expected: "GNDD",
	},
	{
		name: "GNDA takes precedence over 0V",
		nets: [{ name: "0V" }, { name: "GNDA" }],
		expected: "GNDA",
	},
	{
		name: "0V is selected when no other ground exists",
		nets: [{ name: "0V" }, { name: "VCC" }],
		expected: "0V",
	},
	{
		name: "case-insensitive priority matching (gndd over 0v)",
		nets: [{ name: "0v" }, { name: "gndd" }],
		expected: "gndd",
	},
];

const PADS_FALLBACK_CASES = [
	{
		name: "selects net with most pins when no GND net exists",
		nets: [
			{ id: "n1", name: "VCC", pins: [1, 2] },
			{ id: "n2", name: "SDA", pins: [1, 2, 3, 4] },
			{ id: "n3", name: "SCL", pins: [1] },
		],
		expected: "n2",
	},
	{
		name: "selects net with most pads array",
		nets: [
			{ id: "n1", name: "VCC", pads: [1, 2, 3] },
			{ id: "n2", name: "SIG", pads: [1] },
		],
		expected: "n1",
	},
	{
		name: "tie in pad count selects first net",
		nets: [
			{ id: "n1", name: "VCC", pins: [1, 2] },
			{ id: "n2", name: "VDD", pins: [1, 2] },
		],
		expected: "n1",
	},
	{
		name: "GND net preferred even with fewer pads than another net",
		nets: [
			{ id: "gnd", name: "GND", pins: [1] },
			{ id: "vcc", name: "VCC", pins: [1, 2, 3, 4, 5, 6] },
		],
		expected: "gnd",
	},
	{
		name: "returns empty when no GND and all nets have 0 pads",
		nets: [
			{ id: "n1", name: "VCC", pins: [] },
			{ id: "n2", name: "SIG", pins: [] },
		],
		expected: "",
	},
	{
		name: "returns empty when nets have no pins or pads properties",
		nets: [
			{ id: "n1", name: "VCC" },
			{ id: "n2", name: "SIG" },
		],
		expected: "",
	},
];

const WIRING_CASES = [
	{
		name: "BoardTools exports getDefaultNetId",
		pattern: /export\s+function\s+getDefaultNetId\b/,
	},
	{
		name: "PourModal focuses the OK button",
		pattern: /autoFocusButton="ok"/,
	},
	{
		name: "PourModal passes autoFocus to okButtonProps",
		pattern: /okButtonProps=\{\{\s*autoFocus:\s*true\s*\}\}/,
	},
	{
		name: "useCopperPour resolves active copper layer or defaults to F.Cu",
		pattern: /resolveActiveCopperLayer\(/,
	},
	{
		name: "keeps keepout option in pour zone",
		pattern: /keepout\s*:\s*pour\.keepout/,
	},
];

describe("getDefaultNetId - empty and invalid inputs", () => {
	for (const tc of EMPTY_OR_INVALID_CASES) {
		test(`returns empty string for ${tc.name}`, () => {
			assert.equal(getDefaultNetId(tc.input), tc.expected);
		});
	}
});

describe("getDefaultNetId - GND case-insensitive match", () => {
	for (const tc of GND_MATCH_CASES) {
		test(`matches ${tc.name}`, () => {
			assert.equal(getDefaultNetId(tc.nets), tc.expected);
		});
	}
});

describe("getDefaultNetId - ground name priority", () => {
	for (const tc of PRIORITY_CASES) {
		test(tc.name, () => {
			assert.equal(getDefaultNetId(tc.nets), tc.expected);
		});
	}
});

describe("getDefaultNetId - pads fallback", () => {
	for (const tc of PADS_FALLBACK_CASES) {
		test(tc.name, () => {
			assert.equal(getDefaultNetId(tc.nets), tc.expected);
		});
	}
});

describe("BoardTools wiring and dialog defaults", () => {
	for (const tc of WIRING_CASES) {
		test(tc.name, () => {
			assert.match(boardToolsSrc, tc.pattern);
		});
	}
});
