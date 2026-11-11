import { createHash } from "node:crypto";
import { validateCircuitIR } from "./circuit-ir.js";
import { serialize, sym } from "./sexpr.js";

function deterministicUuid(seed) {
	const hex = createHash("sha1").update(String(seed)).digest("hex");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

function hasValidSchAt(schAt) {
	if (!schAt) {
		return false;
	}
	return Number.isFinite(schAt.x) && Number.isFinite(schAt.y);
}

function computePartPosition(part, index) {
	const schAt = part.props?.schAt;
	if (hasValidSchAt(schAt)) {
		const rot = Number.isFinite(schAt.rot) ? schAt.rot : 0;
		return { x: schAt.x, y: schAt.y, rot };
	}
	const col = index % 6;
	const row = Math.floor(index / 6);
	return {
		x: 25.4 + col * 25.4,
		y: 25.4 + row * 25.4,
		rot: 0,
	};
}

function buildPartProperties(part, pos) {
	const atNode = [sym("at"), pos.x, pos.y, 0];
	return [
		[sym("property"), "Reference", part.ref, atNode],
		[sym("property"), "Value", part.value, atNode],
		[
			sym("property"),
			"Footprint",
			part.footprint,
			atNode,
			[sym("hide"), sym("yes")],
		],
	];
}

function buildSymbolNode(part, pos) {
	return [
		sym("symbol"),
		[sym("lib_id"), part.symbol],
		[sym("at"), pos.x, pos.y, pos.rot],
		[sym("unit"), 1],
		[sym("in_bom"), sym("yes")],
		[sym("on_board"), sym("yes")],
		[sym("uuid"), deterministicUuid(part.id)],
		...buildPartProperties(part, pos),
	];
}

function buildLibSymbols(parts, libSymbols, warnings) {
	const seenSymbols = new Set();
	const includedNodes = [];
	for (const part of parts) {
		if (seenSymbols.has(part.symbol)) {
			continue;
		}
		seenSymbols.add(part.symbol);
		const libNode = libSymbols[part.symbol];
		if (libNode) {
			includedNodes.push(libNode);
		} else {
			warnings.push(`missing library symbol ${part.symbol}`);
		}
	}
	return [sym("lib_symbols"), ...includedNodes];
}

function hasValidOffset(offset) {
	if (!offset) {
		return false;
	}
	return Number.isFinite(offset.dx) && Number.isFinite(offset.dy);
}

function resolvePinLabel(net, pin, ctx) {
	const part = ctx.partsById.get(pin.partId);
	const offset = ctx.pinOffsets[part.symbol]?.[pin.pin];
	if (!hasValidOffset(offset)) {
		ctx.warnings.push(`no pin offset for ${part.ref}.${pin.pin}`);
		return null;
	}
	const pos = ctx.positionsByPartId.get(pin.partId);
	const px = pos.x + offset.dx;
	const py = pos.y + offset.dy;
	const labelUuid = deterministicUuid(`${net.id}:${pin.partId}:${pin.pin}`);
	return [
		sym("global_label"),
		net.name,
		[sym("shape"), sym("passive")],
		[sym("at"), px, py, 0],
		[sym("uuid"), labelUuid],
	];
}

function buildLabels(nets, ctx) {
	const labels = [];
	for (const net of nets) {
		for (const pin of net.pins) {
			const label = resolvePinLabel(net, pin, ctx);
			if (label) {
				labels.push(label);
			}
		}
	}
	return labels;
}

function buildRootTree({ ir, libSymbolsNode, symbols, labels, title }) {
	const schTitle = title || ir.name;
	return [
		sym("kicad_sch"),
		[sym("version"), 20250114],
		[sym("generator"), "banana"],
		[sym("generator_version"), "0.1"],
		[sym("uuid"), deterministicUuid(ir.name)],
		[sym("paper"), "A4"],
		[sym("title_block"), [sym("title"), schTitle]],
		libSymbolsNode,
		...symbols,
		...labels,
		[sym("sheet_instances"), [sym("path"), "/", [sym("page"), "1"]]],
	];
}

export function irToKicadSch(
	ir,
	{ libSymbols = {}, pinOffsets = {}, title } = {},
) {
	const validation = validateCircuitIR(ir);
	if (!validation.ok) {
		throw new Error(`Invalid circuit IR:\n${validation.errors.join("\n")}`);
	}
	const warnings = [];
	const partsById = new Map();
	const positionsByPartId = new Map();
	const symbols = [];
	for (let i = 0; i < ir.parts.length; i++) {
		const part = ir.parts[i];
		const pos = computePartPosition(part, i);
		partsById.set(part.id, part);
		positionsByPartId.set(part.id, pos);
		symbols.push(buildSymbolNode(part, pos));
	}
	const libSymbolsNode = buildLibSymbols(ir.parts, libSymbols, warnings);
	const ctx = { partsById, positionsByPartId, pinOffsets, warnings };
	const labels = buildLabels(ir.nets, ctx);
	const root = buildRootTree({ ir, libSymbolsNode, symbols, labels, title });
	return { text: serialize(root), warnings };
}
