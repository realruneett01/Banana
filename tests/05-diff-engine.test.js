import assert from "node:assert/strict";
import { test } from "node:test";
import { processSvgDiff } from "../backend/src/svg-diff-processor.js";
import {
	COMPONENT_TYPE_MAP,
	extractElements,
	extractPrimitives,
	getComponentType,
	getDistance,
	parseAttributes,
} from "../backend/src/svg-primitives.js";
import {
	cleanLayerName,
	cleanNetName,
	formatSemanticTitle,
} from "../backend/src/svg-styler.js";
import { between, int, pick, rng } from "./helpers.js";

const svgWrap = (body) =>
	`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300mm" height="300mm">\n${body}\n</svg>`;

/** Elements are placed on a coarse grid so no two are ever within matching distance of each other. */
function genElements(seed, count) {
	const r = rng(seed);
	const cells = [];
	for (let gx = 0; gx < 8; gx++)
		for (let gy = 0; gy < 8; gy++) cells.push([gx, gy]);
	for (let i = cells.length - 1; i > 0; i--) {
		const j = int(r, 0, i);
		[cells[i], cells[j]] = [cells[j], cells[i]];
	}
	return cells.slice(0, count).map(([gx, gy], i) => {
		const x = 20 + gx * 30;
		const y = 20 + gy * 30;
		const kind = pick(r, ["circle", "rect", "line", "path"]);
		const w = (0.1 + (i % 5) * 0.1).toFixed(2);
		const base = `style="fill:none;stroke:#C83434;stroke-width:${w}"`;
		const markup =
			kind === "circle"
				? `<circle cx="${x}" cy="${y}" r="${(1 + between(r, 0, 2)).toFixed(3)}" ${base}/>`
				: kind === "rect"
					? `<rect x="${x}" y="${y}" width="${(2 + between(r, 0, 3)).toFixed(3)}" height="${(2 + between(r, 0, 3)).toFixed(3)}" ${base}/>`
					: kind === "line"
						? `<line x1="${x}" y1="${y}" x2="${x + 5}" y2="${y + 4}" ${base}/>`
						: `<path d="M ${x} ${y} L ${x + 6} ${y + 1} L ${x + 3} ${y + 5}" ${base}/>`;
		return { x, y, markup };
	});
}

const LAYERS = [
	"board-F_SilkS.svg",
	"board-F_Cu.svg",
	"board-Edge_Cuts.svg",
	"board-B_Courtyard.svg",
];

test("diffing a document against itself yields no modifications (200 generated documents)", async (t) => {
	for (let seed = 1; seed <= 200; seed++) {
		await t.test(`seed ${seed}`, () => {
			const els = genElements(seed, 1 + (seed % 24));
			const svg = svgWrap(els.map((e) => e.markup).join("\n"));
			const res = processSvgDiff(svg, svg, {
				layerFilename: LAYERS[seed % LAYERS.length],
			});
			assert.deepEqual(res.modifications, []);
		});
	}
});

test("one added element is reported as exactly one ADDED change (200 documents)", async (t) => {
	for (let seed = 1; seed <= 200; seed++) {
		await t.test(`seed ${seed}`, () => {
			const els = genElements(seed, 2 + (seed % 20));
			const added = els.pop();
			const base = svgWrap(els.map((e) => e.markup).join("\n"));
			const target = svgWrap([...els, added].map((e) => e.markup).join("\n"));
			const res = processSvgDiff(base, target, {
				layerFilename: "board-F_SilkS.svg",
			});
			const actions = res.modifications.map((m) => m.action);
			assert.deepEqual(
				actions,
				["ADDED"],
				JSON.stringify(
					res.modifications.map((m) => [m.action, m.type, m.name]),
				),
			);
		});
	}
});

test("one removed element is reported as exactly one DELETED change (200 documents)", async (t) => {
	for (let seed = 1; seed <= 200; seed++) {
		await t.test(`seed ${seed}`, () => {
			const els = genElements(seed + 5000, 2 + (seed % 20));
			const removed = els.pop();
			const base = svgWrap([...els, removed].map((e) => e.markup).join("\n"));
			const target = svgWrap(els.map((e) => e.markup).join("\n"));
			const res = processSvgDiff(base, target, {
				layerFilename: "board-F_SilkS.svg",
			});
			assert.deepEqual(
				res.modifications.map((m) => m.action),
				["DELETED"],
			);
		});
	}
});

test("engine never throws and keeps diff indices unique on arbitrary pairs (200 fuzz pairs)", async (t) => {
	for (let seed = 1; seed <= 200; seed++) {
		await t.test(`seed ${seed}`, () => {
			const a = genElements(seed, int(rng(seed), 0, 30));
			const b = genElements(seed * 7 + 1, int(rng(seed + 1), 0, 30));
			const res = processSvgDiff(
				svgWrap(a.map((e) => e.markup).join("")),
				svgWrap(b.map((e) => e.markup).join("")),
				{
					layerFilename: LAYERS[seed % LAYERS.length],
				},
			);
			assert.ok(Array.isArray(res.modifications));
			assert.equal(typeof res.baseSvg, "string");
			assert.equal(typeof res.targetSvg, "string");
			assert.equal(res.telemetry.baseCount, a.length);
			assert.equal(res.telemetry.targetCount, b.length);
			const ids = res.modifications.map((m) => m.id);
			assert.equal(new Set(ids).size, ids.length, "modification ids unique");
		});
	}
});

test("engine tolerates malformed SVG input without throwing (150 mutated documents)", async (t) => {
	const base = svgWrap(
		genElements(9, 12)
			.map((e) => e.markup)
			.join("\n"),
	);
	for (let seed = 1; seed <= 150; seed++) {
		await t.test(`seed ${seed}`, () => {
			const r = rng(seed);
			const cut = int(r, 0, base.length);
			const junk = pick(r, [
				"<",
				"<circle",
				'<g class="stroked-text">',
				"</g>",
				"\u0000",
				'<path d="',
				"<text>",
				'<use href="#x"',
				"&",
				"<!--",
			]);
			const target =
				base.slice(0, cut) + junk + base.slice(cut + int(r, 0, 20));
			assert.doesNotThrow(() =>
				processSvgDiff(base, target, { layerFilename: "board-F_Cu.svg" }),
			);
		});
	}
});

test("parseAttributes / extractPrimitives", async (t) => {
	await t.test("attrs", () =>
		assert.deepEqual(parseAttributes(` cx="1" cy='2' style="a:b;c:d"`), {
			cx: "1",
			cy: "2",
			style: "a:b;c:d",
		}),
	);
	await t.test("empty", () => assert.deepEqual(parseAttributes(""), {}));
	for (const tag of [
		"circle",
		"rect",
		"line",
		"ellipse",
		"polyline",
		"polygon",
		"path",
	]) {
		await t.test(`finds <${tag}>`, () => {
			const prims = extractPrimitives(`<${tag} id="x1" cx="1"/>`);
			assert.equal(prims.length, 1);
			assert.equal(prims[0].tag, tag);
			assert.equal(prims[0].id, "x1");
		});
	}
	await t.test("text content", () =>
		assert.equal(
			extractPrimitives(`<text x="1" y="2">R12</text>`)[0].text,
			"R12",
		),
	);
	await t.test("count", () =>
		assert.equal(extractPrimitives(`<circle/><rect/><line/>`).length, 3),
	);
});

test("getDistance is symmetric, non-negative and zero for identical elements (200 pairs)", async (t) => {
	const r = rng(321);
	for (let i = 0; i < 200; i++) {
		const mk = () => ({
			tag: "circle",
			fullMatch: `<circle cx="${between(r, -50, 50)}" cy="${between(r, -50, 50)}" r="1"/>`,
		});
		const a = mk();
		const b = mk();
		await t.test(`pair ${i}`, () => {
			assert.ok(Math.abs(getDistance(a, b) - getDistance(b, a)) < 1e-12);
			assert.ok(getDistance(a, b) >= 0);
			assert.equal(getDistance(a, a), 0);
		});
	}
});

test("getComponentType", async (t) => {
	for (const [prefix, label] of Object.entries(COMPONENT_TYPE_MAP)) {
		await t.test(`${prefix}1 -> ${label}`, () =>
			assert.equal(getComponentType(`${prefix}1`), label),
		);
	}
	for (const ref of ["", null, undefined, "ZZZZ9", "123"])
		await t.test(`unknown ${JSON.stringify(ref)}`, () =>
			assert.equal(getComponentType(ref), "Component"),
		);
	await t.test("lowercase equals uppercase", () =>
		assert.equal(getComponentType("r5"), getComponentType("R5")),
	);
});

test("styler name cleaning", async (t) => {
	for (const [raw, e] of [
		[null, "signal"],
		["unconnected", "signal"],
		["0", "signal"],
		["/GND", "gnd"],
		["VCC", "vcc"],
		["Net-(R1-Pad1)", "r1-pad1"],
		["unconnected-(U1-NC)", "u1-nc"],
	])
		await t.test(String(raw), () => assert.equal(cleanNetName(raw), e));
	for (const [raw, e] of [
		[null, "F.Cu"],
		["board-F_Cu.svg", "F.Cu"],
		["my-board-B_SilkS.svg", "B.SilkS"],
		["F_Cu", "F.Cu"],
	])
		await t.test(String(raw), () => assert.equal(cleanLayerName(raw), e));
	await t.test("title trace", () =>
		assert.equal(
			formatSemanticTitle("ADDED", "TRACE", "GND"),
			"added gnd trace",
		),
	);
	await t.test("title component", () =>
		assert.equal(
			formatSemanticTitle("CHANGED", "COMPONENT", "R1"),
			"changed R1 component",
		),
	);
	await t.test("title other", () =>
		assert.equal(formatSemanticTitle("DELETED", "VIA", "V1"), "deleted v1"),
	);
});

test("extractElements on empty / structural input", async (t) => {
	for (const s of ["", "<svg></svg>", "<svg><g></g></svg>", "<!-- nothing -->"])
		await t.test(JSON.stringify(s), () =>
			assert.deepEqual(extractElements(s), []),
		);
});
