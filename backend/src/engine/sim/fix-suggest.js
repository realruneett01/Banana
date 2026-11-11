import { newId } from "../ids.js";
import { parseSiValue } from "../spice/ir-to-spice.js";
import {
	explainCircuitResult,
	isGroundNet,
	isLedPart,
	isResistorPart,
	isSourcePart,
} from "./explain.js";

const E12_SERIES = [
	1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2, 10.0,
];

function defaultIdFn(kind) {
	return newId(kind) ?? `${kind}_${crypto.randomUUID()}`;
}

export function nextE12(value) {
	const num = typeof value === "number" ? value : parseSiValue(value);
	if (!Number.isFinite(num) || num <= 0) {
		return 1.0;
	}
	const exp = Math.floor(Math.log10(num) + 1e-12);
	const scale = 10 ** exp;
	const norm = num / scale;
	const mult = E12_SERIES.find((m) => m >= norm - 1e-9) ?? 10.0;
	return Number(Number(mult * scale).toPrecision(10));
}

function findPartById(parts, id) {
	return parts?.find((p) => p.id === id) ?? null;
}

function findResistorInNet(ir, net) {
	const resPin = net.pins?.find((pin) => {
		const part = findPartById(ir.parts, pin.partId);
		return part ? isResistorPart(part) : false;
	});
	return resPin ? findPartById(ir.parts, resPin.partId) : null;
}

function findSeriesResistor(ir, part) {
	if (!ir?.nets || !part) return null;
	const touchedNets = ir.nets.filter((n) =>
		n.pins?.some((p) => p.partId === part.id),
	);
	for (const net of touchedNets) {
		const resistor = findResistorInNet(ir, net);
		if (resistor) return resistor;
	}
	return ir.parts?.find(isResistorPart) ?? null;
}

function getSourceVoltage(source) {
	if (!source) return null;
	const val = parseSiValue(source.props?.voltage ?? source.value);
	return Number.isFinite(val) && val > 0 ? val : null;
}

function getMaxNodeVoltage(nodeVoltages) {
	const voltages = Object.values(nodeVoltages || {}).filter(Number.isFinite);
	if (voltages.length === 0) return null;
	const maxV = Math.max(...voltages);
	return maxV > 0 ? maxV : null;
}

function getSupplyVoltage(ir, nodeVoltages) {
	const source = ir?.parts?.find(isSourcePart);
	return getSourceVoltage(source) ?? getMaxNodeVoltage(nodeVoltages) ?? 5.0;
}

function getLedForwardVoltage(ledPart) {
	const propVf = parseSiValue(
		ledPart?.props?.vf ?? ledPart?.props?.forwardVoltage,
	);
	if (Number.isFinite(propVf) && propVf > 0) {
		return propVf;
	}
	return 2.0;
}

function buildResistorChangeFix(params) {
	const { id, forCardId, title, why, resistorId, newR } = params;
	return {
		id,
		forCardId,
		title,
		why,
		commands: [
			{
				type: "setPartField",
				partId: resistorId,
				field: "value",
				value: String(newR),
			},
		],
		risk: "low",
	};
}

function isDimCard(card) {
	return card?.level === "warning" && /dim|off/i.test(card.title);
}

function isDimCurrent(current) {
	return current > 0 && current < 0.001;
}

function isLedDim(card, current) {
	return isDimCard(card) || isDimCurrent(current);
}

function isLedOvercurrent(card, current) {
	return card?.level === "danger" || current > 0.03;
}

const LED_FIX_CONFIG = {
	overcurrent: {
		predicate: isLedOvercurrent,
		targetCurrent: 0.015,
		verb: "Increase",
		why: "A bigger resistor lets less electricity through, so the LED won't burn out.",
	},
	dim: {
		predicate: isLedDim,
		targetCurrent: 0.02,
		verb: "Decrease",
		why: "A smaller resistor allows more electricity through so the LED can shine brightly.",
	},
};

function computeLedTargetR(ir, led, nodeVoltages, targetCurrent) {
	const vSupply = getSupplyVoltage(ir, nodeVoltages);
	const vf = getLedForwardVoltage(led);
	return nextE12(Math.max(1, (vSupply - vf) / targetCurrent));
}

function findLedPart(ir) {
	return ir.parts?.find(isLedPart) ?? null;
}

function checkLedState(ctx, type) {
	const led = findLedPart(ctx.ir);
	if (!led) return null;
	const current = Math.abs(ctx.partCurrents?.[led.id] ?? 0);
	const card = ctx.cards?.find((c) => c.partIds?.includes(led.id));
	const config = LED_FIX_CONFIG[type];
	if (!config.predicate(card, current)) return null;

	const resistor = findSeriesResistor(ctx.ir, led);
	if (!resistor) return null;

	const newR = computeLedTargetR(
		ctx.ir,
		led,
		ctx.nodeVoltages,
		config.targetCurrent,
	);
	return buildResistorChangeFix({
		id: `fix-led-${type}-${led.id}`,
		forCardId: card?.id ?? `card-${led.id}`,
		title: `${config.verb} ${resistor.ref} to ${newR}Ω`,
		why: config.why,
		resistorId: resistor.id,
		newR,
	});
}

function checkLedOvercurrent(ctx) {
	return checkLedState(ctx, "overcurrent");
}

function checkLedTooDim(ctx) {
	return checkLedState(ctx, "dim");
}

function getResistorPower(resistor, partCurrents, partPowers) {
	if (partPowers && Number.isFinite(partPowers[resistor.id])) {
		return Math.max(0, partPowers[resistor.id]);
	}
	const cur = Math.abs(partCurrents?.[resistor.id] ?? 0);
	const raw = resistor.props?.resistance ?? resistor.value;
	const r = parseSiValue(raw);
	const resistance = Number.isFinite(r) && r > 0 ? r : 0;
	return cur * cur * resistance;
}

function buildResistorValueFix(resistor, resCard, newR) {
	return buildResistorChangeFix({
		id: `fix-resistor-value-${resistor.id}`,
		forCardId: resCard?.id ?? `card-${resistor.id}`,
		title: `Increase ${resistor.ref} to ${newR}Ω`,
		why: "A larger resistor reduces current and keeps heat below 50% of the rating.",
		resistorId: resistor.id,
		newR,
	});
}

function buildResistorPowerFix(resistor, resCard) {
	return {
		id: `fix-resistor-power-${resistor.id}`,
		forCardId: resCard?.id ?? `card-${resistor.id}`,
		title: `Use a 0.5W resistor for ${resistor.ref}`,
		why: "A 0.5W resistor can handle more heat without burning out.",
		commands: [
			{
				type: "setPartProp",
				partId: resistor.id,
				key: "power",
				value: "0.5W",
			},
		],
		risk: "low",
	};
}

function checkResistorOverPower(ctx, resistor) {
	const { partCurrents, partPowers, cards } = ctx;
	const power = getResistorPower(resistor, partCurrents, partPowers);
	const resCard = cards?.find((c) => c.partIds?.includes(resistor.id));
	if (power <= 0.25 && resCard?.level !== "danger") return [];

	const rawR = parseSiValue(resistor.props?.resistance ?? resistor.value);
	const currentR = Number.isFinite(rawR) && rawR > 0 ? rawR : 100;
	const rMin = (power * currentR) / 0.125;
	const targetR = Math.max(rMin, currentR * 1.2);
	const newR = nextE12(targetR);

	return [
		buildResistorValueFix(resistor, resCard, newR),
		buildResistorPowerFix(resistor, resCard),
	];
}

function nextPartRef(parts, prefix) {
	let max = 0;
	const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
	for (const p of parts || []) {
		const match = String(p.ref || "").match(regex);
		if (match) {
			max = Math.max(max, Number.parseInt(match[1], 10));
		}
	}
	return `${prefix}${max + 1}`;
}

function getPartCurrent(part, partCurrents) {
	if (!part) return 0;
	const cur = Math.abs(partCurrents?.[part.id] ?? 0);
	return cur > 0 && cur < 1.0 ? cur : 0;
}

function getNormalCurrent(ir, partCurrents) {
	const sourceCur = getPartCurrent(ir.parts?.find(isSourcePart), partCurrents);
	if (sourceCur > 0) return sourceCur;
	const ledCur = getPartCurrent(ir.parts?.find(isLedPart), partCurrents);
	if (ledCur > 0) return ledCur;
	return 0.015;
}

function formatFuseRating(currentA) {
	const val = currentA * 2;
	if (val < 1.0) {
		return `${Math.round(val * 1000)}mA`;
	}
	return `${Number(val.toFixed(2))}A`;
}

function isPositiveSupplyPin(pin, sourceId) {
	if (pin.partId !== sourceId) return false;
	return pin.pin === "1" || pin.pin === "+";
}

function findSupplyConnection(ir) {
	const source = ir.parts?.find(isSourcePart);
	if (!source) return null;
	const net = ir.nets?.find((n) =>
		n.pins?.some((p) => isPositiveSupplyPin(p, source.id)),
	);
	if (!net) return null;
	const otherPin = net.pins?.find((p) => p.partId !== source.id);
	if (!otherPin) return null;
	const sourcePin = net.pins?.find((p) => p.partId === source.id)?.pin ?? "1";
	return { source, sourcePin, otherPin, net };
}

function createSeriesBatch(params) {
	const { part, conn } = params;
	const { source, sourcePin, otherPin } = conn;
	return {
		type: "batch",
		commands: [
			{ type: "disconnect", partId: source.id, pin: sourcePin },
			{ type: "addPart", part },
			{
				type: "connect",
				partIdA: part.id,
				pinA: "1",
				partIdB: source.id,
				pinB: sourcePin,
			},
			{
				type: "connect",
				partIdA: part.id,
				pinA: "2",
				partIdB: otherPin.partId,
				pinB: otherPin.pin,
			},
		],
	};
}

function hasFaultCondition(fault, cards, kind) {
	const cardId = `card-fault-${kind}`;
	return fault?.kind === kind || Boolean(cards?.some((c) => c.id === cardId));
}

function hasPartWithPrefix(parts, prefix) {
	return Boolean(
		parts?.some((p) =>
			String(p.ref || "")
				.toUpperCase()
				.startsWith(prefix),
		),
	);
}

function createSeriesProtectionFix(ctx, config) {
	const { ir, cards, idFn } = ctx;
	const conn = findSupplyConnection(ir);
	if (!conn) return null;

	const value =
		typeof config.value === "function" ? config.value(ctx) : config.value;
	const part = {
		id: idFn("part"),
		ref: nextPartRef(ir.parts, config.prefix),
		value,
		symbol: config.symbol,
	};
	const card = cards?.find((c) => c.id === config.cardId);
	return {
		id: config.fixId(part),
		forCardId: card?.id ?? config.cardId,
		title: config.title(part, conn),
		why: config.why,
		commands: [createSeriesBatch({ part, conn })],
		risk: "medium",
	};
}

function checkShortNetsFault(ctx) {
	if (!hasFaultCondition(ctx.fault, ctx.cards, "short_nets")) return null;
	if (hasPartWithPrefix(ctx.ir.parts, "F")) return null;

	return createSeriesProtectionFix(ctx, {
		cardId: "card-fault-short_nets",
		prefix: "F",
		symbol: "Device:Fuse",
		value: (c) => formatFuseRating(getNormalCurrent(c.ir, c.partCurrents)),
		fixId: (p) => `fix-add-fuse-${p.id}`,
		title: (p, conn) =>
			`Add fuse ${p.ref} (${p.value}) in series with ${conn.source.ref}`,
		why: "A fuse cuts power when wires short-circuit, preventing fire and component damage.",
	});
}

function checkReversePolarityFault(ctx) {
	if (!hasFaultCondition(ctx.fault, ctx.cards, "reverse_polarity")) return null;

	return createSeriesProtectionFix(ctx, {
		cardId: "card-fault-reverse_polarity",
		prefix: "D",
		symbol: "Device:D_Schottky",
		value: "1N5819",
		fixId: (p) => `fix-reverse-polarity-${p.id}`,
		title: (p) => `Add protection diode ${p.ref} (1N5819) in series`,
		why: "A protection diode blocks reverse current, protecting components if power is connected backwards.",
	});
}

function isFaultTargetNet(net, faultNetId) {
	if (!faultNetId) return false;
	return net.id === faultNetId || net.name === faultNetId;
}

function isGroundCandidateNet(net, faultNetId) {
	if (isFaultTargetNet(net, faultNetId)) return true;
	if (net.name?.includes("DISCONNECTED")) return true;
	return isGroundNet(net);
}

function findFallbackGroundPins(ir) {
	const source = ir.parts?.find(isSourcePart);
	const led = ir.parts?.find(isLedPart);
	if (source && led) {
		return {
			pinA: { partId: source.id, pin: "2" },
			pinB: { partId: led.id, pin: "K" },
		};
	}
	return null;
}

function findGroundPins(ir, fault) {
	const gndNet = ir.nets?.find((n) => isGroundCandidateNet(n, fault?.netId));
	if (gndNet?.pins?.length >= 2) {
		return { pinA: gndNet.pins[0], pinB: gndNet.pins[1] };
	}
	return findFallbackGroundPins(ir);
}

function buildGroundFix(pins, card) {
	return {
		id: "fix-missing-ground",
		forCardId: card?.id ?? "card-fault-missing_ground",
		title: "Reconnect ground wire",
		why: "A ground connection provides the return path for electric current so the circuit can function.",
		commands: [
			{
				type: "connect",
				partIdA: pins.pinA.partId,
				pinA: pins.pinA.pin,
				partIdB: pins.pinB.partId,
				pinB: pins.pinB.pin,
			},
		],
		risk: "low",
	};
}

function checkMissingGroundFault(ctx) {
	if (!hasFaultCondition(ctx.fault, ctx.cards, "missing_ground")) return null;

	const pins = findGroundPins(ctx.ir, ctx.fault);
	if (!pins) return null;

	const card = ctx.cards?.find((c) => c.id === "card-fault-missing_ground");
	return buildGroundFix(pins, card);
}

const CONTEXT_CHECKERS = [checkLedOvercurrent, checkLedTooDim];

const FAULT_CHECKERS = [
	checkShortNetsFault,
	checkReversePolarityFault,
	checkMissingGroundFault,
];

function runCheckers(checkers, ctx) {
	return checkers.map((fn) => fn(ctx)).filter(Boolean);
}

function collectResistorFixes(ctx) {
	const resistors = (ctx.ir.parts || []).filter(isResistorPart);
	return resistors.flatMap((p) => checkResistorOverPower(ctx, p));
}

function collectFixes(ctx) {
	return [
		...runCheckers(CONTEXT_CHECKERS, ctx),
		...collectResistorFixes(ctx),
		...runCheckers(FAULT_CHECKERS, ctx),
	];
}

function resolveCards(options, simParams) {
	if (Array.isArray(options.cards)) {
		return options.cards;
	}
	return explainCircuitResult(simParams).cards;
}

export function suggestFixes(options = {}) {
	try {
		if (!options || typeof options !== "object") return [];
		const { ir, partCurrents = {}, nodeVoltages = {}, fault } = options;
		if (!ir || typeof ir !== "object" || !Array.isArray(ir.parts)) {
			return [];
		}
		const cards = resolveCards(options, {
			ir,
			partCurrents,
			nodeVoltages,
			fault,
		});
		const idFn = options.idFn ?? defaultIdFn;
		const ctx = { ir, partCurrents, nodeVoltages, cards, fault, idFn };
		return collectFixes(ctx);
	} catch {
		return [];
	}
}
