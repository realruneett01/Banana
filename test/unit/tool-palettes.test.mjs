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

const EXPECTED_SCHEMATIC_TOOL_IDS = [
	"select",
	"highlightNet",
	"placeSymbol",
	"placePower",
	"placeWire",
	"placeBus",
	"placeNoConnect",
	"placeJunction",
	"placeLabel",
	"placeGlobalLabel",
	"placeHierLabel",
	"placeSheet",
	"placeText",
	"placeLine",
];

const EXPECTED_READY_SCHEMATIC_TOOL_IDS = [
	"select",
	"placeSymbol",
	"placePower",
	"placeWire",
	"placeBus",
	"placeNoConnect",
	"placeJunction",
	"placeLabel",
	"placeGlobalLabel",
	"placeHierLabel",
	"placeText",
	"placeLine",
];

const EXPECTED_PCB_TOOL_IDS = [
	"select",
	"highlightNet",
	"placeFootprint",
	"routeTrack",
	"addVia",
	"addZone",
	"outlineRect",
	"outlineRounded",
	"drawLine",
	"drawArc",
	"drawRect",
	"drawCircle",
	"placeText",
	"placeDimension",
];

const PALETTE_LISTS = [
	{ name: "SCHEMATIC_TOOLS", list: SCHEMATIC_TOOLS },
	{ name: "PCB_TOOLS", list: PCB_TOOLS },
	{ name: "SCHEMATIC_QUICK_PARTS", list: SCHEMATIC_QUICK_PARTS },
	{ name: "SCHEMATIC_POWER", list: SCHEMATIC_POWER },
	{ name: "PCB_QUICK_FOOTPRINTS", list: PCB_QUICK_FOOTPRINTS },
];

const TOOL_KEYS = ["hotkey", "icon", "id", "label", "ready"];
const PART_KEYS = ["footprint", "id", "label", "ref", "symbol", "value"];

const KEY_CHECK_CASES = [
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

const LIB_ID_REGEX = /^[^:]+:[^:]+$/;

describe("toolPalettes", () => {
	for (const { name, list } of PALETTE_LISTS) {
		it(`ensures ids are unique in ${name}`, () => {
			const ids = list.map((item) => item.id);
			assert.equal(new Set(ids).size, ids.length);
		});
	}

	for (const { name, list, keys } of KEY_CHECK_CASES) {
		it(`ensures every item in ${name} has exact keys`, () => {
			for (const item of list) {
				assert.deepEqual(Object.keys(item).sort(), keys);
			}
		});
	}

	it("preserves exact id order for SCHEMATIC_TOOLS", () => {
		const ids = SCHEMATIC_TOOLS.map((tool) => tool.id);
		assert.deepEqual(ids, EXPECTED_SCHEMATIC_TOOL_IDS);
	});

	it("asserts exactly which schematic tool ids are ready", () => {
		const readyIds = SCHEMATIC_TOOLS.filter((tool) => tool.ready).map(
			(tool) => tool.id,
		);
		assert.deepEqual(readyIds, EXPECTED_READY_SCHEMATIC_TOOL_IDS);
		const unreadyIds = SCHEMATIC_TOOLS.filter((tool) => !tool.ready).map(
			(tool) => tool.id,
		);
		assert.deepEqual(unreadyIds, ["highlightNet", "placeSheet"]);
	});

	it("preserves exact id order for PCB_TOOLS", () => {
		const ids = PCB_TOOLS.map((tool) => tool.id);
		assert.deepEqual(ids, EXPECTED_PCB_TOOL_IDS);
	});

	it("returns frozen palette for schematic tab", () => {
		const palette = paletteFor("schematic");
		assert.ok(palette);
		assert.equal(palette.tools, SCHEMATIC_TOOLS);
		assert.equal(palette.parts, SCHEMATIC_QUICK_PARTS);
		assert.equal(palette.power, SCHEMATIC_POWER);
		assert.deepEqual(palette.layers, []);
		assert.equal(Object.isFrozen(palette), true);
		assert.equal(Object.isFrozen(palette.layers), true);
	});

	it("returns frozen palette for pcb tab", () => {
		const palette = paletteFor("pcb");
		assert.ok(palette);
		assert.equal(palette.tools, PCB_TOOLS);
		assert.equal(palette.parts, PCB_QUICK_FOOTPRINTS);
		assert.deepEqual(palette.power, []);
		assert.equal(palette.layers, PCB_QUICK_LAYERS);
		assert.equal(Object.isFrozen(palette), true);
		assert.equal(Object.isFrozen(palette.power), true);
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
		const allLists = [...PALETTE_LISTS.map((c) => c.list), PCB_QUICK_LAYERS];
		for (const list of allLists) {
			assert.equal(Object.isFrozen(list), true);
			for (const item of list) {
				if (typeof item === "object" && item !== null) {
					assert.equal(Object.isFrozen(item), true);
				}
			}
		}
	});

	it("validates every non-empty libId matches /^[^:]+:[^:]+$/", () => {
		const partLists = [
			SCHEMATIC_QUICK_PARTS,
			SCHEMATIC_POWER,
			PCB_QUICK_FOOTPRINTS,
		];
		for (const list of partLists) {
			for (const item of list) {
				if (item.symbol) {
					assert.match(item.symbol, LIB_ID_REGEX);
				}
				if (item.footprint) {
					assert.match(item.footprint, LIB_ID_REGEX);
				}
			}
		}
	});
});
