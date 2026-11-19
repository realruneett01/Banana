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
import { createSqliteStateStore } from "../oauth-state-sqlite.js";

const DEFAULT_MAX_STATES = 1000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_HANDOFFS = 500;
const DEFAULT_HANDOFF_TTL_MS = 60 * 1000;
const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/;

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

function resolveStateStore() {
	const dbPath = process.env.OAUTH_STATE_DB;
	if (typeof dbPath === "string" && dbPath.trim() !== "") {
		return createSqliteStateStore({ filename: dbPath });
	}
	return createStateStore();
}

export const stateStore = resolveStateStore();

export class HandoffStore {
	constructor(options = {}) {
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_HANDOFFS;
		this.ttlMs = options.ttlMs ?? DEFAULT_HANDOFF_TTL_MS;
		this.now = options.now ?? (() => Date.now());
		this.entries = new Map();
	}

	put(token, createdAt = this.now()) {
		if (!token || typeof token !== "string") return null;
		if (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			this.entries.delete(oldest);
		}
		const code = crypto.randomBytes(32).toString("hex");
		this.entries.set(code, { token, createdAt });
		return code;
	}

	take(code) {
		if (!code || typeof code !== "string") return null;
		const entry = this.entries.get(code);
		if (!entry) return null;
		this.entries.delete(code);
		if (this.now() - entry.createdAt > this.ttlMs) {
			return null;
		}
		return entry.token;
	}

	clear() {
		this.entries.clear();
	}

	get size() {
		return this.entries.size;
	}
}

export function createHandoffStore(options) {
	return new HandoffStore(options);
}

export const handoffStore = createHandoffStore();

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

function isValidHandoffCode(code) {
	return typeof code === "string" && HEX_64_PATTERN.test(code);
}

function extractHandoffCode(req) {
	const body = req.body;
	if (!body) return null;
	if (typeof body === "object") return body.code;
	if (typeof body === "string") {
		try {
			return JSON.parse(body)?.code;
		} catch {
			return null;
		}
	}
	return null;
}

function logOAuthCallbackError(err) {
	console.error("[Banana API] GitHub OAuth callback error:", {
		name: err?.name,
		code: err?.code,
	});
}

function checkProductionFrontendUrl(res) {
	const isProd = process.env.NODE_ENV === "production";
	const hasFrontendUrl = Boolean(process.env.FRONTEND_URL?.trim());
	if (isProd && !hasFrontendUrl) {
		res.status(500).send("FRONTEND_URL must be configured");
		return false;
	}
	return true;
}

function createLoginUrlHandler(sStore) {
	return (req, res) => {
		try {
			const callbackUrl = getCallbackUrl(req);
			const state = sStore.generate();
			const url = getOAuthAuthorizeUrl(state, callbackUrl);
			res.json({ url, configured: true });
		} catch (err) {
			res.json({ configured: false, error: err.message });
		}
	};
}

function createCallbackHandler({
	exchange,
	handoffStore: hStore,
	stateStore: sStore,
}) {
	return async (req, res) => {
		if (!checkProductionFrontendUrl(res)) return;
		const { code, state } = req.query;
		if (!state || !sStore.consume(state)) {
			return res.status(400).send("Invalid OAuth state");
		}
		if (!code) {
			return res.status(400).send("Authorization code missing");
		}

		const targetFrontend = getDynamicOrigin(req);
		try {
			const token = await exchange(code);
			const handoffCode = hStore.put(token);
			const redirectUrl = `${targetFrontend}/#github_handoff=${encodeURIComponent(handoffCode)}`;
			res.redirect(redirectUrl);
		} catch (err) {
			logOAuthCallbackError(err);
			res.redirect(`${targetFrontend}/#github_error=oauth_failed`);
		}
	};
}

function createHandoffHandler(hStore) {
	return (req, res) => {
		const code = extractHandoffCode(req);
		if (!isValidHandoffCode(code)) {
			return res.status(400).json({ error: "Invalid handoff code" });
		}
		const token = hStore.take(code);
		if (!token) {
			return res.status(400).json({ error: "Invalid handoff code" });
		}
		res.set("Cache-Control", "no-store");
		res.status(200).json({ token });
	};
}

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

function githubReadRoute(rtr, path, { key, errorMessage, fetch }) {
	rtr.get(path, requireToken, async (req, res) => {
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

function registerRepoReadRoutes(rtr) {
	githubReadRoute(rtr, "/github/repos", {
		key: "repos",
		errorMessage: "Failed to list repositories",
		fetch: (token, req) =>
			getUserRepositories(token, parseInt(req.query.page, 10) || 1),
	});

	githubReadRoute(rtr, "/github/repos/:owner/:repo/branches", {
		key: "branches",
		errorMessage: "Failed to fetch branches",
		fetch: (token, { params }) =>
			getRepoBranches(token, params.owner, params.repo),
	});
}

function registerRepoDetailRoutes(rtr) {
	githubReadRoute(rtr, "/github/repos/:owner/:repo/commits", {
		key: "commits",
		errorMessage: "Failed to fetch commits",
		fetch: (token, { params, query }) =>
			getRepoCommits(token, params.owner, params.repo, {
				sha: query.sha,
				filePath: query.path,
			}),
	});

	githubReadRoute(rtr, "/github/repos/:owner/:repo/pulls", {
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

	githubReadRoute(rtr, "/github/repos/:owner/:repo/files", {
		key: "files",
		errorMessage: "Failed to fetch hardware files from repository",
		fetch: (token, { params, query }) =>
			getRepoHardwareFiles(
				token,
				params.owner,
				params.repo,
				query.ref || "main",
			),
	});
}

function registerProtectedRoutes(rtr) {
	rtr.get("/auth/github/verify", requireToken, handleVerify);
	registerRepoReadRoutes(rtr);
	registerRepoDetailRoutes(rtr);
}

export function createGithubRouter(dependencies = {}) {
	const rtr = express.Router();
	const exchange = dependencies.exchangeCodeForToken ?? exchangeCodeForToken;
	const hStore = dependencies.handoffStore ?? handoffStore;
	const sStore = dependencies.stateStore ?? stateStore;

	rtr.get("/auth/github/url", createLoginUrlHandler(sStore));
	rtr.get(
		"/auth/github/callback",
		createCallbackHandler({
			exchange,
			handoffStore: hStore,
			stateStore: sStore,
		}),
	);
	rtr.post(
		"/auth/github/handoff",
		express.json(),
		createHandoffHandler(hStore),
	);
	registerProtectedRoutes(rtr);
	return rtr;
}

const defaultRouter = createGithubRouter();
export default defaultRouter;
