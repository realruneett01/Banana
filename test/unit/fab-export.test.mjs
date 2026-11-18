import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	decodeBase64ToBlob,
	downloadFiles,
	requestFabOutputs,
} from "../../frontend/src/editor/fabExport.js";

function createFakeDoc() {
	const clicks = [];
	const appended = [];
	const removed = [];
	const doc = {
		body: {
			appendChild(el) {
				appended.push(el);
			},
			removeChild(el) {
				removed.push(el);
			},
		},
		createElement(tag) {
			return {
				tagName: tag,
				click() {
					clicks.push(this);
				},
			};
		},
	};
	return { doc, clicks, appended, removed };
}

function withUrlMocks(fn) {
	const origCreate = URL.createObjectURL;
	const origRevoke = URL.revokeObjectURL;
	const created = [];
	const revoked = [];
	URL.createObjectURL = (blob) => {
		const url = `blob:fake-${created.length + 1}`;
		created.push({ url, blob });
		return url;
	};
	URL.revokeObjectURL = (url) => {
		revoked.push(url);
	};
	try {
		return fn({ created, revoked });
	} finally {
		URL.createObjectURL = origCreate;
		URL.revokeObjectURL = origRevoke;
	}
}

describe("decodeBase64ToBlob", () => {
	const cases = [
		{ name: "board.pdf", expected: "application/pdf" },
		{ name: "positions.csv", expected: "text/csv" },
		{ name: "model.step", expected: "model/step" },
		{ name: "model.stp", expected: "model/step" },
		{ name: "board.gbr", expected: "application/octet-stream" },
		{ name: "drill.drl", expected: "application/octet-stream" },
		{ name: "no-extension", expected: "application/octet-stream" },
	];

	for (const { name, expected } of cases) {
		test(`maps ${name} to ${expected}`, () => {
			const blob = decodeBase64ToBlob("aGVsbG8=", name);
			assert.equal(blob.type, expected);
		});
	}

	test("decodes base64 payload into blob text", async () => {
		const blob = decodeBase64ToBlob("aGVsbG8gd29ybGQ=", "test.csv");
		const text = await blob.text();
		assert.equal(text, "hello world");
	});
});

describe("requestFabOutputs", () => {
	test("returns files array on 200 response", async () => {
		const mockFiles = [
			{ name: "board-F_Cu.gbr", base64: "YWJj" },
			{ name: "board.drl", base64: "ZGVm" },
		];
		const fakeFetch = async (url, options) => {
			assert.match(url, /\/api\/fab\/export$/);
			assert.equal(options.method, "POST");
			const body = JSON.parse(options.body);
			assert.equal(body.pcb, "(kicad_pcb)");
			assert.equal(body.name, "demo");
			assert.deepEqual(body.outputs, ["gerbers", "drill"]);
			return {
				ok: true,
				status: 200,
				json: async () => ({ files: mockFiles, log: ["Done"] }),
			};
		};
		const files = await requestFabOutputs({
			pcbText: "(kicad_pcb)",
			name: "demo",
			outputs: ["gerbers", "drill"],
			fetchImpl: fakeFetch,
			baseUrl: "http://example.com",
		});
		assert.deepEqual(files, mockFiles);
	});

	test("throws error message from 400 response body", async () => {
		const fakeFetch = async () => ({
			ok: false,
			status: 400,
			json: async () => ({ error: "Invalid board layout" }),
		});
		await assert.rejects(
			requestFabOutputs({
				pcbText: "broken",
				name: "demo",
				outputs: ["gerbers"],
				fetchImpl: fakeFetch,
			}),
			/Invalid board layout/,
		);
	});

	test("propagates network failure", async () => {
		const fakeFetch = async () => {
			throw new TypeError("Failed to fetch");
		};
		await assert.rejects(
			requestFabOutputs({
				pcbText: "(kicad_pcb)",
				name: "demo",
				outputs: ["step"],
				fetchImpl: fakeFetch,
			}),
			/Failed to fetch/,
		);
	});
});

describe("downloadFiles", () => {
	test("creates object URL, clicks anchor per file, and revokes URL", () => {
		withUrlMocks(({ created, revoked }) => {
			const { doc, clicks, appended, removed } = createFakeDoc();
			const files = [
				{ name: "board.pdf", base64: "YWJj" },
				{ name: "model.step", base64: "ZGVm" },
			];
			downloadFiles(files, { doc });
			assert.equal(clicks.length, 2);
			assert.equal(appended.length, 2);
			assert.equal(removed.length, 2);
			assert.equal(created.length, 2);
			assert.equal(revoked.length, 2);
			assert.equal(clicks[0].download, "board.pdf");
			assert.equal(clicks[1].download, "model.step");
			assert.equal(clicks[0].href, created[0].url);
			assert.equal(clicks[1].href, created[1].url);
			assert.equal(revoked[0], created[0].url);
			assert.equal(revoked[1], created[1].url);
		});
	});

	test("handles empty or non-array files gracefully", () => {
		const { doc, clicks } = createFakeDoc();
		downloadFiles([], { doc });
		downloadFiles(null, { doc });
		assert.equal(clicks.length, 0);
	});
});

describe("EditorScreen fabrication export integration", () => {
	const editorSrc = readFileSync(
		new URL("../../frontend/src/editor/EditorScreen.jsx", import.meta.url),
		"utf8",
	);

	test("EditorScreen imports and invokes fabExport functions", () => {
		assert.match(editorSrc, /requestFabOutputs/);
		assert.match(editorSrc, /downloadFiles/);
	});

	test("PCB export dropdown contains all 5 fabrication items", () => {
		const requiredLabels = [
			"Gerbers + drill",
			"Pick and place",
			"PDF plot",
			"3D STEP",
			"Fabrication package",
		];
		for (const label of requiredLabels) {
			assert.ok(
				editorSrc.includes(label),
				`Expected EditorScreen to contain menu label "${label}"`,
			);
		}
		assert.match(editorSrc, /activeTab === "pcb"/);
	});
});
