import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	autoconfigPath,
	findBundledKicad,
	findKicadCli,
	loadAutoconfig,
	machineFingerprint,
	parsePort,
	parsePositiveInt,
	resolveTempRoot,
	sameMachine,
} from "../backend/src/runtime-detect.js";
import { int, rng, tmpDir } from "./helpers.js";

test("parsePort accepts exactly the valid TCP ports", async (t) => {
	const valid = ["0", "1", "80", "443", "5000", "65535", " 5000 "];
	for (const v of valid)
		await t.test(`valid ${JSON.stringify(v)}`, () =>
			assert.equal(parsePort(v, -1), Number(v.trim())),
		);
	const invalid = [
		"",
		"abc",
		"-1",
		"65536",
		"99999",
		"1.5",
		"5000x",
		"0x10",
		"1e3",
		"NaN",
		"Infinity",
		null,
		undefined,
		{},
		[],
		" ",
	];
	for (const v of invalid)
		await t.test(`invalid ${JSON.stringify(v)}`, () =>
			assert.equal(parsePort(v, -1), -1),
		);
});

test("parsePort fuzz: integers 0..65535 round trip, outside rejected", async (t) => {
	const r = rng(11);
	for (let i = 0; i < 300; i++) {
		const n = int(r, -70000, 140000);
		const expected = n >= 0 && n <= 65535 ? n : -1;
		await t.test(String(n), () =>
			assert.equal(parsePort(String(n), -1), expected),
		);
	}
});

test("parsePositiveInt", async (t) => {
	for (const [v, e] of [
		["1", 1],
		["120000", 120000],
		["0", 9],
		["-5", 9],
		["abc", 9],
		["", 9],
		[undefined, 9],
		[null, 9],
		["12abc", 12],
	])
		await t.test(JSON.stringify(v), () =>
			assert.equal(parsePositiveInt(v, 9), e),
		);
});

test("machine fingerprint and sameMachine", async (t) => {
	const m = machineFingerprint();
	await t.test("same", () => assert.equal(sameMachine(m, { ...m }), true));
	await t.test("different host", () =>
		assert.equal(sameMachine(m, { ...m, hostname: `${m.hostname}-x` }), false),
	);
	await t.test("different arch", () =>
		assert.equal(
			sameMachine(m, { ...m, arch: m.arch === "x64" ? "arm64" : "x64" }),
			false,
		),
	);
	await t.test("different platform", () =>
		assert.equal(sameMachine(m, { ...m, platform: "plan9" }), false),
	);
	for (const bad of [null, undefined, {}, "x", 5])
		await t.test(`rejects ${JSON.stringify(bad)}`, () =>
			assert.equal(sameMachine(m, bad), false),
		);
});

test("autoconfig is trusted only on the machine it was made on", async (t) => {
	const root = tmpDir();
	const file = path.join(root, ".banana", "autoconfig.json");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const env = {};
	await t.test("path", () => assert.equal(autoconfigPath(root, env), file));
	await t.test("env override", () =>
		assert.equal(
			autoconfigPath(root, { BANANA_AUTOCONFIG: "/x/y.json" }),
			"/x/y.json",
		),
	);
	await t.test("missing file -> null", () =>
		assert.equal(loadAutoconfig(root, env), null),
	);
	fs.writeFileSync(
		file,
		JSON.stringify({ machine: machineFingerprint(), port: 5123 }),
	);
	await t.test("same machine -> loaded", () =>
		assert.equal(loadAutoconfig(root, env).port, 5123),
	);
	fs.writeFileSync(
		file,
		JSON.stringify({
			machine: { ...machineFingerprint(), hostname: "other-pc" },
			port: 5123,
		}),
	);
	await t.test("moved USB stick -> ignored", () =>
		assert.equal(loadAutoconfig(root, env), null),
	);
	for (const garbage of [
		"",
		"{",
		"null",
		"[]",
		"42",
		'"x"',
		'{"machine":null}',
	]) {
		fs.writeFileSync(file, garbage);
		await t.test(`garbage ${JSON.stringify(garbage)} -> null`, () =>
			assert.equal(loadAutoconfig(root, env), null),
		);
	}
});

test("findBundledKicad prefers newest runtime/kicad* and respects platform exe name", async (t) => {
	const root = tmpDir();
	await t.test("none", () =>
		assert.equal(findBundledKicad(root, "linux"), null),
	);
	for (const [dir, exe] of [
		["kicad-8.0/bin", "kicad-cli"],
		["kicad-9.0/bin", "kicad-cli"],
	]) {
		fs.mkdirSync(path.join(root, "runtime", dir), { recursive: true });
		fs.writeFileSync(path.join(root, "runtime", dir, exe), "");
	}
	await t.test("newest wins", () =>
		assert.match(findBundledKicad(root, "linux"), /kicad-9\.0/),
	);
	await t.test("windows needs .exe", () =>
		assert.equal(findBundledKicad(root, "win32"), null),
	);
	fs.writeFileSync(
		path.join(root, "runtime", "kicad-9.0", "bin", "kicad-cli.exe"),
		"",
	);
	await t.test("windows exe found", () =>
		assert.match(findBundledKicad(root, "win32"), /kicad-cli\.exe$/),
	);
});

test("findKicadCli honours an explicit existing path first", async (t) => {
	const root = tmpDir();
	const fake = path.join(root, "my-kicad-cli");
	fs.writeFileSync(fake, "");
	await t.test("explicit", () =>
		assert.deepEqual(
			findKicadCli({ explicit: fake, appRoot: root }).source,
			"KICAD_CLI_PATH",
		),
	);
	await t.test("explicit missing is recorded in tried", () => {
		const res = findKicadCli({
			explicit: path.join(root, "nope"),
			appRoot: root,
			platform: "plan9",
		});
		assert.ok(res.tried.some((p) => p.endsWith("nope")));
	});
});

test("resolveTempRoot", async (t) => {
	await t.test("env override", () =>
		assert.equal(
			resolveTempRoot({ BANANA_TEMP_DIR: "/x/y" }),
			path.resolve("/x/y"),
		),
	);
	await t.test(
		"default lives in the OS temp dir (never on the USB stick)",
		() => assert.ok(resolveTempRoot({}).startsWith(os.tmpdir())),
	);
});
