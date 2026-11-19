const fs = require("node:fs");
const { execFile } = require("node:child_process");

const DEFAULT_CLIENT_ID =
	process.env.GITHUB_CLIENT_ID || "Ov23liZc6GZz7Cg8Y1sZ";

/**
 * Parses git credential fill stdout formatted as key=value pairs.
 * Example:
 * protocol=https
 * host=github.com
 * username=octocat
 * password=gho_xxxxxx
 */
function parseGitCredential(stdout) {
	if (!stdout || typeof stdout !== "string") return null;
	const match = stdout.match(/password=(.+)/);
	if (!match?.[1]) return null;
	const token = match[1].trim();
	return token.length > 0 ? token : null;
}

function onGhCliOutput(error, stdout, resolve) {
	if (error) return resolve(null);
	const token = stdout ? stdout.trim() : "";
	resolve(token.startsWith("gh") || token.length > 10 ? token : null);
}

function executeGhCli(execFn, resolve) {
	const cb = (err, out) => onGhCliOutput(err, out, resolve);
	execFn("gh", ["auth", "token"], { timeout: 5000 }, cb);
}

/**
 * Checks for a GitHub CLI (gh) stored token.
 */
function checkGhCliToken(execFn = execFile) {
	return new Promise((resolve) => executeGhCli(execFn, resolve));
}

function sendGitCredentialRequest(child) {
	if (!child?.stdin) return;
	child.stdin.write("protocol=https\nhost=github.com\n\n");
	child.stdin.end();
}

function onGitCredentialOutput(error, stdout, resolve) {
	if (error) return resolve(null);
	resolve(parseGitCredential(stdout));
}

function executeGitCredential(execFn, resolve) {
	try {
		const cb = (err, out) => onGitCredentialOutput(err, out, resolve);
		const child = execFn("git", ["credential", "fill"], { timeout: 5000 }, cb);
		sendGitCredentialRequest(child);
	} catch (_) {
		resolve(null);
	}
}

/**
 * Checks for credentials in Git Credential Manager / git-credential helpers.
 */
function checkGitCredentialToken(execFn = execFile) {
	return new Promise((resolve) => executeGitCredential(execFn, resolve));
}

function formatGithubUser(data) {
	return {
		login: data.login,
		name: data.name || data.login,
		avatarUrl: data.avatar_url,
		id: data.id,
	};
}

async function fetchGithubUser(token, fetchFn) {
	try {
		return await fetchFn("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "Banana-Hardware-Diff-Studio",
			},
		});
	} catch (e) {
		console.debug("[Banana Electron] Token verify error:", e.message);
		return null;
	}
}

async function safeParseJson(res) {
	try {
		return await res.json();
	} catch (e) {
		console.debug("[Banana Electron] Token verify error:", e.message);
		return null;
	}
}

/**
 * Validates a GitHub token against GET https://api.github.com/user.
 */
async function verifyTokenWithGithub(token, fetchFn = globalThis.fetch) {
	if (!token) return { valid: false, user: null };
	const res = await fetchGithubUser(token, fetchFn);
	if (!res?.ok) return { valid: false, user: null };
	const data = await safeParseJson(res);
	if (!data) return { valid: false, user: null };
	return { valid: true, user: formatGithubUser(data) };
}

async function resolveSystemToken(checkGh, checkGit) {
	const ghToken = await checkGh();
	if (ghToken) return { token: ghToken, source: "GitHub CLI" };
	const gitToken = await checkGit();
	if (gitToken) return { token: gitToken, source: "Git Credential Manager" };
	return null;
}

function getAuthCheckers(options) {
	return {
		checkGh: options.checkGh || checkGhCliToken,
		checkGit: options.checkGit || checkGitCredentialToken,
		verifyToken: options.verifyToken || verifyTokenWithGithub,
	};
}

function buildDetectedUser(credential, user) {
	return {
		detected: true,
		source: credential.source,
		user,
		token: credential.token,
	};
}

/**
 * Auto-detects GitHub credentials from system environment (gh CLI or git credentials).
 */
async function detectSystemGitHub(options = {}) {
	const checkers = getAuthCheckers(options);
	const credential = await resolveSystemToken(
		checkers.checkGh,
		checkers.checkGit,
	);
	if (!credential) return { detected: false };

	const result = await checkers.verifyToken(credential.token);
	if (!result.valid || !result.user) return { detected: false };

	return buildDetectedUser(credential, result.user);
}

async function postGithubJson(url, payload, fetchFn = globalThis.fetch) {
	return fetchFn(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify(payload),
	});
}

/**
 * Starts GitHub OAuth Device Authorization Flow (RFC 8628).
 */
async function startDeviceFlow(customClientId, fetchFn = globalThis.fetch) {
	const clientId = customClientId || DEFAULT_CLIENT_ID;
	const res = await postGithubJson(
		"https://github.com/login/device/code",
		{
			client_id: clientId,
			scope: "repo,read:user",
		},
		fetchFn,
	);

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Device code request failed (${res.status}): ${text}`);
	}

	return res.json();
}

/**
 * Polls the device flow token endpoint until user approves or code expires.
 */
async function pollDeviceFlow(
	deviceCode,
	customClientId,
	fetchFn = globalThis.fetch,
) {
	const clientId = customClientId || DEFAULT_CLIENT_ID;
	const res = await postGithubJson(
		"https://github.com/login/oauth/access_token",
		{
			client_id: clientId,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		},
		fetchFn,
	);

	return res.json();
}

const LEGACY_BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const GITHUB_TOKEN_PATTERN =
	/^(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

/**
 * Token encryption using OS Keychain (safeStorage).
 */
function saveEncryptedToken(token, safeStorage, filePath) {
	if (!safeStorage?.isEncryptionAvailable?.()) return false;
	try {
		const encrypted = safeStorage.encryptString(token);
		fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
		return true;
	} catch (err) {
		console.error("[Banana Electron] Save token error:", err);
		return false;
	}
}

function decodeLegacyBase64Token(data) {
	const text = data.toString("utf8");
	if (!LEGACY_BASE64_PATTERN.test(text)) return null;
	const decoded = Buffer.from(text, "base64").toString("utf8");
	if (!GITHUB_TOKEN_PATTERN.test(decoded)) return null;
	return decoded;
}

function migrateLegacyToken(filePath, data) {
	try {
		const token = Buffer.from(data.toString("utf8"), "base64").toString("utf8");
		clearEncryptedToken(filePath);
		return token;
	} catch (err) {
		console.error("[Banana Electron] Legacy token migration error:", err);
		return null;
	}
}

function readTokenFile(filePath) {
	try {
		return fs.readFileSync(filePath);
	} catch (err) {
		console.error("[Banana Electron] Load token error:", err);
		return null;
	}
}

function recoverLegacyToken(filePath, data) {
	const legacyToken = decodeLegacyBase64Token(data);
	if (!legacyToken) return null;
	clearEncryptedToken(filePath);
	return legacyToken;
}

function handleDecryptError(err, filePath, data) {
	const legacyToken = recoverLegacyToken(filePath, data);
	if (legacyToken) return legacyToken;
	console.error("[Banana Electron] Decrypt token error:", err);
	return null;
}

function decryptToken(safeStorage, filePath, data) {
	try {
		return safeStorage.decryptString(data);
	} catch (err) {
		return handleDecryptError(err, filePath, data);
	}
}

function loadEncryptedToken(safeStorage, filePath) {
	if (!fs.existsSync(filePath)) return null;
	const data = readTokenFile(filePath);
	if (!data) return null;

	if (safeStorage?.isEncryptionAvailable?.()) {
		return decryptToken(safeStorage, filePath, data);
	}

	return migrateLegacyToken(filePath, data);
}

function clearEncryptedToken(filePath) {
	if (!fs.existsSync(filePath)) return true;
	try {
		fs.unlinkSync(filePath);
		return true;
	} catch {
		// File may already be unlinked or inaccessible
		return false;
	}
}

module.exports = {
	DEFAULT_CLIENT_ID,
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
};
