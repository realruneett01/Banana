import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isId, kindOf, newId } from "../../backend/src/engine/ids.js";

const BOARD_KINDS = ["part", "net", "pin", "trace", "via", "zone"];
const META_KINDS = ["sheet", "issue", "sim", "env", "tool"];
const ALLOWED_KINDS = [...BOARD_KINDS, ...META_KINDS];

function buildMalformedSamples() {
	const uuid = "c7c00e6d-6202-4ec4-9467-33a3ea57cb76";
	const nonStrings = [null, undefined, 123, true, {}, [], ""];
	const prefixFails = ["part", "part_", `_${uuid}`, `unknown_${uuid}`];
	const uuidFails = [
		"part_not-a-valid-uuid",
		`part_${uuid}0`,
		"part_g7c00e6d-6202-4ec4-9467-33a3ea57cb76",
		"part_c7c00e6d_6202_4ec4_9467_33a3ea57cb76",
		` part_${uuid}`,
		`part_${uuid} `,
	];
	return [...nonStrings, ...prefixFails, ...uuidFails];
}

const MALFORMED_VALUES = buildMalformedSamples();
const BAD_KINDS = ["foo", "PART", "", 123, null, undefined, {}, []];

function assertAllEqual(items, fn, expected) {
	for (const item of items) {
		assert.equal(fn(item), expected);
	}
}

function assertKindFilterCases(id, kind) {
	const expectations = [
		[undefined, true],
		[kind, true],
		["other", false],
	];
	for (const [filter, expected] of expectations) {
		assert.equal(isId(id, filter), expected);
	}
}

describe("newId", () => {
	test("generates valid id for every allowed kind", () => {
		for (const kind of ALLOWED_KINDS) {
			const id = newId(kind);
			assert.equal(typeof id, "string");
			assert.equal(id.startsWith(`${kind}_`), true);
			assert.equal(isId(id, kind), true);
			assert.equal(kindOf(id), kind);
		}
	});

	test("generates distinct ids on subsequent calls", () => {
		assert.notEqual(newId("part"), newId("part"));
	});

	test("returns null for invalid kind inputs", () => {
		assertAllEqual(BAD_KINDS, newId, null);
	});
});

describe("isId", () => {
	const CASES = [
		[
			"validates id with and without matching kind filter",
			() => {
				for (const kind of ALLOWED_KINDS) {
					assertKindFilterCases(newId(kind), kind);
				}
			},
		],
		[
			"rejects mismatched kinds across allowed kinds",
			() => {
				const partId = newId("part");
				assertAllEqual(["net", "pin"], (kind) => isId(partId, kind), false);
			},
		],
		[
			"returns false for malformed id inputs",
			() => {
				assertAllEqual(MALFORMED_VALUES, isId, false);
			},
		],
	];

	for (const [name, run] of CASES) {
		test(name, run);
	}
});

describe("kindOf", () => {
	test("extracts correct kind for every allowed kind", () => {
		for (const kind of ALLOWED_KINDS) {
			assert.equal(kindOf(newId(kind)), kind);
		}
	});

	test("returns null for malformed and invalid id inputs", () => {
		assertAllEqual(MALFORMED_VALUES, kindOf, null);
	});
});

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/ids.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, ["isId", "kindOf", "newId"]);
	});
});
