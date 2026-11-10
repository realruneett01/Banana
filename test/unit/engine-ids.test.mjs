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
		const id1 = newId("part");
		const id2 = newId("part");
		assert.notEqual(id1, id2);
	});

	test("returns null for invalid kind inputs", () => {
		for (const badKind of BAD_KINDS) {
			assert.equal(newId(badKind), null);
		}
	});
});

describe("isId", () => {
	test("validates id with and without matching kind filter", () => {
		for (const kind of ALLOWED_KINDS) {
			const id = newId(kind);
			assert.equal(isId(id), true);
			assert.equal(isId(id, kind), true);
			assert.equal(isId(id, "other"), false);
		}
	});

	test("rejects mismatched kinds across allowed kinds", () => {
		const partId = newId("part");
		assert.equal(isId(partId, "net"), false);
		assert.equal(isId(partId, "pin"), false);
	});

	test("returns false for malformed id inputs", () => {
		for (const val of MALFORMED_VALUES) {
			assert.equal(isId(val), false);
		}
	});
});

describe("kindOf", () => {
	test("extracts correct kind for every allowed kind", () => {
		for (const kind of ALLOWED_KINDS) {
			const id = newId(kind);
			assert.equal(kindOf(id), kind);
		}
	});

	test("returns null for malformed and invalid id inputs", () => {
		for (const val of MALFORMED_VALUES) {
			assert.equal(kindOf(val), null);
		}
	});
});

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/ids.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, ["isId", "kindOf", "newId"]);
	});
});
