// Shared fuzz helpers: seeded PRNG, text mutators, demo seed corpus and the SPICE safety oracle.
import fs from "node:fs";
import path from "node:path";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { irToKicadSch } from "../../backend/src/engine/kicad-sch-writer.js";

const DEFAULT_DEMOS_DIR = "C:/Program Files/KiCad/10.0/share/kicad/demos";
const MAX_SEED_BYTES = 200 * 1024;
const MAX_SEEDS_PER_KIND = 12;

// mulberry32: small, fast, deterministic 32-bit PRNG.
export function createRng(seed) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (max) => Math.floor(next() * max),
		pick: (list) => list[Math.floor(next() * list.length)],
		chance: (p) => next() < p,
	};
}

export function caseSeed(seed, index) {
	return (
		(Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0
	);
}

const INTERESTING_TEXT = [
	"(",
	")",
	'"',
	"\\",
	"\n",
	" ",
	"\t",
	"-0",
	"1e309",
	"-1e309",
	"NaN",
	"0.0000001",
	"99999999999999999999999",
	"()",
	'(property "Reference" "")',
	'(lib_id "")',
	"(at 1e309 -1e309 NaN)",
	'(pin "1" (uuid ""))',
	'(net 0 "")',
	'"\\',
	"\u0000",
	"\u00a0",
	"\ud800",
	"é",
];

function randomPos(rng, text) {
	return rng.int(text.length + 1);
}

function insertToken(rng, text) {
	const pos = randomPos(rng, text);
	return text.slice(0, pos) + rng.pick(INTERESTING_TEXT) + text.slice(pos);
}

function deleteRange(rng, text) {
	const start = randomPos(rng, text);
	const len = 1 + rng.int(64);
	return text.slice(0, start) + text.slice(start + len);
}

function duplicateRange(rng, text) {
	const start = randomPos(rng, text);
	const chunk = text.slice(start, start + 1 + rng.int(256));
	return text.slice(0, start) + chunk + text.slice(start);
}

function replaceChar(rng, text) {
	const pos = rng.int(Math.max(text.length, 1));
	const ch = String.fromCharCode(rng.int(128));
	return text.slice(0, pos) + ch + text.slice(pos + 1);
}

function truncate(rng, text) {
	return text.slice(0, randomPos(rng, text));
}

// Deep nesting is what blows recursive walkers (serialize, editors) off the stack.
function nest(rng, text) {
	const pos = randomPos(rng, text);
	const depth = rng.pick([8, 3000, 50000]);
	return `${text.slice(0, pos)}${"(".repeat(depth)}${")".repeat(depth)}${text.slice(pos)}`;
}

const TEXT_MUTATORS = [
	insertToken,
	deleteRange,
	duplicateRange,
	replaceChar,
	truncate,
	nest,
];

export function mutateText(rng, text) {
	let out = text;
	const rounds = 1 + rng.int(4);
	for (let i = 0; i < rounds; i++) {
		out = rng.pick(TEXT_MUTATORS)(rng, out);
	}
	return out;
}

export function demosDir() {
	return process.env.KICAD_DEMOS_DIR || DEFAULT_DEMOS_DIR;
}

function listDemoFiles(dir, ext) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { recursive: true })
		.filter((f) => typeof f === "string" && f.endsWith(ext))
		.map((f) => path.join(dir, f))
		.filter((f) => fs.statSync(f).size <= MAX_SEED_BYTES)
		.sort();
}

export function fixedId(kind, n) {
	return `${kind}_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

// Without KiCad installed (CI), seed from our own writers so the suite still exercises real files.
function writerSeed(ext) {
	const part = {
		id: fixedId("part", 1),
		ref: "R1",
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0805",
		props: {},
	};
	const pins = [{ partId: part.id, pin: "1" }];
	const ir = {
		schemaVersion: 1,
		name: "seed",
		parts: [part],
		nets: [{ id: fixedId("net", 1), name: "GND", pins }],
		constraints: [],
	};
	return ext === ".kicad_sch" ? irToKicadSch(ir).text : irToKicadPcb(ir).text;
}

// Seeds are real KiCad demo files (sorted, size-capped) so runs are deterministic.
export function loadSeeds(ext) {
	const files = listDemoFiles(demosDir(), ext).slice(0, MAX_SEEDS_PER_KIND);
	if (files.length === 0) return [writerSeed(ext)];
	return files.map((f) => fs.readFileSync(f, "utf8"));
}

// What ngspice itself would see as a command-executing or file-reading line.
const UNSAFE_PREFIXES = [
	".include",
	".inc",
	".lib",
	".control",
	"shell",
	"system",
	"*ng_script",
];

function stripLeader(line) {
	let s = line.replace(/^[ \t\v\f\r]+/, "");
	while (s.startsWith("+")) {
		s = s.slice(1).replace(/^[ \t\v\f\r]+/, "");
	}
	return s.toLowerCase();
}

export function findUnsafeSpiceLine(netlist, prefixes = UNSAFE_PREFIXES) {
	for (const raw of netlist.split("\n")) {
		const line = stripLeader(raw);
		if (prefixes.some((p) => line.startsWith(p))) return raw;
	}
	return null;
}

// "system" is not an ngspice command: outside a .control block (itself rejected) such a line
// is parsed as a switch element, so the netlist gate is held to what ngspice can execute.
export const NGSPICE_EXEC_PREFIXES = UNSAFE_PREFIXES.filter(
	(p) => p !== "system",
);
