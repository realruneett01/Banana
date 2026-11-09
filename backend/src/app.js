import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { createApiRouter } from "./routes/index.js";

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

	if (staticDir) {
		console.log(`[Banana] Serving static frontend from: ${staticDir}`);
		expressApp.use(express.static(staticDir));
		expressApp.get("*", (req, res, next) => {
			if (req.path.startsWith("/api")) return next();
			res.sendFile(path.join(staticDir, "index.html"));
		});
	}
}

export function createApp(options = {}) {
	const app = express();

	// Host validation if specified (Phase 2 hardening)
	if (typeof options.validateHost === "function") {
		app.use((req, res, next) => {
			const host = req.headers.host;
			if (!host || !options.validateHost(host)) {
				return res
					.status(403)
					.json({ error: "Forbidden: Invalid Host header" });
			}
			next();
		});
	} else if (options.allowedHost) {
		app.use((req, res, next) => {
			const host = req.headers.host;
			if (!host || host !== options.allowedHost) {
				return res
					.status(403)
					.json({ error: "Forbidden: Invalid Host header" });
			}
			next();
		});
	}

	// Security token validation if specified (Phase 2 hardening)
	if (options.apiSecret) {
		const expectedSecret = Buffer.from(String(options.apiSecret));
		app.use("/api", (req, res, next) => {
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
		});
	}

	app.use(cors());
	app.use(express.json());

	// API routes
	app.use("/api", createApiRouter());

	// Static files
	setupStaticServing(app, options.staticDir);

	return app;
}
