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
			appendChild: (el) => appended.push(el),
			removeChild: (el) => removed.push(el),
		},
		createElement: (tagName) => ({
			tagName,
			click() {
				clicks.push(this);
			},
		}),
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

function assertDownloadLifecycle(
	{ clicks, appended, removed },
	{ created, revoked },
	files,
) {
	const counts = [clicks, appended, removed, created, revoked].map(
		(list) => list.length,
	);
	assert.deepEqual(counts, Array(5).fill(files.length));
	files.forEach((file, idx) => {
		assert.equal(clicks[idx].download, file.name);
		assert.equal(clicks[idx].href, created[idx].url);
		assert.equal(revoked[idx], created[idx].url);
	});
}

function createFakeFetch({
	status = 200,
	json = null,
	error = null,
	onRequest,
} = {}) {
	return async (url, options) => {
		onRequest?.(url, options);
		if (error) {
			throw error;
		}
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => json,
		};
	};
}

function executeFabRequest(fetchImpl, payload = {}) {
	return requestFabOutputs({
		pcbText: "(kicad_pcb)",
		name: "demo",
		outputs: ["gerbers", "drill"],
		fetchImpl,
		...payload,
	});
}

async function assertFabRejection(
	fetchConfig,
	requestOverrides,
	expectedPattern,
) {
	const fakeFetch = createFakeFetch(fetchConfig);
	await assert.rejects(
		executeFabRequest(fakeFetch, requestOverrides),
		expectedPattern,
	);
}

function makeSampleOutputs(first = "board.pdf", second = "model.step") {
	return [
		{ name: first, base64: "YWJj" },
		{ name: second, base64: "ZGVm" },
	];
}

function loadEditorSource() {
	return readFileSync(
		new URL("../../frontend/src/editor/EditorScreen.jsx", import.meta.url),
		"utf8",
	);
}

const EXT_TO_MIME = {
	"board.pdf": "application/pdf",
	"positions.csv": "text/csv",
	"model.step": "model/step",
	"model.stp": "model/step",
	"board.gbr": "application/octet-stream",
	"drill.drl": "application/octet-stream",
	"no-extension": "application/octet-stream",
};

describe("decodeBase64ToBlob", () => {
	for (const [name, expected] of Object.entries(EXT_TO_MIME)) {
		test(`maps ${name} to ${expected}`, () => {
			assert.equal(decodeBase64ToBlob("aGVsbG8=", name).type, expected);
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
		const mockFiles = makeSampleOutputs("board-F_Cu.gbr", "board.drl");
		const fakeFetch = createFakeFetch({
			json: { files: mockFiles, log: ["Done"] },
			onRequest(url, options) {
				assert.match(url, /\/api\/fab\/export$/);
				assert.equal(options.method, "POST");
				const body = JSON.parse(options.body);
				assert.equal(body.pcb, "(kicad_pcb)");
				assert.equal(body.name, "demo");
				assert.deepEqual(body.outputs, ["gerbers", "drill"]);
			},
		});
		const files = await executeFabRequest(fakeFetch, {
			baseUrl: "http://example.com",
		});
		assert.deepEqual(files, mockFiles);
	});

	test("throws error message from 400 response body", async () => {
		await assertFabRejection(
			{ status: 400, json: { error: "Invalid board layout" } },
			{ pcbText: "broken", outputs: ["gerbers"] },
			/Invalid board layout/,
		);
	});

	test("propagates network failure", async () => {
		await assertFabRejection(
			{ error: new TypeError("Failed to fetch") },
			{ outputs: ["step"] },
			/Failed to fetch/,
		);
	});
});

describe("downloadFiles", () => {
	test("creates object URL, clicks anchor per file, and revokes URL", () => {
		withUrlMocks((urlTracker) => {
			const ui = createFakeDoc();
			const files = makeSampleOutputs();
			downloadFiles(files, { doc: ui.doc });
			assertDownloadLifecycle(ui, urlTracker, files);
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
	test("EditorScreen imports and invokes fabExport functions", () => {
		const editorSrc = loadEditorSource();
		assert.match(editorSrc, /requestFabOutputs/);
		assert.match(editorSrc, /downloadFiles/);
	});

	test("PCB export dropdown contains all 5 fabrication items", () => {
		const editorSrc = loadEditorSource();
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
