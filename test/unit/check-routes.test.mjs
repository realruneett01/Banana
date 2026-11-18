import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createCheckRouter } from "../../backend/src/routes/check-routes.js";

const VALID_PCB = "(kicad_pcb (version 20240108) (generator test))";
const VALID_SCH = "(kicad_sch (version 20240108) (generator test))";

const SAMPLE_DRC_REPORT = {
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
	],
	unconnected_items: [
		{
			type: "unconnected_items",
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
	schematic_parity: [
		{
			type: "schematic_parity",
			severity: "warning",
			description: "Component not in schematic",
			items: [
				{
					description: "R2 missing",
					pos: { x: 5, y: 5 },
				},
			],
		},
	],
};

const SAMPLE_ERC_REPORT = {
	sheets: [
		{
			name: "/",
			violations: [
				{
					type: "pin_not_connected",
					severity: "error",
					description: "Pin not connected",
					items: [
						{
							description: "Pin 1 of U1",
							pos: { x: 12.0, y: 34.0 },
						},
					],
				},
			],
		},
		{
			name: "/power",
			violations: [
				{
					type: "power_pin_not_driven",
					severity: "warning",
					description: "Power pin not driven",
					items: [
						{
							description: "VCC pin of U2",
							pos: null,
						},
					],
				},
			],
		},
	],
};

function makeFakeExec(options = {}) {
	const {
		reportToWrite = null,
		fail = false,
		stderr = "mock kicad cli error",
	} = options;
	let capturedTmpDir = null;
	const calls = [];

	const execFileImpl = (_file, args, _opts, cb) => {
		calls.push({ args });
		const outIdx = args.indexOf("--output");
		const outArg = outIdx !== -1 ? args[outIdx + 1] : null;
		if (outArg) {
			capturedTmpDir = path.dirname(outArg);
			if (reportToWrite !== null) {
				fs.writeFileSync(outArg, JSON.stringify(reportToWrite), "utf8");
			}
		}
		if (fail) {
			return cb(new Error("exec failed"), "", stderr);
		}
		return cb(null, "success", "");
	};

	return { execFileImpl, calls, getTmpDir: () => capturedTmpDir };
}

function startServer(app) {
	const server = http.createServer(app);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, port: server.address().port });
		});
	});
}

function stopServer(server) {
	return new Promise((resolve) => {
		if (!server) return resolve();
		server.close(resolve);
	});
}

async function postJson(port, urlPath, payload) {
	const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	const text = await res.text();
	let json = {};
	try {
		json = JSON.parse(text);
	} catch {
		// Non-JSON response fallback
	}
	return { status: res.status, json, text };
}

describe("check-routes DRC tests", () => {
	let server;
	let port;
	let fake;

	before(async () => {
		fake = makeFakeExec({ reportToWrite: SAMPLE_DRC_REPORT });
		const app = express();
		app.use(express.json({ limit: "32mb" }));
		app.use(
			"/api",
			createCheckRouter({
				execFileImpl: fake.execFileImpl,
				cliPath: process.execPath,
			}),
		);
		const s = await startServer(app);
		server = s.server;
		port = s.port;
	});

	after(async () => {
		await stopServer(server);
	});

	test("runs DRC and normalises violations, unconnected, and parity", async () => {
		const res = await postJson(port, "/api/checks/drc", { pcb: VALID_PCB });
		assert.equal(res.status, 200);
		assert.equal(res.json.violations.length, 3);
		assert.deepEqual(res.json.counts, { error: 1, warning: 2 });

		const [v1, v2, v3] = res.json.violations;
		assert.equal(v1.type, "clearance");
		assert.equal(v1.severity, "error");
		assert.deepEqual(v1.items[0].pos, { x: 10.5, y: 20.25 });

		assert.equal(v2.type, "unconnected_items");
		assert.equal(v2.severity, "warning");
		assert.equal(v2.items[0].pos, null);

		assert.equal(v3.type, "schematic_parity");
		assert.equal(v3.severity, "warning");
		assert.equal(fs.existsSync(fake.getTmpDir()), false);
	});

	test("excludes unconnected_items when unconnected is false", async () => {
		const res = await postJson(port, "/api/checks/drc", {
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
		const res = await postJson(port, "/api/checks/drc", {
			pcb: VALID_PCB,
			name: "my#custom@board",
		});
		assert.equal(res.status, 200);
		const lastCall = fake.calls.at(-1);
		const inputPath = lastCall.args.at(-1);
		assert.ok(inputPath.endsWith("mycustomboard.kicad_pcb"));
	});
});

describe("check-routes ERC tests", () => {
	let server;
	let port;
	let fake;

	before(async () => {
		fake = makeFakeExec({ reportToWrite: SAMPLE_ERC_REPORT });
		const app = express();
		app.use(express.json({ limit: "32mb" }));
		app.use(
			"/api",
			createCheckRouter({
				execFileImpl: fake.execFileImpl,
				cliPath: process.execPath,
			}),
		);
		const s = await startServer(app);
		server = s.server;
		port = s.port;
	});

	after(async () => {
		await stopServer(server);
	});

	test("runs ERC and normalises sheet violations", async () => {
		const res = await postJson(port, "/api/checks/erc", { sch: VALID_SCH });
		assert.equal(res.status, 200);
		assert.equal(res.json.violations.length, 2);
		assert.deepEqual(res.json.counts, { error: 1, warning: 1 });

		const [v1, v2] = res.json.violations;
		assert.equal(v1.type, "pin_not_connected");
		assert.equal(v1.severity, "error");
		assert.deepEqual(v1.items[0].pos, { x: 12.0, y: 34.0 });

		assert.equal(v2.type, "power_pin_not_driven");
		assert.equal(v2.severity, "warning");
		assert.equal(v2.items[0].pos, null);
		assert.equal(fs.existsSync(fake.getTmpDir()), false);
	});
});

describe("check-routes 400 validation cases", () => {
	let server;
	let port;

	before(async () => {
		const fake = makeFakeExec({ reportToWrite: SAMPLE_DRC_REPORT });
		const app = express();
		app.use(express.json({ limit: "32mb" }));
		app.use(
			"/api",
			createCheckRouter({
				execFileImpl: fake.execFileImpl,
				cliPath: process.execPath,
			}),
		);
		const s = await startServer(app);
		server = s.server;
		port = s.port;
	});

	after(async () => {
		await stopServer(server);
	});

	const DRC_400_CASES = [
		{ desc: "missing pcb", body: {} },
		{ desc: "pcb not string", body: { pcb: 12345 } },
		{ desc: "invalid pcb header", body: { pcb: "(wrong_pcb (version 1))" } },
		{
			desc: "unconnected not boolean",
			body: { pcb: VALID_PCB, unconnected: "no" },
		},
	];

	for (const tc of DRC_400_CASES) {
		test(`DRC rejects 400 when ${tc.desc}`, async () => {
			const res = await postJson(port, "/api/checks/drc", tc.body);
			assert.equal(res.status, 400);
			assert.ok(typeof res.json.error === "string");
		});
	}

	const ERC_400_CASES = [
		{ desc: "missing sch", body: {} },
		{ desc: "sch not string", body: { sch: true } },
		{ desc: "invalid sch header", body: { sch: "(wrong_sch (version 1))" } },
	];

	for (const tc of ERC_400_CASES) {
		test(`ERC rejects 400 when ${tc.desc}`, async () => {
			const res = await postJson(port, "/api/checks/erc", tc.body);
			assert.equal(res.status, 400);
			assert.ok(typeof res.json.error === "string");
		});
	}

	test("DRC rejects 400 when pcb exceeds 20 MB", async () => {
		const large = `${VALID_PCB} ${" ".repeat(20 * 1024 * 1024)}`;
		const res = await postJson(port, "/api/checks/drc", { pcb: large });
		assert.equal(res.status, 400);
		assert.ok(res.json.error.includes("20 MB"));
	});

	test("ERC rejects 400 when sch exceeds 20 MB", async () => {
		const large = `${VALID_SCH} ${" ".repeat(20 * 1024 * 1024)}`;
		const res = await postJson(port, "/api/checks/erc", { sch: large });
		assert.equal(res.status, 400);
		assert.ok(res.json.error.includes("20 MB"));
	});
});

describe("check-routes failures and service availability", () => {
	test("returns 500 with stderr snippet when report is missing", async () => {
		const failingFake = makeFakeExec({
			fail: true,
			stderr: "syntax error in board file line 10",
		});
		const app = express();
		app.use(express.json());
		app.use(
			"/api",
			createCheckRouter({
				execFileImpl: failingFake.execFileImpl,
				cliPath: process.execPath,
			}),
		);
		const { server, port } = await startServer(app);
		try {
			const res = await postJson(port, "/api/checks/drc", { pcb: VALID_PCB });
			assert.equal(res.status, 500);
			assert.ok(res.json.error.includes("syntax error in board file"));
			assert.equal(fs.existsSync(failingFake.getTmpDir()), false);
		} finally {
			await stopServer(server);
		}
	});

	test("returns 200 on non-zero exit code if report is present", async () => {
		const nonZeroFake = makeFakeExec({
			reportToWrite: SAMPLE_DRC_REPORT,
			fail: true,
			stderr: "violations detected",
		});
		const app = express();
		app.use(express.json());
		app.use(
			"/api",
			createCheckRouter({
				execFileImpl: nonZeroFake.execFileImpl,
				cliPath: process.execPath,
			}),
		);
		const { server, port } = await startServer(app);
		try {
			const res = await postJson(port, "/api/checks/drc", { pcb: VALID_PCB });
			assert.equal(res.status, 200);
			assert.equal(res.json.violations.length, 3);
			assert.equal(fs.existsSync(nonZeroFake.getTmpDir()), false);
		} finally {
			await stopServer(server);
		}
	});

	test("returns 503 when CLI is missing or path does not exist", async () => {
		const app = express();
		app.use(express.json());
		app.use(
			"/api",
			createCheckRouter({
				cliPath: "/nonexistent/kicad-cli",
			}),
		);
		const { server, port } = await startServer(app);
		try {
			const res = await postJson(port, "/api/checks/drc", { pcb: VALID_PCB });
			assert.equal(res.status, 503);
			assert.ok(res.json.error.includes("KiCad CLI"));
		} finally {
			await stopServer(server);
		}
	});

	test("integrates with createApp at /api/checks/drc and /api/checks/erc", async () => {
		const app = createApp();
		const { server, port } = await startServer(app);
		try {
			const resDrc = await postJson(port, "/api/checks/drc", {});
			assert.equal(resDrc.status, 400);
			const resErc = await postJson(port, "/api/checks/erc", {});
			assert.equal(resErc.status, 400);
		} finally {
			await stopServer(server);
		}
	});
});
