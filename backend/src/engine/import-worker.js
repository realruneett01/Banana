import {
	isMainThread,
	parentPort,
	Worker,
	workerData,
} from "node:worker_threads";
import { embeddedLibSymbols } from "./kicad-library.js";
import { kicadPcbToIr } from "./kicad-pcb-to-ir.js";
import { kicadSchToIr } from "./kicad-sch-to-ir.js";

// Measured min old-space for kicadPcbToIr (KiCad 10 demos, d6cbdb9 parser):
// jetson-agx-thor-baseboard 84.6 MB -> ~1163 MB, vme-wren 68.2 MB -> ~788 MB.
export const IMPORT_BODY_LIMIT_DESKTOP = "150mb";
export const IMPORT_HEAP_MB_DESKTOP = 2048;
export const IMPORT_TIMEOUT_MS_DESKTOP = 120000;
// Render free has 512 MB in total, so a worker gets half of it.
export const IMPORT_BODY_LIMIT_WEB = "20mb";
export const IMPORT_HEAP_MB_WEB = 256;
export const IMPORT_TIMEOUT_MS_WEB = 30000;

export const DESKTOP_IMPORT_LIMITS = Object.freeze({
	bodyLimit: IMPORT_BODY_LIMIT_DESKTOP,
	heapMb: IMPORT_HEAP_MB_DESKTOP,
	timeoutMs: IMPORT_TIMEOUT_MS_DESKTOP,
});
export const WEB_IMPORT_LIMITS = Object.freeze({
	bodyLimit: IMPORT_BODY_LIMIT_WEB,
	heapMb: IMPORT_HEAP_MB_WEB,
	timeoutMs: IMPORT_TIMEOUT_MS_WEB,
});

export const IMPORT_TOO_LARGE_ERROR = "design too large to import";

const CONVERTERS = {
	sch: (text) => ({
		...kicadSchToIr(text),
		symbols: embeddedLibSymbols(text),
	}),
	pcb: (text) => kicadPcbToIr(text),
};

/**
 * Converts KiCad text in a worker thread with a capped heap and a deadline.
 * Resolves { ok: true, result } or { ok: false, reason, exitCode? } where
 * reason is "too-large", "timeout" or "failed"; never rejects.
 */
export function runImportInWorker(kind, text, { heapMb, timeoutMs }) {
	return new Promise((resolve) => {
		const worker = new Worker(new URL(import.meta.url), {
			workerData: { importKind: kind, text },
			resourceLimits: { maxOldGenerationSizeMb: heapMb },
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			worker.terminate();
		}, timeoutMs);
		const finish = (outcome) => {
			clearTimeout(timer);
			resolve(outcome);
		};
		worker.once("message", (result) => finish({ ok: true, result }));
		worker.once("error", (err) =>
			finish({ ok: false, reason: failureReason(err) }),
		);
		worker.once("exit", (exitCode) =>
			finish({ ok: false, reason: timedOut ? "timeout" : "failed", exitCode }),
		);
	});
}

function failureReason(err) {
	return err?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "too-large" : "failed";
}

if (!isMainThread && workerData?.importKind) {
	parentPort.postMessage(CONVERTERS[workerData.importKind](workerData.text));
}
