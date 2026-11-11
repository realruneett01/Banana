import fs from "node:fs";
import path from "node:path";
import { parse } from "./sexpr.js";

const LIB_ID_REGEX = /^[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+ -]+$/;

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
]);

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

async function loadSexprFile(filePath, fsImpl, fileCache) {
	if (fileCache.has(filePath)) {
		return fileCache.get(filePath);
	}
	try {
		const content = await fsImpl.readFile(filePath, "utf8");
		const ast = parse(content);
		fileCache.set(filePath, ast);
		return ast;
	} catch {
		// File read or sexpr parse error produces null
		return null;
	}
}

async function loadAstArray(filePath, ctx) {
	const ast = await loadSexprFile(filePath, ctx.fsImpl, ctx.fileCache);
	return Array.isArray(ast) ? ast : null;
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

function addSymbolToIndex(symbolNode, fileBase, index) {
	const name = nodeSym(symbolNode[1]);
	if (!name || isSubUnit(name)) return;
	const properties = extractSymbolProperties(symbolNode);
	index.push({
		libId: `${fileBase}:${name}`,
		name,
		description: properties.Description || "",
		keywords: properties.ki_keywords || "",
		properties,
	});
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

async function indexSymbolFile(ctx, fileName, index) {
	const filePath = path.join(ctx.symbolDir, fileName);
	const ast = await loadAstArray(filePath, ctx);
	if (!ast) return;
	const fileBase = path.basename(fileName, ".kicad_sym");
	for (const child of ast) {
		if (Array.isArray(child) && nodeSym(child[0]) === "symbol") {
			addSymbolToIndex(child, fileBase, index);
		}
	}
}

async function buildSymbolIndex(ctx) {
	const index = [];
	const files = await listDirFiles(ctx.symbolDir, ctx.fsImpl, ".kicad_sym");
	for (const fileName of files) {
		await indexSymbolFile(ctx, fileName, index);
	}
	return index;
}

async function indexFootprintFile(ctx, fileInfo, index) {
	const { dirPath, libName, fileName } = fileInfo;
	const filePath = path.join(dirPath, fileName);
	const ast = await loadAstArray(filePath, ctx);
	if (!ast) return;
	const modName = path.basename(fileName, ".kicad_mod");
	const tags = extractSubProp(ast, "tags");
	index.push({
		libId: `${libName}:${modName}`,
		name: modName,
		description: extractSubProp(ast, "descr"),
		keywords: tags,
		tags,
	});
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
	for (const prettyName of prettyDirs) {
		await indexFootprintPrettyDir(ctx, prettyName, index);
	}
	return index;
}

function isMatchingSymbol(child, name) {
	if (!Array.isArray(child)) return false;
	return nodeSym(child[0]) === "symbol" && nodeSym(child[1]) === name;
}

function findSymbolInLib(ast, symbolName) {
	return ast.find((child) => isMatchingSymbol(child, symbolName)) ?? null;
}

async function loadTargetAst(dir, libId, resolver, ctx) {
	if (!isValidLibId(libId)) return null;
	const filePath = resolver(dir, libId);
	if (!filePath) return null;
	return loadAstArray(filePath, ctx);
}

async function getSymbolFromDisk(ctx, libId) {
	const ast = await loadTargetAst(ctx.symbolDir, libId, resolveSymbolPath, ctx);
	if (!ast) return null;
	const colonIdx = libId.indexOf(":");
	const symbolName = libId.slice(colonIdx + 1);
	const symbolNode = findSymbolInLib(ast, symbolName);
	if (!symbolNode) return null;
	return {
		libId,
		name: symbolName,
		properties: extractSymbolProperties(symbolNode),
		pins: collectSymbolPins(symbolNode),
		graphics: collectSymbolGraphics(symbolNode),
	};
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

export function createKicadLibrary({
	symbolDir = process.env.KICAD_SYMBOL_DIR,
	footprintDir = process.env.KICAD_FOOTPRINT_DIR,
	fsImpl = fs.promises,
} = {}) {
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
