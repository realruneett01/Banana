import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { validateCircuitIR } from "../circuit-ir.js";
import { irToKicadPcb } from "../kicad-pcb-writer.js";
import { irToKicadSch } from "../kicad-sch-writer.js";

const ROOT_OR_DRIVE = /^[a-zA-Z]:|^[/\\]/;

const GIT_ENV = {
	GIT_AUTHOR_NAME: "Banana Agent",
	GIT_AUTHOR_EMAIL: "agent@banana.local",
	GIT_COMMITTER_NAME: "Banana Agent",
	GIT_COMMITTER_EMAIL: "agent@banana.local",
};

const COMMIT_INPUT_SCHEMA = {
	type: "object",
	required: ["repoPath", "baseName", "ir", "boardW", "boardH", "message"],
	additionalProperties: false,
	properties: {
		repoPath: { type: "string" },
		dir: { type: "string" },
		baseName: {
			type: "string",
			pattern: "^[A-Za-z0-9_-]{1,64}$",
		},
		ir: { type: "object" },
		boardW: { type: "number" },
		boardH: { type: "number" },
		message: {
			type: "string",
			minLength: 1,
			pattern: "^[\\s\\S]{1,200}$",
		},
	},
};

const COMMIT_OUTPUT_SCHEMA = {
	type: "object",
	required: ["commit", "files"],
	additionalProperties: false,
	properties: {
		commit: { type: "string" },
		files: {
			type: "array",
			items: { type: "string" },
		},
	},
};

export function validateRepoPath(repoPath) {
	if (typeof repoPath !== "string") {
		throw new Error("repoPath must be a string");
	}
	if (!path.isAbsolute(repoPath)) {
		throw new Error("repoPath must be an absolute path");
	}
}

export function validateDir(repoPath, rawDir) {
	const dir = rawDir ?? "hardware";
	if (path.isAbsolute(dir) || ROOT_OR_DRIVE.test(dir)) {
		throw new Error("dir must not be absolute");
	}
	if (dir.includes("..")) {
		throw new Error("dir must not contain '..'");
	}
	const resolvedDir = path.resolve(repoPath, dir);
	const rel = path.relative(repoPath, resolvedDir);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error("dir resolves outside repoPath");
	}
	return resolvedDir;
}

function validateDimensions(boardW, boardH) {
	if (typeof boardW !== "number" || boardW <= 0) {
		throw new Error("boardW must be greater than 0");
	}
	if (typeof boardH !== "number" || boardH <= 0) {
		throw new Error("boardH must be greater than 0");
	}
}

export function validateMessage(message) {
	if (typeof message !== "string") {
		throw new Error("message must be a string");
	}
	if (message.length < 1 || message.length > 200) {
		throw new Error("message must be between 1 and 200 characters");
	}
}

function checkCircuitIR(irValidator, ir) {
	const res = irValidator(ir);
	if (!res.ok) {
		throw new Error(`Invalid circuit IR: ${res.errors.join("; ")}`);
	}
}

export async function ensureGitWorkTree(execFileFn, repoPath) {
	try {
		const { stdout } = await execFileFn("git", [
			"-C",
			repoPath,
			"rev-parse",
			"--is-inside-work-tree",
		]);
		if (stdout.trim() !== "true") {
			throw new Error("repoPath is not inside a git work tree");
		}
	} catch (err) {
		// Surface git work tree verification errors cleanly without stack
		const msg = err?.message || String(err);
		throw new Error(`repoPath is not a git work tree: ${msg}`);
	}
}

async function writeDesignFiles(ctx, files) {
	const { fsImpl, targetDir } = ctx;
	const { schPath, pcbPath, schText, pcbText } = files;
	await fsImpl.mkdir(targetDir, { recursive: true });
	await fsImpl.writeFile(schPath, schText, "utf8");
	await fsImpl.writeFile(pcbPath, pcbText, "utf8");
}

export async function commitFiles(execFileFn, repoPath, relFiles, message) {
	const env = { ...process.env, ...GIT_ENV };
	await execFileFn("git", ["-C", repoPath, "add", "--", ...relFiles]);
	try {
		await execFileFn(
			"git",
			["-C", repoPath, "commit", "-m", message, "--", ...relFiles],
			{ env },
		);
	} catch (err) {
		// Handle initial commit without prior HEAD where pathspec commit is disallowed
		const msg = err?.message || String(err);
		if (msg.includes("cannot do a partial commit during initial commit")) {
			await execFileFn("git", ["-C", repoPath, "commit", "-m", message], {
				env,
			});
		} else {
			throw err;
		}
	}
	const { stdout } = await execFileFn("git", [
		"-C",
		repoPath,
		"rev-parse",
		"HEAD",
	]);
	return stdout.trim();
}

async function validateAllInputs(deps, input) {
	const { execFileFn, irValidator } = deps;
	validateRepoPath(input.repoPath);
	const targetDir = validateDir(input.repoPath, input.dir);
	validateDimensions(input.boardW, input.boardH);
	validateMessage(input.message);
	checkCircuitIR(irValidator, input.ir);
	await ensureGitWorkTree(execFileFn, input.repoPath);
	return targetDir;
}

function computeRelativeFiles(repoPath, schPath, pcbPath) {
	const toPosix = (p) => path.relative(repoPath, p).split(/[/\\]/).join("/");
	return [toPosix(schPath), toPosix(pcbPath)];
}

async function generateAndWriteFiles(writers, paths, ctx) {
	const { schWriter, pcbWriter } = writers;
	const { targetDir, baseName, ir, boardW, boardH, fsImpl } = ctx;
	const sch = schWriter(ir, { title: baseName });
	const pcb = pcbWriter(ir, { boardW, boardH });
	await writeDesignFiles(
		{ fsImpl, targetDir },
		{
			schPath: paths.schPath,
			pcbPath: paths.pcbPath,
			schText: sch.text,
			pcbText: pcb.text,
		},
	);
}

function createCommitHandler(deps) {
	const { execFileFn, fsImpl, schWriter, pcbWriter } = deps;
	return async (input) => {
		const targetDir = await validateAllInputs(deps, input);
		const schPath = path.join(targetDir, `${input.baseName}.kicad_sch`);
		const pcbPath = path.join(targetDir, `${input.baseName}.kicad_pcb`);

		await generateAndWriteFiles(
			{ schWriter, pcbWriter },
			{ schPath, pcbPath },
			{ ...input, fsImpl, targetDir },
		);

		const relFiles = computeRelativeFiles(input.repoPath, schPath, pcbPath);
		const commit = await commitFiles(
			execFileFn,
			input.repoPath,
			relFiles,
			input.message,
		);
		return { commit, files: relFiles };
	};
}

export function registerCommitTools(registry, deps = {}) {
	const execFileFn = deps.execFileFn ?? promisify(execFile);
	const fsImpl = deps.fsImpl ?? fs.promises;
	const schWriter = deps.irToKicadSch ?? irToKicadSch;
	const pcbWriter = deps.irToKicadPcb ?? irToKicadPcb;
	const irValidator = deps.validateCircuitIR ?? validateCircuitIR;

	const handler = createCommitHandler({
		execFileFn,
		fsImpl,
		schWriter,
		pcbWriter,
		irValidator,
	});

	registry.register({
		name: "design.commit",
		description:
			"Saves design to local git repo as KiCad files and creates a commit",
		inputSchema: COMMIT_INPUT_SCHEMA,
		outputSchema: COMMIT_OUTPUT_SCHEMA,
		permission: "destructive",
		handler,
	});
}
