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
		assert.equal(typeof runner.runErc, "function");
		assert.equal(typeof runner.runDrc, "function");
		assert.equal(typeof runner.exportNetlist, "function");
		assert.equal(typeof runner.version, "function");
	});

	test("uses KICAD_CLI_PATH by default", async () => {
		const { fake, calls } = createFakeExec({ stdout: "10.0.0" });
		const runner = createKicadCli({ exec: fake });
		await runner.version();
		assert.equal(calls[0].file, KICAD_CLI_PATH);
	});
});

describe("exact argument arrays", () => {
	test("runErc passes exact argument array", async () => {
		const outPath = createTempReportPath("erc");
		fs.writeFileSync(outPath, JSON.stringify({ violations: [] }), "utf8");
		const schPath = path.resolve("/tmp/board.kicad_sch");
		const { fake, calls } = createFakeExec();
		const runner = createKicadCli({ cliPath: "/bin/kicad-cli", exec: fake });

		try {
			await runner.runErc(schPath, outPath);
			assert.deepEqual(calls[0].args, [
				"sch",
				"erc",
				"--format",
				"json",
				"--severity-all",
				"--output",
				outPath,
				schPath,
			]);
		} finally {
			fs.rmSync(outPath, { force: true });
		}
	});

	test("runDrc passes exact argument array", async () => {
		const outPath = createTempReportPath("drc");
		fs.writeFileSync(outPath, JSON.stringify({ violations: [] }), "utf8");
		const pcbPath = path.resolve("/tmp/board.kicad_pcb");
		const { fake, calls } = createFakeExec();
		const runner = createKicadCli({ cliPath: "/bin/kicad-cli", exec: fake });

		try {
			await runner.runDrc(pcbPath, outPath);
			assert.deepEqual(calls[0].args, [
				"pcb",
				"drc",
				"--format",
				"json",
				"--severity-all",
				"--output",
				outPath,
				pcbPath,
			]);
		} finally {
			fs.rmSync(outPath, { force: true });
		}
	});

	test("exportNetlist passes exact argument array with default and custom format", async () => {
		const schPath = path.resolve("/tmp/main.kicad_sch");
		const outNet = path.resolve("/tmp/main.net");
		const { fake, calls } = createFakeExec();
		const runner = createKicadCli({ cliPath: "/bin/kicad-cli", exec: fake });

		await runner.exportNetlist(schPath, outNet);
		assert.deepEqual(calls[0].args, [
			"sch",
			"export",
			"netlist",
			"--format",
			"kicadsexpr",
			"--output",
			outNet,
			schPath,
		]);

		await runner.exportNetlist(schPath, outNet, "spice");
		assert.deepEqual(calls[1].args, [
			"sch",
			"export",
			"netlist",
			"--format",
			"spice",
			"--output",
			outNet,
			schPath,
		]);
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
	test("passes default timeout 120000 and 16MB maxBuffer", async () => {
		const { fake, calls } = createFakeExec({ stdout: "1.0.0" });
		const runner = createKicadCli({ exec: fake });
		await runner.version();
		assert.equal(calls[0].options.timeout, 120000);
		assert.equal(calls[0].options.maxBuffer, 16 * 1024 * 1024);
	});

	test("passes custom timeoutMs", async () => {
		const { fake, calls } = createFakeExec({ stdout: "1.0.0" });
		const runner = createKicadCli({ exec: fake, timeoutMs: 45000 });
		await runner.version();
		assert.equal(calls[0].options.timeout, 45000);
	});
});

describe("path rejection before spawning", () => {
	const REJECTION_CASES = [
		{
			name: "relative schPath for runErc",
			fn: (r) => r.runErc("board.kicad_sch", "/tmp/out.json"),
		},
		{
			name: "wrong extension for runErc",
			fn: (r) =>
				r.runErc(path.resolve("/tmp/board.kicad_pcb"), "/tmp/out.json"),
		},
		{
			name: "relative pcbPath for runDrc",
			fn: (r) => r.runDrc("board.kicad_pcb", "/tmp/out.json"),
		},
		{
			name: "wrong extension for runDrc",
			fn: (r) =>
				r.runDrc(path.resolve("/tmp/board.kicad_sch"), "/tmp/out.json"),
		},
		{
			name: "relative schPath for exportNetlist",
			fn: (r) => r.exportNetlist("board.kicad_sch", "/tmp/out.net"),
		},
		{
			name: "wrong extension for exportNetlist",
			fn: (r) =>
				r.exportNetlist(path.resolve("/tmp/board.kicad_pcb"), "/tmp/out.net"),
		},
		{
			name: "empty output path",
			fn: (r) => r.runErc(path.resolve("/tmp/board.kicad_sch"), ""),
		},
	];

	for (const { name, fn } of REJECTION_CASES) {
		test(`rejects ${name} before spawning`, async () => {
			const { fake, calls } = createFakeExec();
			const runner = createKicadCli({ exec: fake });
			await assert.rejects(() => fn(runner));
			assert.equal(calls.length, 0);
		});
	}
});

describe("report parsing", () => {
	test("parses violations and calculates summary accurately", async () => {
		const outPath = createTempReportPath("parsing");
		fs.writeFileSync(outPath, JSON.stringify(SAMPLE_REPORT), "utf8");
		const schPath = path.resolve("/tmp/board.kicad_sch");
		const { fake } = createFakeExec();
		const runner = createKicadCli({ exec: fake });

		try {
			const report = await runner.runErc(schPath, outPath);
			assert.equal(report.violations.length, 2);
			assert.equal(report.summary.errors, 1);
			assert.equal(report.summary.warnings, 1);
			assert.deepEqual(report.violations[0].items[0], {
				uuid: "uuid-1",
				description: "Pad 1 of R1",
				pos: { x: 10.5, y: 20.25 },
			});
			assert.deepEqual(report.violations[1].items[0], {
				uuid: "uuid-2",
				description: "Pin 2 of U1",
				pos: null,
			});
		} finally {
			fs.rmSync(outPath, { force: true });
		}
	});

	test("parses empty violations cleanly", async () => {
		const outPath = createTempReportPath("empty");
		fs.writeFileSync(outPath, JSON.stringify({ violations: [] }), "utf8");
		const pcbPath = path.resolve("/tmp/board.kicad_pcb");
		const { fake } = createFakeExec();
		const runner = createKicadCli({ exec: fake });

		try {
			const report = await runner.runDrc(pcbPath, outPath);
			assert.deepEqual(report.violations, []);
			assert.deepEqual(report.summary, { errors: 0, warnings: 0 });
		} finally {
			fs.rmSync(outPath, { force: true });
		}
	});
});

describe("exit code 5 handling", () => {
	test("runErc accepts exit code 5 as non-error and parses report", async () => {
		const outPath = createTempReportPath("erc5");
		fs.writeFileSync(outPath, JSON.stringify(SAMPLE_REPORT), "utf8");
		const schPath = path.resolve("/tmp/board.kicad_sch");
		const { fake } = createFakeExec({ error: createExitError(5) });
		const runner = createKicadCli({ exec: fake });

		try {
			const report = await runner.runErc(schPath, outPath);
			assert.equal(report.violations.length, 2);
			assert.equal(report.summary.errors, 1);
		} finally {
			fs.rmSync(outPath, { force: true });
		}
	});

	test("runDrc accepts exit code 5 as non-error and parses report", async () => {
		const outPath = createTempReportPath("drc5");
		fs.writeFileSync(outPath, JSON.stringify(SAMPLE_REPORT), "utf8");
		const pcbPath = path.resolve("/tmp/board.kicad_pcb");
		const { fake } = createFakeExec({ error: createExitError(5) });
		const runner = createKicadCli({ exec: fake });

		try {
			const report = await runner.runDrc(pcbPath, outPath);
			assert.equal(report.violations.length, 2);
			assert.equal(report.summary.warnings, 1);
		} finally {
			fs.rmSync(outPath, { force: true });
		}
	});
});

describe("non-zero exit rejection", () => {
	const ERROR_CASES = [
		{
			name: "runErc with exit code 1",
			fn: (r, sch, out) => r.runErc(sch, out),
			file: path.resolve("/tmp/b.kicad_sch"),
			err: createExitError(1),
		},
		{
			name: "runDrc with exit code 2",
			fn: (r, pcb, out) => r.runDrc(pcb, out),
			file: path.resolve("/tmp/b.kicad_pcb"),
			err: createExitError(2),
		},
		{
			name: "exportNetlist with exit code 5",
			fn: (r, sch, out) => r.exportNetlist(sch, out),
			file: path.resolve("/tmp/b.kicad_sch"),
			err: createExitError(5),
		},
		{
			name: "exportNetlist with exit code 1",
			fn: (r, sch, out) => r.exportNetlist(sch, out),
			file: path.resolve("/tmp/b.kicad_sch"),
			err: createExitError(1),
		},
		{
			name: "version with exit code 1",
			fn: (r) => r.version(),
			file: null,
			err: createExitError(1),
		},
	];

	for (const { name, fn, file, err } of ERROR_CASES) {
		test(`rejects promise on ${name}`, async () => {
			const outPath = createTempReportPath("err");
			const { fake } = createFakeExec({ error: err });
			const runner = createKicadCli({ exec: fake });
			await assert.rejects(() => fn(runner, file, outPath));
		});
	}
});
