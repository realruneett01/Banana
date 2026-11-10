// All exports from svg-primitives.js are pure in-memory functions; none require kicad-cli or network.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildPrimitiveKeys,
	COMPONENT_TYPE_MAP,
	checkPathIsClosed,
	computeBoundingCenterFromCoords,
	computeComponentCenter,
	DIFFABLE_TAGS,
	extractElements,
	extractPrimitives,
	extractRefDes,
	findGBlocks,
	findWorksheetRanges,
	GEO_ATTRS,
	getComponentType,
	getDistance,
	getElementCenter,
	getSegmentEndpoints,
	isWorksheetFrameElement,
	parseAttributes,
	TOLERANCE_EPSILON,
} from "../../backend/src/svg-primitives.js";

describe("SVG Primitives & Geometry Parsing Engine", () => {
	test("exported constants define expected shapes and values", () => {
		assert.equal(TOLERANCE_EPSILON, 0.001);
		assert.equal(DIFFABLE_TAGS.includes("path"), true);
		assert.equal(DIFFABLE_TAGS.includes("circle"), true);
		assert.equal(GEO_ATTRS.includes("cx"), true);
		assert.equal(GEO_ATTRS.includes("viewBox"), true);
		assert.equal(COMPONENT_TYPE_MAP.R, "Resistor");
		assert.equal(COMPONENT_TYPE_MAP.C, "Capacitor");
		assert.equal(COMPONENT_TYPE_MAP.U, "Integrated Circuit");
	});

	test("getComponentType identifies component prefix or defaults", () => {
		const cases = [
			{ input: "R1", expected: "Resistor" },
			{ input: "RN5", expected: "Resistor" },
			{ input: "C10", expected: "Capacitor" },
			{ input: "U2", expected: "Integrated Circuit" },
			{ input: "IC1", expected: "Integrated Circuit" },
			{ input: "D1", expected: "Diode" },
			{ input: "J3", expected: "Connector" },
			{ input: "P1", expected: "Connector" },
			{ input: "L2", expected: "Inductor" },
			{ input: "Y1", expected: "Crystal" },
			{ input: "X1", expected: "Crystal" },
			{ input: "Q1", expected: "Transistor" },
			{ input: "SW1", expected: "Switch" },
			{ input: "F1", expected: "Fuse" },
			{ input: "TP1", expected: "Test Point" },
			{ input: "r12", expected: "Resistor" },
			{ input: null, expected: "Component" },
			{ input: "", expected: "Component" },
			{ input: "XYZ99", expected: "Component" },
			{ input: "123", expected: "Component" },
		];
		for (const tc of cases) {
			assert.equal(getComponentType(tc.input), tc.expected);
		}
	});

	test("parseAttributes parses key-value pairs from attribute strings", () => {
		const cases = [
			{
				input: 'x="10" y=\'20\' fill="none"',
				expected: { x: "10", y: "20", fill: "none" },
			},
			{
				input: 'inkscape:label="wire" stroke="#fff"',
				expected: { "inkscape:label": "wire", stroke: "#fff" },
			},
			{ input: 'empty=""', expected: { empty: "" } },
			{ input: "   ", expected: {} },
			{ input: "", expected: {} },
		];
		for (const tc of cases) {
			assert.deepEqual(parseAttributes(tc.input), tc.expected);
		}
	});

	test("buildPrimitiveKeys separates geo and non-geo attributes", () => {
		const tag = "circle";
		const attrs = { cx: "10", cy: "20", r: "5", fill: "red", id: "c1" };
		const attrStr = ' cx="10" cy="20" r="5" fill="red" id="c1" ';
		const res = buildPrimitiveKeys(tag, attrs, attrStr);

		assert.equal(res.geoKey, "cx=10;cy=20;r=5");
		assert.equal(res.idKey, "circle|fill=red;id=c1");
		assert.equal(
			res.fullKey,
			'circle||cx="10" cy="20" r="5" fill="red" id="c1"',
		);
	});

	test("buildPrimitiveKeys handles empty and single-category attributes", () => {
		const emptyRes = buildPrimitiveKeys("rect", {}, "");
		assert.equal(emptyRes.geoKey, "");
		assert.equal(emptyRes.idKey, "rect|");
		assert.equal(emptyRes.fullKey, "rect||");

		const nonGeoRes = buildPrimitiveKeys(
			"line",
			{ stroke: "blue" },
			'stroke="blue"',
		);
		assert.equal(nonGeoRes.geoKey, "");
		assert.equal(nonGeoRes.idKey, "line|stroke=blue");
		assert.equal(nonGeoRes.fullKey, 'line||stroke="blue"');
	});

	test("checkPathIsClosed determines whether path has fill", () => {
		const cases = [
			{ tag: "path", attrs: { fill: "#123456" }, expected: true },
			{ tag: "path", attrs: { fill: "none" }, expected: false },
			{
				tag: "path",
				attrs: { style: "fill:#ff0000;stroke:black" },
				expected: true,
			},
			{
				tag: "path",
				attrs: { style: "fill:none;stroke:black" },
				expected: false,
			},
			{
				tag: "path",
				attrs: { style: "fill: none;stroke:black" },
				expected: false,
			},
			{ tag: "circle", attrs: { fill: "red" }, expected: false },
			{ tag: "path", attrs: {}, expected: false },
		];
		for (const tc of cases) {
			assert.equal(checkPathIsClosed(tc.tag, tc.attrs), tc.expected);
		}
	});

	test("getSegmentEndpoints returns start and end for valid lines and paths", () => {
		const lineEl = {
			tag: "line",
			fullMatch: '<line x1="10" y1="20" x2="30" y2="40" />',
		};
		assert.deepEqual(getSegmentEndpoints(lineEl), {
			start: { x: 10, y: 20 },
			end: { x: 30, y: 40 },
		});

		const pathEl = {
			tag: "path",
			fullMatch: '<path d="M 12 34 L 56 78" />',
		};
		assert.deepEqual(getSegmentEndpoints(pathEl), {
			start: { x: 12, y: 34 },
			end: { x: 56, y: 78 },
		});
	});

	test("getSegmentEndpoints returns null or defaults for non-segments and empty paths", () => {
		const emptyLine = { tag: "line", fullMatch: "<line />" };
		assert.deepEqual(getSegmentEndpoints(emptyLine), {
			start: { x: 0, y: 0 },
			end: { x: 0, y: 0 },
		});

		const shortPath = { tag: "path", fullMatch: '<path d="M 10 20" />' };
		assert.equal(getSegmentEndpoints(shortPath), null);

		const circleEl = { tag: "circle", fullMatch: '<circle cx="5" cy="5" />' };
		assert.equal(getSegmentEndpoints(circleEl), null);
	});

	test("computeBoundingCenterFromCoords calculates bounding box center", () => {
		const cases = [
			{ coords: ["0", "10", "20", "30"], expected: { x: 10, y: 20 } },
			{ coords: ["0", "0", "10", "10", "99"], expected: { x: 5, y: 5 } },
			{ coords: null, expected: null },
			{ coords: [], expected: null },
			{ coords: ["5"], expected: null },
			{ coords: ["invalid", "nan"], expected: null },
		];
		for (const tc of cases) {
			assert.deepEqual(computeBoundingCenterFromCoords(tc.coords), tc.expected);
		}
	});

	test("getElementCenter calculates center for circular and rectangular elements", () => {
		const cases = [
			{ el: { center: { x: 11, y: 22 } }, expected: { x: 11, y: 22 } },
			{
				el: { tag: "circle", fullMatch: '<circle cx="15" cy="25"/>' },
				expected: { x: 15, y: 25 },
			},
			{
				el: { tag: "ellipse", fullMatch: '<ellipse cx="35" cy="45"/>' },
				expected: { x: 35, y: 45 },
			},
			{
				el: {
					tag: "rect",
					fullMatch: '<rect x="10" y="20" width="30" height="40"/>',
				},
				expected: { x: 25, y: 40 },
			},
		];
		for (const tc of cases) {
			assert.deepEqual(getElementCenter(tc.el), tc.expected);
		}
	});

	test("getElementCenter calculates center for lines, paths, and fallback elements", () => {
		const cases = [
			{
				el: {
					tag: "line",
					fullMatch: '<line x1="0" y1="10" x2="20" y2="30"/>',
				},
				expected: { x: 10, y: 20 },
			},
			{
				el: { tag: "polygon", fullMatch: '<polygon points="0,0 20,40"/>' },
				expected: { x: 10, y: 20 },
			},
			{
				el: { tag: "path", fullMatch: '<path d="M 0 0 L 20 40"/>' },
				expected: { x: 10, y: 20 },
			},
			{
				el: { tag: "text", fullMatch: '<text x="15" y="25">Label</text>' },
				expected: { x: 15, y: 25 },
			},
			{
				el: { tag: "unknown", fullMatch: "<unknown />" },
				expected: { x: 0, y: 0 },
			},
		];
		for (const tc of cases) {
			assert.deepEqual(getElementCenter(tc.el), tc.expected);
		}
	});

	test("getDistance calculates euclidean distance between two elements", () => {
		const cases = [
			{
				el1: { center: { x: 0, y: 0 } },
				el2: { center: { x: 3, y: 4 } },
				expected: 5,
			},
			{
				el1: { tag: "circle", fullMatch: '<circle cx="10" cy="10"/>' },
				el2: { tag: "circle", fullMatch: '<circle cx="10" cy="10"/>' },
				expected: 0,
			},
		];
		for (const tc of cases) {
			assert.equal(getDistance(tc.el1, tc.el2), tc.expected);
		}
	});

	test("extractPrimitives parses diffable elements from SVG", () => {
		const svg =
			'<svg><rect x="0" y="0" width="10" height="20" id="r1" /><circle cx="5" cy="5" r="2" /><text x="1" y="2"><b>R1</b></text></svg>';
		const prims = extractPrimitives(svg);
		assert.equal(prims.length, 3);
		assert.equal(prims[0].tag, "rect");
		assert.equal(prims[0].id, "r1");
		assert.equal(prims[1].tag, "circle");
		assert.equal(prims[2].tag, "text");
		assert.equal(prims[2].text, "R1");

		assert.deepEqual(extractPrimitives(""), []);
		assert.deepEqual(extractPrimitives("<svg><defs></defs></svg>"), []);
	});

	test("findGBlocks extracts stroked-text component blocks", () => {
		const svg =
			'<svg><g class="stroked-text"><desc>R12</desc><path d="M0 0"/></g></svg>';
		const blocks = findGBlocks(svg);
		assert.equal(blocks.length, 1);
		assert.equal(blocks[0].refDes, "R12");
		assert.equal(blocks[0].attrStr, 'class="stroked-text"');

		assert.deepEqual(findGBlocks(""), []);
		assert.deepEqual(
			findGBlocks('<g class="stroked-text"><desc>NODIGITS</desc></g>'),
			[],
		);
	});

	test("findWorksheetRanges tracks worksheet group boundary ranges", () => {
		const svg =
			'<g style="stroke:#C872AB"><g><line x1="0" y1="0" x2="10" y2="10"/></g></g>';
		const ranges = findWorksheetRanges(svg);
		assert.equal(ranges.length, 1);
		assert.equal(ranges[0].start, 0);
		assert.equal(ranges[0].end, svg.length);

		assert.deepEqual(findWorksheetRanges(""), []);
		assert.deepEqual(
			findWorksheetRanges('<g style="stroke:#000000"><line/></g>'),
			[],
		);
	});

	test("isWorksheetFrameElement detects magenta, in-range, and page rect elements", () => {
		const cases = [
			{
				el: { fullMatch: '<path style="stroke:#C872AB"/>' },
				ranges: [],
				expected: true,
			},
			{
				el: { fullMatch: '<path d="M0 0"/>', startIndex: 25 },
				ranges: [{ start: 10, end: 50 }],
				expected: true,
			},
			{
				el: { tag: "rect", fullMatch: '<rect width="200" height="150"/>' },
				ranges: [],
				expected: true,
			},
			{
				el: { tag: "circle", fullMatch: '<circle cx="200" cy="160" r="5"/>' },
				ranges: [],
				expected: true,
			},
		];
		for (const tc of cases) {
			assert.equal(isWorksheetFrameElement(tc.el, tc.ranges), tc.expected);
		}
	});

	test("isWorksheetFrameElement handles color overrides, spatial fallback, and nulls", () => {
		const cases = [
			{
				el: { fullMatch: '<line style="stroke:#ff0000"/>', startIndex: 50 },
				ranges: [{ start: 0, end: 100 }],
				expected: false,
			},
			{
				el: { tag: "circle", fullMatch: '<circle cx="10" cy="10" r="5"/>' },
				ranges: [],
				expected: false,
			},
			{ el: null, ranges: [], expected: false },
		];
		for (const tc of cases) {
			assert.equal(isWorksheetFrameElement(tc.el, tc.ranges), tc.expected);
		}
	});

	test("computeComponentCenter finds anchor text or geometric center", () => {
		const blockWithText = {
			innerContent: '<text x="45.5" y="80.5">R1</text>',
		};
		assert.deepEqual(computeComponentCenter(blockWithText), {
			x: 45.5,
			y: 80.5,
		});

		const blockWithPrimitives = {
			innerContent:
				'<circle cx="30" cy="40" r="5"/><circle cx="50" cy="60" r="5"/>',
		};
		assert.deepEqual(computeComponentCenter(blockWithPrimitives), {
			x: 40,
			y: 50,
		});

		const emptyBlock = { innerContent: "" };
		assert.deepEqual(computeComponentCenter(emptyBlock), { x: 0, y: 0 });
	});

	test("extractRefDes extracts reference designator from elements", () => {
		const cases = [
			{ el: { refDes: "R5" }, expected: "R5" },
			{ el: { tag: "text", text: " c12 " }, expected: "C12" },
			{ el: { tag: "text", text: "GND" }, expected: "GND" },
			{ el: { id: "component_U3_pad" }, expected: "U3" },
			{ el: { label: "SW2_body" }, expected: "SW2" },
			{ el: {}, expected: null },
			{ el: { tag: "circle", id: "net_clk", label: "" }, expected: null },
		];
		for (const tc of cases) {
			assert.equal(extractRefDes(tc.el), tc.expected);
		}
	});

	test("extractElements decomposes SVG into components and primitives", () => {
		const svg =
			'<svg><g class="stroked-text"><desc>R1</desc><text x="10" y="20">R1</text></g><circle cx="5" cy="5" r="2" id="c1" /></svg>';
		const elements = extractElements(svg);
		assert.equal(elements.length, 2);
		assert.equal(elements[0].tag, "g");
		assert.equal(elements[0].isComponent, true);
		assert.equal(elements[0].refDes, "R1");
		assert.deepEqual(elements[0].center, { x: 10, y: 20 });
		assert.equal(elements[1].tag, "circle");
		assert.equal(elements[1].isComponent, false);
		assert.equal(elements[1].id, "c1");

		assert.deepEqual(extractElements(""), []);

		const framedSvg =
			'<svg><g style="stroke:#C872AB"><g class="stroked-text"><desc>R1</desc><text x="10" y="20">R1</text></g></g></svg>';
		const framedElements = extractElements(framedSvg);
		const compElements = framedElements.filter((e) => e.isComponent);
		assert.equal(compElements.length, 0);
	});
});
