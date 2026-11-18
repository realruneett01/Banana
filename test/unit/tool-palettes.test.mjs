import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	PCB_QUICK_FOOTPRINTS,
	PCB_QUICK_LAYERS,
	PCB_TOOLS,
	paletteFor,
	SCHEMATIC_POWER,
	SCHEMATIC_QUICK_PARTS,
	SCHEMATIC_TOOLS,
} from "../../frontend/src/editor/toolPalettes.js";

const COMMON_NAV_TOOLS = ["select", "highlightNet"];

const SCHEMATIC_WIRING_TOOLS = [
	"placeSymbol",
	"placePower",
	"placeWire",
	"placeBus",
	"placeNoConnect",
	"placeJunction",
];

const SCHEMATIC_ANNOTATION_TOOLS = [
	"placeLabel",
	"placeGlobalLabel",
	"placeHierLabel",
	"placeSheet",
	"placeText",
	"placeLine",
];

const EXPECTED_SCHEMATIC_TOOL_IDS = [
	...COMMON_NAV_TOOLS,
	...SCHEMATIC_WIRING_TOOLS,
	...SCHEMATIC_ANNOTATION_TOOLS,
];

const UNREADY_SCHEMATIC_TOOL_IDS = [];

const PCB_LAYOUT_TOOLS = [
	"placeFootprint",
	"routeTrack",
	"routeDiffPair",
	"tuneLength",
	"addVia",
	"measure",
	"addZone",
];

const PCB_GRAPHIC_TOOLS = [
	"outlineRect",
	"outlineRounded",
	"drawLine",
	"drawArc",
	"drawRect",
	"drawCircle",
	"placeText",
	"placeDimension",
];

const EXPECTED_PCB_TOOL_IDS = [
	...COMMON_NAV_TOOLS,
	...PCB_LAYOUT_TOOLS,
	...PCB_GRAPHIC_TOOLS,
];

const UNREADY_PCB_TOOL_IDS = [];

function createToolFixture(tools, expectedIds, unreadyIds) {
	return {
		tools,
		expectedIds,
		unreadyIds,
		readyIds: expectedIds.filter((id) => !unreadyIds.includes(id)),
	};
}

const SCHEMATIC_FIXTURE = createToolFixture(
	SCHEMATIC_TOOLS,
	EXPECTED_SCHEMATIC_TOOL_IDS,
	UNREADY_SCHEMATIC_TOOL_IDS,
);

const PCB_FIXTURE = createToolFixture(
	PCB_TOOLS,
	EXPECTED_PCB_TOOL_IDS,
	UNREADY_PCB_TOOL_IDS,
);

const TOOL_KEYS = ["hotkey", "icon", "id", "label", "ready"];
const PART_KEYS = ["footprint", "id", "label", "ref", "symbol", "value"];

const PALETTE_SPECS = [
	{ name: "SCHEMATIC_TOOLS", list: SCHEMATIC_TOOLS, keys: TOOL_KEYS },
	{ name: "PCB_TOOLS", list: PCB_TOOLS, keys: TOOL_KEYS },
	{
		name: "SCHEMATIC_QUICK_PARTS",
		list: SCHEMATIC_QUICK_PARTS,
		keys: PART_KEYS,
	},
	{ name: "SCHEMATIC_POWER", list: SCHEMATIC_POWER, keys: PART_KEYS },
	{
		name: "PCB_QUICK_FOOTPRINTS",
		list: PCB_QUICK_FOOTPRINTS,
		keys: PART_KEYS,
	},
];

const TAB_PALETTES = {
	schematic: {
		tools: SCHEMATIC_TOOLS,
		parts: SCHEMATIC_QUICK_PARTS,
		power: SCHEMATIC_POWER,
		layers: [],
		emptyProp: "layers",
	},
	pcb: {
		tools: PCB_TOOLS,
		parts: PCB_QUICK_FOOTPRINTS,
		power: [],
		layers: PCB_QUICK_LAYERS,
		emptyProp: "power",
	},
};

const LIB_ID_REGEX = /^[^:]+:[^:]+$/;

function toolIdsByReadiness(tools, isReady) {
	return tools.filter((tool) => tool.ready === isReady).map((tool) => tool.id);
}

function assertToolOrder(fixture) {
	const ids = fixture.tools.map((tool) => tool.id);
	assert.deepEqual(ids, fixture.expectedIds);
}

function assertToolReadiness(fixture) {
	assert.deepEqual(toolIdsByReadiness(fixture.tools, true), fixture.readyIds);
	assert.deepEqual(
		toolIdsByReadiness(fixture.tools, false),
		fixture.unreadyIds,
	);
}

function assertTabPalette(tab, expected) {
	const palette = paletteFor(tab);
	assert.ok(palette);
	assert.deepEqual(
		{
			tools: palette.tools,
			parts: palette.parts,
			power: palette.power,
			layers: palette.layers,
			isFrozen: Object.isFrozen(palette),
			emptyFrozen: Object.isFrozen(palette[expected.emptyProp]),
		},
		{
			tools: expected.tools,
			parts: expected.parts,
			power: expected.power,
			layers: expected.layers,
			isFrozen: true,
			emptyFrozen: true,
		},
	);
}

function assertListDeeplyFrozen(list) {
	assert.equal(Object.isFrozen(list), true);
	for (const item of list) {
		if (item && typeof item === "object") {
			assert.equal(Object.isFrozen(item), true);
		}
	}
}

function assertValidLibIds(item) {
	if (item.symbol) {
		assert.match(item.symbol, LIB_ID_REGEX);
	}
	if (item.footprint) {
		assert.match(item.footprint, LIB_ID_REGEX);
	}
}

describe("toolPalettes", () => {
	for (const { name, list } of PALETTE_SPECS) {
		it(`ensures ids are unique in ${name}`, () => {
			const ids = list.map((item) => item.id);
			assert.equal(new Set(ids).size, ids.length);
		});
	}

	for (const { name, list, keys } of PALETTE_SPECS) {
		it(`ensures every item in ${name} has exact keys`, () => {
			for (const item of list) {
				assert.deepEqual(Object.keys(item).sort(), keys);
			}
		});
	}

	it("preserves exact id order for SCHEMATIC_TOOLS", () => {
		assertToolOrder(SCHEMATIC_FIXTURE);
	});

	it("asserts exactly which schematic tool ids are ready", () => {
		assertToolReadiness(SCHEMATIC_FIXTURE);
	});

	it("preserves exact id order for PCB_TOOLS", () => {
		assertToolOrder(PCB_FIXTURE);
	});

	it("asserts exactly which PCB tool ids are ready", () => {
		assertToolReadiness(PCB_FIXTURE);
	});

	it("returns frozen palette for schematic tab", () => {
		assertTabPalette("schematic", TAB_PALETTES.schematic);
	});

	it("returns frozen palette for pcb tab", () => {
		assertTabPalette("pcb", TAB_PALETTES.pcb);
	});

	const UNKNOWN_TABS = ["other", "gerber", "", null, undefined, 123];
	for (const tab of UNKNOWN_TABS) {
		it(`returns null for unknown tab: ${String(tab)}`, () => {
			assert.equal(paletteFor(tab), null);
		});
	}

	it("returns stable singleton palettes", () => {
		assert.equal(paletteFor("schematic"), paletteFor("schematic"));
		assert.equal(paletteFor("pcb"), paletteFor("pcb"));
	});

	it("ensures lists and items are deeply frozen", () => {
		const allLists = [...PALETTE_SPECS.map((c) => c.list), PCB_QUICK_LAYERS];
		for (const list of allLists) {
			assertListDeeplyFrozen(list);
		}
	});

	it("validates every non-empty libId matches /^[^:]+:[^:]+$/", () => {
		const allItems = [
			...SCHEMATIC_QUICK_PARTS,
			...SCHEMATIC_POWER,
			...PCB_QUICK_FOOTPRINTS,
		];
		for (const item of allItems) {
			assertValidLibIds(item);
		}
	});

	it("verifies PCB highlightNet tool is ready with backquote hotkey", () => {
		const hlTool = PCB_TOOLS.find((t) => t.id === "highlightNet");
		assert.ok(hlTool);
		assert.deepEqual(
			{
				ready: hlTool.ready,
				hotkey: hlTool.hotkey,
				icon: hlTool.icon,
				label: hlTool.label,
			},
			{
				ready: true,
				hotkey: "backquote",
				icon: "net",
				label: "Highlight net",
			},
		);
	});
});

async function loadPcbHighlightHelpers() {
	const src = readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	);
	const imports = [
		["hitTest", "pcbGeometry"],
		["pointInZone", "zoneModel"],
		["netItemsAt", "netHighlight"],
		["padHitTest", "footprintRender"],
	].map(
		([fn, mod]) =>
			`import { ${fn} } from ${JSON.stringify(new URL(`../../frontend/src/editor/${mod}.js`, import.meta.url).href)};`,
	);
	const slices = [
		["export function chooseViaNet", "export function buildDefaultTextGraphic"],
		["function findNearPad(", "function findPadSnap("],
		["function findPinNet(", "function findTrackNet("],
		[
			"// --- PCB Net Highlight pure helpers ---",
			"// --- End PCB Net Highlight pure helpers ---",
		],
	].map(([start, end]) => src.slice(src.indexOf(start), src.indexOf(end)));

	const code = [
		...imports,
		"function isNear(p1, p2, tol = 1.0) { return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= tol; }",
		...slices,
	].join("\n");

	const b64 = Buffer.from(code).toString("base64");
	return import(`data:text/javascript;base64,${b64}`);
}

const { resolvePcbNetAtPoint, isNetMatch, isPadNetMatch, getPcbCopperOpacity } =
	await loadPcbHighlightHelpers();

function buildPcbIr() {
	const netPins = (pairs) => pairs.map(([partId, pin]) => ({ partId, pin }));
	return {
		parts: [
			{ id: "p1", ref: "R1", pins: ["1", "2"], placement: { x: 10, y: 10 } },
			{ id: "p2", ref: "R2", pins: ["1", "2"], placement: { x: 30, y: 10 } },
		],
		nets: [
			{
				id: "net_gnd",
				name: "GND",
				pins: netPins([
					["p1", "1"],
					["p2", "1"],
				]),
			},
			{ id: "net_vcc", name: "+5V", pins: netPins([["p1", "2"]]) },
		],
	};
}

function buildPcbBoard() {
	const poly = (x1, y1, x2, y2) => [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
	return {
		tracks: [
			{
				start: [10, 10],
				end: [20, 10],
				widthMm: 0.5,
				layer: "F.Cu",
				netId: "net_gnd",
			},
			{
				start: [50, 50],
				end: [60, 50],
				widthMm: 0.25,
				layer: "B.Cu",
				netId: "net_vcc",
			},
		],
		vias: [{ at: [20, 10], sizeMm: 0.8, drillMm: 0.4, netId: "net_gnd" }],
		zones: [
			{ netId: "net_vcc", layer: "F.Cu", polygon: poly(40, 40, 70, 70) },
			{
				keepout: true,
				netId: "",
				layer: "F.Cu",
				polygon: poly(0, 80, 20, 100),
			},
		],
	};
}

function buildPcbPads() {
	const mkPad = (num, netId, x) => ({
		partId: "p1",
		netId,
		number: String(num),
		center: [x, 10],
		size: [1.5, 1.5],
		shape: "rect",
	});
	return {
		pads: [mkPad(1, "net_gnd", 10), mkPad(2, "net_vcc", 12)],
		positions: {
			p1: { 1: [10, 10], 2: [12, 10] },
			p2: { 1: [30, 10], 2: [32, 10] },
		},
	};
}

function assertResolvedNet(res, expected) {
	if (expected === null) {
		assert.equal(res, null);
		return;
	}
	assert.deepEqual(
		{ ok: Boolean(res), netId: res?.netId, netName: res?.netName },
		{ ok: true, netId: expected.netId, netName: expected.netName },
	);
	if (expected.parts) {
		for (const p of expected.parts) {
			assert.equal(res.partIds.has(p), true);
		}
	}
}

function testResolveAt(pt, fixture, withPads) {
	return resolvePcbNetAtPoint({
		ir: fixture.ir,
		board: fixture.board,
		pads: withPads ? fixture.pads : [],
		padPositions: withPads ? fixture.positions : {},
		pt,
	});
}

describe("pcbNetHighlight pure helpers", () => {
	const padsData = buildPcbPads();
	const fixture = {
		ir: buildPcbIr(),
		board: buildPcbBoard(),
		pads: padsData.pads,
		positions: padsData.positions,
	};

	const RESOLVE_CASES = [
		{
			title: "resolves net from clicking a pad",
			pt: [10, 10],
			withPads: true,
			expected: { netId: "net_gnd", netName: "GND", parts: ["p1", "p2"] },
		},
		{
			title: "resolves net from clicking a via",
			pt: [20, 10],
			withPads: false,
			expected: { netId: "net_gnd", netName: "GND" },
		},
		{
			title: "resolves net from clicking a track",
			pt: [55, 50],
			withPads: false,
			expected: { netId: "net_vcc", netName: "+5V" },
		},
		{
			title: "resolves net from clicking a zone",
			pt: [50, 60],
			withPads: false,
			expected: { netId: "net_vcc", netName: "+5V" },
		},
		{
			title: "returns null when clicking empty board",
			pt: [0, 0],
			withPads: true,
			expected: null,
		},
		{
			title: "returns null when clicking keepout zone",
			pt: [10, 90],
			withPads: false,
			expected: null,
		},
	];

	for (const tc of RESOLVE_CASES) {
		it(tc.title, () => {
			const res = testResolveAt(tc.pt, fixture, tc.withPads);
			assertResolvedNet(res, tc.expected);
		});
	}

	it("tests isNetMatch with netId and netName", () => {
		const hl = { netId: "net_gnd", netName: "GND" };
		const cases = [
			["net_gnd", hl, true],
			["GND", hl, true],
			["net_vcc", hl, false],
			[null, hl, false],
			["net_gnd", null, false],
		];
		for (const [candidate, highlight, expected] of cases) {
			assert.equal(isNetMatch(candidate, highlight), expected);
		}
	});

	it("tests isPadNetMatch with pin and partId", () => {
		const hl = {
			netId: "net_gnd",
			netName: "GND",
			partIds: new Set(["p1", "p2"]),
			pins: [
				{ partId: "p1", pin: "1" },
				{ partId: "p2", pin: "1" },
			],
		};
		const cases = [
			["p1", "1", hl, true],
			["p1", 1, hl, true],
			["p1", "2", hl, false],
			["p3", "1", hl, false],
			["p1", "1", null, false],
		];
		for (const [partId, pin, highlight, expected] of cases) {
			assert.equal(isPadNetMatch(partId, pin, highlight), expected);
		}
	});

	it("tests getPcbCopperOpacity for highlighted and dimmed states", () => {
		const cases = [
			[false, false, 1],
			[true, false, 1],
			[true, true, 1],
			[false, true, 0.3],
		];
		for (const [isHl, isDim, expected] of cases) {
			assert.equal(getPcbCopperOpacity(isHl, isDim), expected);
		}
	});
});
