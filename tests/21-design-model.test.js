import assert from "node:assert/strict";
import { test } from "node:test";
import { findLibraryRoot } from "../backend/src/design/kicad-lib.js";
import {
	Design,
	DesignError,
	NET_NAME,
	emptyDesign,
} from "../backend/src/design/model.js";
import { int, pick, rng } from "./helpers.js";

const skip =
	findLibraryRoot("symbols") && findLibraryRoot("footprints")
		? false
		: "KiCad libraries not installed";
const R = "Resistor_SMD:R_0805_2012Metric";
const fresh = () => Design.from(emptyDesign("t"));
const throwsDesign = (fn, re) =>
	assert.throws(
		fn,
		(e) => e instanceof DesignError && (!re || re.test(e.message)),
		`expected DesignError ${re ?? ""}`,
	);

test("parts: references, defaults and validation", { skip }, async (t) => {
	await t.test("auto references count up per prefix", () => {
		const d = fresh();
		assert.equal(d.addPart({ symbol: "Device:R", footprint: R }).ref, "R1");
		assert.equal(d.addPart({ symbol: "Device:R", footprint: R }).ref, "R2");
		assert.equal(d.addPart({ symbol: "Device:C" }).ref, "C1");
	});
	await t.test("reference gaps are reused", () => {
		const d = fresh();
		for (let i = 0; i < 3; i++) d.addPart({ symbol: "Device:R" });
		d.removePart("R2");
		assert.equal(d.addPart({ symbol: "Device:R" }).ref, "R2");
	});
	for (const [label, args, re] of [
		["unknown symbol", { symbol: "Device:NOPE" }, /not found/],
		["traversal symbol", { symbol: "../etc:passwd" }, /not found/],
		["power symbol", { symbol: "power:GND" }, /power symbol/],
		["bad ref", { symbol: "Device:R", ref: "r 1" }, /Invalid reference/],
		["lowercase ref", { symbol: "Device:R", ref: "r1" }, /Invalid reference/],
		[
			"unknown footprint",
			{ symbol: "Device:R", footprint: "Resistor_SMD:NOPE" },
			/not found/,
		],
		[
			"footprint without the symbol's pads",
			{ symbol: "Regulator_Linear:AMS1117-3.3", footprint: R },
			/no pad/,
		],
	])
		await t.test(label, () => throwsDesign(() => fresh().addPart(args), re));
	await t.test("duplicate reference", () => {
		const d = fresh();
		d.addPart({ symbol: "Device:R", ref: "R5" });
		throwsDesign(
			() => d.addPart({ symbol: "Device:R", ref: "R5" }),
			/already exists/,
		);
	});
	await t.test(
		"a failed add leaves the design unchanged only if validation ran first (symbol)",
		() => {
			const d = fresh();
			throwsDesign(() => d.addPart({ symbol: "Device:NOPE" }));
			assert.equal(d.parts.length, 0);
		},
	);
	await t.test("long values are truncated", () =>
		assert.equal(
			fresh().addPart({ symbol: "Device:R", value: "x".repeat(500) }).value
				.length,
			80,
		),
	);
});

test("pin resolution: by number, by name, ambiguity, errors", {
	skip,
}, async (t) => {
	const d = fresh();
	d.addPart({ symbol: "Regulator_Linear:AMS1117-3.3" });
	d.addPart({ symbol: "Amplifier_Operational:LM358" });
	await t.test("by number", () => assert.equal(d.resolvePin("U1.2"), "U1.2"));
	await t.test("by unique name, case-insensitive", () =>
		assert.equal(d.resolvePin("U1.vi"), "U1.3"),
	);
	await t.test("ambiguous name reports candidates", () => {
		try {
			d.resolvePin("U2.+");
			assert.fail("should throw");
		} catch (e) {
			assert.ok(e instanceof DesignError);
			assert.match(e.message, /ambiguous/);
			assert.ok(e.details.candidates.length >= 2);
		}
	});
	for (const bad of [
		"U1",
		"U1.",
		".1",
		"U9.1",
		"U1.NOPE",
		"1.U1",
		"u1.1",
		"U1.1.2",
		"",
		"U1 .1",
	])
		await t.test(`rejects ${JSON.stringify(bad)}`, () =>
			throwsDesign(() => d.resolvePin(bad)),
		);
});

test("connect / disconnect / move / rename", { skip }, async (t) => {
	const mk = () => {
		const d = fresh();
		for (let i = 0; i < 3; i++) d.addPart({ symbol: "Device:R", footprint: R });
		return d;
	};
	await t.test("connect creates a sorted net", () => {
		const d = mk();
		d.connect("A", ["R2.1", "R1.2", "R1.1"]);
		assert.deepEqual(d.data.nets.A.pins, ["R1.1", "R1.2", "R2.1"]);
	});
	await t.test("a pin cannot silently change nets", () => {
		const d = mk();
		d.connect("A", ["R1.1"]);
		throwsDesign(() => d.connect("B", ["R1.1"]), /already on net/);
		d.connect("B", ["R1.1"], { move: true });
		assert.equal(d.data.nets.A, undefined, "emptied net removed");
		assert.deepEqual(d.data.nets.B.pins, ["R1.1"]);
	});
	await t.test("power nets are detected from their names", () => {
		const d = mk();
		d.connect("GND", ["R1.1"]);
		d.connect("+3V3", ["R2.1"]);
		d.connect("SIG", ["R3.1"]);
		assert.deepEqual(
			[d.data.nets.GND.power, d.data.nets["+3V3"].power, d.data.nets.SIG.power],
			[true, true, undefined],
		);
	});
	await t.test("connect is idempotent", () => {
		const d = mk();
		d.connect("A", ["R1.1", "R1.1"]);
		d.connect("A", ["R1.1"]);
		assert.deepEqual(d.data.nets.A.pins, ["R1.1"]);
	});
	await t.test("disconnect drops empty nets", () => {
		const d = mk();
		d.connect("A", ["R1.1", "R2.1"]);
		d.disconnect(["R1.1"]);
		d.disconnect(["R2.1"]);
		assert.equal(d.data.nets.A, undefined);
	});
	await t.test("removing a part cleans nets and no-connects", () => {
		const d = mk();
		d.connect("A", ["R1.1", "R2.1"]);
		d.markNoConnect("R1.2");
		d.removePart("R1");
		assert.deepEqual(d.data.nets.A.pins, ["R2.1"]);
		assert.deepEqual(d.data.noConnect, []);
	});
	await t.test("no-connect and connect are mutually exclusive", () => {
		const d = mk();
		d.markNoConnect("R1.1");
		d.connect("A", ["R1.1"]);
		assert.deepEqual(d.data.noConnect, []);
		throwsDesign(() => d.markNoConnect("R1.1"), /connected/);
	});
	await t.test("rename net", () => {
		const d = mk();
		d.connect("A", ["R1.1"]);
		d.renameNet("A", "B");
		assert.ok(d.data.nets.B && !d.data.nets.A);
		throwsDesign(() => d.renameNet("A", "C"), /No net/);
		d.connect("C", ["R2.1"]);
		throwsDesign(() => d.renameNet("B", "C"), /already exists/);
	});
	await t.test("empty / non-array pins", () => {
		throwsDesign(() => mk().connect("A", []));
		throwsDesign(() => mk().connect("A", "R1.1"));
	});
});

test("net names: accepted and rejected shapes (generated)", {
	skip,
}, async (t) => {
	for (const ok of [
		"A",
		"GND",
		"+3V3",
		"VCC_5",
		"N1",
		"sig.a",
		"a-b",
		"a/b",
		"x".repeat(40),
		"5V",
	])
		await t.test(`accepts ${ok}`, () => assert.ok(NET_NAME.test(ok)));
	for (const bad of [
		"",
		"-a",
		"a b",
		'a"b',
		"a(b",
		"a\nb",
		"a;b",
		"x".repeat(41),
		"é",
		"a\\b",
		"a'b",
		"/",
		"a,b",
		"a#b",
	])
		await t.test(`rejects ${JSON.stringify(bad)}`, () =>
			assert.ok(!NET_NAME.test(bad)),
		);
});

test("placement, board and routing inputs are bounded", { skip }, async (t) => {
	const d = fresh();
	d.addPart({ symbol: "Device:R", footprint: R });
	d.addPart({ symbol: "Device:R", footprint: R });
	d.connect("A", ["R1.1", "R2.1"]);
	for (const [x, y, rot] of [
		[1e9, 0, 0],
		[0, NaN, 0],
		[Infinity, 0, 0],
		[0, 0, 45],
		[0, 0, 360],
		["1", 0, 0],
	])
		await t.test(`place(${x},${y},${rot})`, () =>
			throwsDesign(() => d.place("R1", x, y, rot)),
		);
	await t.test("place ok", () => {
		d.place("R1", 10.0004, 20, 90);
		assert.deepEqual(d.part("R1").at, { x: 10, y: 20, rot: 90 });
	});
	for (const [w, h] of [
		[1, 1],
		[2000, 10],
		[10, 0],
		[NaN, 10],
	])
		await t.test(`board ${w}x${h}`, () => throwsDesign(() => d.setBoard(w, h)));
	await t.test("board null resets", () => {
		d.setBoard(30, 20);
		d.setBoard(null);
		assert.equal(d.data.board, null);
	});
	for (const bad of [
		{
			net: "NOPE",
			points: [
				[0, 0],
				[1, 1],
			],
		},
		{
			net: "A",
			layer: "In1.Cu",
			points: [
				[0, 0],
				[1, 1],
			],
		},
		{
			net: "A",
			width: 0.01,
			points: [
				[0, 0],
				[1, 1],
			],
		},
		{ net: "A", points: [[0, 0]] },
		{
			net: "A",
			points: [
				[0, 0],
				["a", 1],
			],
		},
		{ net: "A", points: "x" },
	])
		await t.test(`track ${JSON.stringify(bad).slice(0, 50)}`, () =>
			throwsDesign(() => d.addTrack(bad)),
		);
	await t.test("valid track and via", () => {
		assert.equal(
			d.addTrack({
				net: "A",
				points: [
					[0, 0],
					[5, 0],
				],
			}),
			0,
		);
		d.addVia({ net: "A", x: 1, y: 1 });
		assert.equal(d.data.tracks.length, 1);
		assert.equal(d.data.vias.length, 1);
		throwsDesign(() =>
			d.addVia({ net: "A", x: 0, y: 0, size: 0.3, drill: 0.4 }),
		);
		d.removeTrack(0);
		throwsDesign(() => d.removeTrack(0));
	});
});

test("tests: names are validated and replaced by name", { skip }, async (t) => {
	const d = fresh();
	for (const bad of [
		null,
		{},
		{ name: "" },
		{ name: "../x" },
		{ name: "x".repeat(61) },
		{ name: "a\nb" },
	])
		await t.test(JSON.stringify(bad), () => throwsDesign(() => d.addTest(bad)));
	d.addTest({ name: "t1", expect: [] });
	d.addTest({ name: "t1", expect: [{ measure: "v(A)" }] });
	assert.equal(d.data.tests.length, 1);
	assert.equal(d.data.tests[0].expect.length, 1);
});

test("random edit sequences keep every invariant (300 sequences)", {
	skip,
}, async (t) => {
	const SYMS = [
		"Device:R",
		"Device:C",
		"Device:LED",
		"Device:D",
		"Connector_Generic:Conn_01x02",
		"Device:Q_NPN_BCE",
	];
	for (let seed = 1; seed <= 300; seed++) {
		await t.test(`seed ${seed}`, () => {
			const r = rng(seed);
			const d = fresh();
			for (let i = 0; i < int(r, 5, 30); i++) {
				const refs = d.parts.map((p) => p.ref);
				const roll = r();
				try {
					if (roll < 0.35 || refs.length < 2)
						d.addPart({ symbol: pick(r, SYMS) });
					else if (roll < 0.75) {
						const pins = Array.from({ length: int(r, 1, 3) }, () => {
							const part = d.part(pick(r, refs));
							return `${part.ref}.${pick(r, d.symbolOf(part).pins).number}`;
						});
						d.connect(pick(r, ["A", "B", "C", "GND", "+5V", "N1"]), pins, {
							move: r() < 0.5,
						});
					} else if (roll < 0.85) d.disconnect([`${pick(r, refs)}.1`]);
					else if (roll < 0.92) d.removePart(pick(r, refs));
					else
						d.place(
							pick(r, refs),
							int(r, 0, 100),
							int(r, 0, 100),
							pick(r, [0, 90, 180, 270]),
						);
				} catch (e) {
					assert.ok(
						e instanceof DesignError,
						`only DesignErrors are expected, got ${e.stack}`,
					);
				}
			}
			// invariants
			const refs = new Set(d.parts.map((p) => p.ref));
			assert.equal(refs.size, d.parts.length, "unique refs");
			const seen = new Map();
			for (const [name, net] of Object.entries(d.data.nets)) {
				assert.ok(NET_NAME.test(name));
				for (const pin of net.pins) {
					assert.ok(
						refs.has(pin.split(".")[0]),
						`${pin} refers to a removed part`,
					);
					assert.ok(
						!seen.has(pin),
						`${pin} is on both ${seen.get(pin)} and ${name}`,
					);
					seen.set(pin, name);
				}
			}
			for (const pin of d.data.noConnect)
				assert.ok(!seen.has(pin), `${pin} is both no-connect and connected`);
			assert.deepEqual(
				JSON.parse(JSON.stringify(d.data)),
				d.data,
				"JSON round-trips",
			);
		});
	}
});
