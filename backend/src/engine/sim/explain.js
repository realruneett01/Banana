import { parseSiValue } from "../spice/ir-to-spice.js";
import { FAULT_INFO } from "./fault-inject.js";

const DEFAULT_RESISTOR_W = 0.25;
const DEFAULT_LED_MAX_A = 0.03;
const DEFAULT_BATTERY_MAH = 2000;
const LED_COLORS = /^(red|green|blue|yellow|white)/;

const EMPTY_RESULT = {
	summary: "No simulation data available to explain.",
	cards: [],
};

export function formatSigFigs(val, n = 2) {
	if (!Number.isFinite(val) || val === 0) {
		return "0";
	}
	const abs = Math.abs(val);
	const formatted = Number(abs.toPrecision(n));
	return `${val < 0 ? "-" : ""}${formatted}`;
}

function formatMetric(val, zeroStr, milliUnit, baseUnit) {
	if (!Number.isFinite(val) || val === 0) {
		return zeroStr;
	}
	if (Math.abs(val) < 1) {
		return `${formatSigFigs(val * 1000)} ${milliUnit}`;
	}
	return `${formatSigFigs(val)} ${baseUnit}`;
}

export function formatCurrent(amps) {
	return formatMetric(amps, "0 mA", "mA", "A");
}

export function formatVoltage(volts) {
	return formatMetric(volts, "0 V", "mV", "V");
}

export function formatPower(watts) {
	return formatMetric(watts, "0 W", "mW", "W");
}

function getPartMeta(part) {
	if (!part) return null;
	return {
		ref: String(part.ref ?? "").toUpperCase(),
		sym: String(part.symbol ?? "").toLowerCase(),
	};
}

function isDiodeLed(val) {
	return val.includes("led") || LED_COLORS.test(val);
}

export function isLedPart(part) {
	const meta = getPartMeta(part);
	if (!meta) return false;
	if (meta.sym.includes("led") || meta.ref.startsWith("LED")) {
		return true;
	}
	const val = String(part.value ?? "").toLowerCase();
	return meta.ref.startsWith("D") && isDiodeLed(val);
}

export function isResistorPart(part) {
	const meta = getPartMeta(part);
	if (!meta) return false;
	return (
		meta.ref.startsWith("R") ||
		meta.sym.includes("resistor") ||
		meta.sym.includes(":r")
	);
}

export function isBatteryPart(part) {
	const meta = getPartMeta(part);
	if (!meta) return false;
	return (
		meta.ref.startsWith("BT") ||
		meta.ref.startsWith("BAT") ||
		meta.sym.includes("battery")
	);
}

export function isSourcePart(part) {
	if (isBatteryPart(part)) return true;
	const meta = getPartMeta(part);
	if (!meta) return false;
	return meta.ref.startsWith("V") || meta.sym.includes("source");
}

export function isGroundNet(net) {
	if (!net) return false;
	const name = String(net.name ?? "").toUpperCase();
	if (name.startsWith("GND") || name === "GROUND") {
		return true;
	}
	const id = String(net.id ?? "").toUpperCase();
	return id === "0" || name === "0";
}

function getResistance(part) {
	const raw = part?.props?.resistance ?? part?.value;
	const parsed = parseSiValue(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function computeResistorPower(part, current, partPowers) {
	if (partPowers && Number.isFinite(partPowers[part.id])) {
		return Math.max(0, partPowers[part.id]);
	}
	const r = getResistance(part);
	return current * current * r;
}

function formatLedBody(ref, current, maxCurrent) {
	if (current > maxCurrent) {
		return {
			level: "danger",
			title: `${ref} will burn out!`,
			text: `${ref} receives ${formatCurrent(current)}, which exceeds its safe limit of ${formatCurrent(maxCurrent)}. It will burn out!`,
		};
	}
	if (current >= 0.001) {
		return {
			level: "info",
			title: `${ref} is lit`,
			text: `${ref} is shining nicely with ${formatCurrent(current)} of current (how much electricity flows). Normal safe range is 1 mA to ${formatCurrent(maxCurrent)}.`,
		};
	}
	return {
		level: "warning",
		title: `${ref} is ${current === 0 ? "off" : "too dim"}`,
		text: `${ref} gets only ${formatCurrent(current)}. It is too dim to light up (needs between 1 mA and ${formatCurrent(maxCurrent)}).`,
	};
}

function createPartCard(partId, body) {
	return {
		id: `card-${partId}`,
		...body,
		partIds: [partId],
		netIds: [],
	};
}

function buildLedCard(part, current, rating) {
	const maxCurrent = rating?.maxCurrentA ?? DEFAULT_LED_MAX_A;
	const ref = part.ref || part.id;
	const body = formatLedBody(ref, current, maxCurrent);
	return createPartCard(part.id, body);
}

function formatResistorBody(ref, data) {
	const { curFmt, powFmt, maxFmt, ratio } = data;
	const pct = Math.round(ratio * 100);
	if (ratio > 1.0) {
		return {
			level: "danger",
			title: `${ref} is overheating!`,
			text: `${ref} conducts ${curFmt} and dissipates ${powFmt} of power (heat produced), which is ${pct}% of its ${maxFmt} limit. Danger: it will overheat and burn!`,
		};
	}
	if (ratio > 0.5) {
		return {
			level: "warning",
			title: `${ref} gets warm`,
			text: `${ref} conducts ${curFmt} and uses ${powFmt} of power (heat produced), which is ${pct}% of its ${maxFmt} rating. It gets warm during operation.`,
		};
	}
	return {
		level: "info",
		title: `${ref} is operating safely`,
		text: `${ref} conducts ${curFmt} and uses ${powFmt} of power (heat produced), well within its safe rating of ${maxFmt}.`,
	};
}

function buildResistorCard(part, current, power, rating) {
	const maxPower = rating?.maxPowerW ?? DEFAULT_RESISTOR_W;
	const ratio = maxPower > 0 ? power / maxPower : 0;
	const ref = part.ref || part.id;
	const body = formatResistorBody(ref, {
		curFmt: formatCurrent(current),
		powFmt: formatPower(power),
		maxFmt: formatPower(maxPower),
		ratio,
	});
	return createPartCard(part.id, body);
}

function formatBatteryLife(currMa) {
	if (currMa <= 0) {
		return "Battery is idle and not draining.";
	}
	const hours = DEFAULT_BATTERY_MAH / currMa;
	return `Rough battery life is about ${formatSigFigs(hours)} hours for a 2000 mAh battery.`;
}

function buildSourceCard(part, current) {
	const ref = part.ref || part.id;
	const isBat = isBatteryPart(part);
	const currFmt = formatCurrent(current);
	const detail = isBat ? formatBatteryLife(current * 1000) : "to the circuit.";
	return createPartCard(part.id, {
		level: "info",
		title: `${ref} ${isBat ? "Battery" : "Power Source"}`,
		text: `Supplies ${currFmt} of current (how much electricity flows) ${detail}`,
	});
}

function buildUnpoweredNetCard(net) {
	const name = net.name || net.id;
	const partIds = Array.isArray(net.pins)
		? [...new Set(net.pins.map((p) => p.partId))]
		: [];
	return {
		id: `card-net-${net.id}`,
		level: "warning",
		title: `Wire ${name} has no power`,
		text: "This wire has no power (0 V). Connected components will not receive electricity.",
		partIds,
		netIds: [net.id],
	};
}

function checkLedFault(cur, rating) {
	const maxCur = rating?.maxCurrentA ?? DEFAULT_LED_MAX_A;
	if (cur > maxCur) return "overloaded";
	if (cur < 0.001) return "stopped";
	return null;
}

function checkResistorFault(part, cur, powers, rating) {
	const pow = computeResistorPower(part, cur, powers);
	const maxPow = rating?.maxPowerW ?? DEFAULT_RESISTOR_W;
	if (pow > maxPow) return "overloaded";
	if (cur < 1e-4) return "stopped";
	return null;
}

function inspectPartFault(part, currents, ratings, powers) {
	const cur = Math.abs(currents?.[part.id] ?? 0);
	const rating = ratings?.[part.id];
	if (isLedPart(part)) {
		return checkLedFault(cur, rating);
	}
	if (isResistorPart(part)) {
		return checkResistorFault(part, cur, powers, rating);
	}
	return null;
}

function findStoppedAndOverloaded(sim) {
	const stopped = [];
	const overloaded = [];
	for (const p of sim.parts) {
		const status = inspectPartFault(p, sim.currents, sim.ratings, sim.powers);
		if (status === "overloaded") overloaded.push(p);
		else if (status === "stopped") stopped.push(p);
	}
	return { stopped, overloaded };
}

function joinPartNames(parts) {
	return parts.map((p) => p.ref || p.id).join(", ");
}

function resolveFaultBaseText(fault, info) {
	if (info?.plainEnglish) {
		return info.plainEnglish;
	}
	const kind = fault?.kind ?? "unknown";
	return `A circuit fault (${kind}) was injected.`;
}

function describeFaultChanges(stopped, overloaded) {
	const changes = [];
	if (stopped.length > 0) {
		changes.push(`${joinPartNames(stopped)} stopped (off with 0 mA)`);
	}
	if (overloaded.length > 0) {
		changes.push(`${joinPartNames(overloaded)} got overloaded`);
	}
	if (changes.length === 0) {
		return "";
	}
	return ` What changed: ${changes.join("; ")}.`;
}

function buildFaultCard(fault, stopped, overloaded) {
	const info = FAULT_INFO[fault?.kind];
	const baseText = resolveFaultBaseText(fault, info);
	const changeMsg = describeFaultChanges(stopped, overloaded);
	const level = overloaded.length > 0 ? "danger" : "warning";
	const title = info?.label ? `Fault: ${info.label}` : "Fault Injected";
	const faultKind = fault?.kind ?? "general";
	const partIds = [...stopped, ...overloaded].map((p) => p.id);
	const netIds = [fault?.netId, fault?.netA, fault?.netB].filter(Boolean);

	return {
		id: `card-fault-${faultKind}`,
		level,
		title,
		text: `${baseText}${changeMsg}`,
		partIds: [...new Set(partIds)],
		netIds: [...new Set(netIds)],
	};
}

function findUnpoweredNets(nets, voltages) {
	const unpowered = [];
	for (const net of nets) {
		if (isGroundNet(net)) continue;
		const v = voltages?.[net.id] ?? voltages?.[net.name];
		if (typeof v === "number" && Math.abs(v) < 1e-4) {
			unpowered.push(net);
		}
	}
	return unpowered;
}

function createResistorCardIfActive(part, cur, sim) {
	const hasCurrentOrPower = cur > 1e-6 || Boolean(sim.powers?.[part.id]);
	if (!hasCurrentOrPower) return null;
	const pow = computeResistorPower(part, cur, sim.powers);
	return buildResistorCard(part, cur, pow, sim.ratings?.[part.id]);
}

function tryCreatePartCard(part, sim) {
	const cur = Math.abs(sim.currents?.[part.id] ?? 0);
	if (isLedPart(part)) {
		return buildLedCard(part, cur, sim.ratings?.[part.id]);
	}
	if (isResistorPart(part)) {
		return createResistorCardIfActive(part, cur, sim);
	}
	if (isSourcePart(part) && cur > 1e-6) {
		return buildSourceCard(part, cur);
	}
	return null;
}

function appendPartCards(cards, sim) {
	for (const part of sim.parts) {
		const card = tryCreatePartCard(part, sim);
		if (card) {
			cards.push(card);
		}
	}
}

function summaryFromFault(stopped, overloaded) {
	if (stopped.length > 0) {
		const names = joinPartNames(stopped);
		return `Something is wrong: ${names} stopped receiving current due to a circuit fault.`;
	}
	if (overloaded.length > 0) {
		const names = joinPartNames(overloaded);
		return `Something is wrong: ${names} is overloaded due to a circuit fault.`;
	}
	return "Something is wrong: a circuit fault was detected.";
}

function formatLedSummary(ledCard, ledCurrent) {
	if (ledCard.level === "info") {
		return `Your circuit works: the LED gets ${formatCurrent(ledCurrent)}.`;
	}
	return `Something is wrong: the LED is not receiving enough current to light up (only ${formatCurrent(ledCurrent)}).`;
}

function buildSummary(ctx) {
	const {
		fault,
		ledCard,
		dangerCard,
		stopped,
		overloaded,
		unpoweredNets,
		ledCurrent,
	} = ctx;
	if (fault) {
		return summaryFromFault(stopped, overloaded);
	}
	if (dangerCard) {
		return `Something is wrong: ${dangerCard.text}`;
	}
	if (unpoweredNets.length > 0) {
		const netNames = unpoweredNets.map((n) => n.name || n.id).join(", ");
		return `Something is wrong: wire ${netNames} has no power.`;
	}
	if (ledCard) {
		return formatLedSummary(ledCard, ledCurrent);
	}
	return "Your circuit works: all parts are operating safely within their limits.";
}

function extractMapEntries(obj, mapFn) {
	if (!obj || typeof obj !== "object") return [];
	return Object.keys(obj).map(mapFn);
}

function extractPartsFromCurrents(currents) {
	return extractMapEntries(currents, (id) => ({ id, ref: id, value: "" }));
}

function extractNetsFromVoltages(voltages) {
	return extractMapEntries(voltages, (id) => ({ id, name: id, pins: [] }));
}

function resolvePartsAndNets(ir, currents, voltages) {
	const parts = Array.isArray(ir?.parts)
		? ir.parts
		: extractPartsFromCurrents(currents);
	const nets = Array.isArray(ir?.nets)
		? ir.nets
		: extractNetsFromVoltages(voltages);
	return { parts, nets };
}

function collectCards(sim, faultState) {
	const cards = [];
	if (sim.fault) {
		cards.push(
			buildFaultCard(sim.fault, faultState.stopped, faultState.overloaded),
		);
	}
	appendPartCards(cards, sim);
	const unpoweredNets = findUnpoweredNets(sim.nets, sim.voltages);
	for (const net of unpoweredNets) {
		cards.push(buildUnpoweredNetCard(net));
	}
	return { cards, unpoweredNets };
}

function isEmptyCircuit(parts, voltages, fault) {
	if (fault) return false;
	if (parts.length > 0) return false;
	const voltageCount = voltages ? Object.keys(voltages).length : 0;
	return voltageCount === 0;
}

function parseSimulationInputs(options) {
	const ir = options.ir;
	const voltages = options.nodeVoltages ?? {};
	const currents = options.partCurrents ?? {};
	const { parts, nets } = resolvePartsAndNets(ir, currents, voltages);
	return {
		parts,
		nets,
		voltages,
		currents,
		powers: options.partPowers ?? {},
		ratings: options.ratings ?? {},
		fault: options.fault,
	};
}

function findLedContext(parts, currents, cards) {
	const ledPart = parts.find((p) => isLedPart(p));
	if (!ledPart) {
		return { ledCurrent: 0, ledCard: undefined };
	}
	const ledCurrent = Math.abs(currents?.[ledPart.id] ?? 0);
	const ledCard = cards.find((c) => c.id === `card-${ledPart.id}`);
	return { ledCurrent, ledCard };
}

export function explainCircuitResult(options = {}) {
	if (!options || typeof options !== "object") {
		return { ...EMPTY_RESULT };
	}
	const sim = parseSimulationInputs(options);
	if (isEmptyCircuit(sim.parts, sim.voltages, sim.fault)) {
		return { ...EMPTY_RESULT };
	}
	const faultState = findStoppedAndOverloaded(sim);
	const { cards, unpoweredNets } = collectCards(sim, faultState);
	const { ledCurrent, ledCard } = findLedContext(
		sim.parts,
		sim.currents,
		cards,
	);
	const dangerCard = cards.find((c) => c.level === "danger");
	const summary = buildSummary({
		...sim,
		...faultState,
		ledCard,
		dangerCard,
		unpoweredNets,
		ledCurrent,
	});
	return { summary, cards };
}
