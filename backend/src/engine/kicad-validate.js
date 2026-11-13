import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KICAD_REJECT_ERROR = "KiCad cannot open the patched file";

const SKIPPED = Object.freeze({ ok: true, skipped: true });

// kicad-cli.js resolves the binary at import time and throws when KiCad is
// absent (web deploys, CI), so it is loaded lazily.
async function loadDefaultCli() {
	const { createKicadCli } = await import("./kicad-cli.js");
	return createKicadCli();
}

function isCliMissing(err) {
	return err?.code === "ENOENT" && String(err.syscall).startsWith("spawn");
}

function rejectionDetail(err, dir) {
	const raw = typeof err?.stderr === "string" ? err.stderr.trim() : "";
	const firstLine = raw.split(/\r?\n/)[0].split(dir).join("").trim();
	return firstLine || "kicad-cli could not load the file";
}

function runCheck(cli, kind, filePath, dir) {
	if (kind === "sch") {
		return cli.exportNetlist(filePath, path.join(dir, "check.net"));
	}
	return cli.exportDrill(filePath, path.join(dir, "drill"));
}

async function checkText(cli, kind, text, logger) {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "banana-kcv-"));
	const filePath = path.join(dir, `patched.kicad_${kind}`);
	try {
		await fs.promises.writeFile(filePath, text, "utf8");
		await runCheck(cli, kind, filePath, dir);
		return { ok: true };
	} catch (err) {
		if (!isCliMissing(err)) {
			return { ok: false, detail: rejectionDetail(err, dir) };
		}
		logger.warn("[Banana] kicad-cli missing; patched file not validated");
		return SKIPPED;
	} finally {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

/**
 * Returns validate(kind, text) that asks kicad-cli to open the text.
 * Resolves { ok: true }, { ok: true, skipped: true } when kicad-cli is
 * unavailable, or { ok: false, detail } when KiCad rejects the file.
 */
export function createKicadValidator({
	loadCli = loadDefaultCli,
	logger = console,
} = {}) {
	let cliPromise = null;
	const getCli = () => {
		cliPromise ??= loadCli().catch((err) => {
			logger.warn(`[Banana] patched files not validated: ${err?.message}`);
			return null;
		});
		return cliPromise;
	};
	return async (kind, text) => {
		const cli = await getCli();
		return cli ? checkText(cli, kind, text, logger) : SKIPPED;
	};
}
