import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createLibraryRouter } from "../../backend/src/routes/library-routes.js";

const SAMPLE_SYMBOL = {
	libId: "Device:R",
	name: "R",
	description: "Resistor",
	keywords: "R res",
	properties: { Reference: "R", Value: "R" },
	pins: [
		{
			number: "1",
			name: "~",
			type: "passive",
			at: [0, 0, 0],
			length: 1.27,
		},
	],
	graphics: [],
};

const SAMPLE_FOOTPRINT = {
	libId: "Resistor_SMD:R_0805",
	name: "R_0805",
	description: "Resistor SMD",
	keywords: "resistor",
	pads: [
		{
			number: "1",
			type: "smd",
			shape: "roundrect",
			at: [0, 0, 0],
			size: [1, 1],
			layers: ["F.Cu"],
		},
	],
	graphics: [],
};

function createFakeLibrary(overrides = {}) {
	let isAvailable = overrides.available ?? true;
	return {
		setAvailable(val) {
			isAvailable = val;
		},
		available: async () => isAvailable,
		searchSymbols: async (_q, _opt) => [SAMPLE_SYMBOL],
		getSymbol: async (libId) => (libId === "Device:R" ? SAMPLE_SYMBOL : null),
		searchFootprints: async (_q, _opt) => [SAMPLE_FOOTPRINT],
		getFootprint: async (libId) =>
			libId === "Resistor_SMD:R_0805" ? SAMPLE_FOOTPRINT : null,
		...overrides,
	};
}

function bootServer(app) {
	return new Promise((resolve) => {
		const srv = http.createServer(app).listen(0, "127.0.0.1", () => {
			resolve({ server: srv, port: srv.address().port });
		});
	});
}

function shutdownServer(server) {
	return new Promise((resolve) => {
		if (!server) return resolve();
		server.close(resolve);
	});
}

async function requestGet(port, path) {
	const res = await fetch(`http://127.0.0.1:${port}${path}`);
	const body = await res.json().catch(() => ({}));
	return {
		status: res.status,
		json: body,
		cacheControl: res.headers.get("cache-control"),
	};
}

async function requestWithAvailability(port, fakeLib, available, path) {
	fakeLib.setAvailable(available);
	return requestGet(port, path);
}

const queryAvailable = (port, fakeLib, path) =>
	requestWithAvailability(port, fakeLib, true, path);

const queryUnavailable = (port, fakeLib, path) =>
	requestWithAvailability(port, fakeLib, false, path);

function assertSuccess(res) {
	assert.equal(res.status, 200);
}

function assertCacheHeader(res) {
	assertSuccess(res);
	assert.equal(res.cacheControl, "public, max-age=3600");
}

function assertErrorResponse(res, expectedStatus) {
	assert.equal(res.status, expectedStatus);
	assert.ok(typeof res.json.error === "string");
}

function assertSearchMatch(res, key, expectedId) {
	assertSuccess(res);
	assert.ok(Array.isArray(res.json[key]));
	assert.equal(res.json[key][0].libId, expectedId);
}

function assertGetMatch(res, key, expectedId) {
	assertSuccess(res);
	assert.equal(res.json[key]?.libId, expectedId);
}

function assertUnavailable(res) {
	assert.equal(res.status, 503);
	assert.equal(
		res.json.error,
		"KiCad libraries are not installed on this server",
	);
}

function assertDualCase(res, tc) {
	assertSuccess(res);
	if (tc.isArray) {
		assert.ok(Array.isArray(res.json[tc.key]));
		return;
	}
	if (tc.id) {
		assert.equal(res.json[tc.key]?.libId, tc.id);
		return;
	}
	assert.equal(res.json[tc.key], tc.expected);
}

const toNamedCases = (rows) => rows.map(([name, path]) => ({ name, path }));

const SEARCH_CASES = [
	[
		"GET /api/library/symbols with q",
		"/api/library/symbols?q=res",
		"symbols",
		"Device:R",
	],
	[
		"GET /api/library/symbols with q and limit",
		"/api/library/symbols?q=res&limit=10",
		"symbols",
		"Device:R",
	],
	[
		"GET /api/library/footprints with q",
		"/api/library/footprints?q=0805",
		"footprints",
		"Resistor_SMD:R_0805",
	],
	[
		"GET /api/library/footprints with q and limit",
		"/api/library/footprints?q=0805&limit=25",
		"footprints",
		"Resistor_SMD:R_0805",
	],
].map(([name, path, key, expectedId]) => ({ name, path, key, expectedId }));

const GET_CASES = [
	[
		"GET /api/library/symbols/:libId",
		"/api/library/symbols/Device:R",
		"symbol",
		"Device:R",
	],
	[
		"GET /api/library/footprints/:libId",
		"/api/library/footprints/Resistor_SMD:R_0805",
		"footprint",
		"Resistor_SMD:R_0805",
	],
].map(([name, path, key, expectedId]) => ({ name, path, key, expectedId }));

const NOT_FOUND_CASES = toNamedCases([
	["GET missing symbol returns 404", "/api/library/symbols/Device:NotFound"],
	[
		"GET missing footprint returns 404",
		"/api/library/footprints/Package_SO:NotFound",
	],
]);

const VALIDATION_CASES = toNamedCases([
	["symbols missing q", "/api/library/symbols"],
	["symbols empty q", "/api/library/symbols?q="],
	["symbols whitespace q", "/api/library/symbols?q=%20%20"],
	["symbols q too long", `/api/library/symbols?q=${"a".repeat(101)}`],
	["symbols invalid limit non-numeric", "/api/library/symbols?q=res&limit=abc"],
	["symbols invalid limit zero", "/api/library/symbols?q=res&limit=0"],
	["symbols invalid limit negative", "/api/library/symbols?q=res&limit=-5"],
	["symbols invalid limit above 100", "/api/library/symbols?q=res&limit=101"],
	["symbols invalid limit float", "/api/library/symbols?q=res&limit=1.5"],
	["footprints missing q", "/api/library/footprints"],
	["symbol invalid libId missing colon", "/api/library/symbols/InvalidLibId"],
	[
		"footprint invalid libId missing colon",
		"/api/library/footprints/InvalidLibId",
	],
]);

const UNAVAILABLE_CASES = toNamedCases([
	["symbols search when unavailable", "/api/library/symbols?q=res"],
	["symbol get when unavailable", "/api/library/symbols/Device:R"],
	["footprints search when unavailable", "/api/library/footprints?q=0805"],
	[
		"footprint get when unavailable",
		"/api/library/footprints/Resistor_SMD:R_0805",
	],
]);

const CACHE_HEADER_CASES = toNamedCases([
	["symbols search cache header", "/api/library/symbols?q=res"],
	["symbol get cache header", "/api/library/symbols/Device:R"],
	["footprints search cache header", "/api/library/footprints?q=0805"],
	["footprint get cache header", "/api/library/footprints/Resistor_SMD:R_0805"],
]);

const DUAL_CASES = [
	["/library/status", "available", { expected: true }],
	["/api/library/status", "available", { expected: true }],
	["/library/symbols?q=res", "symbols", { isArray: true }],
	["/api/library/symbols?q=res", "symbols", { isArray: true }],
	["/library/symbols/Device:R", "symbol", { id: "Device:R" }],
	["/api/library/symbols/Device:R", "symbol", { id: "Device:R" }],
].map(([path, key, extra]) => ({ path, key, ...extra }));

describe("library-routes", () => {
	let server;
	let port;
	let fakeLibrary;

	before(async () => {
		const app = createApp();
		app.locals.allowLocalRepos = true;
		fakeLibrary = createFakeLibrary();
		app.locals.kicadLibrary = fakeLibrary;

		const started = await bootServer(app);
		server = started.server;
		port = started.port;
	});

	after(async () => {
		await shutdownServer(server);
	});

	describe("GET /library/status", () => {
		test("returns available true when library is available", async () => {
			const res = await queryAvailable(
				port,
				fakeLibrary,
				"/api/library/status",
			);
			assertSuccess(res);
			assert.equal(res.json.available, true);
		});

		test("GET /api/library/status response header cache-control equals no-store", async () => {
			const res = await queryAvailable(
				port,
				fakeLibrary,
				"/api/library/status",
			);
			assertSuccess(res);
			assert.equal(res.cacheControl, "no-store");
		});

		test("returns available false when library is unavailable", async () => {
			const res = await queryUnavailable(
				port,
				fakeLibrary,
				"/api/library/status",
			);
			assertSuccess(res);
			assert.equal(res.json.available, false);
			fakeLibrary.setAvailable(true);
		});
	});

	describe("search endpoints", () => {
		for (const tc of SEARCH_CASES) {
			test(tc.name, async () => {
				const res = await queryAvailable(port, fakeLibrary, tc.path);
				assertSearchMatch(res, tc.key, tc.expectedId);
			});
		}
	});

	describe("get endpoints", () => {
		for (const tc of GET_CASES) {
			test(tc.name, async () => {
				const res = await queryAvailable(port, fakeLibrary, tc.path);
				assertGetMatch(res, tc.key, tc.expectedId);
			});
		}
	});

	describe("404 not found", () => {
		for (const tc of NOT_FOUND_CASES) {
			test(tc.name, async () => {
				const res = await queryAvailable(port, fakeLibrary, tc.path);
				assertErrorResponse(res, 404);
			});
		}
	});

	describe("400 validation", () => {
		for (const tc of VALIDATION_CASES) {
			test(tc.name, async () => {
				const res = await queryAvailable(port, fakeLibrary, tc.path);
				assertErrorResponse(res, 400);
			});
		}
	});

	describe("503 service unavailable", () => {
		for (const tc of UNAVAILABLE_CASES) {
			test(tc.name, async () => {
				const res = await queryUnavailable(port, fakeLibrary, tc.path);
				assertUnavailable(res);
			});
		}
	});

	describe("cache headers", () => {
		for (const tc of CACHE_HEADER_CASES) {
			test(tc.name, async () => {
				const res = await queryAvailable(port, fakeLibrary, tc.path);
				assertCacheHeader(res);
			});
		}
	});

	describe("dual /x and /api/x router mounting", () => {
		let directServer;
		let directPort;

		before(async () => {
			const directApp = express();
			directApp.locals.kicadLibrary = createFakeLibrary();
			directApp.use(createLibraryRouter());
			const started = await bootServer(directApp);
			directServer = started.server;
			directPort = started.port;
		});

		after(async () => {
			await shutdownServer(directServer);
		});

		for (const tc of DUAL_CASES) {
			test(`direct router handles ${tc.path}`, async () => {
				const res = await requestGet(directPort, tc.path);
				assertDualCase(res, tc);
			});
		}
	});
});
