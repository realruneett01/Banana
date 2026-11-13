import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createFileChangeHub } from "../../frontend/src/kicad/commitWorktree.js";

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
		hub.subscribe((p) => a.push(p.filePath));
		hub.subscribe((p) => b.push(p.filePath));
		src.fire({ projectRoot: "C:/r", filePath: "x.kicad_pcb" });
		assert.deepEqual(a, ["x.kicad_pcb"]);
		assert.deepEqual(b, ["x.kicad_pcb"]);
	});

	test("remembers changes made while no reader is mounted", () => {
		const { src, hub } = startedHub();
		src.fire({ projectRoot: "C:\\Repo\\", filePath: "a.kicad_sch" });
		assert.equal(hub.latestFor("c:/repo"), "a.kicad_sch");
		assert.equal(hub.latestFor("C:/other"), null);
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
