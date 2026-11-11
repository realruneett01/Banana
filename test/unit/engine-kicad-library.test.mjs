import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createKicadLibrary } from "../../backend/src/engine/kicad-library.js";

function buildSymbol({ name, props, extra = "", gfx, pins }) {
	const propLines = Object.entries(props)
		.map(([k, [v, at]]) => `\t\t(property "${k}" "${v}" (at ${at}))`)
		.join("\n");
	const pinLines = pins
		.map(
			(p) =>
				`\t\t\t(pin ${p.type} line (at ${p.at}) (length ${p.len})\n\t\t\t\t(name "${p.name}")\n\t\t\t\t(number "${p.num}")\n\t\t\t)`,
		)
		.join("\n");
	const extraBlock = extra ? `\n${extra}` : "";
	return `\t(symbol "${name}"${extraBlock}\n${propLines}\n\t\t(symbol "${name}_0_1"\n\t\t\t${gfx}\n\t\t)\n\t\t(symbol "${name}_1_1"\n${pinLines}\n\t\t)\n\t)`;
}

function buildSymbolLib(symbols) {
	const body = Array.isArray(symbols) ? symbols.join("\n") : symbols;
	return `(kicad_symbol_lib\n\t(version 20211014)\n\t(generator "kicad_symbol_editor")\n${body}\n)`;
}

function buildFootprint({ name, descr, tags, props = [], pads, line }) {
	const propLines = props
		.map(([k, v, at]) => `\t(property "${k}" "${v}" (at ${at}))`)
		.join("\n");
	const padLines = pads
		.map(
			(p) =>
				`\t(pad "${p.num}" smd roundrect (at ${p.at}) (size ${p.size}) (layers "F.Cu" "F.Paste" "F.Mask"))`,
		)
		.join("\n");
	const propBlock = propLines ? `\n${propLines}` : "";
	return `(footprint "${name}"\n\t(version 20211014)\n\t(generator "pcbnew")\n\t(descr "${descr}")\n\t(tags "${tags}")${propBlock}\n${padLines}\n\t(fp_line (start ${line.start}) (end ${line.end}) (layer "F.SilkS"))\n)`;
}

const SYMBOL_DEVICE_CONTENT = buildSymbolLib([
	buildSymbol({
		name: "R",
		extra:
			"\t\t(pin_numbers hide)\n\t\t(pin_names (offset 0))\n\t\t(in_bom yes)\n\t\t(on_board yes)",
		props: {
			Reference: ["R", "2.032 0 90"],
			Value: ["R", "0 0 90"],
			Footprint: ["Resistor_SMD:R_0805", "-1.778 0 90"],
			Description: ["Resistor", "0 0 0"],
			ki_keywords: ["R res resistor", "0 0 0"],
		},
		gfx: "(rectangle (start -1.016 -2.54) (end 1.016 2.54))",
		pins: [
			{ type: "passive", at: "0 3.81 270", len: "1.27", name: "~", num: "1" },
			{ type: "passive", at: "0 -3.81 90", len: "1.27", name: "~", num: "2" },
		],
	}),
	buildSymbol({
		name: "R_Small",
		props: {
			Reference: ["R", "0 0 90"],
			Value: ["R_Small", "0 0 90"],
			Footprint: ["", "0 0 90"],
			Description: ["Small resistor", "0 0 0"],
			ki_keywords: ["resistor", "0 0 0"],
		},
		gfx: "(rectangle (start -0.5 -1.5) (end 0.5 1.5))",
		pins: [
			{ type: "passive", at: "0 2.54 270", len: "1.27", name: "~", num: "1" },
			{ type: "passive", at: "0 -2.54 90", len: "1.27", name: "~", num: "2" },
		],
	}),
]);

const SYMBOL_TRANSISTOR_CONTENT = buildSymbolLib(
	buildSymbol({
		name: "Q_NPN_BCE",
		props: {
			Reference: ["Q", "0 0 90"],
			Value: ["Q_NPN_BCE", "0 0 90"],
			Footprint: ["", "0 0 90"],
			Description: ["NPN transistor, collector/base/emitter", "0 0 0"],
			ki_keywords: ["transistor NPN", "0 0 0"],
		},
		gfx: "(polyline (pts (xy 0 1) (xy 0 -1)))",
		pins: [
			{ type: "input", at: "-5.08 0 0", len: "2.54", name: "B", num: "1" },
			{
				type: "passive",
				at: "2.54 5.08 270",
				len: "2.54",
				name: "C",
				num: "2",
			},
			{
				type: "passive",
				at: "2.54 -5.08 90",
				len: "2.54",
				name: "E",
				num: "3",
			},
		],
	}),
);

const FP_R0805_CONTENT = buildFootprint({
	name: "R_0805",
	descr: "Resistor SMD 0805 metric",
	tags: "resistor 0805 smd",
	props: [
		["Reference", "REF**", "0 -1.5 0"],
		["Value", "R_0805", "0 1.5 0"],
	],
	pads: [
		{ num: "1", at: "-0.95 0", size: "1 1.45" },
		{ num: "2", at: "0.95 0 90", size: "1 1.45" },
	],
	line: { start: "-1.7 -1", end: "1.7 -1" },
});

const FP_R1206_CONTENT = buildFootprint({
	name: "R_1206",
	descr: "Resistor SMD 1206 metric",
	tags: "resistor 1206 smd",
	pads: [
		{ num: "1", at: "-1.4 0", size: "1.1 1.8" },
		{ num: "2", at: "1.4 0", size: "1.1 1.8" },
	],
	line: { start: "-2.2 -1.2", end: "2.2 -1.2" },
});

const INVALID_LIB_IDS = [
	"../x:y",
	"a:..\\b",
	"../../etc/passwd:x",
	"foo:bar/baz",
	"foo:bar\\baz",
	":bar",
	"foo:",
	"",
	null,
	undefined,
];

const EXPECTED_R_PROPERTIES = {
	Reference: "R",
	Value: "R",
	Description: "Resistor",
	Footprint: "Resistor_SMD:R_0805",
};

const EXPECTED_R_PINS = [
	{
		number: "1",
		name: "~",
		type: "passive",
		at: [0, 3.81, 270],
		length: 1.27,
	},
	{
		number: "2",
		name: "~",
		type: "passive",
		at: [0, -3.81, 90],
		length: 1.27,
	},
];

const EXPECTED_R0805_PADS = [
	{
		number: "1",
		type: "smd",
		shape: "roundrect",
		at: [-0.95, 0, 0],
		size: [1, 1.45],
		layers: ["F.Cu", "F.Paste", "F.Mask"],
	},
	{
		number: "2",
		type: "smd",
		shape: "roundrect",
		at: [0.95, 0, 90],
		size: [1, 1.45],
		layers: ["F.Cu", "F.Paste", "F.Mask"],
	},
];

function assertProperties(actual, expected) {
	for (const [k, v] of Object.entries(expected)) {
		assert.equal(actual[k], v);
	}
}

function assertElements(actual, expected) {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		assert.deepEqual(actual[i], expected[i]);
	}
}

function assertEntity(entity, expectedLibId) {
	assert.ok(entity);
	assert.equal(entity.libId, expectedLibId);
	assert.ok(entity.graphics.length > 0);
}

function assertSearchResults(results, expected, minTotal = null) {
	if (minTotal !== null) {
		assert.ok(results.length >= minTotal);
	} else {
		assert.equal(results.length, expected.length);
	}
	for (let i = 0; i < expected.length; i++) {
		const target = expected[i];
		if (target.name !== undefined) {
			assert.equal(results[i].name, target.name);
		}
		if (target.libId !== undefined) {
			assert.equal(results[i].libId, target.libId);
		}
	}
}

describe("kicad-library", () => {
	let tempRoot = "";
	let symbolDir = "";
	let footprintDir = "";
	let lib = null;

	before(async () => {
		tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kicad-lib-"));
		symbolDir = path.join(tempRoot, "symbols");
		footprintDir = path.join(tempRoot, "footprints");
		const prettyDir = path.join(footprintDir, "Resistor_SMD.pretty");

		await fs.promises.mkdir(symbolDir, { recursive: true });
		await fs.promises.mkdir(prettyDir, { recursive: true });

		const fixtureFiles = [
			[symbolDir, "Device.kicad_sym", SYMBOL_DEVICE_CONTENT],
			[symbolDir, "Transistor.kicad_sym", SYMBOL_TRANSISTOR_CONTENT],
			[prettyDir, "R_0805.kicad_mod", FP_R0805_CONTENT],
			[prettyDir, "R_1206.kicad_mod", FP_R1206_CONTENT],
		];
		for (const [dir, file, content] of fixtureFiles) {
			await fs.promises.writeFile(path.join(dir, file), content, "utf8");
		}

		lib = createKicadLibrary({ symbolDir, footprintDir });
	});

	after(async () => {
		if (tempRoot) {
			await fs.promises.rm(tempRoot, { recursive: true, force: true });
		}
	});

	function runSearchCases(cases) {
		for (const tc of cases) {
			test(tc.title, async () => {
				const results = await tc.search();
				assertSearchResults(results, tc.expected, tc.minTotal);
			});
		}
	}

	test("available() returns true when dirs exist", async () => {
		assert.equal(await lib.available(), true);
	});

	runSearchCases([
		{
			title: "searchSymbols ranks exact name > prefix > contains",
			search: () => lib.searchSymbols("R"),
			minTotal: 2,
			expected: [
				{ name: "R", libId: "Device:R" },
				{ name: "R_Small", libId: "Device:R_Small" },
			],
		},
		{
			title: "searchSymbols respects limit parameter",
			search: () => lib.searchSymbols("R", { limit: 1 }),
			expected: [{ name: "R" }],
		},
		{
			title: "searchSymbols matches keywords and description",
			search: () => lib.searchSymbols("transistor"),
			expected: [{ libId: "Transistor:Q_NPN_BCE" }],
		},
	]);

	test("getSymbol extracts properties, pins, and graphics", async () => {
		const sym = await lib.getSymbol("Device:R");
		assertEntity(sym, "Device:R");
		assert.equal(sym.name, "R");
		assertProperties(sym.properties, EXPECTED_R_PROPERTIES);
		assertElements(sym.pins, EXPECTED_R_PINS);
	});

	test("getSymbol returns null for non-existent symbol", async () => {
		const sym = await lib.getSymbol("Device:NonExistent");
		assert.equal(sym, null);
	});

	runSearchCases([
		{
			title: "searchFootprints ranks exact name > prefix > contains",
			search: () => lib.searchFootprints("R_0805"),
			expected: [{ libId: "Resistor_SMD:R_0805", name: "R_0805" }],
		},
		{
			title: "searchFootprints matches description and tags",
			search: () => lib.searchFootprints("1206"),
			expected: [{ libId: "Resistor_SMD:R_1206" }],
		},
	]);

	test("getFootprint extracts pads and graphics", async () => {
		const fp = await lib.getFootprint("Resistor_SMD:R_0805");
		assertEntity(fp, "Resistor_SMD:R_0805");
		assertElements(fp.pads, EXPECTED_R0805_PADS);
	});

	test("getFootprint returns null for non-existent footprint", async () => {
		const fp = await lib.getFootprint("Resistor_SMD:NonExistent");
		assert.equal(fp, null);
	});

	test("rejects path traversal and invalid libIds", async () => {
		for (const invalidId of INVALID_LIB_IDS) {
			const sym = await lib.getSymbol(invalidId);
			const fp = await lib.getFootprint(invalidId);
			assert.equal(sym, null);
			assert.equal(fp, null);
		}
	});

	test("missing dirs -> available() false and empty results", async () => {
		const missingLib = createKicadLibrary({
			symbolDir: path.join(tempRoot, "missing-symbols"),
			footprintDir: path.join(tempRoot, "missing-footprints"),
		});
		assert.equal(await missingLib.available(), false);
		assert.deepEqual(await missingLib.searchSymbols("R"), []);
		assert.deepEqual(await missingLib.searchFootprints("R"), []);
		assert.equal(await missingLib.getSymbol("Device:R"), null);
		assert.equal(await missingLib.getFootprint("Resistor_SMD:R_0805"), null);
	});
});
