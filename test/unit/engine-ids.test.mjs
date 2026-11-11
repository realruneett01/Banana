import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isId, kindOf, newId } from "../../backend/src/engine/ids.js";

const ALLOWED_KINDS = [
	"part",
	"net",
	"pin",
	"trace",
	"via",
	"zone",
	"sheet",
	"issue",
	"sim",
	"env",
	"tool",
];

const MALFORMED_VALUES = [
	null,
	undefined,
	123,
	true,
	{},
	[],
	"",
	"part",
	"part_",
	"_c7c00e6d-6202-4ec4-9467-33a3ea57cb76",
	"unknown_c7c00e6d-6202-4ec4-9467-33a3ea57cb76",
	"part_not-a-valid-uuid",
	"part_c7c00e6d-6202-4ec4-9467-33a3ea57cb760",
	"part_g7c00e6d-6202-4ec4-9467-33a3ea57cb76",
	"part_c7c00e6d_6202_4ec4_9467_33a3ea57cb76",
	" part_c7c00e6d-6202-4ec4-9467-33a3ea57cb76",
	"part_c7c00e6d-6202-4ec4-9467-33a3ea57cb76 ",
];

const BAD_KINDS = ["foo", "PART", "", 123, null, undefined, {}, []];

function assertAllEqual(items, fn, expected) {
	for (const item of items) {
		assert.equal(fn(item), expected);
	}
}

function assertKindFilterCases(id, kind) {
	const CASES = [
		{ filter: undefined, expected: true },
		{ filter: kind, expected: true },
		{ filter: "other", expected: false },
	];
	for (const { filter, expected } of CASES) {
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
	test("validates id with and without matching kind filter", () => {
		for (const kind of ALLOWED_KINDS) {
			assertKindFilterCases(newId(kind), kind);
		}
	});

	test("rejects mismatched kinds across allowed kinds", () => {
		const partId = newId("part");
		const CASES = ["net", "pin"];
		for (const otherKind of CASES) {
			assert.equal(isId(partId, otherKind), false);
		}
	});

	test("returns false for malformed id inputs", () => {
		assertAllEqual(MALFORMED_VALUES, isId, false);
	});
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
