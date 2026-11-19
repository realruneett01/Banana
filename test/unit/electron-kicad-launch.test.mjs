import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const {
	findKicadGui,
	validateOpenRequest,
	launchKicad,
} = require("../../electron/kicad-launch.cjs");

const PROJECT_ROOT = path.resolve("test_project");
const DEFAULT_DEPS = {
	realpath: (p) => path.normalize(p),
	exists: () => true,
};
const DEFAULT_GUI = { kicad: "/bin/kicad", pcbnew: "/bin/pcbnew" };

const makeReq = (kind = "pcb", fileName = "board.kicad_pcb") => ({
	kind,
	filePath: path.join(PROJECT_ROOT, fileName),
	projectRoot: PROJECT_ROOT,
});

function createSpawnCapture() {
	const state = { call: null, unrefCalled: false };
	const spawn = (bin, args, options) => {
		state.call = { bin, args, options };
		return {
			unref: () => {
				state.unrefCalled = true;
			},
		};
	};
	return { state, spawn };
}

const WIN_GUI_CASES = [
	{
		name: "finds Windows 9.0 when 9.0 exists and 10.0 does not",
		env: {},
		exists: (candidate) => candidate.includes("9.0"),
		matches: [
			["kicad", /9\.0.*kicad\.exe/i],
			["eeschema", /9\.0.*eeschema\.exe/i],
			["pcbnew", /9\.0.*pcbnew\.exe/i],
		],
	},
	{
		name: "prefers KICAD_CLI_PATH directory over standard versions",
		env: { KICAD_CLI_PATH: "C:\\custom\\bin\\kicad-cli.exe" },
		exists: (candidate) =>
			candidate.includes("custom") || candidate.includes("10.0"),
		matches: [["kicad", /custom.*kicad\.exe/i]],
	},
];

const UNIX_GUI_CASES = [
	{
		platform: "linux",
		existsPrefix: "/usr/bin",
		expected: {
			kicad: "/usr/bin/kicad",
			eeschema: "/usr/bin/eeschema",
			pcbnew: "/usr/bin/pcbnew",
		},
	},
	{
		platform: "darwin",
		existsPrefix: "/Applications",
		expected: {
			kicad: "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad",
			eeschema: "/Applications/KiCad/Eeschema.app/Contents/MacOS/eeschema",
			pcbnew: "/Applications/KiCad/Pcbnew.app/Contents/MacOS/pcbnew",
		},
	},
];

const VALIDATE_CASES = [
	{
		name: "rejects invalid kind",
		req: makeReq("unknown", "b.kicad_pcb"),
		expectedError: "Invalid kind",
	},
	{
		name: "rejects wrong extension",
		req: makeReq("pcb", "b.txt"),
		expectedError: "Invalid file extension",
	},
	{
		name: "rejects relative path",
		req: {
			kind: "pcb",
			filePath: "b.kicad_pcb",
			projectRoot: PROJECT_ROOT,
		},
		expectedError: "Invalid path",
	},
	{
		name: "rejects path outside root via ..",
		req: makeReq("pcb", path.join("..", "outside", "b.kicad_pcb")),
		expectedError: "Path outside project root",
	},
	{
		name: "rejects symlink escaping root via fake realpath",
		req: makeReq("pcb", "link.kicad_pcb"),
		fakeRealpath: (p) =>
			p.includes("link")
				? path.resolve("outside", "escaped.kicad_pcb")
				: path.normalize(p),
		expectedError: "Path outside project root",
	},
	{
		name: "rejects NUL byte in path",
		req: {
			kind: "pcb",
			filePath: `${path.join(PROJECT_ROOT, "b")}\0.kicad_pcb`,
			projectRoot: PROJECT_ROOT,
		},
		expectedError: "Invalid path",
	},
	{
		name: "rejects missing file",
		req: makeReq("pcb", "b.kicad_pcb"),
		fakeExists: () => false,
		expectedError: "File not found",
	},
	{
		name: "accepts valid pcb file",
		req: makeReq("pcb", "board.kicad_pcb"),
		expectedOk: true,
	},
	{
		name: "accepts valid case-insensitive extension",
		req: makeReq("schematic", "main.KICAD_SCH"),
		expectedOk: true,
	},
];

const EXT_BY_KIND = {
	project: "kicad_pro",
	schematic: "kicad_sch",
	pcb: "kicad_pcb",
};

const PICK_CASES = [
	{
		name: "picks pcbnew for pcb when present",
		kind: "pcb",
		gui: { kicad: "/bin/kicad", pcbnew: "/bin/pcbnew" },
		expected: "/bin/pcbnew",
	},
	{
		name: "falls back to kicad for pcb when pcbnew is null",
		kind: "pcb",
		gui: { kicad: "/bin/kicad", pcbnew: null },
		expected: "/bin/kicad",
	},
	{
		name: "picks eeschema for schematic when present",
		kind: "schematic",
		gui: { kicad: "/bin/kicad", eeschema: "/bin/eeschema" },
		expected: "/bin/eeschema",
	},
	{
		name: "falls back to kicad for schematic when eeschema is null",
		kind: "schematic",
		gui: { kicad: "/bin/kicad", eeschema: null },
		expected: "/bin/kicad",
	},
	{
		name: "picks kicad for project",
		kind: "project",
		gui: { kicad: "/bin/kicad" },
		expected: "/bin/kicad",
	},
];

const LAUNCH_ERROR_CASES = [
	{
		name: "returns error when spawn throws",
		req: makeReq("pcb", "board.kicad_pcb"),
		gui: DEFAULT_GUI,
		spawn: () => {
			throw new Error("spawn failed");
		},
		expectedError: "Could not start KiCad",
	},
	{
		name: "returns error when KiCad is not installed",
		req: makeReq("pcb", "board.kicad_pcb"),
		gui: null,
		expectedError: "KiCad is not installed",
	},
	{
		name: "propagates validation failure without spawning",
		req: makeReq("pcb", "board.txt"),
		gui: DEFAULT_GUI,
		expectedError: "Invalid file extension",
		verifySpawnNotCalled: true,
	},
];

describe("findKicadGui", () => {
	for (const tc of WIN_GUI_CASES) {
		test(tc.name, () => {
			const res = findKicadGui({
				platform: "win32",
				env: tc.env,
				exists: tc.exists,
			});
			assert.notEqual(res, null);
			for (const [key, pattern] of tc.matches) {
				assert.match(res[key], pattern);
			}
		});
	}

	for (const platform of ["win32", "linux"]) {
		test(`returns null when nothing is found on ${platform}`, () => {
			const res = findKicadGui({
				platform,
				env: {},
				exists: () => false,
			});
			assert.equal(res, null);
		});
	}

	for (const tc of UNIX_GUI_CASES) {
		test(`finds binaries on ${tc.platform}`, () => {
			const exists = (candidate) => candidate.startsWith(tc.existsPrefix);
			const res = findKicadGui({ platform: tc.platform, env: {}, exists });
			assert.deepEqual(res, tc.expected);
		});
	}
});

describe("validateOpenRequest", () => {
	for (const tc of VALIDATE_CASES) {
		test(tc.name, () => {
			const deps = {
				realpath: tc.fakeRealpath || DEFAULT_DEPS.realpath,
				exists: tc.fakeExists || DEFAULT_DEPS.exists,
			};
			const res = validateOpenRequest(tc.req, deps);
			if (tc.expectedOk) {
				assert.equal(res.ok, true);
				assert.equal(typeof res.file, "string");
			} else {
				assert.equal(res.ok, false);
				assert.equal(res.error, tc.expectedError);
			}
		});
	}
});

describe("launchKicad", () => {
	for (const tc of PICK_CASES) {
		test(tc.name, () => {
			let spawnedBinary = null;
			const req = makeReq(tc.kind, `file.${EXT_BY_KIND[tc.kind]}`);
			const spawn = (bin) => {
				spawnedBinary = bin;
				return { unref: () => {} };
			};
			const res = launchKicad(req, {
				gui: tc.gui,
				spawn,
				...DEFAULT_DEPS,
			});
			assert.equal(spawnedBinary, tc.expected);
			assert.equal(res.ok, true);
		});
	}

	test("calls spawn with shell false, detached true, stdio ignore, and unrefs", () => {
		const capture = createSpawnCapture();
		const res = launchKicad(makeReq(), {
			gui: DEFAULT_GUI,
			spawn: capture.spawn,
			...DEFAULT_DEPS,
		});
		assert.equal(capture.state.unrefCalled, true);
		assert.equal(capture.state.call.options.shell, false);
		assert.equal(capture.state.call.options.detached, true);
		assert.equal(capture.state.call.options.stdio, "ignore");
		assert.equal(capture.state.call.options.windowsHide, false);
		assert.equal(res.ok, true);
	});

	test("passes normalized file path to spawn args", () => {
		const capture = createSpawnCapture();
		launchKicad(makeReq(), {
			gui: DEFAULT_GUI,
			spawn: capture.spawn,
			...DEFAULT_DEPS,
		});
		assert.deepEqual(capture.state.call.args, [
			path.normalize(path.join(PROJECT_ROOT, "board.kicad_pcb")),
		]);
	});

	for (const tc of LAUNCH_ERROR_CASES) {
		test(tc.name, () => {
			let spawnCalled = false;
			const spawn =
				tc.spawn ||
				(() => {
					spawnCalled = true;
					return { unref: () => {} };
				});
			const res = launchKicad(tc.req, {
				gui: tc.gui,
				spawn,
				...DEFAULT_DEPS,
			});
			assert.equal(res.error, tc.expectedError);
			assert.equal(res.ok, false);
			if (tc.verifySpawnNotCalled) {
				assert.equal(spawnCalled, false);
			}
		});
	}
});
