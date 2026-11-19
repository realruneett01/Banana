import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import {
	disposeModelCache,
	footprintToModelPath,
	loadModel,
	occtResultToGroup,
} from "../../frontend/src/components/sim3d/stepModels.js";

const FOOTPRINT_PATH_CASES = [
	{
		desc: "normal footprint with library and name",
		input: "Resistor_SMD:R_0805_2012Metric",
		expected: `\${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0805_2012Metric.step`,
	},
	{
		desc: "footprint without colon",
		input: "R_0805_2012Metric",
		expected: null,
	},
	{
		desc: "empty string",
		input: "",
		expected: null,
	},
	{
		desc: "null input",
		input: null,
		expected: null,
	},
	{
		desc: "undefined input",
		input: undefined,
		expected: null,
	},
	{
		desc: "missing library before colon",
		input: ":R_0805_2012Metric",
		expected: null,
	},
	{
		desc: "missing name after colon",
		input: "Resistor_SMD:",
		expected: null,
	},
	{
		desc: "multiple colons",
		input: "Resistor:SMD:0805",
		expected: null,
	},
];

const FAKE_OCCT_RESULT = {
	success: true,
	meshes: [
		{
			name: "body",
			color: [0.2, 0.4, 0.6],
			attributes: {
				position: {
					array: [0, 0, 0, 1, 0, 0, 0, 1, 0],
				},
				normal: {
					array: [0, 0, 1, 0, 0, 1, 0, 0, 1],
				},
			},
			index: {
				array: [0, 1, 2],
			},
		},
		{
			name: "lead",
			attributes: {
				position: {
					array: [1, 1, 0, 2, 1, 0, 1, 2, 0],
				},
			},
		},
	],
};

function createDelayedFetch(state) {
	return async () => {
		state.calls += 1;
		await new Promise((r) => setTimeout(r, 10));
		return {
			ok: true,
			status: 200,
			arrayBuffer: async () => new ArrayBuffer(8),
		};
	};
}

function createNotFoundFetch(state) {
	return async () => {
		state.calls += 1;
		return {
			ok: false,
			status: 404,
			arrayBuffer: async () => new ArrayBuffer(0),
		};
	};
}

describe("stepModels footprintToModelPath", () => {
	test("resolves paths according to footprintToModelPath table", () => {
		for (const item of FOOTPRINT_PATH_CASES) {
			const result = footprintToModelPath(item.input);
			assert.equal(result, item.expected, item.desc);
		}
	});
});

describe("stepModels occtResultToGroup", () => {
	test("creates group with correct vertex counts and material colors", () => {
		const group = occtResultToGroup(FAKE_OCCT_RESULT, THREE);
		assert.ok(group instanceof THREE.Group);
		assert.equal(group.children.length, 2);

		const mesh0 = group.children[0];
		assert.equal(mesh0.geometry.attributes.position.count, 3);
		assert.equal(mesh0.geometry.index.count, 3);
		assert.equal(mesh0.geometry.attributes.normal.count, 3);
		assert.equal(mesh0.material.color.r.toFixed(2), "0.20");
		assert.equal(mesh0.material.color.g.toFixed(2), "0.40");
		assert.equal(mesh0.material.color.b.toFixed(2), "0.60");

		const mesh1 = group.children[1];
		assert.equal(mesh1.geometry.attributes.position.count, 3);
		assert.equal(mesh1.geometry.attributes.normal.count, 3);
		assert.equal(mesh1.material.color.getHex(), 0x888888);
	});

	test("returns null for empty or invalid results", () => {
		assert.equal(occtResultToGroup(null, THREE), null);
		assert.equal(occtResultToGroup({}, THREE), null);
		assert.equal(occtResultToGroup({ meshes: null }, THREE), null);
	});
});

describe("stepModels loadModel caching", () => {
	test("shares single in-flight request per path", async () => {
		disposeModelCache();
		const state = { calls: 0 };
		const fetchImpl = createDelayedFetch(state);
		const fakeLoader = async () => ({
			ReadStepFile: () => FAKE_OCCT_RESULT,
		});

		const p1 = loadModel("Resistor_SMD:R_0805_2012Metric", {
			fetchImpl,
			occtLoader: fakeLoader,
		});
		const p2 = loadModel("Resistor_SMD:R_0805_2012Metric", {
			fetchImpl,
			occtLoader: fakeLoader,
		});

		const [m1, m2] = await Promise.all([p1, p2]);
		assert.equal(state.calls, 1);
		assert.ok(m1 instanceof THREE.Group);
		assert.equal(m1, m2);
	});

	test("caches null on 404 and does not retry until cache disposed", async () => {
		disposeModelCache();
		const state = { calls: 0 };
		const fetchImpl = createNotFoundFetch(state);
		const fakeLoader = async () => ({
			ReadStepFile: () => FAKE_OCCT_RESULT,
		});

		const r1 = await loadModel("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", {
			fetchImpl,
			occtLoader: fakeLoader,
		});
		assert.equal(r1, null);
		assert.equal(state.calls, 1);

		const r2 = await loadModel("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", {
			fetchImpl,
			occtLoader: fakeLoader,
		});
		assert.equal(r2, null);
		assert.equal(state.calls, 1);

		disposeModelCache();
		const r3 = await loadModel("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", {
			fetchImpl,
			occtLoader: fakeLoader,
		});
		assert.equal(r3, null);
		assert.equal(state.calls, 2);
	});
});
