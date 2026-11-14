// Whole-project ERC: load a root sheet and every sub-sheet it references,
// merge nets across sheets the way KiCad does, then run the pin-type and
// drive checks. Power ports name a net globally but do not drive it; only a
// power_out pin (regulator output, PWR_FLAG) does.
import fs from "node:fs";
import path from "node:path";
import { runPinTypeErc } from "./erc.js";
import { newId } from "./ids.js";
import { kicadSchToErcGraph, UnionFind } from "./kicad-sch-to-ir.js";

export const MAX_SHEETS = 200;
export const MAX_DEPTH = 32;
const SCH_EXT = ".kicad_sch";

const normalizeSheetFile = (file) =>
	path.posix.normalize(String(file).replace(/\\/g, "/"));

function childProblem(chain, file) {
	if (!file || file === ".") return "sheet without Sheetfile";
	if (chain.includes(file)) return `sheet cycle: ${file}`;
	if (chain.length >= MAX_DEPTH)
		return `sheet depth limit ${MAX_DEPTH}: ${file}`;
	return null;
}

function childInstances(parent, sheets, warnings) {
	const out = [];
	for (const sheet of sheets) {
		const file = normalizeSheetFile(sheet.file);
		const problem = childProblem(parent.chain, file);
		if (problem) warnings.push(problem);
		else
			out.push({
				file,
				path: `${parent.path}${sheet.uuid}/`,
				chain: [...parent.chain, file],
			});
	}
	return out;
}

function importSheet(inst, readSheet, warnings) {
	try {
		const graph = kicadSchToErcGraph(readSheet(inst.file));
		if (graph.ok) return graph;
		warnings.push(`bad sheet ${inst.file}: ${graph.errors.join("; ")}`);
	} catch (err) {
		warnings.push(err.message);
	}
	return null;
}

// Sheet instances, breadth first: a sheet file used N times gives N
// instances, each imported on its own so its parts stay distinct.
function walkSheets(rootFile, readSheet, warnings) {
	const instances = [];
	const queue = [{ file: rootFile, path: "/", chain: [rootFile] }];
	while (queue.length > 0 && instances.length < MAX_SHEETS) {
		const inst = queue.shift();
		const graph = importSheet(inst, readSheet, warnings);
		if (!graph) continue;
		instances.push({ ...inst, graph });
		queue.push(...childInstances(inst, graph.sheets, warnings));
	}
	if (queue.length > 0) warnings.push(`sheet limit ${MAX_SHEETS} reached`);
	return instances;
}

// Groups sharing a key are one net: global names project-wide, a
// hierarchical label with its parent's sheet pin of the same name.
function linkKey(inst, link) {
	if (link.kind === "global") return `global:${link.name}`;
	const owner =
		link.kind === "sheetPin" ? `${inst.path}${link.sheet}/` : inst.path;
	return `hier:${owner}:${link.name}`;
}

function addGroupNode(state, inst, group) {
	const id = state.nodes.push(group) - 1;
	state.uf.find(id);
	for (const link of group.links) state.uf.union(id, linkKey(inst, link));
}

function mergeGroups(groups) {
	const names = groups.map((g) => g.name).filter(Boolean);
	return {
		id: newId("net"),
		name: names.sort()[0] ?? "unnamed",
		pins: groups.flatMap((g) => g.pins),
		ercPins: groups.flatMap((g) => g.ercPins),
		// kicad-cli skips not-driven checks on a net with a no-connect flag.
		...(groups.some((g) => g.noConnect) && { driven: true }),
	};
}

// A lone pin is KiCad's pin_not_connected, never a not-driven error.
const hasPeers = (net) => net.pins.length + net.ercPins.length > 1;

function mergeNets(instances) {
	const state = { uf: new UnionFind(), nodes: [] };
	for (const inst of instances) {
		for (const group of inst.graph.groups) addGroupNode(state, inst, group);
	}
	const byRoot = new Map();
	state.nodes.forEach((group, id) => {
		const root = state.uf.find(id);
		if (!byRoot.has(root)) byRoot.set(root, []);
		byRoot.get(root).push(group);
	});
	return [...byRoot.values()].map(mergeGroups).filter(hasPeers);
}

function runWithReader(rootFile, readSheet, commit) {
	const warnings = [];
	const instances = walkSheets(rootFile, readSheet, warnings);
	if (instances.length === 0) return { ok: false, errors: warnings };
	const parts = instances.flatMap((inst) => inst.graph.parts);
	const issues = runPinTypeErc(parts, mergeNets(instances), { commit });
	return { ok: true, issues, warnings, sheets: instances.length };
}

// `texts` maps sheet file names (as in the Sheetfile property) to contents.
export function runProjectErcFromTexts(texts, rootFile, { commit = "" } = {}) {
	const readSheet = (file) => {
		if (!Object.hasOwn(texts ?? {}, file)) {
			throw new Error(`missing sheet: ${file}`);
		}
		return texts[file];
	};
	return runWithReader(normalizeSheetFile(rootFile), readSheet, commit);
}

function isInside(dir, target) {
	const rel = path.relative(dir, target);
	if (rel === "" || path.isAbsolute(rel)) return false;
	return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

function readInside(dir, file) {
	const target = path.resolve(dir, file);
	const ok = !path.isAbsolute(file) && file.endsWith(SCH_EXT);
	if (!ok || !isInside(dir, target)) {
		throw new Error(`refused sheet path: ${file}`);
	}
	if (!fs.existsSync(target)) throw new Error(`missing sheet: ${file}`);
	const real = fs.realpathSync(target);
	if (!isInside(dir, real)) throw new Error(`refused sheet path: ${file}`);
	return fs.readFileSync(real, "utf8");
}

// Reads only .kicad_sch files inside the root sheet's real folder; a
// symlink or junction pointing elsewhere is refused after realpath.
function projectReader(rootPath) {
	const realRoot = fs.realpathSync(path.resolve(rootPath));
	const dir = path.dirname(realRoot);
	const cache = new Map();
	const readSheet = (file) => {
		if (!cache.has(file)) cache.set(file, readInside(dir, file));
		return cache.get(file);
	};
	return { rootFile: path.basename(realRoot), readSheet };
}

export function runProjectErc(rootPath, { commit = "" } = {}) {
	if (typeof rootPath !== "string" || !rootPath.endsWith(SCH_EXT)) {
		return { ok: false, errors: ["root must be a .kicad_sch file"] };
	}
	if (!fs.existsSync(rootPath)) {
		return { ok: false, errors: [`missing root sheet: ${rootPath}`] };
	}
	const { rootFile, readSheet } = projectReader(rootPath);
	return runWithReader(rootFile, readSheet, commit);
}
