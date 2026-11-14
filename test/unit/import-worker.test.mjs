import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import {
	DESKTOP_IMPORT_LIMITS,
	IMPORT_TOO_LARGE_ERROR,
	runImportInWorker,
	WEB_IMPORT_LIMITS,
} from "../../backend/src/engine/import-worker.js";
import { embeddedLibSymbols } from "../../backend/src/engine/kicad-library.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { kicadSchToIr } from "../../backend/src/engine/kicad-sch-to-ir.js";

const SAMPLE_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(symbol (lib_id "Device:R") (at 30 40 90)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const SAMPLE_PCB = `(kicad_pcb
	(version 20240108)
	(generator "banana")
	(footprint "Resistor_SMD:R_0603"
		(layer "F.Cu")
		(at 10 20 45)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

// ~6 MB of segments: parses fine in-process, far beyond a 16 MB worker heap.
const BIG_PCB = `(kicad_pcb (version 20240108)\n${'(segment (start 0 0) (end 1 1) (width 0.2) (layer "F.Cu") (net 0))\n'.repeat(80000)})`;

function inProcessResponse(kind, text) {
	const result =
		kind === "sch"
			? { ...kicadSchToIr(text), symbols: embeddedLibSymbols(text) }
			: kicadPcbToIr(text);
	return withStableIds({
		ir: result.ir,
		board: result.board ?? null,
		warnings: result.warnings ?? [],
		symbols: result.symbols ?? {},
	});
}

// Converters mint random UUID ids per run; compare everything else exactly.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const withStableIds = (value) =>
	JSON.parse(JSON.stringify(value).replace(UUID, "<id>"));

async function startServer(options) {
	const server = http.createServer(createApp(options));
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return { server, port: server.address().port };
}

async function postImport(port, kind, body) {
	const res = await fetch(
		`http://127.0.0.1:${port}/api/editor/import?kind=${kind}`,
		{ method: "POST", headers: { "content-type": "text/plain" }, body },
	);
	const text = await res.text();
	return {
		status: res.status,
		json: res.ok || text[0] === "{" ? JSON.parse(text) : {},
	};
}

describe("import worker", () => {
	let tiny;
	before(async () => {
		tiny = await startServer({
			importLimits: { ...WEB_IMPORT_LIMITS, heapMb: 16 },
		});
	});
	after(() => tiny.server.close());

	for (const [kind, text] of [
		["sch", SAMPLE_SCH],
		["pcb", SAMPLE_PCB],
	]) {
		test(`${kind} import over HTTP deep-equals the in-process result`, async () => {
			const { server, port } = await startServer();
			try {
				const res = await postImport(port, kind, text);
				assert.equal(res.status, 200);
				assert.deepEqual(
					withStableIds(res.json),
					inProcessResponse(kind, text),
				);
			} finally {
				server.close();
			}
		});
	}

	test("a design over the worker heap returns 413 and the server keeps answering", async () => {
		const res = await postImport(tiny.port, "pcb", BIG_PCB);
		assert.equal(res.status, 413);
		assert.equal(res.json.error, IMPORT_TOO_LARGE_ERROR);
		const next = await postImport(tiny.port, "pcb", SAMPLE_PCB);
		assert.equal(next.status, 200);
	});

	test("timeout terminates the worker and reports a timeout", async () => {
		const out = await runImportInWorker("pcb", BIG_PCB, {
			heapMb: 512,
			timeoutMs: 1,
		});
		assert.equal(out.ok, false);
		assert.equal(out.reason, "timeout");
		assert.equal(typeof out.exitCode, "number");
	});

	test("timeout over HTTP returns 422 JSON", async () => {
		const { server, port } = await startServer({
			importLimits: { ...WEB_IMPORT_LIMITS, timeoutMs: 1 },
		});
		try {
			const res = await postImport(port, "pcb", BIG_PCB);
			assert.equal(res.status, 422);
			assert.match(res.json.error, /timed out/);
		} finally {
			server.close();
		}
	});

	test("desktop and web limits differ, desktop fits the largest demo", () => {
		assert.ok(DESKTOP_IMPORT_LIMITS.heapMb > WEB_IMPORT_LIMITS.heapMb);
		assert.notEqual(
			DESKTOP_IMPORT_LIMITS.bodyLimit,
			WEB_IMPORT_LIMITS.bodyLimit,
		);
		assert.equal(WEB_IMPORT_LIMITS.bodyLimit, "20mb");
		assert.ok(WEB_IMPORT_LIMITS.heapMb <= 256);
		// jetson demo: 84.6 MB body, ~1163 MB min heap measured.
		assert.ok(Number.parseInt(DESKTOP_IMPORT_LIMITS.bodyLimit, 10) >= 127);
		assert.ok(DESKTOP_IMPORT_LIMITS.heapMb >= 1163 * 1.5);
	});

	test("createApp picks desktop limits when apiSecret is set", () => {
		assert.equal(
			createApp({ apiSecret: "s" }).locals.importLimits,
			DESKTOP_IMPORT_LIMITS,
		);
		assert.equal(createApp().locals.importLimits, WEB_IMPORT_LIMITS);
	});

	test("web body limit rejects a body over 20mb with a JSON 413", async () => {
		const res = await postImport(
			tiny.port,
			"pcb",
			`(kicad_pcb ${" ".repeat(21 * 1024 * 1024)})`,
		);
		assert.equal(res.status, 413);
		assert.equal(res.json.error, IMPORT_TOO_LARGE_ERROR);
	});
});
