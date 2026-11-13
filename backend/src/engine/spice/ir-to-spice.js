import { validateCircuitIR } from "../circuit-ir.js";
import { NETLIST_LIMITS, validateNetlist } from "./ngspice-runner.js";
import { modelForPart } from "./part-models.js";

const MULTIPLIERS = {
	meg: 1e6,
	MEG: 1e6,
	M: 1e6,
	m: 1e-3,
	k: 1e3,
	K: 1e3,
	u: 1e-6,
	U: 1e-6,
	μ: 1e-6,
	n: 1e-9,
	N: 1e-9,
	p: 1e-12,
	P: 1e-12,
	f: 1e-15,
	g: 1e9,
	G: 1e9,
	t: 1e12,
	T: 1e12,
};

function isBaseUnit(char) {
	return ["R", "r", "V", "v", "A", "a", "Ω", "F"].includes(char);
}

function parseInlineSi(str) {
	const match = str.match(/^([+-]?\d+)([a-zA-ZΩμ])(\d+)$/);
	if (!match) {
		return Number.NaN;
	}
	const [, intPart, unitChar, fracPart] = match;
	const mult = MULTIPLIERS[unitChar] ?? (isBaseUnit(unitChar) ? 1 : Number.NaN);
	if (Number.isNaN(mult)) {
		return Number.NaN;
	}
	return Number.parseFloat(`${intPart}.${fracPart}`) * mult;
}

function getMultiplierAndUnit(suffix) {
	if (!suffix) {
		return { mult: 1, unit: "" };
	}
	if (suffix.toLowerCase().startsWith("meg")) {
		return { mult: 1e6, unit: suffix.slice(3) };
	}
	const first = suffix[0];
	if (MULTIPLIERS[first] !== undefined) {
		return { mult: MULTIPLIERS[first], unit: suffix.slice(1) };
	}
	if (isBaseUnit(first) || /^(ohm|hz)/i.test(suffix)) {
		return { mult: 1, unit: suffix };
	}
	return { mult: Number.NaN, unit: suffix };
}

function isValidUnit(unit) {
	if (!unit) {
		return true;
	}
	return /^(v|a|f|h|w|hz|ohm|ω|s|deg)$/i.test(unit.trim());
}

function parsePrefixedSi(str) {
	const regex =
		/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-ZΩμ].*)?$/;
	const match = str.match(regex);
	if (!match) {
		return Number.NaN;
	}
	const [, numStr, rawSuffix] = match;
	const num = Number.parseFloat(numStr);
	const { mult, unit } = getMultiplierAndUnit(rawSuffix?.trim() ?? "");
	if (Number.isNaN(mult) || !isValidUnit(unit)) {
		return Number.NaN;
	}
	return num * mult;
}

export function parseSiValue(val) {
	if (typeof val === "number") {
		return Number.isNaN(val) ? Number.NaN : val;
	}
	if (typeof val !== "string") {
		return Number.NaN;
	}
	const trimmed = val.trim();
	if (!trimmed) {
		return Number.NaN;
	}
	const inline = parseInlineSi(trimmed);
	if (!Number.isNaN(inline)) {
		return inline;
	}
	return parsePrefixedSi(trimmed);
}

function sanitizeNodeName(name, fallbackId) {
	const raw = String(name || fallbackId || "").trim();
	const source = raw.startsWith("n_") ? raw.slice(2) : raw;
	const alnum = source.replace(/[^a-zA-Z0-9]/g, "");
	return `n_${alnum || "net"}`;
}

function createNodeResolver(groundNames) {
	const groundSet = new Set(groundNames.map((g) => String(g).toUpperCase()));
	const used = new Set(["0"]);
	return (net, index) => {
		if (groundSet.has(String(net.name || "").toUpperCase())) {
			return "0";
		}
		const base = sanitizeNodeName(net.name, net.id || `net${index}`);
		let candidate = base;
		for (let i = 2; used.has(candidate); i++) {
			candidate = `${base}_${i}`;
		}
		used.add(candidate);
		return candidate;
	};
}

function buildPinToNetMap(nets) {
	const pinToNet = new Map();
	for (const net of nets) {
		for (const pin of net.pins) {
			pinToNet.set(`${pin.partId}:${pin.pin}`, net.id);
		}
	}
	return pinToNet;
}

function isDiodeOrLed(part) {
	const ref = String(part.ref || "").toUpperCase();
	const symbol = String(part.symbol || "").toLowerCase();
	return [
		ref.startsWith("D"),
		ref.startsWith("LED"),
		symbol.includes("led"),
		symbol.includes(":d"),
	].some(Boolean);
}

function warnUnconnectedPin(ref, pin, warnings) {
	warnings.push(`Part '${ref}' pin '${pin}' is unconnected`);
}

function getPartPins(part, pinToNet, nodeMap, warnings) {
	const isDiode = isDiodeOrLed(part);
	let net1 = pinToNet.get(`${part.id}:1`);
	let net2 = pinToNet.get(`${part.id}:2`);
	if (isDiode) {
		net1 = net1 ?? pinToNet.get(`${part.id}:A`) ?? pinToNet.get(`${part.id}:a`);
		net2 = net2 ?? pinToNet.get(`${part.id}:K`) ?? pinToNet.get(`${part.id}:k`);
	}
	if (!net1) {
		warnUnconnectedPin(part.ref, isDiode ? "A" : "1", warnings);
	}
	if (!net2) {
		warnUnconnectedPin(part.ref, isDiode ? "K" : "2", warnings);
	}
	if (!net1 || !net2) {
		return null;
	}
	return { node1: nodeMap[net1], node2: nodeMap[net2] };
}

function sanitizeElementName(rawRef, prefix, usedNames) {
	const cleaned = String(rawRef || "").replace(/[^a-zA-Z0-9_]/g, "");
	const req = prefix.toUpperCase();
	let base = cleaned.toUpperCase().startsWith(req)
		? `${req}${cleaned.slice(1)}`
		: `${req}${cleaned}`;
	base = base.slice(0, 32);
	let candidate = base;
	let counter = 2;
	while (usedNames.has(candidate.toUpperCase())) {
		const suffix = `_${counter++}`;
		candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`;
	}
	usedNames.add(candidate.toUpperCase());
	return candidate;
}

function bindElementName(part, prefix, ctx) {
	const name = sanitizeElementName(part.ref, prefix, ctx.usedElementNames);
	ctx.elementMap[part.id] = name;
	return name;
}

function formatElement(name, pins, spec) {
	return `${name} ${pins.node1} ${pins.node2} ${spec}`;
}

function parsePartValue(part, raw, kind, warnings) {
	const val = parseSiValue(raw);
	if (Number.isNaN(val)) {
		warnings.push(`Part '${part.ref}' has unparsable ${kind} '${raw}'`);
		return null;
	}
	return val;
}

function getPassivePrefix(ref) {
	const first = String(ref || "")
		.trim()[0]
		?.toUpperCase();
	return ["C", "L"].includes(first) ? first : "R";
}

function buildPassive(part, pins, ctx) {
	const val = parsePartValue(part, part.value, "value", ctx.warnings);
	if (val === null) {
		return null;
	}
	const prefix = getPassivePrefix(part.ref);
	const name = bindElementName(part, prefix, ctx);
	return formatElement(name, pins, val);
}

function buildSwitch(part, pins, ctx) {
	const name = bindElementName(part, "R", ctx);
	const resistance = part.props?.closed === true ? 0.001 : 1e9;
	return formatElement(name, pins, resistance);
}

function buildFuse(part, pins, ctx) {
	const name = bindElementName(part, "R", ctx);
	return formatElement(name, pins, 0.01);
}

function buildDiode(part, pins, ctx) {
	const symbol = String(part.symbol || "").toLowerCase();
	const isLed =
		part.ref.toUpperCase().startsWith("LED") || symbol.includes("led");
	const name = bindElementName(part, "D", ctx);
	if (isLed) {
		ctx.hasLed = true;
		return formatElement(name, pins, "LED");
	}
	ctx.hasDiode = true;
	return formatElement(name, pins, "D");
}

function buildSource(part, pins, ctx) {
	const isVoltage = part.ref.toUpperCase().startsWith("V");
	const kind = isVoltage ? "voltage" : "current";
	const raw = part.props?.[kind] ?? part.value;
	const val = parsePartValue(part, raw, kind, ctx.warnings);
	if (val === null) {
		return null;
	}
	const prefix = isVoltage ? "V" : "I";
	const name = bindElementName(part, prefix, ctx);
	return formatElement(name, pins, `DC ${val}`);
}

const ELEMENT_HANDLERS = [
	{ pattern: /^(LED|D)/, handler: buildDiode },
	{ pattern: /^(SW|S)/, handler: buildSwitch },
	{ pattern: /^[RCL]/, handler: buildPassive },
	{ pattern: /^[VI]/, handler: buildSource },
	{ pattern: /^F/, handler: buildFuse },
];

function getElementHandler(upperRef) {
	const entry = ELEMENT_HANDLERS.find((e) => e.pattern.test(upperRef));
	return entry ? entry.handler : null;
}

function getModelPins(part, pinRoles, ctx) {
	const nodes = {};
	for (const [role, pinNumber] of Object.entries(pinRoles)) {
		const netId = ctx.pinToNet.get(`${part.id}:${pinNumber}`);
		if (!netId) {
			warnUnconnectedPin(part.ref, pinNumber, ctx.warnings);
			return null;
		}
		nodes[role] = ctx.nodeMap[netId];
	}
	return nodes;
}

function runHandler(part, handler, ctx) {
	const pins = getPartPins(part, ctx.pinToNet, ctx.nodeMap, ctx.warnings);
	const line = pins ? handler(part, pins, ctx) : null;
	if (line) {
		ctx.probeNames.push(ctx.elementMap[part.id]);
	}
	return line;
}

function processPart(part, ctx) {
	const upper = String(part.ref || "")
		.trim()
		.toUpperCase();
	const handler = getElementHandler(upper);
	if (handler) {
		return runHandler(part, handler, ctx);
	}
	const model = modelForPart(part);
	const nodes = model ? getModelPins(part, model.pinRoles, ctx) : null;
	if (!nodes) {
		ctx.warnings.push(`Part '${part.ref}' skipped as black box`);
		return null;
	}
	const rawFirst = String(part.ref || "").trim()[0];
	const prefix = /^[A-Za-z]$/.test(rawFirst) ? rawFirst : "U";
	const name = bindElementName(part, prefix, ctx);
	const lines = model.build(nodes, name, model.params);
	return lines.join("\n");
}

function sanitizeAnalysisParam(val, fallback) {
	if (typeof val === "string" && /^[\d.]+[a-zA-Z]*$/.test(val.trim())) {
		return val.trim();
	}
	if (typeof val === "number" && !Number.isNaN(val)) {
		return String(val);
	}
	return fallback;
}

function formatAnalysis(analysis) {
	if (analysis?.type === "tran") {
		const step = sanitizeAnalysisParam(analysis.stepS, "1u");
		const stop = sanitizeAnalysisParam(analysis.stopS, "10m");
		return `.tran ${step} ${stop}`;
	}
	return ".op";
}

function stripForbidden(text) {
	const chars = new RegExp(NETLIST_LIMITS.forbiddenChars.source, "g");
	let s = String(text ?? "")
		.replace(/[\r\n]/g, "")
		.replace(chars, "");
	for (const bad of NETLIST_LIMITS.forbiddenSubstrings) {
		while (s.includes(bad)) s = s.replaceAll(bad, "");
	}
	return s.trim();
}

// The comment must pass the same gate the netlist will (e.g. a title of "ng_script" would not).
function sanitizeComment(text, fallback) {
	const stripped = stripForbidden(text);
	return stripped && validateNetlist(`* ${stripped}`).ok ? stripped : fallback;
}

// ngspice ignores wildcard device names in .save (and then writes no vectors), so list each one.
const PROBE_PARAM = { R: "i", D: "id" };

function saveLine(names) {
	const probes = names
		.filter((n) => PROBE_PARAM[n?.[0]])
		.map((n) => `@${n.toLowerCase()}[${PROBE_PARAM[n[0]]}]`);
	return [".save all", ...probes].join(" ");
}

function assembleNetlist(name, lines, ctx, analysis) {
	const title = sanitizeComment(name, "Circuit");
	const out = [`* ${title}`];
	out.push(".options filetype=ascii");
	if (ctx.hasDiode) {
		out.push(".model D D");
	}
	if (ctx.hasLed) {
		out.push(".model LED D (IS=1e-22 N=2)");
	}
	for (const line of lines) {
		if (line) {
			out.push(line);
		}
	}
	out.push(formatAnalysis(analysis));
	out.push(saveLine(ctx.probeNames));
	out.push(".end");
	return out.join("\n");
}

function buildNodeMap(nets, groundNames) {
	const resolveNode = createNodeResolver(groundNames);
	const nodeMap = {};
	nets.forEach((net, i) => {
		nodeMap[net.id] = resolveNode(net, i);
	});
	return nodeMap;
}

function initContext(ir, options) {
	const nodeMap = buildNodeMap(
		ir.nets,
		options.groundNames ?? ["GND", "0", "VSS"],
	);
	return {
		nodeMap,
		pinToNet: buildPinToNetMap(ir.nets),
		elementMap: {},
		usedElementNames: new Set(),
		probeNames: [],
		warnings: [],
		hasDiode: false,
		hasLed: false,
	};
}

export function irToSpice(ir, options = {}) {
	try {
		const valid = validateCircuitIR(ir);
		if (!valid.ok) {
			return { ok: false, errors: valid.errors };
		}
		const ctx = initContext(ir, options);
		const lines = ir.parts.map((p) => processPart(p, ctx)).filter(Boolean);
		return {
			ok: true,
			netlist: assembleNetlist(ir.name, lines, ctx, options.analysis),
			nodeMap: ctx.nodeMap,
			elementMap: ctx.elementMap,
			warnings: ctx.warnings,
		};
	} catch (err) {
		// Broad catch to guarantee irToSpice never throws on malformed input
		return { ok: false, errors: [err?.message || String(err)] };
	}
}
