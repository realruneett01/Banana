// Note: All 9 exported functions from backend/src/svg-semantic-resolver.js are pure JS and testable without kicad-cli or network.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	findClosestFootprint,
	findClosestPad,
	findClosestSegmentNet,
	generatePreciseAuditLog,
	resolveCopperIdentity,
	resolveCopperPadIdentity,
	resolveCopperTraceIdentity,
	resolveNonCopperIdentity,
	resolveSemanticIdentity,
} from "../../backend/src/svg-semantic-resolver.js";

function makePcbMeta(footprints = [], pads = [], segments = []) {
	return { footprints, pads, segments };
}

function assertFields(actual, expected) {
	for (const [key, value] of Object.entries(expected)) {
		assert.equal(actual?.[key], value);
	}
}

function assertFindsNull(fn, cases) {
	for (const [center, items] of cases) {
		assert.equal(fn(center, items), null);
	}
}

function makeNullCases(distantItem) {
	const origin = { x: 0, y: 0 };
	return [
		[null, [distantItem]],
		[origin, null],
		[origin, []],
		[origin, [distantItem]],
	];
}

function runThresholdChecks(resolver, items, testCases) {
	for (const { target, threshold, key, expected } of testCases) {
		const match = resolver(target, items, threshold);
		assert.equal(match?.[key], expected);
	}
}

function checkCopperPad({ pin, netName, changedRef, expected }) {
	const pad = { refDes: "R1", pin, netName };
	const footprints = [{ ref: "R1", value: "10k" }];
	const fpChanges = new Set([changedRef]);
	const res = resolveCopperPadIdentity(pad, footprints, fpChanges, "F.Cu");
	assert.deepEqual(res, expected);
}

function resolveTestTrace({ diffItem, center, closestPad = null }) {
	const segments = [
		{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, net: "+5V" },
	];
	return resolveCopperTraceIdentity({
		diffItem,
		center,
		closestPad,
		segments,
		defaultLayer: "F.Cu",
	});
}

function resolveCuTestIdentity({
	diffItem = {},
	center,
	isOpen = false,
	pcbMetadata,
}) {
	return resolveCopperIdentity({
		diffItem,
		center,
		isChainOrOpenTrace: isOpen,
		pcbMetadata,
		defaultLayer: "F.Cu",
	});
}

function runAuditLog(targetMap, baseMap, pcbMetadata) {
	return generatePreciseAuditLog(
		targetMap,
		baseMap,
		pcbMetadata,
		"board-F_Cu.svg",
	);
}

function makeTagMap(entries) {
	return new Map(
		entries.map(([tagProp, info]) => [
			typeof tagProp === "string" ? { tagName: tagProp } : tagProp,
			info,
		]),
	);
}

function makeAuditFixtures() {
	const targetMap = makeTagMap([
		[
			"path",
			{
				diffIdx: 1,
				diffClass: "diff-added",
				center: { x: 10, y: 20 },
				netName: "DATA",
				isClosedPath: false,
			},
		],
	]);
	const baseMap = makeTagMap([
		["circle", { diffIdx: 2, diffClass: "diff-deleted", refDes: "C1" }],
	]);
	const pcbMetadata = makePcbMeta([
		{ ref: "C1", value: "100nF", layer: "F.Cu" },
	]);
	return { targetMap, baseMap, pcbMetadata };
}

function makeFilterMaps() {
	const targetMap = makeTagMap([
		["path", { diffIdx: 10, diffClass: "diff-unchanged" }],
		[
			{ tagName: "rect", isWorksheetFrame: true },
			{ diffIdx: 11, diffClass: "diff-changed" },
		],
		[
			"line",
			{
				diffIdx: 12,
				diffClass: "diff-changed",
				displacement: 2.5,
				refDes: "R1",
			},
		],
	]);
	const baseMap = makeTagMap([
		["line", { diffIdx: 12, diffClass: "diff-changed", refDes: "R1" }],
	]);
	return { targetMap, baseMap };
}

describe("svg-semantic-resolver unit tests", () => {
	describe("findClosestPad", () => {
		test("finds closest pad within default and custom threshold", () => {
			runThresholdChecks(
				findClosestPad,
				[
					{ x: 10, y: 10, refDes: "R1", pin: "1" },
					{ x: 10.8, y: 10, refDes: "R1", pin: "2" },
					{ x: 15, y: 15, refDes: "C1", pin: "1" },
				],
				[
					{ target: { x: 10.2, y: 10 }, key: "pin", expected: "1" },
					{
						target: { x: 14, y: 14 },
						threshold: 2.0,
						key: "refDes",
						expected: "C1",
					},
				],
			);
		});

		test("returns null for empty, null, or out-of-range inputs", () => {
			assertFindsNull(findClosestPad, makeNullCases({ x: 5, y: 5 }));
		});
	});

	describe("findClosestSegmentNet", () => {
		test("resolves net name from closest segment start, end, or midpoint", () => {
			const segments = [
				{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, net: "+3V3" },
				{ start: { x: 20, y: 0 }, end: { x: 20, y: 10 }, netName: "GND" },
			];
			const cases = [
				[{ x: 5, y: 0.5 }, "+3V3"],
				[{ x: 20, y: 9.5 }, "GND"],
			];
			for (const [target, expected] of cases) {
				assert.equal(findClosestSegmentNet(target, segments), expected);
			}
		});

		test("returns null for empty inputs, invalid nets, or distant segments", () => {
			const validSeg = {
				start: { x: 0, y: 0 },
				end: { x: 1, y: 0 },
				net: "VCC",
			};
			const unconnSeg = {
				start: { x: 0, y: 0 },
				end: { x: 1, y: 0 },
				net: "unconnected",
			};
			assertFindsNull(findClosestSegmentNet, [
				[null, [validSeg]],
				[{ x: 0, y: 0 }, []],
				[{ x: 0, y: 0 }, [unconnSeg]],
				[{ x: 0, y: 0 }, [{ net: "VCC" }]],
				[{ x: 50, y: 50 }, [validSeg]],
			]);
		});
	});

	describe("findClosestFootprint", () => {
		test("finds nearest footprint or respects custom distance limit", () => {
			runThresholdChecks(
				findClosestFootprint,
				[
					{ x: 50, y: 50, ref: "U1", value: "STM32" },
					{ x: 55, y: 50, ref: "R2", value: "1k" },
				],
				[
					{ target: { x: 51, y: 50 }, key: "ref", expected: "U1" },
					{
						target: { x: 60, y: 50 },
						threshold: 12.0,
						key: "ref",
						expected: "R2",
					},
				],
			);
		});

		test("returns null for empty list, null center, or out-of-range footprint", () => {
			assertFindsNull(findClosestFootprint, makeNullCases({ x: 20, y: 20 }));
		});
	});

	describe("resolveCopperPadIdentity", () => {
		test("resolves component identity when footprint changes exist", () => {
			checkCopperPad({
				pin: "1",
				netName: "NET_A",
				changedRef: "R1",
				expected: {
					name: "R1 (10k)",
					refDes: "R1",
					pin: "1",
					net: "NET_A",
					type: "COMPONENT",
					layer: "F.Cu",
					connection: "Pin 1 • NET_A",
				},
			});
		});

		test("resolves trace identity when footprint is unchanged", () => {
			checkCopperPad({
				pin: "2",
				netName: "GND",
				changedRef: "C1",
				expected: {
					name: "GND",
					refDes: "R1",
					type: "TRACE",
					layer: "F.Cu",
					connection: "Pad 2 of R1",
				},
			});
		});

		test("falls back to default labels for missing pin and unconnected net", () => {
			const pad = { refDes: "TP1", netName: "unconnected" };
			const res = resolveCopperPadIdentity(pad, [], null, "B.Cu");
			assertFields(res, { name: "TP1", connection: "Pad", type: "COMPONENT" });
		});
	});

	describe("resolveCopperTraceIdentity", () => {
		test("prioritizes closest pad when available", () => {
			const res = resolveTestTrace({
				diffItem: { netName: "OLD" },
				center: { x: 0, y: 0 },
				closestPad: { refDes: "U1", pin: "8", netName: "VCC" },
			});
			assertFields(res, { name: "VCC", connection: "Connected to U1 Pin 8" });
		});

		test("resolves segment net or diffItem net as fallback", () => {
			const cases = [
				{
					diffItem: { netName: "OLD" },
					center: { x: 5, y: 0.5 },
					expected: "+5V",
				},
				{
					diffItem: { net: "SIG1" },
					center: { x: 50, y: 50 },
					expected: "SIG1",
				},
			];
			for (const { diffItem, center, expected } of cases) {
				const res = resolveTestTrace({ diffItem, center });
				assert.equal(res.name, expected);
			}
		});
	});

	describe("resolveCopperIdentity", () => {
		test("routes open traces to trace resolver and pads to pad resolver", () => {
			const pcbMetadata = {
				footprints: [{ ref: "D1", value: "RED" }],
				pads: [{ x: 10, y: 10, refDes: "D1", pin: "A", netName: "ANODE" }],
				segments: [],
				footprintChanges: new Set(["D1"]),
			};
			const cases = [
				{
					diffItem: { isClosedPath: false },
					isOpen: true,
					expectedType: "TRACE",
				},
				{ diffItem: {}, isOpen: false, expectedType: "COMPONENT" },
			];
			for (const { diffItem, isOpen, expectedType } of cases) {
				const res = resolveCuTestIdentity({
					diffItem,
					center: { x: 10, y: 10 },
					isOpen,
					pcbMetadata,
				});
				assert.equal(res.type, expectedType);
			}
		});

		test("returns null when no pad is nearby for closed shapes", () => {
			const res = resolveCuTestIdentity({
				center: { x: 99, y: 99 },
				pcbMetadata: makePcbMeta(),
			});
			assert.equal(res, null);
		});
	});

	describe("resolveNonCopperIdentity", () => {
		test("resolves non-copper component identity with value and layer", () => {
			const footprints = [
				{ x: 30, y: 30, ref: "C5", value: "22pF", layer: "F.SilkS" },
				{ x: 80, y: 80, ref: "J2" },
			];
			const res = resolveNonCopperIdentity(
				{ x: 31, y: 30 },
				footprints,
				"F.SilkS",
			);
			assert.deepEqual(res, {
				name: "C5 (22pF)",
				refDes: "C5",
				type: "COMPONENT",
				layer: "F.SilkS",
			});

			const defLayer = resolveNonCopperIdentity(
				{ x: 81, y: 80 },
				footprints,
				"B.SilkS",
			);
			assert.equal(defLayer.layer, "B.SilkS");
		});

		test("returns null for missing center, empty list, or distant components", () => {
			const footprints = [{ x: 5, y: 5, ref: "R1" }];
			assertFindsNull(
				(center, fps) => resolveNonCopperIdentity(center, fps, "F.SilkS"),
				[
					[null, footprints],
					[{ x: 0, y: 0 }, []],
					[{ x: 50, y: 50 }, footprints],
				],
			);
		});
	});

	describe("resolveSemanticIdentity", () => {
		test("resolves component from footprint refDes in metadata", () => {
			const pcbMetadata = makePcbMeta([
				{ ref: "U3", value: "OpAmp", layer: "F.Cu" },
			]);
			const res = resolveSemanticIdentity(
				{ refDes: "U3", layer: "board-F_Cu.svg" },
				pcbMetadata,
				true,
			);
			assertFields(res, { name: "U3 (OpAmp)", type: "COMPONENT" });
		});

		test("falls back to layer graphics or traces when metadata is missing", () => {
			const cases = [
				{
					item: { refDes: "R9", layer: "board-F_Cu.svg" },
					meta: null,
					isCu: true,
					expectedType: "TRACE",
				},
				{
					item: { name: "Logo_KiCad", layer: "Edge_Cuts.svg" },
					meta: makePcbMeta(),
					isCu: false,
					expectedType: "GRAPHIC",
				},
			];
			for (const { item, meta, isCu, expectedType } of cases) {
				const res = resolveSemanticIdentity(item, meta, isCu);
				assert.equal(res.type, expectedType);
			}
		});
	});

	describe("generatePreciseAuditLog", () => {
		test("builds audit log records for target and base classifications", () => {
			const { targetMap, baseMap, pcbMetadata } = makeAuditFixtures();
			const logs = runAuditLog(targetMap, baseMap, pcbMetadata);
			assert.equal(logs.length, 2);
			assertFields(logs[0], { action: "ADDED", title: "added data trace" });
			assertFields(logs[1], { action: "DELETED", name: "C1 (100nF)" });
		});

		test("skips unchanged items, worksheet frames, and duplicate diff indices", () => {
			const { targetMap, baseMap } = makeFilterMaps();
			const pcbMetadata = makePcbMeta([{ ref: "R1", layer: "F.Cu" }]);
			const logs = runAuditLog(targetMap, baseMap, pcbMetadata);

			assert.equal(logs.length, 1);
			assert.equal(logs[0].diffIdx, 12);
			assert.match(logs[0].detail, /Relocated by 2\.50 mm/);
			assert.deepEqual(runAuditLog(null, null, pcbMetadata), []);
		});
	});
});
