import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveListenHost } from "../../backend/src/config.js";

const CASES = [
	{
		env: {},
		expected: "0.0.0.0",
		name: "defaults to 0.0.0.0 when empty",
	},
	{
		env: { BANANA_ALLOW_LOCAL_REPOS: "1" },
		expected: "127.0.0.1",
		name: "binds to loopback when BANANA_ALLOW_LOCAL_REPOS is 1",
	},
	{
		env: { BANANA_ALLOW_LOCAL_REPOS: "0" },
		expected: "0.0.0.0",
		name: "defaults to 0.0.0.0 when BANANA_ALLOW_LOCAL_REPOS is not 1",
	},
	{
		env: { HOST: "10.0.0.5", BANANA_ALLOW_LOCAL_REPOS: "1" },
		expected: "10.0.0.5",
		name: "prefers explicit HOST over BANANA_ALLOW_LOCAL_REPOS",
	},
	{
		env: { HOST: "  " },
		expected: "0.0.0.0",
		name: "ignores whitespace-only HOST and falls back to 0.0.0.0",
	},
];

describe("resolveListenHost", () => {
	for (const { env, expected, name } of CASES) {
		test(name, () => {
			assert.equal(resolveListenHost(env), expected);
		});
	}
});
