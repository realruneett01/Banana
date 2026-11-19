import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const modalUrl = new URL(
	"../../frontend/src/components/GithubConnectModal.jsx",
	import.meta.url,
);
const modalSrc = readFileSync(modalUrl, "utf8");

async function loadHelpers() {
	try {
		return await import(modalUrl.href);
	} catch {
		const start = modalSrc.indexOf("// --- Pure Device Flow Helpers ---");
		const end = modalSrc.indexOf("// --- End Pure Device Flow Helpers ---");
		const chunk = modalSrc.slice(start, end);
		return await import(`data:text/javascript,${encodeURIComponent(chunk)}`);
	}
}

const { isSafeGithubUrl, nextPollDelay, pollOutcome } = await loadHelpers();

describe("isSafeGithubUrl", () => {
	const URL_CASES = [
		["https://github.com/login/device", true],
		["https://github.com/login/oauth/authorize?code=123", true],
		["https://github.com/", true],
		["https://github.com/octocat/repo", true],
		["http://github.com/login/device", false],
		["https://github.com.attacker.com/login/device", false],
		["https://github.com@evil.com/login/device", false],
		["javascript:alert(1)", false],
		["https://evil.com/https://github.com/", false],
		["", false],
		[null, false],
		[undefined, false],
		[12345, false],
		[{}, false],
	];

	test("evaluates URL safety across valid and malicious inputs", () => {
		for (const [input, expected] of URL_CASES) {
			const actual = isSafeGithubUrl(input);
			assert.equal(actual, expected, `Failed for input: ${String(input)}`);
		}
	});
});

describe("nextPollDelay", () => {
	const DELAY_CASES = [
		["pending (sec)", 5, { error: "authorization_pending" }, 5],
		["empty response (sec)", 5, {}, 5],
		["null response (sec)", 5, null, 5],
		["success response (sec)", 5, { access_token: "tok" }, 5],
		["slow_down +5s (sec)", 5, { error: "slow_down" }, 10],
		["slow_down successive +5s (sec)", 10, { error: "slow_down" }, 15],
		["pending (ms)", 5000, { error: "authorization_pending" }, 5000],
		["slow_down +5000ms (ms)", 5000, { error: "slow_down" }, 10000],
		["defaults non-positive base", 0, {}, 5],
		["defaults undefined base", undefined, {}, 5],
	];

	test("calculates polling delay according to device flow rules", () => {
		for (const [desc, base, resp, expected] of DELAY_CASES) {
			const actual = nextPollDelay(base, resp);
			assert.equal(actual, expected, `Failed for ${desc}`);
		}
	});
});

describe("pollOutcome", () => {
	test("returns success with token when access_token exists", () => {
		const res = pollOutcome({ access_token: "gho_test_token_123" });
		assert.equal(res.status, "success");
		assert.equal(res.token, "gho_test_token_123");
		assert.equal(res.accessToken, "gho_test_token_123");
	});

	const CONTINUE_CASES = [
		["authorization_pending", { error: "authorization_pending" }],
		["slow_down", { error: "slow_down" }],
		["null response", null],
		["undefined response", undefined],
	];

	test("returns continue on pending, slow_down, or transient responses", () => {
		for (const [desc, resp] of CONTINUE_CASES) {
			const res = pollOutcome(resp);
			assert.equal(res.status, "continue", `Failed for ${desc}`);
		}
	});

	const ERROR_CASES = [
		["expired_token", { error: "expired_token" }, /expired/i],
		["access_denied", { error: "access_denied" }, /denied/i],
		[
			"custom error description",
			{ error: "bad_code", error_description: "Invalid device code" },
			/Invalid device code/,
		],
		["generic error", { error: "unauthorized_client" }, /unauthorized_client/],
	];

	test("returns terminal error with descriptive message and fallback mention", () => {
		for (const [desc, resp, pattern] of ERROR_CASES) {
			const res = pollOutcome(resp);
			assert.equal(res.status, "error", `Expected error status for ${desc}`);
			assert.match(res.message, pattern, `Failed pattern match for ${desc}`);
			assert.match(
				res.message,
				/Personal Access Token/,
				`Expected PAT fallback mention for ${desc}`,
			);
		}
	});
});

describe("GithubConnectModal Web Relay Contracts", () => {
	test("includes 1-Click Browser Login tab for both web and desktop", () => {
		assert.ok(modalSrc.includes('"1-Click Browser Login"'));
		assert.ok(
			!modalSrc.includes("if (window.banana?.isElectron) {\n\t\ttabs.push("),
			"Device flow tab must not be guarded behind isElectron",
		);
	});

	test("routes device start through desktop API or backend relay", () => {
		assert.ok(modalSrc.includes("window.banana?.github?.startDeviceFlow"));
		assert.ok(modalSrc.includes("/api/github/device/code"));
		assert.ok(
			!modalSrc.includes("https://github.com/login/device/code"),
			"Must not call github.com directly from browser",
		);
	});

	test("routes polling through desktop API or backend relay", () => {
		assert.ok(modalSrc.includes("window.banana?.github?.pollDeviceFlow"));
		assert.ok(modalSrc.includes("/api/github/device/token"));
		assert.ok(
			!modalSrc.includes("client_id:"),
			"Must not hardcode client_id in frontend",
		);
	});

	test("enforces secure link opening and proper UI controls", () => {
		assert.ok(modalSrc.includes('"noopener,noreferrer"'));
		assert.ok(modalSrc.includes("Waiting for you to approve on GitHub"));
		assert.ok(modalSrc.includes("Copy Code"));
		assert.ok(modalSrc.includes("Try Again"));
	});
});
