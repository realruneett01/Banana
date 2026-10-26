import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { computeDiff } from "../diff-pipeline.js";
import { extractFileFromCommit } from "../git-extractor.js";
import { isSafeRef } from "../git-safety.js";
import {
	absolutePads,
	copperLite,
	ercLite,
	kicadDrc,
	kicadErc,
	netlistParity,
	placementLite,
	routingStatus,
} from "./checks.js";
import { getFootprint } from "./kicad-lib.js";
import { Design, DesignError, emptyDesign } from "./model.js";
import { autoroute } from "./router.js";
import { runAllTests } from "./simulate.js";
import { chamferTracks } from "./tidy.js";
import {
	boardViewTransform,
	renderBoardView,
	renderSchematicView,
} from "./views.js";
import { writeSchematic } from "./writer-sch.js";
import { rotatedBox, writePcb, writeProjectFile } from "./writer-pcb.js";

const execGit = promisify(execFile);
export const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

const locks = new Map();
/** Serialises operations per project so concurrent tool calls cannot interleave file writes. */
export async function withLock(name, fn) {
	const prev = locks.get(name) ?? Promise.resolve();
	let release;
	const next = new Promise((r) => {
		release = r;
	});
	locks.set(
		name,
		prev.then(() => next),
	);
	await prev;
	try {
		return await fn();
	} finally {
		release();
		if (locks.get(name) === next) locks.delete(name);
	}
}

export function projectDir(name) {
	if (typeof name !== "string" || !PROJECT_NAME.test(name))
		throw new DesignError(
			`Invalid project name "${name}" (lowercase letters, digits, dash, underscore; max 48)`,
		);
	const root = path.resolve(config.projectsDir);
	const dir = path.join(root, name);
	if (!dir.startsWith(root + path.sep))
		throw new DesignError("Invalid project path");
	return dir;
}

async function git(dir, ...args) {
	const { stdout } = await execGit(
		"git",
		[
			"-c",
			"user.name=Banana Design",
			"-c",
			"user.email=design@banana.invalid",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd: dir, timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
	);
	return stdout;
}

const stableJson = (data) => `${JSON.stringify(data, null, 2)}\n`;

export function listProjects() {
	if (!fs.existsSync(config.projectsDir)) return [];
	return fs
		.readdirSync(config.projectsDir, { withFileTypes: true })
		.filter(
			(e) =>
				e.isDirectory() &&
				PROJECT_NAME.test(e.name) &&
				fs.existsSync(path.join(config.projectsDir, e.name, "design.json")),
		)
		.map((e) => {
			const d = JSON.parse(
				fs.readFileSync(
					path.join(config.projectsDir, e.name, "design.json"),
					"utf8",
				),
			);
			return {
				name: e.name,
				title: d.title || "",
				parts: d.parts?.length ?? 0,
				nets: Object.keys(d.nets ?? {}).length,
				path: path.join(config.projectsDir, e.name),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createProject(name, title = "") {
	const dir = projectDir(name);
	if (fs.existsSync(dir))
		throw new DesignError(`Project "${name}" already exists`);
	fs.mkdirSync(dir, { recursive: true });
	await git(dir, "init", "-q", "-b", "main");
	fs.writeFileSync(
		path.join(dir, "design.json"),
		stableJson(emptyDesign(name, String(title).slice(0, 120))),
	);
	fs.writeFileSync(
		path.join(dir, ".gitignore"),
		"results/\n*.bak\n*-backups/\nfp-info-cache\n",
	);
	await git(dir, "add", "-A");
	await git(dir, "commit", "-q", "-m", "Create project");
	return { name, path: dir };
}

export function loadDesign(name) {
	const file = path.join(projectDir(name), "design.json");
	if (!fs.existsSync(file))
		throw new DesignError(
			`No project named "${name}". Use list_projects or create_project.`,
		);
	return Design.from(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveDesign(name, design) {
	fs.writeFileSync(
		path.join(projectDir(name), "design.json"),
		stableJson(design.data),
	);
}

/** Writes the KiCad files from design.json and commits the result. */
export async function build(
	name,
	message = "Update design",
	{ commit: doCommit = true } = {},
) {
	const dir = projectDir(name);
	const design = loadDesign(name);
	const sch = writeSchematic(design);
	const pcb = writePcb(design);
	fs.writeFileSync(path.join(dir, `${name}.kicad_sch`), sch);
	fs.writeFileSync(path.join(dir, `${name}.kicad_pcb`), pcb.text);
	fs.writeFileSync(path.join(dir, `${name}.kicad_pro`), writeProjectFile(name));
	fs.writeFileSync(path.join(dir, "design.json"), stableJson(design.data));
	let dirty = false;
	if (doCommit) {
		await git(dir, "add", "-A");
		dirty = (await git(dir, "status", "--porcelain")).trim().length > 0;
		if (dirty) {
			await git(dir, "commit", "-q", "-m", String(message).slice(0, 200));
			writeRedo(dir, []); // new work replaces whatever Redo could have brought back
		}
	}
	const commit = (await git(dir, "rev-parse", "HEAD")).trim();
	return {
		commit,
		committed: dirty,
		files: {
			schematic: `${name}.kicad_sch`,
			board: `${name}.kicad_pcb`,
			project: `${name}.kicad_pro`,
		},
		board: pcb.board,
		placements: pcb.positions,
		directory: dir,
		openInKicad: path.join(dir, `${name}.kicad_pro`),
	};
}

const redoFile = (dir) => path.join(dir, ".git", "banana-redo.json");
function readRedo(dir) {
	try {
		const v = JSON.parse(fs.readFileSync(redoFile(dir), "utf8"));
		return Array.isArray(v) ? v.filter((x) => /^[0-9a-f]{40}$/.test(x)) : [];
	} catch {
		return [];
	}
}
function writeRedo(dir, list) {
	fs.writeFileSync(redoFile(dir), JSON.stringify(list));
}

const revParse = async (dir, rev) => {
	try {
		return (await git(dir, "rev-parse", "--verify", "-q", rev)).trim();
	} catch {
		return null;
	}
};

/**
 * Undo = move the branch back one build. The undone build stays reachable (a keep-ref) so Redo can bring it
 * back; nothing is rewritten or deleted. Unbuilt edits are committed first so they can be redone too.
 */
export async function undo(name) {
	return withLock(name, async () => {
		const dir = projectDir(name);
		loadDesign(name);
		if ((await git(dir, "status", "--porcelain")).trim())
			await build(name, "Unsaved changes");
		const head = await revParse(dir, "HEAD");
		const parent = await revParse(dir, "HEAD~1");
		if (!head || !parent) throw new DesignError("Nothing to undo");
		const message = (await git(dir, "log", "-1", "--format=%s", head)).trim();
		await git(dir, "update-ref", `refs/banana/keep/${head}`, head);
		writeRedo(dir, [...readRedo(dir), head]);
		await git(dir, "reset", "-q", "--hard", parent);
		return { head: parent, undone: head, message, canRedo: true };
	});
}

export async function redo(name) {
	return withLock(name, async () => {
		const dir = projectDir(name);
		loadDesign(name);
		const stack = readRedo(dir);
		const target = stack.at(-1);
		const head = await revParse(dir, "HEAD");
		if (!target || (await revParse(dir, `${target}~1`)) !== head) {
			writeRedo(dir, []);
			throw new DesignError("Nothing to redo");
		}
		await git(dir, "reset", "-q", "--hard", target);
		writeRedo(dir, stack.slice(0, -1));
		const message = (await git(dir, "log", "-1", "--format=%s", target)).trim();
		return { head: target, message, canRedo: stack.length > 1 };
	});
}

export async function history(name, limit = 30) {
	const dir = projectDir(name);
	const out = await git(
		dir,
		"log",
		`-n${Math.min(100, Math.max(1, limit))}`,
		"--format=%H|%h|%ad|%s",
		"--date=iso-strict",
	);
	return out
		.split("\n")
		.filter(Boolean)
		.map((l) => {
			const [hash, short, date, ...msg] = l.split("|");
			return { hash, short, date, message: msg.join("|") };
		});
}

/** Diffs two builds of the project using Banana's own engine. */
export async function diffBuilds(
	name,
	{ base = "HEAD~1", target = "HEAD", file = "board" } = {},
) {
	if (!isSafeRef(base) || !isSafeRef(target))
		throw new DesignError("Invalid commit reference");
	if (!["board", "schematic"].includes(file))
		throw new DesignError('file must be "board" or "schematic"');
	const dir = projectDir(name);
	const rel = file === "board" ? `${name}.kicad_pcb` : `${name}.kicad_sch`;
	const unique = `design_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const tmpDirs = [];
	try {
		const basePath = await extractFileFromCommit(
			dir,
			base,
			rel,
			`${unique}/base/${rel}`,
		);
		const targetPath = await extractFileFromCommit(
			dir,
			target,
			rel,
			`${unique}/target/${rel}`,
		);
		tmpDirs.push(path.join(config.tempRoot, unique));
		const payload = await computeDiff({
			basePath,
			targetPath,
			baseCommit: base,
			targetCommit: target,
			isPcb: file === "board",
		});
		return payload;
	} finally {
		for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
	}
}

export function summarizeDiff(payload) {
	const mods = payload.modifications ?? [];
	return {
		changes: mods.length,
		byAction: mods.reduce(
			(a, m) => ({ ...a, [m.action]: (a[m.action] ?? 0) + 1 }),
			{},
		),
		items: mods.slice(0, 60).map((m) => ({
			action: m.action,
			type: m.type,
			title: m.title,
			detail: m.detail,
			refDes: m.refDes,
			net: m.net,
			layer: m.layer,
		})),
		layersProcessed: payload.telemetry?.layersProcessed,
	};
}

/** Runs every check available and returns one structured report. */
export async function checkProject(name, { commit = true } = {}) {
	const dir = projectDir(name);
	const design = loadDesign(name);
	const built = await build(name, "Update design", { commit });
	const pcb = writePcb(design);
	const schPath = path.join(dir, `${name}.kicad_sch`);
	const pcbPath = path.join(dir, `${name}.kicad_pcb`);

	const lite = ercLite(design);
	const kErc = await kicadErc(schPath);
	const parity = await netlistParity(design, schPath);
	const drc = await kicadDrc(pcbPath);
	const placement = placementLite(design, pcb.positions, pcb.board);
	const copper = copperLite(design, pcb.positions);
	const routing = routingStatus(design, pcb.positions);
	const unrouted = Object.entries(routing)
		.filter(([, r]) => r.pads > 1 && !r.routed)
		.map(([net, r]) => ({ net, islands: r.islands }));

	const errors =
		[...lite, ...kErc.issues, ...placement, ...copper, ...drc.issues].filter(
			(i) => i.severity === "error",
		).length + (parity.status === "mismatch" ? 1 : 0);
	const warnings = [
		...lite,
		...kErc.issues,
		...placement,
		...copper,
		...drc.issues,
	].filter((i) => i.severity === "warning").length;
	return {
		commit: built.commit,
		ok: errors === 0 && unrouted.length === 0,
		errors,
		warnings,
		erc: {
			lite,
			kicad: {
				engine: kErc.engine,
				status: kErc.status,
				reason: kErc.reason,
				issues: kErc.issues,
			},
		},
		netlistParity: parity,
		placement,
		copper,
		routing: { complete: unrouted.length === 0, unrouted, nets: routing },
		drc: {
			engine: drc.engine,
			status: drc.status,
			reason: drc.reason,
			issues: drc.issues,
		},
		note: "ok means no errors and every multi-pad net is routed. Simulation is separate (run_simulation); electrical correctness beyond these checks needs a human review.",
	};
}

export async function simulateProject(name, only) {
	return runAllTests(loadDesign(name), { only });
}

export { absolutePads };

/**
 * Places and routes the board. Placement is frozen into the design first so that the tracks stay
 * valid when parts are added later (re-run autoroute after changes).
 */
export async function autoRoute(name, { orderSeed = 0 } = {}) {
	const design = loadDesign(name);
	const first = writePcb(design);
	for (const part of design.data.parts)
		if (!part.at && first.positions[part.ref])
			part.at = first.positions[part.ref];
	if (!design.data.board)
		design.data.board = {
			width: first.board.width,
			height: first.board.height,
		};
	design.clearRouting();
	const laidOut = writePcb(design);
	const result = autoroute(design, laidOut.positions, laidOut.board, {
		orderSeed,
	});
	design.data.vias = result.vias;
	design.data.tracks = result.tracks;
	const tidy = chamferTracks(design, laidOut.positions);
	design.data.tracks = tidy.tracks;
	saveDesign(name, design);
	return {
		failedNets: result.failed,
		...result.stats,
		chamfered: tidy.corners,
		chamferReverted: tidy.reverted,
		tracks: result.tracks.length,
		vias: result.vias.length,
	};
}

/** Everything the Studio needs to draw overlays and panels, without writing any file. */
export async function projectState(name) {
	const dir = projectDir(name);
	const design = loadDesign(name);
	const pcb = writePcb(design);
	const boardFile = path.join(dir, `${name}.kicad_pcb`);
	const built = fs.existsSync(boardFile);
	const needsBuild = !built || fs.readFileSync(boardFile, "utf8") !== pcb.text;
	const pads = absolutePads(design, pcb.positions);
	const netOfPin = new Map();
	for (const [net, def] of Object.entries(design.data.nets))
		for (const p of def.pins) netOfPin.set(p, net);
	const parts = design.data.parts.map((part) => {
		const at = pcb.positions[part.ref];
		const fp = part.footprint ? getFootprint(part.footprint) : null;
		const box = fp && at ? rotatedBox(fp.bbox, at.rot || 0) : null;
		return {
			ref: part.ref,
			symbol: part.symbol,
			value: part.value,
			footprint: part.footprint,
			placed: Boolean(part.at),
			at,
			courtyard: box
				? {
						minX: at.x + box.minX,
						maxX: at.x + box.maxX,
						minY: at.y + box.minY,
						maxY: at.y + box.maxY,
					}
				: null,
			pads: [...pads]
				.filter(([pin]) => pin.startsWith(`${part.ref}.`))
				.map(([pin, p]) => ({
					pin,
					x: p.x,
					y: p.y,
					w: p.w,
					h: p.h,
					net: netOfPin.get(pin) ?? null,
				})),
		};
	});
	let head = null;
	try {
		head = (await git(dir, "rev-parse", "HEAD")).trim();
	} catch {
		/* no commits yet */
	}
	return {
		name,
		title: design.data.title,
		head,
		built,
		needsBuild,
		board: pcb.board,
		transform: boardViewTransform(pcb.board),
		canUndo: Boolean(await revParse(dir, "HEAD~1")),
		canRedo: readRedo(dir).length > 0,
		parts,
		nets: design.summary().nets,
		tests: design.data.tests.map((t) => t.name),
	};
}

async function fileAtRev(name, rev, rel) {
	const unique = `view_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const out = await extractFileFromCommit(
		projectDir(name),
		rev,
		rel,
		`${unique}/${rel}`,
	);
	return {
		file: out,
		cleanup: () =>
			fs.rmSync(path.join(config.tempRoot, unique), {
				recursive: true,
				force: true,
			}),
	};
}

/** Native KiCad render of the board or schematic, from the built files or from any commit. */
export async function viewSvg(
	name,
	{ kind = "board", view = "front", rev = "working" } = {},
) {
	if (!["board", "schematic"].includes(kind))
		throw new DesignError('kind must be "board" or "schematic"');
	const rel = kind === "board" ? `${name}.kicad_pcb` : `${name}.kicad_sch`;
	let file;
	let cleanup = () => {};
	if (rev === "working") {
		file = path.join(projectDir(name), rel);
		if (!fs.existsSync(file))
			throw new DesignError("Nothing built yet. Run build first.");
	} else {
		if (!isSafeRef(rev)) throw new DesignError("Invalid revision");
		({ file, cleanup } = await fileAtRev(name, rev, rel));
	}
	try {
		return kind === "board"
			? await renderBoardView(file, { view })
			: await renderSchematicView(file);
	} finally {
		cleanup();
	}
}

/** Live Changes: diff the design as it is *now* (not yet committed) against a commit, with Banana's own engine. */
export async function diffWorking(
	name,
	{ base = "HEAD", file = "board" } = {},
) {
	if (!isSafeRef(base)) throw new DesignError("Invalid commit reference");
	if (!["board", "schematic"].includes(file))
		throw new DesignError('file must be "board" or "schematic"');
	const design = loadDesign(name);
	const rel = file === "board" ? `${name}.kicad_pcb` : `${name}.kicad_sch`;
	const unique = `live_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const root = path.join(config.tempRoot, unique);
	try {
		const basePath = await extractFileFromCommit(
			projectDir(name),
			base,
			rel,
			`${unique}/base/${rel}`,
		);
		const targetPath = path.join(root, "target", rel);
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.writeFileSync(
			targetPath,
			file === "board" ? writePcb(design).text : writeSchematic(design),
		);
		return await computeDiff({
			basePath,
			targetPath,
			baseCommit: base,
			targetCommit: "working",
			isPcb: file === "board",
		});
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}
