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
	const server = http.createServer(app);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, port: server.address().port });
		});
	});
}

const shutdownServer = (server) =>
	new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}
		server.close(resolve);
	});

async function requestGet(port, path) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`);
	const json = await response.json().catch(() => ({}));
	return {
		status: response.status,
		json,
		cacheControl: response.headers.get("cache-control"),
	};
}

const SEARCH_CASES = [
	{
		name: "GET /api/library/symbols with q",
		path: "/api/library/symbols?q=res",
		key: "symbols",
		expectedId: "Device:R",
	},
	{
		name: "GET /api/library/symbols with q and limit",
		path: "/api/library/symbols?q=res&limit=10",
		key: "symbols",
		expectedId: "Device:R",
	},
	{
		name: "GET /api/library/footprints with q",
		path: "/api/library/footprints?q=0805",
		key: "footprints",
		expectedId: "Resistor_SMD:R_0805",
	},
	{
		name: "GET /api/library/footprints with q and limit",
		path: "/api/library/footprints?q=0805&limit=25",
		key: "footprints",
		expectedId: "Resistor_SMD:R_0805",
	},
];

const GET_CASES = [
	{
		name: "GET /api/library/symbols/:libId",
		path: "/api/library/symbols/Device:R",
		key: "symbol",
		expectedId: "Device:R",
	},
	{
		name: "GET /api/library/footprints/:libId",
		path: "/api/library/footprints/Resistor_SMD:R_0805",
		key: "footprint",
		expectedId: "Resistor_SMD:R_0805",
	},
];

const NOT_FOUND_CASES = [
	{
		name: "GET missing symbol returns 404",
		path: "/api/library/symbols/Device:NotFound",
	},
	{
		name: "GET missing footprint returns 404",
		path: "/api/library/footprints/Package_SO:NotFound",
	},
];

const VALIDATION_CASES = [
	{
		name: "symbols missing q",
		path: "/api/library/symbols",
	},
	{
		name: "symbols empty q",
		path: "/api/library/symbols?q=",
	},
	{
		name: "symbols whitespace q",
		path: "/api/library/symbols?q=%20%20",
	},
	{
		name: "symbols q too long",
		path: `/api/library/symbols?q=${"a".repeat(101)}`,
	},
	{
		name: "symbols invalid limit non-numeric",
		path: "/api/library/symbols?q=res&limit=abc",
	},
	{
		name: "symbols invalid limit zero",
		path: "/api/library/symbols?q=res&limit=0",
	},
	{
		name: "symbols invalid limit negative",
		path: "/api/library/symbols?q=res&limit=-5",
	},
	{
		name: "symbols invalid limit above 100",
		path: "/api/library/symbols?q=res&limit=101",
	},
	{
		name: "symbols invalid limit float",
		path: "/api/library/symbols?q=res&limit=1.5",
	},
	{
		name: "footprints missing q",
		path: "/api/library/footprints",
	},
	{
		name: "symbol invalid libId missing colon",
		path: "/api/library/symbols/InvalidLibId",
	},
	{
		name: "footprint invalid libId missing colon",
		path: "/api/library/footprints/InvalidLibId",
	},
];

const UNAVAILABLE_CASES = [
	{
		name: "symbols search when unavailable",
		path: "/api/library/symbols?q=res",
	},
	{
		name: "symbol get when unavailable",
		path: "/api/library/symbols/Device:R",
	},
	{
		name: "footprints search when unavailable",
		path: "/api/library/footprints?q=0805",
	},
	{
		name: "footprint get when unavailable",
		path: "/api/library/footprints/Resistor_SMD:R_0805",
	},
];

const CACHE_HEADER_CASES = [
	{
		name: "status cache header",
		path: "/api/library/status",
	},
	{
		name: "symbols search cache header",
		path: "/api/library/symbols?q=res",
	},
	{
		name: "symbol get cache header",
		path: "/api/library/symbols/Device:R",
	},
	{
		name: "footprints search cache header",
		path: "/api/library/footprints?q=0805",
	},
	{
		name: "footprint get cache header",
		path: "/api/library/footprints/Resistor_SMD:R_0805",
	},
];

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
			fakeLibrary.setAvailable(true);
			const { status, json, cacheControl } = await requestGet(
				port,
				"/api/library/status",
			);
			assert.equal(status, 200);
			assert.equal(json.available, true);
			assert.equal(cacheControl, "public, max-age=3600");
		});

		test("returns available false when library is unavailable", async () => {
			fakeLibrary.setAvailable(false);
			const { status, json } = await requestGet(port, "/api/library/status");
			assert.equal(status, 200);
			assert.equal(json.available, false);
			fakeLibrary.setAvailable(true);
		});
	});

	describe("search endpoints", () => {
		for (const tc of SEARCH_CASES) {
			test(tc.name, async () => {
				fakeLibrary.setAvailable(true);
				const { status, json } = await requestGet(port, tc.path);
				assert.equal(status, 200);
				assert.ok(Array.isArray(json[tc.key]));
				assert.equal(json[tc.key][0].libId, tc.expectedId);
			});
		}
	});

	describe("get endpoints", () => {
		for (const tc of GET_CASES) {
			test(tc.name, async () => {
				fakeLibrary.setAvailable(true);
				const { status, json } = await requestGet(port, tc.path);
				assert.equal(status, 200);
				assert.equal(json[tc.key]?.libId, tc.expectedId);
			});
		}
	});

	describe("404 not found", () => {
		for (const tc of NOT_FOUND_CASES) {
			test(tc.name, async () => {
				fakeLibrary.setAvailable(true);
				const { status, json } = await requestGet(port, tc.path);
				assert.equal(status, 404);
				assert.ok(typeof json.error === "string");
			});
		}
	});

	describe("400 validation", () => {
		for (const tc of VALIDATION_CASES) {
			test(tc.name, async () => {
				fakeLibrary.setAvailable(true);
				const { status, json } = await requestGet(port, tc.path);
				assert.equal(status, 400);
				assert.ok(typeof json.error === "string");
			});
		}
	});

	describe("503 service unavailable", () => {
		for (const tc of UNAVAILABLE_CASES) {
			test(tc.name, async () => {
				fakeLibrary.setAvailable(false);
				const { status, json } = await requestGet(port, tc.path);
				assert.equal(status, 503);
				assert.equal(
					json.error,
					"KiCad libraries are not installed on this server",
				);
			});
		}
	});

	describe("cache headers", () => {
		for (const tc of CACHE_HEADER_CASES) {
			test(tc.name, async () => {
				fakeLibrary.setAvailable(true);
				const { status, cacheControl } = await requestGet(port, tc.path);
				assert.equal(status, 200);
				assert.equal(cacheControl, "public, max-age=3600");
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

		const DUAL_CASES = [
			{ path: "/library/status", key: "available", expected: true },
			{ path: "/api/library/status", key: "available", expected: true },
			{ path: "/library/symbols?q=res", key: "symbols", isArray: true },
			{ path: "/api/library/symbols?q=res", key: "symbols", isArray: true },
			{ path: "/library/symbols/Device:R", key: "symbol", id: "Device:R" },
			{ path: "/api/library/symbols/Device:R", key: "symbol", id: "Device:R" },
		];

		for (const tc of DUAL_CASES) {
			test(`direct router handles ${tc.path}`, async () => {
				const { status, json } = await requestGet(directPort, tc.path);
				assert.equal(status, 200);
				if (tc.isArray) {
					assert.ok(Array.isArray(json[tc.key]));
				} else if (tc.id) {
					assert.equal(json[tc.key]?.libId, tc.id);
				} else {
					assert.equal(json[tc.key], tc.expected);
				}
			});
		}
	});
});
