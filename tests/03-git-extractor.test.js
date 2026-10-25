import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { config } from "../backend/src/config.js";
import { extractFileFromCommit } from "../backend/src/git-extractor.js";
import { commit, makeRepo } from "./helpers.js";

const created = [];
after(() => {
	for (const d of created) fs.rmSync(d, { recursive: true, force: true });
	fs.rmSync(path.join(config.tempRoot, "xtest"), {
		recursive: true,
		force: true,
	});
});

function repo(files) {
	const d = makeRepo(files);
	created.push(d);
	return d;
}
const out = (name) => path.join("xtest", name);

test("extracts file content at a commit", async () => {
	const d = repo({ "a.kicad_pcb": "one" });
	const p = await extractFileFromCommit(
		d,
		"HEAD",
		"a.kicad_pcb",
		out("t1/a.kicad_pcb"),
	);
	assert.equal(fs.readFileSync(p, "utf8"), "one");
});

test("REGRESSION: a moved ref (HEAD) is not served from a stale cached file", async () => {
	const d = repo({ "a.kicad_pcb": "one" });
	const target = out("t2/a.kicad_pcb");
	await extractFileFromCommit(d, "HEAD", "a.kicad_pcb", target);
	commit(d, { "a.kicad_pcb": "two" }, "c2");
	const p = await extractFileFromCommit(d, "HEAD", "a.kicad_pcb", target);
	assert.equal(fs.readFileSync(p, "utf8"), "two");
});

test("file is completely flushed when the promise resolves (5 MB)", async () => {
	const big = `(kicad_pcb\n${"x".repeat(79)}${"\n".repeat(1)}${")\n".repeat(1)}`;
	const content = big.repeat(60000);
	const d = repo({ "big.kicad_pcb": content });
	for (let i = 0; i < 5; i++) {
		const p = await extractFileFromCommit(
			d,
			"HEAD",
			"big.kicad_pcb",
			out(`t3/${i}/big.kicad_pcb`),
		);
		assert.equal(fs.statSync(p).size, Buffer.byteLength(content));
	}
});

test("20 parallel extractions to distinct targets all succeed with identical bytes", async () => {
	const d = repo({ "a.kicad_pcb": "same-content" });
	const results = await Promise.all(
		Array.from({ length: 20 }, (_, i) =>
			extractFileFromCommit(
				d,
				"HEAD",
				"a.kicad_pcb",
				out(`t4/${i}/a.kicad_pcb`),
			),
		),
	);
	for (const p of results)
		assert.equal(fs.readFileSync(p, "utf8"), "same-content");
});

test("REGRESSION: option-injection refs are rejected before git runs", async (t) => {
	const d = repo({ "a.kicad_pcb": "x" });
	const victim = path.join(config.tempRoot, "xtest", "pwned.txt");
	for (const ref of [
		`--output=${victim}`,
		"-p",
		"--help",
		"--exec=touch /tmp/x",
	]) {
		await t.test(ref, async () => {
			await assert.rejects(
				extractFileFromCommit(d, ref, "a.kicad_pcb", out("t5/a")),
				/Invalid git commit/,
			);
			assert.equal(fs.existsSync(victim), false);
		});
	}
});

test("rejects traversal in the repo path and in the output name", async (t) => {
	const d = repo({ "a.kicad_pcb": "x" });
	await t.test("repo path ..", () =>
		assert.rejects(
			extractFileFromCommit(d, "HEAD", "../a.kicad_pcb", out("t6/a")),
			/Invalid file path/,
		),
	);
	await t.test("absolute", () =>
		assert.rejects(
			extractFileFromCommit(d, "HEAD", "/etc/passwd", out("t6/a")),
			/Invalid file path/,
		),
	);
	await t.test("output escapes tempRoot", () =>
		assert.rejects(
			extractFileFromCommit(d, "HEAD", "a.kicad_pcb", "../../escape"),
			/outside/,
		),
	);
});

test("missing file / bad commit / non-repo produce a clear error and leave no partial file", async (t) => {
	const d = repo({ "a.kicad_pcb": "x" });
	const cases = [
		["missing file", d, "HEAD", "nope.kicad_pcb"],
		["unknown commit", d, "deadbeef", "a.kicad_pcb"],
		[
			"not a repo",
			path.join(config.tempRoot, "does-not-exist"),
			"HEAD",
			"a.kicad_pcb",
		],
	];
	for (const [name, dir, ref, file] of cases) {
		await t.test(name, async () => {
			const target = out(`t7/${name.replace(/ /g, "_")}/a`);
			await assert.rejects(extractFileFromCommit(dir, ref, file, target));
			assert.equal(fs.existsSync(path.join(config.tempRoot, target)), false);
		});
	}
});

test("path separators: backslash paths are normalised for git", async () => {
	const d = repo({ "hw/rev2/main.kicad_pcb": "nested" });
	const p = await extractFileFromCommit(
		d,
		"HEAD",
		"hw\\rev2\\main.kicad_pcb",
		out("t8/main.kicad_pcb"),
	);
	assert.equal(fs.readFileSync(p, "utf8"), "nested");
});
