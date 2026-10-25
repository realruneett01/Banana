import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { LoginLimiter } from "./rate-limit.js";
import { loadSessionSecret, signSession, verifySession } from "./session.js";
import { UserStore, normalizeUsername } from "./user-store.js";

const COOKIE = "banana_session";
const PUBLIC_DIR = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"public",
);
export const LOGIN_PREFIX = "/__login";

function readCookie(req, name) {
	for (const part of (req.headers.cookie || "").split(";")) {
		const i = part.indexOf("=");
		if (i > -1 && part.slice(0, i).trim() === name) {
			try {
				return decodeURIComponent(part.slice(i + 1).trim());
			} catch {
				return "";
			}
		}
	}
	return "";
}

function isSecure(req, trustProxy) {
	return (
		req.secure ||
		(trustProxy &&
			String(req.headers["x-forwarded-proto"] || "")
				.split(",")[0]
				.trim() === "https")
	);
}

/** Same-site check for state-changing requests: if the browser sent an Origin it must be us. */
function sameOrigin(req) {
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		return new URL(origin).host === req.headers.host;
	} catch {
		return false;
	}
}

/**
 * Account-based login. Disabled unless BANANA_AUTH=required, so the single-user desktop
 * launcher stays zero-configuration; turn it on for any shared or server deployment.
 */
export function createAuth({
	enabled,
	dataDir,
	sessionHours = 12,
	trustProxy = false,
	store,
	secret,
	limiter,
} = {}) {
	if (!enabled) return { enabled: false };
	const users = store || new UserStore(path.join(dataDir, "users.json"));
	const key = secret || loadSessionSecret(dataDir);
	const loginLimiter = limiter || new LoginLimiter();
	const ttlMs = sessionHours * 3600 * 1000;

	function sessionOf(req) {
		const payload = verifySession(readCookie(req, COOKIE), key);
		if (!payload) return null;
		const user = users.find(payload.u);
		// Password change, disable and delete all bump/clear the user, which kills old cookies.
		if (!user || user.disabled || user.tokenVersion !== payload.v) return null;
		return { username: user.username, role: user.role };
	}

	function cookieHeader(value, req, maxAgeSec) {
		return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${isSecure(req, trustProxy) ? "; Secure" : ""}`;
	}

	const api = express.Router();
	api.use((req, res, next) => {
		res.setHeader("Cache-Control", "no-store");
		if (req.method !== "GET" && !sameOrigin(req))
			return res.status(403).json({ error: "Cross-origin request blocked" });
		next();
	});

	api.get("/", (req, res) => {
		const session = sessionOf(req);
		res.json({
			enabled: true,
			authenticated: Boolean(session),
			user: session,
			setupRequired: users.count === 0,
		});
	});

	api.post("/login", async (req, res) => {
		if (!req.is("application/json"))
			return res
				.status(415)
				.json({ error: "Content-Type must be application/json" });
		const username = normalizeUsername(req.body?.username);
		const password = req.body?.password;
		const ip = req.ip || req.socket.remoteAddress || "unknown";
		const gate = loginLimiter.check(ip, username);
		if (!gate.allowed) {
			res.setHeader("Retry-After", String(gate.retryAfterSec));
			return res
				.status(429)
				.json({
					error: `Too many failed attempts. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minute(s).`,
				});
		}
		const user =
			typeof password === "string"
				? await users.authenticate(username, password)
				: null;
		if (!user) {
			loginLimiter.fail(ip, username);
			return res.status(401).json({ error: "Invalid username or password" });
		}
		loginLimiter.success(ip, username);
		const token = signSession(
			{ u: user.username, v: user.tokenVersion, exp: Date.now() + ttlMs },
			key,
		);
		res.setHeader(
			"Set-Cookie",
			cookieHeader(token, req, Math.floor(ttlMs / 1000)),
		);
		res.json({
			authenticated: true,
			user: { username: user.username, role: user.role },
		});
	});

	api.post("/logout", (req, res) => {
		res.setHeader("Set-Cookie", cookieHeader("", req, 0));
		res.json({ authenticated: false });
	});

	const loginAssets = express.static(PUBLIC_DIR, {
		index: "login.html",
		fallthrough: true,
		maxAge: 0,
	});

	return {
		enabled: true,
		store: users,
		sessionOf,
		/** mounted at /api/session */
		sessionRouter: api,
		/** API guard: valid session required, except the health probe and the session endpoints. */
		apiGuard(req, res, next) {
			if (
				req.path === "/health-check" ||
				req.path === "/session" ||
				req.path.startsWith("/session/")
			)
				return next();
			if (!sameOrigin(req) && req.method !== "GET")
				return res.status(403).json({ error: "Cross-origin request blocked" });
			const session = sessionOf(req);
			if (session) {
				req.user = session;
				return next();
			}
			res.status(401).json({ error: "Login required", loginRequired: true });
		},
		/** Page guard: anonymous visitors only ever see the login page. */
		pageGuard(req, res, next) {
			if (
				req.path === LOGIN_PREFIX ||
				req.path.startsWith(`${LOGIN_PREFIX}/`)
			) {
				req.url = req.url.slice(LOGIN_PREFIX.length) || "/";
				return loginAssets(req, res, () => res.status(404).send("Not found"));
			}
			if (req.path.startsWith("/api")) return next();
			if (sessionOf(req)) return next();
			if (req.method !== "GET" && req.method !== "HEAD")
				return res.status(401).send("Login required");
			res.redirect(
				302,
				`${LOGIN_PREFIX}/?next=${encodeURIComponent(req.originalUrl)}`,
			);
		},
	};
}

export function bootstrapAdmin(store, env = process.env) {
	if (store.count > 0 || !env.BANANA_ADMIN_USER || !env.BANANA_ADMIN_PASSWORD)
		return Promise.resolve(false);
	return store
		.create(env.BANANA_ADMIN_USER, env.BANANA_ADMIN_PASSWORD, "admin")
		.then(() => true);
}
