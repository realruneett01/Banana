import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { createBoardRouter } from "../../backend/src/routes/board-routes.js";

const VALID_PCB =
	"(kicad_pcb (version 20240108) (generator live_test) (paper A4))";

function setupTempGlb(tempDir) {
	const glbFile = path.join(tempDir, "mock.glb");
	fs.writeFileSync(glbFile, Buffer.from("glTF-binary-mock-data"));
	return glbFile;
}

function buildTestRig() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glb-live-test-"));
	const mockGlbPath = setupTempGlb(tempDir);
	const captured = [];

	const stubExportGlb = async (filePath) => {
		captured.push({
			filePath,
			content: fs.readFileSync(filePath, "utf8"),
		});
		return { glbPath: mockGlbPath, cached: false, durationMs: 15.4 };
	};

	const app = express();
	app.use(express.json({ limit: "32mb" }));
	app.use("/api/board", createBoardRouter({ exportBoardGlb: stubExportGlb }));

	return { tempDir, captured, app };
}

async function postJson(baseUrl, endpoint, payload) {
	const res = await fetch(`${baseUrl}${endpoint}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	return res;
}

describe("POST /api/board/glb live pcb support", () => {
	let rig;
	let server;
	let baseUrl;

	before(async () => {
		rig = buildTestRig();
		server = rig.app.listen(0);
		await new Promise((resolve) => server.once("listening", resolve));
		baseUrl = `http://127.0.0.1:${server.address().port}`;
	});

	after(async () => {
		if (server) {
			await new Promise((resolve) => server.close(resolve));
		}
		if (rig?.tempDir && fs.existsSync(rig.tempDir)) {
			fs.rmSync(rig.tempDir, { recursive: true, force: true });
		}
	});

	it("returns 200 and model/gltf-binary for valid pcb", async () => {
		const res = await postJson(baseUrl, "/api/board/glb", {
			pcb: VALID_PCB,
		});
		assert.strictEqual(res.status, 200);
		const contentType = res.headers.get("content-type") ?? "";
		assert.ok(contentType.includes("model/gltf-binary"));
		assert.strictEqual(res.headers.get("x-banana-glb-cached"), "0");
		assert.strictEqual(res.headers.get("x-banana-glb-ms"), "15");
		assert.strictEqual(rig.captured.length, 1);
		assert.strictEqual(rig.captured[0].content, VALID_PCB);
	});

	it("accepts valid pcb with leading whitespace and newlines", async () => {
		const res = await postJson(baseUrl, "/api/board/glb", {
			pcb: `\n\t  ${VALID_PCB}\n`,
		});
		assert.strictEqual(res.status, 200);
		const contentType = res.headers.get("content-type") ?? "";
		assert.ok(contentType.includes("model/gltf-binary"));
	});

	const BAD_PCB_CASES = [
		{ label: "non-kicad text", payload: { pcb: "not a kicad board" } },
		{
			label: "schematic s-expr",
			payload: { pcb: "(kicad_sch (version 20240108))" },
		},
		{ label: "number type", payload: { pcb: 42 } },
		{ label: "null type", payload: { pcb: null } },
		{ label: "boolean type", payload: { pcb: true } },
		{
			label: "oversized >20MB",
			payload: { pcb: `(kicad_pcb ${"x".repeat(20 * 1024 * 1024 + 1)})` },
		},
	];

	for (const { label, payload } of BAD_PCB_CASES) {
		it(`returns 400 for bad pcb: ${label}`, async () => {
			const res = await postJson(baseUrl, "/api/board/glb", payload);
			assert.strictEqual(res.status, 400);
			const data = await res.json();
			assert.strictEqual(data.error, "Invalid PCB content");
		});
	}

	const EMPTY_CASES = [
		{ label: "empty string pcb", payload: { pcb: "" } },
		{ label: "whitespace pcb", payload: { pcb: "   \n\t  " } },
		{ label: "empty body object", payload: {} },
	];

	for (const { label, payload } of EMPTY_CASES) {
		it(`returns 400 for empty request: ${label}`, async () => {
			const res = await postJson(baseUrl, "/api/board/glb", payload);
			assert.strictEqual(res.status, 400);
		});
	}

	it("routes git-style body without pcb to old path with local repo guard", async () => {
		const gitBody = {
			repoPath: "local/repo/hardware",
			commit: "0123456789abcdef0123456789abcdef01234567",
			relativeFilePath: "board.kicad_pcb",
		};
		const res = await postJson(baseUrl, "/api/board/glb", gitBody);
		assert.strictEqual(res.status, 403);
		const data = await res.json();
		assert.strictEqual(
			data.error,
			"Local repositories are disabled on this server",
		);
	});

	it("routes git-style body to validation when local repos permitted", async () => {
		rig.app.locals.allowLocalRepos = true;
		const gitBody = {
			repoPath: "hardware/repo",
			commit: "invalid!commit!ref",
			relativeFilePath: "board.kicad_pcb",
		};
		const res = await postJson(baseUrl, "/api/board/glb", gitBody);
		rig.app.locals.allowLocalRepos = false;
		assert.strictEqual(res.status, 400);
		const data = await res.json();
		assert.strictEqual(data.error, "Invalid commit ref");
	});

	it("keeps /pads endpoint unchanged, ignoring pcb field", async () => {
		const res = await postJson(baseUrl, "/api/board/pads", {
			pcb: VALID_PCB,
		});
		assert.strictEqual(res.status, 400);
		const data = await res.json();
		assert.strictEqual(
			data.error,
			"Missing required fields: commit, (relativeFilePath OR filePath)",
		);
	});

	it("returns error response when exportBoardGlb fails", async () => {
		const errorRig = buildTestRig();
		errorRig.app.locals.exportBoardGlb = async () => {
			throw new Error("kicad export failed");
		};
		const errServer = errorRig.app.listen(0);
		await new Promise((resolve) => errServer.once("listening", resolve));
		const errUrl = `http://127.0.0.1:${errServer.address().port}`;
		try {
			const res = await postJson(errUrl, "/api/board/glb", {
				pcb: VALID_PCB,
			});
			assert.strictEqual(res.status, 500);
			const data = await res.json();
			assert.strictEqual(data.error, "Unexpected error during 3D export");
		} finally {
			await new Promise((resolve) => errServer.close(resolve));
			if (errorRig?.tempDir && fs.existsSync(errorRig.tempDir)) {
				fs.rmSync(errorRig.tempDir, { recursive: true, force: true });
			}
		}
	});
});
