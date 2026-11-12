import fs from "node:fs";
import { performance } from "node:perf_hooks";
import process from "node:process";

const DEFAULT_BUDGETS = {
	health: 50,
	search: 300,
	libtree: 500,
	"import-sch": 3000,
	"import-pcb": 3000,
	import: 3000,
	check: 1000,
	sim: 5000,
	mcp: 500,
};

const SEARCH_TERMS = ["res", "cap", "led", "op", "usb", "mcu", "555", "lm"];

const FALLBACK_SCH = "(kicad_sch (version 20231120) (generator eeschema))";
const FALLBACK_PCB = "(kicad_pcb (version 20240108) (generator pcbnew))";

const RC_CIRCUIT_IR = {
	schemaVersion: 1,
	name: "rc_filter",
	parts: [
		{
			id: "part_00000001-0000-4000-8000-000000000001",
			ref: "V1",
			value: "5V",
			symbol: "Source:V",
			footprint: "Pkg:V",
			props: { voltage: "5V" },
		},
		{
			id: "part_00000002-0000-4000-8000-000000000002",
			ref: "R1",
			value: "1k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0603",
			props: {},
		},
		{
			id: "part_00000003-0000-4000-8000-000000000003",
			ref: "C1",
			value: "1uF",
			symbol: "Device:C",
			footprint: "Capacitor_SMD:C_0603",
			props: {},
		},
	],
	nets: [
		{
			id: "net_00000001-0000-4000-8000-000000000001",
			name: "VCC",
			pins: [
				{ partId: "part_00000001-0000-4000-8000-000000000001", pin: "1" },
				{ partId: "part_00000002-0000-4000-8000-000000000002", pin: "1" },
			],
		},
		{
			id: "net_00000002-0000-4000-8000-000000000002",
			name: "MID",
			pins: [
				{ partId: "part_00000002-0000-4000-8000-000000000002", pin: "2" },
				{ partId: "part_00000003-0000-4000-8000-000000000003", pin: "1" },
			],
		},
		{
			id: "net_00000003-0000-4000-8000-000000000003",
			name: "GND",
			pins: [
				{ partId: "part_00000003-0000-4000-8000-000000000003", pin: "2" },
				{ partId: "part_00000001-0000-4000-8000-000000000001", pin: "2" },
			],
		},
	],
	constraints: [],
};

const MCP_INIT_PAYLOAD = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "banana-load-test", version: "1.0.0" },
	},
});

const MCP_LIST_PAYLOAD = JSON.stringify({
	jsonrpc: "2.0",
	id: 2,
	method: "tools/list",
	params: {},
});

const ARG_HANDLERS = {
	"--base": (args, val) => {
		args.base = val.replace(/\/+$/, "");
	},
	"--duration": (args, val) => {
		args.duration = Number(val) || 60;
	},
	"--concurrency": (args, val) => {
		args.concurrency = Number(val) || 50;
	},
	"--scenario": (args, val) => {
		args.scenario = val;
	},
	"--sch": (args, val) => {
		args.sch = val;
	},
	"--pcb": (args, val) => {
		args.pcb = val;
	},
	"--mcp-token": (args, val) => {
		args.mcpToken = val;
	},
	"--pid": (args, val) => {
		args.pid = Number(val) || null;
	},
};

function applyArg(args, key, val) {
	if (!val) return;
	const handler = ARG_HANDLERS[key];
	if (handler) {
		handler(args, val);
	}
}

function parseCliArgs(argv) {
	const args = {
		base: "http://127.0.0.1:5000",
		duration: 60,
		concurrency: 50,
		scenario: "all",
		sch: "C:/Program Files/KiCad/10.0/share/kicad/demos/pic_programmer/pic_programmer.kicad_sch",
		pcb: "C:/Program Files/KiCad/10.0/share/kicad/demos/pic_programmer/pic_programmer.kicad_pcb",
		mcpToken: "",
		pid: null,
	};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith("--")) {
			applyArg(args, argv[i], argv[i + 1]);
		}
	}
	return args;
}

function readTextFile(filePath, fallback) {
	try {
		if (filePath && fs.existsSync(filePath)) {
			return fs.readFileSync(filePath, "utf-8");
		}
	} catch {}
	return fallback;
}

function buildMcpHeaders(token) {
	const headers = { "Content-Type": "application/json" };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
		headers["x-banana-auth"] = token;
	}
	return headers;
}

async function fetchImportedIr(base, schText) {
	try {
		const res = await fetch(`${base}/api/editor/import?kind=sch`, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: schText,
		});
		if (res.ok) {
			const data = await res.json();
			return data?.ir ?? RC_CIRCUIT_IR;
		}
	} catch {}
	return RC_CIRCUIT_IR;
}

async function requestHealth(base) {
	const res = await fetch(`${base}/api/library/status`);
	await res.text();
	return res.status;
}

function getRandomSearchTerm() {
	const idx = Math.floor(Math.random() * SEARCH_TERMS.length);
	return SEARCH_TERMS[idx];
}

async function requestSearch(base) {
	const q = getRandomSearchTerm();
	const res = await fetch(`${base}/api/library/symbols?q=${q}&limit=50`);
	await res.text();
	return res.status;
}

function pickRandomLibrary(libraries) {
	if (Array.isArray(libraries) && libraries.length > 0) {
		const idx = Math.floor(Math.random() * libraries.length);
		return libraries[idx].name;
	}
	return "Device";
}

async function requestLibtree(base) {
	const res = await fetch(`${base}/api/library/symbols/libraries`);
	if (!res.ok) {
		await res.text();
		return res.status;
	}
	const data = await res.json();
	const lib = pickRandomLibrary(data?.libraries);
	const itemRes = await fetch(
		`${base}/api/library/symbols/libraries/${encodeURIComponent(lib)}`,
	);
	await itemRes.text();
	return itemRes.status;
}

async function requestImportSch(base, schText) {
	const res = await fetch(`${base}/api/editor/import?kind=sch`, {
		method: "POST",
		headers: { "Content-Type": "text/plain" },
		body: schText,
	});
	await res.text();
	return res.status;
}

async function requestImportPcb(base, pcbText) {
	const res = await fetch(`${base}/api/editor/import?kind=pcb`, {
		method: "POST",
		headers: { "Content-Type": "text/plain" },
		body: pcbText,
	});
	await res.text();
	return res.status;
}

async function requestCheck(base, checkPayload) {
	const res = await fetch(`${base}/api/editor/check`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: checkPayload,
	});
	await res.text();
	return res.status;
}

async function requestSim(base, simPayload) {
	const res = await fetch(`${base}/api/circuit/simulate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: simPayload,
	});
	await res.text();
	return res.status;
}

async function requestMcp(base, mcpHeaders) {
	const initRes = await fetch(`${base}/mcp`, {
		method: "POST",
		headers: mcpHeaders,
		body: MCP_INIT_PAYLOAD,
	});
	if (!initRes.ok) {
		await initRes.text();
		return initRes.status;
	}
	await initRes.text();
	const listRes = await fetch(`${base}/mcp`, {
		method: "POST",
		headers: mcpHeaders,
		body: MCP_LIST_PAYLOAD,
	});
	await listRes.text();
	return listRes.status;
}

function createScenarios(cfg, data) {
	return [
		{ name: "health", request: () => requestHealth(cfg.base) },
		{ name: "search", request: () => requestSearch(cfg.base) },
		{ name: "libtree", request: () => requestLibtree(cfg.base) },
		{
			name: "import-sch",
			request: () => requestImportSch(cfg.base, data.schText),
		},
		{
			name: "import-pcb",
			request: () => requestImportPcb(cfg.base, data.pcbText),
		},
		{
			name: "check",
			request: () => requestCheck(cfg.base, data.checkPayload),
		},
		{ name: "sim", request: () => requestSim(cfg.base, data.simPayload) },
		{ name: "mcp", request: () => requestMcp(cfg.base, data.mcpHeaders) },
	];
}

function isMatchingScenario(scenarioName, target) {
	if (target === "all" || !target) {
		return true;
	}
	if (target === "import") {
		return scenarioName.startsWith("import-");
	}
	return scenarioName === target;
}

function shouldSkipMcp(name, mcpToken, requested) {
	if (name !== "mcp") return false;
	if (requested === "mcp") return false;
	return !mcpToken;
}

function selectScenarios(allScenarios, requestedName, mcpToken) {
	return allScenarios.filter((s) => {
		if (shouldSkipMcp(s.name, mcpToken, requestedName)) {
			return false;
		}
		return isMatchingScenario(s.name, requestedName);
	});
}

function recordStatus(statuses, status) {
	const key = String(status);
	statuses[key] = (statuses[key] || 0) + 1;
}

async function executeSingleRequest(scenario) {
	try {
		return await scenario.request();
	} catch (err) {
		return err?.code || "ERR";
	}
}

async function runWorker(ctx) {
	while (Date.now() < ctx.deadline) {
		const start = performance.now();
		const status = await executeSingleRequest(ctx.scenario);
		const duration = performance.now() - start;
		ctx.latencies.push(duration);
		recordStatus(ctx.statuses, status);
	}
}

async function runScenarioLoad(scenario, options) {
	const deadline = Date.now() + options.duration * 1000;
	const ctx = {
		scenario,
		deadline,
		latencies: [],
		statuses: {},
	};
	const workers = [];
	const startWallTime = performance.now();
	for (let i = 0; i < options.concurrency; i++) {
		workers.push(runWorker(ctx));
	}
	await Promise.all(workers);
	const totalElapsed = (performance.now() - startWallTime) / 1000;
	return summarizeScenarioResults(
		scenario.name,
		ctx,
		totalElapsed,
		options.pid,
	);
}

function calculatePercentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	const index = Math.min(sorted.length - 1, Math.max(0, rank));
	return Number(sorted[index].toFixed(2));
}

function computeLatencies(rawLatencies) {
	if (rawLatencies.length === 0) {
		return { p50: 0, p95: 0, p99: 0, max: 0 };
	}
	const sorted = [...rawLatencies].sort((a, b) => a - b);
	return {
		p50: calculatePercentile(sorted, 50),
		p95: calculatePercentile(sorted, 95),
		p99: calculatePercentile(sorted, 99),
		max: Number(sorted[sorted.length - 1].toFixed(2)),
	};
}

function isErrorStatus(statusStr) {
	const code = Number(statusStr);
	if (Number.isNaN(code)) return true;
	return code < 200 || code >= 400;
}

function summarizeStatuses(statuses) {
	let total = 0;
	let errors = 0;
	const errorBreakdown = [];
	for (const [code, count] of Object.entries(statuses)) {
		total += count;
		if (isErrorStatus(code)) {
			errors += count;
			errorBreakdown.push(`${code}:${count}`);
		}
	}
	return { total, errors, errorBreakdown: errorBreakdown.join(",") };
}

function checkPidLiveness(pid) {
	if (!pid) return "N/A";
	try {
		process.kill(Number(pid), 0);
		return "alive";
	} catch {
		return "dead";
	}
}

function summarizeScenarioResults(name, ctx, totalElapsed, pid) {
	const { total, errors, errorBreakdown } = summarizeStatuses(ctx.statuses);
	const rps = totalElapsed > 0 ? Number((total / totalElapsed).toFixed(1)) : 0;
	const errorRate = total > 0 ? (errors / total) * 100 : 0;
	const latencies = computeLatencies(ctx.latencies);
	const backend = checkPidLiveness(pid);
	return {
		name,
		requests: total,
		rps,
		errors,
		errorRate: Number(errorRate.toFixed(2)),
		errorBreakdown: errorBreakdown || "-",
		...latencies,
		backend,
	};
}

function evaluateBudget(result, budgets) {
	const budget = budgets[result.name] ?? budgets.import ?? 1000;
	const p95Pass = result.p95 <= budget;
	const errorPass = result.errorRate <= 1.0;
	return {
		budget,
		p95Pass,
		errorPass,
		passed: p95Pass && errorPass,
	};
}

function formatTableRow(result, budgetEval) {
	return {
		Scenario: result.name,
		Requests: result.requests,
		RPS: result.rps,
		Errors: `${result.errors} (${result.errorBreakdown})`,
		"Err%": `${result.errorRate}%`,
		"p50(ms)": result.p50,
		"p95(ms)": result.p95,
		"p99(ms)": result.p99,
		"max(ms)": result.max,
		"Budget(ms)": budgetEval.budget,
		"Backend(RSS)": result.backend,
		Status: budgetEval.passed ? "PASS" : "FAIL",
	};
}

function renderResultsTable(results, budgets) {
	const tableRows = [];
	let allPassed = true;
	for (const res of results) {
		const budgetEval = evaluateBudget(res, budgets);
		if (!budgetEval.passed) {
			allPassed = false;
		}
		tableRows.push(formatTableRow(res, budgetEval));
	}
	console.table(tableRows);
	return allPassed;
}

async function prepareContext(args) {
	const schText = readTextFile(args.sch, FALLBACK_SCH);
	const pcbText = readTextFile(args.pcb, FALLBACK_PCB);
	const importedIr = await fetchImportedIr(args.base, schText);
	return {
		schText,
		pcbText,
		checkPayload: JSON.stringify({ ir: importedIr }),
		simPayload: JSON.stringify({
			ir: RC_CIRCUIT_IR,
			analysis: { type: "op" },
		}),
		mcpHeaders: buildMcpHeaders(args.mcpToken),
	};
}

async function executeScenarios(selected, args) {
	const results = [];
	for (const scenario of selected) {
		console.log(
			`Running scenario: ${scenario.name} (${args.duration}s, concurrency ${args.concurrency})...`,
		);
		const res = await runScenarioLoad(scenario, args);
		results.push(res);
	}
	return results;
}

async function main() {
	const args = parseCliArgs(process.argv.slice(2));
	const ctx = await prepareContext(args);
	const allScenarios = createScenarios(args, ctx);
	const selected = selectScenarios(allScenarios, args.scenario, args.mcpToken);
	if (selected.length === 0) {
		console.error(`Unknown scenario: ${args.scenario}`);
		process.exitCode = 1;
		return;
	}
	const results = await executeScenarios(selected, args);
	const allPassed = renderResultsTable(results, DEFAULT_BUDGETS);
	if (!allPassed) {
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error("Fatal load test error:", err);
	process.exit(1);
});
