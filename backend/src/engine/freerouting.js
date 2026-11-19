import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse, serialize, sym } from "./sexpr.js";

const DEFAULT_TIMEOUT_MS = 300000;

function buildStructureNode(boardW, boardH, rules) {
	const wUm = Math.round(boardW * 1000);
	const hUm = Math.round(boardH * 1000);
	const traceWidthUm = Math.round((rules?.traceWidthMm ?? 0.25) * 1000);
	const clearanceUm = Math.round((rules?.clearanceMm ?? 0.2) * 1000);

	return [
		sym("structure"),
		[sym("layer"), sym("F.Cu"), [sym("type"), sym("signal")]],
		[sym("layer"), sym("B.Cu"), [sym("type"), sym("signal")]],
		[
			sym("boundary"),
			[sym("path"), sym("pcb"), 0, 0, 0, wUm, 0, wUm, hUm, 0, hUm, 0, 0],
		],
		[
			sym("rule"),
			[sym("width"), traceWidthUm],
			[sym("clearance"), clearanceUm],
		],
	];
}

function toPlaceNode(part) {
	const x = Math.round((part.placement?.x ?? 0) * 1000);
	const y = Math.round((part.placement?.y ?? 0) * 1000);
	const side = part.placement?.side === "B" ? "back" : "front";
	const rot = part.placement?.rot ?? 0;
	return [sym("place"), String(part.ref), x, y, sym(side), rot];
}

function buildPlacementNode(parts) {
	const groups = new Map();
	for (const part of parts) {
		if (!part.placement) continue;
		if (!groups.has(part.footprint)) {
			groups.set(part.footprint, []);
		}
		groups.get(part.footprint).push(toPlaceNode(part));
	}
	const components = [];
	for (const [footprint, places] of groups.entries()) {
		components.push([sym("component"), String(footprint), ...places]);
	}
	return [sym("placement"), ...components];
}

function getPads(footprintDef) {
	if (!footprintDef) return [];
	return Array.isArray(footprintDef) ? footprintDef : (footprintDef.pads ?? []);
}

function buildPadstack(name, wUm, hUm) {
	const halfW = Math.round(wUm / 2);
	const halfH = Math.round(hUm / 2);
	return [
		sym("padstack"),
		String(name),
		[sym("shape"), [sym("rect"), sym("F.Cu"), -halfW, -halfH, halfW, halfH]],
		[sym("shape"), [sym("rect"), sym("B.Cu"), -halfW, -halfH, halfW, halfH]],
		[sym("attach"), sym("off")],
	];
}

function buildImageNode(footprint, pads, padstacks) {
	const pins = [];
	for (const pad of pads) {
		const wUm = Math.round((pad.size?.[0] ?? 1) * 1000);
		const hUm = Math.round((pad.size?.[1] ?? 1) * 1000);
		const padstackName = `Rect[T]Pad_${wUm}x${hUm}_um`;
		if (!padstacks.has(padstackName)) {
			padstacks.set(padstackName, buildPadstack(padstackName, wUm, hUm));
		}
		const xUm = Math.round((pad.at?.[0] ?? 0) * 1000);
		const yUm = Math.round((pad.at?.[1] ?? 0) * 1000);
		pins.push([sym("pin"), padstackName, String(pad.number), xUm, yUm]);
	}
	return [sym("image"), String(footprint), ...pins];
}

function buildLibraryNode(parts, footprints) {
	const uniqueFootprints = new Set(parts.map((p) => p.footprint));
	const padstacks = new Map();
	const images = [];
	for (const fp of uniqueFootprints) {
		const pads = getPads(footprints[fp]);
		images.push(buildImageNode(fp, pads, padstacks));
	}
	return [sym("library"), ...images, ...padstacks.values()];
}

function collectPinRefs(pins, partMap) {
	const refs = [];
	for (const pin of pins ?? []) {
		const ref = partMap.get(pin.partId);
		if (ref) {
			refs.push(`${ref}-${pin.pin}`);
		}
	}
	return refs;
}

function buildNetworkNode(parts, nets) {
	const partMap = new Map();
	for (const part of parts) {
		partMap.set(part.id, part.ref);
	}
	const netNodes = [];
	for (const net of nets) {
		const pinRefs = collectPinRefs(net.pins, partMap);
		netNodes.push([sym("net"), String(net.name), [sym("pins"), ...pinRefs]]);
	}
	return [sym("network"), ...netNodes];
}

function buildParserNode() {
	return [
		sym("parser"),
		[sym("string_quote"), sym("'")],
		[sym("space_in_quoted_tokens"), sym("on")],
		[sym("host_cad"), "banana"],
	];
}

export function irToDsn(
	ir,
	{
		boardW,
		boardH,
		footprints = {},
		rules = { traceWidthMm: 0.25, clearanceMm: 0.2 },
	} = {},
) {
	const parts = ir?.parts ?? [];
	const nets = ir?.nets ?? [];
	const pcbName = ir?.name ?? "board";

	const ast = [
		sym("pcb"),
		String(pcbName),
		buildParserNode(),
		[sym("resolution"), sym("um"), 10],
		[sym("unit"), sym("um")],
		buildStructureNode(boardW, boardH, rules),
		buildPlacementNode(parts),
		buildLibraryNode(parts, footprints),
		buildNetworkNode(parts, nets),
		[sym("wiring")],
	];

	return serialize(ast);
}

function isQuoted(val) {
	if (val.length < 2) {
		return false;
	}
	const first = val[0];
	if (first !== val[val.length - 1]) {
		return false;
	}
	return first === '"' || first === "'";
}

function stripQuotes(val) {
	if (isQuoted(val)) {
		return val.slice(1, -1);
	}
	return val;
}

function getAtomName(node) {
	if (node === null || node === undefined) return "";
	const val =
		typeof node === "object" && typeof node.sym === "string"
			? node.sym
			: String(node);
	return stripQuotes(val);
}

function isTag(node, tag) {
	if (!Array.isArray(node) || node.length === 0) return false;
	const first = node[0];
	return (typeof first === "object" && first?.sym === tag) || first === tag;
}

function extractWireFromPath(net, pathNode, wires) {
	const layer = getAtomName(pathNode[1]);
	const widthMm = Number(pathNode[2]) / 1000;
	const rawCoords = pathNode.slice(3);
	const points = [];
	for (let i = 0; i + 1 < rawCoords.length; i += 2) {
		points.push([Number(rawCoords[i]) / 1000, Number(rawCoords[i + 1]) / 1000]);
	}
	wires.push({ net, layer, widthMm, points });
}

function extractVia(net, viaNode, vias) {
	if (typeof viaNode[1] === "number" && typeof viaNode[2] === "number") {
		vias.push({ net, x: viaNode[1] / 1000, y: viaNode[2] / 1000 });
		return;
	}
	if (typeof viaNode[2] === "number" && typeof viaNode[3] === "number") {
		vias.push({ net, x: viaNode[2] / 1000, y: viaNode[3] / 1000 });
	}
}

function extractPathsFromWire(netName, wireNode, wires) {
	for (let j = 1; j < wireNode.length; j++) {
		if (isTag(wireNode[j], "path")) {
			extractWireFromPath(netName, wireNode[j], wires);
		}
	}
}

function processNetChild(netName, child, wires, vias) {
	if (isTag(child, "wire")) {
		extractPathsFromWire(netName, child, wires);
	} else if (isTag(child, "path")) {
		extractWireFromPath(netName, child, wires);
	} else if (isTag(child, "via")) {
		extractVia(netName, child, vias);
	}
}

function extractRoutes(node, wires, vias) {
	if (!Array.isArray(node)) return;
	if (isTag(node, "net")) {
		const netName = getAtomName(node[1]);
		for (let i = 2; i < node.length; i++) {
			processNetChild(netName, node[i], wires, vias);
		}
		return;
	}
	for (const child of node) {
		extractRoutes(child, wires, vias);
	}
}

export function parseSes(text) {
	if (typeof text !== "string" || text.trim().length === 0) {
		return { wires: [], vias: [] };
	}
	let ast;
	try {
		ast = parse(text);
	} catch {
		return { wires: [], vias: [] };
	}
	if (!ast) {
		return { wires: [], vias: [] };
	}
	const wires = [];
	const vias = [];
	extractRoutes(ast, wires, vias);
	return { wires, vias };
}

function runExec(execFn, file, args, options) {
	return new Promise((resolve, reject) => {
		let done = false;
		const cb = (err, stdout, stderr) => {
			if (done) return;
			done = true;
			err ? reject(err) : resolve({ stdout, stderr });
		};
		try {
			const res = execFn(file, args, options, cb);
			if (res?.then) {
				res.then(
					(v) => !done && resolve(v),
					(e) => !done && reject(e),
				);
			}
		} catch (err) {
			if (!done) reject(err);
		}
	});
}

async function validateWorkDir(workDir) {
	if (!workDir || typeof workDir !== "string") {
		throw new Error("workDir must be a non-empty string");
	}
	if (!path.isAbsolute(workDir)) {
		throw new Error(`workDir must be an absolute path: ${workDir}`);
	}
	if (workDir.includes("..")) {
		throw new Error(`workDir must not contain '..' segments: ${workDir}`);
	}
	let stat;
	try {
		stat = await fs.promises.stat(workDir);
	} catch {
		throw new Error(`workDir does not exist: ${workDir}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`workDir is not a directory: ${workDir}`);
	}
}

async function invokeFreerouting(cfg, dsnPath, sesPath) {
	const args = [
		"-jar",
		cfg.jarPath,
		"-de",
		dsnPath,
		"-do",
		sesPath,
		"-mp",
		"20",
	];
	try {
		await runExec(cfg.execFileFn, cfg.javaPath, args, {
			timeout: cfg.timeoutMs,
		});
	} catch (err) {
		throw new Error(
			`Freerouting execution failed: ${err?.message ?? "unknown error"}`,
		);
	}
}

async function executeRouting(cfg, workDir, dsnText) {
	const dsnPath = path.join(workDir, "in.dsn");
	const sesPath = path.join(workDir, "out.ses");
	try {
		await fs.promises.writeFile(dsnPath, dsnText, "utf8");
	} catch (err) {
		throw new Error(
			`Failed to write DSN file: ${err?.message ?? "unknown error"}`,
		);
	}
	await invokeFreerouting(cfg, dsnPath, sesPath);
	let sesContent;
	try {
		sesContent = await fs.promises.readFile(sesPath, "utf8");
	} catch (err) {
		throw new Error(
			`Failed to read Freerouting output file: ${err?.message ?? "unknown error"}`,
		);
	}
	return parseSes(sesContent);
}

export function createFreerouting({
	jarPath = process.env.FREEROUTING_JAR,
	javaPath = "java",
	execFileFn = execFile,
	timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
	const isAvailable = Boolean(
		jarPath && typeof jarPath === "string" && jarPath.trim().length > 0,
	);
	const config = { jarPath, javaPath, execFileFn, timeoutMs };

	return {
		available: () => isAvailable,
		route: async ({ dsnText, workDir }) => {
			await validateWorkDir(workDir);
			if (!isAvailable) {
				throw new Error("Freerouting JAR path is not configured");
			}
			return executeRouting(config, workDir, dsnText);
		},
	};
}
