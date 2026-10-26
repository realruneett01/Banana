import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getSymbol } from "./kicad-lib.js";
import { isGroundName } from "./model.js";

const exec = promisify(execFile);

// ---- values ----
const SUFFIX = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

/**
 * Parses component values the way people write them on schematics: "10k", "4k7", "4.7u", "100nF",
 * "1M" (mega, as KiCad shows it), "1m" (milli), "2.2R". Returns a number in base units or null.
 */
export function parseValue(raw) {
	let s = String(raw ?? "").trim().replace(/[ΩΩ]/g, "R").replace(/\s+/g, "");
	if (!s) return null;
	s = s.replace(/(?<=[0-9.])(meg)(?![a-z])/i, "M");
	let m = /^([+-]?\d+)([TGMkKmuµnpfR])(\d+)(?:[FHVAR]?)$/.exec(s); // 4k7 notation
	if (m) {
		const mult = m[2] === "R" ? 1 : SUFFIX[m[2]];
		return Number(`${m[1]}.${m[3]}`) * mult;
	}
	m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([TGMkKmuµnpf]?)(?:[A-Za-z]*)$/.exec(s);
	if (!m) return null;
	const n = Number(m[1]) * (m[2] ? SUFFIX[m[2]] : 1);
	return Number.isFinite(n) ? n : null;
}

const num = (n) => Number(n.toPrecision(12)).toExponential();

// ---- SPICE text safety ----
const ALLOWED_DOT = /^\.(subckt|ends|model|param|func|endfunc)\b/i;
const ELEMENT = /^[RCLDQMJVIEFGHBXSWKT]/i;

/**
 * User/AI-supplied SPICE (custom sub-circuits) is untrusted: ngspice can read files and run shell
 * commands from control sections. Only plain circuit statements are accepted.
 */
export function sanitizeSpiceText(text) {
	const lines = String(text ?? "").split(/\r?\n/);
	if (lines.length > 400) throw new Error("SPICE model too long (max 400 lines)");
	const out = [];
	for (const [i, raw] of lines.entries()) {
		const line = raw.trim();
		if (!line || line.startsWith("*") || line.startsWith("+")) {
			if (/[\u0000-\u0008\u000e-\u001f]/.test(line)) throw new Error(`Control character in SPICE text, line ${i + 1}`);
			out.push(line);
			continue;
		}
		if (line.startsWith(".")) {
			if (!ALLOWED_DOT.test(line)) throw new Error(`SPICE directive not allowed on line ${i + 1}: ${line.split(/\s/)[0]}`);
		} else if (!ELEMENT.test(line)) {
			throw new Error(`Unrecognised SPICE statement on line ${i + 1}`);
		}
		if (/\b(shell|system|exec|source|write|wrdata|load|codemodel|osdi|include|lib)\b\s*[ =]/i.test(line) || /[`;$|&<>]/.test(line)) throw new Error(`Disallowed content on SPICE line ${i + 1}`);
		out.push(line);
	}
	return out.join("\n");
}

const MODELS = {
	LED: ".model LEDGEN D(IS=1e-20 N=1.8 RS=3 CJO=10p BV=5 IBV=10u)",
	SWITCHING: ".model DSW D(IS=2.52n N=1.752 RS=0.568 CJO=4p BV=100 IBV=100n TT=20n)",
	SCHOTTKY: ".model DSCH D(IS=1e-6 N=1.05 RS=0.05 CJO=50p BV=40 IBV=100u)",
	RECTIFIER: ".model DREC D(IS=2.9n N=1.9 RS=0.04 CJO=25p BV=100 IBV=5u TT=3u)",
	NPN: ".model NPNGEN NPN(IS=6.7f BF=416 VAF=74 IKF=0.07 RB=10 CJE=4.5p CJC=3.6p TF=0.3n TR=40n)",
	PNP: ".model PNPGEN PNP(IS=1.4f BF=180 VAF=18 IKF=0.08 RB=10 CJE=14p CJC=9p TF=0.5n TR=40n)",
};

const IDEAL_LDO = (name) => `.subckt ${name} vin gnd vout
Bout vo gnd V = min(max(V(vin,gnd)-{DROP}, 0), {VSET})
Rout vo vout 0.05
Rq vin gnd 1e5
.ends`;

/** Decides how a part is represented in SPICE. */
export function elementFor(part, sym, nodeOf) {
	const sim = part.sim ?? {};
	if (sim.exclude) return { skip: true, reason: "excluded" };
	const pinNode = (n) => {
		const node = nodeOf(`${part.ref}.${n}`);
		return node;
	};
	const numbers = sym.pins.map((p) => p.number);
	const prefix = part.ref.replace(/[0-9]/g, "");
	const nameLow = sym.name.toLowerCase();

	if (sim.ldo) {
		const l = sim.ldo;
		for (const k of ["in", "gnd", "out"]) if (!numbers.includes(String(l[k]))) throw new Error(`${part.ref}: sim.ldo.${k} must be a pin number of ${sym.id} (${numbers.join(", ")})`);
		const vset = Number(l.vout);
		const drop = Number(l.dropout ?? 1);
		if (!(vset > 0) || !(drop >= 0)) throw new Error(`${part.ref}: sim.ldo needs vout > 0 and dropout >= 0`);
		const sub = `LDO_${part.ref}`;
		return { lines: [`X${part.ref} ${pinNode(l.in)} ${pinNode(l.gnd)} ${pinNode(l.out)} ${sub}`], subckts: [IDEAL_LDO(sub).replace("{DROP}", String(drop)).replace("{VSET}", String(vset))] };
	}
	if (sim.subckt) {
		const s = sim.subckt;
		if (!/^[A-Za-z_][\w]{0,30}$/.test(String(s.name))) throw new Error(`${part.ref}: invalid subckt name`);
		if (!Array.isArray(s.pins) || s.pins.some((p) => !numbers.includes(String(p)))) throw new Error(`${part.ref}: sim.subckt.pins must list pin numbers of ${sym.id}`);
		return { lines: [`X${part.ref} ${s.pins.map(pinNode).join(" ")} ${s.name}`], subckts: [sanitizeSpiceText(s.text)] };
	}

	const two = () => {
		if (numbers.length < 2) throw new Error(`${part.ref}: expected a two-terminal symbol`);
		return [pinNode(numbers[0]), pinNode(numbers[1])];
	};
	if (prefix === "R" || /^r(_|$)/.test(nameLow) || sim.model === "R") {
		const v = parseValue(part.value);
		if (v === null || v <= 0) throw new Error(`${part.ref}: cannot read resistance from value "${part.value}"`);
		return { lines: [`R${part.ref} ${two().join(" ")} ${num(v)}`] };
	}
	if (prefix === "C" || /^c(_|$)/.test(nameLow) || sim.model === "C") {
		const v = parseValue(part.value);
		if (v === null || v <= 0) throw new Error(`${part.ref}: cannot read capacitance from value "${part.value}"`);
		return { lines: [`C${part.ref} ${two().join(" ")} ${num(v)}`] };
	}
	if (prefix === "L" || /^l(_|$)/.test(nameLow) || sim.model === "L") {
		const v = parseValue(part.value);
		if (v === null || v <= 0) throw new Error(`${part.ref}: cannot read inductance from value "${part.value}"`);
		return { lines: [`L${part.ref} ${two().join(" ")} ${num(v)}`] };
	}
	if (prefix === "D" || sim.model === "D" || /led|diode|zener/.test(nameLow)) {
		const [a, k] = (() => {
			const pa = sym.pins.find((p) => /^a$/i.test(p.name)) ?? sym.pins[1];
			const pk = sym.pins.find((p) => /^k$/i.test(p.name)) ?? sym.pins[0];
			return [pinNode(pa.number), pinNode(pk.number)];
		})();
		let model = MODELS.SWITCHING;
		let mname = "DSW";
		if (/led/.test(nameLow) || sim.diode === "led") [model, mname] = [MODELS.LED, "LEDGEN"];
		else if (/schottky|sb|bat/.test(nameLow) || sim.diode === "schottky") [model, mname] = [MODELS.SCHOTTKY, "DSCH"];
		else if (/zener|^d_z/.test(nameLow)) {
			const bv = parseValue(part.value);
			if (!bv || bv < 1.5 || bv > 200) throw new Error(`${part.ref}: zener value "${part.value}" is not a voltage`);
			mname = `DZ${part.ref}`;
			model = `.model ${mname} D(IS=1e-14 N=1 RS=1 BV=${bv} IBV=5m)`;
		} else if (/1n400|rect/.test(`${nameLow} ${part.value}`.toLowerCase())) [model, mname] = [MODELS.RECTIFIER, "DREC"];
		return { lines: [`D${part.ref} ${a} ${k} ${mname}`], models: [model] };
	}
	if (prefix === "Q" && /npn|pnp/.test(nameLow)) {
		const pc = sym.pins.find((p) => /^c$/i.test(p.name));
		const pb = sym.pins.find((p) => /^b$/i.test(p.name));
		const pe = sym.pins.find((p) => /^e$/i.test(p.name));
		if (!pc || !pb || !pe) throw new Error(`${part.ref}: BJT symbol ${sym.id} has no C/B/E pins; give the part a sim.subckt model`);
		const isNpn = /npn/.test(nameLow);
		return { lines: [`Q${part.ref} ${pinNode(pc.number)} ${pinNode(pb.number)} ${pinNode(pe.number)} ${isNpn ? "NPNGEN" : "PNPGEN"}`], models: [isNpn ? MODELS.NPN : MODELS.PNP] };
	}
	if (/^(J|P|TP|H|SW|F)/.test(prefix) && !sim.model) return { skip: true, reason: "connector/test point/mechanical: not simulated" };
	throw new Error(`${part.ref} (${sym.id}) has no SPICE model. Add part.sim = { ldo: {...} } or { subckt: {...} }, or { exclude: true } to leave it out of the simulation.`);
}

export function buildNetlist(design, test) {
	const d = design.data;
	const nodes = new Map();
	let n = 0;
	const netOfPin = new Map();
	for (const [name, net] of Object.entries(d.nets)) for (const p of net.pins) netOfPin.set(p, name);
	const nodeOfNet = (name) => {
		if (isGroundName(name)) return "0";
		if (!nodes.has(name)) nodes.set(name, `n${++n}`);
		return nodes.get(name);
	};
	const nodeOf = (pin) => {
		const net = netOfPin.get(pin);
		if (!net) return `nc_${pin.replace(/\W/g, "_")}`; // floating pin gets its own node
		return nodeOfNet(net);
	};
	const lines = [`* Banana simulation: ${d.name} / ${test.name}`.replace(/[\r\n]/g, " ")];
	const models = new Set();
	const subckts = [];
	const skipped = [];
	for (const part of d.parts) {
		const sym = getSymbol(part.symbol);
		const el = elementFor(part, sym, nodeOf);
		if (el.skip) {
			skipped.push({ ref: part.ref, reason: el.reason });
			continue;
		}
		lines.push(...el.lines);
		for (const m of el.models ?? []) models.add(m);
		for (const s of el.subckts ?? []) subckts.push(s);
	}
	const netNode = (name, what) => {
		if (!d.nets[name] && !isGroundName(name)) throw new Error(`${what}: no net named "${name}"`);
		return nodeOfNet(name);
	};
	const names = new Set();
	for (const s of test.sources ?? []) {
		if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(s.name)) throw new Error(`Invalid source name "${s.name}"`);
		if (names.has(s.name.toLowerCase())) throw new Error(`Duplicate source name "${s.name}"`);
		names.add(s.name.toLowerCase());
		const pos = netNode(s.pos, `source ${s.name}`);
		const neg = netNode(s.neg ?? "GND", `source ${s.name}`);
		const kind = s.kind ?? "dc";
		const isCurrent = s.type === "current";
		const letter = isCurrent ? "I" : "V";
		const f = (v, label) => {
			const x = typeof v === "number" ? v : parseValue(v);
			if (x === null || !Number.isFinite(x)) throw new Error(`source ${s.name}: ${label} is not a number`);
			return num(x);
		};
		let spec;
		if (kind === "dc") spec = `DC ${f(s.value ?? 0, "value")}`;
		else if (kind === "pulse") {
			const p = s.pulse ?? {};
			spec = `PULSE(${["v1", "v2", "delay", "rise", "fall", "width", "period"].map((k) => f(p[k] ?? 0, `pulse.${k}`)).join(" ")})`;
		} else if (kind === "sin") {
			const p = s.sin ?? {};
			spec = `SIN(${f(p.offset ?? 0, "sin.offset")} ${f(p.amp ?? 1, "sin.amp")} ${f(p.freq ?? 1000, "sin.freq")})`;
		} else throw new Error(`source ${s.name}: kind must be dc, pulse or sin`);
		if (s.ac !== undefined) spec += ` AC ${f(s.ac, "ac")}`;
		lines.push(`${letter}${s.name} ${pos} ${neg} ${spec}`);
	}
	(test.loads ?? []).forEach((l, i) => {
		const v = parseValue(l.value);
		if (!v || v <= 0) throw new Error(`load ${i + 1}: value is not a positive number`);
		lines.push(`RL${i + 1} ${netNode(l.pos, `load ${i + 1}`)} ${netNode(l.neg ?? "GND", `load ${i + 1}`)} ${num(v)}`);
	});
	return { lines, models: [...models], subckts, nodes, skipped, nodeOfNet };
}

const STATS = { max: "MAX", min: "MIN", avg: "AVG", rms: "RMS", pp: "PP" };

function expectationsToCommands(test, built) {
	const a = test.analysis ?? { type: "op" };
	const exp = test.expect ?? [];
	const control = [];
	const meas = [];
	const wanted = [];
	let analysisLine = "";
	const parse = (v, l) => {
		const x = typeof v === "number" ? v : parseValue(v);
		if (x === null || !Number.isFinite(x) || x < 0) throw new Error(`analysis.${l} is not a non-negative number`);
		return num(x);
	};
	if (a.type === "op") {
		control.push("op");
	} else if (a.type === "tran") {
		analysisLine = `.tran ${parse(a.step, "step")} ${parse(a.stop, "stop")}`;
	} else if (a.type === "ac") {
		analysisLine = `.ac dec ${Math.max(1, Math.min(200, Number(a.pointsPerDecade ?? 20)))} ${parse(a.start, "start")} ${parse(a.stop, "stop")}`;
	} else throw new Error("analysis.type must be op, tran or ac");

	exp.forEach((e, i) => {
		const id = `m${i + 1}`;
		const mm = /^(v|i)\(([A-Za-z0-9_+.\-/]{1,40})\)$/.exec(e.measure ?? "");
		if (!mm) throw new Error(`expect[${i}].measure must look like v(NET) or i(SOURCE)`);
		let target;
		if (mm[1] === "v") target = `v(${built.nodeOfNet(mm[2])})`;
		else {
			if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(mm[2])) throw new Error(`expect[${i}]: invalid source name`);
			target = `i(v${mm[2]})`;
		}
		if (a.type === "op") {
			control.push(`print ${target}`);
			wanted.push({ id, expr: e.measure, key: target.toLowerCase(), e });
		} else if (a.type === "tran") {
			const stat = e.stat ?? "final";
			const from = e.from !== undefined ? ` from=${parse(e.from, "from")}` : "";
			const to = e.to !== undefined ? ` to=${parse(e.to, "to")}` : "";
			// "final" is read one step before the end: a measurement exactly at the stop time can fall outside the simulated interval.
			if (stat === "final") meas.push(`.meas tran ${id} FIND ${target} AT=${num(Math.max(0, parseValue(a.stop) - Math.min(parseValue(a.step) || 0, parseValue(a.stop) * 0.01)))}`);
			else if (STATS[stat]) meas.push(`.meas tran ${id} ${STATS[stat]} ${target}${from}${to}`);
			else throw new Error(`expect[${i}].stat must be final, max, min, avg, rms or pp`);
			wanted.push({ id, expr: e.measure, key: id, e });
		} else {
			if (e.at === undefined) throw new Error(`expect[${i}]: ac measurements need "at" (frequency in Hz)`);
			const fn = e.stat === "phase" ? "vp" : "vdb";
			if (mm[1] !== "v") throw new Error(`expect[${i}]: ac supports v(NET) only`);
			const lo = parseValue(a.start);
			const hi = parseValue(a.stop);
			const at = parseValue(e.at);
			if (!(at >= lo && at <= hi)) throw new Error(`expect[${i}]: at=${e.at} is outside the analysis range ${a.start}..${a.stop} Hz`);
			// a point exactly on the sweep edge can fall outside ngspice's interval; nudge it inside by a millionth
			const inside = Math.min(Math.max(at, lo * (1 + 1e-6)), hi * (1 - 1e-6));
			meas.push(`.meas ac ${id} FIND ${fn}(${built.nodeOfNet(mm[2])}) AT=${num(inside)}`);
			wanted.push({ id, expr: `${e.stat === "phase" ? "phase" : "dB"} ${e.measure} @ ${e.at}`, key: id, e });
		}
	});
	return { analysisLine, control, meas, wanted };
}

export function ngspicePath() {
	return process.env.NGSPICE_PATH || "ngspice";
}

export async function ngspiceAvailable() {
	try {
		await exec(ngspicePath(), ["-v"], { timeout: 10000 });
		return true;
	} catch {
		return false;
	}
}

/** Parses "name = value" lines that ngspice prints for print/.meas, lowercased. */
export function parseNgspiceOutput(text) {
	const values = new Map();
	for (const m of text.matchAll(/^\s*([a-z_][\w()+.\-/]*)\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gim)) values.set(m[1].toLowerCase(), Number(m[2]));
	return values;
}

export function checkBounds(value, e) {
	if (!Number.isFinite(value)) return false;
	if (e.min !== undefined && value < e.min) return false;
	if (e.max !== undefined && value > e.max) return false;
	if (e.approx !== undefined) {
		const tol = e.tolerance ?? 0.05; // relative
		if (Math.abs(value - e.approx) > Math.abs(e.approx) * tol + 1e-12) return false;
	}
	return true;
}

export async function runTest(design, test, { keepDeck = false } = {}) {
	const started = performance.now();
	const result = { name: test.name, passed: false, measures: [], skippedParts: [] };
	try {
		if (!(await ngspiceAvailable())) throw new Error("ngspice is not installed (set NGSPICE_PATH or install ngspice)");
		const built = buildNetlist(design, test);
		result.skippedParts = built.skipped;
		const cmds = expectationsToCommands(test, built);
		if (cmds.wanted.length === 0) throw new Error("test has no expectations");
		const deck = [...built.lines, ...built.models, ...built.subckts, ...(cmds.analysisLine ? [cmds.analysisLine] : []), ...cmds.meas, ".control", "set noaskquit", ...cmds.control, ...(cmds.analysisLine ? ["run"] : []), "quit", ".endc", ".end", ""].join("\n");
		if (keepDeck) result.deck = deck;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banana-spice-"));
		try {
			const file = path.join(dir, "deck.cir");
			fs.writeFileSync(file, deck);
			const { stdout, stderr } = await exec(ngspicePath(), ["-b", file], { timeout: 60000, maxBuffer: 16 * 1024 * 1024, cwd: dir }).catch((e) => ({ stdout: e.stdout ?? "", stderr: `${e.stderr ?? ""}${e.message}` }));
			const text = `${stdout}\n${stderr}`;
			const values = parseNgspiceOutput(text);
			for (const w of cmds.wanted) {
				const value = values.get(w.key);
				const ok = value !== undefined && checkBounds(value, w.e);
				result.measures.push({ measure: w.expr, stat: w.e.stat, value: value ?? null, min: w.e.min, max: w.e.max, approx: w.e.approx, tolerance: w.e.approx !== undefined ? (w.e.tolerance ?? 0.05) : undefined, pass: ok });
			}
			if (result.measures.some((m) => m.value === null)) {
				const err = text.split("\n").filter((l) => /error|singular|no such|unknown|fatal|too many iterations|doAnalyses/i.test(l)).slice(0, 4).join(" | ");
				result.error = `ngspice produced no value for ${result.measures.filter((m) => m.value === null).map((m) => m.measure).join(", ")}${err ? `: ${err}` : ""}`;
			}
			result.passed = result.measures.every((m) => m.pass) && !result.error;
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	} catch (err) {
		result.error = err.message;
	}
	result.durationMs = Math.round(performance.now() - started);
	return result;
}

export async function runAllTests(design, { only } = {}) {
	const tests = design.data.tests.filter((t) => !only || t.name === only);
	if (only && tests.length === 0) throw new Error(`No test named "${only}"`);
	const results = [];
	for (const t of tests) results.push(await runTest(design, t));
	return { passed: results.length > 0 && results.every((r) => r.passed), count: results.length, results };
}
