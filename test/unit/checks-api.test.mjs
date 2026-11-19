import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	API_BASE_URL,
	countViolations,
	groupViolations,
	runDrc,
	runErc,
} from "../../frontend/src/editor/checksApi.js";

function mockFetchResponse({
	path,
	expectedPayload,
	resultData,
	status = 200,
	errorText,
}) {
	return async (url, opts) => {
		if (path) {
			assert(url.endsWith(path), `Expected url to end with ${path}`);
		}
		if (opts?.body && expectedPayload) {
			assert.deepEqual(JSON.parse(opts.body), expectedPayload);
		}
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => (errorText ? { error: errorText } : resultData),
		};
	};
}

const RUNNER_CASES = [
	{
		label: "runDrc",
		runFn: runDrc,
		path: "/api/checks/drc",
		inputKey: "pcbText",
		inputVal: "(kicad_pcb)",
		extraBody: { pcb: "(kicad_pcb)", unconnected: true },
	},
	{
		label: "runErc",
		runFn: runErc,
		path: "/api/checks/erc",
		inputKey: "schText",
		inputVal: "(kicad_sch)",
		extraBody: { sch: "(kicad_sch)" },
	},
];

for (const {
	label,
	runFn,
	path,
	inputKey,
	inputVal,
	extraBody,
} of RUNNER_CASES) {
	describe(label, () => {
		const mockData = {
			violations: [
				{
					severity: "warning",
					type: "generic_check",
					description: "Sample violation",
					items: [{ description: "Target pin", pos: { x: 5, y: 15 } }],
				},
			],
			counts: { error: 0, warning: 1 },
		};

		test("returns result on 200 response with correct payload", async () => {
			const fakeFetch = mockFetchResponse({
				path,
				expectedPayload: { name: "test-run", ...extraBody },
				resultData: mockData,
			});
			const res = await runFn({
				[inputKey]: inputVal,
				name: "test-run",
				fetchImpl: fakeFetch,
				baseUrl: "http://localhost:5000",
			});
			assert.deepEqual(res, mockData);
		});

		test("throws error message from 400 response body", async () => {
			const fakeFetch = mockFetchResponse({
				status: 400,
				errorText: "Validation rejected",
			});
			await assert.rejects(
				runFn({
					[inputKey]: "invalid_data",
					name: "test-run",
					fetchImpl: fakeFetch,
				}),
				/Validation rejected/,
			);
		});

		test("propagates network failure", async () => {
			const fakeFetch = async () => {
				throw new Error("Network request failed");
			};
			await assert.rejects(
				runFn({
					[inputKey]: inputVal,
					name: "test-run",
					fetchImpl: fakeFetch,
				}),
				/Network request failed/,
			);
		});
	});
}

describe("runDrc additional checks", () => {
	test("throws fallback status error on 500 response without error body", async () => {
		const fakeFetch = mockFetchResponse({ status: 500, resultData: {} });
		await assert.rejects(
			runDrc({
				pcbText: "broken",
				name: "test-board",
				fetchImpl: fakeFetch,
			}),
			/status 500/,
		);
	});
});

describe("countViolations", () => {
	test("returns zero counts for non-array inputs", () => {
		for (const input of [null, undefined, []]) {
			assert.deepEqual(countViolations(input), { error: 0, warning: 0 });
		}
	});

	test("counts error and warning violations correctly", () => {
		const violations = [
			{ severity: "error", type: "clearance" },
			{ severity: "warning", type: "unconnected" },
			{ severity: "error", type: "short" },
		];
		assert.deepEqual(countViolations(violations), { error: 2, warning: 1 });
	});
});

describe("groupViolations", () => {
	test("returns empty array for non-array or empty inputs", () => {
		for (const input of [null, undefined, []]) {
			assert.deepEqual(groupViolations(input), []);
		}
	});

	test("sorts errors first before warnings", () => {
		const violations = [
			{ severity: "warning", type: "unconnected", description: "Unconnected" },
			{ severity: "error", type: "clearance", description: "Clearance error" },
		];
		const groups = groupViolations(violations);
		assert.deepEqual(
			groups.map((g) => g.severity),
			["error", "warning"],
		);
		assert.deepEqual(countViolations(violations), { error: 1, warning: 1 });
	});

	test("groups by type within each severity with accurate counts", () => {
		const violations = [
			{ severity: "error", type: "clearance", description: "Clearance 1" },
			{ severity: "error", type: "clearance", description: "Clearance 2" },
			{ severity: "error", type: "short", description: "Short 1" },
			{ severity: "warning", type: "track_width", description: "Narrow track" },
		];
		const [errGroup, warnGroup] = groupViolations(violations);
		assert.equal(errGroup.severity, "error");
		assert.equal(errGroup.count, 3);
		assert.equal(errGroup.types.length, 2);

		const typeCounts = Object.fromEntries(
			errGroup.types.map((t) => [t.type, t.count]),
		);
		assert.deepEqual(typeCounts, { clearance: 2, short: 1 });

		assert.equal(warnGroup.severity, "warning");
		assert.equal(warnGroup.count, 1);
		assert.equal(warnGroup.types[0].type, "track_width");
	});

	test("preserves item details and positions", () => {
		const expectedPos = { x: 12.5, y: 34.0 };
		const violations = [
			{
				severity: "error",
				type: "clearance",
				description: "Gap too small",
				items: [
					{ description: "Pad 1 of R1", pos: expectedPos },
					{ description: "Track net 2", pos: { x: 12.8, y: 34.2 } },
				],
			},
		];
		const groups = groupViolations(violations);
		const v = groups[0].types[0].violations[0];
		assert.equal(v.items.length, 2);
		assert.deepEqual(v.items[0].pos, expectedPos);
	});
});

describe("ChecksPanel integration inspection", () => {
	test("ChecksPanel component contains required elements and exports", () => {
		const filePath = new URL(
			"../../frontend/src/editor/ChecksPanel.jsx",
			import.meta.url,
		);
		const content = readFileSync(filePath, "utf8");
		assert(content.includes("export default function ChecksPanel"));
		assert(content.includes("No problems found"));
		for (const key of ["result", "loading", "onRun", "onFocus", "kind"]) {
			assert(content.includes(key));
		}
	});

	test("API_BASE_URL is a valid HTTP URL string", () => {
		assert.equal(typeof API_BASE_URL, "string");
		assert.equal(API_BASE_URL.startsWith("http"), true);
	});
});
