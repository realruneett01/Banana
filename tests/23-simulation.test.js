import assert from "node:assert/strict";
import { test } from "node:test";
import { findLibraryRoot } from "../backend/src/design/kicad-lib.js";
import { Design, emptyDesign } from "../backend/src/design/model.js";
import {
	buildNetlist,
	checkBounds,
	ngspiceAvailable,
	parseNgspiceOutput,
	parseValue,
	runTest,
	sanitizeSpiceText,
} from "../backend/src/design/simulate.js";
import { between, int, pick, rng } from "./helpers.js";

const haveLibs = Boolean(
	findLibraryRoot("symbols") && findLibraryRoot("footprints"),
);
const haveSpice = await ngspiceAvailable();
const skipLibs = haveLibs ? false : "KiCad libraries not installed";
const skip = !haveLibs
	? "KiCad libraries not installed"
	: haveSpice
		? false
		: "ngspice not installed";
const R = "Resistor_SMD:R_0805_2012Metric";
const C = "Capacitor_SMD:C_0805_2012Metric";

test("parseValue reads schematic-style values", async (t) => {
	const cases = [
		["10k", 1e4],
		["4k7", 4700],
		["4.7u", 4.7e-6],
		["100nF", 1e-7],
		["1M", 1e6],
		["1m", 1e-3],
		["1meg", 1e6],
		["2.2R", 2.2],
		["0.1", 0.1],
		["1e3", 1000],
		["10kΩ", 1e4],
		["220", 220],
		["1G", 1e9],
		["33p", 33e-12],
		["1.5k", 1500],
		["  47 k ", 47000],
		["6k8", 6800],
		["R22", null],
		["abc", null],
		["", null],
		[null, null],
		["1k2k", null],
	];
	for (const [raw, expected] of cases)
		await t.test(JSON.stringify(raw), () => {
			const v = parseValue(raw);
			if (expected === null) assert.equal(v, null);
			else
				assert.ok(
					Math.abs(v - expected) <= Math.abs(expected) * 1e-9,
					`${v} vs ${expected}`,
				);
		});
});

test("parseValue never throws and returns finite numbers or null (300 fuzz strings)", async (t) => {
	const r = rng(5);
	const alphabet = [..."0123456789.kKMmuµnpfTGRΩFHeE+- _/x"];
	for (let i = 0; i < 300; i++) {
		const s = Array.from({ length: int(r, 0, 10) }, () =>
			pick(r, alphabet),
		).join("");
		await t.test(JSON.stringify(s), () => {
			const v = parseValue(s);
			assert.ok(v === null || Number.isFinite(v));
		});
	}
});

test("SPICE sanitizer accepts circuits and rejects anything that could run code or read files", async (t) => {
	const good = [
		".subckt X a b\nR1 a b 1k\n.ends",
		"* comment\nC1 a b 1u",
		"R1 a b 1k\n+ extra",
		".model D1 D(IS=1e-14)",
		"Bout o 0 V = V(a)*2",
		".param x=3",
	];
	for (const g of good)
		await t.test(`accepts ${JSON.stringify(g).slice(0, 40)}`, () =>
			assert.doesNotThrow(() => sanitizeSpiceText(g)),
		);
	const bad = [
		".control\nshell rm -rf /\n.endc",
		".include /etc/passwd",
		".lib /etc/passwd x",
		".endc",
		".control",
		"shell id",
		"R1 a b 1k ; shell id",
		".subckt X a b\n.control\n.endc\n.ends",
		"!ls",
		".system ls",
		".csparam x=1",
		"X1 a b `id`",
		"R1 a b $(id)",
		"R1 a b 1k | cat",
		".subckt x a\nR1 a 0 1k\n.ends\n.include foo",
		"write out.raw",
		".option NOINIT\nsource /tmp/x",
		"\u0007R1 a b 1",
		".plot",
		".width out=300",
		"R1 a b 1k & id",
	];
	for (const b of bad)
		await t.test(`rejects ${JSON.stringify(b).slice(0, 40)}`, () =>
			assert.throws(() => sanitizeSpiceText(b)),
		);
	await t.test("too long", () =>
		assert.throws(() => sanitizeSpiceText("R1 a b 1\n".repeat(500))),
	);
});

test("checkBounds and output parsing", async (t) => {
	for (const [v, e, ok] of [
		[2.5, { approx: 2.5, tolerance: 0.01 }, true],
		[2.6, { approx: 2.5, tolerance: 0.01 }, false],
		[2.6, { approx: 2.5 }, true],
		[1, { min: 0.5, max: 1.5 }, true],
		[1, { min: 1.5 }, false],
		[1, { max: 0.5 }, false],
		[Number.NaN, { min: 0 }, false],
		[Number.POSITIVE_INFINITY, { max: 1 }, false],
		[0, { approx: 0 }, true],
	])
		await t.test(`${v} ${JSON.stringify(e)}`, () =>
			assert.equal(checkBounds(v, e), ok),
		);
	const m = parseNgspiceOutput(
		"v(n2) = 2.500000e+00\nm1                  =  1.234e-03 targ=1\nnoise\ni(vvin) = -5.0e-04\n",
	);
	assert.equal(m.get("v(n2)"), 2.5);
	assert.equal(m.get("m1"), 1.234e-3);
	assert.equal(m.get("i(vvin)"), -5e-4);
});

function divider(r1, r2) {
	const d = Design.from(emptyDesign("div"));
	d.addPart({ symbol: "Device:R", value: r1, footprint: R });
	d.addPart({ symbol: "Device:R", value: r2, footprint: R });
	d.connect("VIN", ["R1.1"]);
	d.connect("OUT", ["R1.2", "R2.1"]);
	d.connect("GND", ["R2.2"]);
	return d;
}

test("resistor dividers match V*R2/(R1+R2) for 40 random value pairs", {
	skip,
}, async (t) => {
	const r = rng(21);
	const E = [1, 1.5, 2.2, 3.3, 4.7, 6.8];
	const sfx = ["", "k", "M"];
	for (let i = 0; i < 40; i++) {
		const v1 = `${pick(r, E)}${pick(r, sfx)}`;
		const v2 = `${pick(r, E)}${pick(r, sfx)}`;
		const vin = Math.round(between(r, 1, 24) * 10) / 10;
		await t.test(`${v1}/${v2} @ ${vin} V`, async () => {
			const a = parseValue(v1);
			const b = parseValue(v2);
			const expected = (vin * b) / (a + b);
			const res = await runTest(divider(v1, v2), {
				name: "d",
				sources: [{ name: "VIN", pos: "VIN", value: vin }],
				expect: [{ measure: "v(OUT)", approx: expected, tolerance: 0.0005 }],
			});
			assert.equal(
				res.passed,
				true,
				JSON.stringify(res.measures) + (res.error ?? ""),
			);
		});
	}
});

test("a wrong expectation fails with the measured value reported", {
	skip,
}, async () => {
	const res = await runTest(divider("10k", "10k"), {
		name: "d",
		sources: [{ name: "VIN", pos: "VIN", value: 5 }],
		expect: [{ measure: "v(OUT)", min: 3, max: 4 }],
	});
	assert.equal(res.passed, false);
	assert.ok(Math.abs(res.measures[0].value - 2.5) < 1e-6);
	assert.equal(res.measures[0].pass, false);
});

test("source current: i(VIN) equals -V/(R1+R2)", { skip }, async () => {
	const res = await runTest(divider("1k", "1k"), {
		name: "i",
		sources: [{ name: "VIN", pos: "VIN", value: 10 }],
		expect: [{ measure: "i(VIN)", approx: -0.005, tolerance: 0.001 }],
	});
	assert.equal(res.passed, true, JSON.stringify(res));
});

test("RC charging: v(OUT) after one time constant is 63.2% of the step (transient)", {
	skip,
}, async (t) => {
	for (const [rv, cv] of [
		["1k", "1u"],
		["10k", "100n"],
		["4.7k", "470n"],
		["100", "10u"],
	]) {
		await t.test(`${rv} ${cv}`, async () => {
			const d = Design.from(emptyDesign("rc"));
			d.addPart({ symbol: "Device:R", value: rv, footprint: R });
			d.addPart({ symbol: "Device:C", value: cv, footprint: C });
			d.connect("IN", ["R1.1"]);
			d.connect("OUT", ["R1.2", "C1.1"]);
			d.connect("GND", ["C1.2"]);
			const tau = parseValue(rv) * parseValue(cv);
			const res = await runTest(d, {
				name: "rc",
				analysis: { type: "tran", step: tau / 500, stop: tau * 1.0001 },
				sources: [
					{
						name: "VS",
						pos: "IN",
						kind: "pulse",
						pulse: {
							v1: 0,
							v2: 5,
							delay: 0,
							rise: tau / 1e4,
							fall: tau / 1e4,
							width: tau * 10,
							period: tau * 20,
						},
					},
				],
				expect: [
					{
						measure: "v(OUT)",
						stat: "final",
						approx: 5 * (1 - Math.exp(-1)),
						tolerance: 0.02,
					},
				],
			});
			assert.equal(
				res.passed,
				true,
				JSON.stringify(res.measures) + (res.error ?? ""),
			);
		});
	}
});

test("RC low-pass: -3 dB at the corner frequency (AC)", { skip }, async () => {
	const d = Design.from(emptyDesign("lp"));
	d.addPart({ symbol: "Device:R", value: "1.59k", footprint: R });
	d.addPart({ symbol: "Device:C", value: "100n", footprint: C });
	d.connect("IN", ["R1.1"]);
	d.connect("OUT", ["R1.2", "C1.1"]);
	d.connect("GND", ["C1.2"]);
	const res = await runTest(d, {
		name: "lp",
		analysis: { type: "ac", start: 1, stop: 100000 },
		sources: [{ name: "VS", pos: "IN", value: 0, ac: 1 }],
		expect: [
			{
				measure: "v(OUT)",
				stat: "db",
				at: 1000,
				approx: -3.01,
				tolerance: 0.05,
			},
			{ measure: "v(OUT)", stat: "db", at: 10, min: -0.1, max: 0.01 },
			{ measure: "v(OUT)", stat: "db", at: 100000, max: -30 },
		],
	});
	assert.equal(
		res.passed,
		true,
		JSON.stringify(res.measures) + (res.error ?? ""),
	);
});

test("LED with a series resistor: current is physically sensible", {
	skip,
}, async () => {
	const d = Design.from(emptyDesign("led"));
	d.addPart({ symbol: "Device:R", value: "330", footprint: R });
	d.addPart({
		symbol: "Device:LED",
		value: "RED",
		footprint: "LED_SMD:LED_0805_2012Metric",
	});
	d.connect("+5V", ["R1.1"]);
	d.connect("N1", ["R1.2", "D1.A"]);
	d.connect("GND", ["D1.K"]);
	const res = await runTest(d, {
		name: "led",
		sources: [{ name: "VIN", pos: "+5V", value: 5 }],
		expect: [
			{ measure: "v(N1)", min: 1.5, max: 2.4 },
			{ measure: "i(VIN)", min: -0.012, max: -0.007 },
		],
	});
	assert.equal(
		res.passed,
		true,
		JSON.stringify(res.measures) + (res.error ?? ""),
	);
});

test("LDO macro-model regulates, drops out, and the load pulls it as expected", {
	skip,
}, async () => {
	const d = Design.from(emptyDesign("ldo"));
	d.addPart({
		symbol: "Regulator_Linear:AMS1117-3.3",
		footprint: "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
	});
	d.part("U1").sim = {
		ldo: { in: "3", gnd: "1", out: "2", vout: 3.3, dropout: 1.1 },
	};
	d.connect("VIN", ["U1.VI"]);
	d.connect("GND", ["U1.GND"]);
	d.connect("VOUT", ["U1.VO"]);
	const t5 = {
		name: "regulates",
		sources: [{ name: "VS", pos: "VIN", value: 5 }],
		loads: [{ pos: "VOUT", value: 330 }],
		expect: [{ measure: "v(VOUT)", approx: 3.3, tolerance: 0.01 }],
	};
	assert.equal((await runTest(d, t5)).passed, true);
	const t3 = {
		name: "dropout",
		sources: [{ name: "VS", pos: "VIN", value: 3 }],
		loads: [{ pos: "VOUT", value: 330 }],
		expect: [{ measure: "v(VOUT)", approx: 1.9, tolerance: 0.03 }],
	};
	const res = await runTest(d, t3);
	assert.equal(res.passed, true, JSON.stringify(res.measures));
});

test("parts without a model are reported by name, never silently ignored", {
	skip,
}, async () => {
	const d = Design.from(emptyDesign("m"));
	d.addPart({
		symbol: "Regulator_Linear:AMS1117-3.3",
		footprint: "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
	});
	d.connect("VIN", ["U1.VI"]);
	d.connect("GND", ["U1.GND"]);
	d.connect("VOUT", ["U1.VO"]);
	const res = await runTest(d, {
		name: "x",
		sources: [{ name: "VS", pos: "VIN", value: 5 }],
		expect: [{ measure: "v(VOUT)", min: 0 }],
	});
	assert.equal(res.passed, false);
	assert.match(res.error, /U1.*no SPICE model/);
	d.part("U1").sim = { exclude: true };
	assert.doesNotMatch(
		(
			await runTest(d, {
				name: "x",
				sources: [{ name: "VS", pos: "VIN", value: 5 }],
				expect: [{ measure: "v(VIN)", approx: 5 }],
			})
		).error ?? "",
		/no SPICE model/,
	);
});

test("test definitions are validated", { skip }, async (t) => {
	const base = {
		name: "t",
		sources: [{ name: "VIN", pos: "VIN", value: 5 }],
		expect: [{ measure: "v(OUT)", min: 0 }],
	};
	const cases = [
		[
			"unknown net in source",
			{ ...base, sources: [{ name: "VIN", pos: "NOPE", value: 5 }] },
			/no net named/,
		],
		[
			"unknown net in measure",
			{ ...base, expect: [{ measure: "v(NOPE)", min: 0 }] },
			/no net named|produced no value/,
		],
		[
			"bad measure syntax",
			{ ...base, expect: [{ measure: "vout", min: 0 }] },
			/must look like/,
		],
		[
			"bad source name",
			{ ...base, sources: [{ name: "1 bad", pos: "VIN", value: 5 }] },
			/Invalid source name/,
		],
		[
			"duplicate source",
			{
				...base,
				sources: [
					{ name: "A", pos: "VIN" },
					{ name: "a", pos: "OUT" },
				],
			},
			/Duplicate/,
		],
		[
			"non-numeric source value",
			{ ...base, sources: [{ name: "VIN", pos: "VIN", value: "five" }] },
			/not a number/,
		],
		["no expectations", { ...base, expect: [] }, /no expectations/],
		["bad analysis", { ...base, analysis: { type: "noise" } }, /analysis.type/],
		[
			"tran without stop",
			{ ...base, analysis: { type: "tran", step: "1u" } },
			/not a non-negative number/,
		],
		[
			"ac without at",
			{
				...base,
				analysis: { type: "ac", start: 1, stop: 100 },
				expect: [{ measure: "v(OUT)", stat: "db", min: 0 }],
			},
			/need "at"/,
		],
		[
			"load value",
			{ ...base, loads: [{ pos: "OUT", value: "-5" }] },
			/positive number/,
		],
		[
			"injection via net name in measure",
			{ ...base, expect: [{ measure: "v(OUT);shell id)", min: 0 }] },
			/must look like/,
		],
		[
			"injection via source name",
			{
				...base,
				sources: [
					{
						name: "X 0 0 1\n.control\nshell id\n.endc\nV",
						pos: "VIN",
						value: 5,
					},
				],
			},
			/Invalid source name/,
		],
	];
	for (const [name, test, re] of cases)
		await t.test(name, async () => {
			const res = await runTest(divider("10k", "10k"), test);
			assert.equal(res.passed, false);
			assert.match(res.error ?? "", re);
		});
});

test("netlists keep ground mapped to node 0 and name nodes safely", {
	skip: skipLibs,
}, () => {
	const d = divider("10k", "10k");
	const n = buildNetlist(d, {
		name: "t",
		sources: [{ name: "VIN", pos: "VIN", value: 5 }],
	});
	assert.ok(n.lines.some((l) => /^RR2 n2 0 /.test(l)));
	assert.ok(!n.lines.join("\n").includes("GND"));
});
