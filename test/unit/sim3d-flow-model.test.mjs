import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildFlowPaths,
	clamp,
	createFlowState,
	faultEffects,
	positionAt,
	stepFlow,
	temperatureColor,
} from "../../frontend/src/components/sim3d/flowModel.js";

function makeSegment(overrides = {}) {
	return {
		netId: "NET_VCC",
		points: [
			[0, 0, 0],
			[10, 0, 0],
			[10, 10, 0],
		],
		widthMm: 0.25,
		...overrides,
	};
}

function buildSinglePath({
	current = 0,
	netId = "N0",
	points,
	widthMm = 0.25,
} = {}) {
	const segOpts = { netId, widthMm };
	if (points) {
		segOpts.points = points;
	}
	const [path] = buildFlowPaths({
		netCurrents: { [netId]: current },
		segments: [makeSegment(segOpts)],
	});
	return path;
}

function createStepScenario({ current, distance, netId }) {
	const path = {
		cumulative: [0, 20],
		current,
		length: 20,
		netId,
		points: [
			[0, 0, 0],
			[20, 0, 0],
		],
		speed: 10,
	};
	const initialParticle = {
		color: [0, 0.5, 1],
		distance,
		id: 1,
		netId,
		pathIndex: 0,
		position: [distance, 0, 0],
	};
	const state = { paths: [path], particles: [initialParticle] };
	return { state, stepped: stepFlow(state, 0.5) };
}

function assertParticleState(particle, expectedDistance, expectedPosition) {
	assert.deepEqual(
		{ distance: particle.distance, position: particle.position },
		{ distance: expectedDistance, position: expectedPosition },
	);
}

const faultPaths = [
	{
		cumulative: [0, 10],
		length: 10,
		netId: "NET_A",
		points: [
			[0, 0, 0],
			[10, 0, 0],
		],
	},
	{
		cumulative: [0, 20],
		length: 20,
		netId: "NET_B",
		points: [
			[0, 10, 0],
			[20, 10, 0],
		],
	},
];

function assertSingleFaultEffect(faults, expected, customPaths = faultPaths) {
	const effects = faultEffects(faults, customPaths);
	assert.equal(effects.length, 1);
	const [effect] = effects;
	for (const [key, val] of Object.entries(expected)) {
		const assertFn = key === "position" ? assert.deepEqual : assert.equal;
		assertFn(effect[key], val);
	}
}

const GEOMETRY_CASES = [
	{
		expectedCumulative: [0, 10],
		expectedLength: 10,
		points: [
			[0, 0, 0],
			[10, 0, 0],
		],
	},
	{
		expectedCumulative: [0, 5, 17],
		expectedLength: 17,
		points: [
			[0, 0, 0],
			[3, 4, 0],
			[3, 4, 12],
		],
	},
	{
		expectedCumulative: [0],
		expectedLength: 0,
		points: [[1, 2, 3]],
	},
	{
		expectedCumulative: [],
		expectedLength: 0,
		points: [],
	},
];

describe("sim3d flowModel - geometry & paths", () => {
	test("clamp restricts values within min and max boundaries", () => {
		assert.equal(clamp(5, 0, 10), 5);
		assert.equal(clamp(-2, 0, 10), 0);
		assert.equal(clamp(15, 0, 10), 10);
	});

	test("calculates lengths and cumulative distance arrays correctly", () => {
		for (const tc of GEOMETRY_CASES) {
			const path = buildSinglePath({ points: tc.points });
			assert.deepEqual(
				{ cumulative: path.cumulative, length: path.length },
				{ cumulative: tc.expectedCumulative, length: tc.expectedLength },
			);
		}
	});

	test("interpolates 3D position along cumulative lengths", () => {
		const path = {
			cumulative: [0, 10, 30],
			length: 30,
			points: [
				[0, 0, 0],
				[10, 0, 0],
				[10, 20, 0],
			],
		};

		const testCases = [
			{ dist: -5, expected: [0, 0, 0] },
			{ dist: 0, expected: [0, 0, 0] },
			{ dist: 5, expected: [5, 0, 0] },
			{ dist: 10, expected: [10, 0, 0] },
			{ dist: 20, expected: [10, 10, 0] },
			{ dist: 30, expected: [10, 20, 0] },
			{ dist: 40, expected: [10, 20, 0] },
		];

		for (const tc of testCases) {
			const pos = positionAt(path, tc.dist);
			assert.deepEqual(pos, tc.expected);
		}
	});
});

describe("sim3d flowModel - current & speed scaling", () => {
	test("speed and particle count scale with current", () => {
		const low = buildSinglePath({ current: 0.5, netId: "N1" });
		const high = buildSinglePath({ current: 1.0, netId: "N1" });

		assert.ok(high.speed > low.speed, "speed scales with current");
		assert.ok(
			high.particleCount > low.particleCount,
			"particle count scales with current",
		);
		assert.equal(high.speed, low.speed * 2, "speed is 2x for 2x current");
	});

	test("wider trace reduces speed for the same current", () => {
		const thinPath = buildSinglePath({
			current: 1.0,
			netId: "THIN",
			widthMm: 0.2,
		});
		const thickPath = buildSinglePath({
			current: 1.0,
			netId: "THICK",
			widthMm: 0.4,
		});

		assert.ok(
			thinPath.speed > thickPath.speed,
			"narrow trace has higher flow velocity",
		);
	});

	test("zero or sub-microamp current yields no particles and zero speed", () => {
		const cases = [
			{ current: 0, desc: "zero current" },
			{ current: 5e-7, desc: "below 1e-6 A" },
			{ current: -8e-7, desc: "negative below 1e-6 A" },
		];

		for (const c of cases) {
			const path = buildSinglePath({ current: c.current });
			assert.equal(path.particleCount, 0, `${c.desc}: particleCount is 0`);
			assert.equal(path.speed, 0, `${c.desc}: speed is 0`);
		}
	});
});

describe("sim3d flowModel - temperature color ramp", () => {
	test("matches endpoints and midpoints according to ramp specifications", () => {
		const rampCases = [
			{ expected: [0, 0.5, 1], label: "cold <= 40C", temp: 20 },
			{ expected: [0, 0.5, 1], label: "boundary 40C", temp: 40 },
			{ expected: [0.5, 0.75, 0.5], label: "midpoint 40..60C", temp: 50 },
			{ expected: [1, 1, 0], label: "yellow at 60C", temp: 60 },
			{ expected: [1, 0.5, 0], label: "midpoint 60..85C", temp: 72.5 },
			{ expected: [1, 0, 0], label: "red at 85C", temp: 85 },
			{ expected: [1, 0, 0], label: "hot >= 85C", temp: 110 },
		];

		for (const rc of rampCases) {
			const color = temperatureColor(rc.temp);
			assert.deepEqual(color, rc.expected, rc.label);
		}
	});
});

describe("sim3d flowModel - flow state & stepFlow", () => {
	test("produces deterministic particle positions with the same seed", () => {
		const paths = [buildSinglePath({ current: 1.5, netId: "NET1" })];

		const state1 = createFlowState(paths, { seed: 12345 });
		const state2 = createFlowState(paths, { seed: 12345 });
		const stateDiff = createFlowState(paths, { seed: 99999 });

		assert.ok(state1.particles.length > 0);
		assert.deepEqual(state1.particles, state2.particles);
		assert.notDeepEqual(state1.particles, stateDiff.particles);
	});

	test("stepFlow advances forward and wraps around for positive current", () => {
		const { state, stepped } = createStepScenario({
			current: 1.0,
			distance: 18,
			netId: "N_POS",
		});

		// 18 + (10 * 0.5) = 23 -> wrapped around length 20 -> 3
		assertParticleState(stepped.particles[0], 3, [3, 0, 0]);
		// verify immutability
		assert.equal(state.particles[0].distance, 18);
	});

	test("stepFlow moves backward and wraps around for negative current", () => {
		const { stepped } = createStepScenario({
			current: -1.0,
			distance: 2,
			netId: "N_NEG",
		});

		// 2 - (10 * 0.5) = -3 -> wrapped around length 20 -> 17
		assertParticleState(stepped.particles[0], 17, [17, 0, 0]);
	});
});

describe("sim3d flowModel - faultEffects", () => {
	test("sparks at the break point (end of path) for open_trace", () => {
		assertSingleFaultEffect([{ kind: "open_trace", netId: "NET_A" }], {
			intensity: 1.0,
			kind: "spark",
			netId: "NET_A",
			position: [10, 0, 0],
		});
	});

	test("flashes at the midpoint of both nets for short_nets", () => {
		// Midpoint of NET_A: [5, 0, 0]
		// Midpoint of NET_B: [10, 10, 0]
		// Midpoint of both: [(5+10)/2, (0+10)/2, 0] = [7.5, 5, 0]
		assertSingleFaultEffect(
			[{ kind: "short_nets", netIds: ["NET_A", "NET_B"] }],
			{ kind: "flash", position: [7.5, 5, 0] },
		);
	});

	test("generates smoke for part over temperature", () => {
		assertSingleFaultEffect(
			[{ kind: "part_over_temperature", netId: "NET_B" }],
			{ kind: "smoke", position: [10, 10, 0] },
		);
	});

	test("preserves explicit fault position when provided", () => {
		assertSingleFaultEffect(
			[
				{
					intensity: 0.8,
					kind: "open_trace",
					netId: "NET_A",
					position: [4, 2, 1],
				},
			],
			{ intensity: 0.8, position: [4, 2, 1] },
		);
	});
});
