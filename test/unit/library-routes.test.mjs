import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createLibraryRouter } from "../../backend/src/routes/library-routes.js";

const createSample = (meta, elementKey, element) => ({
	libId: meta.libId,
	name: meta.name,
	description: meta.desc,
	keywords: meta.kw,
	graphics: [],
	[elementKey]: [element],
});

const SAMPLE_SYMBOL = {
	...createSample(
		{ libId: "Device:R", name: "R", desc: "Resistor", kw: "R res" },
		"pins",
		{
			number: "1",
			name: "~",
			type: "passive",
			at: [0, 0, 0],
			length: 1.27,
		},
	),
	properties: { Reference: "R", Value: "R" },
};

const SAMPLE_FOOTPRINT = createSample(
	{
		libId: "Resistor_SMD:R_0805",
		name: "R_0805",
		desc: "Resistor SMD",
		kw: "resistor",
	},
	"pads",
	{
		number: "1",
		type: "smd",
		shape: "roundrect",
		at: [0, 0, 0],
		size: [1, 1],
		layers: ["F.Cu"],
	},
);

function createFakeLibrary(overrides = {}) {
	let isAvailable = overrides.available ?? true;
	let lastListArgs = null;
	const itemsByKind = {
		symbols: { lib: "Device", id: "Device:R", sample: SAMPLE_SYMBOL },
		footprints: {
			lib: "Resistor_SMD",
			id: "Resistor_SMD:R_0805",
			sample: SAMPLE_FOOTPRINT,
		},
	};

	return {
		setAvailable(val) {
			isAvailable = val;
		},
		available: async () => isAvailable,
		searchSymbols: async () => [SAMPLE_SYMBOL],
		getSymbol: async (id) =>
			id === itemsByKind.symbols.id ? SAMPLE_SYMBOL : null,
		searchFootprints: async () => [SAMPLE_FOOTPRINT],
		getFootprint: async (id) =>
			id === itemsByKind.footprints.id ? SAMPLE_FOOTPRINT : null,
		listLibraries: async (kind) => [{ name: itemsByKind[kind]?.lib, count: 1 }],
		listLibraryItems: async (kind, libName, opt = {}) => {
			lastListArgs = { kind, libName, ...opt };
			const config = itemsByKind[kind];
			if (libName !== config?.lib) {
				return { items: [], total: 0 };
			}
			return { items: [config.sample], total: 1 };
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

function setupTestServer(createAppInstance) {
	let server;
	let port;
	before(async () => {
		const app = createAppInstance();
		({ server, port } = await bootServer(app));
	});
	after(() => shutdownServer(server));
	return () => port;
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

function assertSearchMatch(res, { key, expectedId }) {
	assertArrayResult(res, key);
	assert.equal(res.json[key][0].libId, expectedId);
}

function assertGetMatch(res, { key, expectedId }) {
	assertSuccess(res);
	assert.equal(res.json[key]?.libId, expectedId);
}

const assertNotFound = (res) => assertErrorResponse(res, 404);
const assertBadRequest = (res) => assertErrorResponse(res, 400);
const assertUnavailable = (res) =>
	assertErrorResponse(
		res,
		503,
		"KiCad libraries are not installed on this server",
	);

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

const caseItem = (name, path) => ({ name, path });

const makeSearchCase = (kind, desc, query, expectedId) => ({
	name: `GET /api/library/${kind} ${desc}`,
	path: `/api/library/${kind}?${query}`,
	key: kind,
	expectedId,
});

const SEARCH_CASES = [
	makeSearchCase("symbols", "with q", "q=res", "Device:R"),
	makeSearchCase("symbols", "with q and limit", "q=res&limit=10", "Device:R"),
	makeSearchCase("footprints", "with q", "q=0805", "Resistor_SMD:R_0805"),
	makeSearchCase(
		"footprints",
		"with q and limit",
		"q=0805&limit=25",
		"Resistor_SMD:R_0805",
	),
];

const makeGetCase = (kind, singular, id) => ({
	name: `GET /api/library/${kind}/:libId`,
	path: `/api/library/${kind}/${id}`,
	key: singular,
	expectedId: id,
});

const GET_CASES = [
	makeGetCase("symbols", "symbol", "Device:R"),
	makeGetCase("footprints", "footprint", "Resistor_SMD:R_0805"),
];

const NOT_FOUND_CASES = [
	caseItem(
		"GET missing symbol returns 404",
		"/api/library/symbols/Device:NotFound",
	),
	caseItem(
		"GET missing footprint returns 404",
		"/api/library/footprints/Package_SO:NotFound",
	),
];

const INVALID_LIMITS = [
	["non-numeric", "abc"],
	["zero", "0"],
	["negative", "-5"],
	["above 100", "101"],
	["float", "1.5"],
];

const VALIDATION_CASES = [
	caseItem("symbols missing q", "/api/library/symbols"),
	caseItem("symbols empty q", "/api/library/symbols?q="),
	caseItem("symbols whitespace q", "/api/library/symbols?q=%20%20"),
	caseItem("symbols q too long", `/api/library/symbols?q=${"a".repeat(101)}`),
	...INVALID_LIMITS.map(([desc, val]) =>
		caseItem(
			`symbols invalid limit ${desc}`,
			`/api/library/symbols?q=res&limit=${val}`,
		),
	),
	caseItem("footprints missing q", "/api/library/footprints"),
	caseItem(
		"symbol invalid libId missing colon",
		"/api/library/symbols/InvalidLibId",
	),
	caseItem(
		"footprint invalid libId missing colon",
		"/api/library/footprints/InvalidLibId",
	),
];

const libItemPath = (sub) => `/api/library/symbols/libraries/${sub}`;

const BROWSE_VALIDATION_CASES = [
	caseItem("invalid lib name traversal", libItemPath("..%2F..")),
	caseItem("invalid lib name spaces", libItemPath("a%20b")),
	caseItem("bad offset negative", libItemPath("Device?offset=-1")),
	caseItem("bad offset non-numeric", libItemPath("Device?offset=abc")),
	caseItem("limit 501 above max", libItemPath("Device?limit=501")),
];

const CORE_ENDPOINTS = [
	{ label: "symbols search", path: "/api/library/symbols?q=res" },
	{ label: "symbol get", path: "/api/library/symbols/Device:R" },
	{ label: "footprints search", path: "/api/library/footprints?q=0805" },
	{
		label: "footprint get",
		path: "/api/library/footprints/Resistor_SMD:R_0805",
	},
	{ label: "symbols libraries", path: "/api/library/symbols/libraries" },
	{
		label: "symbols library items",
		path: "/api/library/symbols/libraries/Device",
	},
];

const endpointCases = (suffix) =>
	CORE_ENDPOINTS.map(({ label, path }) => ({
		name: `${label} ${suffix}`,
		path,
	}));

const UNAVAILABLE_CASES = endpointCases("when unavailable");
const CACHE_HEADER_CASES = endpointCases("cache header");

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

const firstLibraryIs = (name) => (json) =>
	assert.equal(json.libraries[0].name, name);

const BROWSE_LIST_CASES = [
	{
		name: "GET /api/library/symbols/libraries returns 200 with libraries list",
		path: "/api/library/symbols/libraries",
		check: firstLibraryIs("Device"),
	},
	{
		name: "GET /api/library/footprints/libraries returns 200 with libraries list",
		path: "/api/library/footprints/libraries",
		check: firstLibraryIs("Resistor_SMD"),
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
	let fakeLibrary;

	const getPort = setupTestServer(() => {
		const app = createApp();
		app.locals.allowLocalRepos = true;
		fakeLibrary = createFakeLibrary();
		app.locals.kicadLibrary = fakeLibrary;
		return app;
	});

	const query = (path) =>
		requestWithAvailability(getPort(), fakeLibrary, true, path);
	const queryUnavail = (path) =>
		requestWithAvailability(getPort(), fakeLibrary, false, path);

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

	const describeSuites = (suites) => {
		for (const [title, cases, queryFn, assertFn] of suites) {
			describe(title, () => runTestCases(cases, queryFn, assertFn));
		}
	};

	describeSuites([
		["search endpoints", SEARCH_CASES, query, assertSearchMatch],
		["get endpoints", GET_CASES, query, assertGetMatch],
		["404 not found", NOT_FOUND_CASES, query, assertNotFound],
		["400 validation", VALIDATION_CASES, query, assertBadRequest],
	]);

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

	describeSuites([
		[
			"library browsing 400 validation",
			BROWSE_VALIDATION_CASES,
			query,
			assertBadRequest,
		],
		[
			"503 service unavailable",
			UNAVAILABLE_CASES,
			queryUnavail,
			assertUnavailable,
		],
		["cache headers", CACHE_HEADER_CASES, query, assertCacheHeader],
	]);

	describe("dual /x and /api/x router mounting", () => {
		const getDirectPort = setupTestServer(() => {
			const directApp = express();
			directApp.locals.kicadLibrary = createFakeLibrary();
			directApp.use(createLibraryRouter());
			return directApp;
		});

		runTestCases(
			DUAL_CASES,
			(path) => requestGet(getDirectPort(), path),
			assertDualCase,
		);
	});
});
