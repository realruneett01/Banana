const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

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
	if (match && match[1]) {
		const token = match[1].trim();
		return token.length > 0 ? token : null;
	}
	return null;
}

/**
 * Checks for a GitHub CLI (gh) stored token.
 */
function checkGhCliToken(execFn = execFile) {
	return new Promise((resolve) => {
		execFn("gh", ["auth", "token"], { timeout: 5000 }, (error, stdout) => {
			if (error) return resolve(null);
			const token = stdout ? stdout.trim() : "";
			resolve(token.startsWith("gh") || token.length > 10 ? token : null);
		});
	});
}

/**
 * Checks for credentials in Git Credential Manager / git-credential helpers.
 */
function checkGitCredentialToken(execFn = execFile) {
	return new Promise((resolve) => {
		try {
			const child = execFn(
				"git",
				["credential", "fill"],
				{ timeout: 5000 },
				(error, stdout) => {
					if (error) return resolve(null);
					resolve(parseGitCredential(stdout));
				},
			);
			if (child && child.stdin) {
				child.stdin.write("protocol=https\nhost=github.com\n\n");
				child.stdin.end();
			}
		} catch (_) {
			resolve(null);
		}
	});
}

/**
 * Validates a GitHub token against GET https://api.github.com/user.
 */
async function verifyTokenWithGithub(token, fetchFn = globalThis.fetch) {
	if (!token) return { valid: false, user: null };
	try {
		const res = await fetchFn("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "Banana-Hardware-Diff-Studio",
			},
		});
		if (res.ok) {
			const data = await res.json();
			return {
				valid: true,
				user: {
					login: data.login,
					name: data.name || data.login,
					avatarUrl: data.avatar_url,
					id: data.id,
				},
			};
		}
	} catch (e) {
		console.debug("[Banana Electron] Token verify error:", e.message);
	}
	return { valid: false, user: null };
}

/**
 * Auto-detects GitHub credentials from system environment (gh CLI or git credentials).
 */
async function detectSystemGitHub(options = {}) {
	const checkGh = options.checkGh || checkGhCliToken;
	const checkGit = options.checkGit || checkGitCredentialToken;
	const verifyToken = options.verifyToken || verifyTokenWithGithub;

	let token = await checkGh();
	let source = "GitHub CLI";

	if (!token) {
		token = await checkGit();
		source = "Git Credential Manager";
	}

	if (!token) {
		return { detected: false };
	}

	const { valid, user } = await verifyToken(token);
	if (valid && user) {
		return {
			detected: true,
			source,
			user,
			token, // Sent to renderer so explicit user click can authorize
		};
	}

	return { detected: false };
}

/**
 * Starts GitHub OAuth Device Authorization Flow (RFC 8628).
 */
async function startDeviceFlow(customClientId, fetchFn = globalThis.fetch) {
	const clientId = customClientId || DEFAULT_CLIENT_ID;
	const res = await fetchFn("https://github.com/login/device/code", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			client_id: clientId,
			scope: "repo,read:user",
		}),
	});

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
	const res = await fetchFn("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({
			client_id: clientId,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		}),
	});

	return res.json();
}

const LEGACY_BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const GITHUB_TOKEN_PATTERN =
	/^(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

/**
 * Token encryption using OS Keychain (safeStorage).
 */
function saveEncryptedToken(token, safeStorage, filePath) {
	try {
		if (safeStorage?.isEncryptionAvailable?.()) {
			const encrypted = safeStorage.encryptString(token);
			fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
			return true;
		}
		return false;
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

function loadEncryptedToken(safeStorage, filePath) {
	if (!fs.existsSync(filePath)) return null;
	let data;
	try {
		data = fs.readFileSync(filePath);
	} catch (err) {
		console.error("[Banana Electron] Load token error:", err);
		return null;
	}

	if (safeStorage?.isEncryptionAvailable?.()) {
		try {
			return safeStorage.decryptString(data);
		} catch (err) {
			const legacyToken = decodeLegacyBase64Token(data);
			if (legacyToken) {
				clearEncryptedToken(filePath);
				return legacyToken;
			}
			console.error("[Banana Electron] Decrypt token error:", err);
			return null;
		}
	}

	return migrateLegacyToken(filePath, data);
}

function clearEncryptedToken(filePath) {
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
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
