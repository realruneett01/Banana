import express from "express";
import { validateCircuitIR } from "../engine/circuit-ir.js";
import {
	FAULT_INFO,
	FAULT_KINDS,
	injectFault,
	suggestFaults,
} from "../engine/sim/fault-inject.js";
import { irToSpice } from "../engine/spice/ir-to-spice.js";
import { createNgspice } from "../engine/spice/ngspice-runner.js";

let lazyNgspice = null;
let explainFn = null;
let explainLoaded = false;

async function getExplainFn() {
	if (explainLoaded) {
		return explainFn;
	}
	explainLoaded = true;
	try {
		const mod = await import("../engine/sim/explain.js");
		explainFn =
			typeof mod?.explainCircuitResult === "function"
				? mod.explainCircuitResult
				: null;
	} catch {
		// Optional explanation module not present
		explainFn = null;
	}
	return explainFn;
}

function resolveNgspice(req) {
	if (req.app?.locals?.ngspice) {
		return req.app.locals.ngspice;
	}
	lazyNgspice ??= createNgspice();
	return lazyNgspice;
}

function isInvalidTranBounds(stopS, stepS) {
	if (typeof stopS !== "number" || typeof stepS !== "number") {
		return true;
	}
	if (Number.isNaN(stopS) || Number.isNaN(stepS)) {
		return true;
	}
	if (stopS <= 0 || stopS > 1) {
		return true;
	}
	return stepS <= 0 || stepS < stopS / 10000;
}

function validateAnalysis(analysis) {
	if (analysis === undefined || analysis === null) {
		return null;
	}
	if (typeof analysis !== "object" || Array.isArray(analysis)) {
		return "analysis must be an object";
	}
	if (analysis.type === "op") {
		return null;
	}
	if (analysis.type === "tran") {
		if (isInvalidTranBounds(analysis.stopS, analysis.stepS)) {
			return "Invalid tran bounds: stopS <= 1, stepS >= stopS/10000";
		}
		return null;
	}
	return "analysis type must be 'op' or 'tran'";
}

function validateFault(fault) {
	if (fault === undefined || fault === null) {
		return null;
	}
	if (typeof fault !== "object" || Array.isArray(fault)) {
		return "fault must be an object";
	}
	if (!fault.kind || typeof fault.kind !== "string") {
		return "fault kind must be a string";
	}
	if (!FAULT_KINDS.includes(fault.kind)) {
		return `Unknown fault kind '${fault.kind}'`;
	}
	return null;
}

function validateSimulateRequest(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { error: "Request body must be an object" };
	}
	const irValidation = validateCircuitIR(body.ir);
	if (!irValidation.ok) {
		return {
			error: "Invalid circuit IR",
			errors: irValidation.errors,
		};
	}
	const faultErr = validateFault(body.fault);
	if (faultErr) {
		return { error: faultErr };
	}
	const analysisErr = validateAnalysis(body.analysis);
	if (analysisErr) {
		return { error: analysisErr };
	}
	return null;
}

function buildVarIndexMap(variables) {
	const map = new Map();
	if (!Array.isArray(variables)) {
		return map;
	}
	for (const v of variables) {
		if (v?.name && typeof v.index === "number") {
			map.set(v.name.toLowerCase(), v.index);
		}
	}
	return map;
}

function extractNetVoltage(net, nodeMap, varMap, pt) {
	const node = nodeMap[net.id];
	if (!node || node === "0") {
		return 0;
	}
	const idx = varMap.get(`v(${node.toLowerCase()})`);
	if (idx === undefined) {
		return 0;
	}
	return pt[idx] ?? 0;
}

function extractPartCurrent(part, elementMap, varMap, pt) {
	const elem = elementMap[part.id];
	if (!elem) {
		return 0;
	}
	const lower = elem.toLowerCase();
	const candidates = [
		`@${lower}[i]`,
		`@${lower}[id]`,
		`i(${lower})`,
		`${lower}#branch`,
	];
	for (const name of candidates) {
		const idx = varMap.get(name);
		if (idx !== undefined) {
			return pt[idx] ?? 0;
		}
	}
	return 0;
}

function mapNodeVoltages(nets, nodeMap, varMap, pt) {
	const result = {};
	for (const net of nets) {
		result[net.id] = extractNetVoltage(net, nodeMap, varMap, pt);
	}
	return result;
}

function mapPartCurrents(parts, elementMap, varMap, pt) {
	const result = {};
	for (const part of parts) {
		result[part.id] = extractPartCurrent(part, elementMap, varMap, pt);
	}
	return result;
}

function findOpPlot(plots) {
	if (!Array.isArray(plots) || plots.length === 0) {
		return null;
	}
	const op = plots.find(
		(p) =>
			/operating point/i.test(p.plotname || "") ||
			/^op/i.test(p.plotname || ""),
	);
	return op || plots[0];
}

function getOpPoint(plot) {
	if (!plot?.points || plot.points.length === 0) {
		return [];
	}
	if (/tran/i.test(plot.plotname || "")) {
		return plot.points[plot.points.length - 1];
	}
	return plot.points[0];
}

function downsamplePoints(points, maxPoints = 2000) {
	if (!Array.isArray(points) || points.length <= maxPoints) {
		return points || [];
	}
	const step = (points.length - 1) / (maxPoints - 1);
	const sampled = [];
	for (let i = 0; i < maxPoints; i++) {
		const idx = Math.round(i * step);
		sampled.push(points[idx]);
	}
	return sampled;
}

function createSeriesContainers(nets, parts) {
	const nodeVoltages = {};
	for (const net of nets) {
		nodeVoltages[net.id] = [];
	}
	const partCurrents = {};
	for (const part of parts) {
		partCurrents[part.id] = [];
	}
	return { time: [], nodeVoltages, partCurrents };
}

function appendSeriesPoint(series, pt, ctx) {
	const timeVal = ctx.timeIdx >= 0 ? (pt[ctx.timeIdx] ?? 0) : 0;
	series.time.push(timeVal);
	for (const net of ctx.nets) {
		series.nodeVoltages[net.id].push(
			extractNetVoltage(net, ctx.nodeMap, ctx.varMap, pt),
		);
	}
	for (const part of ctx.parts) {
		series.partCurrents[part.id].push(
			extractPartCurrent(part, ctx.elementMap, ctx.varMap, pt),
		);
	}
}

function buildSeries(plot, simIr, nodeMap, elementMap) {
	const varMap = buildVarIndexMap(plot?.variables);
	const timeIdx = varMap.has("time") ? varMap.get("time") : 0;
	const series = createSeriesContainers(simIr.nets, simIr.parts);
	const sampled = downsamplePoints(plot?.points, 2000);
	const ctx = {
		nets: simIr.nets,
		parts: simIr.parts,
		nodeMap,
		elementMap,
		varMap,
		timeIdx,
	};
	for (const pt of sampled) {
		appendSeriesPoint(series, pt, ctx);
	}
	return series;
}

function buildBaseSimulationData(plots, simIr, spice, fault) {
	const opPlot = findOpPlot(plots);
	const opPoint = getOpPoint(opPlot);
	const varMap = buildVarIndexMap(opPlot?.variables);
	return {
		nodeVoltages: mapNodeVoltages(simIr.nets, spice.nodeMap, varMap, opPoint),
		partCurrents: mapPartCurrents(
			simIr.parts,
			spice.elementMap,
			varMap,
			opPoint,
		),
		warnings: spice.warnings ?? [],
		fault: fault ? { ...fault, info: FAULT_INFO[fault.kind] ?? null } : null,
	};
}

async function attachExplanation(out, fault) {
	const explain = await getExplainFn();
	if (explain) {
		out.explanation = explain({
			nodeVoltages: out.nodeVoltages,
			partCurrents: out.partCurrents,
			fault,
			warnings: out.warnings,
		});
	}
}

async function formatSimulationResponse({
	plots,
	simIr,
	spice,
	fault,
	analysis,
}) {
	const out = buildBaseSimulationData(plots, simIr, spice, fault);
	if (analysis?.type === "tran") {
		const tranPlot =
			plots.find((p) => /tran/i.test(p.plotname || "")) || plots[0];
		out.series = buildSeries(tranPlot, simIr, spice.nodeMap, spice.elementMap);
	}
	await attachExplanation(out, fault);
	return out;
}

function applyFaultIfPresent(ir, fault) {
	if (!fault) {
		return { ok: true, ir };
	}
	return injectFault(ir, fault);
}

function prepareSpiceNetlist(ir, fault, analysis) {
	const simIr = applyFaultIfPresent(ir, fault);
	if (!simIr.ok) {
		return { status: 400, body: { error: simIr.error } };
	}
	const spice = irToSpice(simIr.ir, { analysis: analysis ?? { type: "op" } });
	if (!spice.ok) {
		return {
			status: 400,
			body: { error: "Failed to generate SPICE netlist", errors: spice.errors },
		};
	}
	return { ok: true, simIr: simIr.ir, spice };
}

async function runSpiceSimulation(req, netlist) {
	const ngspice = resolveNgspice(req);
	if (!(await ngspice.available())) {
		return {
			status: 503,
			body: {
				error: "Circuit simulator (ngspice) is not installed on this server",
			},
		};
	}
	const runRes = await ngspice.run(netlist);
	if (!runRes.ok) {
		return {
			status: 422,
			body: {
				error: runRes.error || "Simulation failed",
				log: runRes.log ?? "",
			},
		};
	}
	return { ok: true, plots: runRes.plots };
}

async function executeSimulation(req, res) {
	const { ir, fault, analysis } = req.body;
	const prep = prepareSpiceNetlist(ir, fault, analysis);
	if (!prep.ok) {
		return res.status(prep.status).json(prep.body);
	}
	const sim = await runSpiceSimulation(req, prep.spice.netlist);
	if (!sim.ok) {
		return res.status(sim.status).json(sim.body);
	}
	const data = await formatSimulationResponse({
		plots: sim.plots,
		simIr: prep.simIr,
		spice: prep.spice,
		fault,
		analysis,
	});
	return res.status(200).json(data);
}

async function handleSimulate(req, res) {
	const valErr = validateSimulateRequest(req.body);
	if (valErr) {
		return res.status(400).json(valErr);
	}
	try {
		return await executeSimulation(req, res);
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Circuit simulation failed" });
	}
}

function handleSuggestFaults(req, res) {
	const ir = req.body?.ir;
	const validation = validateCircuitIR(ir);
	if (!validation.ok) {
		return res.status(400).json({
			error: "Invalid circuit IR",
			errors: validation.errors,
		});
	}
	try {
		const rawFaults = suggestFaults(ir);
		const faults = rawFaults.map((f) => ({
			...f,
			info: FAULT_INFO[f.kind] ?? null,
		}));
		return res.status(200).json({ faults });
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Failed to suggest faults" });
	}
}

export function createCircuitRouter() {
	const router = express.Router();
	router.post(["/circuit/simulate", "/api/circuit/simulate"], handleSimulate);
	router.post(
		["/circuit/suggest-faults", "/api/circuit/suggest-faults"],
		handleSuggestFaults,
	);
	return router;
}

const defaultRouter = createCircuitRouter();
export default defaultRouter;
