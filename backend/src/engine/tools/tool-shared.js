import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const ROOT_OR_DRIVE = /^[a-zA-Z]:|^[/\\]/;

export const MESSAGE_SCHEMA = {
	type: "string",
	minLength: 1,
	pattern: "^[\\s\\S]{1,200}$",
};

export function commitOutputSchema(fileItems) {
	return {
		type: "object",
		required: ["commit", "files"],
		additionalProperties: false,
		properties: {
			commit: { type: "string" },
			files: { type: "array", items: fileItems },
		},
	};
}

export function assertRelative(p, label) {
	if (path.isAbsolute(p) || ROOT_OR_DRIVE.test(p)) {
		throw new Error(`${label} must not be absolute`);
	}
}

export function assertInsideRepo(repoPath, p, label) {
	const resolved = path.resolve(repoPath, p);
	const rel = path.relative(repoPath, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`${label} resolves outside repoPath`);
	}
	return resolved;
}

export function defaultIoDeps(deps) {
	return {
		execFileFn: deps.execFileFn ?? promisify(execFile),
		fsImpl: deps.fsImpl ?? fs.promises,
	};
}

export function registerDestructiveTool(registry, tool) {
	registry.register({ ...tool, permission: "destructive" });
}
