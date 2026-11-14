import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { markerGlyphs } from "../../frontend/src/editor/markerRender.js";
import {
	missingFootprintIds,
	routePreviewLegs,
} from "../../frontend/src/editor/pcbGeometry.js";
import { proposeRoute } from "../../frontend/src/editor/routingModel.js";

describe("markerGlyphs zoom option", () => {
	test("radius and stroke keep a constant screen size", () => {
		const [near] = markerGlyphs([{ at: [0, 0] }], { zoom: 2 });
		const [far] = markerGlyphs([{ at: [0, 0] }], { zoom: 8 });
		assert.equal(near.r * 2, far.r * 8);
		assert.equal(near.strokeWidth * 2, far.strokeWidth * 8);
		assert.ok(far.r < near.r);
	});

	test("an explicit radius still wins over zoom", () => {
		const [g] = markerGlyphs([{ at: [0, 0] }], { radius: 2.5, zoom: 4 });
		assert.equal(g.r, 2.5);
	});

	test("invalid zoom falls back to the board-unit default", () => {
		const [g] = markerGlyphs([{ at: [0, 0] }], { zoom: 0 });
		assert.equal(g.r, 1.2);
	});
});

describe("routePreviewLegs", () => {
	test("skips zero-length legs and keys stay unique", () => {
		const legs = routePreviewLegs([
			[0, 0],
			[0, 0],
			[1, 0],
			[1, 0],
			[0, 0],
			[1, 0],
		]);
		assert.equal(legs.length, 3);
		assert.deepEqual(legs[0].p1, [0, 0]);
		assert.deepEqual(legs[0].p2, [1, 0]);
		const keys = new Set(legs.map((l) => l.key));
		assert.equal(keys.size, legs.length);
	});

	test("fewer than two points gives no legs", () => {
		assert.deepEqual(routePreviewLegs([[1, 1]]), []);
		assert.deepEqual(routePreviewLegs(null), []);
	});
});

describe("missingFootprintIds", () => {
	const parts = [
		{ id: "a", footprint: "Lib:A", placement: { x: 0, y: 0 } },
		{ id: "b", footprint: "Lib:B", placement: { x: 0, y: 0 } },
		{ id: "c", footprint: "Lib:C" },
		{ id: "d", props: { footprint: "Lib:D" }, placement: { x: 0, y: 0 } },
	];

	test("lists only placed, non-embedded parts whose fetch came back empty", () => {
		const cache = { "Lib:A": null, "Lib:B": { pads: [] }, "Lib:C": null };
		assert.deepEqual(missingFootprintIds(parts, {}, cache), ["Lib:A"]);
	});

	test("embedded footprints are never missing; pending ids are not yet", () => {
		const cache = { "Lib:A": null, "Lib:D": null };
		assert.deepEqual(missingFootprintIds(parts, { a: {} }, cache), ["Lib:D"]);
		assert.deepEqual(missingFootprintIds(parts, {}, {}), []);
	});
});

describe("proposeRoute netNames", () => {
	const board = {
		tracks: [
			{
				start: [0, 1],
				end: [10, 1],
				widthMm: 0.25,
				layer: "F.Cu",
				netId: "net_1",
			},
		],
	};
	const pads = [
		{
			center: [5, -1],
			size: [1, 1],
			rot: 0,
			shape: "rect",
			layers: ["F.Cu"],
			netId: "net_2",
		},
	];
	const route = (extra) =>
		proposeRoute({
			start: [0, 0],
			cursor: [10, 0],
			widthMm: 0.25,
			clearanceMm: 0.6,
			board,
			pads,
			netId: "SIG",
			...extra,
		});

	test("collision text names the net, not its internal id", () => {
		const netNames = { net_1: "GND", net_2: "VCC" };
		const { collisions } = route({ netNames });
		assert.ok(collisions.length > 0);
		for (const c of collisions) {
			assert.match(c.message, /Too close to (GND|VCC)/);
			assert.doesNotMatch(c.message, /net_\d/);
		}
	});

	test("without a name the id is still shown", () => {
		const { collisions } = route({});
		assert.ok(collisions.some((c) => /net_\d/.test(c.message)));
	});
});
