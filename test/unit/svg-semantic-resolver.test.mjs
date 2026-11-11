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

function assertFindsNull(fn, cases) {
	for (const [center, items] of cases) {
		assert.equal(fn(center, items), null);
	}
}

function checkCopperPad({ pad, fpChanges, expected }) {
	const footprints = [{ ref: "R1", value: "10k" }];
	const res = resolveCopperPadIdentity(pad, footprints, fpChanges, "F.Cu");
	assert.deepEqual(res, expected);
}

function makeAuditFixtures() {
	const targetMap = new Map([
		[
			{ tagName: "path" },
			{
				diffIdx: 1,
				diffClass: "diff-added",
				center: { x: 10, y: 20 },
				netName: "DATA",
				isClosedPath: false,
			},
		],
	]);
	const baseMap = new Map([
		[
			{ tagName: "circle" },
			{ diffIdx: 2, diffClass: "diff-deleted", refDes: "C1" },
		],
	]);
	const pcbMetadata = makePcbMeta([
		{ ref: "C1", value: "100nF", layer: "F.Cu" },
	]);
	return { targetMap, baseMap, pcbMetadata };
}

function makeFilterMaps() {
	const targetMap = new Map([
		[{ tagName: "path" }, { diffIdx: 10, diffClass: "diff-unchanged" }],
		[
			{ tagName: "rect", isWorksheetFrame: true },
			{ diffIdx: 11, diffClass: "diff-changed" },
		],
		[
			{ tagName: "line" },
			{
				diffIdx: 12,
				diffClass: "diff-changed",
				displacement: 2.5,
				refDes: "R1",
			},
		],
	]);
	const baseMap = new Map([
		[
			{ tagName: "line" },
			{ diffIdx: 12, diffClass: "diff-changed", refDes: "R1" },
		],
	]);
	return { targetMap, baseMap };
}

describe("svg-semantic-resolver unit tests", () => {
	describe("findClosestPad", () => {
		test("finds closest pad within default and custom threshold", () => {
			const pads = [
				{ x: 10, y: 10, refDes: "R1", pin: "1" },
				{ x: 10.8, y: 10, refDes: "R1", pin: "2" },
				{ x: 15, y: 15, refDes: "C1", pin: "1" },
			];
			const cases = [
				{
					target: { x: 10.2, y: 10 },
					threshold: undefined,
					key: "pin",
					expected: "1",
				},
				{
					target: { x: 14, y: 14 },
					threshold: 2.0,
					key: "refDes",
					expected: "C1",
				},
			];
			for (const { target, threshold, key, expected } of cases) {
				const match = findClosestPad(target, pads, threshold);
				assert.equal(match[key], expected);
			}
		});

		test("returns null for empty, null, or out-of-range inputs", () => {
			assertFindsNull(findClosestPad, [
				[null, [{ x: 1, y: 1 }]],
				[{ x: 0, y: 0 }, null],
				[{ x: 0, y: 0 }, []],
				[{ x: 0, y: 0 }, [{ x: 5, y: 5 }]],
			]);
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
			const footprints = [
				{ x: 50, y: 50, ref: "U1", value: "STM32" },
				{ x: 55, y: 50, ref: "R2", value: "1k" },
			];
			const cases = [
				{ target: { x: 51, y: 50 }, threshold: undefined, expectedRef: "U1" },
				{ target: { x: 60, y: 50 }, threshold: 12.0, expectedRef: "R2" },
			];
			for (const { target, threshold, expectedRef } of cases) {
				const match = findClosestFootprint(target, footprints, threshold);
				assert.equal(match.ref, expectedRef);
			}
		});

		test("returns null for empty list, null center, or out-of-range footprint", () => {
			assertFindsNull(findClosestFootprint, [
				[null, [{ x: 0, y: 0 }]],
				[{ x: 0, y: 0 }, null],
				[{ x: 0, y: 0 }, []],
				[{ x: 0, y: 0 }, [{ x: 20, y: 20 }]],
			]);
		});
	});

	describe("resolveCopperPadIdentity", () => {
		test("resolves component identity when footprint changes exist", () => {
			checkCopperPad({
				pad: { refDes: "R1", pin: "1", netName: "NET_A" },
				fpChanges: new Set(["R1"]),
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
				pad: { refDes: "R1", pin: "2", netName: "GND" },
				fpChanges: new Set(["C1"]),
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
			const checks = [
				[res.name, "TP1"],
				[res.connection, "Pad"],
				[res.type, "COMPONENT"],
			];
			for (const [actual, expected] of checks) {
				assert.equal(actual, expected);
			}
		});
	});

	describe("resolveCopperTraceIdentity", () => {
		test("prioritizes closest pad when available", () => {
			const segs = [
				{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, net: "+5V" },
			];
			const res = resolveCopperTraceIdentity({
				diffItem: { netName: "OLD" },
				center: { x: 0, y: 0 },
				closestPad: { refDes: "U1", pin: "8", netName: "VCC" },
				segments: segs,
				defaultLayer: "F.Cu",
			});
			assert.equal(res.name, "VCC");
			assert.equal(res.connection, "Connected to U1 Pin 8");
		});

		test("resolves segment net or diffItem net as fallback", () => {
			const segs = [
				{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, net: "+5V" },
			];
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
				const res = resolveCopperTraceIdentity({
					diffItem,
					center,
					closestPad: null,
					segments: segs,
					defaultLayer: "F.Cu",
				});
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
				const res = resolveCopperIdentity({
					diffItem,
					center: { x: 10, y: 10 },
					isChainOrOpenTrace: isOpen,
					pcbMetadata,
					defaultLayer: "F.Cu",
				});
				assert.equal(res.type, expectedType);
			}
		});

		test("returns null when no pad is nearby for closed shapes", () => {
			const res = resolveCopperIdentity({
				diffItem: {},
				center: { x: 99, y: 99 },
				isChainOrOpenTrace: false,
				pcbMetadata: makePcbMeta(),
				defaultLayer: "F.Cu",
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
			const cases = [
				[null, footprints],
				[{ x: 0, y: 0 }, []],
				[{ x: 50, y: 50 }, footprints],
			];
			for (const [center, fps] of cases) {
				assert.equal(resolveNonCopperIdentity(center, fps, "F.SilkS"), null);
			}
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
			assert.equal(res.name, "U3 (OpAmp)");
			assert.equal(res.type, "COMPONENT");
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
			const logs = generatePreciseAuditLog(
				targetMap,
				baseMap,
				pcbMetadata,
				"board-F_Cu.svg",
			);
			assert.equal(logs.length, 2);
			const checks = [
				[logs[0]?.action, "ADDED"],
				[logs[0]?.title, "added data trace"],
				[logs[1]?.action, "DELETED"],
				[logs[1]?.name, "C1 (100nF)"],
			];
			for (const [actual, expected] of checks) {
				assert.equal(actual, expected);
			}
		});

		test("skips unchanged items, worksheet frames, and duplicate diff indices", () => {
			const { targetMap, baseMap } = makeFilterMaps();
			const pcbMetadata = makePcbMeta([{ ref: "R1", layer: "F.Cu" }]);
			const logs = generatePreciseAuditLog(
				targetMap,
				baseMap,
				pcbMetadata,
				"board-F_Cu.svg",
			);

			assert.equal(logs.length, 1);
			assert.equal(logs[0].diffIdx, 12);
			assert.match(logs[0].detail, /Relocated by 2\.50 mm/);
			assert.deepEqual(
				generatePreciseAuditLog(null, null, pcbMetadata, "board-F_Cu.svg"),
				[],
			);
		});
	});
});
