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

const namedNet = (name) => ({ name });
const idNet = (id, name) => (name ? { id, name } : { id });
const withPins = (id, name, pins) => ({ id, name, pins });
const withPads = (id, name, pads) => ({ id, name, pads });
const namedGroup = (...names) => names.map(namedNet);

const NET_TEST_SUITES = [
	{
		title: "getDefaultNetId - empty and invalid inputs",
		formatTitle: (name) => `returns empty string for ${name}`,
		cases: [
			["undefined", undefined, ""],
			["null", null, ""],
			["empty array", [], ""],
			["not an array", "GND", ""],
		],
	},
	{
		title: "getDefaultNetId - GND case-insensitive match",
		formatTitle: (name) => `matches ${name}`,
		cases: [
			["uppercase GND name", [namedNet("GND")], "GND"],
			["lowercase gnd name", [namedNet("gnd")], "gnd"],
			["mixed case Gnd name", [namedNet("Gnd")], "Gnd"],
			[
				"net id is returned when id exists",
				[idNet("net_gnd_1", "GND")],
				"net_gnd_1",
			],
			["match by id when name is absent", [idNet("GND")], "GND"],
		],
	},
	{
		title: "getDefaultNetId - ground name priority",
		cases: [
			[
				"GND takes precedence over GNDD, GNDA, and 0V",
				namedGroup("0V", "GNDA", "GNDD", "GND"),
				"GND",
			],
			[
				"GNDD takes precedence over GNDA and 0V",
				namedGroup("0V", "GNDA", "GNDD"),
				"GNDD",
			],
			["GNDA takes precedence over 0V", namedGroup("0V", "GNDA"), "GNDA"],
			[
				"0V is selected when no other ground exists",
				namedGroup("0V", "VCC"),
				"0V",
			],
			[
				"case-insensitive priority matching (gndd over 0v)",
				namedGroup("0v", "gndd"),
				"gndd",
			],
		],
	},
	{
		title: "getDefaultNetId - pads fallback",
		cases: [
			[
				"selects net with most pins when no GND net exists",
				[
					withPins("n1", "VCC", [1, 2]),
					withPins("n2", "SDA", [1, 2, 3, 4]),
					withPins("n3", "SCL", [1]),
				],
				"n2",
			],
			[
				"selects net with most pads array",
				[withPads("n1", "VCC", [1, 2, 3]), withPads("n2", "SIG", [1])],
				"n1",
			],
			[
				"tie in pad count selects first net",
				[withPins("n1", "VCC", [1, 2]), withPins("n2", "VDD", [1, 2])],
				"n1",
			],
			[
				"GND net preferred even with fewer pads than another net",
				[
					withPins("gnd", "GND", [1]),
					withPins("vcc", "VCC", [1, 2, 3, 4, 5, 6]),
				],
				"gnd",
			],
			[
				"returns empty when no GND and all nets have 0 pads",
				[withPins("n1", "VCC", []), withPins("n2", "SIG", [])],
				"",
			],
			[
				"returns empty when nets have no pins or pads properties",
				[idNet("n1", "VCC"), idNet("n2", "SIG")],
				"",
			],
		],
	},
];

for (const suite of NET_TEST_SUITES) {
	describe(suite.title, () => {
		const format = suite.formatTitle ?? ((name) => name);
		for (const [name, input, expected] of suite.cases) {
			test(format(name), () => {
				assert.equal(getDefaultNetId(input), expected);
			});
		}
	});
}

const WIRING_CASES = [
	[
		"BoardTools exports getDefaultNetId",
		/export\s+function\s+getDefaultNetId\b/,
	],
	["PourModal focuses the OK button", /autoFocusButton="ok"/],
	[
		"PourModal passes autoFocus to okButtonProps",
		/okButtonProps=\{\{\s*autoFocus:\s*true\s*\}\}/,
	],
	[
		"useCopperPour resolves active copper layer or defaults to F.Cu",
		/resolveActiveCopperLayer\(/,
	],
	["keeps keepout option in pour zone", /keepout\s*:\s*pour\.keepout/],
];

describe("BoardTools wiring and dialog defaults", () => {
	for (const [name, pattern] of WIRING_CASES) {
		test(name, () => {
			assert.match(boardToolsSrc, pattern);
		});
	}
});
