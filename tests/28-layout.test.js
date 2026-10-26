// Connectivity-aware placement: invariants over many generated circuits, plus structure checks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomCircuit } from "./design-helpers.js";
import { hasKicad, tmpDir } from "./helpers.js";

process.env.BANANA_PROJECTS_DIR = tmpDir("banana-layout-");
const { Design, emptyDesign } = await import("../backend/src/design/model.js");
const { findLibraryRoot, getFootprint } = await import(
	"../backend/src/design/kicad-lib.js"
);
const { layeredPlace, estimateWirelength } = await import(
	"../backend/src/design/layout.js"
);
const { shelfPlace, rotatedBox, writePcb } = await import(
	"../backend/src/design/writer-pcb.js"
);

const skip =
	findLibraryRoot("symbols") && findLibraryRoot("footprints")
		? false
		: "KiCad libraries not installed";
const R = "Resistor_SMD:R_0805_2012Metric";
const LED = "LED_SMD:LED_0805_2012Metric";
const HDR = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical";

const fpsOf = (d) =>
	new Map(d.data.parts.map((p) => [p.ref, getFootprint(p.footprint)]));
const boxOf = (fp, at) => {
	const b = rotatedBox(fp.bbox, at.rot || 0);
	return {
		minX: at.x + b.minX,
		maxX: at.x + b.maxX,
		minY: at.y + b.minY,
		maxY: at.y + b.maxY,
	};
};
const overlap = (a, b, gap = 0) =>
	a.minX < b.maxX + gap &&
	b.minX < a.maxX + gap &&
	a.minY < b.maxY + gap &&
	b.minY < a.maxY + gap;

function chain(n) {
	const d = new Design(emptyDesign("chain"));
	d.addPart({
		symbol: "Connector_Generic:Conn_01x02",
		value: "IN",
		footprint: HDR,
	});
	for (let i = 0; i < n; i++)
		d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	for (let i = 0; i < n; i++)
		d.addPart({ symbol: "Device:LED", value: "RED", footprint: LED });
	d.connect("+5V", [
		"J1.1",
		...Array.from({ length: n }, (_, i) => `R${i + 1}.1`),
	]);
	d.setNetFlags("+5V", { external: true });
	for (let i = 1; i <= n; i++) d.connect(`L${i}`, [`R${i}.2`, `D${i}.2`]);
	d.connect("GND", [
		"J1.2",
		...Array.from({ length: n }, (_, i) => `D${i + 1}.1`),
	]);
	d.setNetFlags("GND", { external: true });
	return d;
}

test("100 random circuits: no overlaps, on the 0.5 mm grid, deterministic", {
	skip,
	timeout: 300000,
}, async (t) => {
	for (let seed = 1; seed <= 100; seed++)
		await t.test(`seed ${seed}`, () => {
			const d = new Design(emptyDesign("t"));
			randomCircuit(d, seed, { minParts: 2, maxParts: 14 });
			const fps = fpsOf(d);
			const pos = layeredPlace(d, fps);
			assert.equal(pos.size, d.data.parts.length, "every part gets a position");
			const boxes = [...pos].map(([ref, at]) => ({
				ref,
				...boxOf(fps.get(ref), at),
			}));
			for (const [ref, at] of pos) {
				assert.ok(
					Math.abs(at.x * 2 - Math.round(at.x * 2)) < 1e-9 &&
						Math.abs(at.y * 2 - Math.round(at.y * 2)) < 1e-9,
					`${ref} on grid (${at.x},${at.y})`,
				);
				assert.equal(at.rot, 0);
			}
			for (let i = 0; i < boxes.length; i++)
				for (let j = i + 1; j < boxes.length; j++)
					assert.ok(
						!overlap(boxes[i], boxes[j], 0.5),
						`${boxes[i].ref} and ${boxes[j].ref} keep a 0.5 mm gap`,
					);
			assert.deepEqual([...layeredPlace(d, fps)], [...pos], "deterministic");
		});
});

test("the written board contains every part inside its outline (auto-sized and user-sized)", {
	skip,
	timeout: 300000,
}, async (t) => {
	for (let seed = 1; seed <= 40; seed++)
		await t.test(`seed ${seed}`, () => {
			const d = new Design(emptyDesign("t"));
			randomCircuit(d, seed, { minParts: 3, maxParts: 12 });
			const out = writePcb(d);
			const fps = fpsOf(d);
			const { originX: ox, originY: oy, width, height } = out.board;
			assert.equal(width, Math.round(width), "whole-mm outline");
			assert.equal(height, Math.round(height), "whole-mm outline");
			for (const [ref, at] of Object.entries(out.positions)) {
				const b = boxOf(fps.get(ref), at);
				assert.ok(
					b.minX >= ox &&
						b.maxX <= ox + width &&
						b.minY >= oy &&
						b.maxY <= oy + height,
					`${ref} inside the outline`,
				);
			}
		});
});

test("structure: connector on the left, supply side before ground side, power rails do not pull", {
	skip,
}, () => {
	const d = chain(6);
	const pos = Object.fromEntries(layeredPlace(d, fpsOf(d)));
	assert.ok(
		pos.J1.x < pos.R1.x && pos.R1.x < pos.D1.x,
		"J1 | R | D left to right",
	);
	for (let i = 1; i <= 6; i++) {
		assert.equal(pos[`R${i}`].x, pos.R1.x, "resistors share a column");
		assert.equal(pos[`D${i}`].x, pos.D1.x, "LEDs share a column");
		assert.equal(
			pos[`R${i}`].y,
			pos[`D${i}`].y,
			`R${i} sits directly across from D${i}`,
		);
	}
	for (let i = 1; i < 6; i++)
		assert.ok(pos[`R${i}`].y < pos[`R${i + 1}`].y, "rows keep their order");
});

test("measurably shorter wiring than shelf packing on structured circuits", {
	skip,
}, () => {
	for (const n of [3, 6, 10]) {
		const d = chain(n);
		const fps = fpsOf(d);
		const shelf = estimateWirelength(d, Object.fromEntries(shelfPlace(d, fps)));
		const layered = estimateWirelength(
			d,
			Object.fromEntries(layeredPlace(d, fps)),
		);
		assert.ok(
			layered < shelf * 0.85,
			`chain ${n}: layered ${layered} vs shelf ${shelf}`,
		);
	}
});

test("on random circuits it is never meaningfully worse overall", {
	skip,
	timeout: 120000,
}, () => {
	let shelfTotal = 0;
	let layeredTotal = 0;
	for (let seed = 1; seed <= 100; seed++) {
		const d = new Design(emptyDesign("t"));
		randomCircuit(d, seed, { minParts: 4, maxParts: 14 });
		const fps = fpsOf(d);
		shelfTotal += estimateWirelength(d, Object.fromEntries(shelfPlace(d, fps)));
		layeredTotal += estimateWirelength(
			d,
			Object.fromEntries(layeredPlace(d, fps)),
		);
	}
	assert.ok(
		layeredTotal <= shelfTotal,
		`layered ${layeredTotal} vs shelf ${shelfTotal}`,
	);
});

test("parts the user placed stay put and new parts avoid them", {
	skip,
	timeout: 60000,
}, async (t) => {
	for (const where of [
		{ x: 60, y: 30 },
		{ x: 25, y: 70 },
		{ x: 40, y: 40, rot: 90 },
	])
		await t.test(JSON.stringify(where), () => {
			const d = chain(4);
			d.place("R1", where.x, where.y, where.rot ?? 0);
			const fps = fpsOf(d);
			const pos = layeredPlace(d, fps);
			assert.ok(!pos.has("R1"), "fixed part is not moved");
			const fixed = boxOf(fps.get("R1"), { ...where, rot: where.rot ?? 0 });
			for (const [ref, at] of pos)
				assert.ok(
					!overlap(fixed, boxOf(fps.get(ref), at), 0.5),
					`${ref} clear of the fixed part`,
				);
		});
});

test("single part, no nets, and unfootprinted parts do not break placement", {
	skip,
}, () => {
	const d = new Design(emptyDesign("t"));
	d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	assert.equal(layeredPlace(d, fpsOf(d)).size, 1);
	assert.equal(layeredPlace(new Design(emptyDesign("t")), new Map()).size, 0);
});

test("hasKicad helper is importable (keeps the suite honest about skips)", () =>
	assert.equal(typeof hasKicad(), "boolean"));

test("the project name is printed on the silkscreen when there is room", {
	skip,
	timeout: 60000,
}, () => {
	const d = new Design(emptyDesign("my-board"));
	for (let i = 0; i < 4; i++)
		d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	const out = writePcb(d);
	assert.match(
		out.text,
		/\(gr_text "my-board" \(at [\d.]+ [\d.]+\) \(layer "F\.SilkS"\)/,
	);
});

test("the title is left out rather than printed over a part", {
	skip,
	timeout: 60000,
}, () => {
	const d = new Design(emptyDesign("my-board"));
	d.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	d.place("R1", 22, 21.2, 0);
	d.setBoard(30, 20);
	assert.doesNotMatch(writePcb(d).text, /gr_text/);
});
