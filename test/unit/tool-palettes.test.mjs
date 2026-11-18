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

const UNREADY_SCHEMATIC_TOOL_IDS = ["placeSheet"];

const PCB_LAYOUT_TOOLS = ["placeFootprint", "routeTrack", "addVia", "addZone"];

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
	assert.equal(palette.tools, expected.tools);
	assert.equal(palette.parts, expected.parts);
	if (Array.isArray(expected.power)) {
		assert.deepEqual(palette.power, expected.power);
	} else {
		assert.equal(palette.power, expected.power);
	}
	if (Array.isArray(expected.layers)) {
		assert.deepEqual(palette.layers, expected.layers);
	} else {
		assert.equal(palette.layers, expected.layers);
	}
	assert.equal(Object.isFrozen(palette), true);
	assert.equal(Object.isFrozen(palette[expected.emptyProp]), true);
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
		assert.equal(hlTool.ready, true);
		assert.equal(hlTool.hotkey, "backquote");
		assert.equal(hlTool.icon, "net");
		assert.equal(hlTool.label, "Highlight net");
	});
});

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);
const startMarker = "// --- PCB Net Highlight pure helpers ---";
const endMarker = "// --- End PCB Net Highlight pure helpers ---";
const sliceStart = pcbCanvasSrc.indexOf(startMarker);
const sliceEnd = pcbCanvasSrc.indexOf(endMarker);
assert.ok(
	sliceStart !== -1 && sliceEnd !== -1,
	"Found PCB net highlight pure helpers",
);
const pureHelpersCode = pcbCanvasSrc.slice(sliceStart, sliceEnd);

const pcbGeometryUrl = new URL(
	"../../frontend/src/editor/pcbGeometry.js",
	import.meta.url,
).href;
const zoneModelUrl = new URL(
	"../../frontend/src/editor/zoneModel.js",
	import.meta.url,
).href;
const netHighlightUrl = new URL(
	"../../frontend/src/editor/netHighlight.js",
	import.meta.url,
).href;
const footprintRenderUrl = new URL(
	"../../frontend/src/editor/footprintRender.js",
	import.meta.url,
).href;

const chooseViaStart = pcbCanvasSrc.indexOf("export function chooseViaNet");
const chooseViaEnd = pcbCanvasSrc.indexOf(
	"export function buildDefaultTextGraphic",
);
const chooseViaCode = pcbCanvasSrc.slice(chooseViaStart, chooseViaEnd);

const findNearPadStart = pcbCanvasSrc.indexOf("function findNearPad(");
const findNearPadEnd = pcbCanvasSrc.indexOf("function findPadSnap(");
const findNearPadCode = pcbCanvasSrc.slice(findNearPadStart, findNearPadEnd);

const findPinNetStart = pcbCanvasSrc.indexOf("function findPinNet(");
const findPinNetEnd = pcbCanvasSrc.indexOf("function findTrackNet(");
const findPinNetCode = pcbCanvasSrc.slice(findPinNetStart, findPinNetEnd);

const dynamicModule = [
	`import { hitTest } from ${JSON.stringify(pcbGeometryUrl)};`,
	`import { pointInZone } from ${JSON.stringify(zoneModelUrl)};`,
	`import { netItemsAt } from ${JSON.stringify(netHighlightUrl)};`,
	`import { padHitTest } from ${JSON.stringify(footprintRenderUrl)};`,
	"function isNear(p1, p2, tol = 1.0) { return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= tol; }",
	chooseViaCode,
	findNearPadCode,
	findPinNetCode,
	pureHelpersCode,
].join("\n");

const { resolvePcbNetAtPoint, isNetMatch, isPadNetMatch, getPcbCopperOpacity } =
	await import(
		`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
	);

describe("pcbNetHighlight pure helpers", () => {
	const sampleIr = {
		parts: [
			{ id: "p1", ref: "R1", pins: ["1", "2"], placement: { x: 10, y: 10 } },
			{ id: "p2", ref: "R2", pins: ["1", "2"], placement: { x: 30, y: 10 } },
		],
		nets: [
			{
				id: "net_gnd",
				name: "GND",
				pins: [
					{ partId: "p1", pin: "1" },
					{ partId: "p2", pin: "1" },
				],
			},
			{
				id: "net_vcc",
				name: "+5V",
				pins: [{ partId: "p1", pin: "2" }],
			},
		],
	};

	const sampleBoard = {
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
		vias: [
			{
				at: [20, 10],
				sizeMm: 0.8,
				drillMm: 0.4,
				netId: "net_gnd",
			},
		],
		zones: [
			{
				netId: "net_vcc",
				layer: "F.Cu",
				polygon: [
					[40, 40],
					[70, 40],
					[70, 70],
					[40, 70],
				],
			},
			{
				keepout: true,
				netId: "",
				layer: "F.Cu",
				polygon: [
					[0, 80],
					[20, 80],
					[20, 100],
					[0, 100],
				],
			},
		],
	};

	const samplePadPositions = {
		p1: { 1: [10, 10], 2: [12, 10] },
		p2: { 1: [30, 10], 2: [32, 10] },
	};

	const samplePads = [
		{
			partId: "p1",
			netId: "net_gnd",
			number: "1",
			center: [10, 10],
			size: [1.5, 1.5],
			shape: "rect",
		},
		{
			partId: "p1",
			netId: "net_vcc",
			number: "2",
			center: [12, 10],
			size: [1.5, 1.5],
			shape: "rect",
		},
	];

	it("resolves net from clicking a pad", () => {
		const res = resolvePcbNetAtPoint({
			ir: sampleIr,
			board: sampleBoard,
			pads: samplePads,
			padPositions: samplePadPositions,
			pt: [10, 10],
		});
		assert.ok(res);
		assert.equal(res.netId, "net_gnd");
		assert.equal(res.netName, "GND");
		assert.equal(res.partIds.has("p1"), true);
		assert.equal(res.partIds.has("p2"), true);
	});

	it("resolves net from clicking a via", () => {
		const res = resolvePcbNetAtPoint({
			ir: sampleIr,
			board: sampleBoard,
			pads: [],
			padPositions: {},
			pt: [20, 10],
		});
		assert.ok(res);
		assert.equal(res.netId, "net_gnd");
		assert.equal(res.netName, "GND");
	});

	it("resolves net from clicking a track", () => {
		const res = resolvePcbNetAtPoint({
			ir: sampleIr,
			board: sampleBoard,
			pads: [],
			padPositions: {},
			pt: [55, 50],
		});
		assert.ok(res);
		assert.equal(res.netId, "net_vcc");
		assert.equal(res.netName, "+5V");
	});

	it("resolves net from clicking a zone", () => {
		const res = resolvePcbNetAtPoint({
			ir: sampleIr,
			board: sampleBoard,
			pads: [],
			padPositions: {},
			pt: [50, 60],
		});
		assert.ok(res);
		assert.equal(res.netId, "net_vcc");
		assert.equal(res.netName, "+5V");
	});

	it("returns null when clicking empty board", () => {
		const res = resolvePcbNetAtPoint({
			ir: sampleIr,
			board: sampleBoard,
			pads: samplePads,
			padPositions: samplePadPositions,
			pt: [0, 0],
		});
		assert.equal(res, null);
	});

	it("returns null when clicking keepout zone", () => {
		const res = resolvePcbNetAtPoint({
			ir: sampleIr,
			board: sampleBoard,
			pads: [],
			padPositions: {},
			pt: [10, 90],
		});
		assert.equal(res, null);
	});

	it("tests isNetMatch with netId and netName", () => {
		const hl = { netId: "net_gnd", netName: "GND" };
		assert.equal(isNetMatch("net_gnd", hl), true);
		assert.equal(isNetMatch("GND", hl), true);
		assert.equal(isNetMatch("net_vcc", hl), false);
		assert.equal(isNetMatch(null, hl), false);
		assert.equal(isNetMatch("net_gnd", null), false);
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
		assert.equal(isPadNetMatch("p1", "1", hl), true);
		assert.equal(isPadNetMatch("p1", 1, hl), true);
		assert.equal(isPadNetMatch("p1", "2", hl), false);
		assert.equal(isPadNetMatch("p3", "1", hl), false);
		assert.equal(isPadNetMatch("p1", "1", null), false);
	});

	it("tests getPcbCopperOpacity for highlighted and dimmed states", () => {
		assert.equal(getPcbCopperOpacity(false, false), 1);
		assert.equal(getPcbCopperOpacity(true, false), 1);
		assert.equal(getPcbCopperOpacity(true, true), 1);
		assert.equal(getPcbCopperOpacity(false, true), 0.3);
	});
});
