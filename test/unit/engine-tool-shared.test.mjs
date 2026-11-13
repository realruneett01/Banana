import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
	assertInsideRepo,
	assertRelative,
	commitOutputSchema,
	defaultIoDeps,
	registerDestructiveTool,
} from "../../backend/src/engine/tools/tool-shared.js";

const REPO = path.resolve("repo-root");

describe("tool-shared", () => {
	test("assertRelative rejects absolute and drive paths with label", () => {
		for (const p of ["/abs", "C:/x", "\\x"]) {
			assert.throws(
				() => assertRelative(p, "dir"),
				/^Error: dir must not be absolute$/,
			);
		}
		assert.doesNotThrow(() => assertRelative("a/b", "path"));
	});

	test("assertInsideRepo returns resolved path or throws with label", () => {
		assert.equal(
			assertInsideRepo(REPO, "a/b", "path"),
			path.resolve(REPO, "a/b"),
		);
		assert.throws(
			() => assertInsideRepo(REPO, "../x", "dir"),
			/^Error: dir resolves outside repoPath$/,
		);
	});

	test("commitOutputSchema wraps the files item schema", () => {
		const schema = commitOutputSchema({ type: "string" });
		assert.deepEqual(schema.required, ["commit", "files"]);
		assert.equal(schema.additionalProperties, false);
		assert.deepEqual(schema.properties.files, {
			type: "array",
			items: { type: "string" },
		});
	});

	test("registerDestructiveTool registers with destructive permission", () => {
		const seen = [];
		const registry = { register: (t) => seen.push(t) };
		const handler = async () => ({});
		registerDestructiveTool(registry, {
			name: "x.y",
			description: "d",
			inputSchema: {},
			outputSchema: {},
			handler,
		});
		assert.equal(seen.length, 1);
		assert.equal(seen[0].permission, "destructive");
		assert.equal(seen[0].handler, handler);
	});

	test("defaultIoDeps keeps injected deps and fills real defaults", () => {
		const execFileFn = async () => ({ stdout: "" });
		const fsImpl = {};
		assert.deepEqual(defaultIoDeps({ execFileFn, fsImpl }), {
			execFileFn,
			fsImpl,
		});
		const real = defaultIoDeps({});
		assert.equal(typeof real.execFileFn, "function");
		assert.equal(real.fsImpl, fs.promises);
	});
});
