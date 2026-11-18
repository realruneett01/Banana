import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

function extractModuleChunk(filePath, startMarker, endMarker, preamble = "") {
	const src = readFileSync(new URL(filePath, import.meta.url), "utf8");
	const start = src.indexOf(startMarker);
	const end = src.indexOf(endMarker);
	const chunk = `${preamble}\n${src.slice(start, end)}`;
	const base64 = Buffer.from(chunk, "utf8").toString("base64");
	return import(`data:text/javascript;base64,${base64}`);
}

const holoMod = await extractModuleChunk(
	"../../frontend/src/components/holo/HoloViewer.jsx",
	"// --- HOLO VIEWER PURE HELPERS START ---",
	"// --- HOLO VIEWER PURE HELPERS END ---",
);

const studioMod = await extractModuleChunk(
	"../../frontend/src/components/sim3d/SimulationStudio.jsx",
	"// --- SIMULATION STUDIO PURE HELPERS START ---",
	"// --- SIMULATION STUDIO PURE HELPERS END ---",
	'const API_BASE_URL = "http://localhost:5000";',
);

const { buildGlbRequestBody } = holoMod;
const {
	STUDIO_VIEW_MODES,
	VIEW_MODES,
	extractPcbTextFromFiles,
	fetchCurrentPcbText,
} = studioMod;

describe("buildGlbRequestBody source kinds", () => {
	const gitCases = [
		{
			desc: "maps git source with commit",
			source: {
				repoPath: "/repos/banana",
				owner: "test-owner",
				repo: "test-repo",
				relativeFilePath: "board.kicad_pcb",
				githubToken: "gh_secret",
			},
			commit: "abc1234",
			expected: {
				repoPath: "/repos/banana",
				owner: "test-owner",
				repo: "test-repo",
				commit: "abc1234",
				relativeFilePath: "board.kicad_pcb",
				filePath: "board.kicad_pcb",
			},
		},
		{
			desc: "handles empty git source",
			source: {},
			commit: "head",
			expected: {
				repoPath: undefined,
				owner: undefined,
				repo: undefined,
				commit: "head",
				relativeFilePath: undefined,
				filePath: undefined,
			},
		},
	];

	for (const tc of gitCases) {
		test(tc.desc, () => {
			assert.deepEqual(buildGlbRequestBody(tc.source, tc.commit), tc.expected);
		});
	}

	const pcbCases = [
		{
			desc: "pcbText source kind returns { pcb } and ignores commit",
			source: { pcbText: "(kicad_pcb (version 20240108))" },
			commit: "commit-hash",
			expected: { pcb: "(kicad_pcb (version 20240108))" },
		},
		{
			desc: "pcbText source kind preserves empty string pcbText",
			source: { pcbText: "" },
			commit: null,
			expected: { pcb: "" },
		},
	];

	for (const tc of pcbCases) {
		test(tc.desc, () => {
			assert.deepEqual(buildGlbRequestBody(tc.source, tc.commit), tc.expected);
		});
	}
});

describe("SimulationStudio view modes", () => {
	test("mode list includes holo mode", () => {
		assert.ok(VIEW_MODES.includes("holo"));
		assert.deepEqual(VIEW_MODES, ["3d", "2d", "holo"]);
	});

	test("STUDIO_VIEW_MODES defines holo with label and tooltip", () => {
		const holo = STUDIO_VIEW_MODES.find((m) => m.mode === "holo");
		assert.ok(holo);
		assert.equal(holo.label, "HOLO");
		assert.equal(holo.tooltip, "3D hologram of the current board");
	});
});

describe("extractPcbTextFromFiles", () => {
	const extractionCases = [
		{
			desc: "extracts .kicad_pcb from file map",
			files: {
				"board.kicad_sch": "(kicad_sch)",
				"board.kicad_pcb": "(kicad_pcb content)",
			},
			expected: "(kicad_pcb content)",
		},
		{
			desc: "returns null when no .kicad_pcb is present",
			files: { "board.kicad_sch": "(kicad_sch)" },
			expected: null,
		},
		{
			desc: "returns null for non-object files",
			files: null,
			expected: null,
		},
	];

	for (const tc of extractionCases) {
		test(tc.desc, () => {
			assert.equal(extractPcbTextFromFiles(tc.files), tc.expected);
		});
	}
});

describe("fetchCurrentPcbText", () => {
	test("exports PCB text via api.editorExport", async () => {
		const mockApi = {
			editorExport: async ({ title }) => ({
				ok: true,
				data: {
					files: {
						[`${title || "board"}.kicad_pcb`]: "(kicad_pcb (version 20240108))",
					},
				},
			}),
		};
		const result = await fetchCurrentPcbText({
			api: mockApi,
			ir: { name: "my_board" },
			board: {},
		});
		assert.equal(result, "(kicad_pcb (version 20240108))");
	});

	test("throws when api.editorExport fails", async () => {
		const mockApi = {
			editorExport: async () => ({
				ok: false,
				error: "Backend export error",
			}),
		};
		await assert.rejects(
			fetchCurrentPcbText({ api: mockApi, ir: {}, board: {} }),
			/Backend export error/,
		);
	});

	test("falls back to fetch when api is missing", async () => {
		const fakeFetch = async (url, options) => {
			assert.ok(url.endsWith("/api/editor/export"));
			assert.equal(options.method, "POST");
			return {
				ok: true,
				json: async () => ({
					files: { "board.kicad_pcb": "(kicad_pcb from fetch)" },
				}),
			};
		};
		const result = await fetchCurrentPcbText({
			ir: { name: "test" },
			board: {},
			fetchImpl: fakeFetch,
			baseUrl: "http://localhost:5000",
		});
		assert.equal(result, "(kicad_pcb from fetch)");
	});
});

describe("HoloViewer and SimulationStudio static conventions", () => {
	const holoSrc = readFileSync(
		new URL(
			"../../frontend/src/components/holo/HoloViewer.jsx",
			import.meta.url,
		),
		"utf8",
	);
	const studioSrc = readFileSync(
		new URL(
			"../../frontend/src/components/sim3d/SimulationStudio.jsx",
			import.meta.url,
		),
		"utf8",
	);

	test("HoloCommitSelector hides when pcbText is present", () => {
		assert.match(
			holoSrc,
			/if\s*\(!source\s*\|\|\s*source\.pcbText\s*!=\s*null\)\s*return null;/,
		);
	});

	test("HoloViewer debounces pcbText with 800 ms", () => {
		assert.match(holoSrc, /useDebounce\(source\?\.pcbText,\s*800\)/);
	});

	test("SimulationStudio lazy-loads HoloViewer with Suspense", () => {
		assert.match(
			studioSrc,
			/lazy\(\(\)\s*=>\s*import\("\.\.\/holo\/HoloViewer\.jsx"\)\)/,
		);
		assert.match(studioSrc, /<Suspense fallback={<Spin \/>}>/);
	});
});
