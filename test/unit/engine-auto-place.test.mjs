import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { autoPlace } from "../../backend/src/engine/auto-place.js";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";

function makePart(ref, overrides = {}) {
	return {
		id: newId("part"),
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeNet(name, pinPairs = []) {
	return {
		id: newId("net"),
		name,
		pins: pinPairs.map(([partId, pin]) => ({ partId, pin })),
	};
}

function makeIR(parts = [], nets = []) {
	return {
		schemaVersion: 1,
		name: "TestCircuit",
		parts,
		nets,
		constraints: [],
	};
}

function checkOverlaps(parts, clearance) {
	for (let i = 0; i < parts.length; i++) {
		for (let j = i + 1; j < parts.length; j++) {
			const a = parts[i];
			const b = parts[j];
			const sizeA = a.props?.sizeMm ?? { w: 5, h: 5 };
			const sizeB = b.props?.sizeMm ?? { w: 5, h: 5 };
			const aXMin = a.placement.x - sizeA.w / 2 - clearance;
			const aXMax = a.placement.x + sizeA.w / 2 + clearance;
			const aYMin = a.placement.y - sizeA.h / 2 - clearance;
			const aYMax = a.placement.y + sizeA.h / 2 + clearance;
			const bXMin = b.placement.x - sizeB.w / 2;
			const bXMax = b.placement.x + sizeB.w / 2;
			const bYMin = b.placement.y - sizeB.h / 2;
			const bYMax = b.placement.y + sizeB.h / 2;
			const overlap =
				aXMin < bXMax - 1e-6 &&
				aXMax > bXMin + 1e-6 &&
				aYMin < bYMax - 1e-6 &&
				aYMax > bYMin + 1e-6;
			assert.equal(overlap, false, `Overlap between ${a.ref} and ${b.ref}`);
		}
	}
}

describe("autoPlace engine", () => {
	test("no overlaps on a 10-part IR", () => {
		const parts = Array.from({ length: 10 }, (_, i) => makePart(`R${i + 1}`));
		const ir = makeIR(parts);
		const result = autoPlace(ir, {
			boardW: 50,
			boardH: 50,
			gridMm: 2.54,
			marginMm: 2,
		});

		assert.equal(result.placed.length, 10);
		for (const part of result.ir.parts) {
			assert.ok(part.placement);
			assert.equal(part.placement.side, "F");
			assert.equal(part.placement.rot, 0);
		}
		checkOverlaps(result.ir.parts, 2.54);
	});

	test("existing placements untouched", () => {
		const u1 = makePart("U1", {
			placement: { x: 20, y: 20, rot: 0, side: "F" },
		});
		const r1 = makePart("R1");
		const r2 = makePart("R2");
		const ir = makeIR([u1, r1, r2]);

		const result = autoPlace(ir, { boardW: 50, boardH: 50 });
		const placedU1 = result.ir.parts.find((p) => p.ref === "U1");
		assert.deepEqual(placedU1.placement, { x: 20, y: 20, rot: 0, side: "F" });
		assert.equal(result.placed.includes(u1.id), false);
		assert.equal(result.placed.length, 2);
		checkOverlaps(result.ir.parts, 2.54);
	});

	test("input not mutated", () => {
		const parts = [makePart("R1"), makePart("R2")];
		const ir = makeIR(parts);
		const cloneBefore = structuredClone(ir);

		const result = autoPlace(ir, { boardW: 50, boardH: 50 });
		assert.deepEqual(ir, cloneBefore);
		assert.notEqual(result.ir, ir);
		assert.equal(ir.parts[0].placement, undefined);
		assert.ok(result.ir.parts[0].placement);
	});

	test("connected parts placed before unconnected ones", () => {
		const u1 = makePart("U1");
		const r1 = makePart("R1");
		const c1 = makePart("C1");
		const d1 = makePart("D1");

		const n1 = makeNet("NET_A", [
			[u1.id, "1"],
			[r1.id, "1"],
		]);
		const n2 = makeNet("NET_B", [
			[u1.id, "2"],
			[c1.id, "1"],
		]);
		const ir = makeIR([u1, r1, c1, d1], [n1, n2]);

		const result = autoPlace(ir, { boardW: 50, boardH: 50 });
		assert.equal(result.placed[0], u1.id);
		assert.equal(result.placed[1], c1.id);
		assert.equal(result.placed[2], r1.id);
		assert.equal(result.placed[3], d1.id);
	});

	test("determinism", () => {
		const parts = [makePart("R1"), makePart("R2"), makePart("C1")];
		const net = makeNet("NET1", [
			[parts[0].id, "1"],
			[parts[1].id, "1"],
		]);
		const ir = makeIR(parts, [net]);

		const res1 = autoPlace(ir, { boardW: 50, boardH: 50 });
		const res2 = autoPlace(ir, { boardW: 50, boardH: 50 });
		assert.deepEqual(res1, res2);
	});

	test("too-small board throws", () => {
		const part = makePart("U1", { props: { sizeMm: { w: 10, h: 10 } } });
		const ir = makeIR([part]);

		assert.throws(
			() => autoPlace(ir, { boardW: 4, boardH: 4, marginMm: 2 }),
			/auto-place: board too small for U1/,
		);
	});

	test("the result passes validateCircuitIR from circuit-ir.js", () => {
		const parts = Array.from({ length: 10 }, (_, i) => makePart(`R${i + 1}`));
		const net = makeNet("BUS", [
			[parts[0].id, "1"],
			[parts[1].id, "1"],
			[parts[2].id, "1"],
		]);
		const ir = makeIR(parts, [net]);

		const result = autoPlace(ir, { boardW: 60, boardH: 60 });
		const validation = validateCircuitIR(result.ir);
		assert.equal(validation.ok, true);
		assert.deepEqual(validation.errors, []);
	});

	test("every issue object built passes validateIssue", () => {
		const issue = {
			id: newId("issue"),
			source: "drc",
			severity: "info",
			itemIds: [newId("part")],
			message: "Placement successful",
			commit: "1234567890abcdef1234567890abcdef12345678",
			status: "open",
		};
		const validation = validateIssue(issue);
		assert.equal(validation.ok, true);
		assert.deepEqual(validation.errors, []);
	});
});
