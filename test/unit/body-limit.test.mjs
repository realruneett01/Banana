import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp, DESIGN_BODY_LIMIT } from "../../backend/src/app.js";

const MB = 1024 * 1024;

function bootServer(app) {
	const server = http.createServer(app);
	return new Promise((done) => {
		server.listen(0, "127.0.0.1", () => {
			done({ server, port: server.address().port });
		});
	});
}

function boardBody(bytes) {
	return JSON.stringify({ ir: {}, board: { pad: "x".repeat(bytes) } });
}

async function postStatus(port, endpoint, body) {
	const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
	await res.arrayBuffer();
	return res.status;
}

describe("route-scoped JSON body limit", () => {
	let server;
	let port;

	before(async () => {
		({ server, port } = await bootServer(createApp()));
	});

	after(() => new Promise((done) => server.close(done)));

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
			const status = await postStatus(port, endpoint, boardBody(sizeMb * MB));
			assert.equal(status === 413, tooLarge);
		});
	}
});
