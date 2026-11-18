import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createCheckRouter } from "../../backend/src/routes/check-routes.js";

const VALID_PCB = "(kicad_pcb (version 20240108) (generator check_tests))";
const VALID_SCH = "(kicad_sch (version 20240108) (generator check_tests))";

function makeViolation(type, severity, description, item) {
	return [{ type, severity, description, items: [item] }];
}

const SAMPLE_DRC_REPORT = {
	violations: makeViolation("clearance", "error", "Clearance violation", {
		uuid: "uuid-1",
		description: "Pad 1 of R1",
		pos: { x: 10.5, y: 20.25 },
	}),
	unconnected_items: makeViolation(
		"unconnected_items",
		"warning",
		"Unconnected pin",
		{
			uuid: "uuid-2",
			description: "Pin 2 of U1",
			pos: null,
		},
	),
	schematic_parity: makeViolation(
		"schematic_parity",
		"warning",
		"Component not in schematic",
		{
			description: "R2 missing",
			pos: { x: 5, y: 5 },
		},
	),
};

const SAMPLE_ERC_REPORT = {
	sheets: [
		{
			name: "/",
			violations: makeViolation(
				"pin_not_connected",
				"error",
				"Pin not connected",
				{
					description: "Pin 1 of U1",
					pos: { x: 12.0, y: 34.0 },
				},
			),
		},
		{
			name: "/power",
			violations: makeViolation(
				"power_pin_not_driven",
				"warning",
				"Power pin not driven",
				{
					description: "VCC pin of U2",
					pos: null,
				},
			),
		},
	],
};

function getReportPath(argv) {
	const idx = argv.indexOf("--output");
	return idx === -1 ? null : argv[idx + 1];
}

function writeMockReport(reportPath, report, cb) {
	if (!reportPath || !report) {
		cb();
		return;
	}
	fs.writeFile(reportPath, JSON.stringify(report), "utf8", (err) => {
		if (err) return cb(err);
		cb();
	});
}

function createMockCli(config = {}) {
	const calls = [];
	let tmpDir = null;

	const exec = (_file, argv, _opts, done) => {
		calls.push({ args: argv });
		const reportPath = getReportPath(argv);
		if (reportPath) {
			tmpDir = path.dirname(reportPath);
		}

		writeMockReport(reportPath, config.report, (err) => {
			if (err) return done(err);
			if (config.fail) {
				const msg = config.stderr ?? "mock kicad cli error";
				return done(new Error("cli failed"), "", msg);
			}
			done(null, "success", "");
		});
	};

	return { exec, calls, getTmpDir: () => tmpDir };
}

function buildExpressApp(execFileImpl, cliPath = process.execPath) {
	const app = express();
	app.use(express.json({ limit: "32mb" }));
	app.use("/api", createCheckRouter({ execFileImpl, cliPath }));
	return app;
}

async function createTestHarness(options = {}) {
	const cli = options.cli ?? createMockCli({ report: options.report });
	const app = options.app ?? buildExpressApp(cli.exec, options.cliPath);
	const srv = http.createServer(app);
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const port = srv.address().port;

	const post = async (endpoint, payload) => {
		const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		const text = await res.text();
		let json = {};
		try {
			json = JSON.parse(text);
		} catch (err) {
			json = { raw: text, parseError: err.message };
		}
		return { status: res.status, json, text };
	};

	return {
		cli,
		post,
		close: () => new Promise((resolve) => srv.close(resolve)),
	};
}

async function withTestServer(options, fn) {
	const harness = await createTestHarness(options);
	try {
		await fn(harness);
	} finally {
		await harness.close();
	}
}

function bindHarness(report) {
	let harness;
	before(async () => {
		harness = await createTestHarness({ report });
	});
	after(async () => {
		await harness?.close();
	});
	return () => harness;
}

function assertViolations(actual, expectedList) {
	for (let i = 0; i < expectedList.length; i++) {
		const exp = expectedList[i];
		const act = actual[i];
		assert.equal(act.type, exp.type);
		assert.equal(act.severity, exp.severity);
		if (exp.pos !== undefined) {
			assert.deepEqual(act.items[0]?.pos, exp.pos);
		}
	}
}

function assertErrorResponse(res, expectedStatus, expectedSnippet = null) {
	assert.equal(res.status, expectedStatus);
	assert.equal(typeof res.json.error, "string");
	if (expectedSnippet) {
		assert.match(res.json.error, new RegExp(expectedSnippet));
	}
}

function assertTmpCleaned(cli) {
	assert.ok(!fs.existsSync(cli.getTmpDir()));
}

function verifyCheckResult(res, cli, spec) {
	assert.equal(res.json.violations.length, spec.count);
	assert.deepEqual(res.json.counts, spec.summary);
	assertViolations(res.json.violations, spec.violations);
	assertTmpCleaned(cli);
}

async function runDrcCheck(cliConfig) {
	const cli = createMockCli(cliConfig);
	let res;
	await withTestServer({ cli }, async (harness) => {
		res = await harness.post("/api/checks/drc", { pcb: VALID_PCB });
	});
	assertTmpCleaned(cli);
	return res;
}

describe("check-routes DRC tests", () => {
	const getHarness = bindHarness(SAMPLE_DRC_REPORT);

	test("runs DRC and normalises violations, unconnected, and parity", async () => {
		const harness = getHarness();
		const res = await harness.post("/api/checks/drc", { pcb: VALID_PCB });
		assert.equal(res.status, 200);
		verifyCheckResult(res, harness.cli, {
			count: 3,
			summary: { error: 1, warning: 2 },
			violations: [
				{ type: "clearance", severity: "error", pos: { x: 10.5, y: 20.25 } },
				{ type: "unconnected_items", severity: "warning", pos: null },
				{ type: "schematic_parity", severity: "warning" },
			],
		});
	});

	test("excludes unconnected_items when unconnected is false", async () => {
		const harness = getHarness();
		const res = await harness.post("/api/checks/drc", {
			pcb: VALID_PCB,
			unconnected: false,
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.violations.length, 2);
		assert.deepEqual(res.json.counts, { error: 1, warning: 1 });
		const types = res.json.violations.map((v) => v.type);
		assert.ok(!types.includes("unconnected_items"));
	});

	test("sanitizes board name for input file", async () => {
		const harness = getHarness();
		const res = await harness.post("/api/checks/drc", {
			pcb: VALID_PCB,
			name: "my#custom@board",
		});
		assert.equal(res.status, 200);
		const lastCall = harness.cli.calls.at(-1);
		const inputPath = lastCall.args.at(-1);
		assert.ok(inputPath.endsWith("mycustomboard.kicad_pcb"));
	});
});

describe("check-routes ERC tests", () => {
	const getHarness = bindHarness(SAMPLE_ERC_REPORT);

	test("runs ERC and normalises sheet violations", async () => {
		const harness = getHarness();
		const res = await harness.post("/api/checks/erc", { sch: VALID_SCH });
		assert.equal(res.status, 200);
		verifyCheckResult(res, harness.cli, {
			count: 2,
			summary: { error: 1, warning: 1 },
			violations: [
				{
					type: "pin_not_connected",
					severity: "error",
					pos: { x: 12.0, y: 34.0 },
				},
				{ type: "power_pin_not_driven", severity: "warning", pos: null },
			],
		});
	});
});

describe("check-routes 400 validation cases", () => {
	const getHarness = bindHarness(SAMPLE_DRC_REPORT);

	const BAD_PARAM_CASES = [
		{ route: "/api/checks/drc", prefix: "DRC", desc: "missing pcb", body: {} },
		{
			route: "/api/checks/drc",
			prefix: "DRC",
			desc: "pcb not string",
			body: { pcb: 12345 },
		},
		{
			route: "/api/checks/drc",
			prefix: "DRC",
			desc: "invalid pcb header",
			body: { pcb: "(wrong_pcb (version 1))" },
		},
		{
			route: "/api/checks/drc",
			prefix: "DRC",
			desc: "unconnected not boolean",
			body: { pcb: VALID_PCB, unconnected: "no" },
		},
		{ route: "/api/checks/erc", prefix: "ERC", desc: "missing sch", body: {} },
		{
			route: "/api/checks/erc",
			prefix: "ERC",
			desc: "sch not string",
			body: { sch: true },
		},
		{
			route: "/api/checks/erc",
			prefix: "ERC",
			desc: "invalid sch header",
			body: { sch: "(wrong_sch (version 1))" },
		},
	];

	for (const tc of BAD_PARAM_CASES) {
		test(`${tc.prefix} rejects 400 when ${tc.desc}`, async () => {
			const res = await getHarness().post(tc.route, tc.body);
			assertErrorResponse(res, 400);
		});
	}

	for (const { name, route, key, valid } of [
		{ name: "DRC", route: "/api/checks/drc", key: "pcb", valid: VALID_PCB },
		{ name: "ERC", route: "/api/checks/erc", key: "sch", valid: VALID_SCH },
	]) {
		test(`${name} rejects 400 when ${key} exceeds 20 MB`, async () => {
			const payload = `${valid} ${" ".repeat(20 * 1024 * 1024)}`;
			const res = await getHarness().post(route, { [key]: payload });
			assertErrorResponse(res, 400, "20 MB");
		});
	}
});

describe("check-routes failures and service availability", () => {
	test("returns 500 with stderr snippet when report is missing", async () => {
		const res = await runDrcCheck({
			fail: true,
			stderr: "syntax error in board file line 10",
		});
		assertErrorResponse(res, 500, "syntax error in board file");
	});

	test("returns 200 on non-zero exit code if report is present", async () => {
		const res = await runDrcCheck({
			report: SAMPLE_DRC_REPORT,
			fail: true,
			stderr: "violations detected",
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.violations.length, 3);
	});

	test("returns 503 when CLI is missing or path does not exist", async () => {
		await withTestServer(
			{ cliPath: "/nonexistent/kicad-cli" },
			async (harness) => {
				const res = await harness.post("/api/checks/drc", { pcb: VALID_PCB });
				assertErrorResponse(res, 503, "KiCad CLI");
			},
		);
	});

	test("integrates with createApp at /api/checks/drc and /api/checks/erc", async () => {
		await withTestServer({ app: createApp() }, async (harness) => {
			const resDrc = await harness.post("/api/checks/drc", {});
			assert.equal(resDrc.status, 400);
			const resErc = await harness.post("/api/checks/erc", {});
			assert.equal(resErc.status, 400);
		});
	});
});
