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

const loadSource = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const dialogSrc = loadSource("../../frontend/src/editor/BoardSetupDialog.jsx");

function assertProps(target, expected) {
	for (const [key, val] of Object.entries(expected)) {
		assert.equal(target[key], val);
	}
}

const makeBoard = (setup, extra = {}) =>
	Object.freeze({
		outline: [{ x: 0, y: 0 }],
		setup,
		...extra,
	});

describe("boardSetup - DEFAULT_SETUP", () => {
	test("provides KiCad default board stackup and dimensions", () => {
		assertProps(DEFAULT_SETUP, {
			thickness: 1.6,
			copperLayers: 2,
			clearance: 0.2,
			track: 0.25,
			via: 0.6,
			viaDrill: 0.3,
			diffPairWidth: 0.2,
			diffPairGap: 0.25,
		});
	});

	test("contains default design rules object matching limits", () => {
		assertProps(DEFAULT_SETUP.designRules, {
			minClearance: DEFAULT_DESIGN_RULES.minClearance,
			minTrackWidth: DEFAULT_DESIGN_RULES.minTrackWidth,
			minViaSize: DEFAULT_DESIGN_RULES.minViaSize,
			minViaDrill: DEFAULT_DESIGN_RULES.minViaDrill,
			minDiffPairWidth: DEFAULT_DESIGN_RULES.minDiffPairWidth,
			minDiffPairGap: DEFAULT_DESIGN_RULES.minDiffPairGap,
		});
	});

	test("contains Default net class and predefined sizes", () => {
		const [defNetClass] = DEFAULT_SETUP.netClasses;
		assert.equal(DEFAULT_SETUP.netClasses.length, 1);
		assertProps(defNetClass, {
			name: "Default",
			clearance: DEFAULT_NET_CLASS.clearance,
			trackWidth: DEFAULT_NET_CLASS.trackWidth,
			viaSize: DEFAULT_NET_CLASS.viaSize,
			viaDrill: DEFAULT_NET_CLASS.viaDrill,
		});
		assert.deepEqual(
			[DEFAULT_SETUP.trackWidths, DEFAULT_SETUP.viaSizes],
			[DEFAULT_TRACK_WIDTHS, DEFAULT_VIA_SIZES],
		);
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
		const board = makeBoard(origSetup);

		const merged = getBoardSetup(board);
		assertProps(merged, {
			thickness: 0.8,
			copperLayers: 4,
			clearance: 0.15,
			track: 0.25,
		});
		assert.equal(board.setup.thickness, 0.8);
	});

	test("withBoardSetup creates new board and preserves non-setup fields", () => {
		const initialBoard = makeBoard(
			{ thickness: 1.6 },
			{
				outline: [{ x: 10, y: 10 }],
				tracks: [{ start: [0, 0], end: [1, 1], widthMm: 0.25 }],
				vias: [],
				zones: [],
			},
		);

		const nextBoard = withBoardSetup(initialBoard, {
			thickness: 2.0,
			copperLayers: 6,
		});

		assert.notEqual(nextBoard, initialBoard);
		assertProps(nextBoard.setup, {
			thickness: 2.0,
			copperLayers: 6,
		});
		assert.equal(initialBoard.setup.thickness, 1.6);
		assert.deepEqual(
			[nextBoard.tracks, nextBoard.outline],
			[initialBoard.tracks, initialBoard.outline],
		);
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
		const expectedPresets = [
			{ label: "Signal 0.25 mm", mm: 0.25 },
			{ label: "Power 0.5 mm", mm: 0.5 },
			{ label: "High current 1.0 mm", mm: 1.0 },
		];
		expectedPresets.forEach((exp, idx) => {
			assertProps(presets[idx], exp);
		});
	});

	test("formats custom widths into presets with label and hint", () => {
		const customSetup = { trackWidths: [0.15, 0.35] };
		const presets = trackWidthsFromSetup(customSetup);
		assert.equal(presets.length, 2);
		assertProps(presets[0], { mm: 0.15, label: "0.15 mm" });
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
