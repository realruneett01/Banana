import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	detectEvents,
	formatTime,
	frameAt,
	playbackClock,
} from "../../frontend/src/components/sim3d/transientModel.js";

describe("transientModel - frameAt (interpolation and clamping)", () => {
	const sampleSeries = {
		time: [0, 0.005, 0.01],
		nodeVoltages: {
			net1: [0, 2.5, 5.0],
			net2: [10, 10, 10],
		},
		partCurrents: {
			D1: [0, 0.01, 0.02],
		},
	};

	test("returns empty objects for null or empty series", () => {
		assert.deepEqual(frameAt(null, 0.005), {
			nodeVoltages: {},
			partCurrents: {},
		});
		assert.deepEqual(frameAt({ time: [] }, 0.005), {
			nodeVoltages: {},
			partCurrents: {},
		});
	});

	test("clamps time below minimum and above maximum", () => {
		const atMin = frameAt(sampleSeries, -0.01);
		assert.equal(atMin.nodeVoltages.net1, 0);
		assert.equal(atMin.partCurrents.D1, 0);

		const atMax = frameAt(sampleSeries, 0.05);
		assert.equal(atMax.nodeVoltages.net1, 5.0);
		assert.equal(atMax.partCurrents.D1, 0.02);
	});

	test("matches exact sample points", () => {
		const frame0 = frameAt(sampleSeries, 0);
		assert.equal(frame0.nodeVoltages.net1, 0);
		assert.equal(frame0.nodeVoltages.net2, 10);
		assert.equal(frame0.partCurrents.D1, 0);

		const frameMid = frameAt(sampleSeries, 0.005);
		assert.equal(frameMid.nodeVoltages.net1, 2.5);
		assert.equal(frameMid.partCurrents.D1, 0.01);
	});

	test("linearly interpolates between sample points", () => {
		const frame = frameAt(sampleSeries, 0.0025);
		assert.equal(frame.nodeVoltages.net1, 1.25);
		assert.equal(frame.nodeVoltages.net2, 10);
		assert.equal(frame.partCurrents.D1, 0.005);
	});

	test("handles single-point series gracefully", () => {
		const singleSeries = {
			time: [0.002],
			nodeVoltages: { net1: [3.3] },
			partCurrents: { D1: [0.015] },
		};
		const frame = frameAt(singleSeries, 0.005);
		assert.equal(frame.nodeVoltages.net1, 3.3);
		assert.equal(frame.partCurrents.D1, 0.015);
	});
});

describe("transientModel - playbackClock (scaling, speed, and seek)", () => {
	test("maps real time to sim time to play in about 8 s at speed 1", () => {
		const clock = playbackClock({ durationS: 0.01, speed: 1 });
		assert.equal(clock.scale, 800);

		const tHalf = clock.advance(4);
		assert.ok(Math.abs(tHalf - 0.005) < 1e-6);

		const tFull = clock.advance(4);
		assert.ok(Math.abs(tFull - 0.01) < 1e-6);
	});

	test("honors speed multiplier during playback advance", () => {
		const clock2x = playbackClock({ durationS: 0.01, speed: 2 });
		const tDone = clock2x.advance(4);
		assert.ok(Math.abs(tDone - 0.01) < 1e-6);

		const clockHalf = playbackClock({ durationS: 0.01, speed: 0.5 });
		const tQuarter = clockHalf.advance(4);
		assert.ok(Math.abs(tQuarter - 0.0025) < 1e-6);
	});

	test("clamps advance at duration limit", () => {
		const clock = playbackClock({ durationS: 0.01, speed: 1 });
		const t = clock.advance(16);
		assert.equal(t, 0.01);
	});

	test("supports seek and reset", () => {
		const clock = playbackClock({ durationS: 0.01, speed: 1 });
		assert.equal(clock.seek(0.006), 0.006);
		assert.equal(clock.seek(0.5), 0.01);
		assert.equal(clock.seek(-1), 0);
		assert.equal(clock.reset(), 0);
	});
});

describe("transientModel - formatTime", () => {
	test("formats seconds, milliseconds, microseconds and zeroes", () => {
		const cases = [
			{ input: 0.0032, expected: "3.2 ms" },
			{ input: 0.01, expected: "10.0 ms" },
			{ input: 0.0005, expected: "500.0 µs" },
			{ input: 2.5, expected: "2.50 s" },
			{ input: 0, expected: "0 ms" },
		];
		for (const tc of cases) {
			assert.equal(formatTime(tc.input), tc.expected);
		}
	});
});

describe("transientModel - detectEvents (LED on/off, spike)", () => {
	test("returns empty array for invalid or empty series", () => {
		assert.deepEqual(detectEvents(null), []);
		assert.deepEqual(detectEvents({ time: [] }), []);
	});

	test("detects LED turn on and turn off events with plain English text", () => {
		const series = {
			time: [0, 0.001, 0.002, 0.0032, 0.005, 0.008, 0.01],
			nodeVoltages: {},
			partCurrents: {
				D1: [0, 0.0002, 0.0008, 0.015, 0.015, 0.0005, 0],
			},
		};
		const ir = {
			parts: [{ id: "D1", ref: "D1", symbol: "Device:LED", value: "Red LED" }],
		};

		const events = detectEvents(series, ir);
		assert.equal(events.length, 2);

		assert.equal(events[0].kind, "turn_on");
		assert.equal(events[0].partId, "D1");
		assert.equal(events[0].t, 0.0032);
		assert.equal(events[0].text, "LED D1 turns on at 3.2 ms");

		assert.equal(events[1].kind, "turn_off");
		assert.equal(events[1].partId, "D1");
		assert.equal(events[1].t, 0.008);
		assert.equal(events[1].text, "LED D1 turns off at 8.0 ms");
	});

	test("detects current spikes exceeding 3x median", () => {
		const series = {
			time: [0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006],
			nodeVoltages: {},
			partCurrents: {
				R1: [0.01, 0.01, 0.01, 0.01, 0.05, 0.01, 0.01],
			},
		};
		const ir = {
			parts: [{ id: "R1", ref: "R1", symbol: "Device:R" }],
		};

		const events = detectEvents(series, ir);
		assert.equal(events.length, 1);
		assert.equal(events[0].kind, "spike");
		assert.equal(events[0].partId, "R1");
		assert.equal(events[0].t, 0.004);
		assert.equal(events[0].text, "Current spike on R1 at 4.0 ms");
	});
});
