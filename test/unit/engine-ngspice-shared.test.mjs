import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
	createSharedNgspice,
	findNgspiceLibrary,
} from "../../backend/src/engine/spice/ngspice-shared.js";

const CANNED_OP_RAW = `Title: Simple OP
Date: Wed Nov 11 12:00:00 2026
Plotname: Operating Point
Flags: real
No. Variables: 2
No. Points: 1
Variables:
	0	v(out)	voltage
	1	i(v1)	current
Values:
0	3.300000e+00
	-1.200000e-02
`;

const CANNED_CONSTANTS_RAW = `Title: Constant values
Date: Wed Nov 11 12:00:00 2026
Plotname: Constant values
Flags: real
No. Variables: 1
No. Points: 1
Variables:
	0	const	voltage
Values:
0	0.000000e+00
`;

function createFakeFuncDispatcher(handlers) {
	return (decl) => {
		if (decl.includes("ngSpice_Init")) return handlers.fakeInit;
		if (decl.includes("ngSpice_Circ")) return handlers.fakeCirc;
		if (decl.includes("ngSpice_Command")) return handlers.fakeCommand;
		if (decl.includes("ngSpice_running")) return handlers.fakeRunning;
		throw new Error(`Unknown function: ${decl}`);
	};
}

function handleBgRun(options, bgCb) {
	if (typeof options.onBgRun === "function") {
		options.onBgRun(bgCb);
		return;
	}
	if (bgCb && !options.alwaysRunning) {
		bgCb(false);
		bgCb(true);
	}
}

function handleWriteCommand(cmd, options) {
	if (!cmd.startsWith("write ") || options.rawContent === undefined) {
		return;
	}
	const rawPath = cmd.slice(6).trim();
	fs.writeFileSync(rawPath, options.rawContent, "utf8");
}

function handleFakeCommand(cmd, options, state) {
	state.commands.push(cmd);
	if (options.onCommand) options.onCommand(cmd, state.scCb);
	if (cmd === "bg_run") handleBgRun(options, state.bgCb);
	handleWriteCommand(cmd, options);
	return 0;
}

function handleFakeRunning(options, state) {
	if (options.alwaysRunning) return true;
	if (typeof options.getRunningCount === "function") {
		return options.getRunningCount() > 0;
	}
	if (state.runningCount > 0) {
		state.runningCount--;
		return true;
	}
	return false;
}

function createFakeHandlers(options, state) {
	return {
		fakeInit: (sc, _ss, _ce, _sd, _si, bg) => {
			state.scCb = sc;
			state.bgCb = bg;
			return options.initStatus ?? 0;
		},
		fakeCirc: (lines) => {
			if (options.onCirc) options.onCirc(lines, state.scCb);
			return 0;
		},
		fakeCommand: (cmd) => handleFakeCommand(cmd, options, state),
		fakeRunning: () => handleFakeRunning(options, state),
	};
}

function createFakeKoffi(options = {}) {
	const state = {
		commands: [],
		runningCount: options.runningCount ?? 1,
		scCb: null,
	};
	const handlers = createFakeHandlers(options, state);
	return {
		commands: state.commands,
		load: (libPath) => {
			if (options.loadThrows) {
				throw new Error(`Failed to load ${libPath}`);
			}
			return { func: createFakeFuncDispatcher(handlers) };
		},
	};
}

function createHappyPathKoffi(captured) {
	return createFakeKoffi({
		rawContent: CANNED_OP_RAW,
		runningCount: 1,
		onCirc: (lines, sc) => {
			captured.circLines = lines;
			if (typeof sc === "function") {
				sc("stdout Simulation completed normally\n", 0, null);
			}
		},
		onCommand: (cmd) => {
			if (cmd.startsWith("write ")) {
				captured.dir = path.dirname(cmd.slice(6).trim());
			}
		},
	});
}

function createSequentialTestKoffi(executionOrder) {
	let currentRunId = 0;
	let pollsRemaining = 0;
	return createFakeKoffi({
		rawContent: CANNED_OP_RAW,
		getRunningCount: () => {
			if (pollsRemaining > 0) {
				pollsRemaining--;
				return 1;
			}
			return 0;
		},
		onCirc: (lines) => {
			currentRunId = lines[0].includes("run 1") ? 1 : 2;
			pollsRemaining = 2;
		},
		onCommand: (cmd) => {
			if (cmd === "bg_run") {
				executionOrder.push(`start:${currentRunId}`);
			}
			if (cmd.startsWith("write ")) {
				executionOrder.push(`finish:${currentRunId}`);
			}
		},
	});
}

describe("findNgspiceLibrary table", () => {
	test("returns env.NGSPICE_LIBRARY_PATH when file exists", () => {
		const envPath = "C:/custom/bin/ngspice.dll";
		const res = findNgspiceLibrary({
			platform: "win32",
			env: { NGSPICE_LIBRARY_PATH: envPath },
			exists: (p) => p === envPath,
		});
		assert.equal(res, envPath);
	});

	test("resolves library from KICAD_CLI_PATH directory", () => {
		const cliPath = "C:/KiCad/10.0/bin/kicad-cli.exe";
		const expected = "C:/KiCad/10.0/bin/ngspice.dll";
		const res = findNgspiceLibrary({
			platform: "win32",
			env: { KICAD_CLI_PATH: cliPath },
			exists: (p) => p === expected,
		});
		assert.equal(res, expected);
	});

	test("resolves standard Windows 10.0 KiCad location", () => {
		const expected = "C:/Program Files/KiCad/10.0/bin/ngspice.dll";
		const res = findNgspiceLibrary({
			platform: "win32",
			env: {},
			exists: (p) => p === expected,
		});
		assert.equal(res, expected);
	});

	test("returns null when no library candidate exists", () => {
		const res = findNgspiceLibrary({
			platform: "win32",
			env: {},
			exists: () => false,
		});
		assert.equal(res, null);
	});
});

describe("createSharedNgspice available", () => {
	test("returns false when load throws", async () => {
		const fakeKoffi = createFakeKoffi({ loadThrows: true });
		const runner = createSharedNgspice({
			libraryPath: "invalid.dll",
			koffiImpl: fakeKoffi,
		});
		const first = await runner.available();
		const second = await runner.available();
		assert.equal(first, false);
		assert.equal(second, false);
	});

	test("returns true and caches check when init succeeds", async () => {
		const fakeKoffi = createFakeKoffi({ initStatus: 0 });
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
		});
		const first = await runner.available();
		const second = await runner.available();
		assert.equal(first, true);
		assert.equal(second, true);
	});
});

describe("createSharedNgspice run", () => {
	test("rejects dangerous netlist with .control without issuing commands", async () => {
		const fakeKoffi = createFakeKoffi();
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
		});
		const res = await runner.run(".control\nrun\n.endc");
		assert.equal(res.ok, false);
		assert.match(res.error, /forbidden '\.control'/);
		assert.equal(fakeKoffi.commands.length, 0);
	});

	test("happy path returns plots, log, and removes temp directory", async () => {
		const captured = { dir: null, circLines: null };
		const fakeKoffi = createHappyPathKoffi(captured);
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
			tempDir: os.tmpdir(),
			pollMs: 5,
		});

		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assert.equal(res.ok, true);
		assert.equal(res.plots.length, 1);
		assert.equal(res.plots[0].plotname, "Operating Point");
		assert.match(res.log, /Simulation completed normally/);
		assert.ok(captured.dir);
		assert.equal(fs.existsSync(captured.dir), false);
		assert.equal(captured.circLines[captured.circLines.length - 1], null);
		assert.equal(captured.circLines[captured.circLines.length - 2], ".end");
	});

	test("timeout path issues bg_halt and returns timeout error", async () => {
		const fakeKoffi = createFakeKoffi({ alwaysRunning: true });
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
			timeoutMs: 30,
			pollMs: 10,
		});
		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assert.equal(res.ok, false);
		assert.equal(res.error, "Simulation timed out");
		assert.ok(fakeKoffi.commands.includes("bg_halt"));
	});

	test("two concurrent runs execute sequentially in order", async () => {
		const executionOrder = [];
		const fakeKoffi = createSequentialTestKoffi(executionOrder);
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
			pollMs: 5,
		});

		const [r1, r2] = await Promise.all([
			runner.run("* run 1\nR1 1 0 1k\n.op\n.end\n"),
			runner.run("* run 2\nR2 1 0 2k\n.op\n.end\n"),
		]);

		assert.equal(r1.ok, true);
		assert.equal(r2.ok, true);
		assert.deepEqual(executionOrder, [
			"start:1",
			"finish:1",
			"start:2",
			"finish:2",
		]);
	});

	test("waits for BGThreadRunning callback before issuing write command", async () => {
		const events = [];
		const fakeKoffi = createFakeKoffi({
			rawContent: CANNED_OP_RAW,
			onBgRun: (bg) => {
				events.push("bg_run_cmd");
				setTimeout(() => {
					events.push("bg_started");
					if (bg) bg(false);
				}, 10);
				setTimeout(() => {
					events.push("bg_finished");
					if (bg) bg(true);
				}, 25);
			},
			onCommand: (cmd) => {
				if (cmd.startsWith("write ")) {
					events.push("write_cmd");
				}
			},
		});
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
			tempDir: os.tmpdir(),
			pollMs: 5,
		});

		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assert.equal(res.ok, true);
		assert.deepEqual(events, [
			"bg_run_cmd",
			"bg_started",
			"bg_finished",
			"write_cmd",
		]);
	});

	test("refuses simulation when parsed raw output contains only constants plot", async () => {
		const fakeKoffi = createFakeKoffi({
			rawContent: CANNED_CONSTANTS_RAW,
		});
		const runner = createSharedNgspice({
			libraryPath: "fake.dll",
			koffiImpl: fakeKoffi,
			tempDir: os.tmpdir(),
			pollMs: 5,
		});

		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assert.equal(res.ok, false);
		assert.equal(res.error, "Simulation produced no results");
	});
});
