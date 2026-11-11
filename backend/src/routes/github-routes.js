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

function resolveProtocol(req, trustProxy) {
	if (trustProxy) {
		const forwarded = req?.headers?.["x-forwarded-proto"];
		if (forwarded) return forwarded;
	}
	return req?.protocol || "http";
}

function getRawHost(req) {
	if (typeof req?.get === "function") {
		return req.get("host");
	}
	return req?.headers?.host;
}

function resolveHost(req, trustProxy) {
	if (trustProxy) {
		const forwarded = req?.headers?.["x-forwarded-host"];
		if (forwarded) return forwarded;
	}
	return getRawHost(req) || "localhost";
}

export function getDynamicOrigin(req) {
	const frontendUrl = process.env.FRONTEND_URL;
	if (frontendUrl) {
		return frontendUrl.trim().replace(/\/+$/, "");
	}
	const trustProxy = process.env.TRUST_PROXY === "1";
	const protocol = resolveProtocol(req, trustProxy);
	const host = resolveHost(req, trustProxy);
	return `${protocol}://${host}`;
}

function getCallbackUrl(req) {
	const customUrl = process.env.GITHUB_CALLBACK_URL;
	if (customUrl && !customUrl.includes("localhost")) {
		return customUrl;
	}
	return `${getDynamicOrigin(req)}/api/auth/github/callback`;
}

// 1. Get OAuth login URL
router.get("/auth/github/url", (req, res) => {
	try {
		const callbackUrl = getCallbackUrl(req);
		const state = stateStore.generate();
		const url = getOAuthAuthorizeUrl(state, callbackUrl);
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

function requireToken(req, res, next) {
	const token = extractToken(req);
	if (!token) {
		return res.status(401).json({ error: "GitHub token required" });
	}
	req.token = token;
	next();
}

/**
 * Registers a token-guarded GitHub read route: 401 without a token,
 * { [key]: data } on success, 500 { error, details } on failure.
 */
function githubReadRoute(path, { key, errorMessage, fetch }) {
	router.get(path, requireToken, async (req, res) => {
		try {
			res.json({ [key]: await fetch(req.token, req) });
		} catch (err) {
			res.status(500).json({ error: errorMessage, details: err.message });
		}
	});
}

async function handleVerify(req, res) {
	try {
		const user = await verifyTokenAndGetUser(req.token);
		res.json({ authenticated: true, user });
	} catch (err) {
		res.status(401).json({ authenticated: false, error: err.message });
	}
}

// 3. Verify Token & Get User
router.get("/auth/github/verify", requireToken, handleVerify);

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
