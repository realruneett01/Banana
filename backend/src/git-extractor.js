import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Prepares and returns the destination output path within temp_storage.
 * @param {string} targetFilename
 * @returns {string}
 */
function prepareOutputPath(targetFilename) {
	const outputPath = path.join(config.tempStorageDir, targetFilename);
	const parentDir = path.dirname(outputPath);
	if (!fs.existsSync(parentDir)) {
		fs.mkdirSync(parentDir, { recursive: true });
	}
	return outputPath;
}

/**
 * Checks whether the destination file already exists with content.
 * @param {string} filePath
 * @returns {boolean}
 */
function isCachedFileValid(filePath) {
	if (!fs.existsSync(filePath)) return false;
	try {
		return fs.statSync(filePath).size > 0;
	} catch (_) {
		// Return false if stat fails on destination file
		return false;
	}
}

function cleanupOutputFile(outputPath) {
	try {
		if (fs.existsSync(outputPath)) {
			fs.unlinkSync(outputPath);
		}
	} catch (_) {
		// Ignore temporary partial file cleanup errors
	}
}

function sanitizeStreamError(err, outputPath, targetFilename) {
	const raw = err?.message || String(err || "Stream error");
	const normalized = outputPath.split(/[/\\]/).join("/");
	const sanitized = raw
		.replaceAll(outputPath, targetFilename)
		.replaceAll(normalized, targetFilename)
		.replace(/[a-zA-Z]:[/\\][^\s'"]+/g, (m) => path.basename(m))
		.replace(/(?:^|[\s'"])\/(?:[^\s'"/]+\/)+[^\s'"]+/g, (m) =>
			path.basename(m.trim()),
		);
	return new Error(`Stream error: ${sanitized}`);
}

function terminateProcess(child) {
	if (child.exitCode === null && !child.killed) {
		try {
			child.kill();
		} catch (_) {
			// Process already terminated
		}
	}
}

function terminateOnFailure(failureError, writeStream, child) {
	if (!failureError) return;
	if (!writeStream.destroyed) {
		writeStream.destroy();
	}
	terminateProcess(child);
}

class ExtractionCoordinator {
	constructor(writeStream, child, outputPath, targetFilename, resolve, reject) {
		this.writeStream = writeStream;
		this.child = child;
		this.outputPath = outputPath;
		this.targetFilename = targetFilename;
		this.resolve = resolve;
		this.reject = reject;
		this.failureError = null;
		this.childFinished = false;
		this.streamFinished = false;
		this.settled = false;
	}

	setError(err) {
		if (!this.failureError) {
			this.failureError = err;
		}
	}

	onStreamDone() {
		this.streamFinished = true;
		this.checkDone();
	}

	onChildDone() {
		this.childFinished = true;
		this.checkDone();
	}

	checkDone() {
		if (this.settled) return;
		terminateOnFailure(this.failureError, this.writeStream, this.child);
		if (this.writeStream.closed) this.streamFinished = true;
		if (!this.childFinished || !this.streamFinished) return;
		this.settled = true;
		if (this.failureError) {
			cleanupOutputFile(this.outputPath);
			this.reject(this.failureError);
		} else {
			this.resolve(this.outputPath);
		}
	}
}

function bindStreamEvents(coord) {
	const onStreamError = (err) => {
		coord.setError(
			sanitizeStreamError(err, coord.outputPath, coord.targetFilename),
		);
		coord.writeStream.destroy();
		coord.onStreamDone();
	};
	coord.writeStream.on("error", onStreamError);
	coord.child.stdout.on("error", onStreamError);
	coord.child.stderr.on("error", () => {});
	coord.child.stdin?.on("error", () => {});
	coord.writeStream.on("close", () => coord.onStreamDone());
	coord.child.stdout.pipe(coord.writeStream);
}

function bindChildEvents(coord, stderr) {
	coord.child.stderr.on("data", (chunk) =>
		stderr.appendStderr(chunk.toString()),
	);
	coord.child.on("error", (err) => {
		coord.setError(new Error(`Failed to spawn git process: ${err.message}`));
		coord.onChildDone();
	});
	coord.child.on("close", (code) => {
		if (code !== 0) {
			const cleanStderr = stderr.getStderr().trim();
			coord.setError(
				new Error(
					`Git show failed with exit code ${code}. Stderr: ${cleanStderr || "No stderr output"}`,
				),
			);
		}
		coord.onChildDone();
	});
}

function executeGitExtraction(params) {
	const { repoPath, gitIdentifier, outputPath, targetFilename } = params;
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["show", gitIdentifier], { cwd: repoPath });
		const writeStream = fs.createWriteStream(outputPath);
		let stderrData = "";
		const coord = new ExtractionCoordinator(
			writeStream,
			child,
			outputPath,
			targetFilename,
			resolve,
			reject,
		);
		bindStreamEvents(coord);
		bindChildEvents(coord, {
			getStderr: () => stderrData,
			appendStderr: (c) => {
				stderrData += c;
			},
		});
	});
}

/**
 * Extracts a specific file version from a Git commit hash and saves it to temp_storage.
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
	const outputPath = prepareOutputPath(targetFilename);

	// If file for this exact commit already exists with non-zero size, return immediately
	if (isCachedFileValid(outputPath)) {
		return outputPath;
	}

	// Standardize path separators for git (uses forward slashes)
	const gitFilePath = relativeFilePath.split(/[/\\]/).join("/");
	const gitIdentifier = `${commitHash}:${gitFilePath}`;

	return executeGitExtraction({
		repoPath,
		gitIdentifier,
		outputPath,
		targetFilename,
	});
}
