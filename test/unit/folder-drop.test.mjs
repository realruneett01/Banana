import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDroppedFolder } from "../../frontend/src/useLocalGitRepo.js";

function createFolderDataTransfer(folderName, isDirectory = true) {
	return {
		files: [],
		items: [
			{
				webkitGetAsEntry: () => ({
					isDirectory,
					name: folderName,
				}),
			},
		],
	};
}

function createFakeFetch(status, body) {
	return async () => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	});
}

describe("resolveDroppedFolder", () => {
	it("resolves desktop path via fake banana.getPathForFile", async () => {
		const fakeFile = { name: "my-board" };
		const fakeBanana = {
			getPathForFile: (file) => `/desktop/workspace/${file.name}`,
		};
		const dataTransfer = { files: [fakeFile] };

		const result = await resolveDroppedFolder(dataTransfer, {
			banana: fakeBanana,
		});

		assert.deepEqual(result, { path: "/desktop/workspace/my-board" });
	});

	it("returns path when fake fetch returns exactly 1 match", async () => {
		let requestedUrl = "";
		const fakeFetch = async (url) => {
			requestedUrl = url;
			return {
				ok: true,
				status: 200,
				json: async () => ({ matches: ["/users/dev/projects/sample-pcb"] }),
			};
		};
		const dataTransfer = createFolderDataTransfer("sample-pcb", true);

		const result = await resolveDroppedFolder(dataTransfer, {
			banana: null,
			fetchImpl: fakeFetch,
			baseUrl: "http://localhost:5000",
		});

		assert.equal(
			requestedUrl,
			"http://localhost:5000/api/local-repos/find?name=sample-pcb",
		);
		assert.deepEqual(result, { path: "/users/dev/projects/sample-pcb" });
	});

	it("returns choices when fake fetch returns 2 matches", async () => {
		const matches = [
			"/users/dev/work/sample-pcb",
			"/users/dev/archive/sample-pcb",
		];
		const fakeFetch = createFakeFetch(200, { matches });
		const dataTransfer = createFolderDataTransfer("sample-pcb", true);

		const result = await resolveDroppedFolder(dataTransfer, {
			banana: null,
			fetchImpl: fakeFetch,
		});

		assert.deepEqual(result, { choices: matches });
	});

	it("returns error message when fake fetch returns 0 matches", async () => {
		const fakeFetch = createFakeFetch(200, { matches: [] });
		const dataTransfer = createFolderDataTransfer("unknown-repo", true);

		const result = await resolveDroppedFolder(dataTransfer, {
			banana: null,
			fetchImpl: fakeFetch,
		});

		assert.deepEqual(result, {
			error:
				"Could not find a Git repository named unknown-repo in your Desktop, Documents or Banana folders. Paste its full path in the Repository path box.",
		});
	});

	it("returns error for a non-directory drop", async () => {
		const fileDataTransfer = createFolderDataTransfer(
			"schematic.kicad_sch",
			false,
		);

		const result = await resolveDroppedFolder(fileDataTransfer, {
			banana: null,
		});

		assert.ok(result.error);
		assert.match(result.error, /drag and drop the root Git repository folder/);
	});

	it("returns error when fetch rejects with a network failure", async () => {
		const failingFetch = async () => {
			throw new Error("Network connection lost");
		};
		const dataTransfer = createFolderDataTransfer("my-repo", true);

		const result = await resolveDroppedFolder(dataTransfer, {
			banana: null,
			fetchImpl: failingFetch,
		});

		assert.deepEqual(result, { error: "Network connection lost" });
	});

	it("returns error when fetch returns non-200 HTTP status", async () => {
		const serverErrorFetch = createFakeFetch(500, { error: "Server error" });
		const dataTransfer = createFolderDataTransfer("my-repo", true);

		const result = await resolveDroppedFolder(dataTransfer, {
			banana: null,
			fetchImpl: serverErrorFetch,
		});

		assert.ok(result.error);
		assert.match(result.error, /500/);
	});
});
