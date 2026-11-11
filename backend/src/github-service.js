import fs from "node:fs";
import path from "node:path";
import { BANANA_DATA_DIR, config } from "./config.js";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_OAUTH_URL = "https://github.com/login/oauth";
const USER_AGENT = "Banana-Hardware-Diff-Studio";
const REPO_SEGMENT_REGEX = /^[A-Za-z0-9_.-]{1,100}$/;

export function validateRepoSegment(name) {
	if (typeof name !== "string" || !REPO_SEGMENT_REGEX.test(name)) {
		throw new Error("invalid GitHub path");
	}
	if (name === "." || name === "..") {
		throw new Error("invalid GitHub path");
	}
}

export const validateOwner = validateRepoSegment;
export const validateRepo = validateRepoSegment;

export function validateRepoSlug(owner, repo) {
	validateRepoSegment(owner);
	validateRepoSegment(repo);
}

function isAbsoluteFilePath(filePath) {
	if (filePath.startsWith("/") || filePath.includes("\\")) {
		return true;
	}
	return path.win32.isAbsolute(filePath) || path.posix.isAbsolute(filePath);
}

function hasDotDotSegment(filePath) {
	const segments = filePath.split("/");
	return segments.some((seg) => seg === "..");
}

export function validateFilePath(filePath) {
	if (typeof filePath !== "string" || !filePath) {
		throw new Error("invalid GitHub path");
	}
	if (isAbsoluteFilePath(filePath) || hasDotDotSegment(filePath)) {
		throw new Error("invalid GitHub path");
	}
}

export function encodeFilePath(filePath) {
	validateFilePath(filePath);
	return filePath
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

export function validateDestinationPath(destinationPath) {
	if (typeof destinationPath !== "string" || !destinationPath) {
		throw new Error("destination outside data dir");
	}
	const resolvedRoot = path.resolve(BANANA_DATA_DIR);
	const resolvedDest = path.resolve(destinationPath);
	const rel = path.relative(resolvedRoot, resolvedDest);
	if (!rel || rel.startsWith("..")) {
		throw new Error("destination outside data dir");
	}
	if (path.isAbsolute(rel)) {
		throw new Error("destination outside data dir");
	}
	return resolvedDest;
}

export function buildContentsApiUrl(owner, repo, filePath, commitSha) {
	validateRepoSlug(owner, repo);
	const encOwner = encodeURIComponent(owner);
	const encRepo = encodeURIComponent(repo);
	const encPath = encodeFilePath(filePath);
	const refQuery = commitSha ? `?ref=${encodeURIComponent(commitSha)}` : "";
	return `${GITHUB_API_URL}/repos/${encOwner}/${encRepo}/contents/${encPath}${refQuery}`;
}

export function buildRawFileUrl(owner, repo, commitSha, filePath) {
	validateRepoSlug(owner, repo);
	const encOwner = encodeURIComponent(owner);
	const encRepo = encodeURIComponent(repo);
	const encSha = encodeURIComponent(commitSha);
	const encPath = encodeFilePath(filePath);
	return `https://raw.githubusercontent.com/${encOwner}/${encRepo}/${encSha}/${encPath}`;
}

export const getRepoContentsUrl = buildContentsApiUrl;
export const getRepoRawUrl = buildRawFileUrl;

/**
 * Generates the GitHub OAuth authorization URL.
 */
export function getOAuthAuthorizeUrl(state, callbackUrl = null) {
	if (!state) {
		throw new Error("OAuth state is required");
	}
	if (!config.githubClientId) {
		throw new Error(
			"GitHub Client ID is not configured. Please set GITHUB_CLIENT_ID in your environment.",
		);
	}

	const redirectUri = callbackUrl || config.githubCallbackUrl;
	const params = new URLSearchParams({
		client_id: config.githubClientId,
		redirect_uri: redirectUri,
		scope: "repo,read:user",
		state: state,
	});

	return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
}

/**
 * Exchanges a temporary OAuth code for a GitHub access token.
 */
export async function exchangeCodeForToken(code) {
	if (!config.githubClientId || !config.githubClientSecret) {
		throw new Error("GitHub OAuth Client ID or Client Secret not configured.");
	}

	const body = JSON.stringify({
		client_id: config.githubClientId,
		client_secret: config.githubClientSecret,
		code,
	});
	const headers = {
		Accept: "application/json",
		"Content-Type": "application/json",
		"User-Agent": USER_AGENT,
	};
	const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
		method: "POST",
		headers,
		body,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`GitHub token exchange failed (HTTP ${response.status}): ${errorText}`,
		);
	}

	const data = await response.json();
	if (data.error) {
		throw new Error(
			`GitHub OAuth error: ${data.error_description || data.error}`,
		);
	}

	return data.access_token;
}

async function fetchGithubJson(endpoint, token, options = {}) {
	const url = endpoint.startsWith("http")
		? endpoint
		: `${GITHUB_API_URL}${endpoint}`;
	const response = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github.v3+json",
			"User-Agent": USER_AGENT,
			...options.headers,
		},
	});

	if (!response.ok) {
		if (response.status === 401) {
			throw new Error(
				"Invalid or expired GitHub access token. Please re-authenticate.",
			);
		}
		const errorText = await response.text();
		throw new Error(
			`GitHub request failed for ${url} (HTTP ${response.status}): ${errorText}`,
		);
	}
	return response.json();
}

/**
 * Verifies a GitHub access token or personal access token (PAT) and retrieves user profile.
 */
export async function verifyTokenAndGetUser(token) {
	if (!token) throw new Error("Missing GitHub access token");

	const user = await fetchGithubJson("/user", token);
	return {
		id: user.id,
		login: user.login,
		name: user.name || user.login,
		avatarUrl: user.avatar_url,
		htmlUrl: user.html_url,
		publicRepos: user.public_repos || 0,
		totalPrivateRepos: user.total_private_repos || 0,
	};
}

/**
 * Lists repositories the authenticated user has access to.
 */
export async function getUserRepositories(token, page = 1, perPage = 100) {
	if (!token) throw new Error("Missing GitHub access token");
	const path = `/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`;
	const repos = await fetchGithubJson(path, token);

	return repos.map((r) => ({
		id: r.id,
		name: r.name,
		fullName: r.full_name,
		owner: r.owner?.login,
		ownerAvatar: r.owner?.avatar_url,
		isPrivate: r.private,
		htmlUrl: r.html_url,
		defaultBranch: r.default_branch || "main",
		description: r.description || "",
		updatedAt: r.updated_at,
	}));
}

/**
 * Fetches branches for a repository.
 */
export async function getRepoBranches(token, owner, repo) {
	if (!token) throw new Error("Missing GitHub access token");
	validateRepoSlug(owner, repo);
	const encOwner = encodeURIComponent(owner);
	const encRepo = encodeURIComponent(repo);
	const branches = await fetchGithubJson(
		`/repos/${encOwner}/${encRepo}/branches?per_page=100`,
		token,
	);

	return branches.map((b) => ({
		name: b.name,
		commitSha: b.commit?.sha,
	}));
}

function formatCommitItem(c) {
	const commitMsg = c.commit?.message || "";
	const author = c.commit?.author;
	const authorName = author?.name || c.author?.login || "Unknown";
	const shortHash = c.sha ? c.sha.substring(0, 7) : "";
	return {
		hash: c.sha,
		shortHash,
		message: commitMsg.split("\n")[0],
		fullMessage: commitMsg,
		author: authorName,
		authorAvatar: c.author?.avatar_url ?? null,
		date: author?.date ?? null,
	};
}

function resolveCommitQuery(options, restArgs = []) {
	if (typeof options === "object" && options !== null) {
		return {
			sha: options.sha,
			pathFilter: options.filePath || options.path,
			limit: options.perPage || 50,
		};
	}
	return {
		sha: options,
		pathFilter: restArgs[0],
		limit: restArgs[1] || 50,
	};
}

/**
 * Fetches commits for a repository, optionally filtered by branch and/or file path.
 */
export async function getRepoCommits(
	token,
	owner,
	repo,
	options = {},
	...rest
) {
	if (!token) throw new Error("Missing GitHub access token");
	validateRepoSlug(owner, repo);

	const { sha, pathFilter, limit } = resolveCommitQuery(options, rest);
	if (pathFilter) {
		validateFilePath(pathFilter);
	}
	const params = new URLSearchParams({ per_page: String(limit) });
	if (sha) params.append("sha", sha);
	if (pathFilter) params.append("path", pathFilter);

	const encOwner = encodeURIComponent(owner);
	const encRepo = encodeURIComponent(repo);
	const commits = await fetchGithubJson(
		`/repos/${encOwner}/${encRepo}/commits?${params.toString()}`,
		token,
	);
	return commits.map(formatCommitItem);
}

/**
 * Fetches pull requests for a repository.
 */
export async function getRepoPullRequests(token, owner, repo, state = "open") {
	if (!token) throw new Error("Missing GitHub access token");
	validateRepoSlug(owner, repo);
	const encOwner = encodeURIComponent(owner);
	const encRepo = encodeURIComponent(repo);
	const pulls = await fetchGithubJson(
		`/repos/${encOwner}/${encRepo}/pulls?state=${state}&per_page=50`,
		token,
	);

	return pulls.map((pr) => ({
		id: pr.id,
		number: pr.number,
		title: pr.title,
		state: pr.state,
		author: pr.user?.login,
		authorAvatar: pr.user?.avatar_url,
		baseRef: pr.base?.ref,
		baseSha: pr.base?.sha,
		headRef: pr.head?.ref,
		headSha: pr.head?.sha,
		headLabel: pr.head?.label,
		createdAt: pr.created_at,
		updatedAt: pr.updated_at,
		htmlUrl: pr.html_url,
	}));
}

/**
 * Scans the repository tree for hardware CAD files (.kicad_pcb, .kicad_sch).
 */
export async function getRepoHardwareFiles(token, owner, repo, ref = "main") {
	if (!token) throw new Error("Missing GitHub access token");
	validateRepoSlug(owner, repo);
	const encOwner = encodeURIComponent(owner);
	const encRepo = encodeURIComponent(repo);
	const encRef = encodeURIComponent(ref);
	const data = await fetchGithubJson(
		`/repos/${encOwner}/${encRepo}/git/trees/${encRef}?recursive=1`,
		token,
	);
	const tree = data.tree || [];

	return tree
		.filter((item) => {
			if (item.type !== "blob") return false;
			return /\.(kicad_pcb|kicad_sch|sch|brd)$/i.test(item.path);
		})
		.map((item) => ({
			path: item.path,
			size: item.size,
			sha: item.sha,
			isPcb: /\.kicad_pcb$/i.test(item.path),
		}));
}

function resolveDownloadParams(options, restArgs = []) {
	if (typeof options === "object" && options !== null) {
		return options;
	}
	return {
		owner: options,
		repo: restArgs[0],
		filePath: restArgs[1],
		commitSha: restArgs[2],
		destinationPath: restArgs[3],
	};
}

async function fetchRawFileBuffer(token, params) {
	const { owner, repo, filePath, commitSha } = params;
	const rawUrl = buildContentsApiUrl(owner, repo, filePath, commitSha);
	const fallbackUrl = buildRawFileUrl(owner, repo, commitSha, filePath);

	const headers = {
		Authorization: `Bearer ${token}`,
		"User-Agent": USER_AGENT,
	};
	let response = await fetch(rawUrl, {
		headers: { ...headers, Accept: "application/vnd.github.raw+json" },
	});

	if (!response.ok) {
		response = await fetch(fallbackUrl, { headers });
	}

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`Failed to download ${filePath} at ${commitSha} from ${owner}/${repo} (HTTP ${response.status}): ${errText}`,
		);
	}

	return response.arrayBuffer();
}

async function isExistingFileNonEmpty(dest) {
	try {
		const stat = await fs.promises.stat(dest);
		return stat.size > 0;
	} catch {
		// File does not exist yet or is inaccessible
		return false;
	}
}

/**
 * Downloads a specific version of a CAD file at a commit hash and writes it to disk.
 */
export async function downloadRepoFile(token, options, ...rest) {
	if (!token) throw new Error("Missing GitHub access token");

	const params = resolveDownloadParams(options, rest);
	validateRepoSlug(params.owner, params.repo);
	validateFilePath(params.filePath);
	const dest = validateDestinationPath(params.destinationPath);

	const parentDir = path.dirname(dest);
	await fs.promises.mkdir(parentDir, { recursive: true });

	if (await isExistingFileNonEmpty(dest)) {
		return dest;
	}

	const arrayBuffer = await fetchRawFileBuffer(token, params);
	await fs.promises.writeFile(dest, Buffer.from(arrayBuffer));
	return dest;
}
