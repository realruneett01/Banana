import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { KICAD_CLI_PATH } from "../../backend/src/config.js";
import { createKicadCli } from "../../backend/src/engine/kicad-cli.js";

function createFakeExec({
	stdout = "",
	stderr = "",
	error = null,
	onCall = null,
} = {}) {
	const calls = [];
	const fake = (file, args, options, callback) => {
		calls.push({ file, args, options });
		if (typeof onCall === "function") {
			onCall({ file, args, options });
		}
		callback(error, stdout, stderr);
	};
	return { fake, calls };
}

function createTempReportPath(name) {
	return path.join(os.tmpdir(), `test-kicad-${Date.now()}-${name}.json`);
}

function createExitError(code) {
	const err = new Error(`Command failed with exit code ${code}`);
	err.code = code;
	return err;
}

async function withTempReport(name, content, fn) {
	const outPath = createTempReportPath(name);
	fs.writeFileSync(outPath, JSON.stringify(content), "utf8");
	try {
		return await fn(outPath);
	} finally {
		fs.rmSync(outPath, { force: true });
	}
}

const SAMPLE_REPORT = {
	violations: [
		{
			type: "clearance",
			severity: "error",
			description: "Clearance violation",
			items: [
				{
					uuid: "uuid-1",
					description: "Pad 1 of R1",
					pos: { x: 10.5, y: 20.25 },
				},
			],
		},
		{
			type: "unconnected",
			severity: "warning",
			description: "Unconnected pin",
			items: [
				{
					uuid: "uuid-2",
					description: "Pin 2 of U1",
					pos: null,
				},
			],
		},
	],
};

describe("module contract", () => {
	test("exports createKicadCli function", async () => {
		const mod = await import("../../backend/src/engine/kicad-cli.js");
		assert.equal(typeof mod.createKicadCli, "function");
	});

	test("returns runner object with required methods", () => {
		const runner = createKicadCli();
		const REQUIRED_METHODS = ["runErc", "runDrc", "exportNetlist", "version"];
		for (const method of REQUIRED_METHODS) {
			assert.equal(typeof runner[method], "function");
		}
	});

	test("uses KICAD_CLI_PATH by default", async () => {
		const { fake, calls } = createFakeExec({ stdout: "10.0.0" });
		const runner = createKicadCli({ exec: fake });
		await runner.version();
		assert.equal(calls[0].file, KICAD_CLI_PATH);
	});
});

describe("exact argument arrays", () => {
	const REPORT_CLI_CASES = [
		[
			"runErc passes exact argument array",
			"erc",
			["sch", "erc"],
			path.resolve("/tmp/board.kicad_sch"),
			(runner, file, out) => runner.runErc(file, out),
		],
		[
			"runDrc passes exact argument array",
			"drc",
			["pcb", "drc"],
			path.resolve("/tmp/board.kicad_pcb"),
			(runner, file, out) => runner.runDrc(file, out),
		],
	];

	for (const [name, kind, subcommands, inputPath, run] of REPORT_CLI_CASES) {
		test(name, async () => {
			const { fake, calls } = createFakeExec();
			const runner = createKicadCli({ cliPath: "/bin/kicad-cli", exec: fake });
			await withTempReport(kind, { violations: [] }, async (outPath) => {
				await run(runner, inputPath, outPath);
				assert.deepEqual(calls[0].args, [
					...subcommands,
					"--format",
					"json",
					"--severity-all",
					"--output",
					outPath,
					inputPath,
				]);
			});
		});
	}

	test("exportNetlist passes exact argument array with default and custom format", async () => {
		const schPath = path.resolve("/tmp/main.kicad_sch");
		const outNet = path.resolve("/tmp/main.net");
		const { fake, calls } = createFakeExec();
		const runner = createKicadCli({ cliPath: "/bin/kicad-cli", exec: fake });
		const NETLIST_CASES = [
			["kicadsexpr", () => runner.exportNetlist(schPath, outNet)],
			["spice", () => runner.exportNetlist(schPath, outNet, "spice")],
		];

		for (const [idx, [format, run]] of NETLIST_CASES.entries()) {
			await run();
			assert.deepEqual(calls[idx].args, [
				"sch",
				"export",
				"netlist",
				"--format",
				format,
				"--output",
				outNet,
				schPath,
			]);
		}
	});

	test("version passes exact argument array", async () => {
		const { fake, calls } = createFakeExec({ stdout: "10.0.3\n" });
		const runner = createKicadCli({ cliPath: "/bin/kicad-cli", exec: fake });
		const ver = await runner.version();
		assert.deepEqual(calls[0].args, ["--version"]);
		assert.equal(ver, "10.0.3");
	});
});

describe("timeout and buffer options", () => {
	const TIMEOUT_CASES = [
		[
			"passes default timeout 120000 and 16MB maxBuffer",
			{},
			120000,
			16 * 1024 * 1024,
		],
		["passes custom timeoutMs", { timeoutMs: 45000 }, 45000, null],
	];

	for (const [
		name,
		config,
		expectedTimeout,
		expectedMaxBuffer,
	] of TIMEOUT_CASES) {
		test(name, async () => {
			const { fake, calls } = createFakeExec({ stdout: "1.0.0" });
			const runner = createKicadCli({ exec: fake, ...config });
			await runner.version();
			assert.equal(calls[0].options.timeout, expectedTimeout);
			if (expectedMaxBuffer !== null) {
				assert.equal(calls[0].options.maxBuffer, expectedMaxBuffer);
			}
		});
	}
});

describe("path rejection before spawning", () => {
	async function assertRejectsBeforeSpawn(action) {
		const { fake, calls } = createFakeExec();
		const runner = createKicadCli({ exec: fake });
		await assert.rejects(() => action(runner));
		assert.equal(calls.length, 0);
	}

	const REJECTION_METHODS = [
		{
			method: "runErc",
			pathParam: "schPath",
			relPath: "board.kicad_sch",
			wrongExt: "/tmp/board.kicad_pcb",
			call: (r, p, o) => r.runErc(p, o),
			out: "/tmp/out.json",
		},
		{
			method: "runDrc",
			pathParam: "pcbPath",
			relPath: "board.kicad_pcb",
			wrongExt: "/tmp/board.kicad_sch",
			call: (r, p, o) => r.runDrc(p, o),
			out: "/tmp/out.json",
		},
		{
			method: "exportNetlist",
			pathParam: "schPath",
			relPath: "board.kicad_sch",
			wrongExt: "/tmp/board.kicad_pcb",
			call: (r, p, o) => r.exportNetlist(p, o),
			out: "/tmp/out.net",
		},
	];

	for (const {
		method,
		pathParam,
		relPath,
		wrongExt,
		call,
		out,
	} of REJECTION_METHODS) {
		test(`rejects relative ${pathParam} for ${method} before spawning`, () =>
			assertRejectsBeforeSpawn((runner) => call(runner, relPath, out)));

		test(`rejects wrong extension for ${method} before spawning`, () =>
			assertRejectsBeforeSpawn((runner) =>
				call(runner, path.resolve(wrongExt), out),
			));
	}

	test("rejects empty output path before spawning", () =>
		assertRejectsBeforeSpawn((runner) =>
			runner.runErc(path.resolve("/tmp/board.kicad_sch"), ""),
		));
});

describe("report parsing", () => {
	const PARSING_CASES = [
		[
			"parses violations and calculates summary accurately",
			"parsing",
			SAMPLE_REPORT,
			path.resolve("/tmp/board.kicad_sch"),
			(runner, file, out) => runner.runErc(file, out),
			(report) => {
				assert.equal(report.violations.length, 2);
				assert.equal(report.summary.errors, 1);
				assert.equal(report.summary.warnings, 1);
				const expectedItems = [
					{
						uuid: "uuid-1",
						description: "Pad 1 of R1",
						pos: { x: 10.5, y: 20.25 },
					},
					{
						uuid: "uuid-2",
						description: "Pin 2 of U1",
						pos: null,
					},
				];
				for (const [idx, item] of expectedItems.entries()) {
					assert.deepEqual(report.violations[idx].items[0], item);
				}
			},
		],
		[
			"parses empty violations cleanly",
			"empty",
			{ violations: [] },
			path.resolve("/tmp/board.kicad_pcb"),
			(runner, file, out) => runner.runDrc(file, out),
			(report) => {
				assert.deepEqual(report.violations, []);
				assert.deepEqual(report.summary, { errors: 0, warnings: 0 });
			},
		],
	];

	for (const [name, tag, data, filePath, run, check] of PARSING_CASES) {
		test(name, async () => {
			const { fake } = createFakeExec();
			const runner = createKicadCli({ exec: fake });
			await withTempReport(tag, data, async (outPath) => {
				const report = await run(runner, filePath, outPath);
				check(report);
			});
		});
	}
});

describe("exit code 5 handling", () => {
	const EXIT_5_CASES = [
		[
			"runErc",
			"erc5",
			path.resolve("/tmp/board.kicad_sch"),
			(runner, file, out) => runner.runErc(file, out),
			"errors",
		],
		[
			"runDrc",
			"drc5",
			path.resolve("/tmp/board.kicad_pcb"),
			(runner, file, out) => runner.runDrc(file, out),
			"warnings",
		],
	];

	for (const [name, tag, filePath, run, summaryKey] of EXIT_5_CASES) {
		test(`${name} accepts exit code 5 as non-error and parses report`, async () => {
			const { fake } = createFakeExec({ error: createExitError(5) });
			const runner = createKicadCli({ exec: fake });

			await withTempReport(tag, SAMPLE_REPORT, async (outPath) => {
				const report = await run(runner, filePath, outPath);
				assert.equal(report.violations.length, 2);
				assert.equal(report.summary[summaryKey], 1);
			});
		});
	}
});

describe("non-zero exit rejection", () => {
	const schTarget = path.resolve("/tmp/b.kicad_sch");
	const pcbTarget = path.resolve("/tmp/b.kicad_pcb");
	const ERROR_CASES = [
		["runErc with exit code 1", 1, (r, out) => r.runErc(schTarget, out)],
		["runDrc with exit code 2", 2, (r, out) => r.runDrc(pcbTarget, out)],
		[
			"exportNetlist with exit code 5",
			5,
			(r, out) => r.exportNetlist(schTarget, out),
		],
		[
			"exportNetlist with exit code 1",
			1,
			(r, out) => r.exportNetlist(schTarget, out),
		],
		["version with exit code 1", 1, (r) => r.version()],
	];

	for (const [name, exitCode, invoke] of ERROR_CASES) {
		test(`rejects promise on ${name}`, async () => {
			const outPath = createTempReportPath("err");
			const { fake } = createFakeExec({ error: createExitError(exitCode) });
			const runner = createKicadCli({ exec: fake });
			await assert.rejects(() => invoke(runner, outPath));
		});
	}
});
