import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const bglSrc = readFileSync(
	new URL("../../frontend/src/editor/BoardGraphicsLayer.jsx", import.meta.url),
	"utf8",
);

function extractExported(source, ranges) {
	const chunks = ranges.map(([from, to]) =>
		source.slice(source.indexOf(from), source.indexOf(to)),
	);
	const data = Buffer.from(chunks.join("\n")).toString("base64");
	return import(`data:text/javascript;base64,${data}`);
}

const { dimensionGeometry, resolveWidth } = await extractExported(bglSrc, [
	["const DEFAULT_WIDTH", "function renderLine"],
	["export function dimensionGeometry", "function renderDimension"],
]);

const { getZonePoints, formatZonePt } = await extractExported(
	readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	),
	[["export function getZonePoints", "function outlinePoints"]],
);

function checkDimension(segment, expected) {
	const geom = dimensionGeometry(segment);
	assert.deepEqual({ len: geom.len, nx: geom.nx, ny: geom.ny }, expected);
}

function verifyCollision(buttons, pattern, exact, expectedSub) {
	assert.equal(
		buttons.find((l) => pattern.test(l)),
		expectedSub,
	);
	assert.equal(
		buttons.find((l) =>
			exact === "Line" ? l.toLowerCase() === "line" : l === exact,
		),
		exact,
	);
}

describe("dimensionGeometry pure function", () => {
	it("calculates Euclidean length and normal vector for 3-4-5 triangle", () => {
		checkDimension(
			{ x: 0, y: 0, x2: 30, y2: 40 },
			{ len: 50, nx: -40 / 50, ny: 30 / 50 },
		);
	});

	it("handles horizontal segment with upward normal", () => {
		checkDimension({ x: 10, y: 20, x2: 50, y2: 20 }, { len: 40, nx: 0, ny: 1 });
	});

	it("handles vertical segment with leftward normal", () => {
		checkDimension(
			{ x: 10, y: 20, x2: 10, y2: 60 },
			{ len: 40, nx: -1, ny: 0 },
		);
	});

	it("handles zero-length point fallback without crashing", () => {
		checkDimension({ x: 15, y: 25, x2: 15, y2: 25 }, { len: 0, nx: 0, ny: 1 });
	});
});

describe("resolveWidth pure function", () => {
	it("preserves explicit numeric width", () => {
		assert.equal(resolveWidth({ width: 0.35, layer: "F.Cu" }), 0.35);
		assert.equal(resolveWidth({ width: 0.25, layer: "Edge.Cuts" }), 0.25);
	});

	it("defaults Edge.Cuts width to 0.1 mm", () => {
		assert.equal(resolveWidth({ layer: "Edge.Cuts" }), 0.1);
	});

	it("defaults non-Edge.Cuts layers to 0.15 mm", () => {
		const widths = [{ layer: "F.SilkS" }, { layer: "F.Cu" }, {}].map(
			resolveWidth,
		);
		assert.deepEqual(widths, [0.15, 0.15, 0.15]);
	});
});

describe("getZonePoints pure function", () => {
	it("extracts coordinate list from polygon property", () => {
		const pts = getZonePoints({
			polygon: [
				[-10, -10],
				[10, -10],
				[10, 10],
			],
		});
		assert.equal(pts.length, 3);
		assert.deepEqual(pts[0], [-10, -10]);
	});

	it("extracts coordinate list from points property", () => {
		const pts = getZonePoints({
			points: [
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
			],
		});
		assert.equal(pts.length, 2);
		assert.deepEqual(pts[1], { x: 20, y: 0 });
	});

	it("returns empty array when no polygon or points array is present", () => {
		for (const input of [null, {}, { polygon: "invalid" }]) {
			assert.deepEqual(getZonePoints(input), []);
		}
	});
});

describe("formatZonePt pure function", () => {
	it("formats array coordinates as comma-separated string", () => {
		assert.equal(formatZonePt([-50, 25.4]), "-50,25.4");
	});

	it("formats object coordinates as comma-separated string", () => {
		assert.equal(formatZonePt({ x: 12.3, y: -45.6 }), "12.3,-45.6");
	});

	it("returns null for invalid or missing coordinates", () => {
		const invalids = [null, undefined, "string", { x: "invalid", y: 10 }];
		for (const val of invalids) {
			assert.equal(formatZonePt(val), null);
		}
	});
});

describe("BoardGraphicsLayer contract checks", () => {
	it("renders both pcb-graphics and layer-specific class names", () => {
		assert.match(
			bglSrc,
			/const\s+cls\s*=\s*layer\s*\?\s*`pcb-graphics pcb-graphics-\$\{layer\}`\s*:\s*"pcb-graphics"/,
		);
	});

	it("falls back to F.SilkS when graphic layer is undefined", () => {
		assert.match(bglSrc, /\(g\.layer\s*\?\?\s*"F\.SilkS"\)\s*===\s*layer/);
	});
});

describe("Locator substring collision root causes", () => {
	it("demonstrates Line collisions on Board outline when using substring matching", () => {
		verifyCollision(
			["Board outline", "Line"],
			/Line/i,
			"Line",
			"Board outline",
		);
	});

	it("demonstrates LED collisions on Filled zone when using substring matching", () => {
		verifyCollision(["Filled zone", "LED"], /LED/i, "LED", "Filled zone");
	});

	it("demonstrates Rectangle collisions on Board outline (rectangle)", () => {
		verifyCollision(
			["Board outline (rectangle)", "Rectangle"],
			/Rectangle/i,
			"Rectangle",
			"Board outline (rectangle)",
		);
	});
});
