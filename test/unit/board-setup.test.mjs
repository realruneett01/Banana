import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	DEFAULT_DESIGN_RULES,
	DEFAULT_NET_CLASS,
	DEFAULT_SETUP,
	DEFAULT_TRACK_WIDTHS,
	DEFAULT_VIA_SIZES,
	getBoardSetup,
	netClassForNet,
	trackWidthsFromSetup,
	validateSetup,
	withBoardSetup,
} from "../../frontend/src/editor/boardSetup.js";

const dialogUrl = new URL(
	"../../frontend/src/editor/BoardSetupDialog.jsx",
	import.meta.url,
);
const dialogSrc = readFileSync(dialogUrl, "utf8");

describe("boardSetup - DEFAULT_SETUP", () => {
	test("provides KiCad default board stackup and dimensions", () => {
		assert.equal(DEFAULT_SETUP.thickness, 1.6);
		assert.equal(DEFAULT_SETUP.copperLayers, 2);
		assert.equal(DEFAULT_SETUP.clearance, 0.2);
		assert.equal(DEFAULT_SETUP.track, 0.25);
		assert.equal(DEFAULT_SETUP.via, 0.6);
		assert.equal(DEFAULT_SETUP.viaDrill, 0.3);
		assert.equal(DEFAULT_SETUP.diffPairWidth, 0.2);
		assert.equal(DEFAULT_SETUP.diffPairGap, 0.25);
	});

	test("contains default design rules object matching limits", () => {
		const rules = DEFAULT_SETUP.designRules;
		assert.equal(rules.minClearance, DEFAULT_DESIGN_RULES.minClearance);
		assert.equal(rules.minTrackWidth, DEFAULT_DESIGN_RULES.minTrackWidth);
		assert.equal(rules.minViaSize, DEFAULT_DESIGN_RULES.minViaSize);
		assert.equal(rules.minViaDrill, DEFAULT_DESIGN_RULES.minViaDrill);
		assert.equal(rules.minDiffPairWidth, DEFAULT_DESIGN_RULES.minDiffPairWidth);
		assert.equal(rules.minDiffPairGap, DEFAULT_DESIGN_RULES.minDiffPairGap);
	});

	test("contains Default net class and predefined sizes", () => {
		assert.equal(DEFAULT_SETUP.netClasses.length, 1);
		const def = DEFAULT_SETUP.netClasses[0];
		assert.equal(def.name, "Default");
		assert.equal(def.clearance, DEFAULT_NET_CLASS.clearance);
		assert.equal(def.trackWidth, DEFAULT_NET_CLASS.trackWidth);
		assert.equal(def.viaSize, DEFAULT_NET_CLASS.viaSize);
		assert.equal(def.viaDrill, DEFAULT_NET_CLASS.viaDrill);
		assert.deepEqual(DEFAULT_SETUP.trackWidths, DEFAULT_TRACK_WIDTHS);
		assert.deepEqual(DEFAULT_SETUP.viaSizes, DEFAULT_VIA_SIZES);
	});
});

describe("boardSetup - merge without mutation", () => {
	test("returns defaults for empty or undefined board", () => {
		const s1 = getBoardSetup();
		const s2 = getBoardSetup({});
		assert.equal(s1.thickness, 1.6);
		assert.equal(s2.copperLayers, 2);
		assert.equal(s1.netClasses[0].name, "Default");
	});

	test("merges custom setup without mutating original board object", () => {
		const origSetup = Object.freeze({
			thickness: 0.8,
			copperLayers: 4,
			clearance: 0.15,
		});
		const board = Object.freeze({
			outline: [{ x: 0, y: 0 }],
			setup: origSetup,
		});

		const merged = getBoardSetup(board);
		assert.equal(merged.thickness, 0.8);
		assert.equal(merged.copperLayers, 4);
		assert.equal(merged.clearance, 0.15);
		assert.equal(merged.track, 0.25);
		assert.equal(board.setup.thickness, 0.8);
	});

	test("withBoardSetup creates new board and preserves non-setup fields", () => {
		const initialBoard = Object.freeze({
			outline: [{ x: 10, y: 10 }],
			tracks: [{ start: [0, 0], end: [1, 1], widthMm: 0.25 }],
			vias: [],
			zones: [],
			setup: { thickness: 1.6 },
		});

		const nextBoard = withBoardSetup(initialBoard, {
			thickness: 2.0,
			copperLayers: 6,
		});

		assert.notEqual(nextBoard, initialBoard);
		assert.equal(nextBoard.setup.thickness, 2.0);
		assert.equal(nextBoard.setup.copperLayers, 6);
		assert.equal(initialBoard.setup.thickness, 1.6);
		assert.deepEqual(nextBoard.tracks, initialBoard.tracks);
		assert.deepEqual(nextBoard.outline, initialBoard.outline);
	});
});

const VALIDATION_CASES = [
	{
		title: "validates default setup with 0 problems",
		setup: DEFAULT_SETUP,
		expectedProblems: [],
	},
	{
		title: "flags thickness <= 0",
		setup: { thickness: 0 },
		expectedSubstrings: ["Board thickness must be greater than 0 mm"],
	},
	{
		title: "flags copper layers < 1",
		setup: { copperLayers: 0 },
		expectedSubstrings: ["Copper layer count must be at least 1"],
	},
	{
		title: "flags track width below minimum",
		setup: {
			designRules: { minTrackWidth: 0.25 },
			netClasses: [{ name: "Default", trackWidth: 0.1 }],
		},
		expectedSubstrings: [
			"Track width must be at least the minimum track width",
		],
	},
	{
		title: "flags clearance below minimum",
		setup: {
			designRules: { minClearance: 0.2 },
			netClasses: [{ name: "Default", clearance: 0.1 }],
		},
		expectedSubstrings: ["Clearance must be at least the minimum clearance"],
	},
	{
		title: "flags via drill larger than or equal to via size",
		setup: {
			netClasses: [{ name: "Default", viaSize: 0.6, viaDrill: 0.6 }],
		},
		expectedSubstrings: ["Via drill must be smaller than via size"],
	},
	{
		title: "flags user net class problems with class prefix",
		setup: {
			designRules: { minClearance: 0.2 },
			netClasses: [
				{ name: "Default", clearance: 0.2 },
				{ name: "Power", clearance: 0.1 },
			],
		},
		expectedSubstrings: [
			'Net class "Power": Clearance must be at least the minimum clearance',
		],
	},
	{
		title: "flags predefined track width below minimum",
		setup: {
			designRules: { minTrackWidth: 0.25 },
			trackWidths: [0.1, 0.5],
		},
		expectedSubstrings: [
			"Predefined track width (0.1 mm) must be at least the minimum track width",
		],
	},
];

describe("boardSetup - validateSetup", () => {
	for (const tc of VALIDATION_CASES) {
		test(tc.title, () => {
			const problems = validateSetup(tc.setup);
			if (tc.expectedProblems) {
				assert.deepEqual(problems, tc.expectedProblems);
			}
			for (const sub of tc.expectedSubstrings ?? []) {
				assert.ok(
					problems.some((p) => p.includes(sub)),
					`Expected problem containing "${sub}", got ${JSON.stringify(problems)}`,
				);
			}
		});
	}
});

const NET_CLASS_ASSIGNMENT_CASES = [
	{
		title: "returns Default class when netName is undefined",
		netName: undefined,
		expectedName: "Default",
	},
	{
		title: "returns Default class when netName is empty string",
		netName: "",
		expectedName: "Default",
	},
	{
		title: "returns Default class when netName is unassigned",
		netName: "SIGNAL_RANDOM",
		expectedName: "Default",
	},
	{
		title: "returns custom user class when netName is assigned",
		netName: "VBUS",
		expectedName: "Power",
	},
];

describe("boardSetup - netClassForNet", () => {
	const setup = {
		netClasses: [
			{ name: "Default", clearance: 0.2, trackWidth: 0.25 },
			{
				name: "Power",
				clearance: 0.3,
				trackWidth: 0.5,
				nets: ["VBUS", "GND"],
			},
		],
	};

	for (const tc of NET_CLASS_ASSIGNMENT_CASES) {
		test(tc.title, () => {
			const cls = netClassForNet(setup, tc.netName);
			assert.equal(cls.name, tc.expectedName);
		});
	}
});

describe("boardSetup - trackWidthsFromSetup shape", () => {
	test("returns same preset shape as WIDTH_PRESETS in routingModel", () => {
		const presets = trackWidthsFromSetup();
		assert.equal(presets.length, 3);
		for (const p of presets) {
			assert.equal(typeof p.label, "string");
			assert.equal(typeof p.mm, "number");
			assert.equal(typeof p.hint, "string");
			assert.ok(p.mm > 0);
			assert.ok(p.hint.length > 0);
		}
		assert.equal(presets[0].label, "Signal 0.25 mm");
		assert.equal(presets[0].mm, 0.25);
		assert.equal(presets[1].label, "Power 0.5 mm");
		assert.equal(presets[1].mm, 0.5);
		assert.equal(presets[2].label, "High current 1.0 mm");
		assert.equal(presets[2].mm, 1.0);
	});

	test("formats custom widths into presets with label and hint", () => {
		const customSetup = { trackWidths: [0.15, 0.35] };
		const presets = trackWidthsFromSetup(customSetup);
		assert.equal(presets.length, 2);
		assert.equal(presets[0].mm, 0.15);
		assert.equal(presets[0].label, "0.15 mm");
		assert.ok(presets[0].hint.includes("capacity"));
	});
});

const DIALOG_STRUCTURE_CHECKS = [
	{
		title: "exports BoardSetupDialog component",
		pattern: /export\s+(?:default\s+)?(?:function\s+)?BoardSetupDialog\b/,
	},
	{
		title: "accepts open, board, onSave, onCancel props",
		pattern:
			/function\s+BoardSetupDialog\(\s*\{\s*open,\s*board,\s*onSave,\s*onCancel\s*\}\s*\)/,
	},
	{
		title: "contains Board tab",
		pattern: /label:\s*"Board"/,
	},
	{
		title: "contains Design rules tab",
		pattern: /label:\s*"Design rules"/,
	},
	{
		title: "contains Net classes tab",
		pattern: /label:\s*"Net classes"/,
	},
	{
		title: "contains Track and via sizes tab",
		pattern: /label:\s*"Track and via sizes"/,
	},
	{
		title: "disables save button when problems exist",
		pattern: /okButtonProps=\{\{\s*disabled:\s*problems\.length\s*>\s*0\s*\}\}/,
	},
];

describe("BoardSetupDialog - structure and wiring", () => {
	for (const check of DIALOG_STRUCTURE_CHECKS) {
		test(check.title, () => {
			assert.match(dialogSrc, check.pattern);
		});
	}
});
