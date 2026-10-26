// Native KiCad views, coordinate mapping, and the Studio's read endpoints. Needs KiCad + libraries.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { hasKicad, tmpDir } from "./helpers.js";

const projects = tmpDir("banana-views-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const P = await import("../backend/src/design/project.js");
const V = await import("../backend/src/design/views.js");
const { absolutePads } = await import("../backend/src/design/checks.js");
const { writePcb } = await import("../backend/src/design/writer-pcb.js");
const { createApp } = await import("../backend/src/server.js");
const { config } = await import("../backend/src/config.js");
const { getCapabilities } = await import("../backend/src/kicad-compat.js");
const { randomCircuit } = await import("./design-helpers.js");

const skip = !hasKicad()
	? "kicad-cli not installed"
	: findLibraryRoot("symbols") && findLibraryRoot("footprints")
		? false
		: "KiCad libraries not installed";
const R = "Resistor_SMD:R_0805_2012Metric";
after(() => fs.rmSync(projects, { recursive: true, force: true }));

test("view transform helpers are exact inverses", async (t) => {
	const tr = V.boardViewTransform({ originX: 20, originY: 20 });
	for (const [x, y] of [
		[20, 20],
		[30.5, 44.25],
		[-5, 0],
		[1000, 1000],
	])
		await t.test(`${x},${y}`, () => {
			const v = V.toViewCoords(tr, x, y);
			const back = V.fromViewCoords(tr, v.x, v.y);
			assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9);
		});
	const o = V.toViewCoords(tr, 20, 20);
	assert.ok(Math.abs(o.x - 0.05) < 1e-9 && Math.abs(o.y - 0.05) < 1e-9);
});

test("svgHealth recognises usable and broken exports", () => {
	assert.equal(
		V.svgHealth('<svg viewBox="0 0 10 10"><path d="M0,0"/></svg>').ok,
		true,
	);
	for (const bad of [
		"",
		"<svg></svg>",
		'<svg viewBox="0 0 10 10"></svg>',
		'<svg viewBox="a b c d"><path/></svg>',
		"<html></html>",
	])
		assert.equal(V.svgHealth(bad).ok, false, bad);
});

test("board view arguments follow the installed KiCad's capabilities", async (t) => {
	const caps = { svg: { pageSizeMode: true, excludeDrawingSheet: true } };
	await t.test("front", () => {
		const a = V.boardViewArgs({
			view: "front",
			input: "/i.kicad_pcb",
			output: "/o.svg",
			capabilities: caps,
		});
		assert.ok(
			a.includes("--page-size-mode") &&
				a.includes("--exclude-drawing-sheet") &&
				!a.includes("--mirror"),
		);
		assert.equal(
			a[a.indexOf("--layers") + 1],
			"F.Cu,F.SilkS,F.CrtYd,Edge.Cuts",
		);
	});
	await t.test("back is mirrored", () =>
		assert.ok(
			V.boardViewArgs({
				view: "back",
				input: "/i",
				output: "/o",
				capabilities: caps,
			}).includes("--mirror"),
		),
	);
	await t.test("unsupported flags are left out", () => {
		const a = V.boardViewArgs({
			view: "all",
			input: "/i",
			output: "/o",
			capabilities: {
				svg: { pageSizeMode: false, excludeDrawingSheet: false },
			},
		});
		assert.ok(
			!a.includes("--page-size-mode") && !a.includes("--exclude-drawing-sheet"),
		);
	});
	await t.test("unknown view", () =>
		assert.throws(
			() =>
				V.boardViewArgs({
					view: "top",
					input: "/i",
					output: "/o",
					capabilities: caps,
				}),
			/Unknown board view/,
		),
	);
});

function extractShapeBoxes(svg) {
	const boxes = [];
	for (const m of svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"/g)) {
		const nums = [...m[1].matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(
			(n) => [Number(n[1]), Number(n[2])],
		);
		if (nums.length < 3) continue;
		const xs = nums.map((n) => n[0]);
		const ys = nums.map((n) => n[1]);
		boxes.push({
			cx: (Math.min(...xs) + Math.max(...xs)) / 2,
			cy: (Math.min(...ys) + Math.max(...ys)) / 2,
			w: Math.max(...xs) - Math.min(...xs),
			h: Math.max(...ys) - Math.min(...ys),
		});
	}
	for (const m of svg.matchAll(
		/<circle\b[^>]*?\bcx="([^"]+)"[^>]*?\bcy="([^"]+)"[^>]*?\br="([^"]+)"/g,
	))
		boxes.push({
			cx: Number(m[1]),
			cy: Number(m[2]),
			w: 2 * Number(m[3]),
			h: 2 * Number(m[3]),
		});
	return boxes;
}

test("KiCad's own SVG agrees with the mm->view transform and our pad positions (0 and 90 degree parts)", {
	skip,
	timeout: 120000,
}, async () => {
	await P.createProject("xform");
	const d = P.loadDesign("xform");
	d.addPart({
		symbol: "Device:R",
		value: "1k",
		footprint: R,
		at: { x: 30, y: 30, rot: 0 },
	});
	d.addPart({
		symbol: "Device:R",
		value: "1k",
		footprint: R,
		at: { x: 42.5, y: 35, rot: 90 },
	});
	d.addPart({
		symbol: "Connector_Generic:Conn_01x03",
		value: "J",
		footprint: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
		at: { x: 55, y: 28, rot: 270 },
	});
	d.connect("A", ["R1.2", "R2.1", "J1.1"]);
	d.connect("B", ["R1.1", "R2.2", "J1.2"]);
	d.setBoard(50, 25);
	P.saveDesign("xform", d);
	await P.build("xform", "x");
	const design = P.loadDesign("xform");
	const pcb = writePcb(design);
	const tr = V.boardViewTransform(pcb.board);
	// Same flags as the real front view but only copper + outline, so the page crop matches it
	const caps = getCapabilities({
		cliPath: config.kicadCliPath,
		version: config.kicadVersion,
	});
	const out = path.join(projects, "fcu.svg");
	const args = V.boardViewArgs({
		view: "front",
		input: path.join(projects, "xform", "xform.kicad_pcb"),
		output: out,
		capabilities: caps,
	});
	args[args.indexOf("--layers") + 1] = "F.Cu,Edge.Cuts";
	execFileSync(config.kicadCliPath, args, { stdio: "ignore" });
	const svg = fs.readFileSync(out, "utf8");
	const boxes = extractShapeBoxes(svg);
	const vb = V.svgHealth(svg).viewBox;
	assert.ok(
		Math.abs(vb[2] - (pcb.board.width + 0.1)) < 0.03 &&
			Math.abs(vb[3] - (pcb.board.height + 0.1)) < 0.03,
		`viewBox ${vb} vs board ${pcb.board.width}x${pcb.board.height}`,
	);
	const expected = [...absolutePads(design, pcb.positions)].map(([pin, p]) => ({
		pin,
		...V.toViewCoords(tr, p.x, p.y),
		w: p.w,
		h: p.h,
	}));
	assert.ok(
		boxes.length >= expected.length,
		`found ${boxes.length} pad shapes for ${expected.length} pads`,
	);
	for (const e of expected) {
		const close = boxes.filter(
			(b) => Math.hypot(b.cx - e.x, b.cy - e.y) < 0.06,
		);
		assert.ok(
			close.length,
			`${e.pin}: KiCad draws nothing near (${e.x.toFixed(3)}, ${e.y.toFixed(3)})`,
		);
		const sizeErr = (b) => Math.abs(b.w - e.w) + Math.abs(b.h - e.h);
		const best = close.reduce((x, y) => (sizeErr(y) < sizeErr(x) ? y : x));
		assert.ok(
			sizeErr(best) < 0.12,
			`${e.pin}: nearest pad shape ${best.w.toFixed(2)}x${best.h.toFixed(2)} vs ${e.w}x${e.h} (rotation handled)`,
		);
	}
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

const get = async (p) => {
	const r = await fetch(base + p);
	const type = r.headers.get("content-type") ?? "";
	return {
		status: r.status,
		type,
		headers: r.headers,
		body: type.includes("json") ? await r.json() : await r.text(),
	};
};

test("state, views and changes endpoints", {
	skip,
	timeout: 240000,
}, async (t) => {
	await P.createProject("studio");
	const d = P.loadDesign("studio");
	for (const [i, v] of ["1k", "2k"].entries())
		d.addPart({
			symbol: "Device:R",
			value: v,
			footprint: R,
			at: { x: 30 + i * 10, y: 30 },
		});
	d.connect("A", ["R1.2", "R2.1"]);
	d.connect("B", ["R1.1", "R2.2"]);
	d.setBoard(40, 20);
	P.saveDesign("studio", d);

	await t.test("state before the first build", async () => {
		const r = await get("/api/design/projects/studio/state");
		assert.equal(r.status, 200);
		assert.equal(r.body.built, false);
		assert.equal(r.body.needsBuild, true);
		assert.equal(r.body.parts.length, 2);
		assert.ok(r.body.parts[0].courtyard.maxX > r.body.parts[0].courtyard.minX);
		assert.equal(r.body.parts[0].pads.length, 2);
		assert.deepEqual(r.body.transform, V.boardViewTransform(r.body.board));
	});
	await t.test("views refuse to render before a build", async () =>
		assert.equal(
			(await get("/api/design/projects/studio/view/board.svg")).status,
			400,
		),
	);

	const v1 = (await P.build("studio", "v1")).commit;
	d.place("R1", 30, 40, 0);
	P.saveDesign("studio", d);
	const v2 = (await P.build("studio", "v2")).commit;

	await t.test("state after build is current", async () => {
		const r = await get("/api/design/projects/studio/state");
		assert.equal(r.body.needsBuild, false);
		assert.equal(r.body.head, v2);
	});
	for (const view of ["front", "back", "all"])
		await t.test(`board view ${view} is a healthy KiCad SVG`, async () => {
			const r = await get(
				`/api/design/projects/studio/view/board.svg?view=${view}`,
			);
			assert.equal(r.status, 200);
			assert.match(r.type, /image\/svg\+xml/);
			assert.equal(V.svgHealth(r.body).ok, true);
			assert.match(r.body, /Image generated by PCBNEW/);
		});
	await t.test("second request is served from the cache", async () =>
		assert.equal(
			(
				await get("/api/design/projects/studio/view/board.svg?view=front")
			).headers.get("x-banana-cached"),
			"true",
		),
	);
	await t.test("schematic view", async () => {
		const r = await get("/api/design/projects/studio/view/schematic.svg");
		assert.equal(r.status, 200);
		assert.equal(V.svgHealth(r.body).ok, true);
	});
	await t.test(
		"an older revision renders differently from the working tree",
		async () => {
			const old = await get(
				`/api/design/projects/studio/view/board.svg?view=front&rev=${v1}`,
			);
			const now = await get(
				"/api/design/projects/studio/view/board.svg?view=front",
			);
			assert.equal(old.status, 200);
			assert.notEqual(
				old.body.replace(/<title>[^<]*<\/title>/, ""),
				now.body.replace(/<title>[^<]*<\/title>/, ""),
			);
		},
	);
	for (const bad of [
		"/view/foo.svg",
		"/view/board.svg?view=top",
		"/view/board.svg?rev=--output=/x",
		"/view/board.svg?rev=a..b",
		"/view/board.svg?view[]=front",
	])
		await t.test(`rejects ${bad}`, async () =>
			assert.ok((await get(`/api/design/projects/studio${bad}`)).status >= 400),
		);
	for (const name of ["../x", "NOPE", "a%2Fb", "x".repeat(60)])
		await t.test(`project name ${name}`, async () =>
			assert.ok(
				(await get(`/api/design/projects/${name}/state`)).status >= 400,
			),
		);

	await t.test(
		"changes between builds: moved part is reported with the existing diff payload",
		async () => {
			const r = await get(
				`/api/design/projects/studio/changes?base=${v1}&target=${v2}`,
			);
			assert.equal(r.status, 200);
			assert.ok(
				r.body.modifications.some(
					(m) => m.refDes === "R1" && m.action === "CHANGED",
				),
			);
			assert.ok(
				r.body.sideBySide.target.length > 0,
				"highlighted render data present",
			);
		},
	);
	await t.test(
		"changes with no commit pair given defaults to the last two builds",
		async () =>
			assert.ok(
				(await get("/api/design/projects/studio/changes")).body.modifications
					.length > 0,
			),
	);
	await t.test(
		"Live Changes: an uncommitted edit shows up against HEAD",
		async () => {
			const d2 = P.loadDesign("studio");
			d2.place("R2", 40, 12, 0);
			P.saveDesign("studio", d2);
			const r = await get(
				"/api/design/projects/studio/changes?base=HEAD&target=working",
			);
			assert.equal(r.status, 200);
			assert.ok(
				r.body.modifications.some((m) => m.refDes === "R2"),
				JSON.stringify(r.body.modifications.map((m) => m.refDes)),
			);
			assert.equal(P.loadDesign("studio").part("R2").at.y, 12);
			assert.equal(
				(await P.history("studio")).length,
				3,
				"no commit was created by previewing",
			);
		},
	);
	await t.test("Live Changes with nothing edited is empty", async () => {
		await P.build("studio", "v3");
		const r = await get(
			"/api/design/projects/studio/changes?base=HEAD&target=working",
		);
		assert.deepEqual(r.body.modifications, []);
	});
});

test("every view of 15 random designs renders to a healthy native SVG", {
	skip,
	timeout: 600000,
}, async (t) => {
	for (let seed = 1; seed <= 15; seed++) {
		await t.test(`seed ${seed}`, async () => {
			const name = `rv${seed}`;
			await P.createProject(name);
			const d = P.loadDesign(name);
			randomCircuit(d, seed, { minParts: 3, maxParts: 9 });
			P.saveDesign(name, d);
			await P.build(name, "b");
			for (const [kind, view] of [
				["board", "front"],
				["board", "back"],
				["board", "all"],
				["schematic", "front"],
			]) {
				const r = await get(
					`/api/design/projects/${name}/view/${kind}.svg?view=${view}`,
				);
				assert.equal(r.status, 200, `${kind}/${view}`);
				const h = V.svgHealth(r.body);
				assert.ok(h.ok, `${kind}/${view} health ${JSON.stringify(h)}`);
			}
		});
	}
});
