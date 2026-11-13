import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveListenHost } from "../../backend/src/config.js";

const ANY = "0.0.0.0";
const LOOPBACK = "127.0.0.1";
const ALLOW = "BANANA_ALLOW_LOCAL_REPOS";

// [name, env, expected]
const CASES = [
	["defaults to 0.0.0.0 when empty", {}, ANY],
	[`binds to loopback when ${ALLOW} is 1`, { [ALLOW]: "1" }, LOOPBACK],
	[`defaults to 0.0.0.0 when ${ALLOW} is not 1`, { [ALLOW]: "0" }, ANY],
	[
		`prefers explicit HOST over ${ALLOW}`,
		{ HOST: "10.0.0.5", [ALLOW]: "1" },
		"10.0.0.5",
	],
	[
		"ignores whitespace-only HOST and falls back to 0.0.0.0",
		{ HOST: "  " },
		ANY,
	],
];

describe("resolveListenHost", () => {
	for (const [name, env, expected] of CASES) {
		test(name, () => {
			assert.equal(resolveListenHost(env), expected);
		});
	}
});
