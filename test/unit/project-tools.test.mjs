import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerProjectTools } from "../../backend/src/engine/tools/project-tools.js";
import { buildLocalRegistry } from "../../backend/src/routes/agent-routes.js";

const tempDirs = [];

after(async () => {
	for (const dir of tempDirs) {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
});

async function makeRoot() {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proj-tools-"));
	tempDirs.push(dir);
	return fs.promises.realpath(dir);
}

function makeRegistry(projectsRoot) {
	const registry = createRegistry();
	registerProjectTools(registry, { projectsRoot });
	return registry;
}

function makeIR() {
	const [p1, p2] = [newId("part"), newId("part")];
	const part = (id, ref) => ({
		id,
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
	});
	const pin = (partId, n) => ({ partId, pin: n });
	return {
		schemaVersion: 1,
		name: "AgentDesign",
		parts: [part(p1, "R1"), part(p2, "R2")],
		nets: [
			{ id: newId("net"), name: "VCC", pins: [pin(p1, "1"), pin(p2, "1")] },
			{ id: newId("net"), name: "GND", pins: [pin(p1, "2"), pin(p2, "2")] },
		],
		constraints: [],
	};
}

function git(cwd, ...args) {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

async function createBoard(registry, name) {
	return registry.call("project.create", { name }, {});
}

describe("project.create", () => {
	test("creates a git project inside the projects root", async () => {
		const root = await makeRoot();
		const res = await createBoard(makeRegistry(root), "Blinky");
		assert.equal(res.ok, true, res.error);
		assert.equal(res.output.projectRoot, path.join(root, "Blinky"));
		assert.ok(res.output.files.includes("Blinky.kicad_pro"));
		assert.equal(
			git(res.output.projectRoot, "log", "--format=%s"),
			"Create project Blinky",
		);
	});

	test("rejects a parentDir outside the projects root", async () => {
		const root = await makeRoot();
		const outside = await makeRoot();
		const res = await makeRegistry(root).call(
			"project.create",
			{ name: "Escape", parentDir: outside },
			{},
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /outside the projects root/);
		assert.equal(fs.existsSync(path.join(outside, "Escape")), false);
	});

	test("reports an existing folder as an error", async () => {
		const root = await makeRoot();
		const registry = makeRegistry(root);
		await createBoard(registry, "Twice");
		const res = await createBoard(registry, "Twice");
		assert.equal(res.ok, false);
		assert.match(res.error, /already exists/);
	});
});

describe("project.write_design", () => {
	test("is marked destructive and needs approval", async () => {
		const root = await makeRoot();
		const registry = makeRegistry(root);
		const tool = registry.list().find((t) => t.name === "project.write_design");
		assert.equal(tool.permission, "destructive");
		const res = await registry.call("project.write_design", {
			projectPath: root,
			ir: makeIR(),
			message: "x",
		});
		assert.equal(res.ok, false);
		assert.match(res.error, /approval required/);
	});

	test("writes sch and pcb into the project and commits with the message", async () => {
		const root = await makeRoot();
		const registry = makeRegistry(root);
		const created = await createBoard(registry, "Board");
		const projectPath = created.output.projectRoot;
		const res = await registry.call(
			"project.write_design",
			{ projectPath, ir: makeIR(), message: "agent: add resistors" },
			{ approved: true },
		);
		assert.equal(res.ok, true, res.error);
		assert.deepEqual(res.output.files, ["Board.kicad_sch", "Board.kicad_pcb"]);
		assert.equal(res.output.commit, git(projectPath, "rev-parse", "HEAD"));
		assert.equal(
			git(projectPath, "log", "-1", "--format=%s"),
			"agent: add resistors",
		);
		const sch = fs.readFileSync(
			path.join(projectPath, "Board.kicad_sch"),
			"utf8",
		);
		assert.match(sch, /R1/);
		assert.equal(git(projectPath, "status", "--porcelain"), "");
	});

	test("rejects a project path outside the projects root", async () => {
		const root = await makeRoot();
		const outside = await makeRoot();
		git(outside, "init", "-q");
		const res = await makeRegistry(root).call(
			"project.write_design",
			{ projectPath: outside, ir: makeIR(), message: "nope" },
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /outside the projects root/);
	});

	test("rejects invalid IR and an empty message", async () => {
		const root = await makeRoot();
		const registry = makeRegistry(root);
		const { output } = await createBoard(registry, "Bad");
		const call = (input) =>
			registry.call("project.write_design", input, { approved: true });
		const badIr = await call({
			projectPath: output.projectRoot,
			ir: { nope: true },
			message: "m",
		});
		assert.equal(badIr.ok, false);
		assert.match(badIr.error, /Invalid circuit IR/);
		const noMsg = await call({
			projectPath: output.projectRoot,
			ir: makeIR(),
			message: "",
		});
		assert.equal(noMsg.ok, false);
	});
});

test("buildLocalRegistry registers the project tools", () => {
	const names = buildLocalRegistry()
		.list()
		.map((t) => t.name);
	assert.ok(names.includes("project.create"));
	assert.ok(names.includes("project.write_design"));
});
