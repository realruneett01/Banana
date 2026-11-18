import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp, DESIGN_BODY_LIMIT } from "../../backend/src/app.js";

const BYTES_PER_MB = 1024 * 1024;

async function spawnAppServer() {
	const instance = http.createServer(createApp());
	instance.listen(0, "127.0.0.1");
	await once(instance, "listening");
	return {
		origin: `http://127.0.0.1:${instance.address().port}`,
		teardown: () => new Promise((resolve) => instance.close(resolve)),
	};
}

function makePayload(sizeInBytes) {
	return JSON.stringify({
		ir: {},
		board: { pad: "x".repeat(sizeInBytes) },
	});
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

describe("route-scoped JSON body limit", () => {
	let env;

	before(async () => {
		env = await spawnAppServer();
	});

	after(async () => {
		await env?.teardown();
	});

	test("DESIGN_BODY_LIMIT is 32mb", () => {
		assert.equal(DESIGN_BODY_LIMIT, "32mb");
	});

	const cases = [
		["2 MB board to a design route", "/api/editor/check", 2, false],
		["2 MB body to a non-design /api route", "/api/sim/compare", 2, true],
		[
			"body over DESIGN_BODY_LIMIT to a design route",
			"/api/editor/check",
			33,
			true,
		],
	];

	for (const [name, endpoint, sizeMb, tooLarge] of cases) {
		test(`${name}: 413 is ${tooLarge}`, async () => {
			const body = makePayload(sizeMb * BYTES_PER_MB);
			const status = await requestStatus(env.origin, endpoint, body);
			assert.equal(status === 413, tooLarge);
		});
	}
});
