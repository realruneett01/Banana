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

function runCopperRegistrationTest({
	processFn,
	mod,
	expectedKey,
	expectedDiffIdx,
}) {
	const map = new Map();
	processFn(mod, new Map(), map);
	assert.equal(map.has(expectedKey), true);
	assert.equal(map.get(expectedKey).diffIdx, expectedDiffIdx);
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

	assert.equal(map.size, 1);
	assert.equal(map.get(expectedKey)[expectedField], expectedVal);
}

describe("diff-consolidator unit tests", () => {
	describe("isCopperLayerFilename", () => {
		test("table-driven validation of copper and non-copper layer filenames", () => {
			const copperFilenames = [
				"board-F_Cu.svg",
				"board-B_Cu.svg",
				"board-In1_Cu.svg",
				"board-In32_Cu.svg",
			];
			for (const name of copperFilenames) {
				assert.equal(
					isCopperLayerFilename(name),
					true,
					`Failed for input: ${name}`,
				);
			}

			const nonCopperFilenames = [
				"",
				null,
				undefined,
				"board-Edge_Cuts.svg",
				"board-F_Cu_SilkS.svg",
			];
			for (const name of nonCopperFilenames) {
				assert.equal(
					isCopperLayerFilename(name),
					false,
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
			const footprintChanges = new Map([["R1", fpChange]]);
			const componentMap = new Map();
			const traceMap = new Map();

			processComponentMod(mod, footprintChanges, componentMap, traceMap);

			assert.equal(componentMap.has("R1"), true);
			const registered = componentMap.get("R1");
			const expectedProps = [
				["action", "MOVED"],
				["displacement", 2.5],
				["detail", "Relocated by 2.50 mm on F.Cu • (10.50, 20.50)"],
			];
			for (const [prop, val] of expectedProps) {
				assert.equal(registered[prop], val);
			}
			assert.deepEqual(
				{
					baseCoords: registered.baseCoords,
					targetCoords: registered.targetCoords,
				},
				{
					baseCoords: { x: 8, y: 20.5 },
					targetCoords: { x: 10.5, y: 20.5 },
				},
			);
			assert.equal(traceMap.size, 0);
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

			assert.equal(componentMap.size, 0);
			assert.equal(traceMap.size, 1);
			const traceEntry = traceMap.get("vcc@board-F_Cu.svg");
			const expectedFields = [
				["type", "TRACE"],
				["name", "/VCC"],
				["detail", "Connected to C1 • Layer F.Cu"],
			];
			for (const [field, expected] of expectedFields) {
				assert.equal(traceEntry[field], expected);
			}
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
			const footprintChanges = new Map([["U1", fpChange]]);

			processComponentMod(mod, footprintChanges, componentMap, traceMap);

			const expectedProps = [
				["layer", "board-F_Cu.svg"],
				["diffIdx", 2],
			];
			for (const [prop, val] of expectedProps) {
				assert.equal(existing[prop], val);
			}
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

	describe("processTraceMod", () => {
		test("adds copper trace to traceMap keyed by normalized net and layer", () => {
			runCopperRegistrationTest({
				processFn: processTraceMod,
				mod: { layer: "board-F_Cu.svg", name: "/RESET", diffIdx: 1 },
				expectedKey: "reset@board-F_Cu.svg",
				expectedDiffIdx: 1,
			});
		});

		test("absorbs non-copper trace near footprint and deduplicates traces on same net and layer", () => {
			runAbsorptionAndDedupTest({
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
			});
		});
	});

	describe("processGraphicMod", () => {
		test("adds copper graphic to graphicMap keyed by title and layer", () => {
			runCopperRegistrationTest({
				processFn: processGraphicMod,
				mod: {
					title: "board_outline",
					layer: "board-F_Cu.svg",
					diffIdx: 1,
				},
				expectedKey: "board_outline@board-F_Cu.svg",
				expectedDiffIdx: 1,
			});
		});

		test("absorbs non-copper graphic near footprint and deduplicates identical graphics", () => {
			runAbsorptionAndDedupTest({
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
			});
		});
	});

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

			const expectedOrder = [
				[0, "type", "add_layer"],
				[1, "type", "delete_layer"],
				[2, "refDes", "R1"],
				[3, "name", "SIG1"],
				[4, "title", "Line1"],
			];
			assert.equal(result.length, expectedOrder.length);
			for (const [idx, prop, val] of expectedOrder) {
				assert.equal(result[idx][prop], val);
			}
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

			assert.equal(result.length, 2);
			const expectedIds = [
				[0, 1],
				[1, 3],
			];
			for (const [idx, id] of expectedIds) {
				assert.equal(result[idx].id, id);
			}
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

			for (const side of ["sideBySideBase", "sideBySideTarget"]) {
				assert.equal(result[side].filename, "board-F_Cu.svg");
			}
			assert.equal(Array.isArray(result.modifications), true);
			assert.equal(result.nextDiffIdx >= 10, true);
			assert.ok(result.telemetry);
			assert.equal(result.telemetry.layer, "board-F_Cu.svg");
		});

		test("catches diff failure and returns fallback layer pair with untouched diffIdx", () => {
			const result = processLayerPair({
				baseSvg: { filename: "broken.svg", content: null },
				matchingTarget: { filename: "broken.svg", content: null },
				pcbMetadata: {},
				globalDiffIdx: 42,
			});

			assert.equal(result.nextDiffIdx, 42);
			assert.deepEqual(result.modifications, []);
			for (const val of [result.telemetry, result.sideBySideBase.content]) {
				assert.equal(val, null);
			}
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

			assert.equal(added.length, 1);
			const expectedProps = [
				["type", "add_layer"],
				["layer", "board-In1_Cu.svg"],
				["text", "Entire layer board-In1_Cu.svg added"],
			];
			for (const [prop, val] of expectedProps) {
				assert.equal(added[0].mod[prop], val);
			}
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
