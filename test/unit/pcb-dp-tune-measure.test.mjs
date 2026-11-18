import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);

async function loadPureHelpers(sourceText) {
	const marker = "// --- PCB DiffPair, Tune, Measure pure helpers ---";
	const stop = "// --- End PCB DiffPair, Tune, Measure pure helpers ---";
	const helperBlock = sourceText.split(marker)[1]?.split(stop)[0];
	if (!helperBlock) {
		throw new Error("PCB pure helpers section missing");
	}
	const vpUrl = new URL(
		"../../frontend/src/editor/viewport.js",
		import.meta.url,
	).href;
	const modSource = `import { formatCoord } from "${vpUrl}";\n${helperBlock}`;
	const base64Code = Buffer.from(modSource).toString("base64");
	return import(`data:text/javascript;base64,${base64Code}`);
}

const {
	calcMeasureReadout,
	calcLengthTuneDefaults,
	resolveDiffPairDimensions,
	findPartnerPad,
	replaceTrackWithPoints,
} = await loadPureHelpers(pcbCanvasSrc);

function assertObjectSubset(actual, expected) {
	for (const [key, value] of Object.entries(expected)) {
		assert.deepEqual(actual[key], value);
	}
}

const partnerFixture = {
	ir: {
		nets: ["USB_D+", "USB_D-"].map((name, i) => ({
			id: i === 0 ? "net_dp_p" : "net_dp_n",
			name,
			pins: [
				{ partId: "U1", pin: String(i + 1) },
				{ partId: "J1", pin: String(i + 2) },
			],
		})),
	},
	padPositions: {
		U1: { 1: [10, 10], 2: [10, 12] },
		J1: { 2: [50, 10], 3: [50, 12] },
	},
	pads: [],
};

const MEASURE_READOUT_CASES = [
	{
		title: "calculates distance, dx, dy, and angle for horizontal segment",
		p1: [0, 0],
		p2: [10, 0],
		expected: {
			distance: 10,
			dx: 10,
			dy: 0,
			angle: 0,
			distStr: "10.0000 mm",
			dxStr: "10.0000 mm",
			dyStr: "0.0000 mm",
			angleStr: "0.0°",
		},
		textIncludes: "10.0000 mm",
	},
	{
		title: "calculates distance, dx, dy, and angle for 3-4-5 triangle",
		p1: { x: 0, y: 0 },
		p2: { x: 3, y: 4 },
		expected: {
			distance: 5,
			dx: 3,
			dy: 4,
			distStr: "5.0000 mm",
			angleStr: "53.1°",
		},
	},
];

const LENGTH_TUNE_CASES = [
	{
		title: "prefills target length with +10% and standard amplitude/spacing",
		len: 10,
		expected: {
			currentLength: 10,
			targetLengthMm: 11,
			amplitudeMm: 1.0,
			spacingMm: 0.6,
		},
	},
	{
		title: "handles fractional lengths correctly",
		len: 25.5,
		expected: {
			currentLength: 25.5,
			targetLengthMm: 28.05,
		},
	},
	{
		title: "handles zero or non-numeric input",
		len: 0,
		expected: {
			currentLength: 0,
			targetLengthMm: 0,
		},
	},
];

const DIFF_PAIR_CASES = [
	{
		title: "returns default 0.2 mm width and 0.25 mm gap when setup is empty",
		board: null,
		dims: { widthMm: 0.2, gapMm: 0.25 },
	},
	{
		title: "reads setup diffPairWidth and diffPairGap",
		board: { setup: { diffPairWidth: 0.35, diffPairGap: 0.15 } },
		dims: { widthMm: 0.35, gapMm: 0.15 },
	},
	{
		title: "reads snake_case setup values",
		board: { setup: { diff_pair_width: 0.18, diff_pair_gap: 0.22 } },
		dims: { widthMm: 0.18, gapMm: 0.22 },
	},
];

const PARTNER_PAD_CASES = [
	{
		title: "finds partner pad on the same part as start pad",
		startPad: { partId: "U1", pinNum: "1", pos: [10, 10], netName: "USB_D+" },
		partnerNet: "USB_D-",
		expected: { partId: "U1", pinNum: "2", pos: [10, 12] },
	},
	{
		title: "finds closest partner pad when no pad on same part exists",
		startPad: { partId: "R1", pinNum: "1", pos: [48, 11], netName: "USB_D+" },
		partnerNet: "USB_D-",
		expected: { partId: "J1", pinNum: "3", pos: [50, 12] },
	},
	{
		title: "returns null when partner net does not exist",
		startPad: { partId: "U1", pinNum: "1", pos: [10, 10], netName: "USB_D+" },
		partnerNet: "NONEXISTENT",
		expected: null,
	},
];

describe("calcMeasureReadout pure function", () => {
	for (const tc of MEASURE_READOUT_CASES) {
		test(tc.title, () => {
			const res = calcMeasureReadout(tc.p1, tc.p2, "mm");
			assertObjectSubset(res, tc.expected);
			if (tc.textIncludes) {
				assert.ok(res.text.includes(tc.textIncludes));
			}
		});
	}

	test("respects inches and mils units", () => {
		const inRes = calcMeasureReadout([0, 0], [25.4, 0], "in");
		assertObjectSubset(inRes, {
			distStr: "1.0000 in",
			dxStr: "1.0000 in",
		});

		const milRes = calcMeasureReadout([0, 0], [2.54, 0], "mil");
		assert.equal(milRes.distStr, "100.0 mil");
	});

	test("handles zero distance without NaN", () => {
		const res = calcMeasureReadout([5, 5], [5, 5], "mm");
		assertObjectSubset(res, {
			distance: 0,
			angle: 0,
			distStr: "0.0000 mm",
		});
	});
});

describe("calcLengthTuneDefaults pure function", () => {
	for (const { title, len, expected } of LENGTH_TUNE_CASES) {
		test(title, () => {
			assertObjectSubset(calcLengthTuneDefaults(len), expected);
		});
	}
});

describe("resolveDiffPairDimensions pure function", () => {
	for (const { title, board, dims } of DIFF_PAIR_CASES) {
		test(title, () => {
			assert.deepEqual(resolveDiffPairDimensions(board), dims);
		});
	}
});

describe("findPartnerPad pure function", () => {
	for (const { title, startPad, partnerNet, expected } of PARTNER_PAD_CASES) {
		test(title, () => {
			const partner = findPartnerPad(startPad, partnerNet, partnerFixture);
			if (expected === null) {
				assert.equal(partner, null);
			} else {
				assert.ok(partner);
				assertObjectSubset(partner, expected);
			}
		});
	}
});

describe("replaceTrackWithPoints pure function", () => {
	test("replaces single track with multiple segments from meander output", () => {
		const track = {
			netId: "NET1",
			layer: "F.Cu",
			start: [0, 0],
			end: [10, 0],
			widthMm: 0.25,
		};
		const points = [
			[0, 0],
			[4, 0],
			[4, 2],
			[6, 2],
			[6, 0],
			[10, 0],
		];
		const updated = replaceTrackWithPoints({ tracks: [track] }, 0, points);
		assert.equal(updated.tracks.length, 5);
		assertObjectSubset(updated.tracks[0], {
			start: [0, 0],
			end: [4, 0],
			netId: "NET1",
			layer: "F.Cu",
		});
	});
});

describe("PcbCanvas tool contracts", () => {
	test("contains tool bus registrations for routeDiffPair, tuneLength, and measure", () => {
		for (const name of ["routeDiffPair:", "tuneLength:", "measure:"]) {
			assert.ok(pcbCanvasSrc.includes(name));
		}
	});

	test("contains hotkey handling for 6, 7, and Ctrl+Shift+M", () => {
		for (const key of ['key === "6"', 'key === "7"']) {
			assert.ok(pcbCanvasSrc.includes(key));
		}
		const hasCombo = ["ctrlKey", "shiftKey", '"m"'].every((token) =>
			pcbCanvasSrc.includes(token),
		);
		assert.ok(hasCombo);
	});
});
