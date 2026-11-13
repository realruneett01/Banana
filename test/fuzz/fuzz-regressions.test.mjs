// Minimal repros of bugs the fuzz suite found; fast, so they run in the default npm test.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { applyPcbEdits } from "../../backend/src/engine/kicad-pcb-edit.js";
import { parse, serialize } from "../../backend/src/engine/sexpr.js";

function nested(head, depth) {
	return `(${head} ${"(".repeat(depth)}${")".repeat(depth)})`;
}

describe("fuzz regressions: deep nesting", () => {
	test("parse rejects nesting deeper than the limit with a plain Error", () => {
		assert.throws(
			() => parse(nested("kicad_pcb", 3000)),
			(err) => !(err instanceof RangeError) && /nesting/i.test(err.message),
		);
	});

	test("nesting at the limit still parses and serializes", () => {
		const tree = parse(nested("kicad_pcb", 999));
		assert.deepEqual(parse(serialize(tree)), tree);
	});

	const editors = {
		patchKicadText: (text) =>
			patchKicadText(text, {
				kind: "pcb",
				edits: [{ op: "move", ref: "R1", x: 1, y: 1 }],
			}),
		applyPcbEdits: (text) =>
			applyPcbEdits(text, [{ op: "addVia", net: "A", x: 1, y: 1 }]),
	};
	for (const [name, edit] of Object.entries(editors)) {
		test(`${name} returns a result object instead of a stack overflow`, () => {
			assert.equal(edit(nested("kicad_pcb", 3000)).ok, false);
		});
	}
});
