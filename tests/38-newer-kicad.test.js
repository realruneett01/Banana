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
import { listSymbolIds } from "../backend/src/design/kicad-lib.js";
import { extractFileFromCommit } from "../backend/src/git-extractor.js";
import { config } from "../backend/src/config.js";
import { tmpDir } from "./helpers.js";

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
