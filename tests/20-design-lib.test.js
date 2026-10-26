import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findLibraryRoot,
	getFootprint,
	getSymbol,
	listSymbolIds,
	parseLibId,
	searchFootprints,
	searchSymbols,
} from "../backend/src/design/kicad-lib.js";
import { matchParen } from "../backend/src/design/sexp.js";
import { int, rng } from "./helpers.js";

const haveLibs = Boolean(
	findLibraryRoot("symbols") && findLibraryRoot("footprints"),
);
const skip = haveLibs
	? false
	: "KiCad symbol/footprint libraries not installed";

test("parseLibId accepts Library:Name and rejects traversal and junk", async (t) => {
	for (const ok of [
		"Device:R",
		"Regulator_Linear:AMS1117-3.3",
		"Connector_Generic:Conn_01x02",
		"A:b c",
	])
		await t.test(`accepts ${ok}`, () => assert.ok(parseLibId(ok)));
	const bad = [
		"",
		"Device",
		":R",
		"Device:",
		"../x:R",
		"Device:../../etc/passwd",
		"De/vice:R",
		"Device:R\u0000",
		"a:b\nc",
		"x".repeat(300),
		null,
		undefined,
		5,
		{},
		"Device:..",
		"Dev\\ice:R",
		"..:R",
		"Device:R;rm",
	];
	for (const b of bad)
		await t.test(`rejects ${JSON.stringify(b)?.slice(0, 30)}`, () =>
			assert.equal(parseLibId(b), null),
		);
});

test("matchParen is string-aware", async (t) => {
	const cases = [
		["(a)", 2],
		['(a ")")', 6],
		['(a "\\"(")', 8],
		["(a (b) (c (d)))", 14],
		["(a", -1],
		["((", -1],
	];
	for (const [text, expected] of cases)
		await t.test(JSON.stringify(text), () =>
			assert.equal(matchParen(text, 0), expected),
		);
});

test("symbols: pins, types, units, defaults", { skip }, async (t) => {
	await t.test("Device:R", () => {
		const s = getSymbol("Device:R");
		assert.deepEqual(
			s.pins.map((p) => [p.number, p.type]),
			[
				["1", "passive"],
				["2", "passive"],
			],
		);
		assert.equal(s.referencePrefix, "R");
		assert.deepEqual(s.units, [1]);
	});
	await t.test("Device:LED has anode/cathode named K and A", () => {
		const s = getSymbol("Device:LED");
		assert.deepEqual(s.pins.map((p) => `${p.number}${p.name}`).sort(), [
			"1K",
			"2A",
		]);
	});
	await t.test("regulator pin types", () => {
		const s = getSymbol("Regulator_Linear:AMS1117-3.3");
		const t2 = Object.fromEntries(s.pins.map((p) => [p.name, p.type]));
		assert.deepEqual(t2, { GND: "power_in", VO: "power_out", VI: "power_in" });
	});
	await t.test("multi-unit op-amp exposes all units", () => {
		const s = getSymbol("Amplifier_Operational:LM358");
		assert.deepEqual(s.units, [1, 2, 3]);
		assert.equal(s.pins.length, 8);
	});
	await t.test("extends is flattened onto its parent", () =>
		assert.ok(getSymbol("Device:Filter_EMI_C").pins.length >= 2),
	);
	await t.test("power symbols are recognised", () =>
		assert.equal(getSymbol("power:GND").isPower, true),
	);
	await t.test("unknown things are null, not exceptions", () => {
		for (const id of ["Device:NOPE", "nolib:R", "Device:../x", "bad"])
			assert.equal(getSymbol(id), null);
	});
});

test("every sampled library symbol embeds as balanced S-expression with pins (150 random symbols)", {
	skip,
}, async (t) => {
	const ids = listSymbolIds();
	assert.ok(ids.length > 5000);
	const r = rng(42);
	for (let i = 0; i < 150; i++) {
		const id = ids[int(r, 0, ids.length - 1)];
		await t.test(id, () => {
			const s = getSymbol(id);
			assert.ok(s, "symbol resolves");
			const text = s.embedText();
			assert.ok(text.startsWith(`(symbol "${id}"`), "renamed to Lib:Name");
			assert.equal(matchParen(text, 0), text.length - 1, "balanced");
			assert.ok(s.pins.length > 0 || s.isPower, "has pins");
			for (const p of s.pins)
				assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
		});
	}
});

test("search finds real parts and is ranked sensibly", { skip }, async (t) => {
	await t.test("exact-ish name first", () =>
		assert.equal(
			searchSymbols("ams1117 3.3")[0],
			"Regulator_Linear:AMS1117-3.3",
		),
	);
	await t.test("all terms must match", () =>
		assert.ok(
			searchSymbols("led").every((id) => id.toLowerCase().includes("led")),
		),
	);
	await t.test("empty query -> nothing", () =>
		assert.deepEqual(searchSymbols("   "), []),
	);
	await t.test("limit", () =>
		assert.equal(searchSymbols("r", { limit: 5 }).length, 5),
	);
	await t.test("footprints", () =>
		assert.ok(
			searchFootprints("R_0805").includes("Resistor_SMD:R_0805_2012Metric"),
		),
	);
});

test("footprints: pads, courtyard, smd flag", { skip }, async (t) => {
	await t.test("0805", () => {
		const f = getFootprint("Resistor_SMD:R_0805_2012Metric");
		assert.deepEqual(
			f.pads.map((p) => p.number),
			["1", "2"],
		);
		assert.equal(f.isSmd, true);
		assert.ok(f.bbox.maxX - f.bbox.minX > 3 && f.bbox.maxX - f.bbox.minX < 4);
	});
	await t.test("through-hole header", () => {
		const f = getFootprint(
			"Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
		);
		assert.equal(f.isSmd, false);
		assert.ok(f.pads.every((p) => p.type === "thru_hole"));
	});
	for (const bad of [
		"Resistor_SMD:NOPE",
		"../x:y",
		"Resistor_SMD:../../../etc/passwd",
		"nolib:R_0805",
	])
		await t.test(`rejects ${bad}`, () => assert.equal(getFootprint(bad), null));
});

test("footprint pads are read correctly across the library, quoted or bare style (300 random footprints)", {
	skip,
}, async (t) => {
	const fs = await import("node:fs");
	const path = await import("node:path");
	const root = findLibraryRoot("footprints");
	const all = [];
	for (const d of fs.readdirSync(root)) {
		if (!d.endsWith(".pretty")) continue;
		for (const f of fs.readdirSync(path.join(root, d)))
			if (f.endsWith(".kicad_mod"))
				all.push(`${d.slice(0, -7)}:${f.slice(0, -10)}`);
	}
	assert.ok(all.length > 5000);
	const r = rng(77);
	for (let i = 0; i < 300; i++) {
		const id = all[int(r, 0, all.length - 1)];
		await t.test(id, () => {
			const fp = getFootprint(id);
			assert.ok(fp, "resolves");
			const expected = (fp.text.match(/^\s*\(pad\s/gm) ?? []).length;
			assert.equal(fp.pads.length, expected, "pad count");
			for (const p of fp.pads)
				assert.ok(
					Number.isFinite(p.x) &&
						Number.isFinite(p.y) &&
						p.number !== undefined,
				);
			assert.ok(fp.bbox.maxX >= fp.bbox.minX && fp.bbox.maxY >= fp.bbox.minY);
		});
	}
});
