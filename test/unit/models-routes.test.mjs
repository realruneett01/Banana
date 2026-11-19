import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createModelsRouter } from "../../backend/src/routes/models-routes.js";

const CONTENT_A_WRL = "VRML V2.0 utf8\n# Model A";
const CONTENT_B_STEP = "ISO-10303-21;\nHEADER;\n/* Model B STEP */";
const CONTENT_B_WRL = "VRML V2.0 utf8\n# Model B WRL";
const CONTENT_C_STEP = "ISO-10303-21;\nHEADER;\n/* Model C STEP */";

async function withServer(app, fn) {
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	try {
		await fn(port);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

async function requestModel(port, query) {
	const url =
		query !== undefined
			? `http://127.0.0.1:${port}/api/models?path=${query}`
			: `http://127.0.0.1:${port}/api/models`;
	const res = await fetch(url);
	const text = await res.text();
	return { status: res.status, headers: res.headers, text };
}

function setupFixtures() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtest-"));
	const files = {
		"a.wrl": CONTENT_A_WRL,
		"b.step": CONTENT_B_STEP,
		"b.wrl": CONTENT_B_WRL,
		"c.step": CONTENT_C_STEP,
	};
	for (const [name, content] of Object.entries(files)) {
		fs.writeFileSync(path.join(dir, name), content, "utf8");
	}
	return {
		dir,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}

function assertOkResponse(res, expectedType, expectedText) {
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("content-type"), expectedType);
	assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
	assert.equal(res.text, expectedText);
}

async function assertErrorResponse(port, query, expectedStatus) {
	const res = await requestModel(port, query);
	assert.equal(res.status, expectedStatus);
	const json = JSON.parse(res.text);
	assert.ok(typeof json.error === "string");
}

function kicadVar(v, subPath) {
	return `$${"{"}${v}}${subPath ? `/${subPath}` : ""}`;
}

const VAR_NAMES = [
	"KICAD10_3DMODEL_DIR",
	"KICAD9_3DMODEL_DIR",
	"KICAD8_3DMODEL_DIR",
	"KICAD7_3DMODEL_DIR",
	"KICAD6_3DMODEL_DIR",
	"KICAD_3DMODEL_DIR",
	"KISYS3DMOD",
];

const VARIABLE_CASES = [
	...VAR_NAMES.map((name) => [name, kicadVar(name, "a.wrl")]),
	["bare relative", "a.wrl"],
];

const STEP_PREFERENCE_CASES = [
	[
		"prefers .wrl for .step",
		kicadVar("KICAD10_3DMODEL_DIR", "b.step"),
		"model/vrml",
		CONTENT_B_WRL,
	],
	[
		"prefers .wrl for .stp",
		kicadVar("KICAD10_3DMODEL_DIR", "b.stp"),
		"model/vrml",
		CONTENT_B_WRL,
	],
	[
		"serves .step when no .wrl",
		kicadVar("KICAD10_3DMODEL_DIR", "c.step"),
		"application/step",
		CONTENT_C_STEP,
	],
];

const TRAVERSAL_400_CASES = [
	["../ parent traversal", "../a.wrl"],
	["..\\ backslash parent traversal", "..%5ca.wrl"],
	["%2e%2e encoded traversal", "%2e%2e/a.wrl"],
	["absolute C:\\ path", "C:%5ca.wrl"],
	["absolute C:/ path", "C:/a.wrl"],
	["absolute /etc path", "/etc/a.wrl"],
	["NUL byte in path", "a.wrl%00"],
	["variable with ../ traversal", kicadVar("KICAD10_3DMODEL_DIR", "../a.wrl")],
	[
		"variable with ..\\ traversal",
		kicadVar("KICAD10_3DMODEL_DIR", "..%5ca.wrl"),
	],
	[
		"variable with absolute /etc path",
		`${kicadVar("KICAD10_3DMODEL_DIR")}//etc/a.wrl`,
	],
	["variable with C:\\ path", kicadVar("KICAD10_3DMODEL_DIR", "C:%5ca.wrl")],
	["unsupported file extension", "a.txt"],
	["missing path parameter", undefined],
];

const MISSING_404_CASES = [
	["missing .wrl file", "nonexistent.wrl"],
	["missing .step file", "nonexistent.step"],
	[
		"missing file with variable",
		kicadVar("KICAD10_3DMODEL_DIR", "missing.wrl"),
	],
];

const UNCONFIGURED_503_CASES = [
	["modelDir is empty", ""],
	[
		"modelDir does not exist",
		path.join(os.tmpdir(), "banana-missing-model-dir-12345"),
	],
];

describe("models-routes: configured instance", () => {
	const fixtures = setupFixtures();
	const app = express();
	app.use("/api", createModelsRouter({ modelDir: fixtures.dir }));
	let server;
	let port;

	before(async () => {
		server = http.createServer(app);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		port = server.address().port;
	});

	after(async () => {
		await new Promise((resolve) => server.close(resolve));
		fixtures.cleanup();
	});

	for (const [name, query] of VARIABLE_CASES) {
		test(`variable stripping: ${name}`, async () => {
			const res = await requestModel(port, query);
			assertOkResponse(res, "model/vrml", CONTENT_A_WRL);
		});
	}

	for (const [
		desc,
		query,
		expectedType,
		expectedText,
	] of STEP_PREFERENCE_CASES) {
		test(`format preference: ${desc}`, async () => {
			const res = await requestModel(port, query);
			assertOkResponse(res, expectedType, expectedText);
		});
	}

	for (const [desc, query] of TRAVERSAL_400_CASES) {
		test(`traversal rejected with 400: ${desc}`, async () => {
			await assertErrorResponse(port, query, 400);
		});
	}

	for (const [desc, query] of MISSING_404_CASES) {
		test(`missing model returns 404: ${desc}`, async () => {
			await assertErrorResponse(port, query, 404);
		});
	}
});

describe("models-routes: unconfigured service and app integration", () => {
	for (const [desc, dir] of UNCONFIGURED_503_CASES) {
		test(`returns 503 when ${desc}`, async () => {
			const app = express();
			app.use("/api", createModelsRouter({ modelDir: dir }));
			await withServer(app, async (testPort) => {
				await assertErrorResponse(testPort, "a.wrl", 503);
			});
		});
	}

	test("integrates with createApp at /api/models", async () => {
		await withServer(createApp(), async (appPort) => {
			await assertErrorResponse(appPort, "../traversal.wrl", 400);
		});
	});
});
