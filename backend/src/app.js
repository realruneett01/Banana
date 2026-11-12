import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import agentRouter from "./routes/agent-routes.js";
import circuitRouter from "./routes/circuit-routes.js";
import editorRouter from "./routes/editor-routes.js";
import { createApiRouter } from "./routes/index.js";
import libraryRouter from "./routes/library-routes.js";
import projectRouter from "./routes/project-routes.js";
import simRouter from "./routes/sim-routes.js";

function setupStaticServing(expressApp, customStaticDir) {
	const candidateDirs = [
		customStaticDir,
		process.env.STATIC_DIR,
		path.resolve(process.cwd(), "frontend/dist"),
		path.resolve(process.cwd(), "../frontend/dist"),
		path.resolve(process.cwd(), "dist"),
		path.resolve(process.cwd(), "public"),
	];
	const staticDir = candidateDirs.find((d) => Boolean(d && fs.existsSync(d)));
	if (!staticDir) return;

	console.log(`[Banana] Serving static frontend from: ${staticDir}`);
	expressApp.use(express.static(staticDir));
	expressApp.get("*", (req, res, next) => {
		if (req.path.startsWith("/api")) return next();
		res.sendFile(path.join(staticDir, "index.html"));
	});
}

function getHostValidator(options) {
	if (typeof options.validateHost === "function") {
		return options.validateHost;
	}
	if (options.allowedHost) {
		return (host) => host === options.allowedHost;
	}
	return null;
}

function createHostValidationMiddleware(isValidHost) {
	return (req, res, next) => {
		const host = req.headers.host;
		if (!host || !isValidHost(host)) {
			return res.status(403).json({ error: "Forbidden: Invalid Host header" });
		}
		next();
	};
}

function setupHostValidation(expressApp, options) {
	const isValidHost = getHostValidator(options);
	if (isValidHost) {
		expressApp.use(createHostValidationMiddleware(isValidHost));
	}
}

function createTokenValidationMiddleware(apiSecret) {
	const expectedSecret = Buffer.from(String(apiSecret));
	return (req, res, next) => {
		const token = Buffer.from(String(req.headers["x-banana-auth"] || ""));
		if (
			token.length !== expectedSecret.length ||
			!crypto.timingSafeEqual(token, expectedSecret)
		) {
			return res
				.status(401)
				.json({ error: "Unauthorized: Invalid or missing local auth token" });
		}
		next();
	};
}

function setupSecurityTokenValidation(expressApp, apiSecret) {
	if (apiSecret) {
		expressApp.use("/api", createTokenValidationMiddleware(apiSecret));
	}
}

function isLocalAppOrigin(origin) {
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false;
		}
		const host = parsed.hostname;
		return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
	} catch {
		return false;
	}
}

function getWebAllowedOrigins() {
	const allowed = new Set();
	if (process.env.CORS_ORIGINS) {
		for (const item of process.env.CORS_ORIGINS.split(",")) {
			const clean = item.trim().replace(/\/+$/, "");
			if (clean) allowed.add(clean);
		}
	}
	const frontendUrl = process.env.FRONTEND_URL || config.frontendUrl;
	if (frontendUrl) {
		const cleanFrontend = frontendUrl.trim().replace(/\/+$/, "");
		if (cleanFrontend) allowed.add(cleanFrontend);
	}
	return allowed;
}

function createCorsOriginValidator(isDesktop) {
	return (origin, callback) => {
		if (!origin) {
			return callback(null, true);
		}
		if (isDesktop) {
			return callback(null, isLocalAppOrigin(origin));
		}
		if (process.env.NODE_ENV !== "production" && isLocalAppOrigin(origin)) {
			return callback(null, true);
		}
		const allowed = getWebAllowedOrigins();
		const normalized = origin.trim().replace(/\/+$/, "");
		const isAllowed = allowed.has("*") || allowed.has(normalized);
		return callback(null, isAllowed);
	};
}

export function createApp(options = {}) {
	const app = express();

	const isDesktop = Boolean(options.apiSecret);
	const allowLocal = isDesktop || process.env.BANANA_ALLOW_LOCAL_REPOS === "1";
	config.allowLocalRepos = allowLocal;
	app.locals.allowLocalRepos = allowLocal;

	// Host validation if specified (Phase 2 hardening)
	setupHostValidation(app, options);

	// Security token validation if specified (Phase 2 hardening)
	setupSecurityTokenValidation(app, options.apiSecret);

	app.use(cors({ origin: createCorsOriginValidator(isDesktop) }));
	app.use(express.json());

	// API routes
	app.use("/api", createApiRouter());
	app.use("/api", simRouter);
	app.use("/api", agentRouter);
	app.use("/api", circuitRouter);
	app.use("/api", editorRouter);
	app.use("/api", libraryRouter);
	app.use("/api", projectRouter);

	// Static files
	setupStaticServing(app, options.staticDir);

	return app;
}
