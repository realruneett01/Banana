import crypto from "node:crypto";
import express from "express";
import {
	exchangeCodeForToken,
	getOAuthAuthorizeUrl,
	getRepoBranches,
	getRepoCommits,
	getRepoHardwareFiles,
	getRepoPullRequests,
	getUserRepositories,
	verifyTokenAndGetUser,
} from "../github-service.js";

const DEFAULT_MAX_STATES = 1000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class StateStore {
	constructor(options = {}) {
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_STATES;
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.now = options.now ?? (() => Date.now());
		this.states = new Map();
	}

	set(state, createdAt = this.now()) {
		if (!state) return state;
		if (!this.states.has(state) && this.states.size >= this.maxEntries) {
			const oldest = this.states.keys().next().value;
			this.states.delete(oldest);
		}
		this.states.set(state, createdAt);
		return state;
	}

	generate() {
		const state = crypto.randomBytes(16).toString("hex");
		this.set(state);
		return state;
	}

	validate(state) {
		if (!state || typeof state !== "string") return false;
		const createdAt = this.states.get(state);
		if (createdAt === undefined) return false;
		if (this.now() - createdAt > this.ttlMs) {
			this.states.delete(state);
			return false;
		}
		return true;
	}

	consume(state) {
		if (!this.validate(state)) return false;
		this.states.delete(state);
		return true;
	}

	clear() {
		this.states.clear();
	}

	get size() {
		return this.states.size;
	}
}

export function createStateStore(options) {
	return new StateStore(options);
}

export const stateStore = createStateStore();

const router = express.Router();

export function getDynamicOrigin(req) {
	if (process.env.FRONTEND_URL) {
		return process.env.FRONTEND_URL.trim().replace(/\/+$/, "");
	}
	const trustProxy = process.env.TRUST_PROXY === "1";
	const forwardedProto = trustProxy
		? req?.headers?.["x-forwarded-proto"]
		: null;
	const protocol = forwardedProto || req?.protocol || "http";
	const forwardedHost = trustProxy ? req?.headers?.["x-forwarded-host"] : null;
	const rawHost =
		typeof req?.get === "function" ? req.get("host") : req?.headers?.host;
	const host = forwardedHost || rawHost || "localhost";
	return `${protocol}://${host}`;
}

// 1. Get OAuth login URL
router.get("/auth/github/url", (req, res) => {
	try {
		const dynamicOrigin = getDynamicOrigin(req);
		const dynamicCallback =
			process.env.GITHUB_CALLBACK_URL &&
			!process.env.GITHUB_CALLBACK_URL.includes("localhost")
				? process.env.GITHUB_CALLBACK_URL
				: `${dynamicOrigin}/api/auth/github/callback`;

		const state = stateStore.generate();
		const url = getOAuthAuthorizeUrl(state, dynamicCallback);
		res.json({ url, configured: true });
	} catch (err) {
		res.json({ configured: false, error: err.message });
	}
});

// 2. OAuth Callback
router.get("/auth/github/callback", async (req, res) => {
	const { code, state } = req.query;
	if (!state || !stateStore.consume(state)) {
		return res.status(400).send("Invalid OAuth state");
	}
	if (!code) {
		return res.status(400).send("Authorization code missing");
	}

	const targetFrontend = getDynamicOrigin(req);

	try {
		const token = await exchangeCodeForToken(code);
		const redirectUrl = `${targetFrontend}/#github_token=${encodeURIComponent(token)}`;
		res.redirect(redirectUrl);
	} catch (err) {
		console.error("[Banana API] GitHub OAuth callback error:", err);
		res.redirect(
			`${targetFrontend}/#github_error=${encodeURIComponent(err.message)}`,
		);
	}
});

function extractToken(req) {
	return (
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token
	);
}

/**
 * Registers a token-guarded GitHub read route: 401 without a token,
 * { [key]: data } on success, 500 { error, details } on failure.
 */
function githubReadRoute(path, { key, errorMessage, fetch }) {
	router.get(path, async (req, res) => {
		const token = extractToken(req);
		if (!token) return res.status(401).json({ error: "GitHub token required" });
		try {
			res.json({ [key]: await fetch(token, req) });
		} catch (err) {
			res.status(500).json({ error: errorMessage, details: err.message });
		}
	});
}

// 3. Verify Token & Get User
router.get("/auth/github/verify", async (req, res) => {
	const token = extractToken(req);
	if (!token) {
		return res.status(401).json({ error: "GitHub token required" });
	}
	try {
		const user = await verifyTokenAndGetUser(token);
		res.json({ authenticated: true, user });
	} catch (err) {
		res.status(401).json({ authenticated: false, error: err.message });
	}
});

// 4. List User Repositories
githubReadRoute("/github/repos", {
	key: "repos",
	errorMessage: "Failed to list repositories",
	fetch: (token, req) =>
		getUserRepositories(token, parseInt(req.query.page, 10) || 1),
});

// 5. Get Repo Branches
githubReadRoute("/github/repos/:owner/:repo/branches", {
	key: "branches",
	errorMessage: "Failed to fetch branches",
	fetch: (token, { params }) =>
		getRepoBranches(token, params.owner, params.repo),
});

// 6. Get Repo Commits
githubReadRoute("/github/repos/:owner/:repo/commits", {
	key: "commits",
	errorMessage: "Failed to fetch commits",
	fetch: (token, { params, query }) =>
		getRepoCommits(token, params.owner, params.repo, {
			sha: query.sha,
			filePath: query.path,
		}),
});

// 7. Get Repo Pull Requests
githubReadRoute("/github/repos/:owner/:repo/pulls", {
	key: "pulls",
	errorMessage: "Failed to fetch pull requests",
	fetch: (token, { params, query }) =>
		getRepoPullRequests(
			token,
			params.owner,
			params.repo,
			query.state || "open",
		),
});

// 8. Get Repo Hardware Files (.kicad_pcb / .kicad_sch)
githubReadRoute("/github/repos/:owner/:repo/files", {
	key: "files",
	errorMessage: "Failed to fetch hardware files from repository",
	fetch: (token, { params, query }) =>
		getRepoHardwareFiles(token, params.owner, params.repo, query.ref || "main"),
});

export default router;
