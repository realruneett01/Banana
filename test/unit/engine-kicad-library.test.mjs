import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createKicadLibrary } from "../../backend/src/engine/kicad-library.js";

const SYMBOL_DEVICE_CONTENT = `(kicad_symbol_lib
	(version 20211014)
	(generator "kicad_symbol_editor")
	(symbol "R"
		(pin_numbers hide)
		(pin_names (offset 0))
		(in_bom yes)
		(on_board yes)
		(property "Reference" "R" (at 2.032 0 90))
		(property "Value" "R" (at 0 0 90))
		(property "Footprint" "Resistor_SMD:R_0805" (at -1.778 0 90))
		(property "Description" "Resistor" (at 0 0 0))
		(property "ki_keywords" "R res resistor" (at 0 0 0))
		(symbol "R_0_1"
			(rectangle (start -1.016 -2.54) (end 1.016 2.54))
		)
		(symbol "R_1_1"
			(pin passive line (at 0 3.81 270) (length 1.27)
				(name "~")
				(number "1")
			)
			(pin passive line (at 0 -3.81 90) (length 1.27)
				(name "~")
				(number "2")
			)
		)
	)
	(symbol "R_Small"
		(property "Reference" "R" (at 0 0 90))
		(property "Value" "R_Small" (at 0 0 90))
		(property "Footprint" "" (at 0 0 90))
		(property "Description" "Small resistor" (at 0 0 0))
		(property "ki_keywords" "resistor" (at 0 0 0))
		(symbol "R_Small_0_1"
			(rectangle (start -0.5 -1.5) (end 0.5 1.5))
		)
		(symbol "R_Small_1_1"
			(pin passive line (at 0 2.54 270) (length 1.27)
				(name "~")
				(number "1")
			)
			(pin passive line (at 0 -2.54 90) (length 1.27)
				(name "~")
				(number "2")
			)
		)
	)
)`;

const SYMBOL_TRANSISTOR_CONTENT = `(kicad_symbol_lib
	(version 20211014)
	(generator "kicad_symbol_editor")
	(symbol "Q_NPN_BCE"
		(property "Reference" "Q" (at 0 0 90))
		(property "Value" "Q_NPN_BCE" (at 0 0 90))
		(property "Footprint" "" (at 0 0 90))
		(property "Description" "NPN transistor, collector/base/emitter" (at 0 0 0))
		(property "ki_keywords" "transistor NPN" (at 0 0 0))
		(symbol "Q_NPN_BCE_0_1"
			(polyline (pts (xy 0 1) (xy 0 -1)))
		)
		(symbol "Q_NPN_BCE_1_1"
			(pin input line (at -5.08 0 0) (length 2.54)
				(name "B")
				(number "1")
			)
			(pin passive line (at 2.54 5.08 270) (length 2.54)
				(name "C")
				(number "2")
			)
			(pin passive line (at 2.54 -5.08 90) (length 2.54)
				(name "E")
				(number "3")
			)
		)
	)
)`;

const FP_R0805_CONTENT = `(footprint "R_0805"
	(version 20211014)
	(generator "pcbnew")
	(descr "Resistor SMD 0805 metric")
	(tags "resistor 0805 smd")
	(property "Reference" "REF**" (at 0 -1.5 0))
	(property "Value" "R_0805" (at 0 1.5 0))
	(pad "1" smd roundrect (at -0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask"))
	(pad "2" smd roundrect (at 0.95 0 90) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask"))
	(fp_line (start -1.7 -1) (end 1.7 -1) (layer "F.SilkS"))
)`;

const FP_R1206_CONTENT = `(footprint "R_1206"
	(version 20211014)
	(generator "pcbnew")
	(descr "Resistor SMD 1206 metric")
	(tags "resistor 1206 smd")
	(pad "1" smd roundrect (at -1.4 0) (size 1.1 1.8) (layers "F.Cu" "F.Paste" "F.Mask"))
	(pad "2" smd roundrect (at 1.4 0) (size 1.1 1.8) (layers "F.Cu" "F.Paste" "F.Mask"))
	(fp_line (start -2.2 -1.2) (end 2.2 -1.2) (layer "F.SilkS"))
)`;

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

		await fs.promises.writeFile(
			path.join(symbolDir, "Device.kicad_sym"),
			SYMBOL_DEVICE_CONTENT,
			"utf8",
		);
		await fs.promises.writeFile(
			path.join(symbolDir, "Transistor.kicad_sym"),
			SYMBOL_TRANSISTOR_CONTENT,
			"utf8",
		);
		await fs.promises.writeFile(
			path.join(prettyDir, "R_0805.kicad_mod"),
			FP_R0805_CONTENT,
			"utf8",
		);
		await fs.promises.writeFile(
			path.join(prettyDir, "R_1206.kicad_mod"),
			FP_R1206_CONTENT,
			"utf8",
		);

		lib = createKicadLibrary({ symbolDir, footprintDir });
	});

	after(async () => {
		if (tempRoot) {
			await fs.promises.rm(tempRoot, { recursive: true, force: true });
		}
	});

	test("available() returns true when dirs exist", async () => {
		assert.equal(await lib.available(), true);
	});

	test("searchSymbols ranks exact name > prefix > contains", async () => {
		const results = await lib.searchSymbols("R");
		assert.ok(results.length >= 2);
		assert.equal(results[0].name, "R");
		assert.equal(results[0].libId, "Device:R");
		assert.equal(results[1].name, "R_Small");
		assert.equal(results[1].libId, "Device:R_Small");
	});

	test("searchSymbols respects limit parameter", async () => {
		const results = await lib.searchSymbols("R", { limit: 1 });
		assert.equal(results.length, 1);
		assert.equal(results[0].name, "R");
	});

	test("searchSymbols matches keywords and description", async () => {
		const results = await lib.searchSymbols("transistor");
		assert.equal(results.length, 1);
		assert.equal(results[0].libId, "Transistor:Q_NPN_BCE");
	});

	test("getSymbol extracts properties, pins, and graphics", async () => {
		const sym = await lib.getSymbol("Device:R");
		assert.ok(sym);
		assert.equal(sym.libId, "Device:R");
		assert.equal(sym.name, "R");
		assert.equal(sym.properties.Reference, "R");
		assert.equal(sym.properties.Value, "R");
		assert.equal(sym.properties.Description, "Resistor");
		assert.equal(sym.properties.Footprint, "Resistor_SMD:R_0805");
		assert.equal(sym.pins.length, 2);
		assert.deepEqual(sym.pins[0], {
			number: "1",
			name: "~",
			type: "passive",
			at: [0, 3.81, 270],
			length: 1.27,
		});
		assert.deepEqual(sym.pins[1], {
			number: "2",
			name: "~",
			type: "passive",
			at: [0, -3.81, 90],
			length: 1.27,
		});
		assert.ok(sym.graphics.length > 0);
	});

	test("getSymbol returns null for non-existent symbol", async () => {
		const sym = await lib.getSymbol("Device:NonExistent");
		assert.equal(sym, null);
	});

	test("searchFootprints ranks exact name > prefix > contains", async () => {
		const results = await lib.searchFootprints("R_0805");
		assert.equal(results.length, 1);
		assert.equal(results[0].libId, "Resistor_SMD:R_0805");
		assert.equal(results[0].name, "R_0805");
	});

	test("searchFootprints matches description and tags", async () => {
		const results = await lib.searchFootprints("1206");
		assert.equal(results.length, 1);
		assert.equal(results[0].libId, "Resistor_SMD:R_1206");
	});

	test("getFootprint extracts pads and graphics", async () => {
		const fp = await lib.getFootprint("Resistor_SMD:R_0805");
		assert.ok(fp);
		assert.equal(fp.libId, "Resistor_SMD:R_0805");
		assert.equal(fp.pads.length, 2);
		assert.deepEqual(fp.pads[0], {
			number: "1",
			type: "smd",
			shape: "roundrect",
			at: [-0.95, 0, 0],
			size: [1, 1.45],
			layers: ["F.Cu", "F.Paste", "F.Mask"],
		});
		assert.deepEqual(fp.pads[1], {
			number: "2",
			type: "smd",
			shape: "roundrect",
			at: [0.95, 0, 90],
			size: [1, 1.45],
			layers: ["F.Cu", "F.Paste", "F.Mask"],
		});
		assert.ok(fp.graphics.length > 0);
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
