import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createFabRouter } from "../../backend/src/routes/fab-routes.js";

const VALID_PCB = "(kicad_pcb (version 20240108) (generator test))";

function makeFakeExec(options = {}) {
	const { failKind = null, stderr = "mock kicad error" } = options;
	let capturedTmpDir = null;
	const calls = [];

	const execFileImpl = (_file, args, _opts, cb) => {
		calls.push({ args });
		const kind = args[2];
		const pcbPath = args[args.length - 1];
		capturedTmpDir = path.dirname(pcbPath);
		const outArg = args[args.indexOf("--output") + 1];
		if (outArg) {
			if (outArg.endsWith(path.sep) || outArg.endsWith("/")) {
				fs.writeFileSync(path.join(outArg, `${kind}-out.dat`), `mock-${kind}`);
			} else {
				fs.writeFileSync(outArg, `mock-${kind}`);
			}
		}
		if (failKind === kind || failKind === "all") {
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

describe("fab-routes unit tests", () => {
	let server;
	let port;
	let fake;

	before(async () => {
		fake = makeFakeExec();
		const app = express();
		app.use(express.json({ limit: "32mb" }));
		app.use(
			"/api",
			createFabRouter({
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

	test("exports all outputs by default with 200", async () => {
		const res = await postJson(port, "/api/fab/export", { pcb: VALID_PCB });
		assert.equal(res.status, 200);
		assert.equal(res.json.files.length, 5);
		assert.equal(res.json.log.length, 5);
		const names = res.json.files.map((f) => f.name);
		assert.ok(names.includes("board-pos.csv"));
		assert.ok(names.includes("board.pdf"));
		assert.ok(names.includes("board.step"));
		assert.ok(names.includes("drill/drill-out.dat"));
		assert.ok(names.includes("gerbers/gerbers-out.dat"));

		const posEntry = res.json.files.find((f) => f.name === "board-pos.csv");
		assert.equal(
			Buffer.from(posEntry.base64, "base64").toString("utf8"),
			"mock-pos",
		);
		assert.equal(fs.existsSync(fake.getTmpDir()), false);
	});

	test("exports only requested subset of outputs", async () => {
		const res = await postJson(port, "/api/fab/export", {
			pcb: VALID_PCB,
			outputs: ["pos", "step"],
		});
		assert.equal(res.status, 200);
		assert.equal(res.json.files.length, 2);
		const names = res.json.files.map((f) => f.name);
		assert.deepEqual(names, ["board-pos.csv", "board.step"]);
	});

	test("sanitizes base name and uses it for output files", async () => {
		const res = await postJson(port, "/api/fab/export", {
			pcb: VALID_PCB,
			name: "my#custom@board",
			outputs: ["pos", "pdf"],
		});
		assert.equal(res.status, 200);
		const names = res.json.files.map((f) => f.name);
		assert.deepEqual(names, ["mycustomboard-pos.csv", "mycustomboard.pdf"]);
	});

	const BAD_REQUEST_CASES = [
		{ desc: "missing pcb", body: {} },
		{ desc: "pcb not a string", body: { pcb: 12345 } },
		{ desc: "invalid pcb header", body: { pcb: "(wrong_pcb (version 1))" } },
		{
			desc: "unknown output",
			body: { pcb: VALID_PCB, outputs: ["gerbers", "unknown"] },
		},
		{ desc: "outputs not array", body: { pcb: VALID_PCB, outputs: "pos" } },
	];

	for (const tc of BAD_REQUEST_CASES) {
		test(`rejects 400 when ${tc.desc}`, async () => {
			const res = await postJson(port, "/api/fab/export", tc.body);
			assert.equal(res.status, 400);
			assert.ok(typeof res.json.error === "string");
		});
	}

	test("rejects 400 when pcb exceeds 20 MB", async () => {
		const largePcb = `${VALID_PCB} ${" ".repeat(20 * 1024 * 1024)}`;
		const res = await postJson(port, "/api/fab/export", { pcb: largePcb });
		assert.equal(res.status, 400);
		assert.ok(res.json.error.includes("20 MB"));
	});
});

describe("fab-routes failure and service status", () => {
	test("returns 500 with stderr snippet when kicad-cli fails", async () => {
		const failingFake = makeFakeExec({
			failKind: "pos",
			stderr: "syntax error: invalid track geometry at line 42",
		});
		const app = express();
		app.use(express.json());
		app.use(
			"/api",
			createFabRouter({
				execFileImpl: failingFake.execFileImpl,
				cliPath: process.execPath,
			}),
		);
		const { server, port } = await startServer(app);
		try {
			const res = await postJson(port, "/api/fab/export", {
				pcb: VALID_PCB,
				outputs: ["pos"],
			});
			assert.equal(res.status, 500);
			assert.ok(res.json.error.includes("invalid track geometry"));
			assert.equal(fs.existsSync(failingFake.getTmpDir()), false);
		} finally {
			await stopServer(server);
		}
	});

	test("returns 503 when KICAD_CLI_PATH is missing or not set", async () => {
		const app = express();
		app.use(express.json());
		app.use(
			"/api",
			createFabRouter({
				cliPath: "/nonexistent/path/to/kicad-cli",
			}),
		);
		const { server, port } = await startServer(app);
		try {
			const res = await postJson(port, "/api/fab/export", { pcb: VALID_PCB });
			assert.equal(res.status, 503);
			assert.ok(res.json.error.includes("KiCad CLI"));
		} finally {
			await stopServer(server);
		}
	});

	test("integrates with createApp at /api/fab/export", async () => {
		const app = createApp();
		const { server, port } = await startServer(app);
		try {
			const res = await postJson(port, "/api/fab/export", {});
			assert.equal(res.status, 400);
		} finally {
			await stopServer(server);
		}
	});
});
