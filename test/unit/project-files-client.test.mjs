import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	bytesToBase64,
	fileOpenTarget,
	importProjectFile,
	joinPath,
	listProjectFiles,
} from "../../frontend/src/projects/projectFiles.js";

function fakeFetch(status, body) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, init });
		return { status, ok: status < 300, json: async () => body };
	};
	return { impl, calls };
}

describe("project files client", () => {
	test("joinPath uses the root's separator", () => {
		assert.equal(joinPath("C:\\p\\", "a.kicad_sch"), "C:\\p\\a.kicad_sch");
		assert.equal(joinPath("/home/p", "a.kicad_pcb"), "/home/p/a.kicad_pcb");
		assert.equal(joinPath("", "a"), "");
	});

	test("fileOpenTarget opens only schematics and PCBs", () => {
		assert.deepEqual(
			fileOpenTarget("/p", { name: "a.kicad_sch", kind: "schematic" }),
			{
				projectRoot: "/p",
				filePath: "/p/a.kicad_sch",
				kind: "schematic",
			},
		);
		assert.equal(
			fileOpenTarget("/p", { name: "a.kicad_pcb", kind: "pcb" }).kind,
			"pcb",
		);
		assert.equal(
			fileOpenTarget("/p", { name: "a.kicad_sym", kind: "symbols" }),
			null,
		);
	});

	test("bytesToBase64 matches Buffer encoding", () => {
		const bytes = new Uint8Array(70000).map((_, i) => i % 256);
		assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
	});

	test("listProjectFiles queries the project root and returns files", async () => {
		const files = [{ name: "a.kicad_sch", kind: "schematic" }];
		const { impl, calls } = fakeFetch(200, { files });
		const res = await listProjectFiles("/p root", {
			baseUrl: "http://x",
			headers: { h: "1" },
			fetchImpl: impl,
		});
		assert.deepEqual(res, { ok: true, files });
		assert.equal(
			calls[0].url,
			"http://x/api/projects/files?projectRoot=%2Fp%20root",
		);
		assert.deepEqual(calls[0].init.headers, { h: "1" });
	});

	test("listProjectFiles reports the server error", async () => {
		const { impl } = fakeFetch(400, { error: "Project folder not found" });
		const res = await listProjectFiles("/p", {
			baseUrl: "",
			headers: {},
			fetchImpl: impl,
		});
		assert.deepEqual(res, { ok: false, error: "Project folder not found" });
	});

	test("importProjectFile posts name and base64 content", async () => {
		const { impl, calls } = fakeFetch(201, { ok: true, name: "b.kicad_pcb" });
		const file = {
			name: "b.kicad_pcb",
			arrayBuffer: async () => new TextEncoder().encode("(kicad_pcb)").buffer,
		};
		const res = await importProjectFile("/p", file, {
			baseUrl: "",
			headers: {},
			fetchImpl: impl,
		});
		assert.deepEqual(res, { ok: true });
		assert.equal(calls[0].url, "/api/projects/import");
		assert.equal(calls[0].init.method, "POST");
		const body = JSON.parse(calls[0].init.body);
		assert.deepEqual(body, {
			projectRoot: "/p",
			name: "b.kicad_pcb",
			contentBase64: Buffer.from("(kicad_pcb)").toString("base64"),
		});
	});

	test("importProjectFile reports a conflict", async () => {
		const { impl } = fakeFetch(409, { error: "File already exists" });
		const file = {
			name: "b.kicad_pcb",
			arrayBuffer: async () => new ArrayBuffer(1),
		};
		const res = await importProjectFile("/p", file, {
			baseUrl: "",
			headers: {},
			fetchImpl: impl,
		});
		assert.deepEqual(res, { ok: false, error: "File already exists" });
	});

	test("network failures become errors", async () => {
		const fetchImpl = async () => {
			throw new Error("offline");
		};
		const res = await listProjectFiles("/p", {
			baseUrl: "",
			headers: {},
			fetchImpl,
		});
		assert.deepEqual(res, { ok: false, error: "offline" });
	});
});
