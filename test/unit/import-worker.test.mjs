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
	const app = createApp(options);
	const server = http.createServer(app);
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return { server, port: server.address().port, app };
}

async function postImport(port, kind, body, signal) {
	const res = await fetch(
		`http://127.0.0.1:${port}/api/editor/import?kind=${kind}`,
		{ method: "POST", headers: { "content-type": "text/plain" }, body, signal },
	);
	const text = await res.text();
	return {
		status: res.status,
		retryAfter: res.headers.get("retry-after"),
		json: res.ok || text[0] === "{" ? JSON.parse(text) : {},
	};
}

async function waitForActive(app, count) {
	const deadline = Date.now() + 10000;
	while ((app.locals.importActive ?? 0) !== count) {
		assert.ok(Date.now() < deadline, `importActive never reached ${count}`);
		await new Promise((done) => setTimeout(done, 5));
	}
}

async function withServer(importLimits, run) {
	const ctx = await startServer(importLimits && { importLimits });
	try {
		await run(ctx);
	} finally {
		ctx.server.close();
	}
}

function assertStopped(out, reason) {
	assert.equal(out.ok, false);
	assert.equal(out.reason, reason);
	assert.equal(typeof out.exitCode, "number");
}

// The slot is free again and a fresh import is served.
async function assertSlotReleased({ app, port }) {
	await waitForActive(app, 0);
	assert.equal((await postImport(port, "pcb", SAMPLE_PCB)).status, 200);
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
			await withServer(undefined, async ({ port }) => {
				const res = await postImport(port, kind, text);
				assert.equal(res.status, 200);
				assert.deepEqual(
					withStableIds(res.json),
					inProcessResponse(kind, text),
				);
			});
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
		assertStopped(out, "timeout");
	});

	test("timeout over HTTP returns 422 JSON and releases the slot", async () => {
		await withServer(
			{ ...WEB_IMPORT_LIMITS, timeoutMs: 1 },
			async ({ port, app }) => {
				const res = await postImport(port, "pcb", BIG_PCB);
				assert.equal(res.status, 422);
				assert.match(res.json.error, /timed out/);
				assert.equal(app.locals.importActive, 0);
				assert.equal((await postImport(port, "pcb", BIG_PCB)).status, 422);
			},
		);
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

	test("web allows one import at a time: the second gets 503 with Retry-After", async () => {
		await withServer({ ...WEB_IMPORT_LIMITS, heapMb: 512 }, async (ctx) => {
			const first = postImport(ctx.port, "pcb", BIG_PCB);
			await waitForActive(ctx.app, 1);
			const busy = await postImport(ctx.port, "pcb", SAMPLE_PCB);
			assert.equal(busy.status, 503);
			assert.equal(busy.json.error, "import busy, retry shortly");
			assert.ok(Number(busy.retryAfter) > 0);
			assert.equal((await first).status, 200);
			await assertSlotReleased(ctx);
		});
	});

	test("desktop allows two concurrent imports and rejects a third", async () => {
		assert.equal(WEB_IMPORT_LIMITS.maxConcurrent, 1);
		assert.equal(DESKTOP_IMPORT_LIMITS.maxConcurrent, 2);
		await withServer(DESKTOP_IMPORT_LIMITS, async ({ port, app }) => {
			const runs = [BIG_PCB, BIG_PCB].map((pcb) =>
				postImport(port, "pcb", pcb),
			);
			await waitForActive(app, 2);
			assert.equal((await postImport(port, "pcb", SAMPLE_PCB)).status, 503);
			const statuses = (await Promise.all(runs)).map((res) => res.status);
			assert.deepEqual(statuses, [200, 200]);
			assert.equal(app.locals.importActive, 0);
		});
	});

	test("an aborted signal terminates the worker", async () => {
		const controller = new AbortController();
		const run = runImportInWorker("pcb", BIG_PCB, {
			heapMb: 512,
			timeoutMs: 30000,
			signal: controller.signal,
		});
		controller.abort();
		assertStopped(await run, "aborted");
	});

	test("a client abort terminates the worker and releases the slot", async () => {
		const limits = { ...WEB_IMPORT_LIMITS, heapMb: 512, timeoutMs: 30000 };
		await withServer(limits, async (ctx) => {
			const controller = new AbortController();
			const run = postImport(ctx.port, "pcb", BIG_PCB, controller.signal);
			await waitForActive(ctx.app, 1);
			controller.abort();
			await assert.rejects(run);
			await waitForActive(ctx.app, 0);
			assert.equal(ctx.app.locals.importAborted, 1);
			await assertSlotReleased(ctx);
		});
	});
});
