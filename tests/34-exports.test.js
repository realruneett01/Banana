// Fabrication and documentation exports: KiCad's own output, checked against the design.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { after, before, test } from "node:test";
import { hasKicad, tmpDir } from "./helpers.js";

const projects = tmpDir("banana-export-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const P = await import("../backend/src/design/project.js");
const X = await import("../backend/src/design/exports.js");
const { callTool } = await import("../backend/src/mcp/tools.js");
const { createApp } = await import("../backend/src/server.js");

const libs = findLibraryRoot("symbols") && findLibraryRoot("footprints");
const skip = !hasKicad()
	? "kicad-cli not installed"
	: libs
		? false
		: "KiCad libraries not installed";
const R = "Resistor_SMD:R_0805_2012Metric";
const HDR = "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical";
after(() => fs.rmSync(projects, { recursive: true, force: true }));

/** Independent ZIP reader: central directory, inflate, CRC check. */
function readZip(buf) {
	let eocd = buf.length - 22;
	while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
	assert.ok(eocd >= 0, "end of central directory");
	const count = buf.readUInt16LE(eocd + 10);
	let off = buf.readUInt32LE(eocd + 16);
	const out = new Map();
	for (let i = 0; i < count; i++) {
		assert.equal(buf.readUInt32LE(off), 0x02014b50);
		const method = buf.readUInt16LE(off + 10);
		const crc = buf.readUInt32LE(off + 16);
		const csize = buf.readUInt32LE(off + 20);
		const usize = buf.readUInt32LE(off + 24);
		const nlen = buf.readUInt16LE(off + 28);
		const xlen = buf.readUInt16LE(off + 30);
		const clen = buf.readUInt16LE(off + 32);
		const lho = buf.readUInt32LE(off + 42);
		const name = buf.subarray(off + 46, off + 46 + nlen).toString("utf8");
		assert.equal(buf.readUInt32LE(lho), 0x04034b50);
		const dataStart =
			lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
		const raw = buf.subarray(dataStart, dataStart + csize);
		const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
		assert.equal(data.length, usize, `${name} size`);
		assert.equal(X.crc32(data), crc, `${name} crc`);
		out.set(name, data);
		off += 46 + nlen + xlen + clen;
	}
	return out;
}

test("crc32 matches the standard check value", () =>
	assert.equal(X.crc32(Buffer.from("123456789")), 0xcbf43926));

test("zip writer: files round-trip through an independent reader", async (t) => {
	const cases = {
		"empty archive": [],
		"one empty file": [{ name: "a.txt", data: Buffer.alloc(0) }],
		"text and binary": [
			{ name: "t.txt", data: Buffer.from("hello ".repeat(1000)) },
			{
				name: "b.bin",
				data: Buffer.from(
					Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256),
				),
			},
			{ name: "uni-é.txt", data: Buffer.from("ünïcode") },
		],
	};
	for (const [label, entries] of Object.entries(cases))
		await t.test(label, () => {
			const zip = readZip(X.createZip(entries));
			assert.equal(zip.size, entries.length);
			for (const e of entries) assert.deepEqual(zip.get(e.name), e.data);
		});
	await t.test("identical input gives an identical archive", () => {
		const e = [{ name: "x", data: Buffer.from("same") }];
		assert.deepEqual(X.createZip(e), X.createZip(e));
	});
});

test("bom groups identical parts and keeps references in natural order", {
	skip,
}, async () => {
	await P.createProject("bomtest");
	const d = P.loadDesign("bomtest");
	for (let i = 0; i < 11; i++)
		d.addPart({
			symbol: "Device:R",
			value: i < 10 ? "10k" : "1k",
			footprint: R,
		});
	d.addPart({
		symbol: "Connector_Generic:Conn_01x03",
		value: "J, with comma",
		footprint: HDR,
	});
	const rows = X.bomRows(d);
	assert.deepEqual(
		rows.map((r) => r.refs.length),
		[1, 10, 1],
	);
	assert.equal(rows[1].refs[9], "R10");
	assert.equal(rows[1].refs[1], "R2");
	const csv = X.bomCsv(d);
	assert.match(
		csv,
		/^Reference,Quantity,Value,Footprint,Symbol\nJ1,1,"J, with comma"/,
	);
	assert.match(csv, /"J, with comma"/, "commas are quoted");
});

let server;
let base;
before(async () => {
	if (skip) return;
	await new Promise((r) => {
		server = createApp().listen(0, "127.0.0.1", r);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test("every export on a routed board", { skip, timeout: 600000 }, async (t) => {
	await P.createProject("fab");
	const d = P.loadDesign("fab");
	d.addPart({
		symbol: "Connector_Generic:Conn_01x03",
		value: "J",
		footprint: HDR,
	});
	for (let i = 0; i < 3; i++)
		d.addPart({ symbol: "Device:R", value: i ? "2k" : "1k", footprint: R });
	d.connect("A", ["J1.1", "R1.1"]);
	d.connect("B", ["R1.2", "R2.1", "J1.2"]);
	d.connect("C", ["R2.2", "R3.1", "J1.3"]);
	d.connect("D", ["R3.2"]);
	P.saveDesign("fab", d);
	await P.autoRoute("fab");
	await P.build("fab", "routed");
	const state = await P.projectState("fab");

	await t.test("capabilities list what this KiCad offers", async () => {
		const r = await (await fetch(`${base}/api/design/exports`)).json();
		for (const k of ["gerbers", "bom", "pos", "netlist", "pdf", "step"])
			assert.equal(typeof r.kinds[k].available, "boolean", k);
		assert.equal(r.kinds.bom.available, true);
	});

	await t.test(
		"gerbers: a fabrication zip with the right layers and the drill file",
		async () => {
			const r = await X.runExport("fab", "gerbers");
			assert.equal(r.download, "fab-fabrication.zip");
			const zip = readZip(fs.readFileSync(path.join(r.directory, r.download)));
			const names = [...zip.keys()];
			for (const ext of [
				"gtl",
				"gbl",
				"gto",
				"gbo",
				"gts",
				"gbs",
				"gtp",
				"gbp",
				"gm1",
				"drl",
			])
				assert.ok(
					names.some((n) => n.endsWith(`.${ext}`)),
					`has .${ext}: ${names.join(", ")}`,
				);
			assert.ok(
				!names.some((n) => /User_|Margin|Fab|Courtyard/.test(n)),
				"only fabrication layers",
			);
			const top = zip.get(names.find((n) => n.endsWith(".gtl"))).toString();
			assert.match(top, /%FSLAX\d\d Y\d\d\*%/.test(top) ? /%FSLAX/ : /%FSLAX/);
			assert.match(top, /TF\.FileFunction,Copper,L1,Top/);
			assert.match(top, /M02\*/, "complete gerber file");
			assert.ok(/G01\*|D02\*|D03\*/.test(top), "has drawing commands");
			const drill = zip.get(names.find((n) => n.endsWith(".drl"))).toString();
			assert.match(drill, /M48/);
			assert.match(
				drill,
				/T\d+C1\.000/,
				"the 1.0 mm header holes are in the drill file",
			);
			assert.equal(
				(drill.match(/^X-?[\d.]+Y-?[\d.]+$/gm) ?? []).length,
				3,
				"three header holes",
			);
		},
	);

	await t.test("outline gerber spans exactly the board", async () => {
		const zip = readZip(
			fs.readFileSync(
				path.join(
					projects,
					"fab",
					"results",
					"exports",
					"gerbers",
					"fab-fabrication.zip",
				),
			),
		);
		const edge = zip
			.get([...zip.keys()].find((n) => n.endsWith(".gm1")))
			.toString();
		const fmt = /%FSLAX(\d)(\d)Y/.exec(edge);
		const div = 10 ** Number(fmt[2]);
		const xs = [...edge.matchAll(/X(-?\d+)Y(-?\d+)D0[123]/g)].map((m) => [
			Number(m[1]) / div,
			Number(m[2]) / div,
		]);
		assert.ok(xs.length >= 4);
		const w =
			Math.max(...xs.map((p) => p[0])) - Math.min(...xs.map((p) => p[0]));
		const h =
			Math.max(...xs.map((p) => p[1])) - Math.min(...xs.map((p) => p[1]));
		assert.ok(
			Math.abs(w - state.board.width) < 0.01 &&
				Math.abs(h - state.board.height) < 0.01,
			`outline ${w}x${h} vs board ${state.board.width}x${state.board.height}`,
		);
	});

	await t.test(
		"pick and place lists every part where the design put it",
		async () => {
			const r = await X.runExport("fab", "pos");
			const rows = fs
				.readFileSync(path.join(r.directory, r.download), "utf8")
				.trim()
				.split("\n")
				.slice(1)
				.map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
			assert.equal(rows.length, 4);
			for (const part of state.parts) {
				const row = rows.find((c) => c[0] === part.ref);
				assert.ok(row, part.ref);
				assert.ok(
					Math.abs(Number(row[3]) - part.at.x) < 0.001,
					`${part.ref} x`,
				);
				assert.ok(
					Math.abs(Math.abs(Number(row[4])) - part.at.y) < 0.001,
					`${part.ref} y`,
				);
				assert.equal(row[6], "top");
			}
		},
	);

	await t.test("bom, netlist, pdf, step", async () => {
		const bom = await X.runExport("fab", "bom");
		assert.match(
			fs.readFileSync(path.join(bom.directory, bom.download), "utf8"),
			/R1 R3|R2 R3|"R2 R3"/,
		);
		const net = await X.runExport("fab", "netlist");
		assert.match(
			fs.readFileSync(path.join(net.directory, net.download), "utf8"),
			/\(export\s+\(version/,
		);
		const pdf = await X.runExport("fab", "pdf");
		assert.deepEqual(pdf.files.map((f) => f.name).sort(), [
			"fab-board.pdf",
			"fab-schematic.pdf",
		]);
		for (const f of pdf.files)
			assert.equal(
				fs
					.readFileSync(path.join(pdf.directory, f.name))
					.subarray(0, 5)
					.toString(),
				"%PDF-",
			);
		const caps = await (await fetch(`${base}/api/design/exports`)).json();
		if (caps.kinds.step.available) {
			const step = await X.runExport("fab", "step");
			assert.match(
				fs.readFileSync(path.join(step.directory, step.download), "utf8"),
				/ISO-10303-21/,
			);
		}
	});

	await t.test("REST: run, then download the same bytes", async () => {
		const r = await fetch(`${base}/api/design/projects/fab/export/bom`, {
			method: "POST",
		});
		assert.equal(r.status, 200);
		const body = await r.json();
		const dl = await fetch(
			`${base}/api/design/projects/fab/export/bom/${body.download}`,
		);
		assert.equal(dl.status, 200);
		assert.match(
			dl.headers.get("content-disposition"),
			/attachment; filename="fab-bom\.csv"/,
		);
		assert.equal(
			await dl.text(),
			fs.readFileSync(path.join(body.directory, body.download), "utf8"),
		);
	});

	await t.test("REST: bad requests are refused", async () => {
		const post = (p) =>
			fetch(`${base}/api/design/projects/${p}`, { method: "POST" });
		assert.equal((await post("fab/export/nothing")).status, 400);
		assert.equal((await post("fab/export/..%2F..")).status >= 400, true);
		assert.equal((await post("nope-x/export/bom")).status, 400);
		for (const f of [
			"..%2Fdesign.json",
			"%2e%2e%2fdesign.json",
			"a%00b",
			"x".repeat(200),
			"..",
		])
			assert.ok(
				(await fetch(`${base}/api/design/projects/fab/export/bom/${f}`))
					.status >= 400,
				f,
			);
		assert.equal(
			(
				await fetch(
					`${base}/api/design/projects/fab/export/gerbers/not-exported.txt`,
				)
			).status,
			400,
		);
	});

	await t.test("MCP tool", async () => {
		const r = await callTool("export", { project: "fab", kind: "bom" });
		assert.equal(r.ok, true);
		assert.equal(r.result.download, "fab-bom.csv");
		const bad = await callTool("export", {
			project: "fab",
			kind: "everything",
		});
		assert.equal(bad.ok, false);
	});

	await t.test("exports never commit and never touch the design", async () => {
		const before = (await P.history("fab", 100)).length;
		const design = fs.readFileSync(
			path.join(projects, "fab", "design.json"),
			"utf8",
		);
		await X.runExport("fab", "bom");
		assert.equal((await P.history("fab", 100)).length, before);
		assert.equal(
			fs.readFileSync(path.join(projects, "fab", "design.json"), "utf8"),
			design,
		);
		const status = (await import("node:child_process"))
			.execFileSync("git", ["status", "--porcelain"], {
				cwd: path.join(projects, "fab"),
			})
			.toString();
		assert.equal(
			status.trim(),
			"",
			"results/ is ignored, the tree stays clean",
		);
	});

	await t.test("an empty design cannot be exported", async () => {
		await P.createProject("empty");
		await assert.rejects(X.runExport("empty", "bom"), /no parts/);
	});
});
