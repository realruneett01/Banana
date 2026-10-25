import express from "express";

const METHODS = ["get", "post", "put", "patch", "delete"];

/**
 * Express 4 does not catch rejected promises from async handlers, which leaves
 * the request hanging forever. This router forwards them to the error handler.
 */
export function createSafeRouter() {
	const router = express.Router();
	for (const method of METHODS) {
		const original = router[method].bind(router);
		router[method] = (routePath, ...handlers) =>
			original(
				routePath,
				...handlers.map((h) =>
					typeof h === "function" && h.length < 4
						? (req, res, next) => {
								try {
									const out = h(req, res, next);
									if (out && typeof out.catch === "function") out.catch(next);
								} catch (err) {
									next(err);
								}
							}
						: h,
				),
			);
	}
	return router;
}

/** Final error middleware: JSON errors, never a stack trace to the client. */
export function apiErrorHandler(err, _req, res, next) {
	if (res.headersSent) return next(err);
	const status = err.statusCode || err.status || 500;
	if (status >= 500) console.error("[Banana API] Unhandled error:", err);
	res.status(status).json({
		error: status >= 500 ? "Internal server error" : err.message,
		details: status >= 500 ? undefined : err.message,
	});
}
