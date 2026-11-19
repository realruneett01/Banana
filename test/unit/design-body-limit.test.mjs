import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp, DESIGN_BODY_ROUTES } from "../../backend/src/app.js";

const ONE_MB = 1024 * 1024;

async function spawnAppServer() {
	const instance = http.createServer(createApp());
	instance.listen(0, "127.0.0.1");
	await once(instance, "listening");
	return {
		origin: `http://127.0.0.1:${instance.address().port}`,
		teardown: () => new Promise((resolve) => instance.close(resolve)),
	};
}

async function requestStatus(origin, path, body) {
	const response = await fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
	await response.arrayBuffer();
	return response.status;
}

describe("design body limit for /api/board/glb", () => {
	let env;

	before(async () => {
		env = await spawnAppServer();
	});

	after(async () => {
		await env?.teardown();
	});

	test("DESIGN_BODY_ROUTES list contains /api/board/glb", () => {
		assert.ok(DESIGN_BODY_ROUTES.includes("/api/board/glb"));
	});

	test("1 MB JSON body to /api/board/glb is not rejected with 413", async () => {
		const payload = JSON.stringify({ pcb: "x".repeat(ONE_MB) });
		const status = await requestStatus(env.origin, "/api/board/glb", payload);
		assert.notEqual(status, 413);
	});
});
