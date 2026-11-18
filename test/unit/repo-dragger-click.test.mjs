import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const controlsUrl = new URL(
	"../../frontend/src/components/LocalRepoControls.jsx",
	import.meta.url,
);
const controlsSrc = readFileSync(controlsUrl, "utf8");
const useLocalGitRepoUrl = new URL(
	"../../frontend/src/useLocalGitRepo.js",
	import.meta.url,
).href;

async function loadDraggerHelpers() {
	try {
		return await import(controlsUrl.href);
	} catch {
		const startMarker = "// --- Pure folder dragger helpers ---";
		const endMarker = "// --- End pure folder dragger helpers ---";
		const start = controlsSrc.indexOf(startMarker);
		const end = controlsSrc.indexOf(endMarker);
		const chunk = controlsSrc.slice(start, end);
		const prepended = `
import { resolveDroppedFolder } from "${useLocalGitRepoUrl}";
const message = { warning: () => {}, error: () => {}, success: () => {}, info: () => {} };
const showRepoChoicesModal = () => {};
${chunk}
`;
		return await import(
			`data:text/javascript;base64,${Buffer.from(prepended).toString("base64")}`
		);
	}
}

const {
	pickFolderStrategy,
	createFolderDataTransfer,
	resolveFolderName,
	applyRepoPath,
	applyPickerResult,
	openDirectoryPicker,
	browseFolderForRepo,
} = await loadDraggerHelpers();

function createFakeFetch(status, body) {
	return async () => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	});
}

function createMockForm() {
	const values = {};
	return {
		values,
		setFieldValue: (k, v) => {
			values[k] = v;
		},
	};
}

function createPickerContext() {
	const form = createMockForm();
	const paths = [];
	const infoLoads = [];
	return {
		form,
		paths,
		infoLoads,
		setRepoPath: (p) => paths.push(p),
		loadRepoInfo: (p, silent) => infoLoads.push({ p, silent }),
	};
}

describe("pickFolderStrategy", () => {
	const STRATEGY_CASES = [
		[{ banana: { selectFolder: () => {} } }, "desktop"],
		[
			{
				banana: { selectFolder: () => {} },
				showDirectoryPicker: () => {},
			},
			"desktop",
		],
		[{ showDirectoryPicker: () => {} }, "directory-picker"],
		[{ banana: null, showDirectoryPicker: () => {} }, "directory-picker"],
		[{ banana: null, showDirectoryPicker: null }, "upload-input"],
		[{ banana: {} }, "upload-input"],
		[{}, "upload-input"],
		[undefined, "upload-input"],
	];

	for (const [input, expected] of STRATEGY_CASES) {
		const label = JSON.stringify(input) || "undefined";
		it(`resolves strategy for input ${label}`, () => {
			assert.equal(pickFolderStrategy(input), expected);
		});
	}
});

describe("createFolderDataTransfer", () => {
	it("creates a webkitGetAsEntry compatible dataTransfer shape", () => {
		const transfer = createFolderDataTransfer("my-repo");
		assert.deepEqual(transfer.files, []);
		const entry = transfer.items[0].webkitGetAsEntry();
		assert.equal(entry.isDirectory, true);
		assert.equal(entry.name, "my-repo");
	});
});

describe("resolveFolderName", () => {
	it("returns path when lookup returns exactly 1 match", async () => {
		const fakeFetch = createFakeFetch(200, {
			matches: ["/repos/sample-pcb"],
		});
		const result = await resolveFolderName("sample-pcb", {
			banana: null,
			fetchImpl: fakeFetch,
			baseUrl: "http://localhost:5000",
		});
		assert.deepEqual(result, { path: "/repos/sample-pcb" });
	});

	it("returns choices when lookup returns 2 matches", async () => {
		const matches = ["/repos/work/sample-pcb", "/repos/archive/sample-pcb"];
		const fakeFetch = createFakeFetch(200, { matches });
		const result = await resolveFolderName("sample-pcb", {
			banana: null,
			fetchImpl: fakeFetch,
		});
		assert.deepEqual(result, { choices: matches });
	});

	it("returns error message when lookup returns 0 matches", async () => {
		const fakeFetch = createFakeFetch(200, { matches: [] });
		const result = await resolveFolderName("unknown-repo", {
			banana: null,
			fetchImpl: fakeFetch,
		});
		assert.match(result.error, /Could not find a Git repository/);
	});
});

describe("name-to-path flow (openDirectoryPicker)", () => {
	it("handles 1 match by applying path and loading repo info", async () => {
		const ctx = createPickerContext();
		const fakePicker = async () => ({ name: "sample-pcb" });
		const fakeResolve = async (name) => ({ path: `/disk/${name}` });

		const result = await openDirectoryPicker({
			showDirectoryPicker: fakePicker,
			resolveName: fakeResolve,
			form: ctx.form,
			setRepoPath: ctx.setRepoPath,
			loadRepoInfo: ctx.loadRepoInfo,
		});

		assert.deepEqual(result, { path: "/disk/sample-pcb" });
		assert.equal(ctx.form.values.repoPath, "/disk/sample-pcb");
		assert.deepEqual(ctx.paths, ["/disk/sample-pcb"]);
		assert.deepEqual(ctx.infoLoads, [{ p: "/disk/sample-pcb", silent: false }]);
	});

	it("handles 2 matches by invoking onChoices callback", async () => {
		const ctx = createPickerContext();
		const fakePicker = async () => ({ name: "sample-pcb" });
		const choices = ["/a/sample-pcb", "/b/sample-pcb"];
		const fakeResolve = async () => ({ choices });
		let receivedChoices = null;

		const result = await openDirectoryPicker({
			showDirectoryPicker: fakePicker,
			resolveName: fakeResolve,
			form: ctx.form,
			setRepoPath: ctx.setRepoPath,
			loadRepoInfo: ctx.loadRepoInfo,
			onChoices: (c) => {
				receivedChoices = c;
			},
		});

		assert.deepEqual(result, { choices });
		assert.deepEqual(receivedChoices, choices);
		assert.equal(ctx.paths.length, 0);
	});

	it("handles 0 matches by invoking onError callback", async () => {
		const ctx = createPickerContext();
		const fakePicker = async () => ({ name: "missing-repo" });
		const fakeResolve = async () => ({ error: "Not found" });
		let receivedError = null;

		const result = await openDirectoryPicker({
			showDirectoryPicker: fakePicker,
			resolveName: fakeResolve,
			form: ctx.form,
			setRepoPath: ctx.setRepoPath,
			loadRepoInfo: ctx.loadRepoInfo,
			onError: (err) => {
				receivedError = err;
			},
		});

		assert.deepEqual(result, { error: "Not found" });
		assert.equal(receivedError, "Not found");
		assert.equal(ctx.paths.length, 0);
	});

	it("handles AbortError by returning null and doing nothing", async () => {
		const ctx = createPickerContext();
		const fakePicker = async () => {
			const err = new Error("User canceled");
			err.name = "AbortError";
			throw err;
		};
		let calledOnError = false;

		const result = await openDirectoryPicker({
			showDirectoryPicker: fakePicker,
			resolveName: async () => ({ path: "/unused" }),
			form: ctx.form,
			setRepoPath: ctx.setRepoPath,
			loadRepoInfo: ctx.loadRepoInfo,
			onError: () => {
				calledOnError = true;
			},
		});

		assert.equal(result, null);
		assert.equal(calledOnError, false);
		assert.equal(ctx.paths.length, 0);
	});
});

describe("applyRepoPath and applyPickerResult", () => {
	it("applies path to setRepoPath, form and loadRepoInfo", () => {
		const ctx = createPickerContext();
		applyRepoPath("/target/path", ctx.form, ctx.setRepoPath, ctx.loadRepoInfo);
		assert.equal(ctx.form.values.repoPath, "/target/path");
		assert.deepEqual(ctx.paths, ["/target/path"]);
		assert.deepEqual(ctx.infoLoads, [{ p: "/target/path", silent: false }]);
	});

	it("routes choices to onChoices handler", () => {
		let choicesSeen = null;
		applyPickerResult(
			{ choices: ["/one", "/two"] },
			{
				onChoices: (c) => {
					choicesSeen = c;
				},
			},
		);
		assert.deepEqual(choicesSeen, ["/one", "/two"]);
	});

	it("routes error to onError handler", () => {
		let errorSeen = null;
		applyPickerResult(
			{ error: "Folder lookup failed" },
			{
				onError: (err) => {
					errorSeen = err;
				},
			},
		);
		assert.equal(errorSeen, "Folder lookup failed");
	});
});

describe("browseFolderForRepo", () => {
	it("loads repo info when window.banana.selectFolder returns path", async () => {
		const ctx = createPickerContext();
		globalThis.window = {
			banana: {
				selectFolder: async () => "/native/folder/pcb",
			},
		};
		await browseFolderForRepo(ctx.setRepoPath, ctx.form, ctx.loadRepoInfo);
		assert.equal(ctx.form.values.repoPath, "/native/folder/pcb");
		assert.deepEqual(ctx.paths, ["/native/folder/pcb"]);
	});

	it("does nothing when window.banana.selectFolder returns null", async () => {
		const ctx = createPickerContext();
		globalThis.window = {
			banana: {
				selectFolder: async () => null,
			},
		};
		await browseFolderForRepo(ctx.setRepoPath, ctx.form, ctx.loadRepoInfo);
		assert.equal(ctx.paths.length, 0);
	});
});
