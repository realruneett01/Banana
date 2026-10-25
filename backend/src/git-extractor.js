import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { assertSafeRef, assertSafeRelativePath } from "./git-safety.js";

/**
 * Prepares and returns the destination output path within temp_storage.
 * @param {string} targetFilename
 * @returns {string}
 */
function prepareOutputPath(targetFilename) {
	const root = config.tempRoot;
	const outputPath = path.resolve(root, targetFilename);
	if (outputPath !== root && !outputPath.startsWith(root + path.sep)) {
		throw new Error("Refusing to write outside temp_storage");
	}
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	return outputPath;
}

/**
 * Extracts a specific file version from a Git commit and saves it to temp_storage.
 *
 * The file is always re-extracted: a ref such as HEAD or a branch name moves,
 * so a file cached under that name would silently go stale.
 *
 * @param {string} repoPath - Path to the local git repository
 * @param {string} commitHash - Git commit hash or reference (e.g. HEAD, HEAD~1, a5f23c)
 * @param {string} relativeFilePath - Project-relative file path in the repository
 * @param {string} targetFilename - Name of the output file inside temp_storage
 * @returns {Promise<string>} Path to the written file
 */
export async function extractFileFromCommit(
	repoPath,
	commitHash,
	relativeFilePath,
	targetFilename,
) {
	assertSafeRef(commitHash, "commit");
	assertSafeRelativePath(relativeFilePath);
	const outputPath = prepareOutputPath(targetFilename);
	const gitFilePath = relativeFilePath.split(/[/\\]/).join("/");

	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = (err) => {
			if (settled) return;
			settled = true;
			fs.rm(outputPath, { force: true }, () => reject(err));
		};

		const child = spawn("git", ["show", `${commitHash}:${gitFilePath}`], {
			cwd: repoPath,
		});
		const writeStream = fs.createWriteStream(outputPath);
		child.stdout.pipe(writeStream);

		let stderrData = "";
		child.stderr.on("data", (chunk) => {
			stderrData += chunk.toString();
		});
		child.on("error", (err) =>
			fail(new Error(`Failed to spawn git process: ${err.message}`)),
		);
		writeStream.on("error", (err) =>
			fail(new Error(`Failed to write ${outputPath}: ${err.message}`)),
		);

		let exitCode = null;
		let finished = false;
		const settle = () => {
			if (settled || exitCode === null || !finished) return;
			if (exitCode !== 0) {
				return fail(
					new Error(
						`Git show failed with exit code ${exitCode}. Stderr: ${stderrData.trim() || "No stderr output"}`,
					),
				);
			}
			settled = true;
			resolve(outputPath);
		};
		child.on("close", (code) => {
			exitCode = code ?? 1;
			settle();
		});
		// Resolve only once every byte is flushed to disk.
		writeStream.on("finish", () => {
			finished = true;
			settle();
		});
	});
}
