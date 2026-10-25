import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
	buildRenderCommands,
	pruneRenderCache,
	supportsModeMulti,
} from "../backend/src/kicad-renderer.js";
import { tmpDir } from "./helpers.js";

test("supportsModeMulti: --mode-multi exists from KiCad 8", async (t) => {
	const cases = [
		["7.0.11", false],
		["7.0.0", false],
		["6.0.2", false],
		["8.0.0", true],
		["8.0.9", true],
		["9.0.1", true],
		["10.0.0", true],
		["11.0.0-rc1", true],
		["(nightly)", true],
		["", true],
		[undefined, true],
		["7", false],
		[" 7.0.1 ", false],
	];
	for (const [v, e] of cases)
		await t.test(JSON.stringify(v), () =>
			assert.equal(supportsModeMulti(v), e),
		);
});

test("buildRenderCommands for KiCad 7 renders one file per layer with multi-mode names", () => {
	const cmds = buildRenderCommands({
		isPcb: true,
		filePath: "/r/My.Board.kicad_pcb",
		outputDir: "/o",
		kicadVersion: "7.0.11",
	});
	assert.equal(cmds.length, 7);
	const outputs = cmds.map((c) => c[c.indexOf("--output") + 1]);
	assert.ok(outputs.includes(path.join("/o", "My.Board-F_Cu.svg")));
	assert.ok(outputs.includes(path.join("/o", "My.Board-Edge_Cuts.svg")));
	for (const c of cmds) assert.ok(!c.includes("--mode-multi"));
});

test("buildRenderCommands for KiCad 8+ uses a single multi-mode call", () => {
	const cmds = buildRenderCommands({
		isPcb: true,
		filePath: "/r/b.kicad_pcb",
		outputDir: "/o",
		kicadVersion: "9.0.0",
	});
	assert.equal(cmds.length, 1);
	assert.ok(cmds[0].includes("--mode-multi"));
	assert.equal(cmds[0].at(-1), "/r/b.kicad_pcb");
});

test("schematics always use one call", async (t) => {
	for (const v of ["7.0.1", "8.0.1", "10.0.0"]) {
		await t.test(v, () => {
			const cmds = buildRenderCommands({
				isPcb: false,
				filePath: "/r/s.kicad_sch",
				outputDir: "/o",
				kicadVersion: v,
			});
			assert.deepEqual(cmds, [
				["sch", "export", "svg", "--output", "/o", "/r/s.kicad_sch"],
			]);
		});
	}
});

test("pruneRenderCache keeps the newest N entries (every N from 0..12)", async (t) => {
	for (let keep = 0; keep <= 12; keep++) {
		await t.test(`keep ${keep}`, () => {
			const root = tmpDir();
			for (let i = 0; i < 10; i++) {
				const d = path.join(root, `e${i}`);
				fs.mkdirSync(d);
				fs.writeFileSync(path.join(d, "x.svg"), "x");
				const when = new Date(Date.now() - (10 - i) * 60000);
				fs.utimesSync(d, when, when);
			}
			pruneRenderCache(root, keep);
			const left = fs.readdirSync(root).sort();
			assert.equal(left.length, Math.min(keep, 10));
			if (keep > 0 && keep < 10)
				assert.ok(left.includes("e9"), "newest survives");
			fs.rmSync(root, { recursive: true, force: true });
		});
	}
	await t.test("missing directory does not throw", () =>
		assert.doesNotThrow(() => pruneRenderCache("/definitely/not/here", 3)),
	);
});

import { runWithLimit } from "../backend/src/kicad-renderer.js";

test("runWithLimit never exceeds the concurrency limit and runs every item (limits 1..8)", async (t) => {
	for (let limit = 1; limit <= 8; limit++) {
		await t.test(`limit ${limit}`, async () => {
			let active = 0;
			let peak = 0;
			const done = [];
			await runWithLimit(
				Array.from({ length: 20 }, (_, i) => i),
				limit,
				async (i) => {
					active++;
					peak = Math.max(peak, active);
					await new Promise((r) => setTimeout(r, 2));
					done.push(i);
					active--;
				},
			);
			assert.equal(done.length, 20);
			assert.ok(peak <= limit, `peak ${peak} > limit ${limit}`);
		});
	}
	await t.test(
		"rejects with the first failure and stops scheduling",
		async () => {
			let started = 0;
			await assert.rejects(
				runWithLimit(
					Array.from({ length: 50 }, (_, i) => i),
					2,
					async (i) => {
						started++;
						if (i === 3) throw new Error("boom");
						await new Promise((r) => setTimeout(r, 1));
					},
				),
				/boom/,
			);
			assert.ok(started < 50);
		},
	);
	await t.test("empty list", async () =>
		assert.equal(await runWithLimit([], 4, async () => {}), undefined),
	);
});
