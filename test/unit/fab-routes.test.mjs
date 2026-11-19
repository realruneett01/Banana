import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, sep } from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createFabRouter } from "../../backend/src/routes/fab-routes.js";

const VALID_BOARD_SEXPR =
	"(kicad_pcb (version 20240108) (generator fab_fixture))";

class FabTestRig {
	constructor(options = {}) {
		this.failingOperation = options.failKind ?? null;
		this.simulatedStderr = options.stderr ?? "mock kicad error";
		this.extraFiles = options.extraFiles ?? [];
		this.cliBinary = options.cliPath ?? process.execPath;
		this.customApp = options.customApp ?? null;
		this.capturedDirectory = null;
		this.recordedInvocations = [];
		this.httpInstance = null;
		this.baseUrl = "";
	}

	execStub(_bin, argv, _options, done) {
		this.recordedInvocations.push(argv);
		const targetOp = argv[2];
		this.capturedDirectory = dirname(argv.at(-1));
		this.materializeFiles(targetOp, argv);
		const shouldFail =
			this.failingOperation === targetOp || this.failingOperation === "all";
		if (shouldFail) {
			done(new Error("exec failed"), "", this.simulatedStderr);
			return;
		}
		done(null, "success", "");
	}

	materializeFiles(op, argv) {
		const outIndex = argv.indexOf("--output");
		if (outIndex !== -1) {
			const destination = argv[outIndex + 1];
			const isDir = destination.endsWith(sep) || destination.endsWith("/");
			const targetPath = isDir
				? join(destination, `${op}-out.dat`)
				: destination;
			writeFileSync(targetPath, `mock-${op}`);
		}
		for (const relativePath of this.extraFiles) {
			const filePath = join(this.capturedDirectory, relativePath);
			mkdirSync(dirname(filePath), { recursive: true });
			writeFileSync(filePath, "mock-extra");
		}
	}

	async listen() {
		const app = this.customApp ?? this.createDefaultApp();
		this.httpInstance = createServer(app);
		await new Promise((resolve) =>
			this.httpInstance.listen(0, "127.0.0.1", resolve),
		);
		const { port } = this.httpInstance.address();
		this.baseUrl = `http://127.0.0.1:${port}`;
		return this;
	}

	createDefaultApp() {
		const app = express();
		app.use(express.json({ limit: "32mb" }));
		app.use(
			"/api",
			createFabRouter({
				execFileImpl: (b, a, o, cb) => this.execStub(b, a, o, cb),
				cliPath: this.cliBinary,
			}),
		);
		return app;
	}

	async close() {
		if (!this.httpInstance) {
			return;
		}
		await new Promise((resolve) => this.httpInstance.close(resolve));
	}

	async postExport(payload, endpoint = "/api/fab/export") {
		const response = await fetch(`${this.baseUrl}${endpoint}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		const json = await response.json();
		return { status: response.status, json };
	}
}

async function withRig(options, fn) {
	const rig = new FabTestRig(options);
	await rig.listen();
	try {
		await fn(rig);
	} finally {
		await rig.close();
	}
}

async function runExportScenario(config, payload) {
	let reply;
	let capturedDir;
	await withRig(config, async (rig) => {
		reply = await rig.postExport(payload);
		capturedDir = rig.capturedDirectory;
	});
	return { reply, capturedDir };
}

function assertExportedFileNames(res, expectedNames) {
	assert.equal(res.status, 200);
	assert.equal(res.json.files.length, expectedNames.length);
	assert.deepEqual(
		res.json.files.map((f) => f.name),
		expectedNames,
	);
}

describe("fab-routes unit tests", () => {
	let sharedRig;

	before(async () => {
		sharedRig = new FabTestRig();
		await sharedRig.listen();
	});

	after(async () => {
		await sharedRig?.close();
	});

	test("exports all outputs by default with 200", async () => {
		const res = await sharedRig.postExport({ pcb: VALID_BOARD_SEXPR });
		assert.equal(res.status, 200);
		assert.equal(res.json.files.length, 5);
		assert.equal(res.json.log.length, 5);
		const producedNames = res.json.files.map((entry) => entry.name).sort();
		const expectedArtifacts = [
			"board-pos.csv",
			"board.pdf",
			"board.step",
			"drill/drill-out.dat",
			"gerbers/gerbers-out.dat",
		].sort();
		assert.deepEqual(producedNames, expectedArtifacts);
		const posItem = res.json.files.find((f) => f.name === "board-pos.csv");
		const decodedPos = Buffer.from(posItem.base64, "base64").toString("utf8");
		assert.equal(decodedPos, "mock-pos");
		assert.equal(existsSync(sharedRig.capturedDirectory), false);
	});

	test("exports only requested subset of outputs", async () => {
		const res = await sharedRig.postExport({
			pcb: VALID_BOARD_SEXPR,
			outputs: ["pos", "step"],
		});
		assertExportedFileNames(res, ["board-pos.csv", "board.step"]);
	});

	test("sanitizes base name and uses it for output files", async () => {
		const res = await sharedRig.postExport({
			pcb: VALID_BOARD_SEXPR,
			name: "my#custom@board",
			outputs: ["pos", "pdf"],
		});
		assertExportedFileNames(res, [
			"mycustomboard-pos.csv",
			"mycustomboard.pdf",
		]);
	});

	test("skips kicad side files and backups directory", async () => {
		const sideFiles = [
			"board.kicad_prl",
			"board.kicad_pro",
			"board.lck",
			"fp-info-cache",
			"backups/board-backup.kicad_pcb",
		];
		const { reply } = await runExportScenario(
			{ extraFiles: sideFiles },
			{ pcb: VALID_BOARD_SEXPR },
		);
		assert.equal(reply.status, 200);
		assert.equal(reply.json.files.length, 5);
		const names = reply.json.files.map((f) => f.name);
		const ignored = [
			"board.kicad_prl",
			"board.kicad_pro",
			"board.lck",
			"fp-info-cache",
		];
		const hasIgnored = names.some(
			(name) => ignored.includes(name) || name.startsWith("backups"),
		);
		assert.equal(hasIgnored, false);
	});

	const INVALID_PAYLOAD_SCENARIOS = [
		{ description: "missing pcb", body: {} },
		{ description: "pcb not a string", body: { pcb: 12345 } },
		{
			description: "invalid pcb header",
			body: { pcb: "(wrong_pcb (version 1))" },
		},
		{
			description: "unknown output",
			body: { pcb: VALID_BOARD_SEXPR, outputs: ["gerbers", "unknown"] },
		},
		{
			description: "outputs not array",
			body: { pcb: VALID_BOARD_SEXPR, outputs: "pos" },
		},
	];

	for (const { description, body } of INVALID_PAYLOAD_SCENARIOS) {
		test(`rejects 400 when ${description}`, async () => {
			const reply = await sharedRig.postExport(body);
			assert.equal(reply.status, 400);
			assert.equal(typeof reply.json.error, "string");
		});
	}

	test("rejects 400 when pcb exceeds 20 MB", async () => {
		const hugeContent = `${VALID_BOARD_SEXPR} ${" ".repeat(20 * 1024 * 1024)}`;
		const reply = await sharedRig.postExport({ pcb: hugeContent });
		assert.equal(reply.status, 400);
		assert.ok(reply.json.error.includes("20 MB"));
	});
});

describe("fab-routes failure and service status", () => {
	test("returns 500 with stderr snippet when kicad-cli fails", async () => {
		const failureStderr = "syntax error: invalid track geometry at line 42";
		const { reply, capturedDir } = await runExportScenario(
			{ failKind: "pos", stderr: failureStderr },
			{ pcb: VALID_BOARD_SEXPR, outputs: ["pos"] },
		);
		assert.equal(reply.status, 500);
		assert.ok(reply.json.error.includes("invalid track geometry"));
		assert.equal(existsSync(capturedDir), false);
	});

	test("returns 503 when KICAD_CLI_PATH is missing or not set", async () => {
		const { reply } = await runExportScenario(
			{ cliPath: "/nonexistent/path/to/kicad-cli" },
			{ pcb: VALID_BOARD_SEXPR },
		);
		assert.equal(reply.status, 503);
		assert.ok(reply.json.error.includes("KiCad CLI"));
	});

	test("integrates with createApp at /api/fab/export", async () => {
		const { reply } = await runExportScenario({ customApp: createApp() }, {});
		assert.equal(reply.status, 400);
	});
});
