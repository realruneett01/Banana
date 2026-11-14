import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "./sexpr.js";

const LIB_ID_REGEX = /^[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+ -]+$/;
const MAX_CACHED_FILES = 16;
const INDEX_CONCURRENCY = 24;
const ATOM_DELIMITERS = new Set([40, 41]);

const FP_METADATA_HEADS = new Set([
	"version",
	"generator",
	"layer",
	"descr",
	"tags",
	"property",
	"tedit",
	"tstamp",
	"pad",
	"net",
	"attr",
]);

const SYMBOL_NON_GRAPHIC_HEADS = new Set([
	"symbol",
	"pin",
	"property",
	"pin_numbers",
	"pin_names",
	"in_bom",
	"on_board",
	"power",
	"extends",
]);

const STANDARD_LIBRARY_CANDIDATES = {
	win32: (subDir) => [
		`C:\\Program Files\\KiCad\\11.0\\share\\kicad\\${subDir}`,
		`C:\\Program Files\\KiCad\\10.0\\share\\kicad\\${subDir}`,
		`C:\\Program Files\\KiCad\\9.0\\share\\kicad\\${subDir}`,
		`C:\\Program Files\\KiCad\\8.0\\share\\kicad\\${subDir}`,
		`C:\\Program Files\\KiCad\\7.0\\share\\kicad\\${subDir}`,
		`C:\\Program Files\\KiCad\\share\\kicad\\${subDir}`,
	],
	darwin: (subDir) => [
		`/Applications/KiCad/KiCad.app/Contents/SharedSupport/${subDir}`,
		`/Applications/KiCad 10.0/KiCad.app/Contents/SharedSupport/${subDir}`,
		`/Applications/KiCad 9.0/KiCad.app/Contents/SharedSupport/${subDir}`,
	],
	linux: (subDir) => [
		`/usr/share/kicad/${subDir}`,
		`/usr/local/share/kicad/${subDir}`,
	],
};

const SYMBOL_ENV_VARS = [
	"KICAD_SYMBOL_DIR",
	"KICAD10_SYMBOL_DIR",
	"KICAD9_SYMBOL_DIR",
];
const FOOTPRINT_ENV_VARS = [
	"KICAD_FOOTPRINT_DIR",
	"KICAD10_FOOTPRINT_DIR",
	"KICAD9_FOOTPRINT_DIR",
];

function getCliAssetCandidates(subDir) {
	if (!process.env.KICAD_CLI_PATH) return [];
	const cliDir = path.dirname(process.env.KICAD_CLI_PATH);
	return [
		path.resolve(cliDir, "..", "share", "kicad", subDir),
		path.resolve(cliDir, "..", "SharedSupport", subDir),
	];
}

function detectDefaultAssetDir(envVars, subDir) {
	for (const key of envVars) {
		const val = process.env[key];
		if (val && fs.existsSync(val)) return val;
	}
	const osBuilder = STANDARD_LIBRARY_CANDIDATES[os.platform()];
	const candidates = [
		...getCliAssetCandidates(subDir),
		...(osBuilder ? osBuilder(subDir) : []),
	];
	return candidates.find((dir) => fs.existsSync(dir)) || undefined;
}

function isValidLibId(libId) {
	if (typeof libId !== "string") return false;
	return LIB_ID_REGEX.test(libId);
}

function isPathSafe(baseDir, targetPath) {
	const rel = path.relative(baseDir, targetPath);
	if (rel.startsWith("..")) return false;
	return !path.isAbsolute(rel);
}

function parseLibId(libId) {
	if (!isValidLibId(libId)) return null;
	const colonIdx = libId.indexOf(":");
	return {
		lib: libId.slice(0, colonIdx),
		name: libId.slice(colonIdx + 1),
	};
}

function resolveItemPath(baseDir, libId, getSegments) {
	if (!baseDir || typeof baseDir !== "string") return null;
	const parsed = parseLibId(libId);
	if (!parsed) return null;
	const targetPath = path.join(baseDir, ...getSegments(parsed));
	return isPathSafe(baseDir, targetPath) ? targetPath : null;
}

function resolveSymbolPath(symbolDir, libId) {
	return resolveItemPath(symbolDir, libId, ({ lib }) => [`${lib}.kicad_sym`]);
}

function resolveFootprintPath(footprintDir, libId) {
	return resolveItemPath(footprintDir, libId, ({ lib, name }) => [
		`${lib}.pretty`,
		`${name}.kicad_mod`,
	]);
}

async function isDirectory(dirPath, fsImpl) {
	if (!dirPath || typeof dirPath !== "string") return false;
	try {
		const stat = await fsImpl.stat(dirPath);
		return typeof stat.isDirectory === "function" ? stat.isDirectory() : true;
	} catch {
		// Directory does not exist or cannot be accessed
		return false;
	}
}

function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function extractChildNode(node, head) {
	if (!Array.isArray(node)) return null;
	return node.find((c) => Array.isArray(c) && nodeSym(c[0]) === head) ?? null;
}

function extractSubProp(node, head) {
	const sub = extractChildNode(node, head);
	if (!sub || sub.length < 2) return "";
	return nodeSym(sub[1]);
}

function extractAt(node) {
	const atNode = extractChildNode(node, "at");
	if (!atNode) return [0, 0, 0];
	const x = Number(atNode[1]) || 0;
	const y = Number(atNode[2]) || 0;
	const rot = atNode.length > 3 ? Number(atNode[3]) || 0 : 0;
	return [x, y, rot];
}

function extractPinLength(pinNode) {
	const lenNode = extractChildNode(pinNode, "length");
	if (!lenNode || lenNode.length < 2) return 0;
	return Number(lenNode[1]) || 0;
}

function parsePinNode(pinNode) {
	return {
		number: extractSubProp(pinNode, "number"),
		name: extractSubProp(pinNode, "name"),
		type: nodeSym(pinNode[1]),
		at: extractAt(pinNode),
		length: extractPinLength(pinNode),
	};
}

function filterAndMapChildren(node, head, parseFn) {
	if (!Array.isArray(node)) return [];
	return node
		.filter((child) => Array.isArray(child) && nodeSym(child[0]) === head)
		.map(parseFn);
}

function collectUnitPins(unitNode) {
	return filterAndMapChildren(unitNode, "pin", parsePinNode);
}

function collectSymbolPins(symbolNode) {
	const pins = [];
	for (const child of symbolNode) {
		if (!Array.isArray(child)) continue;
		const head = nodeSym(child[0]);
		if (head === "pin") {
			pins.push(parsePinNode(child));
		} else if (head === "symbol") {
			pins.push(...collectUnitPins(child));
		}
	}
	return pins;
}

function collectUnitGraphics(unitNode) {
	const graphics = [];
	for (const child of unitNode.slice(2)) {
		if (Array.isArray(child) && nodeSym(child[0]) !== "pin") {
			graphics.push(child);
		}
	}
	return graphics;
}

function collectSymbolGraphics(symbolNode) {
	const graphics = [];
	for (const child of symbolNode) {
		if (!Array.isArray(child)) continue;
		const head = nodeSym(child[0]);
		if (head === "symbol") {
			graphics.push(...collectUnitGraphics(child));
		} else if (!SYMBOL_NON_GRAPHIC_HEADS.has(head)) {
			graphics.push(child);
		}
	}
	return graphics;
}

function extractSymbolProperties(symbolNode) {
	const props = {
		Reference: "",
		Value: "",
		Description: "",
		ki_keywords: "",
		Footprint: "",
	};
	for (const child of symbolNode) {
		if (Array.isArray(child) && nodeSym(child[0]) === "property") {
			const key = nodeSym(child[1]);
			props[key] = child.length > 2 ? nodeSym(child[2]) : "";
		}
	}
	return props;
}

function extractPadSize(padNode) {
	const sizeNode = extractChildNode(padNode, "size");
	if (!sizeNode || sizeNode.length < 3) return [0, 0];
	return [Number(sizeNode[1]) || 0, Number(sizeNode[2]) || 0];
}

function extractPadLayers(padNode) {
	const layersNode = extractChildNode(padNode, "layers");
	if (!layersNode) return [];
	return layersNode.slice(1).map(nodeSym).filter(Boolean);
}

// (drill 0.8), (drill oval 0.8 1.2) and either with (offset x y); an SMD pad
// may carry only the offset. Keys are set only when the file has them.
function extractPadDrill(padNode) {
	const drillNode = extractChildNode(padNode, "drill");
	if (!drillNode) return {};
	const sizes = drillNode.filter((n) => typeof n === "number");
	const offset = extractChildNode(drillNode, "offset");
	const drill = {};
	if (sizes.length > 0) drill.drill = sizes[0];
	if (nodeSym(drillNode[1]) === "oval")
		drill.drillHeight = sizes[1] ?? sizes[0];
	if (offset) drill.drillOffset = [Number(offset[1]), Number(offset[2])];
	return drill;
}

function parsePadNode(padNode) {
	return {
		number: nodeSym(padNode[1]),
		type: nodeSym(padNode[2]),
		shape: nodeSym(padNode[3]),
		at: extractAt(padNode),
		size: extractPadSize(padNode),
		...extractPadDrill(padNode),
		layers: extractPadLayers(padNode),
	};
}

export function collectFootprintPads(fpNode) {
	return filterAndMapChildren(fpNode, "pad", parsePadNode);
}

function filterChildGraphics(node, excludedHeads) {
	if (!Array.isArray(node)) return [];
	return node.filter(
		(child) => Array.isArray(child) && !excludedHeads.has(nodeSym(child[0])),
	);
}

function collectFootprintGraphics(fpNode) {
	return filterChildGraphics(fpNode, FP_METADATA_HEADS);
}

function skipWs(text, i) {
	while (i < text.length && text.charCodeAt(i) <= 32) {
		i++;
	}
	return i;
}

function skipQuoted(text, start) {
	let i = start + 1;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (code === 34) return i + 1;
		if (code === 92) i++;
		i++;
	}
	return text.length;
}

const ESCAPE_MAP = { n: "\n", r: "\r", t: "\t" };

function unescapeChar(c) {
	return ESCAPE_MAP[c] ?? c;
}

function readQuotedAt(text, start) {
	let val = "";
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i++];
		if (ch === '"') return { value: val, nextIndex: i };
		if (ch !== "\\") {
			val += ch;
			continue;
		}
		if (i >= text.length) break;
		val += unescapeChar(text[i++]);
	}
	return { value: val, nextIndex: i };
}

function isAtomTerminator(code) {
	return code <= 32 || ATOM_DELIMITERS.has(code);
}

function readAtomAt(text, start) {
	let i = start;
	while (i < text.length) {
		if (isAtomTerminator(text.charCodeAt(i))) break;
		i++;
	}
	return { value: text.slice(start, i), nextIndex: i };
}

function readTokenAt(text, start) {
	const i = skipWs(text, start);
	if (i >= text.length) return null;
	if (text[i] === '"') return readQuotedAt(text, i);
	if (text[i] === "(" || text[i] === ")") return null;
	return readAtomAt(text, i);
}

function findBlockEnd(text, openIdx) {
	let depth = 0;
	let i = openIdx;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (code === 34) {
			i = skipQuoted(text, i);
			continue;
		}
		if (code === 40) depth++;
		if (code === 41 && --depth === 0) return i + 1;
		i++;
	}
	return text.length;
}

function findRootBodyStart(text) {
	const rootOpen = text.indexOf("(");
	if (rootOpen === -1) return -1;
	const rootHead = readTokenAt(text, rootOpen + 1);
	return rootHead ? rootHead.nextIndex : -1;
}

function forEachChildBlock(text, start, end, onBlock) {
	let i = skipWs(text, start);
	while (i < end) {
		const ch = text[i];
		if (ch === "(") {
			const blockEnd = findBlockEnd(text, i);
			const headTok = readTokenAt(text, i + 1);
			const stop = onBlock(
				headTok?.value,
				headTok?.nextIndex ?? i + 1,
				i,
				blockEnd,
			);
			if (stop) return;
			i = skipWs(text, blockEnd);
		} else if (ch === '"') {
			i = skipWs(text, skipQuoted(text, i));
		} else {
			i = skipWs(text, i + 1);
		}
	}
}

function scanSymbolBlockProps(text, bodyStart, blockEnd) {
	const props = {
		Reference: "",
		Value: "",
		Description: "",
		ki_keywords: "",
		Footprint: "",
	};
	forEachChildBlock(text, bodyStart, blockEnd, (head, nextIdx) => {
		if (head !== "property") return false;
		const keyTok = readTokenAt(text, nextIdx);
		const valTok = keyTok ? readTokenAt(text, keyTok.nextIndex) : null;
		if (keyTok && valTok) {
			props[keyTok.value] = valTok.value;
		}
		return false;
	});
	return props;
}

function scanSymbolFileEntries(text, fileBase, index) {
	const start = findRootBodyStart(text);
	if (start === -1) return;
	forEachChildBlock(
		text,
		start,
		text.length,
		(head, nextIdx, _start, blockEnd) => {
			if (head !== "symbol") return false;
			const nameTok = readTokenAt(text, nextIdx);
			if (!nameTok?.value || isSubUnit(nameTok.value)) return false;
			const properties = scanSymbolBlockProps(
				text,
				nameTok.nextIndex,
				blockEnd,
			);
			index.push({
				libId: `${fileBase}:${nameTok.value}`,
				name: nameTok.value,
				description: properties.Description || "",
				keywords: properties.ki_keywords || "",
				properties,
			});
			return false;
		},
	);
}

function extractSymbolSlice(text, targetName) {
	const start = findRootBodyStart(text);
	if (start === -1) return null;
	let slice = null;
	forEachChildBlock(
		text,
		start,
		text.length,
		(head, nextIdx, blockStart, blockEnd) => {
			if (head !== "symbol") return false;
			const nameTok = readTokenAt(text, nextIdx);
			if (nameTok?.value === targetName) {
				slice = text.slice(blockStart, blockEnd);
				return true;
			}
			return false;
		},
	);
	return slice;
}

function scanFootprintMetadata(text) {
	const start = findRootBodyStart(text);
	if (start === -1) return { descr: "", tags: "" };
	let descr = "";
	let tags = "";
	forEachChildBlock(text, start, text.length, (head, nextIdx) => {
		if (head === "descr") {
			const tok = readTokenAt(text, nextIdx);
			if (tok) descr = tok.value;
		} else if (head === "tags") {
			const tok = readTokenAt(text, nextIdx);
			if (tok) tags = tok.value;
		}
		return Boolean(descr && tags);
	});
	return { descr, tags };
}

async function readCachedText(filePath, fsImpl, textCache) {
	if (textCache.has(filePath)) {
		const cached = textCache.get(filePath);
		textCache.delete(filePath);
		textCache.set(filePath, cached);
		return cached;
	}
	try {
		const content = await fsImpl.readFile(filePath, "utf8");
		if (textCache.size >= MAX_CACHED_FILES) {
			const oldestKey = textCache.keys().next().value;
			textCache.delete(oldestKey);
		}
		textCache.set(filePath, content);
		return content;
	} catch {
		// File read error returns null
		return null;
	}
}

async function loadAstArray(filePath, ctx) {
	const content = await readCachedText(filePath, ctx.fsImpl, ctx.fileCache);
	if (!content) return null;
	try {
		const ast = parse(content);
		return Array.isArray(ast) ? ast : null;
	} catch {
		// File read or sexpr parse error produces null
		return null;
	}
}

function getNameMatchTier(name, q) {
	if (name === q) return 1;
	if (name.startsWith(q)) return 2;
	if (name.includes(q)) return 3;
	return 0;
}

function matchesAnyText(values, q) {
	return values.some((v) =>
		String(v ?? "")
			.toLowerCase()
			.includes(q),
	);
}

function getMatchTier(item, q) {
	const name = String(item.name ?? "").toLowerCase();
	const nameTier = getNameMatchTier(name, q);
	if (nameTier > 0) return nameTier;
	if (matchesAnyText([item.keywords, item.description], q)) return 4;
	return 0;
}

function compareSearchResults(a, b) {
	if (a.tier !== b.tier) return a.tier - b.tier;
	return a.item.name.localeCompare(b.item.name);
}

function searchItems(items, query, limit = 50) {
	const q = String(query ?? "")
		.trim()
		.toLowerCase();
	if (!q) {
		return items.slice(0, limit);
	}
	const scored = [];
	for (const item of items) {
		const tier = getMatchTier(item, q);
		if (tier > 0) {
			scored.push({ item, tier });
		}
	}
	scored.sort(compareSearchResults);
	return scored.slice(0, limit).map((s) => s.item);
}

function isSubUnit(name) {
	return /_\d+_\d+$/.test(name);
}

async function listDirFiles(dirPath, fsImpl, ext) {
	if (!dirPath || typeof dirPath !== "string") return [];
	try {
		const entries = await fsImpl.readdir(dirPath);
		return entries
			.map((e) => (typeof e === "string" ? e : e.name))
			.filter((name) => name.endsWith(ext));
	} catch {
		// Directory read failure returns empty list
		return [];
	}
}

async function runConcurrent(items, concurrency, fn) {
	let idx = 0;
	const workerCount = Math.min(concurrency, items.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (idx < items.length) {
			const current = items[idx++];
			await fn(current);
		}
	});
	await Promise.all(workers);
}

async function indexSymbolFile(ctx, fileName, index) {
	const filePath = path.join(ctx.symbolDir, fileName);
	try {
		const content = await ctx.fsImpl.readFile(filePath, "utf8");
		const fileBase = path.basename(fileName, ".kicad_sym");
		scanSymbolFileEntries(content, fileBase, index);
	} catch {
		// Skip unreadable symbol library files
		return;
	}
}

async function buildSymbolIndex(ctx) {
	const index = [];
	const files = await listDirFiles(ctx.symbolDir, ctx.fsImpl, ".kicad_sym");
	await runConcurrent(files, INDEX_CONCURRENCY, (fileName) =>
		indexSymbolFile(ctx, fileName, index),
	);
	return index;
}

async function indexFootprintFile(ctx, fileInfo, index) {
	const { dirPath, libName, fileName } = fileInfo;
	const filePath = path.join(dirPath, fileName);
	try {
		const content = await ctx.fsImpl.readFile(filePath, "utf8");
		const modName = path.basename(fileName, ".kicad_mod");
		const { descr, tags } = scanFootprintMetadata(content);
		index.push({
			libId: `${libName}:${modName}`,
			name: modName,
			description: descr,
			keywords: tags,
			tags,
		});
	} catch {
		// Skip unreadable footprint files
		return;
	}
}

async function indexFootprintPrettyDir(ctx, prettyName, index) {
	const libName = path.basename(prettyName, ".pretty");
	const dirPath = path.join(ctx.footprintDir, prettyName);
	const files = await listDirFiles(dirPath, ctx.fsImpl, ".kicad_mod");
	for (const fileName of files) {
		await indexFootprintFile(ctx, { dirPath, libName, fileName }, index);
	}
}

async function buildFootprintIndex(ctx) {
	const index = [];
	const prettyDirs = await listDirFiles(
		ctx.footprintDir,
		ctx.fsImpl,
		".pretty",
	);
	await runConcurrent(prettyDirs, INDEX_CONCURRENCY, (prettyName) =>
		indexFootprintPrettyDir(ctx, prettyName, index),
	);
	return index;
}

async function loadTargetAst(dir, libId, resolver, ctx) {
	if (!isValidLibId(libId)) return null;
	const filePath = resolver(dir, libId);
	if (!filePath) return null;
	return loadAstArray(filePath, ctx);
}

function parseSingleSymbolSlice(content, symbolName) {
	const slice = extractSymbolSlice(content, symbolName);
	if (!slice) return null;
	try {
		const ast = parse(slice);
		return Array.isArray(ast) ? ast : null;
	} catch {
		// Invalid sexpr returns null
		return null;
	}
}

function inheritParentProps(properties, parentProps) {
	for (const [k, v] of Object.entries(parentProps)) {
		if (!properties[k]) properties[k] = v;
	}
}

function applyParentSymbol(content, parentName, target) {
	if (!parentName) return;
	const parentNode = parseSingleSymbolSlice(content, parentName);
	if (!parentNode) return;
	inheritParentProps(target.properties, extractSymbolProperties(parentNode));
	if (target.pins.length === 0) target.pins = collectSymbolPins(parentNode);
	if (target.graphics.length === 0) {
		target.graphics = collectSymbolGraphics(parentNode);
	}
}

function resolveInheritedSymbol(content, symbolNode, libId, symbolName) {
	const result = {
		libId,
		name: symbolName,
		properties: extractSymbolProperties(symbolNode),
		pins: collectSymbolPins(symbolNode),
		graphics: collectSymbolGraphics(symbolNode),
	};
	applyParentSymbol(content, extractSubProp(symbolNode, "extends"), result);
	return result;
}

async function getSymbolFromDisk(ctx, libId) {
	if (!isValidLibId(libId)) return null;
	const filePath = resolveSymbolPath(ctx.symbolDir, libId);
	if (!filePath) return null;
	const content = await readCachedText(filePath, ctx.fsImpl, ctx.fileCache);
	if (!content) return null;

	const colonIdx = libId.indexOf(":");
	const symbolName = libId.slice(colonIdx + 1);
	const symbolNode = parseSingleSymbolSlice(content, symbolName);
	if (!symbolNode) return null;

	return resolveInheritedSymbol(content, symbolNode, libId, symbolName);
}

async function getFootprintFromDisk(ctx, libId) {
	const ast = await loadTargetAst(
		ctx.footprintDir,
		libId,
		resolveFootprintPath,
		ctx,
	);
	if (!ast) return null;
	return {
		libId,
		pads: collectFootprintPads(ast),
		graphics: collectFootprintGraphics(ast),
	};
}

function extractSymbolExtends(blockText) {
	const openIdx = blockText.indexOf("(");
	if (openIdx === -1) return null;
	const head = readTokenAt(blockText, openIdx + 1);
	const name = head ? readTokenAt(blockText, head.nextIndex) : null;
	if (!name) return null;
	let parent = null;
	forEachChildBlock(
		blockText,
		name.nextIndex,
		blockText.length - 1,
		(h, next) => {
			if (h === "extends") {
				parent = readTokenAt(blockText, next)?.value ?? null;
				return true;
			}
			return false;
		},
	);
	return parent;
}

async function getSymbolSourceFromDisk(ctx, libId) {
	if (!isValidLibId(libId)) return null;
	const filePath = resolveSymbolPath(ctx.symbolDir, libId);
	if (!filePath) return null;
	const content = await readCachedText(filePath, ctx.fsImpl, ctx.fileCache);
	if (!content) return null;

	const colonIdx = libId.indexOf(":");
	const symbolName = libId.slice(colonIdx + 1);
	const text = extractSymbolSlice(content, symbolName);
	if (!text) return null;

	const parentName = extractSymbolExtends(text);
	const parentText = parentName
		? extractSymbolSlice(content, parentName)
		: null;
	return { libId, text, parentText };
}

async function getFootprintSourceFromDisk(ctx, libId) {
	if (!isValidLibId(libId)) return null;
	const filePath = resolveFootprintPath(ctx.footprintDir, libId);
	if (!filePath) return null;
	const text = await readCachedText(filePath, ctx.fsImpl, ctx.fileCache);
	if (!text) return null;
	return { libId, text };
}

function lazyLoader(factory) {
	let promise = null;
	return () => {
		if (!promise) promise = factory();
		return promise;
	};
}

function createIndexLoaders(ctx) {
	return {
		getSymIndex: lazyLoader(() => buildSymbolIndex(ctx)),
		getFpIndex: lazyLoader(() => buildFootprintIndex(ctx)),
	};
}

async function safeExecute(action, fallback) {
	try {
		return await action();
	} catch {
		// Public method must not throw
		return fallback;
	}
}

async function checkAvailable(symbolDir, footprintDir, fsImpl) {
	return safeExecute(async () => {
		const [sOk, fOk] = await Promise.all([
			isDirectory(symbolDir, fsImpl),
			isDirectory(footprintDir, fsImpl),
		]);
		return sOk && fOk;
	}, false);
}

function libNameOf(libId) {
	if (typeof libId !== "string") return "";
	const colonIdx = libId.indexOf(":");
	return colonIdx === -1 ? "" : libId.slice(0, colonIdx);
}

function groupItemsByLibrary(items) {
	const map = new Map();
	if (!Array.isArray(items)) return map;
	for (const item of items) {
		const lib = libNameOf(item.libId);
		if (!lib) continue;
		let group = map.get(lib);
		if (!group) {
			group = [];
			map.set(lib, group);
		}
		group.push(item);
	}
	for (const list of map.values()) {
		list.sort((a, b) => a.name.localeCompare(b.name));
	}
	return map;
}

async function getGroupedLibraries(ctx, kind, indexPromise) {
	if (!indexPromise) return null;
	if (!ctx.groupCache) {
		ctx.groupCache = new Map();
	}
	if (!ctx.groupCache.has(kind)) {
		ctx.groupCache.set(
			kind,
			indexPromise.then((items) => groupItemsByLibrary(items)),
		);
	}
	return ctx.groupCache.get(kind);
}

function summarizeLibraries(grouped) {
	if (!grouped) return [];
	const result = [];
	for (const [name, items] of grouped.entries()) {
		result.push({ name, count: items.length });
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

function paginateLibraryItems(grouped, libName, opt = {}) {
	if (!grouped || typeof libName !== "string") {
		return { items: [], total: 0 };
	}
	const list = grouped.get(libName);
	if (!list) {
		return { items: [], total: 0 };
	}
	const limit = Math.max(0, opt.limit ?? 500);
	const offset = Math.max(0, opt.offset ?? 0);
	return {
		items: list.slice(offset, offset + limit),
		total: list.length,
	};
}

function resolveLibraryDirs(options) {
	const symbolDir =
		"symbolDir" in options
			? options.symbolDir
			: detectDefaultAssetDir(SYMBOL_ENV_VARS, "symbols");
	const footprintDir =
		"footprintDir" in options
			? options.footprintDir
			: detectDefaultAssetDir(FOOTPRINT_ENV_VARS, "footprints");
	return { symbolDir, footprintDir };
}

function createLibraryApi(ctx, loaders) {
	const indexFor = (kind) => {
		if (kind === "symbols") return loaders.getSymIndex();
		if (kind === "footprints") return loaders.getFpIndex();
		return null;
	};
	const queryGrouped = (kind, handler, fallback) =>
		safeExecute(async () => {
			const grouped = await getGroupedLibraries(ctx, kind, indexFor(kind));
			return handler(grouped);
		}, fallback);

	return {
		available: () =>
			checkAvailable(ctx.symbolDir, ctx.footprintDir, ctx.fsImpl),
		searchSymbols: (q, opt = {}) =>
			safeExecute(
				async () => searchItems(await loaders.getSymIndex(), q, opt.limit),
				[],
			),
		getSymbol: (libId) =>
			safeExecute(() => getSymbolFromDisk(ctx, libId), null),
		getSymbolSource: (libId) =>
			safeExecute(() => getSymbolSourceFromDisk(ctx, libId), null),
		searchFootprints: (q, opt = {}) =>
			safeExecute(
				async () => searchItems(await loaders.getFpIndex(), q, opt.limit),
				[],
			),
		getFootprint: (libId) =>
			safeExecute(() => getFootprintFromDisk(ctx, libId), null),
		getFootprintSource: (libId) =>
			safeExecute(() => getFootprintSourceFromDisk(ctx, libId), null),
		listLibraries: (kind) => queryGrouped(kind, summarizeLibraries, []),
		listLibraryItems: (kind, libName, opt = {}) =>
			queryGrouped(kind, (g) => paginateLibraryItems(g, libName, opt), {
				items: [],
				total: 0,
			}),
	};
}

function parseSchematicAst(text) {
	try {
		const ast = parse(text);
		return Array.isArray(ast) ? ast : null;
	} catch {
		// Malformed schematic text yields no embedded symbols
		return null;
	}
}

/**
 * Symbols a .kicad_sch embeds in its (lib_symbols ...) block, keyed by
 * lib_id, in the same shape the library route returns.
 * @param {string} text
 * @returns {Record<string, object>}
 */
export function embeddedLibSymbols(text) {
	const libNode = extractChildNode(parseSchematicAst(text), "lib_symbols");
	const entries = filterAndMapChildren(libNode, "symbol", (node) => {
		const libId = nodeSym(node[1]);
		const name = libId.slice(libId.indexOf(":") + 1);
		return [libId, resolveInheritedSymbol(text, node, libId, name)];
	});
	return Object.fromEntries(entries);
}

export function createKicadLibrary(options = {}) {
	const { symbolDir, footprintDir } = resolveLibraryDirs(options);
	const ctx = {
		symbolDir,
		footprintDir,
		fsImpl: options.fsImpl ?? fs.promises,
		fileCache: new Map(),
		groupCache: new Map(),
	};
	return createLibraryApi(ctx, createIndexLoaders(ctx));
}
