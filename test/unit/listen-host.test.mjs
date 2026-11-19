import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveListenHost } from "../../backend/src/config.js";

const DEFAULT_HOST = "0.0.0.0";
const LOCAL_HOST = "127.0.0.1";
const LOCAL_REPO_ENV = "BANANA_ALLOW_LOCAL_REPOS";

const buildSpec = (name, env, expected) => ({ name, env, expected });

const SCENARIOS = [
	buildSpec("defaults to 0.0.0.0 when empty", {}, DEFAULT_HOST),
	buildSpec(
		`binds to loopback when ${LOCAL_REPO_ENV} is 1`,
		{ [LOCAL_REPO_ENV]: "1" },
		LOCAL_HOST,
	),
	buildSpec(
		`defaults to 0.0.0.0 when ${LOCAL_REPO_ENV} is not 1`,
		{ [LOCAL_REPO_ENV]: "0" },
		DEFAULT_HOST,
	),
	buildSpec(
		`prefers explicit HOST over ${LOCAL_REPO_ENV}`,
		{ HOST: "10.0.0.5", [LOCAL_REPO_ENV]: "1" },
		"10.0.0.5",
	),
	buildSpec(
		"ignores whitespace-only HOST and falls back to 0.0.0.0",
		{ HOST: "  " },
		DEFAULT_HOST,
	),
];

describe("resolveListenHost", () => {
	SCENARIOS.forEach(({ name, env, expected }) => {
		test(name, () => {
			assert.equal(resolveListenHost(env), expected);
		});
	});
});
