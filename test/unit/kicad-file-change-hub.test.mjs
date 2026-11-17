import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildWorktreeDiffValues,
	createFileChangeHub,
	shouldRefreshOnMount,
} from "../../frontend/src/kicad/commitWorktree.js";

function fakeSource() {
	const state = { listeners: [], unsubscribed: 0 };
	state.source = (listener) => {
		state.listeners.push(listener);
		return () => {
			state.unsubscribed += 1;
			state.listeners = state.listeners.filter((l) => l !== listener);
		};
	};
	state.fire = (payload) => {
		for (const l of state.listeners) l(payload);
	};
	return state;
}

function startedHub() {
	const src = fakeSource();
	const hub = createFileChangeHub(() => src.source);
	hub.start();
	return { src, hub };
}

function setupMountScenario(initialFile = null, projectRoot = "C:/proj") {
	const { src, hub } = startedHub();
	if (initialFile) {
		src.fire({ projectRoot, filePath: initialFile });
	}
	const refreshed = [];
	const onWorktreeDiff = (v) => refreshed.push(v);
	const remembered = hub.latestFor(projectRoot);
	if (shouldRefreshOnMount(remembered)) {
		onWorktreeDiff(buildWorktreeDiffValues(projectRoot, "HEAD", remembered));
	}
	return { src, hub, refreshed, onWorktreeDiff, remembered };
}

function assertRefreshed(refreshed, expectedPaths) {
	assert.equal(refreshed.length, expectedPaths.length);
	for (const [i, path] of expectedPaths.entries()) {
		assert.equal(refreshed[i].relativeFilePath, path);
	}
}

describe("createFileChangeHub", () => {
	test("subscribes to the source once even when started twice", () => {
		const { src, hub } = startedHub();
		hub.start();
		assert.equal(src.listeners.length, 1);
	});

	test("fans out each change to every reader", () => {
		const { src, hub } = startedHub();
		const a = [];
		const b = [];
		for (const list of [a, b]) {
			hub.subscribe((p) => list.push(p.filePath));
		}
		src.fire({ projectRoot: "C:/r", filePath: "x.kicad_pcb" });
		for (const list of [a, b]) {
			assert.deepEqual(list, ["x.kicad_pcb"]);
		}
	});

	test("remembers changes made while no reader is mounted", () => {
		const { src, hub } = startedHub();
		src.fire({ projectRoot: "C:\\Repo\\", filePath: "a.kicad_sch" });
		for (const [path, expected] of [
			["c:/repo", "a.kicad_sch"],
			["C:/other", null],
		]) {
			assert.equal(hub.latestFor(path), expected);
		}
		hub.clear("C:/REPO");
		assert.equal(hub.latestFor("c:/repo"), null);
	});

	test("reader unsubscribe stops delivery; stop releases the source", () => {
		const { src, hub } = startedHub();
		const seen = [];
		const off = hub.subscribe((p) => seen.push(p));
		off();
		src.fire({ projectRoot: "C:/r", filePath: "x" });
		assert.equal(seen.length, 0);
		hub.stop();
		assert.equal(src.unsubscribed, 1);
		hub.start();
		assert.equal(src.listeners.length, 1);
	});

	test("StrictMode start/stop/start leaves exactly one subscription", () => {
		const { src, hub } = startedHub();
		hub.stop();
		hub.start();
		assert.equal(src.listeners.length, 1);
	});

	test("ignores empty payloads", () => {
		const { src, hub } = startedHub();
		const seen = [];
		hub.subscribe((p) => seen.push(p));
		src.fire(null);
		assert.equal(seen.length, 0);
	});

	test("works without a source (web build)", () => {
		const web = createFileChangeHub(() => undefined);
		web.start();
		web.stop();
		assert.equal(web.latestFor("C:/r"), null);
	});
});

describe("shouldRefreshOnMount", () => {
	const cases = [
		{ filePath: "a.kicad_pcb", expected: true },
		{ filePath: null, expected: false },
		{ filePath: undefined, expected: false },
		{ filePath: "", expected: false },
	];
	for (const { filePath, expected } of cases) {
		test(`filePath=${JSON.stringify(filePath)} -> ${expected}`, () => {
			assert.equal(shouldRefreshOnMount(filePath), expected);
		});
	}
});

describe("mount-refresh integration", () => {
	test("restored file triggers one refresh request", () => {
		const { refreshed } = setupMountScenario("board.kicad_pcb");
		assertRefreshed(refreshed, ["board.kicad_pcb"]);
	});

	test("no remembered file -> no refresh on mount", () => {
		const { refreshed } = setupMountScenario();
		assertRefreshed(refreshed, []);
	});

	test("live event after restore triggers exactly one more refresh", () => {
		const { refreshed, onWorktreeDiff } = setupMountScenario("board.kicad_pcb");
		assertRefreshed(refreshed, ["board.kicad_pcb"]);

		// simulate live event arriving after mount
		onWorktreeDiff(
			buildWorktreeDiffValues("C:/proj", "HEAD", "board.kicad_pcb"),
		);
		assertRefreshed(refreshed, ["board.kicad_pcb", "board.kicad_pcb"]);
	});
});
