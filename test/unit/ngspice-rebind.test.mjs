import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSharedNgspice } from "../../backend/src/engine/spice/ngspice-shared.js";
import {
	checkSimulator,
	getSimEngine,
	setSimEngine,
} from "../../backend/src/routes/health-routes.js";

function createDuplicateStrictKoffi() {
	const definedTypes = new Set();
	let protoCallCount = 0;
	return {
		getProtoCallCount: () => protoCallCount,
		proto: (decl) => {
			protoCallCount++;
			const match = decl.match(/\b([A-Za-z0-9_]+)\s*\(/);
			const typeName = match ? match[1] : decl;
			if (definedTypes.has(typeName)) {
				throw new Error(`Duplicate type name '${typeName}'`);
			}
			definedTypes.add(typeName);
			return { typeName };
		},
		pointer: (target) => ({ pointerTo: target }),
		register: (fn) => fn,
		load: () => ({
			func: () => () => 0,
		}),
	};
}

describe("ngspice rebind prototype reuse", () => {
	test("binding twice succeeds and proto is called exactly 6 times total", async () => {
		const fakeKoffi = createDuplicateStrictKoffi();
		const engine1 = createSharedNgspice({
			koffiImpl: fakeKoffi,
			libraryPath: "fake.dll",
		});
		const engine2 = createSharedNgspice({
			koffiImpl: fakeKoffi,
			libraryPath: "fake.dll",
		});

		const avail1 = await engine1.available();
		const avail2 = await engine2.available();

		assert.equal(avail1, true);
		assert.equal(avail2, true);
		assert.equal(fakeKoffi.getProtoCallCount(), 6);
	});
});

describe("health capability check engine reuse", () => {
	test("capability check twice uses the same engine instance", async () => {
		setSimEngine(null);
		const firstResult = await checkSimulator();
		const firstEngine = getSimEngine();
		const secondResult = await checkSimulator();
		const secondEngine = getSimEngine();

		assert.ok(firstEngine !== null);
		assert.equal(firstEngine, secondEngine);
		assert.equal(firstResult.available, secondResult.available);
		assert.equal(firstResult.simulatorKind, secondResult.simulatorKind);
	});

	test("capability check uses injected or spied engine", async () => {
		let availableCalls = 0;
		const spyEngine = {
			available: async () => {
				availableCalls++;
				return true;
			},
			kind: () => "mock-ngspice",
		};

		setSimEngine(spyEngine);
		const res1 = await checkSimulator();
		const res2 = await checkSimulator();

		assert.equal(res1.available, true);
		assert.equal(res1.simulatorKind, "mock-ngspice");
		assert.equal(res2.available, true);
		assert.equal(res2.simulatorKind, "mock-ngspice");
		assert.equal(availableCalls, 2);
		assert.equal(getSimEngine(), spyEngine);
	});
});
