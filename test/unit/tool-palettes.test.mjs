import assert from "node:assert/strict";
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

const UNREADY_PCB_TOOL_IDS = ["highlightNet"];

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
});
