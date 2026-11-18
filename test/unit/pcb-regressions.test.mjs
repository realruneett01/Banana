import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const bglSrc = readFileSync(
	new URL("../../frontend/src/editor/BoardGraphicsLayer.jsx", import.meta.url),
	"utf8",
);

const bglSlice = bglSrc.slice(
	bglSrc.indexOf("const DEFAULT_WIDTH"),
	bglSrc.indexOf("function renderLine"),
);
const dimSlice = bglSrc.slice(
	bglSrc.indexOf("export function dimensionGeometry"),
	bglSrc.indexOf("function renderDimension"),
);

const bglCode = [bglSlice, dimSlice].join("\n");
const bglModule = await import(
	`data:text/javascript;base64,${Buffer.from(bglCode).toString("base64")}`
);
const { dimensionGeometry, resolveWidth } = bglModule;

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);
const zoneSlice = pcbCanvasSrc.slice(
	pcbCanvasSrc.indexOf("export function getZonePoints"),
	pcbCanvasSrc.indexOf("function outlinePoints"),
);
const pcbModule = await import(
	`data:text/javascript;base64,${Buffer.from(zoneSlice).toString("base64")}`
);
const { getZonePoints, formatZonePt } = pcbModule;

describe("dimensionGeometry pure function", () => {
	it("calculates Euclidean length and normal vector for 3-4-5 triangle", () => {
		const g = { x: 0, y: 0, x2: 30, y2: 40 };
		const geom = dimensionGeometry(g);
		assert.equal(geom.len, 50);
		assert.equal(geom.nx, -40 / 50);
		assert.equal(geom.ny, 30 / 50);
	});

	it("handles horizontal segment with upward normal", () => {
		const g = { x: 10, y: 20, x2: 50, y2: 20 };
		const geom = dimensionGeometry(g);
		assert.equal(geom.len, 40);
		assert.equal(geom.nx, 0);
		assert.equal(geom.ny, 1);
	});

	it("handles vertical segment with leftward normal", () => {
		const g = { x: 10, y: 20, x2: 10, y2: 60 };
		const geom = dimensionGeometry(g);
		assert.equal(geom.len, 40);
		assert.equal(geom.nx, -1);
		assert.equal(geom.ny, 0);
	});

	it("handles zero-length point fallback without crashing", () => {
		const g = { x: 15, y: 25, x2: 15, y2: 25 };
		const geom = dimensionGeometry(g);
		assert.equal(geom.len, 0);
		assert.equal(geom.nx, 0);
		assert.equal(geom.ny, 1);
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
		assert.equal(resolveWidth({ layer: "F.SilkS" }), 0.15);
		assert.equal(resolveWidth({ layer: "F.Cu" }), 0.15);
		assert.equal(resolveWidth({}), 0.15);
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
		assert.deepEqual(getZonePoints(null), []);
		assert.deepEqual(getZonePoints({}), []);
		assert.deepEqual(getZonePoints({ polygon: "invalid" }), []);
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
		assert.equal(formatZonePt(null), null);
		assert.equal(formatZonePt(undefined), null);
		assert.equal(formatZonePt("string"), null);
		assert.equal(formatZonePt({ x: "invalid", y: 10 }), null);
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
		const buttons = ["Board outline", "Line"];
		const substringMatch = buttons.find((label) => /Line/i.test(label));
		assert.equal(substringMatch, "Board outline");

		const exactMatch = buttons.find((label) => label.toLowerCase() === "line");
		assert.equal(exactMatch, "Line");
	});

	it("demonstrates LED collisions on Filled zone when using substring matching", () => {
		const buttons = ["Filled zone", "LED"];
		const substringMatch = buttons.find((label) => /LED/i.test(label));
		assert.equal(substringMatch, "Filled zone");

		const exactMatch = buttons.find((label) => label === "LED");
		assert.equal(exactMatch, "LED");
	});

	it("demonstrates Rectangle collisions on Board outline (rectangle)", () => {
		const buttons = ["Board outline (rectangle)", "Rectangle"];
		const substringMatch = buttons.find((label) => /Rectangle/i.test(label));
		assert.equal(substringMatch, "Board outline (rectangle)");

		const exactMatch = buttons.find((label) => label === "Rectangle");
		assert.equal(exactMatch, "Rectangle");
	});
});
