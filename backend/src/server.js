import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import {
	accessGuard,
	corsOptionsFor,
	isLoopbackHost,
	loginHandler,
} from "./access-control.js";
import { bootstrapAdmin, createAuth } from "./auth/index.js";
import { config } from "./config.js";
import { createApiRouter } from "./routes/index.js";
import { APP_ROOT } from "./runtime-detect.js";

export function createApp({ auth } = {}) {
	const app = express();
	const authn =
		auth ??
		createAuth({
			enabled: config.authEnabled,
			dataDir: config.dataDir,
			sessionHours: config.sessionHours,
			trustProxy: config.trustProxy,
		});
	if (config.trustProxy) app.set("trust proxy", 1);

	app.disable("x-powered-by");
	app.use(cors(corsOptionsFor(config.frontendUrl)));
	app.use(express.json({ limit: "2mb" }));

	if (authn.enabled) {
		// Accounts replace the shared access token: one credential model at a time.
		app.use("/api/session", authn.sessionRouter);
		app.use(authn.pageGuard);
		app.use("/api", authn.apiGuard, createApiRouter());
	} else {
		app.get("/login", loginHandler(config.accessToken));
		app.use("/api", accessGuard(config.accessToken), createApiRouter());
	}
	setupStaticServing(app);

	// Malformed JSON bodies and other pre-router errors.
	app.use((err, _req, res, next) => {
		if (res.headersSent) return next(err);
		const status = err.statusCode || err.status || 500;
		res
			.status(status)
			.json({ error: status >= 500 ? "Internal server error" : err.message });
	});
	return app;
}

function setupStaticServing(expressApp) {
	const candidateDirs = [
		process.env.STATIC_DIR,
		path.join(APP_ROOT, "frontend", "dist"),
		path.resolve(process.cwd(), "frontend/dist"),
		path.resolve(process.cwd(), "../frontend/dist"),
		path.resolve(process.cwd(), "dist"),
		path.resolve(process.cwd(), "public"),
	];
	const staticDir = candidateDirs.find((d) =>
		Boolean(d && fs.existsSync(path.join(d, "index.html"))),
	);

	if (!staticDir) {
		console.warn(
			"[Banana] No built frontend found (frontend/dist). Run `npm run build` to serve the UI from this server.",
		);
		return;
	}
	console.log(`[Banana] Serving static frontend from: ${staticDir}`);
	expressApp.use(express.static(staticDir));
	expressApp.get("*", (req, res, next) => {
		if (req.path.startsWith("/api")) return next();
		res.sendFile(path.join(staticDir, "index.html"));
	});
}

export async function startServer({
	port = config.port,
	host = config.host,
} = {}) {
	const auth = createAuth({
		enabled: config.authEnabled,
		dataDir: config.dataDir,
		sessionHours: config.sessionHours,
		trustProxy: config.trustProxy,
	});
	if (auth.enabled) {
		if (await bootstrapAdmin(auth.store)) {
			console.log(
				`[Banana] Created initial admin account "${process.env.BANANA_ADMIN_USER}".`,
			);
		}
		if (auth.store.count === 0) {
			console.warn(
				"[Banana] Login is required but no accounts exist. Run: npm run user -- add <name> --admin",
			);
		}
	}
	const app = createApp({ auth });
	return new Promise((resolve, reject) => {
		const server = app.listen(port, host);
		server.once("listening", () => {
			const addr = server.address();
			if (!config.accessToken && !isLoopbackHost(host)) {
				console.warn(
					"[Banana] WARNING: listening on a non-loopback address without BANANA_ACCESS_TOKEN. Anyone who can reach this port can read repositories this process can read.",
				);
			}
			console.log(`[Banana] Server listening on http://${host}:${addr.port}`);
			resolve(server);
		});
		server.once("error", (err) => {
			if (err.code === "EADDRINUSE") {
				err.message = `Port ${port} is already in use. Set PORT to a free port (or run \`npm run preflight\`).`;
			}
			reject(err);
		});
	});
}

const isMain =
	Boolean(process.argv[1]) &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	process.on("unhandledRejection", (reason) => {
		console.error("[Banana] Unhandled rejection:", reason);
	});
	startServer()
		.then((server) => {
			const shutdown = () => server.close(() => process.exit(0));
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		})
		.catch((err) => {
			console.error(`[Banana] Failed to start: ${err.message}`);
			process.exit(1);
		});
}
