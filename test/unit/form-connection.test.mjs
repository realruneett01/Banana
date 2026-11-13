import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	guardFormWrites,
	nextFormConnection,
	shouldWriteToForm,
} from "../../frontend/src/formConnection.js";

const NEVER = { mounted: false, everMounted: false };

function fakeForm() {
	const calls = [];
	return {
		calls,
		setFieldsValue: (v) => calls.push(["setFieldsValue", v]),
		setFieldValue: (n, v) => calls.push(["setFieldValue", n, v]),
		getFieldValue: (n) => `value:${n}`,
	};
}

describe("form connection", () => {
	it("does not write before the Form has ever mounted", () => {
		assert.equal(shouldWriteToForm(NEVER), false);
		assert.equal(shouldWriteToForm(undefined), false);
	});

	it("writes once mounted and keeps writing after unmount", () => {
		const mounted = nextFormConnection(NEVER, true);
		assert.deepEqual(mounted, { mounted: true, everMounted: true });
		assert.equal(shouldWriteToForm(mounted), true);
		const unmounted = nextFormConnection(mounted, false);
		assert.deepEqual(unmounted, { mounted: false, everMounted: true });
		assert.equal(shouldWriteToForm(unmounted), true);
	});

	it("before mount, writes stay pending and reads return them", () => {
		const form = fakeForm();
		const guarded = guardFormWrites(form, () => NEVER);
		guarded.setFieldsValue({ repoPath: "/r", baseCommit: "x" });
		guarded.setFieldValue("baseCommit", "a");
		assert.equal(guarded.getFieldValue("repoPath"), "/r");
		assert.equal(guarded.getFieldValue("baseCommit"), "a");
		assert.equal(guarded.getFieldValue("targetCommit"), undefined);
		assert.deepEqual(form.calls, []);
	});

	it("flush hands pending values to the form once, in one call", () => {
		const form = fakeForm();
		const guarded = guardFormWrites(form, () => NEVER);
		guarded.flush();
		assert.deepEqual(form.calls, []);
		guarded.setFieldsValue({ repoPath: "/r" });
		guarded.setFieldValue("baseCommit", "a");
		guarded.flush();
		guarded.flush();
		assert.deepEqual(form.calls, [
			["setFieldsValue", { repoPath: "/r", baseCommit: "a" }],
		]);
	});

	it("after mount, calls go straight through to the form", () => {
		const form = fakeForm();
		let connection = NEVER;
		const guarded = guardFormWrites(form, () => connection);
		connection = nextFormConnection(connection, true);
		guarded.setFieldsValue({ repoPath: "/r" });
		guarded.setFieldValue("baseCommit", "a");
		assert.equal(guarded.getFieldValue("targetCommit"), "value:targetCommit");
		assert.deepEqual(form.calls, [
			["setFieldsValue", { repoPath: "/r" }],
			["setFieldValue", "baseCommit", "a"],
		]);
	});
});
