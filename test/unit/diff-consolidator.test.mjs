// Note: All 9 exported functions from backend/src/diff-consolidator.js are pure JS and testable without kicad-cli or network.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	consolidateModifications,
	findAddedLayers,
	getLayerSuffix,
	isAbsorbedByFootprint,
	isCopperLayerFilename,
	processComponentMod,
	processGraphicMod,
	processLayerPair,
	processTraceMod,
} from "../../backend/src/diff-consolidator.js";

function assertObjectProps(obj, expectedProps) {
	for (const [prop, val] of expectedProps) {
		assert.equal(obj[prop], val);
	}
}

function runCopperRegistrationTest({
	processFn,
	mod,
	expectedKey,
	expectedDiffIdx,
}) {
	const map = new Map();
	processFn(mod, new Map(), map);
	assert.deepEqual(
		{
			hasKey: map.has(expectedKey),
			diffIdx: map.get(expectedKey)?.diffIdx,
		},
		{
			hasKey: true,
			diffIdx: expectedDiffIdx,
		},
	);
}

function runAbsorptionAndDedupTest({
	processFn,
	absorbedMod,
	footprintChanges,
	firstMod,
	secondMod,
	expectedKey,
	expectedField,
	expectedVal,
}) {
	const map = new Map();
	processFn(absorbedMod, footprintChanges, map);
	assert.equal(map.size, 0);

	processFn(firstMod, new Map(), map);
	processFn(secondMod, new Map(), map);

	assert.deepEqual(
		{
			size: map.size,
			val: map.get(expectedKey)?.[expectedField],
		},
		{
			size: 1,
			val: expectedVal,
		},
	);
}

function defineModLifecycleTests({ describeName, copperCase, absorptionCase }) {
	describe(describeName, () => {
		test(copperCase.name, () => {
			runCopperRegistrationTest(copperCase);
		});
		test(absorptionCase.name, () => {
			runAbsorptionAndDedupTest(absorptionCase);
		});
	});
}

const MOD_SUITE_SPECS = [
	{
		describeName: "processTraceMod",
		copperCase: {
			name: "adds copper trace to traceMap keyed by normalized net and layer",
			processFn: processTraceMod,
			mod: { layer: "board-F_Cu.svg", name: "/RESET", diffIdx: 1 },
			expectedKey: "reset@board-F_Cu.svg",
			expectedDiffIdx: 1,
		},
		absorptionCase: {
			name: "absorbs non-copper trace near footprint and deduplicates traces on same net and layer",
			processFn: processTraceMod,
			absorbedMod: {
				layer: "board-SilkS.svg",
				bbox: { x1: 0, y1: 0, x2: 2, y2: 2 },
				name: "label",
			},
			footprintChanges: new Map([["R1", { targetAt: { x: 1, y: 1 } }]]),
			firstMod: { layer: "board-F_Cu.svg", net: "GND", diffIdx: 10 },
			secondMod: { layer: "board-F_Cu.svg", net: "GND", diffIdx: 20 },
			expectedKey: "gnd@board-F_Cu.svg",
			expectedField: "diffIdx",
			expectedVal: 10,
		},
	},
	{
		describeName: "processGraphicMod",
		copperCase: {
			name: "adds copper graphic to graphicMap keyed by title and layer",
			processFn: processGraphicMod,
			mod: {
				title: "board_outline",
				layer: "board-F_Cu.svg",
				diffIdx: 1,
			},
			expectedKey: "board_outline@board-F_Cu.svg",
			expectedDiffIdx: 1,
		},
		absorptionCase: {
			name: "absorbs non-copper graphic near footprint and deduplicates identical graphics",
			processFn: processGraphicMod,
			absorbedMod: {
				title: "silkscreen_art",
				layer: "board-SilkS.svg",
				bbox: { x1: 2, y1: 2, x2: 4, y2: 4 },
			},
			footprintChanges: new Map([["U1", { targetAt: { x: 3, y: 3 } }]]),
			firstMod: { title: "logo", layer: "F_Cu", id: "first_logo" },
			secondMod: { title: "logo", layer: "F_Cu", id: "second_logo" },
			expectedKey: "logo@F_Cu",
			expectedField: "id",
			expectedVal: "first_logo",
		},
	},
];

describe("diff-consolidator unit tests", () => {
	describe("isCopperLayerFilename", () => {
		test("table-driven validation of copper and non-copper layer filenames", () => {
			const cases = [
				...[
					"board-F_Cu.svg",
					"board-B_Cu.svg",
					"board-In1_Cu.svg",
					"board-In32_Cu.svg",
				].map((name) => ({ name, expected: true })),
				...[
					"",
					null,
					undefined,
					"board-Edge_Cuts.svg",
					"board-F_Cu_SilkS.svg",
				].map((name) => ({ name, expected: false })),
			];

			for (const { name, expected } of cases) {
				assert.equal(
					isCopperLayerFilename(name),
					expected,
					`Failed for input: ${name}`,
				);
			}
		});
	});

	describe("getLayerSuffix", () => {
		test("table-driven extraction of layer suffix from filename", () => {
			const cases = [
				{ input: "project/layers/board-F_Cu.svg", expected: "f_cu.svg" },
				{ input: "C:\\kicad\\board-B_Cu.SVG", expected: "b_cu.svg" },
				{ input: "", expected: "" },
				{ input: null, expected: "" },
				{ input: undefined, expected: "" },
				{ input: "standalone.kicad_pcb", expected: "standalone.kicad_pcb" },
				{ input: "revA-revB-Inner_1.svg", expected: "inner_1.svg" },
			];

			for (const { input, expected } of cases) {
				assert.equal(
					getLayerSuffix(input),
					expected,
					`Failed for input: ${input}`,
				);
			}
		});
	});

	describe("isAbsorbedByFootprint", () => {
		test("returns true when modification center is within 10mm of footprint targetAt", () => {
			const mod = { bbox: { x1: 10, y1: 10, x2: 20, y2: 20 } };
			const footprintChanges = new Map([
				["R1", { targetAt: { x: 17, y: 17 } }],
			]);

			assert.equal(isAbsorbedByFootprint(mod, footprintChanges), true);
		});

		test("returns false when bbox is missing, distance >= 10mm, or targetAt is absent", () => {
			const farChanges = new Map([
				["R1", { targetAt: { x: 30, y: 30 } }],
				["R2", { targetAt: null }],
			]);
			const falseCases = [
				{ mod: {}, changes: farChanges },
				{ mod: { bbox: null }, changes: farChanges },
				{ mod: { bbox: { x1: 0, y1: 0, x2: 2, y2: 2 } }, changes: farChanges },
				{ mod: { bbox: { x1: 0, y1: 0, x2: 2, y2: 2 } }, changes: new Map() },
			];

			for (const { mod, changes } of falseCases) {
				assert.equal(isAbsorbedByFootprint(mod, changes), false);
			}
		});
	});

	describe("processComponentMod", () => {
		test("registers new component and computes relocation detail when footprintChanges has refDes", () => {
			const mod = {
				refDes: "R1",
				action: "MODIFIED",
				displacement: 0,
				layer: "board-F_Cu.svg",
				bbox: { x1: 1, y1: 1, x2: 5, y2: 5 },
			};
			const fpChange = {
				action: "MOVED",
				dist: 2.5,
				targetAt: { x: 10.5, y: 20.5 },
				baseAt: { x: 8, y: 20.5 },
			};
			const componentMap = new Map();
			const traceMap = new Map();

			processComponentMod(
				mod,
				new Map([["R1", fpChange]]),
				componentMap,
				traceMap,
			);

			const registered = componentMap.get("R1");
			assertObjectProps(registered, [
				["action", "MOVED"],
				["displacement", 2.5],
				["detail", "Relocated by 2.50 mm on F.Cu • (10.50, 20.50)"],
			]);
			assert.deepEqual(
				{
					baseCoords: registered.baseCoords,
					targetCoords: registered.targetCoords,
					hasR1: componentMap.has("R1"),
					traceSize: traceMap.size,
				},
				{
					baseCoords: { x: 8, y: 20.5 },
					targetCoords: { x: 10.5, y: 20.5 },
					hasR1: true,
					traceSize: 0,
				},
			);
		});

		test("routes to traceMap when footprintChanges is non-empty but does not contain refDes", () => {
			const mod = {
				refDes: "C1",
				layer: "board-F_Cu.svg",
				net: "/VCC",
			};
			const footprintChanges = new Map([["R1", { action: "MOVED" }]]);
			const componentMap = new Map();
			const traceMap = new Map();

			processComponentMod(mod, footprintChanges, componentMap, traceMap);

			assert.deepEqual(
				{ compSize: componentMap.size, traceSize: traceMap.size },
				{ compSize: 0, traceSize: 1 },
			);
			assertObjectProps(traceMap.get("vcc@board-F_Cu.svg"), [
				["type", "TRACE"],
				["name", "/VCC"],
				["detail", "Connected to C1 • Layer F.Cu"],
			]);
		});

		test("updates existing component when new mod is on F_Cu layer", () => {
			const existing = {
				refDes: "U1",
				layer: "board-B_Cu.svg",
				diffIdx: 1,
				bbox: { x1: 0, y1: 0, x2: 2, y2: 2 },
			};
			const componentMap = new Map([["U1", existing]]);
			const traceMap = new Map();
			const mod = {
				refDes: "U1",
				layer: "board-F_Cu.svg",
				diffIdx: 2,
				bbox: { x1: 5, y1: 5, x2: 8, y2: 8 },
			};
			const fpChange = {
				baseAt: { x: 1, y: 1 },
				targetAt: { x: 2, y: 2 },
			};

			processComponentMod(
				mod,
				new Map([["U1", fpChange]]),
				componentMap,
				traceMap,
			);

			assertObjectProps(existing, [
				["layer", "board-F_Cu.svg"],
				["diffIdx", 2],
			]);
			assert.deepEqual(
				{
					bbox: existing.bbox,
					baseCoords: existing.baseCoords,
					targetCoords: existing.targetCoords,
				},
				{
					bbox: { x1: 5, y1: 5, x2: 8, y2: 8 },
					baseCoords: { x: 1, y: 1 },
					targetCoords: { x: 2, y: 2 },
				},
			);
		});
	});

	for (const spec of MOD_SUITE_SPECS) {
		defineModLifecycleTests(spec);
	}

	describe("consolidateModifications", () => {
		test("consolidates mixed modifications preserving add_layer and delete_layer in order", () => {
			const mods = [
				{ type: "add_layer", layer: "board-In1_Cu.svg" },
				{ type: "delete_layer", layer: "board-In2_Cu.svg" },
				{ type: "COMPONENT", refDes: "R1", layer: "board-F_Cu.svg" },
				{ type: "TRACE", layer: "board-F_Cu.svg", name: "SIG1" },
				{ type: "GRAPHIC", title: "Line1", layer: "board-F_Cu.svg" },
			];

			const result = consolidateModifications(mods);

			assert.deepEqual(
				{
					length: result.length,
					type0: result[0]?.type,
					type1: result[1]?.type,
					refDes2: result[2]?.refDes,
					name3: result[3]?.name,
					title4: result[4]?.title,
				},
				{
					length: 5,
					type0: "add_layer",
					type1: "delete_layer",
					refDes2: "R1",
					name3: "SIG1",
					title4: "Line1",
				},
			);
		});

		test("handles empty input and deduplicates items in single batch", () => {
			assert.deepEqual(consolidateModifications([]), []);

			const mods = [
				{ type: "TRACE", layer: "board-F_Cu.svg", name: "VCC", id: 1 },
				{ type: "TRACE", layer: "board-F_Cu.svg", name: "VCC", id: 2 },
				{ type: "GRAPHIC", title: "Box", layer: "board-F_Cu.svg", id: 3 },
				{ type: "GRAPHIC", title: "Box", layer: "board-F_Cu.svg", id: 4 },
			];

			const result = consolidateModifications(mods);

			assert.deepEqual(
				result.map((item) => item.id),
				[1, 3],
			);
		});
	});

	describe("processLayerPair", () => {
		test("diffs matching SVG layer pair and returns annotated pair with telemetry and diffIdx", () => {
			const svg =
				'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="10"/></svg>';
			const result = processLayerPair({
				baseSvg: { filename: "board-F_Cu.svg", content: svg },
				matchingTarget: { filename: "board-F_Cu.svg", content: svg },
				pcbMetadata: {},
				globalDiffIdx: 10,
			});

			assert.deepEqual(
				{
					baseFilename: result.sideBySideBase.filename,
					targetFilename: result.sideBySideTarget.filename,
					isModArray: Array.isArray(result.modifications),
					hasNextDiff: result.nextDiffIdx >= 10,
					hasTelemetry: Boolean(result.telemetry),
					telemetryLayer: result.telemetry?.layer,
				},
				{
					baseFilename: "board-F_Cu.svg",
					targetFilename: "board-F_Cu.svg",
					isModArray: true,
					hasNextDiff: true,
					hasTelemetry: true,
					telemetryLayer: "board-F_Cu.svg",
				},
			);
		});

		test("catches diff failure and returns fallback layer pair with untouched diffIdx", () => {
			const result = processLayerPair({
				baseSvg: { filename: "broken.svg", content: null },
				matchingTarget: { filename: "broken.svg", content: null },
				pcbMetadata: {},
				globalDiffIdx: 42,
			});

			assert.deepEqual(
				{
					nextDiffIdx: result.nextDiffIdx,
					modifications: result.modifications,
					telemetry: result.telemetry,
					baseContent: result.sideBySideBase.content,
				},
				{
					nextDiffIdx: 42,
					modifications: [],
					telemetry: null,
					baseContent: null,
				},
			);
		});
	});

	describe("findAddedLayers", () => {
		test("identifies added layers missing from base Svgs", () => {
			const baseSvgs = [{ filename: "board-F_Cu.svg" }];
			const targetSvgs = [
				{ filename: "board-F_Cu.svg" },
				{ filename: "board-In1_Cu.svg" },
			];

			const added = findAddedLayers(targetSvgs, baseSvgs);

			assert.deepEqual(
				{
					count: added.length,
					type: added[0]?.mod?.type,
					layer: added[0]?.mod?.layer,
					text: added[0]?.mod?.text,
				},
				{
					count: 1,
					type: "add_layer",
					layer: "board-In1_Cu.svg",
					text: "Entire layer board-In1_Cu.svg added",
				},
			);
		});

		test("returns empty when targets empty or when suffixes match across differing paths", () => {
			assert.deepEqual(
				findAddedLayers([], [{ filename: "board-F_Cu.svg" }]),
				[],
			);

			const baseSvgs = [{ filename: "v1/build/board-B_Cu.svg" }];
			const targetSvgs = [{ filename: "v2/dist/board-B_Cu.svg" }];
			assert.deepEqual(findAddedLayers(targetSvgs, baseSvgs), []);
		});
	});
});
