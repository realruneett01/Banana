import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { embeddedLibSymbols } from "../../backend/src/engine/kicad-library.js";

const ECC83_SCH =
	"C:/Program Files/KiCad/10.0/share/kicad/demos/ecc83/ecc83-pp.kicad_sch";
const HAS_ECC83 = fs.existsSync(ECC83_SCH);
const EXPECTED = ["ECC83", "R", "C", "CP", "CONN_1", "CONN_2"];

describe("embeddedLibSymbols", () => {
	test("returns {} for text without lib_symbols", () => {
		assert.deepEqual(embeddedLibSymbols("(kicad_sch (version 1))"), {});
	});

	test("returns {} for malformed text", () => {
		assert.deepEqual(embeddedLibSymbols("(kicad_sch (lib_symbols"), {});
	});

	test("parses an inline symbol into the library symbol shape", () => {
		const text = `(kicad_sch (lib_symbols (symbol "proj:R"
			(property "Reference" "R") (property "Value" "R")
			(symbol "R_0_1" (rectangle (start -1 2) (end 1 -2)))
			(symbol "R_1_1"
				(pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
				(pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))))))`;
		const sym = embeddedLibSymbols(text)["proj:R"];
		assert.equal(sym.libId, "proj:R");
		assert.equal(sym.name, "R");
		assert.equal(sym.properties.Reference, "R");
		assert.deepEqual(
			sym.pins.map((p) => p.number),
			["1", "2"],
		);
		assert.equal(sym.graphics.length, 1);
	});
});

describe("ecc83-pp.kicad_sch import", { skip: !HAS_ECC83 }, () => {
	let server;
	let base;

	before(async () => {
		server = createApp().listen(0, "127.0.0.1");
		await new Promise((resolve) => server.once("listening", resolve));
		base = `http://127.0.0.1:${server.address().port}`;
	});

	after(() => server.close());

	test("returns embedded symbols with pins for every placed lib_id", async () => {
		const res = await fetch(`${base}/api/editor/import?kind=sch`, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: fs.readFileSync(ECC83_SCH, "utf8"),
		});
		assert.equal(res.status, 200);
		const { ir, symbols } = await res.json();
		for (const name of EXPECTED) {
			const sym = symbols[`ecc83-pp:${name}`];
			assert.ok(sym, `missing ${name}`);
			assert.ok(sym.pins.length > 0, `${name} has no pins`);
		}
		for (const part of ir.parts) {
			assert.ok(symbols[part.symbol], `part ${part.ref} needs a fetch`);
		}
	});
});
