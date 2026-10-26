import { getSymbol } from "./kicad-lib.js";
import { isGroundName } from "./model.js";
import { layoutSchematic } from "./schematic-layout.js";
import { q, stableUuid } from "./sexp.js";

const f = (v) => String(Math.round(v * 10000) / 10000);

const FONT = "(effects (font (size 1.27 1.27)))";
const FONT_HIDE = "(effects (font (size 1.27 1.27)) hide)";

function powerSymbolFor(netName) {
	const exact = getSymbol(`power:${netName}`);
	if (exact?.isPower) return { id: exact.id, sym: exact, value: netName };
	const generic = getSymbol(isGroundName(netName) ? "power:GND" : "power:VCC");
	return { id: generic.id, sym: generic, value: netName };
}

/**
 * Writes a KiCad 7+ schematic. Symbols sit in connectivity-ordered columns; signal nets are drawn as
 * orthogonal wires (with junctions and one net label per net), power pins get a short stub ending in a
 * power symbol, and any net that cannot be drawn without touching another keeps net labels on its pins,
 * so the netlist is always exactly the design's.
 */
export function writeSchematic(design) {
	const d = design.data;
	const rootUuid = stableUuid(`${d.name}:root`);
	const layout = layoutSchematic(design);
	const libSymbols = new Map(); // id -> embed text
	const body = [];
	let pwrCount = 0;
	let flgCount = 0;

	for (const u of layout.units) {
		const { part, sym, unit, ox, oy } = u;
		libSymbols.set(sym.id, sym.embedText());
		const props = [
			["Reference", part.ref, ox + 2.54, oy - 3.81, FONT],
			["Value", part.value, ox + 2.54, oy + 3.81, FONT],
			["Footprint", part.footprint || "", ox, oy, FONT_HIDE],
			["Datasheet", "~", ox, oy, FONT_HIDE],
			...Object.entries(part.fields || {}).map(([k, v]) => [
				k,
				v,
				ox,
				oy,
				FONT_HIDE,
			]),
		];
		body.push(
			`  (symbol (lib_id ${q(sym.id)}) (at ${f(ox)} ${f(oy)} ${u.rot}) (unit ${unit}) (in_bom yes) (on_board yes) (dnp no)`,
			`    (uuid ${stableUuid(`${d.name}:${part.ref}:${unit}`)})`,
			...props.map(
				([k, v, x, y, eff]) =>
					`    (property ${q(k)} ${q(v)} (at ${f(x)} ${f(y)} 0) ${eff})`,
			),
			...u.pins.map(
				(p) =>
					`    (pin ${q(p.number)} (uuid ${stableUuid(`${d.name}:${part.ref}:${unit}:${p.number}`)}))`,
			),
			`    (instances (project ${q(d.name)} (path "/${rootUuid}" (reference ${q(part.ref)}) (unit ${unit}))))`,
			"  )",
		);
	}

	const stroke = "(stroke (width 0) (type default))";
	layout.wires.forEach((w, i) => {
		body.push(
			`  (wire (pts (xy ${f(w.x1)} ${f(w.y1)}) (xy ${f(w.x2)} ${f(w.y2)})) ${stroke} (uuid ${stableUuid(`${d.name}:wire:${i}`)}))`,
		);
	});
	layout.junctions.forEach((j, i) => {
		body.push(
			`  (junction (at ${f(j.x)} ${f(j.y)}) (diameter 0) (color 0 0 0 0) (uuid ${stableUuid(`${d.name}:junction:${i}`)}))`,
		);
	});
	layout.labels.forEach((l, i) => {
		body.push(
			`  (label ${q(l.net)} (at ${f(l.x)} ${f(l.y)} ${l.angle}) ${FONT} (uuid ${stableUuid(`${d.name}:label:${i}`)}))`,
		);
	});

	for (const inst of layout.instances) {
		const { key, net, x: px, y: py } = inst;
		if (inst.nc) {
			body.push(
				`  (no_connect (at ${f(px)} ${f(py)}) (uuid ${stableUuid(`${d.name}:nc:${key}`)}))`,
			);
			continue;
		}
		if (!net || !d.nets[net].power) continue;
		const at = layout.powers.get(inst.id) ?? { x: px, y: py };
		const ps = powerSymbolFor(net);
		libSymbols.set(ps.id, ps.sym.embedText());
		pwrCount++;
		const ref = `#PWR${String(pwrCount).padStart(2, "0")}`;
		body.push(
			`  (symbol (lib_id ${q(ps.id)}) (at ${f(at.x)} ${f(at.y)} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no)`,
			`    (uuid ${stableUuid(`${d.name}:pwr:${inst.id}`)})`,
			`    (property "Reference" ${q(ref)} (at ${f(at.x)} ${f(at.y + 2)} 0) ${FONT_HIDE})`,
			`    (property "Value" ${q(ps.value)} (at ${f(at.x)} ${f(isGroundName(net) ? at.y + 3.81 : at.y - 3.81)} 0) ${FONT})`,
			`    (property "Footprint" "" (at ${f(at.x)} ${f(at.y)} 0) ${FONT_HIDE})`,
			`    (property "Datasheet" "" (at ${f(at.x)} ${f(at.y)} 0) ${FONT_HIDE})`,
			`    (pin "1" (uuid ${stableUuid(`${d.name}:pwr:${inst.id}:1`)}))`,
			`    (instances (project ${q(d.name)} (path "/${rootUuid}" (reference ${q(ref)}) (unit 1))))`,
			"  )",
		);
		if (d.nets[net].external && d.nets[net].pins[0] === key) {
			const flag = getSymbol("power:PWR_FLAG");
			libSymbols.set(flag.id, flag.embedText());
			flgCount++;
			const fref = `#FLG${String(flgCount).padStart(2, "0")}`;
			body.push(
				`  (symbol (lib_id ${q(flag.id)}) (at ${f(at.x)} ${f(at.y)} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no)`,
				`    (uuid ${stableUuid(`${d.name}:flag:${net}`)})`,
				`    (property "Reference" ${q(fref)} (at ${f(at.x)} ${f(at.y - 2)} 0) ${FONT_HIDE})`,
				`    (property "Value" "PWR_FLAG" (at ${f(at.x)} ${f(at.y - 4)} 0) ${FONT_HIDE})`,
				`    (property "Footprint" "" (at ${f(at.x)} ${f(at.y)} 0) ${FONT_HIDE})`,
				`    (property "Datasheet" "~" (at ${f(at.x)} ${f(at.y)} 0) ${FONT_HIDE})`,
				`    (pin "1" (uuid ${stableUuid(`${d.name}:flag:${net}:1`)}))`,
				`    (instances (project ${q(d.name)} (path "/${rootUuid}" (reference ${q(fref)}) (unit 1))))`,
				"  )",
			);
		}
	}

	return [
		`(kicad_sch (version 20230121) (generator banana)`,
		`  (uuid ${rootUuid})`,
		`  (paper "${layout.paper}")`,
		`  (title_block (title ${q(d.title || d.name)}) (comment 1 "Generated by Banana"))`,
		`  (lib_symbols`,
		...[...libSymbols.values()].map((t) =>
			t
				.split("\n")
				.map((l) => `    ${l}`)
				.join("\n"),
		),
		`  )`,
		...body,
		`  (sheet_instances (path "/" (page "1")))`,
		")",
		"",
	].join("\n");
}
