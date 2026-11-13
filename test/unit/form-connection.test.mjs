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

	it("guarded form skips calls until the Form mounts, then passes through", () => {
		const form = fakeForm();
		let connection = NEVER;
		const guarded = guardFormWrites(form, () => connection);
		guarded.setFieldsValue({ repoPath: "/r" });
		guarded.setFieldValue("baseCommit", "a");
		assert.equal(guarded.getFieldValue("targetCommit"), undefined);
		assert.deepEqual(form.calls, []);

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
