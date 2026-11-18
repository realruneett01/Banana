import fs from "node:fs";
import path from "node:path";
import koffi from "koffi";
import { config } from "../../config.js";
import { parseRawAscii, validateNetlist } from "./ngspice-runner.js";

const STANDARD_LOCATIONS = {
	win32: [
		"C:/Program Files/KiCad/10.0/bin/ngspice.dll",
		"C:/Program Files/KiCad/9.0/bin/ngspice.dll",
	],
	darwin: [
		"/Applications/KiCad/KiCad.app/Contents/Frameworks/libngspice.0.dylib",
	],
	linux: [
		"/usr/lib/x86_64-linux-gnu/libngspice.so.0",
		"/usr/lib/libngspice.so.0",
		"/usr/lib64/libngspice.so.0",
	],
};

function getPlatformLibName(platform) {
	if (platform === "win32") return "ngspice.dll";
	if (platform === "darwin") return "libngspice.0.dylib";
	return "libngspice.so.0";
}

function resolveKicadCliCandidate(cliPath, platform) {
	if (!cliPath || typeof cliPath !== "string") return null;
	const isWin = platform === "win32";
	const isAbs = isWin
		? path.win32.isAbsolute(cliPath) || /^[a-zA-Z]:[/\\]/.test(cliPath)
		: path.posix.isAbsolute(cliPath);
	if (!isAbs) return null;
	const pHelper = isWin ? path.win32 : path.posix;
	const candidate = pHelper.join(
		pHelper.dirname(cliPath),
		getPlatformLibName(platform),
	);
	return isWin ? candidate.replace(/\\/g, "/") : candidate;
}

export function findNgspiceLibrary({
	platform = process.platform,
	env = process.env,
	exists = fs.existsSync,
} = {}) {
	if (env.NGSPICE_LIBRARY_PATH && exists(env.NGSPICE_LIBRARY_PATH)) {
		return env.NGSPICE_LIBRARY_PATH;
	}
	const cliCandidate = resolveKicadCliCandidate(env.KICAD_CLI_PATH, platform);
	if (cliCandidate && exists(cliCandidate)) {
		return cliCandidate;
	}
	const standard = STANDARD_LOCATIONS[platform] || [];
	for (const loc of standard) {
		if (exists(loc)) return loc;
	}
	return null;
}

const PROTO_CACHE = new WeakMap();

function getOrCreatePrototypes(koffiImpl) {
	let protos = PROTO_CACHE.get(koffiImpl);
	if (!protos) {
		protos = {
			sc: koffiImpl.proto("int SendChar(char*, int, void*)"),
			ss: koffiImpl.proto("int SendStat(char*, int, void*)"),
			ce: koffiImpl.proto("int ControlledExit(int, bool, bool, int, void*)"),
			sd: koffiImpl.proto("int SendData(void*, int, int, void*)"),
			si: koffiImpl.proto("int SendInitData(void*, int, void*)"),
			bg: koffiImpl.proto("int BGThreadRunning(bool, int, void*)"),
		};
		PROTO_CACHE.set(koffiImpl, protos);
	}
	return protos;
}

function createRegisteredCallbacks(koffiImpl, raw) {
	if (
		typeof koffiImpl?.proto !== "function" ||
		typeof koffiImpl?.register !== "function"
	) {
		return raw;
	}
	const protos = getOrCreatePrototypes(koffiImpl);
	return {
		sendChar: koffiImpl.register(raw.sendChar, koffiImpl.pointer(protos.sc)),
		sendStat: koffiImpl.register(raw.sendStat, koffiImpl.pointer(protos.ss)),
		controlledExit: koffiImpl.register(
			raw.controlledExit,
			koffiImpl.pointer(protos.ce),
		),
		sendData: koffiImpl.register(raw.sendData, koffiImpl.pointer(protos.sd)),
		sendInitData: koffiImpl.register(
			raw.sendInitData,
			koffiImpl.pointer(protos.si),
		),
		bgThreadRunning: koffiImpl.register(
			raw.bgThreadRunning,
			koffiImpl.pointer(protos.bg),
		),
	};
}

function makeRawCallbacks(getLogReceiver, getBgReceiver) {
	return {
		sendChar: (msg) => {
			const fn = getLogReceiver();
			if (fn) fn(msg);
			return 0;
		},
		sendStat: () => 0,
		controlledExit: () => 0,
		sendData: () => 0,
		sendInitData: () => 0,
		bgThreadRunning: (noRunning) => {
			const fn = getBgReceiver ? getBgReceiver() : null;
			if (fn) fn(noRunning);
			return 0;
		},
	};
}

function bindLibrary(koffiImpl, libraryPath) {
	let logReceiver = null;
	let bgReceiver = null;
	const rawCallbacks = makeRawCallbacks(
		() => logReceiver,
		() => bgReceiver,
	);
	const callbacks = createRegisteredCallbacks(koffiImpl, rawCallbacks);
	const lib = koffiImpl.load(libraryPath);
	return {
		ngSpice_Init: lib.func(
			"int ngSpice_Init(SendChar*, SendStat*, ControlledExit*, SendData*, SendInitData*, BGThreadRunning*, void*)",
		),
		ngSpice_Circ: lib.func("int ngSpice_Circ(char**)"),
		ngSpice_Command: lib.func("int ngSpice_Command(char*)"),
		ngSpice_running: lib.func("bool ngSpice_running(void)"),
		callbacks,
		rawCallbacks,
		setLogReceiver: (fn) => {
			logReceiver = fn;
		},
		setBgReceiver: (fn) => {
			bgReceiver = fn;
		},
	};
}

function initNgspice(bound) {
	const cbs = bound.callbacks;
	return bound.ngSpice_Init(
		cbs.sendChar,
		cbs.sendStat,
		cbs.controlledExit,
		cbs.sendData,
		cbs.sendInitData,
		cbs.bgThreadRunning,
		null,
	);
}

function prepareNetlistLines(netlist) {
	const lines = netlist.split(/\r?\n/);
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
		lines.pop();
	}
	const last = lines[lines.length - 1]?.trim().toLowerCase();
	if (last !== ".end") {
		lines.push(".end");
	}
	lines.push(null);
	return lines;
}

function checkFallbackRunning(bound, state) {
	const running = Boolean(bound.ngSpice_running());
	if (running) {
		state.sawRunning = true;
		return false;
	}
	return state.sawRunning;
}

function logIgnored(context, err) {
	console.debug(`[ngspice] ${context}:`, err?.message ?? err);
}

function tryCommand(bound, command) {
	try {
		bound.ngSpice_Command(command);
	} catch (err) {
		logIgnored(`command '${command}' failed`, err);
	}
}

function haltSimulation(bound, threadState) {
	if (threadState.finished) return true;
	tryCommand(bound, "bg_halt");
	return false;
}

async function waitForSimulation(bound, threadState, timeoutMs, pollMs) {
	const start = Date.now();
	const fbState = { sawRunning: false };
	while (Date.now() - start < timeoutMs) {
		if (threadState.finished) return true;
		const isFallback = !threadState.started && Date.now() - start >= 2000;
		if (isFallback && checkFallbackRunning(bound, fbState)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return haltSimulation(bound, threadState);
}

function isWithinDir(parent, target) {
	const rel = path.relative(parent, target);
	if (!rel || path.isAbsolute(rel)) return false;
	return !rel.startsWith("..");
}

async function safeRemoveDir(dirPath, parentDir) {
	if (!dirPath || !isWithinDir(parentDir, path.resolve(dirPath))) {
		return;
	}
	try {
		await fs.promises.rm(dirPath, { recursive: true, force: true });
	} catch (err) {
		logIgnored("could not remove work directory", err);
	}
}

async function createWorkDir(tempDir) {
	const resolvedTemp = path.resolve(tempDir);
	await fs.promises.mkdir(resolvedTemp, { recursive: true });
	const workDir = await fs.promises.mkdtemp(
		path.join(resolvedTemp, "spice-shared-"),
	);
	const resolvedWork = path.resolve(workDir);
	if (!isWithinDir(resolvedTemp, resolvedWork)) {
		await safeRemoveDir(resolvedWork, resolvedTemp);
		throw new Error("Work directory created outside temp directory");
	}
	return { workDir, resolvedTemp };
}

function createLogCollector() {
	const lines = [];
	return {
		push: (msg) => {
			if (typeof msg !== "string" || lines.length >= 200) return;
			const parts = msg.split(/\r?\n/);
			for (const part of parts) {
				if (lines.length >= 200) break;
				if (part.length > 0) lines.push(part);
			}
		},
		getLog: () => lines.join("\n"),
	};
}

const CONSTANTS_PLOT_NAMES = new Set(["constant values", "constants"]);

function isConstantsPlot(plot) {
	const title = (plot?.title || "").trim().toLowerCase();
	const plotname = (plot?.plotname || "").trim().toLowerCase();
	return CONSTANTS_PLOT_NAMES.has(title) || CONSTANTS_PLOT_NAMES.has(plotname);
}

function hasOnlyConstantsPlot(plots) {
	if (!Array.isArray(plots) || plots.length === 0) return false;
	return plots.every(isConstantsPlot);
}

async function readSimulationOutput(rawPath, log) {
	let rawText;
	try {
		rawText = await fs.promises.readFile(rawPath, "utf8");
	} catch {
		return { ok: false, error: "Raw output file not generated", log };
	}
	const parsed = parseRawAscii(rawText);
	if (!parsed.ok) {
		return { ok: false, error: parsed.error, log };
	}
	if (hasOnlyConstantsPlot(parsed.plots)) {
		return { ok: false, error: "Simulation produced no results", log };
	}
	return { ok: true, plots: parsed.plots, log };
}

function resetCircuit(bound) {
	tryCommand(bound, "destroy all");
	tryCommand(bound, "remcirc");
}

async function runCircuit(bound, netlist, options) {
	const { timeoutMs, pollMs, workDir, logCollector, threadState } = options;
	resetCircuit(bound);
	bound.ngSpice_Circ(prepareNetlistLines(netlist));
	bound.ngSpice_Command("bg_run");

	const completed = await waitForSimulation(
		bound,
		threadState,
		timeoutMs,
		pollMs,
	);
	const log = logCollector.getLog();
	if (!completed) {
		return { ok: false, error: "Simulation timed out", log };
	}

	const rawPath = path.join(workDir, "output.raw").replace(/\\/g, "/");
	bound.ngSpice_Command("set filetype=ascii");
	bound.ngSpice_Command(`write ${rawPath}`);
	return readSimulationOutput(rawPath, log);
}

async function executeSingleRun(bound, netlist, cfg) {
	const { workDir, resolvedTemp } = await createWorkDir(cfg.tempDir);
	const logCollector = createLogCollector();
	const threadState = { started: false, finished: false };
	bound.setLogReceiver(logCollector.push);
	bound.setBgReceiver((noRunning) => {
		if (!noRunning) {
			threadState.started = true;
		} else {
			threadState.finished = true;
		}
	});
	try {
		return await runCircuit(bound, netlist, {
			timeoutMs: cfg.timeoutMs,
			pollMs: cfg.pollMs,
			workDir,
			logCollector,
			threadState,
		});
	} finally {
		bound.setLogReceiver(null);
		bound.setBgReceiver(null);
		await safeRemoveDir(workDir, resolvedTemp);
	}
}

function makeAvailableLoader(cfg, state) {
	return async () => {
		try {
			const resolvedPath = cfg.libraryPath || findNgspiceLibrary();
			if (!resolvedPath) return false;
			state.bound = bindLibrary(cfg.koffiImpl, resolvedPath);
			return initNgspice(state.bound) === 0;
		} catch (err) {
			logIgnored("library could not be bound or initialized", err);
			return false;
		}
	};
}

function makeRunExecutor(cfg, state, getAvailable) {
	return async (netlist) => {
		const ok = await getAvailable();
		if (!ok) {
			return {
				ok: false,
				error: "ngspice shared library not available",
				log: "",
			};
		}
		return executeSingleRun(state.bound, netlist, cfg);
	};
}

export function createSharedNgspice({
	libraryPath,
	koffiImpl = koffi,
	timeoutMs = 30000,
	tempDir = config.tempStorageDir,
	pollMs = 20,
} = {}) {
	const cfg = { libraryPath, koffiImpl, timeoutMs, tempDir, pollMs };
	const state = { bound: null, availablePromise: null };
	const loader = makeAvailableLoader(cfg, state);
	let runMutex = Promise.resolve();

	const available = () => {
		if (!state.availablePromise) state.availablePromise = loader();
		return state.availablePromise;
	};

	const execute = makeRunExecutor(cfg, state, available);

	const run = (netlist) => {
		const val = validateNetlist(netlist);
		if (!val.ok) {
			return Promise.resolve({ ok: false, error: val.error, log: "" });
		}
		const nextRun = runMutex.then(() => execute(netlist));
		runMutex = nextRun.catch(() => {});
		return nextRun;
	};

	return { available, run };
}
