import assert from "node:assert/strict";
import { test } from "node:test";
import {
	cleanAuthUrl,
	parseAuthParams,
} from "../frontend/src/utils/authUrl.js";

test("parseAuthParams", async (t) => {
	const cases = [
		["#github_token=abc", "", { token: "abc", error: null }],
		["", "?github_token=abc", { token: "abc", error: null }],
		["#github_token=a%20b%2Bc", "", { token: "a b+c", error: null }],
		["#github_error=bad%20thing", "", { token: null, error: "bad thing" }],
		["", "", { token: null, error: null }],
		["#section", "?x=1", { token: null, error: null }],
		["#github_token=h", "?github_token=q", { token: "h", error: null }],
		[undefined, undefined, { token: null, error: null }],
		["#", "?", { token: null, error: null }],
	];
	for (const [hash, search, expected] of cases)
		await t.test(`${hash}|${search}`, () =>
			assert.deepEqual(parseAuthParams(hash, search), expected),
		);
});

test("cleanAuthUrl keeps unrelated query parameters", async (t) => {
	const cases = [
		["/", "?github_token=x", "/"],
		["/", "?github_token=x&a=1", "/?a=1"],
		["/", "?a=1&github_error=e&b=2", "/?a=1&b=2"],
		["/app", "", "/app"],
		["/", "?a=1", "/?a=1"],
	];
	for (const [p, s, e] of cases)
		await t.test(`${p}${s}`, () => assert.equal(cleanAuthUrl(p, s), e));
});
