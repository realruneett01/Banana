import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isDiffPairName,
	offsetPath,
	partnerNetName,
	pathLength,
	proposeDiffPair,
} from "../../frontend/src/editor/diffPair.js";
import { meander, skewBetween } from "../../frontend/src/editor/lengthTune.js";

const PARTNER_NAME_CASES = [
	{ name: "USB_D+", expected: "USB_D-", isDiff: true },
	{ name: "USB_D-", expected: "USB_D+", isDiff: true },
	{ name: "CLK_P", expected: "CLK_N", isDiff: true },
	{ name: "CLK_N", expected: "CLK_P", isDiff: true },
	{ name: "diff_p", expected: "diff_n", isDiff: true },
	{ name: "diff_n", expected: "diff_p", isDiff: true },
	{ name: "TXP", expected: "TXN", isDiff: true },
	{ name: "TXN", expected: "TXP", isDiff: true },
	{ name: "rxp", expected: "rxn", isDiff: true },
	{ name: "rxn", expected: "rxp", isDiff: true },
	{ name: "GND", expected: null, isDiff: false },
	{ name: "VCC", expected: null, isDiff: false },
	{ name: "+5V", expected: null, isDiff: false },
	{ name: "", expected: null, isDiff: false },
	{ name: null, expected: null, isDiff: false },
];

describe("diffPair - partner names table", () => {
	for (const { name, expected, isDiff } of PARTNER_NAME_CASES) {
		test(`handles net name "${name}"`, () => {
			assert.equal(partnerNetName(name), expected);
			assert.equal(isDiffPairName(name), isDiff);
		});
	}
});

const PATH_LENGTH_CASES = [
	{ title: "empty polyline", points: [], expected: 0 },
	{ title: "single point", points: [[5, 5]], expected: 0 },
	{
		title: "diagonal line",
		points: [
			[0, 0],
			[3, 4],
		],
		expected: 5,
	},
	{
		title: "orthogonal corner",
		points: [
			[0, 0],
			[10, 0],
			[10, 10],
		],
		expected: 20,
	},
];

describe("diffPair - pathLength", () => {
	for (const { title, points, expected } of PATH_LENGTH_CASES) {
		test(`calculates length for ${title}`, () => {
			assert.equal(pathLength(points), expected);
		});
	}
});

const OFFSET_CASES = [
	{
		title: "offsets straight line left",
		path: [
			[0, 0],
			[10, 0],
		],
		dist: 2,
		expected: [
			[0, 2],
			[10, 2],
		],
	},
	{
		title: "offsets straight line right",
		path: [
			[0, 0],
			[10, 0],
		],
		dist: -2,
		expected: [
			[0, -2],
			[10, -2],
		],
	},
	{
		title: "offsets 90 degree corner left",
		path: [
			[0, 0],
			[10, 0],
			[10, 10],
		],
		dist: 2,
		expected: [
			[0, 2],
			[8, 2],
			[8, 10],
		],
	},
	{
		title: "offsets 90 degree corner right",
		path: [
			[0, 0],
			[10, 0],
			[10, 10],
		],
		dist: -2,
		expected: [
			[0, -2],
			[12, -2],
			[12, 10],
		],
	},
];

describe("diffPair - offsetPath", () => {
	for (const { title, path, dist, expected } of OFFSET_CASES) {
		test(title, () => {
			assert.deepEqual(offsetPath(path, dist), expected);
		});
	}

	test("offsets 45 degree corner with exact mitre distance", () => {
		const cos45 = Math.cos(Math.PI / 4);
		const sin45 = Math.sin(Math.PI / 4);
		const path = [
			[0, 0],
			[10, 0],
			[10 + 10 * cos45, 10 * sin45],
		];
		const offset = offsetPath(path, 2);
		const corner = offset[1];
		const expectedX = 10 + 2 * (1 - Math.SQRT2);
		assert.ok(Math.abs(corner[1] - 2) < 1e-6);
		assert.ok(Math.abs(corner[0] - expectedX) < 1e-6);
	});
});

describe("diffPair - proposeDiffPair", () => {
	test("creates p and n tracks offset symmetrically from centerline", () => {
		const centerline = [
			[0, 0],
			[20, 0],
		];
		const { p, n } = proposeDiffPair({
			centerline,
			widthMm: 0.25,
			gapMm: 0.25,
		});
		assert.deepEqual(p, [
			[0, 0.25],
			[20, 0.25],
		]);
		assert.deepEqual(n, [
			[0, -0.25],
			[20, -0.25],
		]);
	});
});

function ccw(p1, p2, p3) {
	return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function signsDiffer(a, b) {
	return (a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9);
}

function segmentsCross(s1, e1, s2, e2) {
	const c1 = ccw(s1, e1, s2);
	const c2 = ccw(s1, e1, e2);
	const c3 = ccw(s2, e2, s1);
	const c4 = ccw(s2, e2, e1);
	return signsDiffer(c1, c2) && signsDiffer(c3, c4);
}

function checkSegmentAgainstRest(pts, i) {
	for (let j = i + 2; j < pts.length - 1; j++) {
		if (segmentsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) {
			return true;
		}
	}
	return false;
}

function hasSelfIntersection(pts) {
	for (let i = 0; i < pts.length - 1; i++) {
		if (checkSegmentAgainstRest(pts, i)) return true;
	}
	return false;
}

const IMPOSSIBLE_CASES = [
	{ title: "target exceeds max bumps", target: 100 },
	{ title: "target shorter than line", target: 10 },
];

describe("lengthTune - meander", () => {
	test("reaches target on straight 20 mm line to 30 mm without self-intersection", () => {
		const points = [
			[0, 0],
			[20, 0],
		];
		const res = meander({
			points,
			targetLengthMm: 30,
			amplitudeMm: 2,
			spacingMm: 1,
		});
		assert.equal(res.reached, true);
		assert.ok(Math.abs(res.lengthMm - 30) <= 0.05);
		assert.deepEqual(res.points[0], [0, 0]);
		assert.deepEqual(res.points[res.points.length - 1], [20, 0]);
		assert.equal(hasSelfIntersection(res.points), false);
	});

	for (const { title, target } of IMPOSSIBLE_CASES) {
		test(`reports reached=false when ${title}`, () => {
			const res = meander({
				points: [
					[0, 0],
					[20, 0],
				],
				targetLengthMm: target,
				amplitudeMm: 2,
				spacingMm: 1,
			});
			assert.equal(res.reached, false);
		});
	}
});

const SKEW_CASES = [
	{
		p: [
			[0, 0],
			[30, 0],
		],
		n: [
			[0, 0],
			[28, 0],
		],
		expected: 2,
	},
	{
		p: [
			[0, 0],
			[20, 0],
		],
		n: [
			[0, 0],
			[25, 0],
		],
		expected: 5,
	},
];

describe("lengthTune - skewBetween", () => {
	for (const { p, n, expected } of SKEW_CASES) {
		test(`computes length difference of ${expected} mm`, () => {
			assert.equal(skewBetween(p, n), expected);
		});
	}
});
