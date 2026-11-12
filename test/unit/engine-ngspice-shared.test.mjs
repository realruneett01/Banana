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

const FIND_LIBRARY_CASES = [
	{
		name: "returns env.NGSPICE_LIBRARY_PATH when file exists",
		env: { NGSPICE_LIBRARY_PATH: "C:/custom/bin/ngspice.dll" },
		exists: (p) => p === "C:/custom/bin/ngspice.dll",
		expected: "C:/custom/bin/ngspice.dll",
	},
	{
		name: "resolves library from KICAD_CLI_PATH directory",
		env: { KICAD_CLI_PATH: "C:/KiCad/10.0/bin/kicad-cli.exe" },
		exists: (p) => p === "C:/KiCad/10.0/bin/ngspice.dll",
		expected: "C:/KiCad/10.0/bin/ngspice.dll",
	},
	{
		name: "resolves standard Windows 10.0 KiCad location",
		env: {},
		exists: (p) => p === "C:/Program Files/KiCad/10.0/bin/ngspice.dll",
		expected: "C:/Program Files/KiCad/10.0/bin/ngspice.dll",
	},
	{
		name: "returns null when no library candidate exists",
		env: {},
		exists: () => false,
		expected: null,
	},
];

const AVAILABLE_CASES = [
	{
		name: "returns false when load throws",
		koffiOptions: { loadThrows: true },
		libraryPath: "invalid.dll",
		expected: false,
	},
	{
		name: "returns true and caches check when init succeeds",
		koffiOptions: { initStatus: 0 },
		libraryPath: "fake.dll",
		expected: true,
	},
];

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

function createBgOrderKoffi(events) {
	return createFakeKoffi({
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
}

function createTestRunner(koffiImpl, options = {}) {
	return createSharedNgspice({
		libraryPath: "fake.dll",
		koffiImpl,
		tempDir: os.tmpdir(),
		pollMs: 5,
		...options,
	});
}

function assertHappyPathPlots(res) {
	assert.equal(res.ok, true);
	assert.equal(res.plots.length, 1);
	assert.equal(res.plots[0].plotname, "Operating Point");
	assert.match(res.log, /Simulation completed normally/);
}

function assertHappyPathCleanup(captured) {
	assert.ok(captured.dir);
	assert.equal(fs.existsSync(captured.dir), false);
	assert.equal(captured.circLines[captured.circLines.length - 1], null);
	assert.equal(captured.circLines[captured.circLines.length - 2], ".end");
}

describe("findNgspiceLibrary table", () => {
	for (const tc of FIND_LIBRARY_CASES) {
		test(tc.name, () => {
			const res = findNgspiceLibrary({
				platform: "win32",
				env: tc.env,
				exists: tc.exists,
			});
			assert.equal(res, tc.expected);
		});
	}
});

describe("createSharedNgspice available", () => {
	for (const tc of AVAILABLE_CASES) {
		test(tc.name, async () => {
			const runner = createSharedNgspice({
				libraryPath: tc.libraryPath,
				koffiImpl: createFakeKoffi(tc.koffiOptions),
			});
			const first = await runner.available();
			const second = await runner.available();
			assert.equal(first, tc.expected);
			assert.equal(second, tc.expected);
		});
	}
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
		const runner = createTestRunner(createHappyPathKoffi(captured));

		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assertHappyPathPlots(res);
		assertHappyPathCleanup(captured);
	});

	test("timeout path issues bg_halt and returns timeout error", async () => {
		const fakeKoffi = createFakeKoffi({ alwaysRunning: true });
		const runner = createTestRunner(fakeKoffi, {
			timeoutMs: 30,
			pollMs: 10,
		});
		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assert.equal(res.ok, false);
		assert.ok(fakeKoffi.commands.includes("bg_halt"));
		assert.equal(res.error, "Simulation timed out");
	});

	test("two concurrent runs execute sequentially in order", async () => {
		const executionOrder = [];
		const runner = createTestRunner(createSequentialTestKoffi(executionOrder));

		const [r1, r2] = await Promise.all([
			runner.run("* run 1\nR1 1 0 1k\n.op\n.end\n"),
			runner.run("* run 2\nR2 1 0 2k\n.op\n.end\n"),
		]);

		assert.deepEqual(executionOrder, [
			"start:1",
			"finish:1",
			"start:2",
			"finish:2",
		]);
		assert.equal(r1.ok, true);
		assert.equal(r2.ok, true);
	});

	test("waits for BGThreadRunning callback before issuing write command", async () => {
		const events = [];
		const runner = createTestRunner(createBgOrderKoffi(events));

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
		const runner = createTestRunner(
			createFakeKoffi({ rawContent: CANNED_CONSTANTS_RAW }),
		);

		const res = await runner.run("R1 1 0 1k\n.op\n.end\n");
		assert.equal(res.error, "Simulation produced no results");
		assert.equal(res.ok, false);
	});
});
