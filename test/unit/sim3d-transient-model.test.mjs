import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	detectEvents,
	formatTime,
	frameAt,
	playbackClock,
} from "../../frontend/src/components/sim3d/transientModel.js";

const SAMPLE_SERIES = {
	time: [0, 0.005, 0.01],
	nodeVoltages: {
		net1: [0, 2.5, 5.0],
		net2: [10, 10, 10],
	},
	partCurrents: {
		D1: [0, 0.01, 0.02],
	},
};

const SINGLE_SERIES = {
	time: [0.002],
	nodeVoltages: { net1: [3.3] },
	partCurrents: { D1: [0.015] },
};

function assertFrame(frame, voltages = {}, currents = {}) {
	for (const [net, val] of Object.entries(voltages)) {
		assert.equal(frame.nodeVoltages[net], val);
	}
	for (const [part, val] of Object.entries(currents)) {
		assert.equal(frame.partCurrents[part], val);
	}
}

function makeClock(options = {}) {
	return playbackClock({ durationS: 0.01, speed: 1, ...options });
}

function assertNear(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-6);
}

function assertEvents(events, expected) {
	assert.equal(events.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		for (const key of ["kind", "partId", "t", "text"]) {
			assert.equal(events[i][key], expected[i][key]);
		}
	}
}

const run = (t, voltages, currents) => ({ t, voltages, currents });
const ev = (kind, partId, t, text) => ({ kind, partId, t, text });
const currentSeries = (time, partCurrents) => ({
	time,
	nodeVoltages: {},
	partCurrents,
});

const FRAME_TEST_CASES = [
	{
		name: "clamps time below minimum and above maximum",
		runs: [
			run(-0.01, { net1: 0 }, { D1: 0 }),
			run(0.05, { net1: 5.0 }, { D1: 0.02 }),
		],
	},
	{
		name: "matches exact sample points",
		runs: [
			run(0, { net1: 0, net2: 10 }, { D1: 0 }),
			run(0.005, { net1: 2.5 }, { D1: 0.01 }),
		],
	},
	{
		name: "linearly interpolates between sample points",
		runs: [run(0.0025, { net1: 1.25, net2: 10 }, { D1: 0.005 })],
	},
	{
		name: "handles single-point series gracefully",
		series: SINGLE_SERIES,
		runs: [run(0.005, { net1: 3.3 }, { D1: 0.015 })],
	},
];

const EVENT_TEST_CASES = [
	{
		name: "detects LED turn on and turn off events with plain English text",
		series: currentSeries([0, 0.001, 0.002, 0.0032, 0.005, 0.008, 0.01], {
			D1: [0, 0.0002, 0.0008, 0.015, 0.015, 0.0005, 0],
		}),
		ir: {
			parts: [{ id: "D1", ref: "D1", symbol: "Device:LED", value: "Red LED" }],
		},
		expected: [
			ev("turn_on", "D1", 0.0032, "LED D1 turns on at 3.2 ms"),
			ev("turn_off", "D1", 0.008, "LED D1 turns off at 8.0 ms"),
		],
	},
	{
		name: "detects current spikes exceeding 3x median",
		series: currentSeries([0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006], {
			R1: [0.01, 0.01, 0.01, 0.01, 0.05, 0.01, 0.01],
		}),
		ir: { parts: [{ id: "R1", ref: "R1", symbol: "Device:R" }] },
		expected: [ev("spike", "R1", 0.004, "Current spike on R1 at 4.0 ms")],
	},
];

describe("transientModel - frameAt (interpolation and clamping)", () => {
	test("returns empty objects for null or empty series", () => {
		const emptyFrame = { nodeVoltages: {}, partCurrents: {} };
		for (const input of [null, { time: [] }]) {
			assert.deepEqual(frameAt(input, 0.005), emptyFrame);
		}
	});

	for (const { name, series, runs } of FRAME_TEST_CASES) {
		test(name, () => {
			const target = series ?? SAMPLE_SERIES;
			for (const { t, voltages, currents } of runs) {
				assertFrame(frameAt(target, t), voltages, currents);
			}
		});
	}
});

describe("transientModel - playbackClock (scaling, speed, and seek)", () => {
	test("maps real time to sim time to play in about 8 s at speed 1", () => {
		const clock = makeClock();
		assert.equal(clock.scale, 800);
		assertNear(clock.advance(4), 0.005);
		assertNear(clock.advance(4), 0.01);
	});

	test("honors speed multiplier during playback advance", () => {
		for (const [speed, expected] of [
			[2, 0.01],
			[0.5, 0.0025],
		]) {
			const clock = makeClock({ speed });
			assertNear(clock.advance(4), expected);
		}
	});

	test("clamps advance at duration limit", () => {
		const clock = makeClock();
		assert.equal(clock.advance(16), 0.01);
	});

	test("supports seek and reset", () => {
		const clock = makeClock();
		for (const [target, expected] of [
			[0.006, 0.006],
			[0.5, 0.01],
			[-1, 0],
		]) {
			assert.equal(clock.seek(target), expected);
		}
		assert.equal(clock.reset(), 0);
	});
});

describe("transientModel - formatTime", () => {
	test("formats seconds, milliseconds, microseconds and zeroes", () => {
		const cases = [
			[0.0032, "3.2 ms"],
			[0.01, "10.0 ms"],
			[0.0005, "500.0 µs"],
			[2.5, "2.50 s"],
			[0, "0 ms"],
		];
		for (const [input, expected] of cases) {
			assert.equal(formatTime(input), expected);
		}
	});
});

describe("transientModel - detectEvents (LED on/off, spike)", () => {
	test("returns empty array for invalid or empty series", () => {
		for (const input of [null, { time: [] }]) {
			assert.deepEqual(detectEvents(input), []);
		}
	});

	for (const { name, series, ir, expected } of EVENT_TEST_CASES) {
		test(name, () => {
			assertEvents(detectEvents(series, ir), expected);
		});
	}
});
