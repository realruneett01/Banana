import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { runErc, runPinTypeErc } from "../../backend/src/engine/erc.js";
import {
	loadErcSettings,
	parseErcSettings,
} from "../../backend/src/engine/erc-settings.js";

const pro = (ruleSeverities) =>
	JSON.stringify({ erc: { rule_severities: ruleSeverities } });

describe("parseErcSettings", () => {
	test("keeps error / warning / ignore rule severities", () => {
		const text = pro({
			pin_to_pin: "ignore",
			pin_not_driven: "warning",
			power_pin_not_driven: "error",
		});
		assert.deepEqual(parseErcSettings(text).ruleSeverities, {
			pin_to_pin: "ignore",
			pin_not_driven: "warning",
			power_pin_not_driven: "error",
		});
	});

	test("drops unknown severities", () => {
		const text = pro({ pin_to_pin: "loud", pin_not_driven: 3 });
		assert.deepEqual(parseErcSettings(text).ruleSeverities, {});
	});

	test("bad JSON or no erc section -> no overrides", () => {
		assert.deepEqual(parseErcSettings("{not json").ruleSeverities, {});
		assert.deepEqual(parseErcSettings("{}").ruleSeverities, {});
	});
});

describe("loadErcSettings", () => {
	test("reads <root>.kicad_pro next to the root sheet", (t) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erc-settings-"));
		t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
		const root = path.join(dir, "board.kicad_sch");
		fs.writeFileSync(
			path.join(dir, "board.kicad_pro"),
			pro({ pin_to_pin: "ignore" }),
		);
		assert.deepEqual(loadErcSettings(root).ruleSeverities, {
			pin_to_pin: "ignore",
		});
	});

	test("no project file -> no overrides", () => {
		const missing = path.join(os.tmpdir(), "no-such-dir", "x.kicad_sch");
		assert.deepEqual(loadErcSettings(missing).ruleSeverities, {});
	});
});

// Two output pins on one net (pin_to_pin error) and an input-only net
// (pin_not_driven error).
function fixture() {
	const parts = [
		{ id: "p1", ref: "U1", pinTypes: { 1: "output", 2: "input" } },
		{ id: "p2", ref: "U2", pinTypes: { 1: "output", 2: "input" } },
	];
	const pins = (pin) => [
		{ partId: "p1", pin },
		{ partId: "p2", pin },
	];
	const nets = [
		{ id: "n1", name: "OUT", pins: pins("1") },
		{ id: "n2", name: "IN", pins: pins("2") },
	];
	return { parts, nets };
}

const messages = (issues) =>
	issues.map((i) => `${i.severity} ${i.message.replace(/ \(U.*$/, "")}`).sort();

describe("runPinTypeErc with project rule severities", () => {
	test("defaults without settings", () => {
		const { parts, nets } = fixture();
		assert.deepEqual(messages(runPinTypeErc(parts, nets)), [
			"error net IN: net has only inputs (not driven)",
			"error net OUT: pin type conflict: output vs output",
		]);
	});

	test("ignore drops a rule and warning downgrades one", () => {
		const { parts, nets } = fixture();
		const settings = {
			ruleSeverities: { pin_to_pin: "ignore", pin_not_driven: "warning" },
		};
		assert.deepEqual(messages(runPinTypeErc(parts, nets, { settings })), [
			"warning net IN: net has only inputs (not driven)",
		]);
	});

	// kicad-cli 10: jetson-agx-thor sets pin_to_pin "error" yet reports 9
	// pin_to_pin warnings; tiny_tapeout sets "warning" yet reports 2 errors.
	// The pin map sets a pair's severity; the rule can only be ignored.
	test("pin_to_pin error / warning keep the pin-map severity", () => {
		const { parts, nets } = fixture();
		const warn = { ruleSeverities: { pin_to_pin: "warning" } };
		assert.ok(
			messages(runPinTypeErc(parts, nets, { settings: warn })).includes(
				"error net OUT: pin type conflict: output vs output",
			),
		);
	});

	test("runErc applies the same settings", () => {
		const { parts, nets } = fixture();
		const settings = { ruleSeverities: { pin_to_pin: "ignore" } };
		const found = runErc({ parts, nets }, { settings });
		assert.equal(found.filter((i) => /conflict/.test(i.message)).length, 0);
		assert.equal(found.filter((i) => /only inputs/.test(i.message)).length, 1);
	});
});

const ROYALBLUE =
	"C:/Program Files/KiCad/10.0/share/kicad/demos/royalblue54L_feather/RoyalBlue54L-Feather.kicad_sch";

describe("royalblue54L_feather project settings", () => {
	const skip = !fs.existsSync(ROYALBLUE) && "KiCad 10 demos not installed";
	test("its .kicad_pro ignores pin_to_pin (kicad-cli reports none)", {
		skip,
	}, () => {
		assert.equal(
			loadErcSettings(ROYALBLUE).ruleSeverities.pin_to_pin,
			"ignore",
		);
	});
});
