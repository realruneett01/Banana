import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { runErc } from "../../backend/src/engine/erc.js";
import {
	MAX_DEPTH,
	MAX_SHEETS,
	runProjectErc,
	runProjectErcFromTexts,
} from "../../backend/src/engine/erc-project.js";
import { kicadSchToIr } from "../../backend/src/engine/kicad-sch-to-ir.js";

// LOAD has one power_in pin, SRC one power_out pin, IN one input pin, all at
// (-5 0) from the symbol, so a symbol at "50 50" puts its pin at 45,50.
const LIB = `(lib_symbols
	(symbol "Dev:LOAD" (pin power_in line (at -5 0 0) (number "1")))
	(symbol "Dev:SRC" (pin power_out line (at -5 0 0) (number "1")))
	(symbol "Dev:IN" (pin input line (at -5 0 0) (number "1")))
	(symbol "power:VCC" (power) (pin power_in line (at 0 0 90) (number "1")))
	(symbol "power:PWR_FLAG" (power)
		(pin power_out line (at 0 0 90) (number "1")))
)`;

const sch = (body) => `(kicad_sch (version 20250114) ${LIB} ${body})`;

function sym(lib, ref, at) {
	return `(symbol (lib_id "${lib}") (at ${at} 0)
		(property "Reference" "${ref}") (property "Value" "${lib.split(":")[1]}")
		(property "Footprint" "FP"))`;
}

// U1.1 and U2.1 on one point (45,50): a net of two pins, not a lone pin.
const twoPins = (lib) =>
	`${sym(lib, "U1", "50 50")} ${sym(lib, "U2", "50 50")}`;

const vcc = (ref, at) =>
	`(symbol (lib_id "power:VCC") (at ${at} 0)
		(property "Reference" "${ref}") (property "Value" "VCC"))`;
const flag = (at) =>
	`(symbol (lib_id "power:PWR_FLAG") (at ${at} 0)
		(property "Reference" "#FLG01") (property "Value" "PWR_FLAG"))`;

function sheet(uuid, file, pins = []) {
	const pinText = pins.map((p) => `(pin "${p.name}" input (at ${p.at} 0))`);
	return `(sheet (at 200 200) (size 10 10) (uuid "${uuid}")
		(property "Sheetname" "${uuid}") (property "Sheetfile" "${file}")
		${pinText.join(" ")})`;
}

const loadOnVcc = sch(
	`${sym("Dev:LOAD", "U1", "50 50")} ${vcc("#PWR01", "45 50")}`,
);

function run(texts, root = "root.kicad_sch") {
	const res = runProjectErcFromTexts(texts, root);
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return res;
}

const notDriven = (res) =>
	res.issues.filter((i) => /driven/.test(i.message)).map((i) => i.message);

describe("runProjectErcFromTexts: KiCad drive semantics across sheets", () => {
	test("a power port names a net but does not drive it", () => {
		const res = run({
			"root.kicad_sch": sch(sheet("s1", "child.kicad_sch")),
			"child.kicad_sch": loadOnVcc,
		});
		assert.equal(res.sheets, 2);
		assert.deepEqual(notDriven(res), [
			"net VCC: power_in not driven (U1.1, #PWR01.1)",
		]);
	});

	test("a PWR_FLAG on another sheet drives the global power net", () => {
		const root = `${sheet("s1", "child.kicad_sch")}
			${vcc("#PWR02", "45 50")} ${flag("45 50")}`;
		const res = run({
			"root.kicad_sch": sch(root),
			"child.kicad_sch": loadOnVcc,
		});
		assert.deepEqual(notDriven(res), []);
	});

	test("global labels merge nets across sheets", () => {
		const label = `(global_label "PWR" (shape input) (at 45 50 0))`;
		const driver = `${sym("Dev:SRC", "U9", "50 50")} ${label}`;
		const load = `${twoPins("Dev:LOAD")} ${label}`;
		const texts = {
			"root.kicad_sch": sch(`${sheet("s1", "child.kicad_sch")} ${driver}`),
			"child.kicad_sch": sch(load),
		};
		assert.deepEqual(notDriven(run(texts)), []);
		texts["root.kicad_sch"] = sch(sheet("s1", "child.kicad_sch"));
		assert.deepEqual(notDriven(run(texts)), [
			"net PWR: power_in not driven (U1.1, U2.1)",
		]);
	});

	test("a hierarchical label joins its parent's sheet pin of that name", () => {
		const child = sch(`${twoPins("Dev:IN")}
			(hierarchical_label "SIG" (shape input) (at 45 50 0))`);
		const root = (pinName) =>
			sch(`${sym("Dev:SRC", "U9", "50 50")}
				${sheet("s1", "child.kicad_sch", [{ name: pinName, at: "45 50" }])}`);
		const texts = { "child.kicad_sch": child };
		texts["root.kicad_sch"] = root("SIG");
		assert.deepEqual(notDriven(run(texts)), []);
		texts["root.kicad_sch"] = root("OTHER");
		assert.deepEqual(notDriven(run(texts)), [
			"net SIG: net has only inputs (not driven) (U1.1, U2.1)",
		]);
	});

	test("each instance of a reused sheet is checked on its own", () => {
		const child = sch(`${twoPins("Dev:IN")}
			(hierarchical_label "SIG" (shape input) (at 45 50 0))`);
		const root = `${sym("Dev:SRC", "U9", "50 50")}
			${sheet("s1", "child.kicad_sch", [{ name: "SIG", at: "45 50" }])}
			${sheet("s2", "child.kicad_sch", [{ name: "SIG", at: "80 80" }])}`;
		const res = run({ "root.kicad_sch": sch(root), "child.kicad_sch": child });
		assert.equal(res.sheets, 3);
		assert.equal(notDriven(res).length, 1, "only the s2 instance is undriven");
	});

	test("each instance of a reused sheet gets its own references", () => {
		const inst = (s, ref) => `(path "/r/${s}" (reference "${ref}") (unit 1))`;
		const part = (ref, a, b) =>
			sym("Dev:IN", ref, "50 50").replace(
				/\)$/,
				` (instances (project "p" ${inst("s1", a)} ${inst("s2", b)})))`,
			);
		const child = sch(`${part("U1", "U11", "U21")} ${part("U2", "U12", "U22")}
			(hierarchical_label "SIG" (shape input) (at 45 50 0))`);
		const root = `(uuid "r")
			${sheet("s1", "child.kicad_sch", [{ name: "SIG", at: "45 50" }])}
			${sheet("s2", "child.kicad_sch", [{ name: "SIG", at: "80 80" }])}`;
		const res = run({ "root.kicad_sch": sch(root), "child.kicad_sch": child });
		assert.deepEqual(notDriven(res).sort(), [
			"net SIG: net has only inputs (not driven) (U11.1, U12.1)",
			"net SIG: net has only inputs (not driven) (U21.1, U22.1)",
		]);
	});

	test("a lone pin, even labelled, is not a not-driven error", () => {
		const child = sch(`${sym("Dev:IN", "U1", "50 50")}
			(hierarchical_label "SIG" (shape input) (at 45 50 0))`);
		const root = sch(
			sheet("s1", "child.kicad_sch", [{ name: "SIG", at: "9 9" }]),
		);
		const res = run({ "root.kicad_sch": root, "child.kicad_sch": child });
		assert.deepEqual(notDriven(res), []);
	});

	// kicad-cli skips power_pin_not_driven and pin_not_driven on a net that
	// carries a no-connect flag (vme-wren P12V, M12V_VME, P5V_STDBY_VME).
	test("a no-connect flag on a net skips its not-driven checks", () => {
		const nc = "(no_connect (at 45 50))";
		const root = sch(
			`${sheet("s1", "child.kicad_sch")} ${vcc("#PWR02", "45 50")} ${nc}`,
		);
		const res = run({ "root.kicad_sch": root, "child.kicad_sch": loadOnVcc });
		assert.deepEqual(notDriven(res), []);
	});
});

describe("runErc (one sheet): no-connect flag", () => {
	const nc = "(no_connect (at 45 50))";
	for (const lib of ["Dev:LOAD", "Dev:IN"]) {
		test(`${lib} pins under a no-connect flag are not a not-driven error`, () => {
			const res = kicadSchToIr(sch(`${twoPins(lib)} ${nc}`));
			const before = runErc(kicadSchToIr(sch(twoPins(lib))).ir);
			assert.equal(before.filter((i) => /driven/.test(i.message)).length, 1);
			assert.deepEqual(
				runErc(res.ir).filter((i) => /driven/.test(i.message)),
				[],
			);
		});
	}
});

describe("project sheet loading guards", () => {
	test("a sheet cycle is cut with a warning", () => {
		const res = run({
			"root.kicad_sch": sch(sheet("s1", "a.kicad_sch")),
			"a.kicad_sch": sch(sheet("s2", "b.kicad_sch")),
			"b.kicad_sch": sch(sheet("s3", "a.kicad_sch")),
		});
		assert.equal(res.sheets, 3);
		assert.deepEqual(res.warnings, ["sheet cycle: a.kicad_sch"]);
	});

	test("nesting stops at MAX_DEPTH", () => {
		const texts = {};
		for (let i = 0; i < MAX_DEPTH + 5; i++) {
			texts[`s${i}.kicad_sch`] = sch(sheet(`u${i}`, `s${i + 1}.kicad_sch`));
		}
		const res = run(texts, "s0.kicad_sch");
		assert.equal(res.sheets, MAX_DEPTH);
		assert.deepEqual(res.warnings, [
			`sheet depth limit ${MAX_DEPTH}: s${MAX_DEPTH}.kicad_sch`,
		]);
	});

	test("at most MAX_SHEETS instances are loaded", () => {
		const refs = [];
		for (let i = 0; i < MAX_SHEETS + 50; i++) {
			refs.push(sheet(`u${i}`, "leaf.kicad_sch"));
		}
		const res = run({
			"root.kicad_sch": sch(refs.join(" ")),
			"leaf.kicad_sch": loadOnVcc,
		});
		assert.equal(res.sheets, MAX_SHEETS);
		assert.deepEqual(res.warnings, [`sheet limit ${MAX_SHEETS} reached`]);
	});

	test("a missing root is an error, a missing sub-sheet a warning", () => {
		const bad = runProjectErcFromTexts({}, "root.kicad_sch");
		assert.equal(bad.ok, false);
		const res = run({ "root.kicad_sch": sch(sheet("s1", "gone.kicad_sch")) });
		assert.deepEqual(res.warnings, ["missing sheet: gone.kicad_sch"]);
	});
});

function makeProject(t) {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "erc-project-"));
	t.after(() => fs.rmSync(base, { recursive: true, force: true }));
	const project = path.join(base, "project");
	const outside = path.join(base, "outside");
	fs.mkdirSync(project);
	fs.mkdirSync(outside);
	fs.writeFileSync(path.join(outside, "evil.kicad_sch"), loadOnVcc);
	return { base, project, outside };
}

function writeRoot(project, body) {
	const root = path.join(project, "root.kicad_sch");
	fs.writeFileSync(root, sch(body));
	return root;
}

describe("runProjectErc reads sheets only from the project folder", () => {
	test("loads sub-sheets from sub-folders", (t) => {
		const { project } = makeProject(t);
		fs.mkdirSync(path.join(project, "sch"));
		fs.writeFileSync(path.join(project, "sch", "child.kicad_sch"), loadOnVcc);
		const res = runProjectErc(
			writeRoot(project, sheet("s1", "sch/child.kicad_sch")),
		);
		assert.equal(res.ok, true);
		assert.equal(res.sheets, 2);
		assert.equal(notDriven(res).length, 1);
	});

	test("refuses ../ and absolute sheet paths", (t) => {
		const { project, outside } = makeProject(t);
		const abs = path.join(outside, "evil.kicad_sch").replace(/\\/g, "/");
		const body = `${sheet("s1", "../outside/evil.kicad_sch")} ${sheet("s2", abs)}`;
		const res = runProjectErc(writeRoot(project, body));
		assert.equal(res.sheets, 1);
		assert.equal(res.warnings.length, 2);
		assert.ok(res.warnings.every((w) => w.startsWith("refused sheet path")));
	});

	test("refuses a symlink or junction that escapes the project", (t) => {
		const { project, outside } = makeProject(t);
		fs.symlinkSync(outside, path.join(project, "link"), "junction");
		const res = runProjectErc(
			writeRoot(project, sheet("s1", "link/evil.kicad_sch")),
		);
		assert.equal(res.sheets, 1);
		assert.deepEqual(res.warnings, ["refused sheet path: link/evil.kicad_sch"]);
	});

	test("a root that is not a .kicad_sch file is an error", (t) => {
		const { project } = makeProject(t);
		const res = runProjectErc(path.join(project, "missing.kicad_sch"));
		assert.equal(res.ok, false);
		assert.equal(runProjectErc(path.join(project, "x.txt")).ok, false);
	});
});

const DEMOS = "C:/Program Files/KiCad/10.0/share/kicad/demos";

// kicad-cli sch erc on the root sheet (whole hierarchy), KiCad 10.0.3:
// [root, sheet instances, power_pin_not_driven, pin_not_driven].
const DEMO_CASES = [
	["complex_hierarchy/complex_hierarchy", 3, 0, 0],
	["cm5_minima/CM5_MINIMA_3", 8, 0, 0],
	["multichannel/multichannel_mixer", 5, 3, 0],
	["royalblue54L_feather/RoyalBlue54L-Feather", 5, 5, 0],
	["video/video", 8, 0, 0],
];

describe("runProjectErc on KiCad 10 demos matches kicad-cli", () => {
	for (const [root, sheets, power, inputs] of DEMO_CASES) {
		const file = `${DEMOS}/${root}.kicad_sch`;
		const skip = !fs.existsSync(file) && "KiCad 10 demos not installed";
		test(root, { skip }, () => {
			const res = runProjectErc(file);
			const count = (re) => notDriven(res).filter((m) => re.test(m)).length;
			assert.equal(res.sheets, sheets);
			assert.equal(count(/power_in not driven/), power);
			assert.equal(count(/only inputs/), inputs);
		});
	}
});

// Child: two input pins at 45,50 on a wire labelled `member`, and a
// hierarchical label `bus` carrying it. Root: the sheet pin `bus` on a bus.
function busProject(bus, member, rootBody) {
	const child = `${twoPins("Dev:IN")} (label "${member}" (at 45 50 0))
		(hierarchical_label "${bus}" (shape input) (at 10 10 0))`;
	return run({
		"root.kicad_sch":
			sch(`${sheet("s1", "child.kicad_sch", [{ name: bus, at: "20" }])}
			(bus (pts (xy 20 0) (xy 90 0))) ${rootBody}`),
		"child.kicad_sch": sch(child),
	});
}

const onlyInputs = (res) =>
	notDriven(res).filter((m) => /only inputs/.test(m)).length;

describe("runProjectErcFromTexts: bus members across sheets", () => {
	test("a vector bus member is driven through a sheet pin and bus label", () => {
		const driver = `${sym("Dev:SRC", "U9", "50 50")} (label "DATA1" (at 45 50 0))
			(label "DATA[0..1]" (at 60 0 0))`;
		assert.equal(onlyInputs(busProject("D[0..1]", "D1", driver)), 0);
	});

	test("a driver on another bus index does not drive the member", () => {
		const driver = `${sym("Dev:SRC", "U9", "50 50")} (label "DATA0" (at 45 50 0))
			(label "DATA[0..1]" (at 60 0 0))`;
		assert.equal(onlyInputs(busProject("D[0..1]", "D1", driver)), 1);
	});

	test("an alias defined on another sheet expands a group bus", () => {
		const driver = `(bus_alias "I2C" (members "I2C.SDA" "I2C.SCL"))
			${sym("Dev:SRC", "U9", "50 50")} (label "I2C.SDA" (at 45 50 0))`;
		assert.equal(onlyInputs(busProject("{I2C}", "I2C.SDA", driver)), 0);
	});
});
