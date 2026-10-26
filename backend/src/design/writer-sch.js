import { getSymbol } from "./kicad-lib.js";
import { isGroundName } from "./model.js";
import { q, stableUuid } from "./sexp.js";

const GRID = 1.27;
const snap = (v) => Math.round(v / GRID) * GRID;
const f = (v) => String(Math.round(v * 10000) / 10000);

const FONT = "(effects (font (size 1.27 1.27)))";
const FONT_HIDE = "(effects (font (size 1.27 1.27)) hide)";

/** Label angle so text extends away from the symbol body (cosmetic; connectivity does not depend on it). */
function labelAngle(pinAngle) {
	return { 0: 180, 90: 270, 180: 0, 270: 90 }[((pinAngle % 360) + 360) % 360] ?? 0;
}

function powerSymbolFor(netName) {
	const exact = getSymbol(`power:${netName}`);
	if (exact?.isPower) return { id: exact.id, sym: exact, value: netName };
	const generic = getSymbol(isGroundName(netName) ? "power:GND" : "power:VCC");
	return { id: generic.id, sym: generic, value: netName };
}

/**
 * Writes a KiCad 7+ schematic. Connectivity is expressed with power symbols (rails) and local
 * labels placed exactly on each pin's connection point, so no wire routing is needed and the
 * result is unambiguous to KiCad's netlister.
 */
export function writeSchematic(design) {
	const d = design.data;
	const rootUuid = stableUuid(`${d.name}:root`);
	const libSymbols = new Map(); // id -> embed text
	const body = [];
	let pwrCount = 0;
	let flgCount = 0;

	const netOf = new Map(); // "R1.2" -> net name
	for (const [name, net] of Object.entries(d.nets)) for (const p of net.pins) netOf.set(p, name);
	const nc = new Set(d.noConnect);

	// ---- place symbol units on a grid ----
	const placements = [];
	for (const part of d.parts) {
		const sym = getSymbol(part.symbol);
		const units = sym.units.length > 1 ? sym.units : [1];
		for (const unit of units) placements.push({ part, sym, unit });
	}
	placements.forEach((pl, i) => {
		pl.ox = snap(50.8 + (i % 4) * 63.5);
		pl.oy = snap(50.8 + Math.floor(i / 4) * 50.8);
	});

	for (const pl of placements) {
		const { part, sym, unit, ox, oy } = pl;
		libSymbols.set(sym.id, sym.embedText());
		const props = [
			["Reference", part.ref, ox + 2.54, oy - 3.81, FONT],
			["Value", part.value, ox + 2.54, oy + 3.81, FONT],
			["Footprint", part.footprint || "", ox, oy, FONT_HIDE],
			["Datasheet", "~", ox, oy, FONT_HIDE],
			...Object.entries(part.fields || {}).map(([k, v]) => [k, v, ox, oy, FONT_HIDE]),
		];
		const pinsForUnit = sym.pins.filter((p) => p.unit === 0 || p.unit === unit);
		body.push(
			`  (symbol (lib_id ${q(sym.id)}) (at ${f(ox)} ${f(oy)} 0) (unit ${unit}) (in_bom yes) (on_board yes) (dnp no)`,
			`    (uuid ${stableUuid(`${d.name}:${part.ref}:${unit}`)})`,
			...props.map(([k, v, x, y, eff]) => `    (property ${q(k)} ${q(v)} (at ${f(x)} ${f(y)} 0) ${eff})`),
			...pinsForUnit.map((p) => `    (pin ${q(p.number)} (uuid ${stableUuid(`${d.name}:${part.ref}:${unit}:${p.number}`)}))`),
			`    (instances (project ${q(d.name)} (path "/${rootUuid}" (reference ${q(part.ref)}) (unit ${unit}))))`,
			"  )",
		);

		for (const pin of pinsForUnit) {
			const px = ox + pin.x;
			const py = oy - pin.y; // symbol space is Y-up, schematic space is Y-down
			const key = `${part.ref}.${pin.number}`;
			const net = netOf.get(key);
			if (nc.has(key)) {
				body.push(`  (no_connect (at ${f(px)} ${f(py)}) (uuid ${stableUuid(`${d.name}:nc:${key}`)}))`);
				continue;
			}
			if (!net) continue;
			if (d.nets[net].power) {
				const ps = powerSymbolFor(net);
				libSymbols.set(ps.id, ps.sym.embedText());
				pwrCount++;
				const ref = `#PWR${String(pwrCount).padStart(2, "0")}`;
				body.push(
					`  (symbol (lib_id ${q(ps.id)}) (at ${f(px)} ${f(py)} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no)`,
					`    (uuid ${stableUuid(`${d.name}:pwr:${key}`)})`,
					`    (property "Reference" ${q(ref)} (at ${f(px)} ${f(py + 2)} 0) ${FONT_HIDE})`,
					`    (property "Value" ${q(ps.value)} (at ${f(px)} ${f(py + 4)} 0) ${FONT})`,
					`    (property "Footprint" "" (at ${f(px)} ${f(py)} 0) ${FONT_HIDE})`,
					`    (property "Datasheet" "" (at ${f(px)} ${f(py)} 0) ${FONT_HIDE})`,
					`    (pin "1" (uuid ${stableUuid(`${d.name}:pwr:${key}:1`)}))`,
					`    (instances (project ${q(d.name)} (path "/${rootUuid}" (reference ${q(ref)}) (unit 1))))`,
					"  )",
				);
				if (d.nets[net].external && d.nets[net].pins[0] === key) {
					const flag = getSymbol("power:PWR_FLAG");
					libSymbols.set(flag.id, flag.embedText());
					flgCount++;
					const fref = `#FLG${String(flgCount).padStart(2, "0")}`;
					body.push(
						`  (symbol (lib_id ${q(flag.id)}) (at ${f(px)} ${f(py)} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no)`,
						`    (uuid ${stableUuid(`${d.name}:flag:${net}`)})`,
						`    (property "Reference" ${q(fref)} (at ${f(px)} ${f(py - 2)} 0) ${FONT_HIDE})`,
						`    (property "Value" "PWR_FLAG" (at ${f(px)} ${f(py - 4)} 0) ${FONT_HIDE})`,
						`    (property "Footprint" "" (at ${f(px)} ${f(py)} 0) ${FONT_HIDE})`,
						`    (property "Datasheet" "~" (at ${f(px)} ${f(py)} 0) ${FONT_HIDE})`,
						`    (pin "1" (uuid ${stableUuid(`${d.name}:flag:${net}:1`)}))`,
						`    (instances (project ${q(d.name)} (path "/${rootUuid}" (reference ${q(fref)}) (unit 1))))`,
						"  )",
					);
				}
			} else {
				body.push(`  (label ${q(net)} (at ${f(px)} ${f(py)} ${labelAngle(pin.angle)}) ${FONT} (uuid ${stableUuid(`${d.name}:label:${key}`)}))`);
			}
		}
	}

	return [
		`(kicad_sch (version 20230121) (generator banana)`,
		`  (uuid ${rootUuid})`,
		`  (paper "A3")`,
		`  (title_block (title ${q(d.title || d.name)}) (comment 1 "Generated by Banana"))`,
		`  (lib_symbols`,
		...[...libSymbols.values()].map((t) => t.split("\n").map((l) => `    ${l}`).join("\n")),
		`  )`,
		...body,
		`  (sheet_instances (path "/" (page "1")))`,
		")",
		"",
	].join("\n");
}
