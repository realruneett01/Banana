// MCP server tests: raw protocol edge cases, then the official SDK client driving a whole design session.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { hasKicad, tmpDir } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projects = tmpDir("banana-mcp-proj-");
process.env.BANANA_PROJECTS_DIR = projects;
const { findLibraryRoot } = await import("../backend/src/design/kicad-lib.js");
const { ngspiceAvailable } = await import("../backend/src/design/simulate.js");
const { handleLine } = await import("../backend/src/mcp/protocol.js");
const { toolList } = await import("../backend/src/mcp/tools.js");
const { validate } = await import("../backend/src/mcp/schema.js");

const haveLibs = Boolean(
	findLibraryRoot("symbols") && findLibraryRoot("footprints"),
);
const skipFlow = !hasKicad()
	? "kicad-cli not installed"
	: !haveLibs
		? "KiCad libraries not installed"
		: false;
const haveSpice = await ngspiceAvailable();
after(() => fs.rmSync(projects, { recursive: true, force: true }));

const rpc = (method, params, id = 1) =>
	JSON.stringify({ jsonrpc: "2.0", id, method, params });

test("protocol: handshake, version negotiation, notifications, ping", async (t) => {
	await t.test("negotiates a supported version", async () => {
		for (const v of ["2025-06-18", "2025-03-26", "2024-11-05"]) {
			const r = await handleLine(
				rpc("initialize", {
					protocolVersion: v,
					capabilities: {},
					clientInfo: { name: "t", version: "1" },
				}),
			);
			assert.equal(r.result.protocolVersion, v);
			assert.equal(r.result.serverInfo.name, "banana");
			assert.ok(r.result.capabilities.tools);
			assert.ok(r.result.instructions.length > 50);
		}
	});
	await t.test("falls back to the newest version it supports", async () =>
		assert.equal(
			(await handleLine(rpc("initialize", { protocolVersion: "1999-01-01" })))
				.result.protocolVersion,
			"2025-06-18",
		),
	);
	await t.test("notifications produce no reply", async () =>
		assert.equal(
			await handleLine(
				JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
			),
			null,
		),
	);
	await t.test("ping", async () =>
		assert.deepEqual((await handleLine(rpc("ping"))).result, {}),
	);
	await t.test("string ids are echoed", async () =>
		assert.equal(
			(await handleLine(rpc("ping", undefined, "abc-1"))).id,
			"abc-1",
		),
	);
});

test("protocol: malformed and hostile input never crashes or hangs", async (t) => {
	const cases = [
		["not json", "{", -32700],
		["empty line object", "{}", -32600],
		[
			"wrong version",
			JSON.stringify({ jsonrpc: "1.0", id: 1, method: "ping" }),
			-32600,
		],
		[
			"method not a string",
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: 5 }),
			-32600,
		],
		[
			"object id",
			JSON.stringify({ jsonrpc: "2.0", id: {}, method: "ping" }),
			-32600,
		],
		[
			"array id",
			JSON.stringify({ jsonrpc: "2.0", id: [1], method: "ping" }),
			-32600,
		],
		["unknown method", rpc("nope/nothing"), -32601],
		["tools/call without params", rpc("tools/call"), -32602],
		["tools/call name not a string", rpc("tools/call", { name: 5 }), -32602],
		[
			"tools/call arguments not object",
			rpc("tools/call", { name: "list_projects", arguments: [] }),
			-32602,
		],
		[
			"tools/call arguments null",
			rpc("tools/call", { name: "list_projects", arguments: null }),
			-32602,
		],
		[
			"unknown tool",
			rpc("tools/call", { name: "format_disk", arguments: {} }),
			-32602,
		],
		["empty batch", "[]", -32600],
		["null", "null", -32600],
		["number", "42", -32600],
		["string", '"x"', -32600],
	];
	for (const [name, line, code] of cases)
		await t.test(name, async () => {
			const r = await handleLine(line);
			assert.equal(r.error?.code, code, JSON.stringify(r));
		});
	await t.test(
		"batch returns one reply per request and skips notifications",
		async () => {
			const r = await handleLine(
				`[${rpc("ping", undefined, 1)},{"jsonrpc":"2.0","method":"notifications/initialized"},${rpc("tools/list", undefined, 2)}]`,
			);
			assert.deepEqual(
				r.map((x) => x.id),
				[1, 2],
			);
		},
	);
	await t.test("huge garbage line", async () =>
		assert.equal((await handleLine("x".repeat(2_000_000))).error.code, -32700),
	);
	await t.test("deeply nested JSON", async () => {
		const r = await handleLine(`${"[".repeat(5000)}${"]".repeat(5000)}`);
		assert.ok(r === null || r.error || Array.isArray(r));
	});
});

test("tool catalogue is complete and every schema is well-formed", async (t) => {
	const tools = toolList();
	const names = tools.map((x) => x.name);
	for (const n of [
		"list_projects",
		"create_project",
		"get_design",
		"search_symbols",
		"get_symbol",
		"search_footprints",
		"get_footprint",
		"edit",
		"autoroute",
		"build",
		"run_checks",
		"add_test",
		"run_simulation",
		"history",
		"diff",
		"render",
	])
		assert.ok(names.includes(n), `missing ${n}`);
	assert.equal(new Set(names).size, names.length);
	for (const tool of tools)
		await t.test(tool.name, () => {
			assert.ok(tool.description.length > 20);
			assert.equal(tool.inputSchema.type, "object");
			assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
			assert.doesNotThrow(() => JSON.stringify(tool));
		});
});

test("schema validator reports precise paths", async (t) => {
	const schema = {
		type: "object",
		required: ["a"],
		properties: {
			a: { type: "string", maxLength: 3 },
			n: { type: "integer", minimum: 1, maximum: 5 },
			l: { type: "array", items: { type: "number" }, maxItems: 2 },
			e: { enum: ["x", "y"] },
		},
		additionalProperties: false,
	};
	const cases = [
		[{ a: "ab" }, 0],
		[{}, 1],
		[{ a: 5 }, 1],
		[{ a: "abcd" }, 1],
		[{ a: "a", n: 0 }, 1],
		[{ a: "a", n: 1.5 }, 1],
		[{ a: "a", n: 6 }, 1],
		[{ a: "a", l: [1, "x"] }, 1],
		[{ a: "a", l: [1, 2, 3] }, 1],
		[{ a: "a", e: "z" }, 1],
		[{ a: "a", extra: 1 }, 1],
		["str", 1],
		[null, 1],
		[[], 1],
		[{ a: "a", n: Number.NaN }, 1],
	];
	for (const [v, n] of cases)
		await t.test(JSON.stringify(v), () =>
			assert.equal(validate(v, schema).length, n),
		);
});

test("every tool rejects bad arguments instead of crashing (fuzzed, 200 calls)", async (t) => {
	const junk = [
		null,
		5,
		"x",
		[],
		{},
		{ project: "../../etc" },
		{ project: 5 },
		{ project: "a".repeat(500) },
		{ operations: "no" },
		{ query: "" },
		{ id: {} },
		{ project: "nope-nope", operations: [{ op: "format" }] },
	];
	let i = 0;
	for (const tool of toolList()) {
		for (const j of junk) {
			i++;
			await t.test(
				`${tool.name} ${JSON.stringify(j)?.slice(0, 40)}`,
				async () => {
					const r = await handleLine(
						rpc("tools/call", { name: tool.name, arguments: j }),
					);
					if (j === null || typeof j !== "object" || Array.isArray(j))
						assert.ok(r.error, "non-object arguments are protocol errors");
					else if (tool.name === "list_projects" && Object.keys(j).length === 0)
						assert.equal(r.result.isError, false);
					else
						assert.ok(
							r.result?.isError === true || r.error,
							`${tool.name} accepted ${JSON.stringify(j)}`,
						);
				},
			);
		}
	}
	assert.ok(i >= 190);
});

// ---------- real client against the real stdio server ----------
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import(
	"@modelcontextprotocol/sdk/client/stdio.js"
);

let client;
before(async () => {
	if (skipFlow) return;
	client = new Client({ name: "banana-test", version: "1.0.0" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [path.join(root, "scripts", "banana-mcp.mjs")],
			env: { ...process.env, BANANA_PROJECTS_DIR: projects },
			stderr: "ignore",
		}),
	);
});
after(async () => {
	await client?.close();
});

const call = async (name, args) => {
	const r = await client.callTool({ name, arguments: args });
	const text = r.content[0].text;
	return { isError: Boolean(r.isError), data: JSON.parse(text), raw: r };
};

test("SDK client: lists the tools over stdio and stdout stays pure JSON-RPC", {
	skip: skipFlow,
}, async () => {
	const { tools } = await client.listTools();
	assert.equal(tools.length, toolList().length);
	assert.ok(tools.every((x) => x.inputSchema.type === "object"));
});

test("SDK client: design, check, route, simulate and review a board end to end", {
	skip: skipFlow,
	timeout: 240000,
}, async (t) => {
	await t.test("create the project", async () => {
		const r = await call("create_project", {
			project: "led-board",
			title: "LED indicator",
		});
		assert.equal(r.isError, false);
		assert.ok(fs.existsSync(path.join(projects, "led-board", "design.json")));
	});
	await t.test(
		"find parts from the real library and read their pins",
		async () => {
			assert.ok(
				(await call("search_symbols", { query: "led" })).data.symbols.includes(
					"Device:LED",
				),
			);
			const sym = await call("get_symbol", { id: "Device:LED" });
			assert.deepEqual(sym.data.pins.map((p) => p.name).sort(), ["A", "K"]);
			assert.ok(
				(await call("search_footprints", { query: "LED_0805" })).data.footprints
					.length > 0,
			);
			assert.equal(
				(await call("get_footprint", { id: "Resistor_SMD:R_0805_2012Metric" }))
					.data.pads.length,
				2,
			);
			assert.equal(
				(await call("get_symbol", { id: "Device:Nope" })).isError,
				true,
			);
		},
	);
	await t.test("a failing batch changes nothing (atomic)", async () => {
		const before = (await call("get_design", { project: "led-board" })).data;
		const r = await call("edit", {
			project: "led-board",
			operations: [
				{
					op: "add_part",
					symbol: "Device:R",
					value: "330",
					footprint: "Resistor_SMD:R_0805_2012Metric",
				},
				{ op: "connect", net: "X", pins: ["R9.1"] },
			],
		});
		assert.equal(r.isError, true);
		assert.match(r.data.error, /Operation 2 \(connect\) failed/);
		assert.deepEqual(
			(await call("get_design", { project: "led-board" })).data,
			before,
		);
	});
	await t.test("edit: parts, nets, flags and build in one call", async () => {
		const r = await call("edit", {
			project: "led-board",
			build: "LED indicator",
			operations: [
				{
					op: "add_part",
					symbol: "Connector_Generic:Conn_01x02",
					value: "5V IN",
					footprint:
						"Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
				},
				{
					op: "add_part",
					symbol: "Device:R",
					value: "330",
					footprint: "Resistor_SMD:R_0805_2012Metric",
				},
				{
					op: "add_part",
					symbol: "Device:LED",
					value: "RED",
					footprint: "LED_SMD:LED_0805_2012Metric",
				},
				{ op: "connect", net: "+5V", pins: ["J1.1", "R1.1"] },
				{ op: "connect", net: "LED_A", pins: ["R1.2", "D1.A"] },
				{ op: "connect", net: "GND", pins: ["D1.K", "J1.2"] },
				{ op: "set_net_flags", net: "+5V", external: true },
				{ op: "set_net_flags", net: "GND", external: true },
			],
		});
		assert.equal(r.isError, false, JSON.stringify(r.data));
		assert.equal(r.data.applied, 8);
		assert.match(r.data.build.commit, /^[0-9a-f]{40}$/);
		assert.ok(
			fs.existsSync(path.join(projects, "led-board", "led-board.kicad_pcb")),
		);
	});
	await t.test(
		"checks fail while the board is unrouted, and say so",
		async () => {
			const r = await call("run_checks", { project: "led-board" });
			assert.equal(r.data.ok, false);
			assert.equal(
				r.data.netlistParity.status,
				"ok",
				"KiCad agrees about connectivity",
			);
			assert.ok(r.data.routing.unrouted.length > 0);
			assert.deepEqual(
				r.data.erc.lite.filter((i) => i.severity === "error"),
				[],
			);
		},
	);
	await t.test("autoroute, then every check passes", async () => {
		const route = await call("autoroute", { project: "led-board" });
		assert.deepEqual(route.data.failedNets, []);
		const r = await call("run_checks", { project: "led-board" });
		assert.equal(
			r.data.ok,
			true,
			JSON.stringify({
				drc: r.data.drc.issues,
				unrouted: r.data.routing.unrouted,
				erc: r.data.erc.lite,
			}),
		);
		assert.equal(r.data.errors, 0);
		assert.equal(r.data.drc.status, "ok");
	});
	await t.test(
		"simulation: expected LED current and forward voltage",
		{ skip: haveSpice ? false : "ngspice not installed" },
		async () => {
			const add = await call("add_test", {
				project: "led-board",
				test: {
					name: "led current",
					sources: [{ name: "VIN", pos: "+5V", value: 5 }],
					expect: [
						{ measure: "v(LED_A)", min: 1.5, max: 2.4 },
						{ measure: "i(VIN)", min: -0.012, max: -0.007 },
					],
				},
			});
			assert.deepEqual(add.data.tests, ["led current"]);
			const sim = await call("run_simulation", { project: "led-board" });
			assert.equal(sim.data.passed, true, JSON.stringify(sim.data.results));
			const bad = await call("add_test", {
				project: "led-board",
				test: {
					name: "too bright",
					sources: [{ name: "VIN", pos: "+5V", value: 5 }],
					expect: [{ measure: "i(VIN)", min: -0.001, max: 0 }],
				},
			});
			assert.equal(bad.isError, false);
			const sim2 = await call("run_simulation", { project: "led-board" });
			assert.equal(sim2.data.passed, false);
			assert.equal(
				sim2.data.results.find((x) => x.name === "too bright").passed,
				false,
			);
			assert.equal(
				(
					await call("run_simulation", {
						project: "led-board",
						test: "led current",
					})
				).data.passed,
				true,
			);
			assert.equal(
				(
					await call("run_simulation", {
						project: "led-board",
						test: "missing",
					})
				).isError,
				true,
			);
		},
	);
	await t.test(
		"change a part, rebuild, and Banana's diff shows exactly that",
		async () => {
			await call("edit", {
				project: "led-board",
				build: "Move the LED",
				operations: [{ op: "place", ref: "D1", x: 60, y: 40, rot: 90 }],
			});
			const hist = (await call("history", { project: "led-board" })).data
				.commits;
			assert.ok(hist.length >= 3);
			assert.equal(hist[0].message, "Move the LED");
			const diff = await call("diff", { project: "led-board", file: "board" });
			assert.equal(diff.isError, false, JSON.stringify(diff.data));
			assert.ok(diff.data.changes > 0);
			assert.ok(
				diff.data.items.some(
					(i) => i.refDes === "D1" && /relocated|moved/i.test(i.detail ?? ""),
				),
				JSON.stringify(diff.data.items.slice(0, 5)),
			);
		},
	);
	await t.test("render lists every layer and can return one", async () => {
		const r = await call("render", { project: "led-board", layer: "F_Cu" });
		assert.ok(r.data.layers.length >= 7);
		assert.match(r.data.svg, /^<\?xml|^<svg/);
		assert.ok(r.data.inBanana.repoPath.endsWith("led-board"));
		assert.equal(
			(await call("render", { project: "led-board", layer: "No.Such" }))
				.isError,
			true,
		);
	});
});

test("SDK client: hostile project names and parallel edits", {
	skip: skipFlow,
	timeout: 120000,
}, async (t) => {
	for (const bad of [
		"../escape",
		"a/b",
		"A",
		"",
		"x".repeat(60),
		"..",
		".hidden",
		"a b",
		"a\u0000b",
		"con;rm",
	]) {
		await t.test(`create_project ${JSON.stringify(bad)}`, async () => {
			const r = await client.callTool({
				name: "create_project",
				arguments: { project: bad },
			});
			assert.equal(r.isError, true);
		});
	}
	assert.ok(!fs.existsSync(path.join(projects, "..", "escape")));
	await call("create_project", { project: "parallel" });
	const results = await Promise.all(
		Array.from({ length: 12 }, () =>
			call("edit", {
				project: "parallel",
				operations: [
					{
						op: "add_part",
						symbol: "Device:R",
						value: "1k",
						footprint: "Resistor_SMD:R_0805_2012Metric",
					},
				],
			}),
		),
	);
	assert.ok(results.every((r) => !r.isError));
	const d = (await call("get_design", { project: "parallel" })).data;
	assert.equal(d.parts.length, 12, "no lost updates under concurrency");
	assert.equal(new Set(d.parts.map((p) => p.ref)).size, 12);
});

test("project listing", { skip: skipFlow }, async () => {
	const names = (await call("list_projects", {})).data.projects.map(
		(p) => p.name,
	);
	assert.ok(names.includes("led-board") && names.includes("parallel"));
});

test("projects built by the MCP tools open in Banana's existing diff routes (the UI path)", {
	skip: skipFlow,
	timeout: 240000,
}, async () => {
	const { createApp } = await import("../backend/src/server.js");
	const server = await new Promise((resolve) => {
		const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
	});
	try {
		const base = `http://127.0.0.1:${server.address().port}`;
		const repoPath = path.join(projects, "led-board");
		const post = async (route, body) => {
			const r = await fetch(base + route, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			return { status: r.status, body: await r.json() };
		};
		const init = await post("/api/git/init", { repoPath });
		assert.equal(init.status, 200);
		assert.ok(
			init.body.kicadFiles.includes("led-board.kicad_pcb") &&
				init.body.kicadFiles.includes("led-board.kicad_sch"),
		);
		assert.ok(init.body.commits.length >= 3);
		const [newest, previous] = init.body.commits;
		const diff = await post("/api/diff/process", {
			repoPath,
			baseCommit: previous.hash,
			targetCommit: newest.hash,
			relativeFilePath: "led-board.kicad_pcb",
		});
		assert.equal(diff.status, 200, JSON.stringify(diff.body).slice(0, 300));
		assert.ok(
			diff.body.modifications.some((m) => m.refDes === "D1"),
			"the UI sees the LED move",
		);
		assert.equal(diff.body.telemetry.layersProcessed, 7);
	} finally {
		server.close();
	}
});
