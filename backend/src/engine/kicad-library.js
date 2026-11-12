import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "./sexpr.js";

const LIB_ID_REGEX = /^[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+ -]+$/;
const MAX_CACHED_FILES = 16;
const INDEX_CONCURRENCY = 24;

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

function detectDefaultAssetDir(envVars, subDir) {
	for (const key of envVars) {
		const val = process.env[key];
		if (val && fs.existsSync(val)) return val;
	}
	const candidates = [];
	if (process.env.KICAD_CLI_PATH) {
		const cliDir = path.dirname(process.env.KICAD_CLI_PATH);
		candidates.push(
			path.resolve(cliDir, "..", "share", "kicad", subDir),
			path.resolve(cliDir, "..", "SharedSupport", subDir),
		);
	}
	const osBuilder = STANDARD_LIBRARY_CANDIDATES[os.platform()];
	if (osBuilder) candidates.push(...osBuilder(subDir));
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

function parsePadNode(padNode) {
	return {
		number: nodeSym(padNode[1]),
		type: nodeSym(padNode[2]),
		shape: nodeSym(padNode[3]),
		at: extractAt(padNode),
		size: extractPadSize(padNode),
		layers: extractPadLayers(padNode),
	};
}

function collectFootprintPads(fpNode) {
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

// Fast paren-aware scanner helpers to avoid allocating multi-GB ASTs across 390+ MB of KiCad libs
function skipWs(text, i) {
	while (i < text.length && text.charCodeAt(i) <= 32) {
		i++;
	}
	return i;
}

function unescapeChar(c) {
	if (c === "n") return "\n";
	if (c === "r") return "\r";
	if (c === "t") return "\t";
	return c;
}

function readQuotedAt(text, start) {
	let val = "";
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '"') {
			return { value: val, nextIndex: i + 1 };
		}
		if (ch === "\\") {
			i++;
			if (i >= text.length) break;
			val += unescapeChar(text[i]);
		} else {
			val += ch;
		}
		i++;
	}
	return { value: val, nextIndex: i };
}

function readAtomAt(text, start) {
	let i = start;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (code <= 32 || code === 40 || code === 41) break;
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
	let inString = false;
	let i = openIdx;
	while (i < text.length) {
		const code = text.charCodeAt(i);
		if (inString) {
			if (code === 92) {
				i += 2;
				continue;
			}
			if (code === 34) inString = false;
		} else {
			if (code === 34) inString = true;
			else if (code === 40) depth++;
			else if (code === 41) {
				depth--;
				if (depth === 0) return i + 1;
			}
		}
		i++;
	}
	return text.length;
}

function scanSymbolBlockProps(text, bodyStart, blockEnd) {
	const props = {
		Reference: "",
		Value: "",
		Description: "",
		ki_keywords: "",
		Footprint: "",
	};
	let i = skipWs(text, bodyStart);
	while (i < blockEnd) {
		if (text[i] === "(") {
			const childEnd = findBlockEnd(text, i);
			const headTok = readTokenAt(text, i + 1);
			if (headTok?.value === "property") {
				const keyTok = readTokenAt(text, headTok.nextIndex);
				const valTok = keyTok ? readTokenAt(text, keyTok.nextIndex) : null;
				if (keyTok && valTok) {
					props[keyTok.value] = valTok.value;
				}
			}
			i = skipWs(text, childEnd);
		} else if (text[i] === '"') {
			i = skipWs(text, readQuotedAt(text, i).nextIndex);
		} else {
			i = skipWs(text, i + 1);
		}
	}
	return props;
}

function findRootBodyStart(text) {
	const rootOpen = text.indexOf("(");
	if (rootOpen === -1) return -1;
	const rootHead = readTokenAt(text, rootOpen + 1);
	return rootHead ? rootHead.nextIndex : -1;
}

function scanSymbolFileEntries(text, fileBase, index) {
	let i = findRootBodyStart(text);
	if (i === -1) return;
	i = skipWs(text, i);
	while (i < text.length) {
		if (text[i] === "(") {
			const blockEnd = findBlockEnd(text, i);
			const headTok = readTokenAt(text, i + 1);
			if (headTok?.value === "symbol") {
				const nameTok = readTokenAt(text, headTok.nextIndex);
				if (nameTok?.value && !isSubUnit(nameTok.value)) {
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
				}
			}
			i = skipWs(text, blockEnd);
		} else if (text[i] === '"') {
			i = skipWs(text, readQuotedAt(text, i).nextIndex);
		} else {
			i = skipWs(text, i + 1);
		}
	}
}

function extractSymbolSlice(text, targetName) {
	let i = findRootBodyStart(text);
	if (i === -1) return null;
	i = skipWs(text, i);
	while (i < text.length) {
		if (text[i] === "(") {
			const blockEnd = findBlockEnd(text, i);
			const headTok = readTokenAt(text, i + 1);
			if (headTok?.value === "symbol") {
				const nameTok = readTokenAt(text, headTok.nextIndex);
				if (nameTok?.value === targetName) {
					return text.slice(i, blockEnd);
				}
			}
			i = skipWs(text, blockEnd);
		} else if (text[i] === '"') {
			i = skipWs(text, readQuotedAt(text, i).nextIndex);
		} else {
			i = skipWs(text, i + 1);
		}
	}
	return null;
}

function scanFootprintMetadata(text) {
	let descr = "";
	let tags = "";
	let i = findRootBodyStart(text);
	if (i === -1) return { descr, tags };
	i = skipWs(text, i);
	while (i < text.length) {
		if (text[i] === "(") {
			const blockEnd = findBlockEnd(text, i);
			const headTok = readTokenAt(text, i + 1);
			if (headTok?.value === "descr") {
				const valTok = readTokenAt(text, headTok.nextIndex);
				if (valTok) descr = valTok.value;
			} else if (headTok?.value === "tags") {
				const valTok = readTokenAt(text, headTok.nextIndex);
				if (valTok) tags = valTok.value;
			}
			if (descr && tags) break;
			i = skipWs(text, blockEnd);
		} else if (text[i] === '"') {
			i = skipWs(text, readQuotedAt(text, i).nextIndex);
		} else {
			i = skipWs(text, i + 1);
		}
	}
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
		return null;
	}
}

function resolveInheritedSymbol(content, symbolNode, libId, symbolName) {
	const properties = extractSymbolProperties(symbolNode);
	let pins = collectSymbolPins(symbolNode);
	let graphics = collectSymbolGraphics(symbolNode);

	const parentName = extractSubProp(symbolNode, "extends");
	if (parentName) {
		const parentNode = parseSingleSymbolSlice(content, parentName);
		if (parentNode) {
			const parentProps = extractSymbolProperties(parentNode);
			for (const [k, v] of Object.entries(parentProps)) {
				if (!properties[k]) properties[k] = v;
			}
			if (pins.length === 0) pins = collectSymbolPins(parentNode);
			if (graphics.length === 0) graphics = collectSymbolGraphics(parentNode);
		}
	}

	return { libId, name: symbolName, properties, pins, graphics };
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

export function createKicadLibrary(options = {}) {
	const symbolDir =
		"symbolDir" in options
			? options.symbolDir
			: detectDefaultAssetDir(
					["KICAD_SYMBOL_DIR", "KICAD10_SYMBOL_DIR", "KICAD9_SYMBOL_DIR"],
					"symbols",
				);
	const footprintDir =
		"footprintDir" in options
			? options.footprintDir
			: detectDefaultAssetDir(
					[
						"KICAD_FOOTPRINT_DIR",
						"KICAD10_FOOTPRINT_DIR",
						"KICAD9_FOOTPRINT_DIR",
					],
					"footprints",
				);
	const fsImpl = options.fsImpl ?? fs.promises;
	const ctx = { symbolDir, footprintDir, fsImpl, fileCache: new Map() };
	const loaders = createIndexLoaders(ctx);

	return {
		available: () => checkAvailable(symbolDir, footprintDir, fsImpl),
		searchSymbols: (q, opt = {}) =>
			safeExecute(
				async () => searchItems(await loaders.getSymIndex(), q, opt.limit),
				[],
			),
		getSymbol: (libId) =>
			safeExecute(() => getSymbolFromDisk(ctx, libId), null),
		searchFootprints: (q, opt = {}) =>
			safeExecute(
				async () => searchItems(await loaders.getFpIndex(), q, opt.limit),
				[],
			),
		getFootprint: (libId) =>
			safeExecute(() => getFootprintFromDisk(ctx, libId), null),
	};
}
