// Problems that CI showed only on KiCad 8+ / newer libraries. The 8.0.9 help texts are REAL output taken from
// the log of the kicad/kicad:8.0 CI job; the netlist and library snippets are written to match what the
// CI logs showed for KiCad 8 and 10.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	capabilitiesFromHelp,
	fallbackCapabilities,
} from "../backend/src/kicad-compat.js";
import { parseKicadNetlist } from "../backend/src/design/checks.js";
import {
	cliCanRefillZones,
	extractFills,
	fillZones,
} from "../backend/src/design/zonefill.js";
import { getSymbol, listSymbolIds } from "../backend/src/design/kicad-lib.js";
import { matchParen } from "../backend/src/design/sexp.js";
import { propertiesToFpText } from "../backend/src/design/writer-pcb.js";
import { extractFileFromCommit } from "../backend/src/git-extractor.js";
import { config } from "../backend/src/config.js";
import { hasKicad, tmpDir } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (dir, n) =>
	fs.readFileSync(path.join(here, "fixtures", dir, `${n}.txt`), "utf8");

test("KiCad 8.0.9: the probe sees per-layer SVG and the fallback table agrees", () => {
	const help = {
		pcb: fx("kicad8-help", "pcb"),
		pcbExport: fx("kicad8-help", "pcb-export"),
		pcbExportSvg: fx("kicad8-help", "pcb-export-svg"),
		sch: fx("kicad7-help", "sch"),
		schExport: fx("kicad7-help", "sch-export"),
		schExportSvg: fx("kicad7-help", "sch-export-svg"),
	};
	assert.ok(!/mode-multi/.test(help.pcbExportSvg), "8.0.9 really lacks it");
	const probed = capabilitiesFromHelp("8.0.9", help);
	assert.ok(probed, "8.0 help text is understood");
	assert.equal(probed.svg.multiMode, false);
	assert.equal(probed.hasDrc, true);
	assert.equal(fallbackCapabilities("8.0.9").svg.multiMode, false);
	assert.equal(fallbackCapabilities("9.0.0").svg.multiMode, true);
	assert.equal(fallbackCapabilities("10.0.7").svg.multiMode, true);
	assert.equal(fallbackCapabilities("7.0.11").svg.multiMode, false);
	assert.equal(fallbackCapabilities("nightly").svg.multiMode, true);
});

test("netlists parse in the one-line (KiCad 7/8) and the multi-line (KiCad 10) layout", () => {
	const oneLine = `(nets
    (net (code "1") (name "+5V")
      (node (ref "J1") (pin "1") (pinfunction "Pin_1") (pintype "passive"))
      (node (ref "R1") (pin "1") (pintype "passive")))
    (net (code "2") (name "/GND")
      (node (ref "J1") (pin "2") (pinfunction "Pin_2") (pintype "passive"))
      (node (ref "#PWR01") (pin "1") (pintype "power_in"))
      (node (ref "R1") (pin "2") (pintype "passive")))))`;
	const multiLine = `(nets
		(net
			(code "1")
			(name "+5V")
			(class "Default")
			(node
				(ref "J1")
				(pin "1")
				(pinfunction "Pin_1_1")
				(pintype "passive")
			)
			(node
				(ref "R1")
				(pin "1")
				(pintype "passive")
			)
		)
		(net
			(code "2")
			(name "/GND")
			(class "Default")
			(node
				(ref "J1")
				(pin "2")
			)
			(node
				(ref "#PWR01")
				(pin "1")
			)
			(node
				(ref "R1")
				(pin "2")
			)
		)
	)
)`;
	for (const text of [oneLine, multiLine]) {
		const got = parseKicadNetlist(text);
		assert.deepEqual([...got.keys()], ["+5V", "GND"]);
		assert.deepEqual(got.get("+5V"), ["J1.1", "R1.1"]);
		assert.deepEqual(
			got.get("GND"),
			["J1.2", "R1.2"],
			"slash stripped, #PWR ignored",
		);
	}
	assert.equal(parseKicadNetlist("").size, 0);
});

test("library symbols are listed whether the file is indented with spaces (KiCad 7) or tabs (KiCad 8+)", () => {
	const dir = tmpDir("banana-symlib-");
	const space = (n) =>
		`  (symbol "${n}"\n    (pin_names)\n    (symbol "${n}_1_1")\n  )\n`;
	const tab = (n) =>
		`\t(symbol "${n}"\n\t\t(pin_names)\n\t\t(symbol "${n}_1_1")\n\t)\n`;
	fs.writeFileSync(
		path.join(dir, "Old.kicad_sym"),
		`(kicad_symbol_lib (version 20220914)\n${space("A")}${space("B")})\n`,
	);
	fs.writeFileSync(
		path.join(dir, "New.kicad_sym"),
		`(kicad_symbol_lib\n\t(version 20231120)\n${tab("C")}${tab("D")}${tab("E")})\n`,
	);
	const ids = listSymbolIds({ env: { KICAD_SYMBOL_DIR: dir }, cliPath: "" });
	assert.deepEqual(ids.sort(), ["New:C", "New:D", "New:E", "Old:A", "Old:B"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a failed extraction never leaves the output file behind (60 tries, directory that does not exist)", async () => {
	const missing = path.join(config.tempRoot, "no-such-repo-dir");
	for (let i = 0; i < 60; i++) {
		const target = `t38/${i}/a`;
		await assert.rejects(
			extractFileFromCommit(missing, "HEAD", "a.kicad_pcb", target),
		);
		await new Promise((r) => setTimeout(r, 0));
		assert.equal(fs.existsSync(path.join(config.tempRoot, target)), false);
	}
});

test('saved zones are read in the older (net_name/layer) and the newer (net "X"/layers) spelling', () => {
	const old = `(kicad_pcb (zone (net 1) (net_name "GND") (layer "B.Cu") (tstamp 1)
  (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1)))
  (filled_polygon (layer "B.Cu") (pts (xy 0 0) (xy 1 0) (xy 1 1)))))`;
	const next = `(kicad_pcb
	(zone
		(net "GND")
		(layers "B.Cu")
		(uuid "u")
		(polygon (pts (xy 0 0) (xy 1 0) (xy 1 1)))
		(filled_polygon
			(layer "B.Cu")
			(pts (xy 0 0) (xy 1 0) (xy 1 1))
		)
	)
	(zone
		(net "+5V")
		(layers "F.Cu" "B.Cu")
		(polygon (pts (xy 0 0) (xy 1 0) (xy 1 1)))
	)
)`;
	for (const text of [old, next]) {
		const fills = extractFills(text);
		assert.deepEqual([...fills.keys()], ["GND|B.Cu"]);
		assert.match(fills.get("GND|B.Cu"), /^\(filled_polygon \(layer "B\.Cu"\)/);
	}
});

test("without pcbnew's Python, a kicad-cli that can refill zones fills them", {
	skip:
		!cliCanRefillZones() &&
		"this kicad-cli cannot refill zones (KiCad 10 and newer can)",
}, async () => {
	const { Design, emptyDesign } = await import(
		"../backend/src/design/model.js"
	);
	const { writePcb } = await import("../backend/src/design/writer-pcb.js");
	const d = new Design(emptyDesign("cli-fill"));
	for (const v of ["1k", "2k"])
		d.addPart({
			symbol: "Device:R",
			value: v,
			footprint: "Resistor_SMD:R_0805_2012Metric",
		});
	d.connect("GND", ["R1.2", "R2.2"]);
	d.connect("SIG", ["R1.1", "R2.1"]);
	d.setBoard(40, 30);
	d.addZone({ net: "GND", layer: "B.Cu" });
	const r = await fillZones(writePcb(d).text, { python: null });
	assert.equal(r.status, "ok");
	assert.ok(r.fills.get("GND|B.Cu")?.startsWith("(filled_polygon"));
});

test("KiCad 8+ footprint properties become the fp_text the board header promises", () => {
	// shape taken from the footprint block Banana wrote on KiCad 8.0.9 (CI log)
	const fp = `(footprint "Resistor_SMD:R_0805_2012Metric"
  \t(layer "F.Cu")
  \t(tags "resistor")
  \t(property "Reference" "R1"
  \t\t(at 0 -1.65 0)
  \t\t(layer "F.SilkS")
  \t\t(uuid "effead60-2b17-4463-91cf-34792a2b459a")
  \t\t(effects
  \t\t\t(font
  \t\t\t\t(size 1 1)
  \t\t\t\t(thickness 0.15)
  \t\t\t)
  \t\t)
  \t)
  \t(property "Value" "1k"
  \t\t(at 0 1.65 0)
  \t\t(layer "F.Fab")
  \t\t(uuid "83cd9c78-75b4-4eec-9501-2ff4a6e7a26e")
  \t\t(effects (font (size 1 1) (thickness 0.15)))
  \t)
  \t(property "Datasheet" ""
  \t\t(at 0 0 0)
  \t\t(unlocked yes)
  \t\t(layer "F.Fab")
  \t\t(hide yes)
  \t\t(uuid "10e8fbff-4a7b-46b4-8e2f-6ae1745031fe")
  \t\t(effects (font (size 1.27 1.27)))
  \t)
  \t(property "Sheetfile" "x.kicad_sch")
  \t(attr smd)
)`;
	const out = propertiesToFpText(fp);
	assert.match(
		out,
		/\(fp_text reference "R1" \(at 0 -1\.65\) \(layer "F\.SilkS"\) \(effects \(font \(size 1 1\) \(thickness 0\.15\)\)\) \(tstamp effead60-2b17-4463-91cf-34792a2b459a\)\)/,
	);
	assert.match(out, /\(fp_text value "1k" \(at 0 1\.65\) \(layer "F\.Fab"\)/);
	assert.ok(!out.includes("Datasheet"), "positioned metadata is dropped");
	assert.ok(
		out.includes('(property "Sheetfile" "x.kicad_sch")'),
		"old key/value kept",
	);
	assert.equal(matchParen(out, 0), out.length - 1, "still balanced");
	// KiCad 9/10 put hide inside the font effects
	const hid = propertiesToFpText(
		'(footprint "X" (property "Reference" "U1" (at 1 2 90) (layer "F.SilkS") (uuid "u") (effects (font (size 1 1)) (hide yes))))',
	);
	assert.match(
		hid,
		/\(fp_text reference "U1" \(at 1 2 90\) \(layer "F\.SilkS"\) hide \(effects \(font \(size 1 1\)\)\) \(tstamp u\)\)/,
	);
	// a KiCad 7 footprint passes through untouched
	const seven =
		'(footprint "X" (fp_text reference "REF**" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1)))))';
	assert.equal(propertiesToFpText(seven), seven);
});

test("library symbols that extend a symbol that extends another still get the pins", () => {
	const dir = tmpDir("banana-chain-");
	const pin =
		'(pin passive line\n\t\t\t\t(at -3.81 0 0)\n\t\t\t\t(length 2.54)\n\t\t\t\t(name "K" (effects (font (size 1 1))))\n\t\t\t\t(number "1" (effects (font (size 1 1)))))';
	const sym = (name, extra) =>
		`\t(symbol "${name}"\n${extra}\n\t\t(property "Reference" "D" (at 0 0 0) (effects (font (size 1 1))))\n\t\t(property "Value" "${name}" (at 0 0 0) (effects (font (size 1 1))))\n\t)\n`;
	const base = `\t(symbol "BASE"\n\t\t(property "Reference" "D" (at 0 0 0) (effects (font (size 1 1))))\n\t\t(property "Value" "BASE" (at 0 0 0) (effects (font (size 1 1))))\n\t\t(property "ki_description" "Base diode" (at 0 0 0) (effects (font (size 1 1))))\n\t\t(symbol "BASE_1_1"\n\t\t\t${pin}\n\t\t)\n\t)\n`;
	fs.writeFileSync(
		path.join(dir, "Chain.kicad_sym"),
		`(kicad_symbol_lib\n\t(version 20231120)\n${base}${sym("MID", '\t\t(extends "BASE")')}${sym("TOP", '\t\t(extends "MID")')}${sym("LOOP_A", '\t\t(extends "LOOP_B")')}${sym("LOOP_B", '\t\t(extends "LOOP_A")')})\n`,
	);
	const opts = { env: { KICAD_SYMBOL_DIR: dir }, cliPath: "" };
	const top = getSymbol("Chain:TOP", opts);
	assert.equal(top.pins.length, 1);
	assert.equal(
		top.description,
		"Base diode",
		"inherited from the root of the chain",
	);
	assert.match(top.embedText(), /^\(symbol "Chain:TOP"/);
	assert.match(
		top.embedText(),
		/\(property "Value" "TOP"/,
		"its own value wins",
	);
	assert.equal(getSymbol("Chain:MID", opts).pins.length, 1);
	assert.equal(
		getSymbol("Chain:LOOP_A", opts),
		null,
		"a cycle is unusable, not an endless loop",
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("the view crop margin comes from the viewBox of a known outline", async () => {
	const V = await import("../backend/src/design/views.js");
	const board = { width: 50, height: 25 };
	const seven = V.marginFromViewBox([0, 0, 50.1, 25.1], board);
	assert.ok(Math.abs(seven.x - 0.05) < 1e-9 && Math.abs(seven.y - 0.05) < 1e-9);
	const ten = V.marginFromViewBox([0, 0, 49.9872, 24.9936], board);
	assert.ok(
		Math.abs(ten.x - -0.0064) < 1e-9 && Math.abs(ten.y - -0.0032) < 1e-9,
	);
	assert.deepEqual(V.marginFromViewBox(null, board), { x: 0.05, y: 0.05 });
	assert.deepEqual(
		V.marginFromViewBox([0, 0, 500, 25], board),
		{ x: 0.05, y: 0.05 },
		"implausible: default",
	);
	const tr = V.boardViewTransform({ originX: 20, originY: 20 }, ten);
	assert.ok(Math.abs(V.toViewCoords(tr, 20, 20).x - -0.0064) < 1e-9);
});

test("the installed KiCad's crop margin is measured and stays small", {
	skip: !hasKicad() && "kicad-cli not installed",
}, async () => {
	const V = await import("../backend/src/design/views.js");
	const m = await V.viewCropMargin();
	assert.ok(Math.abs(m.x) < 0.2 && Math.abs(m.y) < 0.2, JSON.stringify(m));
	assert.deepEqual(await V.viewCropMargin(), m, "memoised");
});
