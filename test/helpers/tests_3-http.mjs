// Shared HTTP helpers for route tests that run an Express app on loopback.
import { once } from "node:events";
import http from "node:http";

/** Serves `app` on an ephemeral 127.0.0.1 port; returns { port, close }. */
export async function listenOnLoopback(app) {
	const server = http.createServer(app).listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		port: server.address().port,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

/**
 * GETs `routePath` (body undefined) or POSTs `body` as JSON.
 * Returns { status, json }; a body that is not JSON yields `fallback`.
 */
export async function requestJson(port, routePath, body, fallback = null) {
	const init =
		body === undefined
			? {}
			: {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				};
	const res = await fetch(`http://127.0.0.1:${port}${routePath}`, init);
	const json = await res.json().catch(() => fallback);
	return { status: res.status, json };
}
