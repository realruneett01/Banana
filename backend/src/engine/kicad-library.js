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

function resolveSymbolPath(symbolDir, libId) {
	if (!symbolDir || typeof symbolDir !== "string") return null;
	if (!isValidLibId(libId)) return null;
	const colonIdx = libId.indexOf(":");
	const fileBase = libId.slice(0, colonIdx);
	const targetPath = path.join(symbolDir, `${fileBase}.kicad_sym`);
	return isPathSafe(symbolDir, targetPath) ? targetPath : null;
}

function resolveFootprintPath(footprintDir, libId) {
	if (!footprintDir || typeof footprintDir !== "string") return null;
	if (!isValidLibId(libId)) return null;
	const colonIdx = libId.indexOf(":");
	const lib = libId.slice(0, colonIdx);
	const name = libId.slice(colonIdx + 1);
	const targetPath = path.join(
		footprintDir,
		`${lib}.pretty`,
		`${name}.kicad_mod`,
	);
	return isPathSafe(footprintDir, targetPath) ? targetPath : null;
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

function collectUnitPins(unitNode) {
	const pins = [];
	for (const child of unitNode) {
		if (Array.isArray(child) && nodeSym(child[0]) === "pin") {
			pins.push(parsePinNode(child));
		}
	}
	return pins;
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
	const pads = [];
	for (const child of fpNode) {
		if (Array.isArray(child) && nodeSym(child[0]) === "pad") {
			pads.push(parsePadNode(child));
		}
	}
	return pads;
}

function collectFootprintGraphics(fpNode) {
	const graphics = [];
	for (const child of fpNode) {
		if (!Array.isArray(child)) continue;
		const head = nodeSym(child[0]);
		if (!FP_METADATA_HEADS.has(head)) {
			graphics.push(child);
		}
	}
	return graphics;
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

function getMatchTier(item, q) {
	const name = (item.name || "").toLowerCase();
	if (name === q) return 1;
	if (name.startsWith(q)) return 2;
	if (name.includes(q)) return 3;
	const keywords = (item.keywords || "").toLowerCase();
	const desc = (item.description || "").toLowerCase();
	if (keywords.includes(q) || desc.includes(q)) return 4;
	return 0;
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
	scored.sort((a, b) => {
		if (a.tier !== b.tier) return a.tier - b.tier;
		return a.item.name.localeCompare(b.item.name);
	});
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

async function indexSymbolFile(ctx, fileName, index) {
	const filePath = path.join(ctx.symbolDir, fileName);
	const ast = await loadSexprFile(filePath, ctx.fsImpl, ctx.fileCache);
	if (!ast || !Array.isArray(ast)) return;
	const fileBase = path.basename(fileName, ".kicad_sym");
	for (const child of ast) {
		if (Array.isArray(child) && nodeSym(child[0]) === "symbol") {
			addSymbolToIndex(child, fileBase, index);
		}
	}
}

async function buildSymbolIndex(ctx) {
	const index = [];
	if (!ctx.symbolDir) return index;
	try {
		const files = await ctx.fsImpl.readdir(ctx.symbolDir);
		for (const file of files) {
			const fileName = typeof file === "string" ? file : file.name;
			if (fileName.endsWith(".kicad_sym")) {
				await indexSymbolFile(ctx, fileName, index);
			}
		}
	} catch {
		// Directory read failure returns empty index
	}
	return index;
}

async function indexFootprintFile(ctx, fileInfo, index) {
	const { dirPath, libName, fileName } = fileInfo;
	const filePath = path.join(dirPath, fileName);
	const ast = await loadSexprFile(filePath, ctx.fsImpl, ctx.fileCache);
	if (!ast || !Array.isArray(ast)) return;
	const modName = path.basename(fileName, ".kicad_mod");
	const descr = extractSubProp(ast, "descr");
	const tags = extractSubProp(ast, "tags");
	index.push({
		libId: `${libName}:${modName}`,
		name: modName,
		description: descr,
		keywords: tags,
		tags,
	});
}

async function indexFootprintDir(ctx, prettyName, index) {
	if (!prettyName.endsWith(".pretty")) return;
	const libName = path.basename(prettyName, ".pretty");
	const dirPath = path.join(ctx.footprintDir, prettyName);
	try {
		const files = await ctx.fsImpl.readdir(dirPath);
		for (const file of files) {
			const fileName = typeof file === "string" ? file : file.name;
			if (fileName.endsWith(".kicad_mod")) {
				await indexFootprintFile(ctx, { dirPath, libName, fileName }, index);
			}
		}
	} catch {
		// Directory read failure skipped for this library
	}
}

async function buildFootprintIndex(ctx) {
	const index = [];
	if (!ctx.footprintDir) return index;
	try {
		const entries = await ctx.fsImpl.readdir(ctx.footprintDir);
		for (const entry of entries) {
			const entryName = typeof entry === "string" ? entry : entry.name;
			await indexFootprintDir(ctx, entryName, index);
		}
	} catch {
		// Directory read failure returns empty index
	}
	return index;
}

function findSymbolInLib(ast, symbolName) {
	for (const child of ast) {
		if (Array.isArray(child) && nodeSym(child[0]) === "symbol") {
			if (nodeSym(child[1]) === symbolName) {
				return child;
			}
		}
	}
	return null;
}

async function getSymbolFromDisk(ctx, libId) {
	if (!isValidLibId(libId)) return null;
	const filePath = resolveSymbolPath(ctx.symbolDir, libId);
	if (!filePath) return null;
	const ast = await loadSexprFile(filePath, ctx.fsImpl, ctx.fileCache);
	if (!ast || !Array.isArray(ast)) return null;
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
	if (!isValidLibId(libId)) return null;
	const filePath = resolveFootprintPath(ctx.footprintDir, libId);
	if (!filePath) return null;
	const ast = await loadSexprFile(filePath, ctx.fsImpl, ctx.fileCache);
	if (!ast || !Array.isArray(ast)) return null;
	return {
		libId,
		pads: collectFootprintPads(ast),
		graphics: collectFootprintGraphics(ast),
	};
}

function createIndexLoaders(ctx) {
	let symPromise = null;
	let fpPromise = null;
	return {
		getSymIndex: () => {
			if (!symPromise) symPromise = buildSymbolIndex(ctx);
			return symPromise;
		},
		getFpIndex: () => {
			if (!fpPromise) fpPromise = buildFootprintIndex(ctx);
			return fpPromise;
		},
	};
}

async function checkAvailable(symbolDir, footprintDir, fsImpl) {
	try {
		const [sOk, fOk] = await Promise.all([
			isDirectory(symbolDir, fsImpl),
			isDirectory(footprintDir, fsImpl),
		]);
		return sOk && fOk;
	} catch {
		// Suppress unexpected stat errors
		return false;
	}
}

async function runSearchSymbols(loaders, query, limit) {
	try {
		const idx = await loaders.getSymIndex();
		return searchItems(idx, query, limit);
	} catch {
		// Public method must not throw
		return [];
	}
}

async function runSearchFootprints(loaders, query, limit) {
	try {
		const idx = await loaders.getFpIndex();
		return searchItems(idx, query, limit);
	} catch {
		// Public method must not throw
		return [];
	}
}

async function safeGetSymbol(ctx, libId) {
	try {
		return await getSymbolFromDisk(ctx, libId);
	} catch {
		// Public method must not throw
		return null;
	}
}

async function safeGetFootprint(ctx, libId) {
	try {
		return await getFootprintFromDisk(ctx, libId);
	} catch {
		// Public method must not throw
		return null;
	}
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
		searchSymbols: (q, opt = {}) => runSearchSymbols(loaders, q, opt.limit),
		getSymbol: (libId) => safeGetSymbol(ctx, libId),
		searchFootprints: (q, opt = {}) =>
			runSearchFootprints(loaders, q, opt.limit),
		getFootprint: (libId) => safeGetFootprint(ctx, libId),
	};
}
