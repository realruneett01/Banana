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
	const pcbMetadata = {
		footprints: [{ ref: "C1", value: "100nF", layer: "F.Cu" }],
		pads: [],
		segments: [],
	};
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
			const nearest = findClosestPad({ x: 10.2, y: 10 }, pads);
			assert.equal(nearest.pin, "1");

			const custom = findClosestPad({ x: 14, y: 14 }, pads, 2.0);
			assert.equal(custom.refDes, "C1");
		});

		test("returns null for empty, null, or out-of-range inputs", () => {
			const cases = [
				{ center: null, pads: [{ x: 1, y: 1 }] },
				{ center: { x: 0, y: 0 }, pads: null },
				{ center: { x: 0, y: 0 }, pads: [] },
				{ center: { x: 0, y: 0 }, pads: [{ x: 5, y: 5 }] },
			];
			for (const { center, pads } of cases) {
				assert.equal(findClosestPad(center, pads), null);
			}
		});
	});

	describe("findClosestSegmentNet", () => {
		test("resolves net name from closest segment start, end, or midpoint", () => {
			const segments = [
				{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, net: "+3V3" },
				{ start: { x: 20, y: 0 }, end: { x: 20, y: 10 }, netName: "GND" },
			];
			assert.equal(findClosestSegmentNet({ x: 5, y: 0.5 }, segments), "+3V3");
			assert.equal(findClosestSegmentNet({ x: 20, y: 9.5 }, segments), "GND");
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
			const cases = [
				{ center: null, segments: [validSeg] },
				{ center: { x: 0, y: 0 }, segments: [] },
				{ center: { x: 0, y: 0 }, segments: [unconnSeg] },
				{ center: { x: 0, y: 0 }, segments: [{ net: "VCC" }] },
				{ center: { x: 50, y: 50 }, segments: [validSeg] },
			];
			for (const { center, segments } of cases) {
				assert.equal(findClosestSegmentNet(center, segments), null);
			}
		});
	});

	describe("findClosestFootprint", () => {
		test("finds nearest footprint or respects custom distance limit", () => {
			const footprints = [
				{ x: 50, y: 50, ref: "U1", value: "STM32" },
				{ x: 55, y: 50, ref: "R2", value: "1k" },
			];
			const nearest = findClosestFootprint({ x: 51, y: 50 }, footprints);
			assert.equal(nearest.ref, "U1");

			const custom = findClosestFootprint({ x: 60, y: 50 }, footprints, 12.0);
			assert.equal(custom.ref, "R2");
		});

		test("returns null for empty list, null center, or out-of-range footprint", () => {
			const cases = [
				{ center: null, footprints: [{ x: 0, y: 0 }] },
				{ center: { x: 0, y: 0 }, footprints: null },
				{ center: { x: 0, y: 0 }, footprints: [] },
				{ center: { x: 0, y: 0 }, footprints: [{ x: 20, y: 20 }] },
			];
			for (const { center, footprints } of cases) {
				assert.equal(findClosestFootprint(center, footprints), null);
			}
		});
	});

	describe("resolveCopperPadIdentity", () => {
		test("resolves component identity when footprint changes exist", () => {
			const footprints = [{ ref: "R1", value: "10k" }];
			const pad = { refDes: "R1", pin: "1", netName: "NET_A" };
			const fpChanges = new Set(["R1"]);

			const res = resolveCopperPadIdentity(pad, footprints, fpChanges, "F.Cu");
			assert.deepEqual(res, {
				name: "R1 (10k)",
				refDes: "R1",
				pin: "1",
				net: "NET_A",
				type: "COMPONENT",
				layer: "F.Cu",
				connection: "Pin 1 • NET_A",
			});
		});

		test("resolves trace identity when footprint is unchanged", () => {
			const footprints = [{ ref: "R1", value: "10k" }];
			const pad = { refDes: "R1", pin: "2", netName: "GND" };
			const fpChanges = new Set(["C1"]);

			const res = resolveCopperPadIdentity(pad, footprints, fpChanges, "F.Cu");
			assert.deepEqual(res, {
				name: "GND",
				refDes: "R1",
				type: "TRACE",
				layer: "F.Cu",
				connection: "Pad 2 of R1",
			});
		});

		test("falls back to default labels for missing pin and unconnected net", () => {
			const pad = { refDes: "TP1", netName: "unconnected" };
			const res = resolveCopperPadIdentity(pad, [], null, "B.Cu");
			assert.equal(res.name, "TP1");
			assert.equal(res.connection, "Pad");
			assert.equal(res.type, "COMPONENT");
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
			const fromSeg = resolveCopperTraceIdentity({
				diffItem: { netName: "OLD" },
				center: { x: 5, y: 0.5 },
				closestPad: null,
				segments: segs,
				defaultLayer: "F.Cu",
			});
			assert.equal(fromSeg.name, "+5V");

			const fromItem = resolveCopperTraceIdentity({
				diffItem: { net: "SIG1" },
				center: { x: 50, y: 50 },
				closestPad: null,
				segments: segs,
				defaultLayer: "F.Cu",
			});
			assert.equal(fromItem.name, "SIG1");
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
			const traceRes = resolveCopperIdentity({
				diffItem: { isClosedPath: false },
				center: { x: 10, y: 10 },
				isChainOrOpenTrace: true,
				pcbMetadata,
				defaultLayer: "F.Cu",
			});
			assert.equal(traceRes.type, "TRACE");

			const padRes = resolveCopperIdentity({
				diffItem: {},
				center: { x: 10, y: 10 },
				isChainOrOpenTrace: false,
				pcbMetadata,
				defaultLayer: "F.Cu",
			});
			assert.equal(padRes.type, "COMPONENT");
		});

		test("returns null when no pad is nearby for closed shapes", () => {
			const pcbMetadata = { footprints: [], pads: [], segments: [] };
			const res = resolveCopperIdentity({
				diffItem: {},
				center: { x: 99, y: 99 },
				isChainOrOpenTrace: false,
				pcbMetadata,
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
			assert.equal(resolveNonCopperIdentity(null, footprints, "F.SilkS"), null);
			assert.equal(
				resolveNonCopperIdentity({ x: 0, y: 0 }, [], "F.SilkS"),
				null,
			);
			assert.equal(
				resolveNonCopperIdentity({ x: 50, y: 50 }, footprints, "F.SilkS"),
				null,
			);
		});
	});

	describe("resolveSemanticIdentity", () => {
		test("resolves component from footprint refDes in metadata", () => {
			const pcbMetadata = {
				footprints: [{ ref: "U3", value: "OpAmp", layer: "F.Cu" }],
				pads: [],
				segments: [],
			};
			const res = resolveSemanticIdentity(
				{ refDes: "U3", layer: "board-F_Cu.svg" },
				pcbMetadata,
				true,
			);
			assert.equal(res.name, "U3 (OpAmp)");
			assert.equal(res.type, "COMPONENT");
		});

		test("falls back to layer graphics or traces when metadata is missing", () => {
			const resNoMeta = resolveSemanticIdentity(
				{ refDes: "R9", layer: "board-F_Cu.svg" },
				null,
				true,
			);
			assert.equal(resNoMeta.type, "TRACE");

			const resGraphic = resolveSemanticIdentity(
				{ name: "Logo_KiCad", layer: "Edge_Cuts.svg" },
				{ footprints: [], pads: [], segments: [] },
				false,
			);
			assert.equal(resGraphic.type, "GRAPHIC");
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
			assert.equal(logs[0].action, "ADDED");
			assert.equal(logs[0].title, "added data trace");
			assert.equal(logs[1].action, "DELETED");
			assert.equal(logs[1].name, "C1 (100nF)");
		});

		test("skips unchanged items, worksheet frames, and duplicate diff indices", () => {
			const { targetMap, baseMap } = makeFilterMaps();
			const pcbMetadata = {
				footprints: [{ ref: "R1", layer: "F.Cu" }],
				pads: [],
				segments: [],
			};
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
