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

function buildDrcFixture() {
	const entries = [
		[
			"violations",
			"clearance",
			"error",
			"Clearance violation",
			"Pad 1 of R1",
			{ x: 10.5, y: 20.25 },
			"uuid-1",
		],
		[
			"unconnected_items",
			"unconnected_items",
			"warning",
			"Unconnected pin",
			"Pin 2 of U1",
			null,
			"uuid-2",
		],
		[
			"schematic_parity",
			"schematic_parity",
			"warning",
			"Component not in schematic",
			"R2 missing",
			{ x: 5, y: 5 },
			null,
		],
	];
	const report = {};
	for (const [key, type, severity, desc, itemDesc, pos, uuid] of entries) {
		const item = { description: itemDesc, pos };
		if (uuid) item.uuid = uuid;
		report[key] = [{ type, severity, description: desc, items: [item] }];
	}
	return report;
}

function buildErcFixture() {
	const sheets = [
		{
			name: "/",
			type: "pin_not_connected",
			severity: "error",
			desc: "Pin not connected",
			itemDesc: "Pin 1 of U1",
			pos: { x: 12.0, y: 34.0 },
		},
		{
			name: "/power",
			type: "power_pin_not_driven",
			severity: "warning",
			desc: "Power pin not driven",
			itemDesc: "VCC pin of U2",
			pos: null,
		},
	];
	return {
		sheets: sheets.map((s) => ({
			name: s.name,
			violations: [
				{
					type: s.type,
					severity: s.severity,
					description: s.desc,
					items: [{ description: s.itemDesc, pos: s.pos }],
				},
			],
		})),
	};
}

const SAMPLE_DRC_REPORT = buildDrcFixture();
const SAMPLE_ERC_REPORT = buildErcFixture();

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

async function postJson(port, endpoint, payload) {
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
		// Non-JSON response body handled gracefully as raw text payload
		json = { raw: text, parseError: err.message };
	}
	return { status: res.status, json, text };
}

async function createTestHarness(options = {}) {
	const cli = options.cli ?? createMockCli({ report: options.report });
	const app = options.app ?? buildExpressApp(cli.exec, options.cliPath);
	const srv = http.createServer(app);
	await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
	const { port } = srv.address();

	return {
		cli,
		post: (endpoint, payload) => postJson(port, endpoint, payload),
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

async function postAndVerifyCheck(harness, endpoint, payload, spec) {
	const res = await harness.post(endpoint, payload);
	assert.equal(res.status, 200);
	verifyCheckResult(res, harness.cli, spec);
	return res;
}

async function requestDrcWithServer(serverOpts) {
	let res;
	await withTestServer(serverOpts, async (harness) => {
		res = await harness.post("/api/checks/drc", { pcb: VALID_PCB });
	});
	return res;
}

async function runDrcCheck(cliConfig) {
	const cli = createMockCli(cliConfig);
	const res = await requestDrcWithServer({ cli });
	assertTmpCleaned(cli);
	return res;
}

const expV = (type, severity, pos) =>
	pos !== undefined ? { type, severity, pos } : { type, severity };

describe("check-routes DRC tests", () => {
	const getHarness = bindHarness(SAMPLE_DRC_REPORT);

	test("runs DRC and normalises violations, unconnected, and parity", async () => {
		await postAndVerifyCheck(
			getHarness(),
			"/api/checks/drc",
			{ pcb: VALID_PCB },
			{
				count: 3,
				summary: { error: 1, warning: 2 },
				violations: [
					expV("clearance", "error", { x: 10.5, y: 20.25 }),
					expV("unconnected_items", "warning", null),
					expV("schematic_parity", "warning"),
				],
			},
		);
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
		await postAndVerifyCheck(
			getHarness(),
			"/api/checks/erc",
			{ sch: VALID_SCH },
			{
				count: 2,
				summary: { error: 1, warning: 1 },
				violations: [
					expV("pin_not_connected", "error", { x: 12.0, y: 34.0 }),
					expV("power_pin_not_driven", "warning", null),
				],
			},
		);
	});
});

describe("check-routes 400 validation cases", () => {
	const getHarness = bindHarness(SAMPLE_DRC_REPORT);

	const DRC_BAD_PARAMS = [
		["missing pcb", {}],
		["pcb not string", { pcb: 12345 }],
		["invalid pcb header", { pcb: "(wrong_pcb (version 1))" }],
		["unconnected not boolean", { pcb: VALID_PCB, unconnected: "no" }],
	];
	const ERC_BAD_PARAMS = [
		["missing sch", {}],
		["sch not string", { sch: true }],
		["invalid sch header", { sch: "(wrong_sch (version 1))" }],
	];
	const BAD_PARAM_CASES = [
		...DRC_BAD_PARAMS.map(([desc, body]) => ({
			prefix: "DRC",
			route: "/api/checks/drc",
			desc,
			body,
		})),
		...ERC_BAD_PARAMS.map(([desc, body]) => ({
			prefix: "ERC",
			route: "/api/checks/erc",
			desc,
			body,
		})),
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
		const res = await requestDrcWithServer({
			cliPath: "/nonexistent/kicad-cli",
		});
		assertErrorResponse(res, 503, "KiCad CLI");
	});

	test("integrates with createApp at /api/checks/drc and /api/checks/erc", async () => {
		await withTestServer({ app: createApp() }, async (harness) => {
			for (const ep of ["/api/checks/drc", "/api/checks/erc"]) {
				const res = await harness.post(ep, {});
				assert.equal(res.status, 400);
			}
		});
	});
});
