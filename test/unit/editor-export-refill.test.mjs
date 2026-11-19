import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { createEditorRouter } from "../../backend/src/routes/editor-routes.js";

const MISSING_WARNING = "zones not filled; open in KiCad and press B to refill";

const ZONED = `(kicad_pcb (version 20241229) (generator test)
  (net 0 "") (net 1 "GND")
  (footprint "Lib:R" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND")))
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "s1"))
  (zone (net 1) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)
    (polygon (pts (xy 1 1) (xy 39 1) (xy 39 29) (xy 1 29)))))`;

function importBoard(text) {
	const res = kicadPcbToIr(text, { name: "zoned" });
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return { ir: res.ir, board: res.board };
}

async function startServer(options) {
	const app = express();
	app.use(express.json({ limit: "32mb" }));
	app.use(createEditorRouter(options));
	const server = http.createServer(app);
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return server;
}

async function postExport(server, body) {
	const url = `http://127.0.0.1:${server.address().port}/api/editor/export`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return { status: res.status, json: await res.json() };
}

const pcbText = (json) =>
	Object.entries(json.files).find(([name]) => name.endsWith(".kicad_pcb"))[1];

function createStubCli(refill) {
	const calls = [];
	const cli = {
		refillBoardText: async (text) => {
			calls.push(text);
			return refill(text);
		},
	};
	return { calls, loadKicadCli: async () => cli };
}

describe("editor export refills imported zones", () => {
	const servers = [];
	const serve = async (options) => {
		const server = await startServer(options);
		servers.push(server);
		return server;
	};
	after(() => Promise.all(servers.map((s) => new Promise((d) => s.close(d)))));

	test("writes the board's tracks and zones and returns the refilled text", async () => {
		const stub = createStubCli((text) => `${text}\n;refilled`);
		const server = await serve({ loadKicadCli: stub.loadKicadCli });
		const res = await postExport(server, importBoard(ZONED));
		assert.equal(res.status, 200);
		assert.equal(stub.calls.length, 1);
		assert.match(stub.calls[0], /\(zone\s/);
		assert.match(stub.calls[0], /\(segment\s/);
		assert.equal(pcbText(res.json), `${stub.calls[0]}\n;refilled`);
		assert.equal(
			res.json.warnings.some((w) => w.includes("zones")),
			false,
		);
	});

	test("falls back to the unfilled board with a warning when refill fails or times out", async () => {
		const timeout = Object.assign(new Error("Command failed"), {
			killed: true,
			signal: "SIGTERM",
		});
		const stub = createStubCli(() => Promise.reject(timeout));
		const server = await serve({ loadKicadCli: stub.loadKicadCli });
		const res = await postExport(server, importBoard(ZONED));
		assert.equal(res.status, 200);
		assert.equal(pcbText(res.json), stub.calls[0]);
		assert.ok(
			res.json.warnings.some(
				(w) => w.includes("refill failed") && w.includes(MISSING_WARNING),
			),
			JSON.stringify(res.json.warnings),
		);
	});

	test("warns that zones are not filled when kicad-cli is missing", async () => {
		const loadKicadCli = () => Promise.reject(new Error("kicad-cli not found"));
		const server = await serve({ loadKicadCli });
		const res = await postExport(server, importBoard(ZONED));
		assert.equal(res.status, 200);
		assert.match(pcbText(res.json), /\(zone\s/);
		assert.ok(res.json.warnings.includes(MISSING_WARNING));
	});

	test("skips kicad-cli when no zone needs a refill", async () => {
		let loads = 0;
		const loadKicadCli = async () => {
			loads += 1;
			return null;
		};
		const server = await serve({ loadKicadCli });
		const { ir, board } = importBoard(ZONED);
		const res = await postExport(server, {
			ir,
			board: { ...board, zones: [] },
		});
		assert.equal(res.status, 200);
		assert.equal(loads, 0);
		assert.equal(
			res.json.warnings.some((w) => w.includes("zones")),
			false,
		);
	});
});

// --- real kicad-cli ---------------------------------------------------------

const KICAD = "C:/Program Files/KiCad/10.0";
const CLI = `${KICAD}/bin/kicad-cli.exe`;
const ECC83 = `${KICAD}/share/kicad/demos/ecc83/ecc83-pp.kicad_pcb`;
const realSkip =
	fs.existsSync(CLI) && fs.existsSync(ECC83) ? false : "kicad-cli missing";

// Copper layers only, keyed by X2 file function: draws (D01) and size.
// `extra` lets the oracle refill before plotting (--check-zones).
function copperGerbers(text, extra = []) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refill-oracle-"));
	try {
		const pcb = path.join(dir, "board.kicad_pcb");
		fs.writeFileSync(pcb, text);
		const out = path.join(dir, "gerbers");
		const args = ["pcb", "export", "gerbers", ...extra, "-o", `${out}/`, pcb];
		execFileSync(CLI, args, { stdio: "pipe" });
		return readCopper(out);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function readCopper(dir) {
	const layers = {};
	for (const file of fs.readdirSync(dir)) {
		const body = fs.readFileSync(path.join(dir, file), "utf8");
		const fn = /%TF\.FileFunction,([^*]+)\*%/.exec(body)?.[1] ?? "";
		if (!fn.startsWith("Copper")) continue;
		const draws = body.match(/D01\*/g)?.length ?? 0;
		layers[fn] = { draws, bytes: body.length };
	}
	return layers;
}

describe("editor export with real kicad-cli: ecc83", { skip: realSkip }, () => {
	let server;
	let original;
	let exported;
	before(async () => {
		server = await startServer({});
		original = fs.readFileSync(ECC83, "utf8");
		const res = await postExport(server, importBoard(original));
		assert.equal(res.status, 200);
		exported = res.json;
	});
	after(() => new Promise((d) => server.close(d)));

	test("exported board has filled zones and no refill warning", () => {
		assert.match(pcbText(exported), /\(filled_polygon/);
		assert.equal(
			exported.warnings.some((w) => w.includes("zones")),
			false,
			JSON.stringify(exported.warnings),
		);
	});

	// The demo's stored fills predate KiCad 10's filler, so the original is
	// refilled while plotting (as the round-trip oracle does); the export is
	// plotted from its own stored fills, with no refill.
	test("copper gerbers match the original: draws equal, sizes within 1%", () => {
		const before = copperGerbers(original, ["--check-zones"]);
		const afterExport = copperGerbers(pcbText(exported));
		assert.ok(Object.keys(before).length > 0);
		const draws = (g) =>
			Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.draws]));
		assert.deepEqual(draws(afterExport), draws(before));
		for (const [layer, { bytes }] of Object.entries(before)) {
			const ratio = afterExport[layer].bytes / bytes;
			assert.ok(Math.abs(ratio - 1) <= 0.01, `${layer}: ${ratio}`);
		}
	});
});
