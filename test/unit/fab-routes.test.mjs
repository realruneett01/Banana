import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createFabRouter } from "../../backend/src/routes/fab-routes.js";

const VALID_PCB = "(kicad_pcb (version 20240108) (generator test))";

function writeMockSideFiles(targetDir, fileList) {
	if (!fileList || fileList.length === 0) {
		return;
	}
	const [head, ...tail] = fileList;
	const fullPath = path.join(targetDir, head);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, "mock-extra");
	writeMockSideFiles(targetDir, tail);
}

class MockKicadCli {
	constructor(options = {}) {
		this.failKind = options.failKind ?? null;
		this.stderr = options.stderr ?? "mock kicad error";
		this.extraFiles = options.extraFiles ?? [];
		this.capturedTmpDir = null;
		this.calls = [];
	}

	getTmpDir() {
		return this.capturedTmpDir;
	}

	exec(_file, args, _opts, callback) {
		this.calls.push({ args });
		const kind = args[2];
		const pcbPath = args[args.length - 1];
		this.capturedTmpDir = path.dirname(pcbPath);
		this.writeOutputArtifact(kind, args);
		if (this.failKind === kind || this.failKind === "all") {
			return callback(new Error("exec failed"), "", this.stderr);
		}
		return callback(null, "success", "");
	}

	writeOutputArtifact(kind, args) {
		const outIdx = args.indexOf("--output");
		if (outIdx !== -1) {
			const outTarget = args[outIdx + 1];
			const isDir = outTarget.endsWith(path.sep) || outTarget.endsWith("/");
			const targetFile = isDir
				? path.join(outTarget, `${kind}-out.dat`)
				: outTarget;
			fs.writeFileSync(targetFile, `mock-${kind}`);
		}
		writeMockSideFiles(this.capturedTmpDir, this.extraFiles);
	}
}

function launchHttpServer(app) {
	return new Promise((resolve) => {
		const s = http.createServer(app);
		s.listen(0, "127.0.0.1", () => {
			resolve({ server: s, port: s.address().port });
		});
	});
}

function terminateHttpServer(server) {
	return new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}
		server.close(resolve);
	});
}

async function withEphemeralServer(config, testBlock) {
	const app = config.customApp ?? express();
	if (!config.customApp) {
		app.use(express.json({ limit: "32mb" }));
		app.use(
			"/api",
			createFabRouter({
				execFileImpl: config.execFileImpl,
				cliPath: config.cliPath ?? process.execPath,
			}),
		);
	}
	const { server, port } = await launchHttpServer(app);
	try {
		await testBlock(port);
	} finally {
		await terminateHttpServer(server);
	}
}

async function initFabServer(cliMock) {
	const app = express();
	app.use(express.json({ limit: "32mb" }));
	app.use(
		"/api",
		createFabRouter({
			execFileImpl: (f, a, o, cb) => cliMock.exec(f, a, o, cb),
			cliPath: process.execPath,
		}),
	);
	return launchHttpServer(app);
}

async function requestExport(port, payload, urlPath = "/api/fab/export") {
	const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	const rawText = await res.text();
	let parsedJson = {};
	try {
		parsedJson = JSON.parse(rawText);
	} catch (err) {
		parsedJson = { unparsed: rawText, parseError: err.message };
	}
	return { status: res.status, json: parsedJson, text: rawText };
}

function assertErrorResponse(res, expectedStatus, expectedSnippet) {
	assert.equal(res.status, expectedStatus);
	if (expectedSnippet) {
		assert.ok(res.json.error.includes(expectedSnippet));
	} else {
		assert.equal(typeof res.json.error, "string");
	}
}

function assertFileCount(res, count) {
	assert.equal(res.status, 200);
	assert.equal(res.json.files.length, count);
}

function assertExportFiles(res, expectedNames) {
	assertFileCount(res, expectedNames.length);
	const names = res.json.files.map((f) => f.name);
	assert.deepEqual(names, expectedNames);
}

function assertExcludesSideFiles(names) {
	const ignoredFiles = [
		"board.kicad_prl",
		"board.kicad_pro",
		"board.lck",
		"fp-info-cache",
	];
	const foundIgnored = names.some(
		(name) => ignoredFiles.includes(name) || name.startsWith("backups"),
	);
	assert.equal(foundIgnored, false);
}

function assertTmpDirCleaned(mockCli) {
	assert.equal(fs.existsSync(mockCli.getTmpDir()), false);
}

function assertDefaultExportSuccess(res, mockCli) {
	assertFileCount(res, 5);
	assert.equal(res.json.log.length, 5);
	const names = res.json.files.map((f) => f.name);
	const expected = [
		"board-pos.csv",
		"board.pdf",
		"board.step",
		"drill/drill-out.dat",
		"gerbers/gerbers-out.dat",
	];
	assert.deepEqual(names.sort(), expected.sort());
	const posEntry = res.json.files.find((f) => f.name === "board-pos.csv");
	const posContent = Buffer.from(posEntry.base64, "base64").toString("utf8");
	assert.equal(posContent, "mock-pos");
	assertTmpDirCleaned(mockCli);
}

describe("fab-routes unit tests", () => {
	let server;
	let port;
	let mockCli;

	before(async () => {
		mockCli = new MockKicadCli();
		const running = await initFabServer(mockCli);
		server = running.server;
		port = running.port;
	});

	after(async () => {
		await terminateHttpServer(server);
	});

	test("exports all outputs by default with 200", async () => {
		const res = await requestExport(port, { pcb: VALID_PCB });
		assertDefaultExportSuccess(res, mockCli);
	});

	test("exports only requested subset of outputs", async () => {
		const res = await requestExport(port, {
			pcb: VALID_PCB,
			outputs: ["pos", "step"],
		});
		assertExportFiles(res, ["board-pos.csv", "board.step"]);
	});

	test("sanitizes base name and uses it for output files", async () => {
		const res = await requestExport(port, {
			pcb: VALID_PCB,
			name: "my#custom@board",
			outputs: ["pos", "pdf"],
		});
		assertExportFiles(res, ["mycustomboard-pos.csv", "mycustomboard.pdf"]);
	});

	test("skips kicad side files and backups directory", async () => {
		const sideFake = new MockKicadCli({
			extraFiles: [
				"board.kicad_prl",
				"board.kicad_pro",
				"board.lck",
				"fp-info-cache",
				"backups/board-backup.kicad_pcb",
			],
		});
		await withEphemeralServer(
			{ execFileImpl: (f, a, o, cb) => sideFake.exec(f, a, o, cb) },
			async (testPort) => {
				const res = await requestExport(testPort, { pcb: VALID_PCB });
				assertFileCount(res, 5);
				const names = res.json.files.map((f) => f.name);
				assertExcludesSideFiles(names);
			},
		);
	});

	const BAD_REQUEST_CASES = [
		{ desc: "missing pcb", payload: {} },
		{ desc: "pcb not a string", payload: { pcb: 12345 } },
		{ desc: "invalid pcb header", payload: { pcb: "(wrong_pcb (version 1))" } },
		{
			desc: "unknown output",
			payload: { pcb: VALID_PCB, outputs: ["gerbers", "unknown"] },
		},
		{ desc: "outputs not array", payload: { pcb: VALID_PCB, outputs: "pos" } },
	];

	for (const tc of BAD_REQUEST_CASES) {
		test(`rejects 400 when ${tc.desc}`, async () => {
			const res = await requestExport(port, tc.payload);
			assertErrorResponse(res, 400);
		});
	}

	test("rejects 400 when pcb exceeds 20 MB", async () => {
		const oversizedPcb = `${VALID_PCB} ${" ".repeat(20 * 1024 * 1024)}`;
		const res = await requestExport(port, { pcb: oversizedPcb });
		assertErrorResponse(res, 400, "20 MB");
	});
});

describe("fab-routes failure and service status", () => {
	test("returns 500 with stderr snippet when kicad-cli fails", async () => {
		const failingFake = new MockKicadCli({
			failKind: "pos",
			stderr: "syntax error: invalid track geometry at line 42",
		});
		await withEphemeralServer(
			{ execFileImpl: (f, a, o, cb) => failingFake.exec(f, a, o, cb) },
			async (testPort) => {
				const res = await requestExport(testPort, {
					pcb: VALID_PCB,
					outputs: ["pos"],
				});
				assertErrorResponse(res, 500, "invalid track geometry");
				assertTmpDirCleaned(failingFake);
			},
		);
	});

	test("returns 503 when KICAD_CLI_PATH is missing or not set", async () => {
		await withEphemeralServer(
			{ cliPath: "/nonexistent/path/to/kicad-cli" },
			async (testPort) => {
				const res = await requestExport(testPort, { pcb: VALID_PCB });
				assertErrorResponse(res, 503, "KiCad CLI");
			},
		);
	});

	test("integrates with createApp at /api/fab/export", async () => {
		await withEphemeralServer({ customApp: createApp() }, async (testPort) => {
			const res = await requestExport(testPort, {});
			assert.equal(res.status, 400);
		});
	});
});
