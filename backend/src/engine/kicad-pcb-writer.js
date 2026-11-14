import { createHash } from "node:crypto";
import { validateCircuitIR } from "./circuit-ir.js";
import { flipLayerString, orientFootprint } from "./kicad-pcb-edit.js";
import { serialize, sym } from "./sexpr.js";

function deterministicUuid(id) {
	const hex = createHash("sha1").update(String(id)).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createLayersNode() {
	return [
		sym("layers"),
		[0, "F.Cu", sym("signal")],
		[2, "B.Cu", sym("signal")],
		[9, "F.SilkS", sym("user"), "F.Silkscreen"],
		[11, "B.SilkS", sym("user"), "B.Silkscreen"],
		[1, "F.Mask", sym("user")],
		[3, "B.Mask", sym("user")],
		[13, "F.Paste", sym("user")],
		[15, "B.Paste", sym("user")],
		[25, "Edge.Cuts", sym("user")],
		[31, "F.CrtYd", sym("user"), "F.Courtyard"],
		[29, "B.CrtYd", sym("user"), "B.Courtyard"],
		[35, "F.Fab", sym("user")],
		[33, "B.Fab", sym("user")],
	];
}

function buildPinNetMap(nets) {
	const map = new Map();
	for (let i = 0; i < nets.length; i++) {
		const net = nets[i];
		const netNumber = i + 1;
		const pins = net.pins ?? [];
		for (let j = 0; j < pins.length; j++) {
			const pin = pins[j];
			map.set(`${pin.partId}:${String(pin.pin)}`, {
				number: netNumber,
				name: net.name,
			});
		}
	}
	return map;
}

function buildNetDeclarations(nets) {
	const list = [[sym("net"), 0, ""]];
	for (let i = 0; i < nets.length; i++) {
		list.push([sym("net"), i + 1, nets[i].name]);
	}
	return list;
}

function buildPadNode(pad, netInfo) {
	const node = [
		sym("pad"),
		String(pad.number),
		sym(pad.type),
		sym(pad.shape),
		// Footprint-relative; orientFootprint makes it absolute as boards store it.
		[sym("at"), pad.at[0], pad.at[1], pad.at[2] ?? 0],
		[sym("size"), pad.size[0], pad.size[1]],
	];
	if (pad.drill !== undefined && pad.drill !== null) {
		node.push([sym("drill"), pad.drill]);
	}
	node.push([sym("layers"), ...pad.layers]);
	if (netInfo) {
		node.push([sym("net"), netInfo.number, netInfo.name]);
	}
	return node;
}

// An embedded (imported) pad is already flipped for a back part; take it
// back to the front, where the footprint is built before it is flipped.
function frontPad(pad) {
	const [x, y, a = 0] = pad.at;
	const at = [x, -y || 0, -a || 0];
	return { ...pad, at, layers: pad.layers.map(flipLayerString) };
}

function defPads(def, side) {
	const pads = Array.isArray(def) ? def : (def.pads ?? []);
	return def.embedded && side === "B" ? pads.map(frontPad) : pads;
}

// A board import keys its embedded footprints by part id, a library by id.
function resolvePartPads(part, footprints, pinNetMap, warnings) {
	const def = footprints?.[part.id] ?? footprints?.[part.footprint];
	if (!def) {
		warnings.push(
			`no footprint definition for ${part.ref} (${part.footprint})`,
		);
		return [];
	}
	const rawPads = defPads(def, part.placement.side);
	const padNodes = [];
	for (let i = 0; i < rawPads.length; i++) {
		const pad = rawPads[i];
		const netInfo = pinNetMap.get(`${part.id}:${String(pad.number)}`);
		padNodes.push(buildPadNode(pad, netInfo));
	}
	return padNodes;
}

// Built on the front at 0 degrees, then flipped and turned as pcbnew does.
function buildFootprintNode(part, pads) {
	const { x, y, rot, side } = part.placement;
	const node = [
		sym("footprint"),
		part.footprint,
		[sym("layer"), "F.Cu"],
		[sym("uuid"), deterministicUuid(part.id)],
		[sym("at"), x, y, 0],
		[
			sym("property"),
			"Reference",
			part.ref,
			[sym("at"), 0, -3, 0],
			[sym("layer"), "F.SilkS"],
		],
		[
			sym("property"),
			"Value",
			part.value,
			[sym("at"), 0, 3, 0],
			[sym("layer"), "F.Fab"],
		],
		...pads,
	];
	orientFootprint(node, rot, side);
	return node;
}

function buildAllFootprints(parts, footprints, pinNetMap, warnings) {
	const nodes = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part.placement) {
			warnings.push(`unplaced part ${part.ref}`);
			continue;
		}
		const pads = resolvePartPads(part, footprints, pinNetMap, warnings);
		nodes.push(buildFootprintNode(part, pads));
	}
	return nodes;
}

function buildOutlineNode(boardW, boardH) {
	return [
		sym("gr_rect"),
		[sym("start"), 0, 0],
		[sym("end"), boardW, boardH],
		[sym("stroke"), [sym("width"), 0.1], [sym("type"), sym("default")]],
		[sym("fill"), sym("no")],
		[sym("layer"), "Edge.Cuts"],
		[sym("uuid"), deterministicUuid("outline")],
	];
}

function buildPcbTree(thicknessMm, nets, footprints, outline) {
	return [
		sym("kicad_pcb"),
		[sym("version"), 20241229],
		[sym("generator"), "banana"],
		[sym("generator_version"), "0.1"],
		[
			sym("general"),
			[sym("thickness"), thicknessMm],
			[sym("legacy_teardrops"), sym("no")],
		],
		[sym("paper"), "A4"],
		createLayersNode(),
		[sym("setup"), [sym("pad_to_mask_clearance"), 0]],
		...nets,
		...footprints,
		outline,
	];
}

export function irToKicadPcb(
	ir,
	{ boardW = 100, boardH = 100, footprints = {}, thicknessMm = 1.6 } = {},
) {
	const validation = validateCircuitIR(ir);
	if (!validation.ok) {
		throw new Error(`Invalid Circuit IR: ${validation.errors.join("; ")}`);
	}
	const warnings = [];
	const pinNetMap = buildPinNetMap(ir.nets);
	const netNodes = buildNetDeclarations(ir.nets);
	const footprintNodes = buildAllFootprints(
		ir.parts,
		footprints,
		pinNetMap,
		warnings,
	);
	const outlineNode = buildOutlineNode(boardW, boardH);
	const tree = buildPcbTree(thicknessMm, netNodes, footprintNodes, outlineNode);
	return {
		text: serialize(tree),
		warnings,
	};
}
