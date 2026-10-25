// End-to-end tests against a real kicad-cli. Skipped automatically when KiCad is not installed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../backend/src/server.js";
import { sampleBoard, sampleSchematic } from "../samples/gen-sample.mjs";
import { commit, git, hasKicad, makeRepo } from "./helpers.js";

const skip = hasKicad() ? false : "kicad-cli not installed";
let server;
let base;
let repo;
const commits = {};

before(async () => {
	if (skip) return;
	await new Promise((resolve) => {
		server = createApp().listen(0, "127.0.0.1", resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
	repo = makeRepo(
		{ "board.kicad_pcb": sampleBoard(), "sheet.kicad_sch": sampleSchematic() },
		"base",
	);
	commits.base = git(repo, "rev-parse", "HEAD").trim();
});
after(() => {
	server?.close();
	if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

const diff = async (body) => {
	const r = await fetch(`${base}/api/diff/process`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ repoPath: repo, ...body }),
	});
	return { status: r.status, body: await r.json() };
};

test("a relocated footprint is reported with its true displacement", {
	skip,
}, async (t) => {
	for (const dx of [0.5, 1, 2, 3.25, 5, 8]) {
		await t.test(`R1 moved ${dx} mm`, async () => {
			const moved = commit(
				repo,
				{
					"board.kicad_pcb": sampleBoard({
						r1x: 110 + dx,
						trackEndX: 120 + dx,
					}),
				},
				`move ${dx}`,
			);
			const res = await diff({
				baseCommit: commits.base,
				targetCommit: moved,
				relativeFilePath: "board.kicad_pcb",
			});
			assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
			const r1 = res.body.modifications.find(
				(m) => m.refDes === "R1" && m.type === "COMPONENT",
			);
			assert.ok(r1, "R1 change found");
			assert.ok(
				Math.abs(r1.displacement - dx) < 0.05,
				`displacement ${r1.displacement} vs ${dx}`,
			);
			assert.equal(res.body.pcbMetadata.footprintCount, 2);
			assert.equal(res.body.telemetry.layersProcessed, 7);
		});
	}
});

test("identical commits produce no modifications", { skip }, async () => {
	const res = await diff({
		baseCommit: "HEAD",
		targetCommit: "HEAD",
		relativeFilePath: "board.kicad_pcb",
	});
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.modifications, []);
});

test("HEAD is resolved at request time, not cached across commits", {
	skip,
}, async () => {
	const before = await diff({
		baseCommit: commits.base,
		targetCommit: "HEAD",
		relativeFilePath: "board.kicad_pcb",
	});
	commit(
		repo,
		{ "board.kicad_pcb": sampleBoard({ r1x: 150, trackEndX: 160 }) },
		"move far",
	);
	const after = await diff({
		baseCommit: commits.base,
		targetCommit: "HEAD",
		relativeFilePath: "board.kicad_pcb",
	});
	const d1 = before.body.modifications.find(
		(m) => m.refDes === "R1",
	)?.displacement;
	const d2 = after.body.modifications.find(
		(m) => m.refDes === "R1",
	)?.displacement;
	assert.notEqual(d1, d2);
	assert.ok(Math.abs(d2 - 40) < 0.1);
});

test("schematic value change is detected", { skip }, async () => {
	const changed = commit(
		repo,
		{ "sheet.kicad_sch": sampleSchematic({ value: "22k" }) },
		"sch",
	);
	const res = await diff({
		baseCommit: commits.base,
		targetCommit: changed,
		relativeFilePath: "sheet.kicad_sch",
	});
	assert.equal(res.status, 200);
	assert.ok(res.body.modifications.length > 0);
});

test("25 concurrent identical diffs all succeed (no shared-scratch races)", {
	skip,
}, async () => {
	const moved = commit(
		repo,
		{ "board.kicad_pcb": sampleBoard({ r1x: 113, trackEndX: 123 }) },
		"conc",
	);
	const results = await Promise.all(
		Array.from({ length: 25 }, () =>
			diff({
				baseCommit: commits.base,
				targetCommit: moved,
				relativeFilePath: "board.kicad_pcb",
			}),
		),
	);
	for (const res of results) {
		assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
		assert.ok(
			Math.abs(
				res.body.modifications.find((m) => m.refDes === "R1").displacement - 3,
			) < 0.05,
		);
	}
});

test("render cache survives requests (REGRESSION: pipeline used to delete it)", {
	skip,
}, async () => {
	const { config } = await import("../backend/src/config.js");
	const cacheRoot = path.join(config.tempRoot, "cache", "renders");
	const moved = commit(
		repo,
		{ "board.kicad_pcb": sampleBoard({ r1x: 117, trackEndX: 127 }) },
		"cache",
	);
	await diff({
		baseCommit: commits.base,
		targetCommit: moved,
		relativeFilePath: "board.kicad_pcb",
	});
	const entries = fs.readdirSync(cacheRoot);
	assert.ok(entries.length >= 2, `cache entries: ${entries.length}`);
	const t0 = performance.now();
	const res = await diff({
		baseCommit: commits.base,
		targetCommit: moved,
		relativeFilePath: "board.kicad_pcb",
	});
	assert.equal(res.status, 200);
	assert.ok(
		res.body.telemetry.tCli < 50,
		`second request rendered from cache (tCli=${res.body.telemetry.tCli} ms, total ${(performance.now() - t0).toFixed(0)} ms)`,
	);
});

test("corrupt / non-KiCad files fail cleanly with a JSON error", {
	skip,
}, async () => {
	const bad = commit(
		repo,
		{ "broken.kicad_pcb": "this is not a board" },
		"bad",
	);
	const res = await diff({
		baseCommit: bad,
		targetCommit: bad,
		relativeFilePath: "broken.kicad_pcb",
	});
	assert.ok(res.status >= 400 && res.status < 600);
	assert.ok(res.body.error);
});

test("missing file at a commit fails cleanly", { skip }, async () => {
	const res = await diff({
		baseCommit: commits.base,
		targetCommit: "HEAD",
		relativeFilePath: "nope.kicad_pcb",
	});
	assert.equal(res.status, 500);
	assert.match(res.body.error, /extract/i);
});
