import { parseSiValue } from "../spice/ir-to-spice.js";
import { FAULT_INFO } from "./fault-inject.js";

const DEFAULT_RESISTOR_W = 0.25;
const DEFAULT_LED_MAX_A = 0.03;
const DEFAULT_BATTERY_MAH = 2000;

export function formatSigFigs(val, n = 2) {
	if (!Number.isFinite(val) || val === 0) {
		return "0";
	}
	const abs = Math.abs(val);
	const formatted = Number(abs.toPrecision(n));
	return `${val < 0 ? "-" : ""}${formatted}`;
}

export function formatCurrent(amps) {
	if (!Number.isFinite(amps) || amps === 0) {
		return "0 mA";
	}
	const abs = Math.abs(amps);
	if (abs < 1) {
		return `${formatSigFigs(amps * 1000)} mA`;
	}
	return `${formatSigFigs(amps)} A`;
}

export function formatVoltage(volts) {
	if (!Number.isFinite(volts) || volts === 0) {
		return "0 V";
	}
	const abs = Math.abs(volts);
	if (abs < 1) {
		return `${formatSigFigs(volts * 1000)} mV`;
	}
	return `${formatSigFigs(volts)} V`;
}

export function formatPower(watts) {
	if (!Number.isFinite(watts) || watts === 0) {
		return "0 W";
	}
	const abs = Math.abs(watts);
	if (abs < 1) {
		return `${formatSigFigs(watts * 1000)} mW`;
	}
	return `${formatSigFigs(watts)} W`;
}

export function isLedPart(part) {
	if (!part) return false;
	const ref = String(part.ref || "").toUpperCase();
	const sym = String(part.symbol || "").toLowerCase();
	const val = String(part.value || "").toLowerCase();
	if (sym.includes("led") || ref.startsWith("LED")) {
		return true;
	}
	if (ref.startsWith("D")) {
		return val.includes("led") || /^(red|green|blue|yellow|white)/.test(val);
	}
	return false;
}

export function isResistorPart(part) {
	if (!part) return false;
	const ref = String(part.ref || "").toUpperCase();
	const sym = String(part.symbol || "").toLowerCase();
	return ref.startsWith("R") || sym.includes("resistor") || sym.includes(":r");
}

export function isBatteryPart(part) {
	if (!part) return false;
	const ref = String(part.ref || "").toUpperCase();
	const sym = String(part.symbol || "").toLowerCase();
	return (
		ref.startsWith("BT") || ref.startsWith("BAT") || sym.includes("battery")
	);
}

export function isSourcePart(part) {
	if (!part) return false;
	if (isBatteryPart(part)) return true;
	const ref = String(part.ref || "").toUpperCase();
	const sym = String(part.symbol || "").toLowerCase();
	return ref.startsWith("V") || sym.includes("source");
}

export function isGroundNet(net) {
	if (!net) return false;
	const name = String(net.name || "").toUpperCase();
	const id = String(net.id || "").toUpperCase();
	if (name === "GND" || name.startsWith("GND") || name === "GROUND") {
		return true;
	}
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

function buildLedCard(part, current, rating) {
	const maxCurrent = rating?.maxCurrentA ?? DEFAULT_LED_MAX_A;
	const ref = part.ref || part.id;
	const body = formatLedBody(ref, current, maxCurrent);
	return {
		id: `card-${part.id}`,
		...body,
		partIds: [part.id],
		netIds: [],
	};
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
	return {
		id: `card-${part.id}`,
		...body,
		partIds: [part.id],
		netIds: [],
	};
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
	return {
		id: `card-${part.id}`,
		level: "info",
		title: `${ref} ${isBat ? "Battery" : "Power Source"}`,
		text: `Supplies ${currFmt} of current (how much electricity flows) ${detail}`,
		partIds: [part.id],
		netIds: [],
	};
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

function findStoppedAndOverloaded(parts, currents, ratings, powers) {
	const stopped = [];
	const overloaded = [];
	for (const p of parts) {
		const cur = Math.abs(currents?.[p.id] ?? 0);
		if (isLedPart(p)) {
			const maxCur = ratings?.[p.id]?.maxCurrentA ?? DEFAULT_LED_MAX_A;
			if (cur > maxCur) overloaded.push(p);
			else if (cur < 0.001) stopped.push(p);
		} else if (isResistorPart(p)) {
			const pow = computeResistorPower(p, cur, powers);
			const maxPow = ratings?.[p.id]?.maxPowerW ?? DEFAULT_RESISTOR_W;
			if (pow > maxPow) overloaded.push(p);
			else if (cur < 1e-4) stopped.push(p);
		}
	}
	return { stopped, overloaded };
}

function buildFaultCard(fault, stopped, overloaded) {
	const info = FAULT_INFO[fault?.kind];
	const baseText =
		info?.plainEnglish ??
		`A circuit fault (${fault?.kind || "unknown"}) was injected.`;
	const changes = [];
	if (stopped.length > 0) {
		const stoppedNames = stopped.map((p) => p.ref || p.id).join(", ");
		changes.push(`${stoppedNames} stopped (off with 0 mA)`);
	}
	if (overloaded.length > 0) {
		const overloadedNames = overloaded.map((p) => p.ref || p.id).join(", ");
		changes.push(`${overloadedNames} got overloaded`);
	}
	const changeMsg =
		changes.length > 0 ? ` What changed: ${changes.join("; ")}.` : "";
	const level = overloaded.length > 0 ? "danger" : "warning";
	const partIds = [...stopped, ...overloaded].map((p) => p.id);
	const netIds = [fault?.netId, fault?.netA, fault?.netB].filter(Boolean);

	return {
		id: `card-fault-${fault?.kind || "general"}`,
		level,
		title: info?.label ? `Fault: ${info.label}` : "Fault Injected",
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

function appendPartCards(cards, ctx) {
	const { parts, currents, powers, ratings } = ctx;
	for (const part of parts) {
		const cur = Math.abs(currents?.[part.id] ?? 0);
		const rating = ratings?.[part.id];
		if (isLedPart(part)) {
			cards.push(buildLedCard(part, cur, rating));
		} else if (isResistorPart(part) && (cur > 1e-6 || powers?.[part.id])) {
			const pow = computeResistorPower(part, cur, powers);
			cards.push(buildResistorCard(part, cur, pow, rating));
		} else if (isSourcePart(part) && cur > 1e-6) {
			cards.push(buildSourceCard(part, cur));
		}
	}
}

function summaryFromFault(stopped, overloaded) {
	if (stopped.length > 0) {
		const names = stopped.map((p) => p.ref || p.id).join(", ");
		return `Something is wrong: ${names} stopped receiving current due to a circuit fault.`;
	}
	if (overloaded.length > 0) {
		const names = overloaded.map((p) => p.ref || p.id).join(", ");
		return `Something is wrong: ${names} is overloaded due to a circuit fault.`;
	}
	return "Something is wrong: a circuit fault was detected.";
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
		return ledCard.level === "info"
			? `Your circuit works: the LED gets ${formatCurrent(ledCurrent)}.`
			: `Something is wrong: the LED is not receiving enough current to light up (only ${formatCurrent(ledCurrent)}).`;
	}
	return "Your circuit works: all parts are operating safely within their limits.";
}

function extractPartsFromCurrents(currents) {
	if (!currents || typeof currents !== "object") return [];
	return Object.keys(currents).map((id) => ({
		id,
		ref: id,
		value: "",
	}));
}

function extractNetsFromVoltages(voltages) {
	if (!voltages || typeof voltages !== "object") return [];
	return Object.keys(voltages).map((id) => ({
		id,
		name: id,
		pins: [],
	}));
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

function collectCards(ctx) {
	const {
		parts,
		nets,
		currents,
		powers,
		ratings,
		fault,
		voltages,
		stopped,
		overloaded,
	} = ctx;
	const cards = [];
	if (fault) {
		cards.push(buildFaultCard(fault, stopped, overloaded));
	}
	appendPartCards(cards, { parts, currents, powers, ratings });
	const unpoweredNets = findUnpoweredNets(nets, voltages);
	for (const net of unpoweredNets) {
		cards.push(buildUnpoweredNetCard(net));
	}
	return { cards, unpoweredNets };
}

export function explainCircuitResult(options = {}) {
	if (!options || typeof options !== "object") {
		return { summary: "No simulation data available to explain.", cards: [] };
	}
	const {
		ir,
		nodeVoltages = {},
		partCurrents = {},
		partPowers = {},
		fault,
		ratings = {},
	} = options;
	const { parts, nets } = resolvePartsAndNets(ir, partCurrents, nodeVoltages);
	if (
		parts.length === 0 &&
		Object.keys(nodeVoltages || {}).length === 0 &&
		!fault
	) {
		return { summary: "No simulation data available to explain.", cards: [] };
	}
	const { stopped, overloaded } = findStoppedAndOverloaded(
		parts,
		partCurrents,
		ratings,
		partPowers,
	);
	const { cards, unpoweredNets } = collectCards({
		parts,
		nets,
		currents: partCurrents,
		powers: partPowers,
		ratings,
		fault,
		voltages: nodeVoltages,
		stopped,
		overloaded,
	});
	const ledPart = parts.find((p) => isLedPart(p));
	const ledCurrent = ledPart ? Math.abs(partCurrents?.[ledPart.id] ?? 0) : 0;
	const ledCard = cards.find((c) => ledPart && c.id === `card-${ledPart.id}`);
	const dangerCard = cards.find((c) => c.level === "danger");
	const summary = buildSummary({
		fault,
		ledCard,
		dangerCard,
		stopped,
		overloaded,
		unpoweredNets,
		ledCurrent,
	});
	return { summary, cards };
}
