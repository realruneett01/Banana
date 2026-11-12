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

const VALIDATE_CASES = [
	{
		name: "rejects invalid kind",
		req: {
			kind: "unknown",
			filePath: path.join(PROJECT_ROOT, "b.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		},
		expectedError: "Invalid kind",
	},
	{
		name: "rejects wrong extension",
		req: {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "b.txt"),
			projectRoot: PROJECT_ROOT,
		},
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
		req: {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "..", "outside", "b.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		},
		expectedError: "Path outside project root",
	},
	{
		name: "rejects symlink escaping root via fake realpath",
		req: {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "link.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		},
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
		req: {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "b.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		},
		fakeExists: () => false,
		expectedError: "File not found",
	},
	{
		name: "accepts valid pcb file",
		req: {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "board.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		},
		expectedOk: true,
	},
	{
		name: "accepts valid case-insensitive extension",
		req: {
			kind: "schematic",
			filePath: path.join(PROJECT_ROOT, "main.KICAD_SCH"),
			projectRoot: PROJECT_ROOT,
		},
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

describe("findKicadGui", () => {
	test("finds Windows 9.0 when 9.0 exists and 10.0 does not", () => {
		const exists = (candidate) => candidate.includes("9.0");
		const res = findKicadGui({ platform: "win32", env: {}, exists });
		assert.notEqual(res, null);
		assert.match(res.kicad, /9\.0.*kicad\.exe/i);
		assert.match(res.eeschema, /9\.0.*eeschema\.exe/i);
		assert.match(res.pcbnew, /9\.0.*pcbnew\.exe/i);
	});

	test("prefers KICAD_CLI_PATH directory over standard versions", () => {
		const env = { KICAD_CLI_PATH: "C:\\custom\\bin\\kicad-cli.exe" };
		const exists = (candidate) =>
			candidate.includes("custom") || candidate.includes("10.0");
		const res = findKicadGui({ platform: "win32", env, exists });
		assert.notEqual(res, null);
		assert.match(res.kicad, /custom.*kicad\.exe/i);
	});

	test("returns null when nothing is found on win32", () => {
		const res = findKicadGui({
			platform: "win32",
			env: {},
			exists: () => false,
		});
		assert.equal(res, null);
	});

	test("returns null when nothing is found on linux", () => {
		const res = findKicadGui({
			platform: "linux",
			env: {},
			exists: () => false,
		});
		assert.equal(res, null);
	});

	test("finds binaries on linux", () => {
		const exists = (candidate) => candidate.startsWith("/usr/bin");
		const res = findKicadGui({ platform: "linux", env: {}, exists });
		assert.deepEqual(res, {
			kicad: "/usr/bin/kicad",
			eeschema: "/usr/bin/eeschema",
			pcbnew: "/usr/bin/pcbnew",
		});
	});

	test("finds binaries on darwin", () => {
		const exists = (candidate) => candidate.startsWith("/Applications");
		const res = findKicadGui({ platform: "darwin", env: {}, exists });
		assert.deepEqual(res, {
			kicad: "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad",
			eeschema: "/Applications/KiCad/Eeschema.app/Contents/MacOS/eeschema",
			pcbnew: "/Applications/KiCad/Pcbnew.app/Contents/MacOS/pcbnew",
		});
	});
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
			const req = {
				kind: tc.kind,
				filePath: path.join(PROJECT_ROOT, `file.${EXT_BY_KIND[tc.kind]}`),
				projectRoot: PROJECT_ROOT,
			};
			const spawn = (bin) => {
				spawnedBinary = bin;
				return { unref: () => {} };
			};
			const res = launchKicad(req, {
				gui: tc.gui,
				spawn,
				...DEFAULT_DEPS,
			});
			assert.equal(res.ok, true);
			assert.equal(spawnedBinary, tc.expected);
		});
	}

	test("calls spawn with shell false, detached true, stdio ignore, and unrefs", () => {
		let spawnCall = null;
		let unrefCalled = false;
		const req = {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "board.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		};
		const spawn = (bin, args, options) => {
			spawnCall = { bin, args, options };
			return {
				unref: () => {
					unrefCalled = true;
				},
			};
		};
		const gui = { kicad: "/bin/kicad", pcbnew: "/bin/pcbnew" };
		const res = launchKicad(req, { gui, spawn, ...DEFAULT_DEPS });

		assert.equal(res.ok, true);
		assert.equal(unrefCalled, true);
		assert.equal(spawnCall.options.shell, false);
		assert.equal(spawnCall.options.detached, true);
		assert.equal(spawnCall.options.stdio, "ignore");
		assert.equal(spawnCall.options.windowsHide, false);
		assert.deepEqual(spawnCall.args, [
			path.normalize(path.join(PROJECT_ROOT, "board.kicad_pcb")),
		]);
	});

	test("returns error when spawn throws", () => {
		const req = {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "board.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		};
		const spawn = () => {
			throw new Error("spawn failed");
		};
		const gui = { kicad: "/bin/kicad", pcbnew: "/bin/pcbnew" };
		const res = launchKicad(req, { gui, spawn, ...DEFAULT_DEPS });
		assert.equal(res.ok, false);
		assert.equal(res.error, "Could not start KiCad");
	});

	test("returns error when KiCad is not installed", () => {
		const req = {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "board.kicad_pcb"),
			projectRoot: PROJECT_ROOT,
		};
		const res = launchKicad(req, { gui: null, ...DEFAULT_DEPS });
		assert.equal(res.ok, false);
		assert.equal(res.error, "KiCad is not installed");
	});

	test("propagates validation failure without spawning", () => {
		let spawnCalled = false;
		const req = {
			kind: "pcb",
			filePath: path.join(PROJECT_ROOT, "board.txt"),
			projectRoot: PROJECT_ROOT,
		};
		const spawn = () => {
			spawnCalled = true;
			return { unref: () => {} };
		};
		const gui = { kicad: "/bin/kicad", pcbnew: "/bin/pcbnew" };
		const res = launchKicad(req, { gui, spawn, ...DEFAULT_DEPS });
		assert.equal(res.ok, false);
		assert.equal(res.error, "Invalid file extension");
		assert.equal(spawnCalled, false);
	});
});
