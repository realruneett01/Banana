import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { childLists, firstAtom, matchParen } from "./sexp.js";

/** Candidate library roots, most specific first. Works for distro, Windows, macOS and flatpak layouts. */
export function libraryRoots(
	kind,
	{
		env = process.env,
		cliPath = config.kicadCliPath,
		platform = os.platform(),
	} = {},
) {
	const dirName = kind === "symbols" ? "symbols" : "footprints";
	const roots = [];
	const envVar =
		kind === "symbols" ? env.KICAD_SYMBOL_DIR : env.KICAD_FOOTPRINT_DIR;
	if (envVar) roots.push(envVar);
	if (cliPath) {
		const bin = path.dirname(cliPath);
		roots.push(path.join(bin, "..", "share", "kicad", dirName)); // Windows / portable / /usr
		roots.push(path.join(bin, "..", "SharedSupport", dirName)); // macOS app bundle
		roots.push(path.join(bin, "..", "..", "share", "kicad", dirName));
	}
	roots.push(
		`/usr/share/kicad/${dirName}`,
		`/usr/local/share/kicad/${dirName}`,
	);
	if (platform === "darwin")
		roots.push(
			`/Applications/KiCad/KiCad.app/Contents/SharedSupport/${dirName}`,
		);
	if (platform === "win32") {
		for (const v of ["11.0", "10.0", "9.0", "8.0", "7.0"])
			roots.push(`C:\\Program Files\\KiCad\\${v}\\share\\kicad\\${dirName}`);
	}
	return roots.map((r) => path.resolve(r));
}

export function findLibraryRoot(kind, opts) {
	return libraryRoots(kind, opts).find((r) => {
		try {
			return fs.statSync(r).isDirectory();
		} catch {
			return false;
		}
	});
}

const LIB_NAME = /^[A-Za-z0-9_.+-]{1,100}$/;
const ENTRY_NAME = /^[A-Za-z0-9_.+,'()#~%&=@/ -]{1,160}$/;

export function parseLibId(id) {
	const m = /^([^:]+):(.+)$/.exec(String(id || ""));
	if (
		!m ||
		!LIB_NAME.test(m[1]) ||
		m[1].includes("..") ||
		m[1].startsWith(".") ||
		!ENTRY_NAME.test(m[2]) ||
		m[2].includes("..")
	)
		return null;
	return { lib: m[1], name: m[2] };
}

const symbolCache = new Map(); // file -> { mtime, text, index: Map(name -> block), order: [] }

function loadSymbolLib(file) {
	const mtime = fs.statSync(file).mtimeMs;
	const cached = symbolCache.get(file);
	if (cached && cached.mtime === mtime) return cached;
	const text = fs.readFileSync(file, "utf8");
	const root = childLists(text, 0, text.lastIndexOf(")"));
	const index = new Map();
	for (const block of root)
		if (block.head === "symbol") index.set(firstAtom(text, block), block);
	const entry = { mtime, text, index };
	symbolCache.set(file, entry);
	return entry;
}

function symbolFile(lib, opts) {
	const root = findLibraryRoot("symbols", opts);
	if (!root)
		throw new Error(
			"KiCad symbol libraries not found. Install KiCad's libraries or set KICAD_SYMBOL_DIR.",
		);
	const file = path.join(root, `${lib}.kicad_sym`);
	if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return null;
	return file;
}

/**
 * Reads a library symbol and returns its pins and the exact text needed to embed it in a schematic.
 * `(extends "Parent")` symbols are flattened onto their parent, as KiCad does when it embeds them.
 */
export function getSymbol(libId, opts) {
	const id = parseLibId(libId);
	if (!id) return null;
	const file = symbolFile(id.lib, opts);
	if (!file) return null;
	const { text, index } = loadSymbolLib(file);
	let block = index.get(id.name);
	if (!block) return null;

	let ownText = text.slice(block.start, block.end + 1);
	let baseName = id.name;
	const ext = /\(extends\s+"((?:[^"\\]|\\.)*)"\)/.exec(ownText.slice(0, 300));
	let propertyOverrides = "";
	if (ext) {
		const parent = index.get(ext[1]);
		if (!parent) return null;
		propertyOverrides = ownText;
		baseName = ext[1];
		block = parent;
		ownText = text.slice(parent.start, parent.end + 1);
	}

	const pins = [];
	const units = new Set();
	for (const sub of childLists(ownText)) {
		if (sub.head !== "symbol") continue;
		const subName = firstAtom(ownText, sub) || "";
		const um = new RegExp(
			`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d+)_(\\d+)$`,
		).exec(subName);
		const unit = um ? Number(um[1]) : 0;
		if (unit > 0) units.add(unit);
		for (const pin of childLists(ownText, sub.start, sub.end)) {
			if (pin.head !== "pin") continue;
			const body = ownText.slice(pin.start, pin.end + 1);
			const head = /^\(\s*pin\s+(\S+)\s+(\S+)/.exec(body);
			const at = /\(at\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/.exec(body);
			const len = /\(length\s+(-?[\d.]+)\)/.exec(body);
			const name = /\(name\s+"((?:[^"\\]|\\.)*)"/.exec(body);
			const number = /\(number\s+"((?:[^"\\]|\\.)*)"/.exec(body);
			if (!head || !at || !number) continue;
			pins.push({
				number: number[1],
				name: name ? name[1] : "~",
				type: head[1],
				hidden:
					/^\(\s*pin\s+\S+\s+\S+\s+\(at[^)]*\)\s+\(length[^)]*\)\s+hide\b/.test(
						body,
					),
				x: Number(at[1]),
				y: Number(at[2]),
				angle: Number(at[3]),
				length: len ? Number(len[1]) : 2.54,
				unit,
			});
		}
	}
	const prop = (name, src = propertyOverrides || ownText) => {
		const m = new RegExp(
			`\\(property\\s+"${name}"\\s+"((?:[^"\\\\]|\\\\.)*)"`,
		).exec(src);
		return m ? m[1] : "";
	};
	return {
		id: `${id.lib}:${id.name}`,
		lib: id.lib,
		name: id.name,
		description: prop("ki_description") || prop("Description"),
		keywords: prop("ki_keywords"),
		referencePrefix:
			(prop("Reference") || "U").replace(/[^A-Za-z#]/g, "") || "U",
		defaultFootprint: prop("Footprint"),
		fpFilters: prop("ki_fp_filters"),
		isPower: /\(power\)/.test(ownText.slice(0, 600)),
		pins,
		units: [...units].sort((a, b) => a - b),
		/** Text of the symbol block renamed to `Lib:Name`, ready for the schematic's lib_symbols. */
		embedText() {
			let t = ownText.replace(
				/^\(\s*symbol\s+"(?:[^"\\]|\\.)*"/,
				`(symbol "${id.lib}:${id.name}"`,
			);
			// Sub-symbols keep the *parent's* base name inside lib_symbols (KiCad flattens extends this way).
			if (ext) {
				const over = (n) => {
					const o = prop(n, propertyOverrides);
					return o;
				};
				for (const n of [
					"Value",
					"Datasheet",
					"ki_keywords",
					"ki_description",
				]) {
					const o = over(n);
					if (o)
						t = t.replace(
							new RegExp(`(\\(property\\s+"${n}"\\s+)"(?:[^"\\\\]|\\\\.)*"`),
							`$1"${o.replace(/\$/g, "$$$$")}"`,
						);
				}
			}
			return t;
		},
	};
}

let symbolListCache = null;
/** All `Lib:Name` ids (cached), for search. */
export function listSymbolIds(opts) {
	const root = findLibraryRoot("symbols", opts);
	if (!root) return [];
	if (symbolListCache?.root === root) return symbolListCache.ids;
	const ids = [];
	for (const f of fs.readdirSync(root)) {
		if (!f.endsWith(".kicad_sym")) continue;
		const lib = f.slice(0, -".kicad_sym".length);
		const text = fs.readFileSync(path.join(root, f), "utf8");
		const re = /^ {2}\(symbol "((?:[^"\\]|\\.)*)"/gm;
		for (let m = re.exec(text); m; m = re.exec(text))
			if (!/_\d+_\d+$/.test(m[1])) ids.push(`${lib}:${m[1]}`);
	}
	symbolListCache = { root, ids };
	return ids;
}

export function searchSymbols(query, { limit = 25, ...opts } = {}) {
	const terms = String(query || "")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (terms.length === 0) return [];
	const scored = [];
	for (const id of listSymbolIds(opts)) {
		const low = id.toLowerCase();
		if (!terms.every((t) => low.includes(t))) continue;
		const name = low.split(":")[1];
		scored.push({
			id,
			score:
				(terms.every((t) => name === t)
					? 0
					: name.startsWith(terms[0])
						? 1
						: 2) *
					1000 +
				id.length,
		});
	}
	return scored
		.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1))
		.slice(0, limit)
		.map((s) => s.id);
}

// ---- footprints ----
export function footprintFile(libId, opts) {
	const id = parseLibId(libId);
	if (!id) return null;
	const root = findLibraryRoot("footprints", opts);
	if (!root)
		throw new Error(
			"KiCad footprint libraries not found. Install KiCad's libraries or set KICAD_FOOTPRINT_DIR.",
		);
	const file = path.join(root, `${id.lib}.pretty`, `${id.name}.kicad_mod`);
	if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return null;
	return file;
}

/** Unquotes an S-expression atom captured by the ATOM pattern below. */
const unq = (v) =>
	v?.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v;
const ATOM = '("(?:[^"\\\\]|\\\\.)*"|[^\\s()]+)';

/** Pads of a library footprint: [{number, type, x, y, w, h, layers}]. Handles quoted and bare atoms. */
export function getFootprint(libId, opts) {
	const file = footprintFile(libId, opts);
	if (!file) return null;
	const text = fs.readFileSync(file, "utf8");
	const pads = [];
	const court = [];
	for (const b of childLists(text)) {
		const body = text.slice(b.start, b.end + 1);
		if (b.head === "pad") {
			const head = new RegExp(
				`^\\(\\s*pad\\s+${ATOM}\\s+(\\S+)\\s+(\\S+)`,
			).exec(body);
			const at = /\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?\)/.exec(
				body,
			);
			const size = /\(size\s+(-?[\d.]+)\s+(-?[\d.]+)\)/.exec(body);
			if (!head || !at) continue;
			const drill = /\(drill\s+(?:oval\s+)?(-?[\d.]+)(?:\s+(-?[\d.]+))?\)/.exec(
				body,
			);
			pads.push({
				number: unq(head[1]),
				type: head[2],
				shape: head[3],
				x: Number(at[1]),
				y: Number(at[2]),
				w: size ? Number(size[1]) : 1,
				h: size ? Number(size[2]) : 1,
				drill: drill ? Math.max(Number(drill[1]), Number(drill[2] ?? 0)) : 0,
				layers: /\(layers\s+([^)]*)\)/.exec(body)?.[1] ?? "",
			});
		} else if (
			/^fp_(line|rect|poly|circle|arc)$/.test(b.head) &&
			/\(layer\s+"?[FB]\.CrtYd"?\)/.test(body)
		) {
			for (const m of body.matchAll(
				/\((?:start|end|xy|center)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g,
			))
				court.push([Number(m[1]), Number(m[2])]);
		}
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of court) {
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	}
	if (!Number.isFinite(minX))
		for (const p of pads) {
			minX = Math.min(minX, p.x - p.w / 2);
			maxX = Math.max(maxX, p.x + p.w / 2);
			minY = Math.min(minY, p.y - p.h / 2);
			maxY = Math.max(maxY, p.y + p.h / 2);
		}
	return {
		id: libId,
		file,
		text,
		pads,
		bbox: Number.isFinite(minX)
			? { minX, minY, maxX, maxY }
			: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
		isSmd: /\(attr\s+smd/.test(text.slice(0, 1500)),
	};
}

export function searchFootprints(query, { limit = 25, ...opts } = {}) {
	const root = findLibraryRoot("footprints", opts);
	if (!root) return [];
	const terms = String(query || "")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (!terms.length) return [];
	const out = [];
	for (const d of fs.readdirSync(root)) {
		if (!d.endsWith(".pretty")) continue;
		const lib = d.slice(0, -".pretty".length);
		for (const f of fs.readdirSync(path.join(root, d))) {
			if (!f.endsWith(".kicad_mod")) continue;
			const id = `${lib}:${f.slice(0, -".kicad_mod".length)}`;
			const low = id.toLowerCase();
			if (terms.every((t) => low.includes(t))) out.push(id);
		}
	}
	return out
		.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
		.slice(0, limit);
}
