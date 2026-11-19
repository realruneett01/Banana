import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createProject } from "../../routes/project-routes.js";
import { validateCircuitIR } from "../circuit-ir.js";
import { irToKicadPcb } from "../kicad-pcb-writer.js";
import { irToKicadSch } from "../kicad-sch-writer.js";
import {
	commitFiles,
	ensureGitWorkTree,
	validateMessage,
	validateRepoPath,
} from "./commit-tools.js";

const T_STR = { type: "string" };
const T_FILES = { type: "array", items: T_STR };

function strictObject(properties, required = Object.keys(properties)) {
	return {
		type: "object",
		required,
		additionalProperties: false,
		properties,
	};
}

const CREATE_INPUT_SCHEMA = strictObject({ name: T_STR, parentDir: T_STR }, [
	"name",
]);
const CREATE_OUTPUT_SCHEMA = strictObject({
	projectRoot: T_STR,
	files: T_FILES,
});
const WRITE_INPUT_SCHEMA = strictObject({
	projectPath: T_STR,
	ir: { type: "object" },
	message: { type: "string", minLength: 1 },
});
const WRITE_OUTPUT_SCHEMA = strictObject({ commit: T_STR, files: T_FILES });

export async function confineToRoot(fsImpl, root, target) {
	validateRepoPath(target);
	const realRoot = await fsImpl.realpath(root);
	const realTarget = await fsImpl.realpath(target);
	const rel = path.relative(realRoot, realTarget);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error("path is outside the projects root");
	}
	return realTarget;
}

function createProjectHandler(deps) {
	return async (input) => {
		const parent = input.parentDir ?? deps.projectsRoot;
		const realParent = await confineToRoot(
			deps.fsImpl,
			deps.projectsRoot,
			parent,
		);
		const out = await createProject(
			{ fsImpl: deps.fsImpl, runGit: deps.runGit },
			{ name: input.name, parentDir: realParent },
		);
		if (out.status !== 201) {
			throw new Error(out.body.error);
		}
		return out.body;
	};
}

function checkIr(validator, ir) {
	const res = validator(ir);
	if (!res.ok) {
		throw new Error(`Invalid circuit IR: ${res.errors.join("; ")}`);
	}
}

async function writeKicadFiles(deps, projectDir, ir) {
	const base = path.basename(projectDir);
	const files = [`${base}.kicad_sch`, `${base}.kicad_pcb`];
	const texts = [
		deps.schWriter(ir, { title: base }).text,
		deps.pcbWriter(ir).text,
	];
	for (const [i, file] of files.entries()) {
		await deps.fsImpl.writeFile(path.join(projectDir, file), texts[i], "utf8");
	}
	return files;
}

function writeDesignHandler(deps) {
	return async ({ projectPath, ir, message }) => {
		validateMessage(message);
		checkIr(deps.irValidator, ir);
		const dir = await confineToRoot(
			deps.fsImpl,
			deps.projectsRoot,
			projectPath,
		);
		await ensureGitWorkTree(deps.execFileFn, dir);
		const files = await writeKicadFiles(deps, dir, ir);
		const commit = await commitFiles(deps.execFileFn, dir, files, message);
		return { commit, files };
	};
}

function resolveDeps(deps) {
	return {
		projectsRoot: deps.projectsRoot ?? os.homedir(),
		fsImpl: deps.fsImpl ?? fs.promises,
		runGit: deps.runGit,
		execFileFn: deps.execFileFn ?? promisify(execFile),
		schWriter: deps.irToKicadSch ?? irToKicadSch,
		pcbWriter: deps.irToKicadPcb ?? irToKicadPcb,
		irValidator: deps.validateCircuitIR ?? validateCircuitIR,
	};
}

export function registerProjectTools(registry, deps = {}) {
	const resolved = resolveDeps(deps);
	registry.register({
		name: "project.create",
		description:
			"Creates a new KiCad project folder with a git repo inside the projects root",
		inputSchema: CREATE_INPUT_SCHEMA,
		outputSchema: CREATE_OUTPUT_SCHEMA,
		permission: "write",
		handler: createProjectHandler(resolved),
	});
	registry.register({
		name: "project.write_design",
		description:
			"Writes a Circuit IR into a project as .kicad_sch and .kicad_pcb and commits it",
		inputSchema: WRITE_INPUT_SCHEMA,
		outputSchema: WRITE_OUTPUT_SCHEMA,
		permission: "destructive",
		handler: writeDesignHandler(resolved),
	});
}
