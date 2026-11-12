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
	let lastListArgs = null;
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
		listLibraries: async (kind) => [
			{ name: kind === "symbols" ? "Device" : "Resistor_SMD", count: 1 },
		],
		listLibraryItems: async (kind, libName, opt = {}) => {
			lastListArgs = { kind, libName, ...opt };
			const isSym = kind === "symbols";
			if (libName !== (isSym ? "Device" : "Resistor_SMD")) {
				return { items: [], total: 0 };
			}
			return { items: [isSym ? SAMPLE_SYMBOL : SAMPLE_FOOTPRINT], total: 1 };
		},
		getLastListLibraryItemsArgs: () => lastListArgs,
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

function assertErrorResponse(res, expectedStatus, expectedError) {
	assert.equal(res.status, expectedStatus);
	assert.ok(typeof res.json.error === "string");
	if (expectedError !== undefined) {
		assert.equal(res.json.error, expectedError);
	}
}

function assertArrayResult(res, key) {
	assertSuccess(res);
	assert.ok(Array.isArray(res.json[key]));
}

function assertSearchMatch(res, key, expectedId) {
	assertArrayResult(res, key);
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
	if (tc.isArray) {
		assertArrayResult(res, tc.key);
		return;
	}
	assertSuccess(res);
	if (tc.id) {
		assert.equal(res.json[tc.key]?.libId, tc.id);
		return;
	}
	assert.equal(res.json[tc.key], tc.expected);
}

function assertLibraryList(res, tc) {
	assertArrayResult(res, "libraries");
	tc.check(res.json);
}

function runTestCases(cases, queryFn, assertFn) {
	for (const tc of cases) {
		test(tc.name, async () => {
			const res = await queryFn(tc.path);
			assertFn(res, tc);
		});
	}
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

const BROWSE_VALIDATION_CASES = toNamedCases([
	["invalid lib name traversal", "/api/library/symbols/libraries/..%2F.."],
	["invalid lib name spaces", "/api/library/symbols/libraries/a%20b"],
	["bad offset negative", "/api/library/symbols/libraries/Device?offset=-1"],
	[
		"bad offset non-numeric",
		"/api/library/symbols/libraries/Device?offset=abc",
	],
	["limit 501 above max", "/api/library/symbols/libraries/Device?limit=501"],
]);

const CORE_ENDPOINTS = [
	["symbols search", "/api/library/symbols?q=res"],
	["symbol get", "/api/library/symbols/Device:R"],
	["footprints search", "/api/library/footprints?q=0805"],
	["footprint get", "/api/library/footprints/Resistor_SMD:R_0805"],
	["symbols libraries", "/api/library/symbols/libraries"],
	["symbols library items", "/api/library/symbols/libraries/Device"],
];

const UNAVAILABLE_CASES = CORE_ENDPOINTS.map(([label, path]) => ({
	name: `${label} when unavailable`,
	path,
}));

const CACHE_HEADER_CASES = CORE_ENDPOINTS.map(([label, path]) => ({
	name: `${label} cache header`,
	path,
}));

const STATUS_CASES = [
	{
		name: "returns available true when library is available",
		available: true,
		check: (res) => assert.equal(res.json.available, true),
	},
	{
		name: "GET /api/library/status response header cache-control equals no-store",
		available: true,
		check: (res) => assert.equal(res.cacheControl, "no-store"),
	},
	{
		name: "returns available false when library is unavailable",
		available: false,
		check: (res, fakeLib) => {
			assert.equal(res.json.available, false);
			fakeLib.setAvailable(true);
		},
	},
];

const BROWSE_LIST_CASES = [
	{
		name: "GET /api/library/symbols/libraries returns 200 with libraries list",
		path: "/api/library/symbols/libraries",
		check: (json) => assert.equal(json.libraries[0].name, "Device"),
	},
	{
		name: "GET /api/library/footprints/libraries returns 200 with libraries list",
		path: "/api/library/footprints/libraries",
		check: (json) => assert.equal(json.libraries[0].name, "Resistor_SMD"),
	},
	{
		name: "GET /api/library/symbols/libraries is not treated as a libId",
		path: "/api/library/symbols/libraries",
		check: (json) => assert.equal(json.error, undefined),
	},
];

const DUAL_BASE = [
	["/library/status", "available", { expected: true }],
	["/library/symbols?q=res", "symbols", { isArray: true }],
	["/library/symbols/Device:R", "symbol", { id: "Device:R" }],
	["/library/symbols/libraries", "libraries", { isArray: true }],
];

const DUAL_CASES = DUAL_BASE.flatMap(([basePath, key, extra]) => [
	{ name: `direct router handles ${basePath}`, path: basePath, key, ...extra },
	{
		name: `direct router handles /api${basePath}`,
		path: `/api${basePath}`,
		key,
		...extra,
	},
]);

describe("library-routes", () => {
	let server;
	let port;
	let fakeLibrary;

	before(async () => {
		const app = createApp();
		app.locals.allowLocalRepos = true;
		fakeLibrary = createFakeLibrary();
		app.locals.kicadLibrary = fakeLibrary;

		({ server, port } = await bootServer(app));
	});

	after(async () => {
		await shutdownServer(server);
	});

	const query = (path) => queryAvailable(port, fakeLibrary, path);
	const queryUnavail = (path) => queryUnavailable(port, fakeLibrary, path);

	describe("GET /library/status", () => {
		for (const tc of STATUS_CASES) {
			test(tc.name, async () => {
				const queryFn = tc.available ? query : queryUnavail;
				const res = await queryFn("/api/library/status");
				assertSuccess(res);
				tc.check(res, fakeLibrary);
			});
		}
	});

	describe("search endpoints", () => {
		runTestCases(SEARCH_CASES, query, (res, tc) =>
			assertSearchMatch(res, tc.key, tc.expectedId),
		);
	});

	describe("get endpoints", () => {
		runTestCases(GET_CASES, query, (res, tc) =>
			assertGetMatch(res, tc.key, tc.expectedId),
		);
	});

	describe("404 not found", () => {
		runTestCases(NOT_FOUND_CASES, query, (res) =>
			assertErrorResponse(res, 404),
		);
	});

	describe("400 validation", () => {
		runTestCases(VALIDATION_CASES, query, (res) =>
			assertErrorResponse(res, 400),
		);
	});

	describe("library browsing endpoints", () => {
		runTestCases(BROWSE_LIST_CASES, query, assertLibraryList);

		test("GET /api/library/symbols/libraries/:lib returns 200 with paging values passed through", async () => {
			const res = await query(
				"/api/library/symbols/libraries/Device?limit=25&offset=10",
			);
			assertArrayResult(res, "items");
			assert.equal(res.json.total, 1);
			assert.deepEqual(fakeLibrary.getLastListLibraryItemsArgs(), {
				kind: "symbols",
				libName: "Device",
				limit: 25,
				offset: 10,
			});
		});

		test("GET /api/library/symbols/libraries/:lib returns 404 for unknown lib", async () => {
			const res = await query("/api/library/symbols/libraries/UnknownLib");
			assertErrorResponse(res, 404, "Library not found");
		});
	});

	describe("library browsing 400 validation", () => {
		runTestCases(BROWSE_VALIDATION_CASES, query, (res) =>
			assertErrorResponse(res, 400),
		);
	});

	describe("503 service unavailable", () => {
		runTestCases(UNAVAILABLE_CASES, queryUnavail, assertUnavailable);
	});

	describe("cache headers", () => {
		runTestCases(CACHE_HEADER_CASES, query, assertCacheHeader);
	});

	describe("dual /x and /api/x router mounting", () => {
		let directServer;
		let directPort;

		before(async () => {
			const directApp = express();
			directApp.locals.kicadLibrary = createFakeLibrary();
			directApp.use(createLibraryRouter());
			({ server: directServer, port: directPort } =
				await bootServer(directApp));
		});

		after(async () => {
			await shutdownServer(directServer);
		});

		runTestCases(
			DUAL_CASES,
			(path) => requestGet(directPort, path),
			assertDualCase,
		);
	});
});
