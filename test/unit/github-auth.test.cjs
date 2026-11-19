const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
	parseGitCredential,
	checkGhCliToken,
	checkGitCredentialToken,
	verifyTokenWithGithub,
	detectSystemGitHub,
	startDeviceFlow,
	pollDeviceFlow,
	saveEncryptedToken,
	loadEncryptedToken,
	clearEncryptedToken,
} = require("../../electron/github-auth.cjs");

function createMockSafeStorage(options = {}) {
	const { available = true, prefix = "enc:", failOnDecrypt = false } = options;
	if (!available) {
		return { isEncryptionAvailable: () => false };
	}
	return {
		isEncryptionAvailable: () => true,
		encryptString: (str) => Buffer.from(`${prefix}${str}`, "utf8"),
		decryptString: (buf) => {
			if (failOnDecrypt) {
				throw new Error("OS Keychain is temporarily locked");
			}
			const str = buf.toString("utf8");
			if (!str.startsWith(prefix)) {
				throw new Error("Decryption failed");
			}
			return str.replace(new RegExp(`^${prefix}`), "");
		},
	};
}

function saveAndAssertToken(token, mockSafeStorage, filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const saved = saveEncryptedToken(token, mockSafeStorage, filePath);
	assert.deepEqual(
		{ saved, exists: fs.existsSync(filePath) },
		{ saved: true, exists: true },
	);
	return saved;
}

function seedLegacyTokenFile(filePath, token) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, Buffer.from(token).toString("base64"), "utf8");
}

function assertLoadedTokenAndFileRemoved(loaded, expectedToken, filePath) {
	assert.deepEqual(
		{ loaded, exists: fs.existsSync(filePath) },
		{ loaded: expectedToken, exists: false },
	);
}

describe("GitHub Auth Unit Tests (Phase 7 / T7.1)", () => {
	describe("Credential Parsers", () => {
		test("parseGitCredential parses password from git credential stdout", () => {
			const output = [
				"protocol=https",
				"host=github.com",
				"username=testuser",
				"password=gho_secret_token_12345",
				"",
			].join("\n");

			const parsed = parseGitCredential(output);
			assert.equal(parsed, "gho_secret_token_12345");
		});

		test("parseGitCredential returns null when password is missing or empty", () => {
			const INVALID_CREDENTIAL_INPUTS = [
				"protocol=https\nhost=github.com\n",
				"password=\n",
				null,
				"",
			];
			for (const input of INVALID_CREDENTIAL_INPUTS) {
				assert.equal(parseGitCredential(input), null);
			}
		});

		test("checkGhCliToken returns token when gh CLI is logged in", async () => {
			const mockExec = (cmd, args, _opts, cb) => {
				assert.deepEqual({ cmd, args }, { cmd: "gh", args: ["auth", "token"] });
				cb(null, "gho_cli_token_99999\n");
			};

			const token = await checkGhCliToken(mockExec);
			assert.equal(token, "gho_cli_token_99999");
		});

		test("checkGhCliToken returns null when gh is not logged in or missing", async () => {
			const mockExecError = (_cmd, _args, _opts, cb) => {
				cb(new Error("command not found: gh"), "");
			};

			const token = await checkGhCliToken(mockExecError);
			assert.equal(token, null);
		});

		test("checkGitCredentialToken communicates via stdin and parses output", async () => {
			let writtenData = "";
			let streamEnded = false;

			const mockExec = (cmd, args, _opts, cb) => {
				assert.deepEqual(
					{ cmd, args },
					{ cmd: "git", args: ["credential", "fill"] },
				);

				return {
					stdin: {
						write: (data) => {
							writtenData += data;
						},
						end: () => {
							streamEnded = true;
							cb(
								null,
								"protocol=https\nhost=github.com\npassword=gho_git_token_88888\n",
							);
						},
					},
				};
			};

			const token = await checkGitCredentialToken(mockExec);
			assert.deepEqual(
				{ writtenData, streamEnded, token },
				{
					writtenData: "protocol=https\nhost=github.com\n\n",
					streamEnded: true,
					token: "gho_git_token_88888",
				},
			);
		});
	});

	describe("Token Verification & System Detection", () => {
		test("verifyTokenWithGithub returns valid:true and user on 200 OK", async () => {
			const mockFetch = async (url, options) => {
				assert.deepEqual(
					{ url, auth: options.headers.Authorization },
					{ url: "https://api.github.com/user", auth: "Bearer gho_valid" },
				);
				return {
					ok: true,
					json: async () => ({
						login: "octocat",
						name: "The Octocat",
						avatar_url: "https://avatars.githubusercontent.com/u/583231",
						id: 583231,
					}),
				};
			};

			const res = await verifyTokenWithGithub("gho_valid", mockFetch);
			assert.deepEqual(
				{ valid: res.valid, login: res.user.login, id: res.user.id },
				{ valid: true, login: "octocat", id: 583231 },
			);
		});

		test("verifyTokenWithGithub returns valid:false on 401 Unauthorized", async () => {
			const mockFetch = async () => ({
				ok: false,
				status: 401,
			});

			const res = await verifyTokenWithGithub("gho_invalid", mockFetch);
			assert.deepEqual(
				{ valid: res.valid, user: res.user },
				{ valid: false, user: null },
			);
		});

		const DETECTION_CASES = [
			{
				name: "detectSystemGitHub prioritizes gh CLI over git credentials",
				gh: "gho_cli_token",
				git: "gho_git_token",
				login: "cliuser",
				source: "GitHub CLI",
				token: "gho_cli_token",
			},
			{
				name: "detectSystemGitHub falls back to git credential manager",
				gh: null,
				git: "gho_git_token",
				login: "gituser",
				source: "Git Credential Manager",
				token: "gho_git_token",
			},
		];

		for (const c of DETECTION_CASES) {
			test(c.name, async () => {
				const result = await detectSystemGitHub({
					checkGh: async () => c.gh,
					checkGit: async () => c.git,
					verifyToken: async () => ({
						valid: true,
						user: { login: c.login, name: c.login, avatarUrl: "", id: 1 },
					}),
				});
				assert.deepEqual(
					{
						detected: result.detected,
						source: result.source,
						token: result.token,
						login: result.user.login,
					},
					{
						detected: true,
						source: c.source,
						token: c.token,
						login: c.login,
					},
				);
			});
		}

		test("detectSystemGitHub returns detected:false when no valid credentials exist", async () => {
			const options = {
				checkGh: async () => null,
				checkGit: async () => null,
				verifyToken: async () => ({ valid: false, user: null }),
			};

			const result = await detectSystemGitHub(options);
			assert.equal(result.detected, false);
		});
	});

	describe("Device Flow (RFC 8628)", () => {
		test("startDeviceFlow calls GitHub device endpoint and returns codes", async () => {
			const mockFetch = async (url, options) => {
				const body = JSON.parse(options.body);
				assert.deepEqual(
					{
						url,
						method: options.method,
						clientId: body.client_id,
						scope: body.scope,
					},
					{
						url: "https://github.com/login/device/code",
						method: "POST",
						clientId: "test_client_id",
						scope: "repo,read:user",
					},
				);
				return {
					ok: true,
					json: async () => ({
						device_code: "dev_code_123",
						user_code: "ABCD-1234",
						verification_uri: "https://github.com/login/device",
						expires_in: 900,
						interval: 5,
					}),
				};
			};

			const result = await startDeviceFlow("test_client_id", mockFetch);
			assert.deepEqual(
				{
					device_code: result.device_code,
					user_code: result.user_code,
					interval: result.interval,
				},
				{
					device_code: "dev_code_123",
					user_code: "ABCD-1234",
					interval: 5,
				},
			);
		});

		const POLL_ERROR_STATES = [
			{ error: "authorization_pending" },
			{ error: "slow_down", interval: 10 },
			{ error: "expired_token" },
			{ error: "access_denied" },
		];

		for (const payload of POLL_ERROR_STATES) {
			test(`pollDeviceFlow handles ${payload.error} state`, async () => {
				const mockFetch = async () => ({ ok: true, json: async () => payload });
				const res = await pollDeviceFlow(
					"dev_code_123",
					"test_client",
					mockFetch,
				);
				assert.equal(res.error, payload.error);
			});
		}

		test("pollDeviceFlow handles successful authorization", async () => {
			const mockFetch = async () => ({
				ok: true,
				json: async () => ({
					access_token: "gho_granted_access_token_777",
					token_type: "bearer",
					scope: "repo,read:user",
				}),
			});

			const res = await pollDeviceFlow(
				"dev_code_123",
				"test_client",
				mockFetch,
			);
			assert.deepEqual(
				{ access_token: res.access_token, scope: res.scope },
				{
					access_token: "gho_granted_access_token_777",
					scope: "repo,read:user",
				},
			);
		});
	});

	describe("Token Keychain Storage", () => {
		const testDir = path.join(os.tmpdir(), `banana_test_${Date.now()}`);
		const testTokenPath = path.join(testDir, "test_token.enc");

		test("saves and loads encrypted token with safeStorage mock", () => {
			const mockSafeStorage = createMockSafeStorage();
			saveAndAssertToken("gho_super_secret", mockSafeStorage, testTokenPath);

			const loaded = loadEncryptedToken(mockSafeStorage, testTokenPath);
			assert.equal(loaded, "gho_super_secret");

			const cleared = clearEncryptedToken(testTokenPath);
			assert.deepEqual(
				{ cleared, exists: fs.existsSync(testTokenPath) },
				{ cleared: true, exists: false },
			);
		});

		test("falls back gracefully to base64 obfuscation when safeStorage is unavailable", () => {
			const mockSafeStorage = createMockSafeStorage({ available: false });
			const saved = saveEncryptedToken(
				"gho_fallback_secret",
				mockSafeStorage,
				testTokenPath,
			);
			assert.deepEqual(
				{ saved, exists: fs.existsSync(testTokenPath) },
				{ saved: false, exists: false },
			);
		});

		test("writes encrypted file with 0o600 mode", {
			skip:
				process.platform === "win32"
					? "File mode permissions (0o600) are not supported on win32"
					: false,
		}, () => {
			const mockSafeStorage = createMockSafeStorage();
			saveAndAssertToken("gho_mode_secret", mockSafeStorage, testTokenPath);

			const stats = fs.statSync(testTokenPath);
			assert.equal(stats.mode & 0o777, 0o600);

			clearEncryptedToken(testTokenPath);
		});

		test("loads legacy base64 token once, deletes file, and never writes base64", () => {
			seedLegacyTokenFile(testTokenPath, "gho_legacy_secret");

			const mockSafeStorage = createMockSafeStorage({ available: false });
			const loaded = loadEncryptedToken(mockSafeStorage, testTokenPath);
			assertLoadedTokenAndFileRemoved(
				loaded,
				"gho_legacy_secret",
				testTokenPath,
			);

			const secondLoad = loadEncryptedToken(mockSafeStorage, testTokenPath);
			assert.equal(secondLoad, null);
		});

		test("decrypt throws -> returns null and file still exists", () => {
			fs.mkdirSync(testDir, { recursive: true });
			fs.writeFileSync(
				testTokenPath,
				Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
				{ mode: 0o600 },
			);

			const mockSafeStorage = createMockSafeStorage({ failOnDecrypt: true });
			const loaded = loadEncryptedToken(mockSafeStorage, testTokenPath);
			assert.deepEqual(
				{ loaded, exists: fs.existsSync(testTokenPath) },
				{ loaded: null, exists: true },
			);

			clearEncryptedToken(testTokenPath);
		});

		test("legacy base64 GitHub token -> migrated and file removed", () => {
			const legacyToken = "gho_12345678901234567890";
			seedLegacyTokenFile(testTokenPath, legacyToken);

			const mockSafeStorage = createMockSafeStorage();
			const loaded = loadEncryptedToken(mockSafeStorage, testTokenPath);
			assertLoadedTokenAndFileRemoved(loaded, legacyToken, testTokenPath);
		});

		after(() => {
			fs.rmSync(testDir, { recursive: true, force: true });
		});
	});
});
