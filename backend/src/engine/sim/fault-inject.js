import { validateCircuitIR } from "../circuit-ir.js";
import { newId } from "../ids.js";

export const FAULT_KINDS = [
	"open_trace",
	"short_nets",
	"part_open",
	"part_short",
	"reverse_polarity",
	"value_drift",
	"overvoltage",
	"missing_ground",
];

export const FAULT_INFO = {
	open_trace: {
		label: "Open Trace",
		plainEnglish:
			"A copper track is cracked, so current can't flow past the break. Like a cut wire.",
		example:
			"A cracked solder joint or scratched PCB trace stops power from reaching a component.",
	},
	short_nets: {
		label: "Short Circuit",
		plainEnglish:
			"Two separate tracks are accidentally connected, letting current bypass normal components. Like two bare wires touching.",
		example:
			"A solder bridge connects 5V directly to ground or crosses two signal lines.",
	},
	part_open: {
		label: "Part Open Circuit",
		plainEnglish:
			"A component has blown or burned out internally, disconnecting its pins completely. Like a burned-out lightbulb.",
		example:
			"A blown resistor or fused inductor leaves an open gap in the circuit.",
	},
	part_short: {
		label: "Part Short Circuit",
		plainEnglish:
			"A component has failed internally such that all its pins are shorted together.",
		example:
			"A damaged capacitor breaks down internally and behaves like a solid wire.",
	},
	reverse_polarity: {
		label: "Reverse Polarity",
		plainEnglish:
			"A polarized component is installed backwards, swapping its positive and negative terminals.",
		example:
			"An LED or electrolytic capacitor inserted back-to-front fails to turn on or burns out.",
	},
	value_drift: {
		label: "Component Value Drift",
		plainEnglish:
			"A component's electrical value shifts far outside its nominal tolerance due to heat, age, or manufacturing defect.",
		example:
			"A 10k resistor drifts to 20k or 1k, upsetting the voltage divider ratio.",
	},
	overvoltage: {
		label: "Overvoltage",
		plainEnglish:
			"A power source supplies a higher voltage than the circuit was designed to tolerate.",
		example:
			"Accidentally plugging a 12V supply into a 5V circuit or an unexpected power surge.",
	},
	missing_ground: {
		label: "Missing Ground",
		plainEnglish:
			"The ground reference connection is lost, leaving signals without a return path.",
		example:
			"A disconnected ground wire or broken ground plane causes floating signals and unexpected behavior.",
	},
};

function findPart(ir, partId) {
	if (!partId || typeof partId !== "string") {
		return null;
	}
	return ir.parts.find((p) => p.id === partId || p.ref === partId) ?? null;
}

function findNet(ir, netId) {
	if (!netId || typeof netId !== "string") {
		return null;
	}
	return ir.nets.find((n) => n.id === netId || n.name === netId) ?? null;
}

function applyOpenTrace(ir, fault) {
	const net = findNet(ir, fault.netId);
	if (!net) {
		return { ok: false, error: `Net '${fault.netId}' not found` };
	}
	const idx = fault.pinIndex;
	if (typeof idx !== "number" || !Number.isInteger(idx)) {
		return { ok: false, error: "pinIndex must be an integer" };
	}
	if (idx < 0 || idx >= net.pins.length) {
		return {
			ok: false,
			error: `pinIndex ${idx} out of range for net '${net.name}'`,
		};
	}
	const [movedPin] = net.pins.splice(idx, 1);
	const newNetId = newId("net");
	const newNetName = `${net.name}_BROKEN`;
	ir.nets.push({
		id: newNetId,
		name: newNetName,
		pins: [movedPin],
	});
	return {
		ok: true,
		ir,
		description: `Split pin ${movedPin.pin} of ${movedPin.partId} into broken net ${newNetName}`,
		affected: {
			partIds: [movedPin.partId],
			netIds: [net.id, newNetId],
		},
	};
}

function applyShortNets(ir, fault) {
	const nA = findNet(ir, fault.netA);
	const nB = findNet(ir, fault.netB);
	if (!nA || !nB) {
		return { ok: false, error: "One or both nets not found" };
	}
	if (nA.id === nB.id) {
		return { ok: false, error: "Cannot short a net to itself" };
	}
	const existingKeys = new Set(nA.pins.map((p) => `${p.partId}:${p.pin}`));
	for (const pin of nB.pins) {
		if (!existingKeys.has(`${pin.partId}:${pin.pin}`)) {
			nA.pins.push(pin);
		}
	}
	ir.nets = ir.nets.filter((n) => n.id !== nB.id);
	const affectedParts = [...new Set(nA.pins.map((p) => p.partId))];
	return {
		ok: true,
		ir,
		description: `Short-circuited net ${nB.name} into ${nA.name}`,
		affected: {
			partIds: affectedParts,
			netIds: [nA.id, nB.id],
		},
	};
}

function applyPartOpen(ir, fault) {
	const part = findPart(ir, fault.partId);
	if (!part) {
		return { ok: false, error: `Part '${fault.partId}' not found` };
	}
	const affectedNetIds = [];
	for (const net of ir.nets) {
		const countBefore = net.pins.length;
		net.pins = net.pins.filter((p) => p.partId !== part.id);
		if (net.pins.length < countBefore) {
			affectedNetIds.push(net.id);
		}
	}
	return {
		ok: true,
		ir,
		description: `Disconnected all pins of part ${part.ref} (${part.id})`,
		affected: {
			partIds: [part.id],
			netIds: affectedNetIds,
		},
	};
}

function getTouchedNets(ir, partId) {
	return ir.nets.filter((net) => net.pins.some((p) => p.partId === partId));
}

function mergeNetPins(targetNet, donorNet) {
	const keys = new Set(targetNet.pins.map((p) => `${p.partId}:${p.pin}`));
	for (const pin of donorNet.pins) {
		if (!keys.has(`${pin.partId}:${pin.pin}`)) {
			targetNet.pins.push(pin);
		}
	}
}

function applyPartShort(ir, fault) {
	const part = findPart(ir, fault.partId);
	if (!part) {
		return { ok: false, error: `Part '${fault.partId}' not found` };
	}
	const touched = getTouchedNets(ir, part.id);
	if (touched.length < 2) {
		return {
			ok: false,
			error: `Part '${part.ref}' touches fewer than 2 distinct nets`,
		};
	}
	const [primary, ...rest] = touched;
	const donorIds = new Set(rest.map((n) => n.id));
	for (const donor of rest) {
		mergeNetPins(primary, donor);
	}
	ir.nets = ir.nets.filter((n) => !donorIds.has(n.id));
	return {
		ok: true,
		ir,
		description: `Short-circuited pins of ${part.ref}, merging ${touched.length} nets into ${primary.name}`,
		affected: {
			partIds: [part.id],
			netIds: touched.map((n) => n.id),
		},
	};
}

function collectPartPins(ir, partId) {
	const pins = new Set();
	const allPins = ir.nets.flatMap((n) => n.pins);
	for (const p of allPins) {
		if (p.partId === partId) {
			pins.add(p.pin);
		}
	}
	return pins;
}

function findSwappablePins(ir, partId) {
	const pins = collectPartPins(ir, partId);
	if (pins.has("1") && pins.has("2")) {
		return ["1", "2"];
	}
	if (pins.has("A") && pins.has("K")) {
		return ["A", "K"];
	}
	if (pins.has("a") && pins.has("k")) {
		return ["a", "k"];
	}
	if (pins.size === 2) {
		return Array.from(pins);
	}
	return null;
}

function swapPinValue(pin, pair) {
	const [pA, pB] = pair;
	if (pin === pA) return pB;
	if (pin === pB) return pA;
	return pin;
}

function applyReversePolarity(ir, fault) {
	const part = findPart(ir, fault.partId);
	if (!part) {
		return { ok: false, error: `Part '${fault.partId}' not found` };
	}
	const pair = findSwappablePins(ir, part.id);
	if (!pair) {
		return {
			ok: false,
			error: `Part '${part.ref}' does not have two swappable pins`,
		};
	}
	const affectedNetIds = [];
	for (const net of ir.nets) {
		let modified = false;
		for (const pin of net.pins) {
			if (pin.partId === part.id) {
				pin.pin = swapPinValue(pin.pin, pair);
				modified = true;
			}
		}
		if (modified) affectedNetIds.push(net.id);
	}
	return {
		ok: true,
		ir,
		description: `Swapped pins ${pair[0]} and ${pair[1]} of ${part.ref}`,
		affected: { partIds: [part.id], netIds: affectedNetIds },
	};
}

const SI_EXPONENTS = {
	M: 1e6,
	k: 1e3,
	K: 1e3,
	m: 1e-3,
	u: 1e-6,
	µ: 1e-6,
	n: 1e-9,
	p: 1e-12,
};

const PREFIX_TABLE = [
	{ limit: 1e6, scale: 1e6, prefix: "M" },
	{ limit: 1e3, scale: 1e3, prefix: "k" },
	{ limit: 1, scale: 1, prefix: "" },
	{ limit: 1e-3, scale: 1e-3, prefix: "m" },
	{ limit: 1e-6, scale: 1e-6, prefix: "u" },
	{ limit: 1e-9, scale: 1e-9, prefix: "n" },
	{ limit: 0, scale: 1e-12, prefix: "p" },
];

function formatDriftedValue(num, baseUnit = "") {
	const abs = Math.abs(num);
	const match =
		PREFIX_TABLE.find((entry) => abs >= entry.limit) ?? PREFIX_TABLE[2];
	const scaled = Math.round((num / match.scale) * 1000) / 1000;
	return `${scaled}${match.prefix}${baseUnit}`;
}

function parseComponentValue(str) {
	if (typeof str !== "string") return null;
	const match = str.trim().match(/^([0-9.]+)\s*([a-zA-ZµΩ]*)$/);
	if (!match) return null;
	const num = Number.parseFloat(match[1]);
	if (Number.isNaN(num)) return null;
	const unitStr = match[2] || "";
	const p = unitStr[0];
	if (p && SI_EXPONENTS[p]) {
		return { baseValue: num * SI_EXPONENTS[p], baseUnit: unitStr.slice(1) };
	}
	return { baseValue: num, baseUnit: unitStr };
}

function applyValueDrift(ir, fault) {
	const part = findPart(ir, fault.partId);
	if (!part) {
		return { ok: false, error: `Part '${fault.partId}' not found` };
	}
	const factor = fault.factor;
	if (typeof factor !== "number" || factor <= 0 || Number.isNaN(factor)) {
		return { ok: false, error: "factor must be a positive number" };
	}
	const parsed = parseComponentValue(part.value);
	if (!parsed) {
		return {
			ok: false,
			error: `Cannot parse value '${part.value}' for part '${part.ref}'`,
		};
	}
	const oldVal = part.value;
	part.value = formatDriftedValue(parsed.baseValue * factor, parsed.baseUnit);
	const netIds = ir.nets
		.filter((n) => n.pins.some((p) => p.partId === part.id))
		.map((n) => n.id);
	return {
		ok: true,
		ir,
		description: `Drifted value of ${part.ref} from ${oldVal} to ${part.value} (factor: ${factor})`,
		affected: { partIds: [part.id], netIds },
	};
}

function applyOvervoltage(ir, fault) {
	const part = findPart(ir, fault.partId);
	if (!part) {
		return { ok: false, error: `Part '${fault.partId}' not found` };
	}
	const factor = fault.factor;
	if (typeof factor !== "number" || factor <= 0 || Number.isNaN(factor)) {
		return { ok: false, error: "factor must be a positive number" };
	}
	const parsed = parseComponentValue(part.value);
	if (!parsed) {
		return {
			ok: false,
			error: `Part '${part.ref}' value '${part.value}' cannot be scaled`,
		};
	}
	const oldVal = part.value;
	part.value = formatDriftedValue(parsed.baseValue * factor, parsed.baseUnit);
	const netIds = ir.nets
		.filter((n) => n.pins.some((p) => p.partId === part.id))
		.map((n) => n.id);
	return {
		ok: true,
		ir,
		description: `Scaled voltage of source ${part.ref} from ${oldVal} to ${part.value} (factor: ${factor})`,
		affected: { partIds: [part.id], netIds },
	};
}

function isGroundNet(net) {
	const name = (net.name || "").toUpperCase();
	return name === "GND" || name.startsWith("GND") || name === "GROUND";
}

function findGroundNet(ir, netId) {
	if (netId) {
		return findNet(ir, netId);
	}
	return ir.nets.find(isGroundNet) ?? null;
}

function applyMissingGround(ir, fault) {
	const net = findGroundNet(ir, fault?.netId);
	if (!net) {
		return { ok: false, error: "No ground net found in circuit" };
	}
	const oldName = net.name;
	net.name = `${oldName}_DISCONNECTED`;
	const partIds = [...new Set(net.pins.map((p) => p.partId))];
	return {
		ok: true,
		ir,
		description: `Disconnected ground net by renaming ${oldName} to ${net.name}`,
		affected: {
			partIds,
			netIds: [net.id],
		},
	};
}

const FAULT_HANDLERS = {
	open_trace: applyOpenTrace,
	short_nets: applyShortNets,
	part_open: applyPartOpen,
	part_short: applyPartShort,
	reverse_polarity: applyReversePolarity,
	value_drift: applyValueDrift,
	overvoltage: applyOvervoltage,
	missing_ground: applyMissingGround,
};

function isValidCircuitIRShape(ir) {
	return Boolean(
		ir &&
			typeof ir === "object" &&
			Array.isArray(ir.parts) &&
			Array.isArray(ir.nets),
	);
}

export function injectFault(ir, fault) {
	if (!isValidCircuitIRShape(ir)) {
		return { ok: false, error: "Invalid Circuit IR" };
	}
	if (!fault || typeof fault !== "object" || !fault.kind) {
		return { ok: false, error: "Invalid fault specification" };
	}
	const handler = FAULT_HANDLERS[fault.kind];
	if (!handler) {
		return { ok: false, error: `Unknown fault kind '${fault.kind}'` };
	}
	const clonedIr = structuredClone(ir);
	const res = handler(clonedIr, fault);
	if (!res.ok) {
		return res;
	}
	const validation = validateCircuitIR(res.ir);
	if (!validation.ok) {
		return {
			ok: false,
			error: `Fault created invalid IR: ${validation.errors.join("; ")}`,
		};
	}
	return res;
}

function suggestOpenTrace(ir) {
	const net = ir.nets.find((n) => n.pins.length >= 2);
	if (!net) return null;
	return { kind: "open_trace", netId: net.id, pinIndex: 0 };
}

function suggestShortNets(ir) {
	if (ir.nets.length < 2) return null;
	return { kind: "short_nets", netA: ir.nets[0].id, netB: ir.nets[1].id };
}

function suggestPartOpen(ir) {
	const part = ir.parts.find((p) =>
		ir.nets.some((n) => n.pins.some((pin) => pin.partId === p.id)),
	);
	if (!part) return null;
	return { kind: "part_open", partId: part.id };
}

function suggestPartShort(ir) {
	const part = ir.parts.find((p) => getTouchedNets(ir, p.id).length >= 2);
	if (!part) return null;
	return { kind: "part_short", partId: part.id };
}

function isPolarizedPart(part) {
	const ref = (part.ref || "").toUpperCase();
	const sym = (part.symbol || "").toLowerCase();
	return (
		ref.startsWith("D") ||
		ref.startsWith("LED") ||
		sym.includes("led") ||
		sym.includes("diode")
	);
}

function suggestReversePolarity(ir) {
	let target = ir.parts.find(
		(p) => isPolarizedPart(p) && findSwappablePins(ir, p.id),
	);
	if (!target) {
		target = ir.parts.find((p) => Boolean(findSwappablePins(ir, p.id)));
	}
	if (!target) return null;
	return { kind: "reverse_polarity", partId: target.id };
}

function isDriftablePart(part) {
	const ref = (part.ref || "").toUpperCase();
	const isPassive =
		ref.startsWith("R") || ref.startsWith("C") || ref.startsWith("L");
	return isPassive && Boolean(parseComponentValue(part.value));
}

function suggestValueDrift(ir) {
	let target = ir.parts.find(isDriftablePart);
	if (!target) {
		target = ir.parts.find((p) => Boolean(parseComponentValue(p.value)));
	}
	if (!target) return null;
	return { kind: "value_drift", partId: target.id, factor: 2 };
}

function isSourcePart(part) {
	const ref = (part.ref || "").toUpperCase();
	const sym = (part.symbol || "").toLowerCase();
	return (
		ref.startsWith("V") ||
		ref.startsWith("BT") ||
		ref.startsWith("BAT") ||
		sym.includes("battery") ||
		sym.includes("source")
	);
}

function suggestOvervoltage(ir) {
	const target = ir.parts.find(
		(p) => isSourcePart(p) && Boolean(parseComponentValue(p.value)),
	);
	if (!target) return null;
	return { kind: "overvoltage", partId: target.id, factor: 1.5 };
}

function suggestMissingGround(ir) {
	const gndNet = ir.nets.find(isGroundNet);
	if (!gndNet) return null;
	return { kind: "missing_ground" };
}

const SUGGEST_FNS = [
	suggestOpenTrace,
	suggestShortNets,
	suggestPartOpen,
	suggestPartShort,
	suggestReversePolarity,
	suggestValueDrift,
	suggestOvervoltage,
	suggestMissingGround,
];

export function suggestFaults(ir) {
	if (!isValidCircuitIRShape(ir)) {
		return [];
	}
	const results = [];
	for (const fn of SUGGEST_FNS) {
		const fault = fn(ir);
		if (fault) {
			results.push(fault);
		}
	}
	return results;
}
