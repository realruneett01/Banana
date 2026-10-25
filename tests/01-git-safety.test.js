import assert from "node:assert/strict";
import { test } from "node:test";
import {
	encodePathSegments,
	isSafeGithubName,
	isSafeRef,
	isSafeRelativePath,
} from "../backend/src/git-safety.js";
import { int, pick, rng } from "./helpers.js";

const GOOD_REFS = [
	"HEAD",
	"HEAD~1",
	"HEAD~12",
	"HEAD^",
	"HEAD^^",
	"main",
	"master",
	"feature/x",
	"origin/main",
	"v1.2.3",
	"release-2.0",
	"a5f23c1",
	"0123456789abcdef0123456789abcdef01234567",
	"HEAD@{1}",
	"@",
	"stash@{0}",
	"tags/v1",
	"user/feature_branch",
	"A",
	"9",
	"x.y",
	"a+b",
];
const BAD_REFS = [
	"",
	" ",
	"-",
	"--output=/tmp/x",
	"-n",
	"--exec=sh",
	"-h",
	"a..b",
	"..",
	"a b",
	"a\tb",
	"a\nb",
	"a;b",
	"a|b",
	"a&b",
	"a`b`",
	"$(id)",
	"a$b",
	"a>b",
	"a<b",
	"a:b",
	"a*b",
	"a?b",
	"a[b",
	"a\\b",
	"a\u0000b",
	"a'b",
	'a"b',
	"a!b",
	"feature/",
	"x.lock",
	"é",
	"ref with space",
	"a,b",
	"a#b",
	"--",
	"---x",
	"-C/tmp",
	"--git-dir=/x",
	"a=b",
	"%00",
	"~",
	"^",
	"{x}",
];

test("isSafeRef accepts legitimate refs", async (t) => {
	for (const ref of GOOD_REFS)
		await t.test(`accepts ${JSON.stringify(ref)}`, () =>
			assert.equal(isSafeRef(ref), true),
		);
});

test("isSafeRef rejects option-like, whitespace and shell-significant refs", async (t) => {
	for (const ref of BAD_REFS)
		await t.test(`rejects ${JSON.stringify(ref)}`, () =>
			assert.equal(isSafeRef(ref), false),
		);
});

test("isSafeRef rejects non-strings", async (t) => {
	for (const v of [
		null,
		undefined,
		0,
		1,
		{},
		[],
		["HEAD"],
		true,
		() => "HEAD",
	]) {
		await t.test(`rejects ${typeof v}`, () =>
			assert.equal(isSafeRef(v), false),
		);
	}
});

test("isSafeRef rejects every ref beginning with '-' (fuzz)", async (t) => {
	const r = rng(1);
	const alphabet = "abcXYZ019._/-=@";
	for (let i = 0; i < 200; i++) {
		const body = Array.from({ length: int(r, 0, 12) }, () =>
			pick(r, [...alphabet]),
		).join("");
		await t.test(`-${body}`, () => assert.equal(isSafeRef(`-${body}`), false));
	}
});

test("isSafeRef never accepts a ref containing '..' or control characters (fuzz)", async (t) => {
	const r = rng(2);
	for (let i = 0; i < 200; i++) {
		const a = String.fromCharCode(int(r, 97, 122));
		const sep = pick(r, ["..", "\u0001", "\n", "\r", " ", "\u007f".repeat(1)]);
		const ref = `${a}${sep}${a}`;
		await t.test(JSON.stringify(ref), () =>
			assert.equal(isSafeRef(ref), false),
		);
	}
});

test("isSafeRef length limit", () => {
	assert.equal(isSafeRef("a".repeat(255)), true);
	assert.equal(isSafeRef("a".repeat(256)), false);
});

const GOOD_PATHS = [
	"board.kicad_pcb",
	"a/b/c.kicad_sch",
	"hw\\rev2\\main.kicad_pcb",
	"dir with space/x.kicad_pcb",
	"a..b/c",
	"-leading-dash.kicad_pcb",
	"ünï/cødé.kicad_pcb",
	".hidden/x",
];
const BAD_PATHS = [
	"",
	"/etc/passwd",
	"\\windows\\system32",
	"C:\\x",
	"c:/x",
	"../x",
	"a/../b",
	"a\\..\\b",
	"..",
	"a/..",
	"a\u0000b",
	"a\nb",
	"a\u001fb",
	"x".repeat(5000),
];

test("isSafeRelativePath", async (t) => {
	for (const p of GOOD_PATHS)
		await t.test(`accepts ${JSON.stringify(p.slice(0, 30))}`, () =>
			assert.equal(isSafeRelativePath(p), true),
		);
	for (const p of BAD_PATHS)
		await t.test(`rejects ${JSON.stringify(p.slice(0, 30))}`, () =>
			assert.equal(isSafeRelativePath(p), false),
		);
	for (const v of [null, undefined, 5, {}, []])
		await t.test(`rejects ${typeof v}`, () =>
			assert.equal(isSafeRelativePath(v), false),
		);
});

test("isSafeRelativePath never accepts a '..' segment (fuzz)", async (t) => {
	const r = rng(3);
	for (let i = 0; i < 150; i++) {
		const segs = Array.from({ length: int(r, 1, 5) }, () =>
			pick(r, ["a", "bb", "c.d", "x y"]),
		);
		segs.splice(int(r, 0, segs.length), 0, "..");
		const p = segs.join(pick(r, ["/", "\\"]));
		await t.test(p, () => assert.equal(isSafeRelativePath(p), false));
	}
});

test("isSafeGithubName", async (t) => {
	for (const n of [
		"octocat",
		"my-repo",
		"my_repo",
		"a.b",
		"A1",
		"x",
		"banana2.0",
	])
		await t.test(`accepts ${n}`, () => assert.equal(isSafeGithubName(n), true));
	for (const n of [
		"",
		".",
		"..",
		"a/b",
		"a b",
		"a?x=1",
		"a#b",
		"a%2f",
		"../x",
		"x\n",
		"a@b",
		"a:b",
		"é",
		"x".repeat(101),
		null,
		undefined,
		3,
	])
		await t.test(`rejects ${JSON.stringify(n)}`, () =>
			assert.equal(isSafeGithubName(n), false),
		);
});

test("encodePathSegments keeps '/' and escapes URL-significant characters", async (t) => {
	const cases = [
		["a/b/c.kicad_pcb", "a/b/c.kicad_pcb"],
		["dir with space/x.kicad_pcb", "dir%20with%20space/x.kicad_pcb"],
		["a#b/c?d", "a%23b/c%3Fd"],
		["a\\b", "a/b"],
		["100%/x", "100%25/x"],
	];
	for (const [input, expected] of cases)
		await t.test(input, () =>
			assert.equal(encodePathSegments(input), expected),
		);
});
