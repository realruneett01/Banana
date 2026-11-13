import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import express from "express";
import {
	createKicadValidator,
	KICAD_REJECT_ERROR,
} from "../../backend/src/engine/kicad-validate.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerPatchTools } from "../../backend/src/engine/tools/patch-tools.js";
import { createEditorRouter } from "../../backend/src/routes/editor-routes.js";

const SAMPLE_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(symbol (lib_id "Device:R") (at 30 40 90)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const REPO_DIR = path.resolve("/fake/repo");
const SCH_REL = "hardware/board.kicad_sch";
const SCH_PATH = path.resolve(REPO_DIR, SCH_REL);
const COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";
const DEMO_DIR = "C:/Program Files/KiCad/10.0/share/kicad/demos/ecc83";

function silentLogger() {
	const warnings = [];
	return { warnings, warn: (...args) => warnings.push(args.join(" ")) };
}

function failWith(stderr, extra = {}) {
	return Object.assign(new Error("Command failed"), { stderr, ...extra });
}

function createFakeCli(error = null) {
	const calls = [];
	const record = (name) => async (input, output) => {
		calls.push({
			name,
			input,
			output,
			text: fs.readFileSync(input, "utf8"),
		});
		if (error) throw error;
		return output;
	};
	return {
		calls,
		exportNetlist: record("exportNetlist"),
		exportDrill: record("exportDrill"),
	};
}

function makeValidator(cli, logger = silentLogger()) {
	return createKicadValidator({ loadCli: async () => cli, logger });
}

function createFakes() {
	const written = new Map();
	const calls = [];
	const fsImpl = {
		readFile: async () => SAMPLE_SCH,
		writeFile: async (p, data) => {
			written.set(p, data);
		},
	};
	const execFileFn = async (cmd, args) => {
		calls.push({ cmd, args });
		const isTree = args.includes("--is-inside-work-tree");
		return { stdout: isTree ? "true\n" : `${COMMIT_HASH}\n` };
	};
	return { written, calls, fsImpl, execFileFn };
}

function commitBody() {
	return {
		repoPath: REPO_DIR,
		files: [
			{
				path: SCH_REL,
				kind: "sch",
				edits: [{ ref: "R1", op: "setValue", value: "22k" }],
			},
		],
		message: "Update R1",
	};
}

function gitWrites(calls) {
	return calls.filter(
		(c) => c.args.includes("add") || c.args.includes("commit"),
	);
}

describe("createKicadValidator with a fake runner", () => {
	test("schematic text is checked with a netlist export", async () => {
		const cli = createFakeCli();
		const res = await makeValidator(cli)("sch", SAMPLE_SCH);
		assert.deepEqual(res, { ok: true });
		assert.equal(cli.calls.length, 1);
		assert.equal(cli.calls[0].name, "exportNetlist");
		assert.ok(cli.calls[0].input.endsWith(".kicad_sch"));
		assert.equal(cli.calls[0].text, SAMPLE_SCH);
	});

	test("board text is checked with a drill export", async () => {
		const cli = createFakeCli();
		const res = await makeValidator(cli)("pcb", "(kicad_pcb)");
		assert.deepEqual(res, { ok: true });
		assert.equal(cli.calls[0].name, "exportDrill");
		assert.ok(cli.calls[0].input.endsWith(".kicad_pcb"));
	});

	test("a rejected file reports kicad-cli stderr without temp paths", async () => {
		const holder = {};
		const cli = createFakeCli();
		cli.exportNetlist = async (input) => {
			holder.dir = path.dirname(input);
			throw failWith(`Failed to load schematic ${input}\nmore`);
		};
		const res = await makeValidator(cli)("sch", "(kicad_sch (oops");
		assert.equal(res.ok, false);
		assert.ok(res.detail.startsWith("Failed to load schematic"));
		assert.ok(!res.detail.includes(holder.dir));
		assert.ok(!res.detail.includes("\n"));
	});

	test("temp files are removed after success and failure", async () => {
		const okCli = createFakeCli();
		await makeValidator(okCli)("sch", SAMPLE_SCH);
		assert.equal(fs.existsSync(path.dirname(okCli.calls[0].input)), false);
		const badCli = createFakeCli(failWith("Failed to load board"));
		await makeValidator(badCli)("pcb", "(kicad_pcb");
		assert.equal(fs.existsSync(path.dirname(badCli.calls[0].input)), false);
	});

	test("a missing kicad-cli binary skips validation with a warning", async () => {
		const logger = silentLogger();
		const missing = failWith("", { code: "ENOENT", syscall: "spawn kicad" });
		const res = await makeValidator(createFakeCli(missing), logger)(
			"sch",
			SAMPLE_SCH,
		);
		assert.deepEqual(res, { ok: true, skipped: true });
		assert.equal(logger.warnings.length, 1);
	});

	test("a kicad-cli that cannot be loaded skips validation with a warning", async () => {
		const logger = silentLogger();
		const validate = createKicadValidator({
			loadCli: async () => {
				throw new Error("kicad-cli not found");
			},
			logger,
		});
		assert.deepEqual(await validate("sch", SAMPLE_SCH), {
			ok: true,
			skipped: true,
		});
		assert.deepEqual(await validate("pcb", "(kicad_pcb)"), {
			ok: true,
			skipped: true,
		});
		assert.equal(logger.warnings.length, 1);
	});
});

describe("design.patch validates patched text before committing", () => {
	function runPatch(validateKicad) {
		const fakes = createFakes();
		const registry = createRegistry();
		registerPatchTools(registry, {
			fsImpl: fakes.fsImpl,
			execFileFn: fakes.execFileFn,
			validateKicad,
		});
		const call = registry.call("design.patch", commitBody(), {
			approved: true,
		});
		return call.then((res) => ({ res, fakes }));
	}

	test("validator receives the patched text and the commit proceeds", async () => {
		const seen = [];
		const { res, fakes } = await runPatch(async (kind, text) => {
			seen.push({ kind, text });
			return { ok: true };
		});
		assert.equal(res.ok, true);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].kind, "sch");
		assert.ok(seen[0].text.includes("22k"));
		assert.equal(fakes.written.get(SCH_PATH), seen[0].text);
		assert.equal(gitWrites(fakes.calls).length, 2);
	});

	test("a rejected file aborts before any write or commit", async () => {
		const { res, fakes } = await runPatch(async () => ({
			ok: false,
			detail: "Failed to load schematic",
		}));
		assert.equal(res.ok, false);
		assert.ok(res.error.startsWith(KICAD_REJECT_ERROR));
		assert.ok(res.error.includes(SCH_REL));
		assert.equal(fakes.written.size, 0);
		assert.equal(gitWrites(fakes.calls).length, 0);
	});
});

describe("POST /api/editor/commit with a KiCad rejection", () => {
	async function postCommit(validateKicad) {
		const fakes = createFakes();
		const app = express();
		app.use(express.json());
		app.locals.allowLocalRepos = true;
		app.use(
			createEditorRouter({
				patchDeps: {
					fsImpl: fakes.fsImpl,
					execFileFn: fakes.execFileFn,
					validateKicad,
				},
			}),
		);
		const server = app.listen(0, "127.0.0.1");
		await new Promise((resolve) => server.once("listening", resolve));
		try {
			const res = await fetch(
				`http://127.0.0.1:${server.address().port}/api/editor/commit`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(commitBody()),
				},
			);
			return { status: res.status, json: await res.json(), fakes };
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	}

	test("returns 422 with the KiCad error and detail", async () => {
		const { status, json, fakes } = await postCommit(async () => ({
			ok: false,
			detail: "Failed to load schematic",
		}));
		assert.equal(status, 422);
		assert.equal(json.error, KICAD_REJECT_ERROR);
		assert.equal(json.detail, `${SCH_REL}: Failed to load schematic`);
		assert.equal(fakes.written.size, 0);
		assert.equal(gitWrites(fakes.calls).length, 0);
	});
});

let realCli = null;
try {
	const mod = await import("../../backend/src/engine/kicad-cli.js");
	realCli = mod.createKicadCli();
} catch {
	realCli = null;
}

describe("createKicadValidator with the real kicad-cli", {
	skip:
		realCli && fs.existsSync(DEMO_DIR)
			? false
			: "kicad-cli or its demos are not installed",
}, () => {
	const validate = () => createKicadValidator({ loadCli: async () => realCli });

	test("accepts the ecc83 demo files and rejects broken ones", async () => {
		const sch = fs.readFileSync(`${DEMO_DIR}/ecc83-pp.kicad_sch`, "utf8");
		const pcb = fs.readFileSync(`${DEMO_DIR}/ecc83-pp.kicad_pcb`, "utf8");
		assert.deepEqual(await validate()("sch", sch), { ok: true });
		assert.deepEqual(await validate()("pcb", pcb), { ok: true });
		const brokenSch = await validate()("sch", sch.slice(0, sch.length / 2));
		assert.equal(brokenSch.ok, false);
		assert.ok(brokenSch.detail.length > 0);
		const brokenPcb = await validate()("pcb", pcb.slice(0, pcb.length / 2));
		assert.equal(brokenPcb.ok, false);
	});
});
