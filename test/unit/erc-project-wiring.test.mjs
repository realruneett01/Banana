import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerKicadTools } from "../../backend/src/engine/tools/kicad-tools.js";

const DEMOS = "C:/Program Files/KiCad/10.0/share/kicad/demos";
const DEMO = `${DEMOS}/complex_hierarchy`;
const MIXER = `${DEMOS}/multichannel`;
const HAS_DEMO = fs.existsSync(DEMO) && fs.existsSync(MIXER);

function makeRoots() {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "erc-project-"));
	const root = path.join(base, "projects");
	const outside = path.join(base, "outside");
	fs.cpSync(DEMO, path.join(root, "demo"), { recursive: true });
	fs.cpSync(MIXER, path.join(root, "mixer"), { recursive: true });
	fs.cpSync(DEMO, outside, { recursive: true });
	return { base, root, outside };
}

const rootSheet = (dir) => path.join(dir, "complex_hierarchy.kicad_sch");
const mixerSheet = (root) =>
	path.join(root, "mixer", "multichannel_mixer.kicad_sch");

function badPaths(roots) {
	return [
		rootSheet(roots.outside),
		path.join(roots.root, "..", "outside", "complex_hierarchy.kicad_sch"),
		path.join(roots.root, "demo", "complex_hierarchy.kicad_pro"),
		"demo/complex_hierarchy.kicad_sch",
	];
}

// Expected counts match kicad-cli sch erc (KiCad 10.0.3), see
// erc-project.test.mjs: complex_hierarchy is clean over 3 sheets, the
// multichannel mixer has 3 power_in-not-driven errors over 5 sheets.
function assertReport(out, sheets, errors) {
	assert.equal(out.sheets, sheets);
	assert.equal(out.counts.error, errors);
	assert.equal(out.issues.error.length, errors);
	assert.ok(out.issues.error.every((i) => i.severity === "error"));
	assert.deepEqual(out.warnings, []);
	assert.equal(out.truncated, false);
}

describe("erc.project tool", {
	skip: !HAS_DEMO && "KiCad demo missing",
}, () => {
	let roots;
	let registry;
	before(() => {
		roots = makeRoots();
		registry = createRegistry();
		registerKicadTools(registry, { projectsRoot: roots.root, commit: "abc" });
	});
	after(() => fs.rmSync(roots.base, { recursive: true, force: true }));

	test("is listed as a read tool", () => {
		const tool = registry.list().find((t) => t.name === "erc.project");
		assert.ok(tool);
	});

	test("returns grouped issues for the KiCad demos", async () => {
		const path0 = rootSheet(path.join(roots.root, "demo"));
		const res = await registry.call("erc.project", { path: path0 });
		assert.equal(res.ok, true, res.error);
		assertReport(res.output, 3, 0);
		const mixer = await registry.call("erc.project", {
			path: mixerSheet(roots.root),
		});
		assert.equal(mixer.ok, true, mixer.error);
		assertReport(mixer.output, 5, 3);
		assert.equal(mixer.output.issues.error[0].commit, "abc");
	});

	test("refuses outside, ../, non-schematic and relative paths", async () => {
		for (const bad of badPaths(roots)) {
			const res = await registry.call("erc.project", { path: bad });
			assert.equal(res.ok, false, bad);
		}
	});
});

async function post(server, body) {
	const { port } = server.address();
	const res = await fetch(`http://127.0.0.1:${port}/api/erc/project`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return { status: res.status, json: await res.json().catch(() => ({})) };
}

describe("POST /api/erc/project", {
	skip: !HAS_DEMO && "KiCad demo missing",
}, () => {
	let roots;
	let server;
	before(async () => {
		roots = makeRoots();
		const app = createApp();
		app.locals.allowLocalRepos = true;
		app.locals.projectsRoot = roots.root;
		server = http.createServer(app);
		await new Promise((done) => server.listen(0, "127.0.0.1", done));
	});
	after(async () => {
		await new Promise((done) => server.close(done));
		fs.rmSync(roots.base, { recursive: true, force: true });
	});

	test("returns grouped issues for the KiCad demos", async () => {
		const res = await post(server, {
			path: rootSheet(path.join(roots.root, "demo")),
		});
		assert.equal(res.status, 200, JSON.stringify(res.json));
		assertReport(res.json, 3, 0);
		const mixer = await post(server, { path: mixerSheet(roots.root) });
		assert.equal(mixer.status, 200, JSON.stringify(mixer.json));
		assertReport(mixer.json, 5, 3);
	});

	test("refuses bad paths with 4xx", async () => {
		for (const bad of [...badPaths(roots), 42]) {
			const res = await post(server, { path: bad });
			assert.ok(res.status >= 400 && res.status < 500, `${bad}: ${res.status}`);
		}
	});

	test("refuses when local file access is off", async () => {
		server.close();
		const app = createApp();
		app.locals.allowLocalRepos = false;
		server = http.createServer(app);
		await new Promise((done) => server.listen(0, "127.0.0.1", done));
		const res = await post(server, {
			path: rootSheet(path.join(roots.root, "demo")),
		});
		assert.equal(res.status, 403);
	});
});
