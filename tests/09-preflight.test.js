import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import {
	calibrateRenderTimeout,
	checkIntegrity,
	checkNode,
	checkWritable,
	isPortFree,
	pickPort,
	runPreflight,
	writeCalibration,
} from "../scripts/preflight.mjs";
import { hasKicad, tmpDir } from "./helpers.js";

test("checkNode enforces >= 20.11", async (t) => {
	for (const [v, ok] of [
		["20.11.0", true],
		["20.10.9", false],
		["20.19.0", true],
		["22.22.0", true],
		["24.0.0", true],
		["18.20.4", false],
		["16.0.0", false],
		["21.0.0", true],
		["19.9.0", false],
	])
		await t.test(v, () => assert.equal(checkNode(v).status === "pass", ok));
});

test("calibrateRenderTimeout is monotonic and bounded", async (t) => {
	let prev = 0;
	for (const ms of [0, 100, 500, 1000, 2000, 5000, 10000, 100000]) {
		await t.test(`${ms} ms`, () => {
			const v = calibrateRenderTimeout(ms);
			assert.ok(v >= 60000 && v <= 300000);
			assert.ok(v >= prev);
			prev = v;
		});
	}
});

test("isPortFree / pickPort skip occupied ports", async () => {
	const srv = net.createServer();
	await new Promise((r) => srv.listen(0, "127.0.0.1", r));
	const busy = srv.address().port;
	assert.equal(await isPortFree(busy), false);
	const picked = await pickPort(busy);
	assert.notEqual(picked, busy);
	assert.ok(picked > busy);
	srv.close();
	assert.equal(await pickPort(busy, async () => false), null);
});

test("checkIntegrity detects modified and missing files", async (t) => {
	const root = tmpDir();
	fs.writeFileSync(path.join(root, "a.txt"), "hello");
	fs.writeFileSync(path.join(root, "b.txt"), "world");
	const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
	const manifest = (o) =>
		fs.writeFileSync(
			path.join(root, "MANIFEST.sha256"),
			Object.entries(o)
				.map(([f, h]) => `${h} *${f}`)
				.join("\n"),
		);
	fs.rmSync(path.join(root, "MANIFEST.sha256"), { force: true });
	await t.test("no manifest -> pass", () =>
		assert.equal(checkIntegrity(root).status, "pass"),
	);
	manifest({ "a.txt": sha("hello"), "b.txt": sha("world") });
	await t.test("intact", () =>
		assert.equal(checkIntegrity(root).status, "pass"),
	);
	fs.writeFileSync(path.join(root, "a.txt"), "tampered");
	await t.test("modified", () => {
		const r = checkIntegrity(root);
		assert.equal(r.status, "fail");
		assert.deepEqual(r.bad, ["a.txt (modified)"]);
	});
	fs.rmSync(path.join(root, "b.txt"));
	await t.test("missing", () =>
		assert.deepEqual(checkIntegrity(root).bad.sort(), [
			"a.txt (modified)",
			"b.txt (missing)",
		]),
	);
});

test("checkWritable", async (t) => {
	await t.test("writable temp dir", async () =>
		assert.notEqual((await checkWritable(tmpDir())).status, "fail"),
	);
	await t.test("unwritable path fails", async () => {
		const file = path.join(tmpDir(), "a-file");
		fs.writeFileSync(file, "x");
		assert.equal((await checkWritable(path.join(file, "sub"))).status, "fail"); // a directory cannot be created inside a file
	});
});

test("writeCalibration reports failure instead of throwing", () => {
	const old = process.env.BANANA_AUTOCONFIG;
	const blocker = path.join(tmpDir(), "a-file");
	fs.writeFileSync(blocker, "x");
	process.env.BANANA_AUTOCONFIG = path.join(blocker, "sub", "autoconfig.json");
	const res = writeCalibration({ a: 1 });
	if (old === undefined) delete process.env.BANANA_AUTOCONFIG;
	else process.env.BANANA_AUTOCONFIG = old;
	assert.equal(res.ok, false);
	assert.ok(res.error);
});

test("full preflight (real KiCad) passes the ground-truth self-test and produces a calibration", {
	skip: hasKicad() ? false : "kicad-cli not installed",
	timeout: 120000,
}, async () => {
	const report = await runPreflight();
	const failed = report.results.filter((r) => r.status === "fail");
	assert.deepEqual(failed, []);
	assert.equal(report.ok, true);
	assert.ok(
		report.results.find((r) => r.id === "selftest" && r.status === "pass"),
	);
	assert.ok(report.calibration.renderTimeoutMs >= 60000);
	assert.ok(report.calibration.port > 0);
	assert.ok(report.calibration.kicadCliPath);
});
