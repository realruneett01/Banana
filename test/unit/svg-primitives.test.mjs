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

function checkPairs(cases) {
	for (const [actual, expected, deep] of cases) {
		if (deep) {
			assert.deepEqual(actual, expected);
		} else {
			assert.equal(actual, expected);
		}
	}
}

function checkUnaryCases(fn, cases, deep = false) {
	checkPairs(cases.map(([input, expected]) => [fn(input), expected, deep]));
}

function checkEmptyOutputs(fn, inputs) {
	checkPairs(inputs.map((input) => [fn(input), [], true]));
}

function checkElementCenters(cases) {
	checkPairs(
		cases.map((item) => {
			if (item.length === 2) {
				return [getElementCenter(item[0]), item[1], true];
			}
			const [tag, fullMatch, x, y] = item;
			return [getElementCenter({ tag, fullMatch }), { x, y }, true];
		}),
	);
}

function checkFrameExpectations(cases, expected) {
	checkPairs(
		cases.map(([el, ranges]) => [
			isWorksheetFrameElement(el, ranges),
			expected,
		]),
	);
}

describe("SVG Primitives & Geometry Parsing Engine", () => {
	test("exported constants define expected shapes and values", () => {
		checkPairs([
			[TOLERANCE_EPSILON, 0.001],
			[DIFFABLE_TAGS.includes("path"), true],
			[DIFFABLE_TAGS.includes("circle"), true],
			[GEO_ATTRS.includes("cx"), true],
			[GEO_ATTRS.includes("viewBox"), true],
			[COMPONENT_TYPE_MAP.R, "Resistor"],
			[COMPONENT_TYPE_MAP.C, "Capacitor"],
			[COMPONENT_TYPE_MAP.U, "Integrated Circuit"],
		]);
	});

	test("getComponentType identifies component prefix or defaults", () => {
		checkUnaryCases(getComponentType, [
			["R1", "Resistor"],
			["RN5", "Resistor"],
			["C10", "Capacitor"],
			["U2", "Integrated Circuit"],
			["IC1", "Integrated Circuit"],
			["D1", "Diode"],
			["J3", "Connector"],
			["P1", "Connector"],
			["L2", "Inductor"],
			["Y1", "Crystal"],
			["X1", "Crystal"],
			["Q1", "Transistor"],
			["SW1", "Switch"],
			["F1", "Fuse"],
			["TP1", "Test Point"],
			["r12", "Resistor"],
			[null, "Component"],
			["", "Component"],
			["XYZ99", "Component"],
			["123", "Component"],
		]);
	});

	test("parseAttributes parses key-value pairs from attribute strings", () => {
		checkUnaryCases(
			parseAttributes,
			[
				['x="10" y=\'20\' fill="none"', { x: "10", y: "20", fill: "none" }],
				[
					'inkscape:label="wire" stroke="#fff"',
					{ "inkscape:label": "wire", stroke: "#fff" },
				],
				['empty=""', { empty: "" }],
				["   ", {}],
				["", {}],
			],
			true,
		);
	});

	test("buildPrimitiveKeys separates geo and non-geo attributes", () => {
		const tag = "circle";
		const attrs = { cx: "10", cy: "20", r: "5", fill: "red", id: "c1" };
		const attrStr = ' cx="10" cy="20" r="5" fill="red" id="c1" ';
		assert.deepEqual(buildPrimitiveKeys(tag, attrs, attrStr), {
			geoKey: "cx=10;cy=20;r=5",
			idKey: "circle|fill=red;id=c1",
			fullKey: 'circle||cx="10" cy="20" r="5" fill="red" id="c1"',
		});
	});

	test("buildPrimitiveKeys handles empty and single-category attributes", () => {
		const cases = [
			["rect", {}, "", { geoKey: "", idKey: "rect|", fullKey: "rect||" }],
			[
				"line",
				{ stroke: "blue" },
				'stroke="blue"',
				{
					geoKey: "",
					idKey: "line|stroke=blue",
					fullKey: 'line||stroke="blue"',
				},
			],
		];
		checkPairs(
			cases.map(([tag, attrs, attrStr, expected]) => [
				buildPrimitiveKeys(tag, attrs, attrStr),
				expected,
				true,
			]),
		);
	});

	test("checkPathIsClosed determines whether path has fill", () => {
		const cases = [
			["path", { fill: "#123456" }, true],
			["path", { fill: "none" }, false],
			["path", { style: "fill:#ff0000;stroke:black" }, true],
			["path", { style: "fill:none;stroke:black" }, false],
			["path", { style: "fill: none;stroke:black" }, false],
			["circle", { fill: "red" }, false],
			["path", {}, false],
		];
		checkPairs(
			cases.map(([tag, attrs, expected]) => [
				checkPathIsClosed(tag, attrs),
				expected,
			]),
		);
	});

	test("getSegmentEndpoints returns start and end for valid lines and paths", () => {
		checkUnaryCases(
			getSegmentEndpoints,
			[
				[
					{
						tag: "line",
						fullMatch: '<line x1="10" y1="20" x2="30" y2="40" />',
					},
					{ start: { x: 10, y: 20 }, end: { x: 30, y: 40 } },
				],
				[
					{ tag: "path", fullMatch: '<path d="M 12 34 L 56 78" />' },
					{ start: { x: 12, y: 34 }, end: { x: 56, y: 78 } },
				],
			],
			true,
		);
	});

	test("getSegmentEndpoints returns null or defaults for non-segments and empty paths", () => {
		checkPairs([
			[
				getSegmentEndpoints({ tag: "line", fullMatch: "<line />" }),
				{ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
				true,
			],
			[
				getSegmentEndpoints({ tag: "path", fullMatch: '<path d="M 10 20" />' }),
				null,
			],
			[
				getSegmentEndpoints({
					tag: "circle",
					fullMatch: '<circle cx="5" cy="5" />',
				}),
				null,
			],
		]);
	});

	test("computeBoundingCenterFromCoords calculates bounding box center", () => {
		checkUnaryCases(
			computeBoundingCenterFromCoords,
			[
				[["0", "10", "20", "30"], { x: 10, y: 20 }],
				[["0", "0", "10", "10", "99"], { x: 5, y: 5 }],
				[null, null],
				[[], null],
				[["5"], null],
				[["invalid", "nan"], null],
			],
			true,
		);
	});

	test("getElementCenter calculates center for circular and rectangular elements", () => {
		checkElementCenters([
			[{ center: { x: 11, y: 22 } }, { x: 11, y: 22 }],
			["circle", '<circle cx="15" cy="25"/>', 15, 25],
			["ellipse", '<ellipse cx="35" cy="45"/>', 35, 45],
			["rect", '<rect x="10" y="20" width="30" height="40"/>', 25, 40],
		]);
	});

	test("getElementCenter calculates center for lines, paths, and fallback elements", () => {
		checkElementCenters([
			["line", '<line x1="0" y1="10" x2="20" y2="30"/>', 10, 20],
			["polygon", '<polygon points="0,0 20,40"/>', 10, 20],
			["path", '<path d="M 0 0 L 20 40"/>', 10, 20],
			["text", '<text x="15" y="25">Label</text>', 15, 25],
			["unknown", "<unknown />", 0, 0],
		]);
	});

	test("getDistance calculates euclidean distance between two elements", () => {
		const cases = [
			[{ center: { x: 0, y: 0 } }, { center: { x: 3, y: 4 } }, 5],
			[
				{ tag: "circle", fullMatch: '<circle cx="10" cy="10"/>' },
				{ tag: "circle", fullMatch: '<circle cx="10" cy="10"/>' },
				0,
			],
		];
		checkPairs(
			cases.map(([el1, el2, expected]) => [getDistance(el1, el2), expected]),
		);
	});

	test("extractPrimitives parses diffable elements from SVG", () => {
		const svg =
			'<svg><rect x="0" y="0" width="10" height="20" id="r1" /><circle cx="5" cy="5" r="2" /><text x="1" y="2"><b>R1</b></text></svg>';
		const prims = extractPrimitives(svg);
		checkPairs([
			[prims.length, 3],
			[prims[0]?.tag, "rect"],
			[prims[0]?.id, "r1"],
			[prims[1]?.tag, "circle"],
			[prims[2]?.tag, "text"],
			[prims[2]?.text, "R1"],
		]);
		checkEmptyOutputs(extractPrimitives, ["", "<svg><defs></defs></svg>"]);
	});

	test("findGBlocks extracts stroked-text component blocks", () => {
		const svg =
			'<svg><g class="stroked-text"><desc>R12</desc><path d="M0 0"/></g></svg>';
		const blocks = findGBlocks(svg);
		checkPairs([
			[blocks.length, 1],
			[blocks[0]?.refDes, "R12"],
			[blocks[0]?.attrStr, 'class="stroked-text"'],
		]);
		checkEmptyOutputs(findGBlocks, [
			"",
			'<g class="stroked-text"><desc>NODIGITS</desc></g>',
		]);
	});

	test("findWorksheetRanges tracks worksheet group boundary ranges", () => {
		const svg =
			'<g style="stroke:#C872AB"><g><line x1="0" y1="0" x2="10" y2="10"/></g></g>';
		assert.deepEqual(findWorksheetRanges(svg), [{ start: 0, end: svg.length }]);
		checkEmptyOutputs(findWorksheetRanges, [
			"",
			'<g style="stroke:#000000"><line/></g>',
		]);
	});

	test("isWorksheetFrameElement detects magenta, in-range, and page rect elements", () => {
		checkFrameExpectations(
			[
				[{ fullMatch: '<path style="stroke:#C872AB"/>' }, []],
				[
					{ fullMatch: '<path d="M0 0"/>', startIndex: 25 },
					[{ start: 10, end: 50 }],
				],
				[{ tag: "rect", fullMatch: '<rect width="200" height="150"/>' }, []],
				[{ tag: "circle", fullMatch: '<circle cx="200" cy="160" r="5"/>' }, []],
			],
			true,
		);
	});

	test("isWorksheetFrameElement handles color overrides, spatial fallback, and nulls", () => {
		checkFrameExpectations(
			[
				[
					{ fullMatch: '<line style="stroke:#ff0000"/>', startIndex: 50 },
					[{ start: 0, end: 100 }],
				],
				[{ tag: "circle", fullMatch: '<circle cx="10" cy="10" r="5"/>' }, []],
				[null, []],
			],
			false,
		);
	});

	test("computeComponentCenter finds anchor text or geometric center", () => {
		checkUnaryCases(
			computeComponentCenter,
			[
				[
					{ innerContent: '<text x="45.5" y="80.5">R1</text>' },
					{ x: 45.5, y: 80.5 },
				],
				[
					{
						innerContent:
							'<circle cx="30" cy="40" r="5"/><circle cx="50" cy="60" r="5"/>',
					},
					{ x: 40, y: 50 },
				],
				[{ innerContent: "" }, { x: 0, y: 0 }],
			],
			true,
		);
	});

	test("extractRefDes extracts reference designator from elements", () => {
		checkUnaryCases(extractRefDes, [
			[{ refDes: "R5" }, "R5"],
			[{ tag: "text", text: " c12 " }, "C12"],
			[{ tag: "text", text: "GND" }, "GND"],
			[{ id: "component_U3_pad" }, "U3"],
			[{ label: "SW2_body" }, "SW2"],
			[{}, null],
			[{ tag: "circle", id: "net_clk", label: "" }, null],
		]);
	});

	test("extractElements decomposes SVG into components and primitives", () => {
		const svg =
			'<svg><g class="stroked-text"><desc>R1</desc><text x="10" y="20">R1</text></g><circle cx="5" cy="5" r="2" id="c1" /></svg>';
		const elements = extractElements(svg);
		checkPairs([
			[elements.length, 2],
			[elements[0]?.center, { x: 10, y: 20 }, true],
			[elements[0]?.tag, "g"],
			[elements[0]?.isComponent, true],
			[elements[0]?.refDes, "R1"],
			[elements[1]?.tag, "circle"],
			[elements[1]?.isComponent, false],
			[elements[1]?.id, "c1"],
		]);

		checkEmptyOutputs(extractElements, [""]);

		const framedSvg =
			'<svg><g style="stroke:#C872AB"><g class="stroked-text"><desc>R1</desc><text x="10" y="20">R1</text></g></g></svg>';
		const compElements = extractElements(framedSvg).filter(
			(e) => e.isComponent,
		);
		assert.equal(compElements.length, 0);
	});
});
