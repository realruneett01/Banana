import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
	createNgspice,
	parseRawAscii,
	validateNetlist,
} from "../../backend/src/engine/spice/ngspice-runner.js";

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

const CANNED_TRAN_RAW = `Title: RC Transient
Date: Wed Nov 11 12:00:00 2026
Plotname: Transient Analysis
Flags: real
No. Variables: 3
No. Points: 3
Variables:
	0	time	time
	1	v(in)	voltage
	2	v(out)	voltage
Values:
0	0.000000e+00
	5.000000e+00
	0.000000e+00
1	1.000000e-03
	5.000000e+00
	3.160000e+00
2	2.000000e-03
	5.000000e+00
	4.320000e+00
`;

const CANNED_COMPLEX_RAW = `Title: AC Filter
Date: Wed Nov 11 12:00:00 2026
Plotname: AC Analysis
Flags: complex
No. Variables: 2
No. Points: 2
Variables:
	0	frequency	frequency
	1	v(out)	voltage
Values:
0	1.000000e+02,0.000000e+00
	9.900000e-01,-1.200000e-01
1	1.000000e+03,0.000000e+00
	7.500000e-01,-2.500000e-01
`;

const MULTI_PLOT_RAW = `${CANNED_OP_RAW}\n${CANNED_TRAN_RAW}`;

const PARSE_RAW_CASES = [
	{
		name: "parses single-point .op raw text",
		raw: CANNED_OP_RAW,
		title: "Simple OP",
		plotname: "Operating Point",
		variables: [
			{ index: 0, name: "v(out)", type: "voltage" },
			{ index: 1, name: "i(v1)", type: "current" },
		],
		points: [[3.3, -0.012]],
	},
	{
		name: "parses multi-point .tran raw text",
		raw: CANNED_TRAN_RAW,
		title: "RC Transient",
		plotname: "Transient Analysis",
		variablesLength: 3,
		points: [
			[0, 5, 0],
			[0.001, 5, 3.16],
			[0.002, 5, 4.32],
		],
	},
	{
		name: "extracts real component from complex values",
		raw: CANNED_COMPLEX_RAW,
		points: [
			[100, 0.99],
			[1000, 0.75],
		],
	},
];

const GARBAGE_SAMPLES = [
	{ name: "empty string", input: "" },
	{ name: "whitespace only", input: "   \n\t  " },
	{ name: "non-raw text", input: "Simulation finished with exit code 0" },
	{ name: "missing values block", input: "Variables:\n0 v(1) voltage" },
	{
		name: "invalid number in values",
		input:
			"No. Variables: 1\nNo. Points: 1\nVariables:\n0 v(1) voltage\nValues:\n0 invalid_num",
	},
];

const AVAILABLE_CASES = [
	{
		name: "returns true and caches check when ngspice is found",
		onExec: ({ file, args, callback }) => {
			assert.equal(file, "ngspice");
			assert.deepEqual(args, ["--version"]);
			callback(null, "ngspice-38\n", "");
		},
		expected: true,
	},
	{
		name: "returns false when binary is missing (ENOENT) and caches check",
		onExec: ({ callback }) => {
			const err = new Error("spawn ngspice ENOENT");
			err.code = "ENOENT";
			callback(err, "", "");
		},
		expected: false,
	},
];

const REJECTED_CASES = [
	{ name: ".control block", netlist: ".control\nrun\n.endc" },
	{ name: ".endc directive", netlist: "R1 1 0 1k\n.endc" },
	{ name: ".exec command", netlist: ".exec touch /tmp/pwned" },
	{ name: ".include directive", netlist: ".include /etc/passwd" },
	{ name: ".inc directive", netlist: ".inc /etc/passwd" },
	{ name: ".lib directive", netlist: ".lib /path/to/lib" },
	{ name: ".write command", netlist: ".write /tmp/out.raw" },
	{ name: ".shell command", netlist: ".shell whoami" },
	{ name: "bare shell command", netlist: "shell whoami" },
	{ name: "*ng_script header", netlist: "*ng_script\nrun" },
	{ name: "* ng_script with space", netlist: "* ng_script\nrun" },
	{ name: "backtick in line", netlist: ".param val = `id`" },
	{ name: "NUL byte in line", netlist: "* harmless looking\0.end" },
	{ name: "$() command substitution", netlist: ".param val = $(whoami)" },
	{
		name: "netlist over 500 KB",
		netlist: `* large netlist\n${"R1 1 0 1k\n".repeat(60000)}`,
	},
	{ name: "case-insensitive .CONTROL", netlist: ".CONTROL\nrun\n.endc" },
	{ name: "case-insensitive .INCLUDE", netlist: ".INCLUDE /etc/shadow" },
	{ name: "case-insensitive SHELL", netlist: "SHELL id" },
	{ name: "case-insensitive *NG_SCRIPT", netlist: "*NG_SCRIPT\nrun" },
	{ name: "leading whitespace before .control", netlist: "   .control\nrun" },
	{ name: "leading whitespace before .include", netlist: "\t.include /path" },
	{ name: "leading whitespace before shell", netlist: "  shell ls" },
	{
		name: "continuation with + leading to .include",
		netlist: "R1 1 0 1k\n+ .include /etc/passwd",
	},
	{
		name: "continuation with + without space to .include",
		netlist: "R1 1 0 1k\n+.include /etc/passwd",
	},
	{
		name: "continuation with + leading to .control",
		netlist: "R1 1 0 1k\n+ .control",
	},
	{
		name: "continuation with + leading to shell",
		netlist: "R1 1 0 1k\n+ shell rm -rf /",
	},
	{
		name: ".save with absolute Unix path",
		netlist: ".save /tmp/output.raw",
	},
	{
		name: ".save with relative dot path",
		netlist: ".save ./output.raw",
	},
	{
		name: ".save with parent dot path",
		netlist: ".save ../output.raw",
	},
	{
		name: ".save with raw extension",
		netlist: ".save output.raw",
	},
	{
		name: ".save with txt extension",
		netlist: ".save results.txt",
	},
	{
		name: ".save with double quotes",
		netlist: '.save "output"',
	},
	{
		name: ".save with single quotes",
		netlist: ".save 'output'",
	},
	{
		name: ".save with Windows path",
		netlist: "R1 1 0 1k\n.save C:\\temp\\out.raw",
	},
	{
		name: ".save with file= parameter",
		netlist: ".save file=output.raw",
	},
	{
		name: ".save continued across lines with path",
		netlist: ".save\n+ /tmp/output.raw",
	},
	{
		name: ".save all continued across lines with path",
		netlist: ".save all\n+ /tmp/output.raw",
	},
];

const ALLOWED_CASES = [
	{
		name: "standard normal netlist with options, op, tran, save and end",
		netlist: `* RC lowpass filter
.options savecurrents
.param rval = 1k
V1 in 0 dc 5
R1 in out {rval}
C1 out 0 1u
.op
.tran 1u 10m
.save all
.save v(out) i(v1)
.end
`,
	},
	{
		name: "various allowed .save styles without file paths",
		netlist: `* test saves
.save all
.save v(out)
.save v(1)
.save v(in, out)
.save i(v1)
.save @r1[i]
.save all v(1) i(v1)
.end
`,
	},
	{
		name: "continuation lines for normal components",
		netlist: `* multi-line resistor
R1
+ in
+ out
+ 1k
.end
`,
	},
];

function assertPlotAttributes(plot, tc) {
	if (tc.title) assert.equal(plot.title, tc.title);
	if (tc.plotname) assert.equal(plot.plotname, tc.plotname);
	if (tc.variables) assert.deepEqual(plot.variables, tc.variables);
	if (tc.variablesLength !== undefined) {
		assert.equal(plot.variables.length, tc.variablesLength);
	}
	assert.deepEqual(plot.points, tc.points);
}

function assertOkSinglePlot(res) {
	assert.equal(res.ok, true);
	assert.equal(res.plots.length, 1);
	return res.plots[0];
}

function assertErrorResult(res) {
	assert.equal(res.ok, false);
	assert.equal(typeof res.error, "string");
	assert.ok(res.error.length > 0);
}

function assertDirCleanedUp(dir) {
	assert.ok(dir, "Work directory should have been captured");
	assert.equal(fs.existsSync(dir), false, "Temp dir must be removed");
}

function assertTimeoutErrorPayload(result) {
	assert.equal(result.ok, false);
	assert.ok(!result.error.includes("Error:"), "Should not include stack trace");
	const errorLines = result.error.split("\n");
	assert.equal(errorLines.length, 20);
	assert.equal(errorLines[0], "log line 11");
	assert.equal(errorLines[19], "log line 30");
	assert.ok(result.log.includes("log line 1"));
}

function makeFakeExec({ onExec }) {
	let callsCount = 0;
	const fn = (file, args, options, callback) => {
		callsCount += 1;
		if (onExec) {
			onExec({ file, args, options, callback, callsCount });
			return;
		}
		callback(null, "", "");
	};
	fn.getCallsCount = () => callsCount;
	return fn;
}

function createTestRunner(fakeExec) {
	return createNgspice({ execFileFn: fakeExec, tempDir: os.tmpdir() });
}

function handleBatchExec({ args, callback, onCaptureDir }) {
	assert.equal(args[0], "-b");
	assert.equal(args[1], "-r");
	assert.equal(args[3], "-o");
	const rawPath = args[2];
	const logPath = args[4];
	const cirPath = args[5];

	onCaptureDir(path.dirname(rawPath));
	assert.ok(fs.existsSync(cirPath));
	assert.equal(fs.readFileSync(cirPath, "utf8"), "* test circuit\n.end\n");

	fs.writeFileSync(rawPath, CANNED_OP_RAW, "utf8");
	fs.writeFileSync(logPath, "Simulation completed normally.\n", "utf8");
	callback(null, "", "");
}

describe("parseRawAscii", () => {
	for (const tc of PARSE_RAW_CASES) {
		test(tc.name, () => {
			const res = parseRawAscii(tc.raw);
			const plot = assertOkSinglePlot(res);
			assertPlotAttributes(plot, tc);
		});
	}

	test("handles multiple plots in a single raw file", () => {
		const res = parseRawAscii(MULTI_PLOT_RAW);
		assert.equal(res.ok, true);
		assert.deepEqual(
			res.plots.map((p) => p.plotname),
			["Operating Point", "Transient Analysis"],
		);
		assert.equal(res.plots.length, 2);
		assert.equal(res.plots[0].plotname, "Operating Point");
		assert.equal(res.plots[1].plotname, "Transient Analysis");
	});

	for (const { name, input } of GARBAGE_SAMPLES) {
		test(`returns ok: false for garbage: ${name}`, () => {
			assertErrorResult(parseRawAscii(input));
		});
	}
});

describe("createNgspice available", () => {
	for (const { name, onExec, expected } of AVAILABLE_CASES) {
		test(name, async () => {
			const fakeExec = makeFakeExec({ onExec });
			const runner = createNgspice({ execFileFn: fakeExec });
			const first = await runner.available();
			const second = await runner.available();
			assert.equal(first, expected);
			assert.equal(second, expected);
			assert.equal(fakeExec.getCallsCount(), 1);
		});
	}
});

describe("createNgspice run", () => {
	test("executes batch mode, parses raw output, and cleans up temp directory", async () => {
		let capturedDir = null;
		const fakeExec = makeFakeExec({
			onExec: (ctx) =>
				handleBatchExec({
					...ctx,
					onCaptureDir: (d) => {
						capturedDir = d;
					},
				}),
		});

		const runner = createTestRunner(fakeExec);
		const result = await runner.run("* test circuit\n.end\n");

		assertOkSinglePlot(result);
		assert.match(result.log, /Simulation completed normally/);
		assertDirCleanedUp(capturedDir);
	});

	test("handles timeout/error by returning ok: false with log tail and removing dir", async () => {
		let capturedDir = null;
		const lines = Array.from({ length: 30 }, (_, i) => `log line ${i + 1}`);
		const fakeExec = makeFakeExec({
			onExec: ({ args, callback }) => {
				capturedDir = path.dirname(args[2]);
				fs.writeFileSync(args[4], lines.join("\n"), "utf8");
				const err = new Error("Command failed: ngspice timed out");
				callback(err, "", "process killed");
			},
		});

		const runner = createTestRunner(fakeExec);
		const result = await runner.run("* test netlist\n.end\n");

		assertTimeoutErrorPayload(result);
		assertDirCleanedUp(capturedDir);
	});

	test("refuses dangerous netlist without executing or creating temp dir", async () => {
		const fakeExec = makeFakeExec({
			onExec: () => {
				assert.fail("execFileFn must not be called for rejected netlists");
			},
		});
		const runner = createTestRunner(fakeExec);

		const result = await runner.run(".include /etc/passwd\n.end\n");
		assertErrorResult(result);
		assert.equal(fakeExec.getCallsCount(), 0);
	});
});

describe("validateNetlist", () => {
	for (const { name, netlist } of REJECTED_CASES) {
		test(`rejects dangerous netlist: ${name}`, () => {
			assertErrorResult(validateNetlist(netlist));
		});
	}

	for (const { name, netlist } of ALLOWED_CASES) {
		test(`accepts safe netlist: ${name}`, () => {
			const res = validateNetlist(netlist);
			assert.equal(res.ok, true);
		});
	}
});
