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

function findResistorInNet(ir, net) {
	const resPin = net.pins?.find((pin) => {
		const part = ir.parts?.find((p) => p.id === pin.partId);
		return part && isResistorPart(part);
	});
	return resPin ? ir.parts?.find((p) => p.id === resPin.partId) : null;
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

function getSupplyVoltage(ir, nodeVoltages) {
	const source = ir?.parts?.find(isSourcePart);
	if (source) {
		const val = parseSiValue(source.props?.voltage ?? source.value);
		if (Number.isFinite(val) && val > 0) return val;
	}
	const voltages = Object.values(nodeVoltages || {}).filter(Number.isFinite);
	if (voltages.length > 0) {
		const maxV = Math.max(...voltages);
		if (maxV > 0) return maxV;
	}
	return 5.0;
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

function buildLedOvercurrentFix(led, resistor, card, newR) {
	return {
		id: `fix-led-overcurrent-${led.id}`,
		forCardId: card?.id ?? `card-${led.id}`,
		title: `Increase ${resistor.ref} to ${newR}Ω`,
		why: "A bigger resistor lets less electricity through, so the LED won't burn out.",
		commands: [
			{
				type: "setPartField",
				partId: resistor.id,
				field: "value",
				value: String(newR),
			},
		],
		risk: "low",
	};
}

function checkLedOvercurrent(ctx) {
	const { ir, partCurrents, cards } = ctx;
	const led = ir.parts?.find(isLedPart);
	if (!led) return null;
	const current = Math.abs(partCurrents?.[led.id] ?? 0);
	const ledCard = cards.find((c) => c.partIds?.includes(led.id));
	if (ledCard?.level !== "danger" && current <= 0.03) return null;

	const resistor = findSeriesResistor(ir, led);
	if (!resistor) return null;

	const vSupply = getSupplyVoltage(ir, ctx.nodeVoltages);
	const vf = getLedForwardVoltage(led);
	const newR = nextE12(Math.max(1, (vSupply - vf) / 0.015));
	return buildLedOvercurrentFix(led, resistor, ledCard, newR);
}

function buildLedDimFix(led, resistor, card, newR) {
	return {
		id: `fix-led-dim-${led.id}`,
		forCardId: card?.id ?? `card-${led.id}`,
		title: `Decrease ${resistor.ref} to ${newR}Ω`,
		why: "A smaller resistor allows more electricity through so the LED can shine brightly.",
		commands: [
			{
				type: "setPartField",
				partId: resistor.id,
				field: "value",
				value: String(newR),
			},
		],
		risk: "low",
	};
}

function checkLedTooDim(ctx) {
	const { ir, partCurrents, cards } = ctx;
	const led = ir.parts?.find(isLedPart);
	if (!led) return null;
	const current = Math.abs(partCurrents?.[led.id] ?? 0);
	const ledCard = cards.find((c) => c.partIds?.includes(led.id));
	const isDim =
		(ledCard?.level === "warning" && /dim|off/i.test(ledCard.title)) ||
		(current > 0 && current < 0.001);
	if (!isDim) return null;

	const resistor = findSeriesResistor(ir, led);
	if (!resistor) return null;

	const vSupply = getSupplyVoltage(ir, ctx.nodeVoltages);
	const vf = getLedForwardVoltage(led);
	const newR = nextE12(Math.max(1, (vSupply - vf) / 0.02));
	return buildLedDimFix(led, resistor, ledCard, newR);
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
	return {
		id: `fix-resistor-value-${resistor.id}`,
		forCardId: resCard?.id ?? `card-${resistor.id}`,
		title: `Increase ${resistor.ref} to ${newR}Ω`,
		why: "A larger resistor reduces current and keeps heat below 50% of the rating.",
		commands: [
			{
				type: "setPartField",
				partId: resistor.id,
				field: "value",
				value: String(newR),
			},
		],
		risk: "low",
	};
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
	const resCard = cards.find((c) => c.partIds?.includes(resistor.id));
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

function getNormalCurrent(ir, partCurrents) {
	const source = ir.parts?.find(isSourcePart);
	const cur = source ? Math.abs(partCurrents?.[source.id] ?? 0) : 0;
	if (cur > 0 && cur < 1.0) {
		return cur;
	}
	const led = ir.parts?.find(isLedPart);
	if (led) {
		const ledCur = Math.abs(partCurrents?.[led.id] ?? 0);
		if (ledCur > 0 && ledCur < 1.0) return ledCur;
	}
	return 0.015;
}

function formatFuseRating(currentA) {
	const val = currentA * 2;
	if (val < 1.0) {
		return `${Math.round(val * 1000)}mA`;
	}
	return `${Number(val.toFixed(2))}A`;
}

function findSupplyConnection(ir) {
	const source = ir.parts?.find(isSourcePart);
	if (!source) return null;
	const net = ir.nets?.find((n) =>
		n.pins?.some(
			(p) => p.partId === source.id && (p.pin === "1" || p.pin === "+"),
		),
	);
	if (!net) return null;
	const otherPin = net.pins.find((p) => p.partId !== source.id);
	if (!otherPin) return null;
	const sourcePin = net.pins.find((p) => p.partId === source.id)?.pin ?? "1";
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

function buildFuseFix(part, conn, card) {
	return {
		id: `fix-add-fuse-${part.id}`,
		forCardId: card?.id ?? "card-fault-short_nets",
		title: `Add fuse ${part.ref} (${part.value}) in series with ${conn.source.ref}`,
		why: "A fuse cuts power when wires short-circuit, preventing fire and component damage.",
		commands: [createSeriesBatch({ part, conn })],
		risk: "medium",
	};
}

function checkShortNetsFault(ctx) {
	const { ir, fault, partCurrents, cards, idFn } = ctx;
	const isShort =
		fault?.kind === "short_nets" ||
		cards.some((c) => c.id === "card-fault-short_nets");
	const hasFuse = ir.parts?.some((p) =>
		String(p.ref || "")
			.toUpperCase()
			.startsWith("F"),
	);
	if (!isShort || hasFuse) return null;

	const conn = findSupplyConnection(ir);
	if (!conn) return null;

	const fuseVal = formatFuseRating(getNormalCurrent(ir, partCurrents));
	const part = {
		id: idFn("part"),
		ref: nextPartRef(ir.parts, "F"),
		value: fuseVal,
		symbol: "Device:Fuse",
	};
	const card = cards.find((c) => c.id === "card-fault-short_nets");
	return buildFuseFix(part, conn, card);
}

function buildDiodeFix(part, conn, card) {
	return {
		id: `fix-reverse-polarity-${part.id}`,
		forCardId: card?.id ?? "card-fault-reverse_polarity",
		title: `Add protection diode ${part.ref} (1N5819) in series`,
		why: "A protection diode blocks reverse current, protecting components if power is connected backwards.",
		commands: [createSeriesBatch({ part, conn })],
		risk: "medium",
	};
}

function checkReversePolarityFault(ctx) {
	const { ir, fault, cards, idFn } = ctx;
	const isRev =
		fault?.kind === "reverse_polarity" ||
		cards.some((c) => c.id === "card-fault-reverse_polarity");
	if (!isRev) return null;

	const conn = findSupplyConnection(ir);
	if (!conn) return null;

	const part = {
		id: idFn("part"),
		ref: nextPartRef(ir.parts, "D"),
		value: "1N5819",
		symbol: "Device:D_Schottky",
	};
	const card = cards.find((c) => c.id === "card-fault-reverse_polarity");
	return buildDiodeFix(part, conn, card);
}

function findGroundPins(ir, fault) {
	const gndNet = ir.nets?.find(
		(n) =>
			(fault?.netId && (n.id === fault.netId || n.name === fault.netId)) ||
			n.name?.includes("DISCONNECTED") ||
			isGroundNet(n),
	);
	if (gndNet && gndNet.pins?.length >= 2) {
		return { pinA: gndNet.pins[0], pinB: gndNet.pins[1] };
	}
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
	const { ir, fault, cards } = ctx;
	const isMissing =
		fault?.kind === "missing_ground" ||
		cards.some((c) => c.id === "card-fault-missing_ground");
	if (!isMissing) return null;

	const pins = findGroundPins(ir, fault);
	if (!pins) return null;

	const card = cards.find((c) => c.id === "card-fault-missing_ground");
	return buildGroundFix(pins, card);
}

function collectFixes(ctx) {
	const fixes = [];
	const ledOver = checkLedOvercurrent(ctx);
	if (ledOver) fixes.push(ledOver);

	const ledDim = checkLedTooDim(ctx);
	if (ledDim) fixes.push(ledDim);

	for (const p of ctx.ir.parts || []) {
		if (isResistorPart(p)) {
			fixes.push(...checkResistorOverPower(ctx, p));
		}
	}

	const shortFix = checkShortNetsFault(ctx);
	if (shortFix) fixes.push(shortFix);

	const revFix = checkReversePolarityFault(ctx);
	if (revFix) fixes.push(revFix);

	const gndFix = checkMissingGroundFault(ctx);
	if (gndFix) fixes.push(gndFix);

	return fixes;
}

export function suggestFixes(options = {}) {
	try {
		if (!options || typeof options !== "object") return [];
		const { ir, partCurrents = {}, nodeVoltages = {}, fault } = options;
		if (!ir || typeof ir !== "object" || !Array.isArray(ir.parts)) {
			return [];
		}
		const cards = Array.isArray(options.cards)
			? options.cards
			: explainCircuitResult({
					ir,
					partCurrents,
					nodeVoltages,
					fault,
				}).cards;
		const idFn = options.idFn ?? defaultIdFn;
		const ctx = { ir, partCurrents, nodeVoltages, cards, fault, idFn };
		return collectFixes(ctx);
	} catch {
		return [];
	}
}
