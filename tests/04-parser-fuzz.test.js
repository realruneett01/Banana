import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
	parseKiCadBoard,
	parsePcbMetadata,
	parseSExpr,
	toBoardAbsolute,
} from "../backend/src/kicad-pcb-parser.js";
import { between, int, pick, rng, tmpDir } from "./helpers.js";

const dir = tmpDir();
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name, content) => {
	const p = path.join(dir, name);
	fs.writeFileSync(p, content);
	return p;
};

const n = (v) => Number(v.toFixed(4));

function genBoard(seed) {
	const r = rng(seed);
	const nFp = int(r, 0, 8);
	const fps = [];
	let text = `(kicad_pcb (version 20221018) (generator test)\n (general (thickness 1.6))\n (layers (0 "F.Cu" signal) (31 "B.Cu" signal))\n (net 0 "") (net 1 "VCC") (net 2 "GND")\n`;
	for (let i = 0; i < nFp; i++) {
		const layer = pick(r, ["F.Cu", "B.Cu"]);
		const at = {
			x: n(between(r, 0, 200)),
			y: n(between(r, 0, 200)),
			rot: pick(r, [0, 90, 180, 270, 45, 30, 0]),
		};
		const nPads = int(r, 0, 6);
		const pads = [];
		let padText = "";
		for (let k = 0; k < nPads; k++) {
			const lp = { x: n(between(r, -5, 5)), y: n(between(r, -5, 5)) };
			const net = pick(r, [1, 2]);
			pads.push({ number: String(k + 1), ...lp, net });
			padText += `  (pad "${k + 1}" smd rect (at ${lp.x} ${lp.y}) (size 1 1) (layers "${layer}") (net ${net} "${net === 1 ? "VCC" : "GND"}"))\n`;
		}
		fps.push({ ref: `R${i + 1}`, layer, at, pads });
		text += ` (footprint "Lib:Fp${i}" (layer "${layer}") (at ${at.x} ${at.y}${at.rot ? ` ${at.rot}` : ""})\n  (fp_text reference "R${i + 1}" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))\n  (fp_text value "v${i}" (at 0 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))\n${padText} )\n`;
	}
	const nSeg = int(r, 0, 10);
	const segs = [];
	for (let i = 0; i < nSeg; i++) {
		const s = {
			sx: n(between(r, 0, 200)),
			sy: n(between(r, 0, 200)),
			ex: n(between(r, 0, 200)),
			ey: n(between(r, 0, 200)),
			net: pick(r, [1, 2]),
		};
		segs.push(s);
		text += ` (segment (start ${s.sx} ${s.sy}) (end ${s.ex} ${s.ey}) (width 0.25) (layer "F.Cu") (net ${s.net}))\n`;
	}
	return { text: `${text})\n`, fps, segs };
}

test("parseKiCadBoard recovers generated boards exactly (300 random boards)", async (t) => {
	for (let seed = 1; seed <= 300; seed++) {
		await t.test(`seed ${seed}`, () => {
			const { text, fps, segs } = genBoard(seed);
			const board = parseKiCadBoard(write(`b${seed}.kicad_pcb`, text));
			assert.equal(board.footprints.length, fps.length, "footprint count");
			assert.equal(board.tracks.length, segs.length, "segment count");
			fps.forEach((fp, i) => {
				const parsed = board.footprints[i];
				assert.equal(parsed.reference?.text, fp.ref);
				assert.equal(parsed.layer, fp.layer);
				assert.ok(
					Math.abs(parsed.at.x - fp.at.x) < 1e-9 &&
						Math.abs(parsed.at.y - fp.at.y) < 1e-9,
				);
				assert.equal(parsed.pads.length, fp.pads.length, `${fp.ref} pad count`);
				fp.pads.forEach((pad, k) => {
					const abs = toBoardAbsolute(parsed, pad.x, pad.y);
					assert.ok(
						Math.abs(parsed.pads[k].absAt.x - abs.x) < 1e-6,
						`${fp.ref}.${pad.number} abs x`,
					);
					assert.ok(
						Math.abs(parsed.pads[k].absAt.y - abs.y) < 1e-6,
						`${fp.ref}.${pad.number} abs y`,
					);
				});
			});
		});
	}
});

test("toBoardAbsolute geometry invariants (300 random placements)", async (t) => {
	const r = rng(77);
	for (let i = 0; i < 300; i++) {
		const fp = {
			at: {
				x: between(r, -100, 100),
				y: between(r, -100, 100),
				rotation: pick(r, [0, 90, 180, 270, between(r, 0, 360)]),
			},
			layer: pick(r, ["F.Cu", "B.Cu"]),
		};
		const p = { x: between(r, -10, 10), y: between(r, -10, 10) };
		await t.test(`case ${i}`, () => {
			const a = toBoardAbsolute(fp, p.x, p.y);
			// Distance from the footprint origin is preserved by rotation/mirroring.
			assert.ok(
				Math.abs(
					Math.hypot(a.x - fp.at.x, a.y - fp.at.y) - Math.hypot(p.x, p.y),
				) < 1e-9,
				"radius preserved",
			);
			assert.ok(a.rotation >= 0 && a.rotation < 360, "rotation normalised");
			const origin = toBoardAbsolute(fp, 0, 0);
			assert.ok(
				Math.abs(origin.x - fp.at.x) < 1e-12 &&
					Math.abs(origin.y - fp.at.y) < 1e-12,
				"origin maps to footprint position",
			);
		});
	}
});

const JUNK_FRAGMENTS = [
	"(",
	")",
	'"',
	"\\",
	"(kicad_pcb",
	"(footprint",
	"(pad",
	"(at 1 2)",
	"(segment (start 1",
	"(net",
	"\n",
	"\t",
	"é",
	"\u0000",
	"1e999",
	"NaN",
	"-0",
	"(layers",
	"(zone",
	"(via",
	"(group",
	"(dimension",
	"(gr_line",
	"(fp_text",
];

test("parser never hangs or throws non-Error on garbage (400 mutated/garbage inputs)", async (t) => {
	const base = genBoard(5).text;
	for (let seed = 0; seed < 400; seed++) {
		await t.test(`garbage ${seed}`, () => {
			const r = rng(1000 + seed);
			let text;
			const mode = seed % 4;
			if (mode === 0)
				text = Array.from({ length: int(r, 1, 40) }, () =>
					pick(r, JUNK_FRAGMENTS),
				).join(pick(r, ["", " "]));
			else if (mode === 1) text = base.slice(0, int(r, 0, base.length));
			else if (mode === 2) {
				const i = int(r, 0, base.length - 1);
				text =
					base.slice(0, i) +
					pick(r, JUNK_FRAGMENTS) +
					base.slice(i + int(r, 0, 5));
			} else
				text = `(kicad_pcb ${Array.from({ length: int(r, 0, 30) }, () => pick(r, JUNK_FRAGMENTS)).join(" ")})`;
			const started = performance.now();
			try {
				parseKiCadBoard(write("fuzz.kicad_pcb", text));
			} catch (err) {
				assert.ok(err instanceof Error, "throws only Error instances");
			}
			assert.ok(performance.now() - started < 2000, "finishes quickly");
			// Regex fallback path must never throw.
			assert.doesNotThrow(() => parsePcbMetadata(text));
		});
	}
});

test("parseSExpr basics", async (t) => {
	const cases = [
		["(a)", ["a"]],
		["(a b c)", ["a", "b", "c"]],
		["(a (b c) d)", ["a", ["b", "c"], "d"]],
		['(a "b c")', ["a", "b c"]],
		['(a "b\\"c")', ["a", 'b"c']],
		["  (a)", ["a"]],
		["()", []],
		["(a 1.50)", ["a", "1.50"]],
	];
	for (const [input, expected] of cases)
		await t.test(JSON.stringify(input), () =>
			assert.deepEqual(parseSExpr(input), expected),
		);
	for (const input of ["", "abc", "   ", ")"])
		await t.test(`non-list ${JSON.stringify(input)}`, () =>
			assert.equal(parseSExpr(input), null),
		);
});

test("rejects files that are not kicad_pcb", async (t) => {
	for (const text of ["", "(kicad_sch)", "hello", "(foo (kicad_pcb))"]) {
		await t.test(JSON.stringify(text), () =>
			assert.throws(
				() => parseKiCadBoard(write("x.kicad_pcb", text)),
				/Invalid .kicad_pcb/,
			),
		);
	}
});

test("regex metadata fallback matches the generator", async (t) => {
	for (let seed = 1; seed <= 60; seed++) {
		await t.test(`seed ${seed}`, () => {
			const { text, fps, segs } = genBoard(seed);
			const meta = parsePcbMetadata(text);
			assert.equal(meta.segments.length, segs.length);
			assert.equal(meta.footprints.length, fps.length);
		});
	}
});
