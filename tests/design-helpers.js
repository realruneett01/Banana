import { int, pick, rng } from "./helpers.js";

export const FOOTPRINTS = {
	"Device:R": "Resistor_SMD:R_0805_2012Metric",
	"Device:C": "Capacitor_SMD:C_0805_2012Metric",
	"Device:LED": "LED_SMD:LED_0805_2012Metric",
	"Device:D": "Diode_SMD:D_SOD-123",
	"Connector_Generic:Conn_01x02":
		"Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
	"Connector_Generic:Conn_01x03":
		"Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical",
	"Connector_Generic:Conn_01x04":
		"Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
	"Device:Q_NPN_BCE": "Package_TO_SOT_SMD:SOT-23",
};
const VALUES = {
	"Device:R": ["1k", "10k", "330", "4.7k"],
	"Device:C": ["100n", "1u", "10u"],
	"Device:LED": ["RED", "GREEN"],
	"Device:D": ["1N4148"],
	"Device:Q_NPN_BCE": ["BC847"],
};

/** Builds a random, valid design on the given Design instance. Deterministic per seed. */
export function randomCircuit(
	design,
	seed,
	{ minParts = 3, maxParts = 10 } = {},
) {
	const r = rng(seed);
	const syms = Object.keys(FOOTPRINTS);
	const n = int(r, minParts, maxParts);
	// only parts the installed libraries have (the set of symbols differs between KiCad versions)
	for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
		const symbol = pick(r, syms);
		try {
			design.addPart({
				symbol,
				value: pick(r, VALUES[symbol] ?? ["CONN"]),
				footprint: FOOTPRINTS[symbol],
			});
			i++;
		} catch (err) {
			if (!/not found/.test(err.message)) throw err;
		}
	}
	const pins = design.parts.flatMap((p) =>
		design.symbolOf(p).pins.map((pin) => `${p.ref}.${pin.number}`),
	);
	for (let i = pins.length - 1; i > 0; i--) {
		const j = int(r, 0, i);
		[pins[i], pins[j]] = [pins[j], pins[i]];
	}
	const names = ["GND", "+5V", "+3V3", "SIG_A", "SIG_B", "N1", "N2", "N3"];
	let k = 0;
	let netIndex = 0;
	while (k < pins.length && netIndex < names.length) {
		const size = int(r, 2, 4);
		const group = pins.slice(k, k + size);
		k += size;
		if (group.length < 2) break;
		design.connect(names[netIndex], group);
		if (/^(\+|GND)/.test(names[netIndex]))
			design.setNetFlags(names[netIndex], { external: true });
		netIndex++;
	}
	return design;
}
