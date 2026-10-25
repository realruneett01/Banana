import crypto from "node:crypto";

const COOKIE = "banana_access";

export function isLoopbackHost(host) {
	return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
		String(host).toLowerCase(),
	);
}

function hostnameOf(origin) {
	try {
		return new URL(origin).hostname;
	} catch {
		return null;
	}
}

/**
 * CORS policy: no Origin header (curl, same-origin GETs), the page's own origin,
 * loopback origins (Vite dev server), and the configured FRONTEND_URL.
 */
export function corsOptionsFor(frontendUrl) {
	const configured = frontendUrl ? hostnameOf(frontendUrl) : null;
	const configuredOrigin = frontendUrl ? new URL(frontendUrl).origin : null;
	return (req, callback) => {
		const origin = req.headers.origin;
		let allowed = !origin;
		if (origin) {
			const originHost = hostnameOf(origin);
			const sameHost =
				originHost &&
				req.headers.host &&
				new URL(origin).host === req.headers.host;
			allowed = Boolean(
				sameHost ||
					(originHost && isLoopbackHost(originHost)) ||
					origin === configuredOrigin ||
					(configured &&
						originHost === configured &&
						origin === configuredOrigin),
			);
		}
		callback(null, { origin: allowed, credentials: true });
	};
}

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

export function tokensMatch(expected, provided) {
	if (typeof provided !== "string" || provided.length === 0) return false;
	const a = crypto.createHash("sha256").update(expected).digest();
	const b = crypto.createHash("sha256").update(provided).digest();
	return crypto.timingSafeEqual(a, b);
}

/** Protects /api when BANANA_ACCESS_TOKEN is set. The health check stays open for container probes. */
export function accessGuard(token) {
	return (req, res, next) => {
		if (!token || req.path === "/health-check") return next();
		const provided = req.headers["x-banana-token"] || readCookie(req, COOKIE);
		if (tokensMatch(token, String(provided || ""))) return next();
		res.status(401).json({
			error:
				"Access token required. Open /login?token=<token> once in this browser.",
		});
	};
}

/** GET /login?token=... sets the access cookie for this browser, then goes to the app. */
export function loginHandler(token) {
	return (req, res) => {
		if (!token) return res.redirect("/");
		if (!tokensMatch(token, String(req.query.token || ""))) {
			return res.status(401).send("Invalid access token");
		}
		res.setHeader(
			"Set-Cookie",
			`${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
		);
		res.redirect("/");
	};
}
