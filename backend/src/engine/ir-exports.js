const FORMULA_START_RE = /^[=+\-@]/;
const BOM_CSV_HEADER = "Reference,Qty,Value,Footprint,Symbol";

function compareNatural(a, b) {
	return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
		numeric: true,
	});
}

function bomPartKey(part) {
	const val = part.value ?? "";
	const fp = part.footprint ?? "";
	const sym = part.symbol ?? "";
	return `${val}\0${fp}\0${sym}`;
}

function collectBomGroups(parts) {
	const groups = new Map();
	for (const part of parts) {
		const key = bomPartKey(part);
		let group = groups.get(key);
		if (!group) {
			group = {
				refs: [],
				value: part.value ?? "",
				footprint: part.footprint ?? "",
				symbol: part.symbol ?? "",
			};
			groups.set(key, group);
		}
		group.refs.push(String(part.ref ?? ""));
	}
	return groups;
}

function finalizeBomRow(group) {
	const refs = group.refs.slice().sort(compareNatural);
	return {
		refs,
		qty: refs.length,
		value: group.value,
		footprint: group.footprint,
		symbol: group.symbol,
	};
}

export function irToBomRows(ir) {
	const parts = ir?.parts ?? [];
	const groups = collectBomGroups(parts);
	const rows = Array.from(groups.values()).map(finalizeBomRow);
	return rows.sort((a, b) => compareNatural(a.refs[0], b.refs[0]));
}

function formatCsvField(val) {
	let s = String(val ?? "");
	if (FORMULA_START_RE.test(s)) {
		s = `'${s}`;
	}
	return `"${s.replaceAll('"', '""')}"`;
}

function formatBomCsvRow(row) {
	const fields = [
		row.refs.join(" "),
		row.qty,
		row.value,
		row.footprint,
		row.symbol,
	];
	return fields.map(formatCsvField).join(",");
}

export function irToBomCsv(ir) {
	const rows = irToBomRows(ir);
	const lines = [BOM_CSV_HEADER];
	for (const row of rows) {
		lines.push(formatBomCsvRow(row));
	}
	return `${lines.join("\r\n")}\r\n`;
}

function escapeSexpr(val) {
	return String(val ?? "")
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"');
}

function parseSymbol(symbol) {
	const sym = String(symbol ?? "");
	const idx = sym.indexOf(":");
	if (idx === -1) {
		return { lib: "", part: sym };
	}
	return { lib: sym.slice(0, idx), part: sym.slice(idx + 1) };
}

function formatComponent(part, isLast) {
	const { lib, part: symName } = parseSymbol(part.symbol);
	const ref = escapeSexpr(part.ref);
	const val = escapeSexpr(part.value);
	const fp = escapeSexpr(part.footprint);
	const libEsc = escapeSexpr(lib);
	const partEsc = escapeSexpr(symName);
	const trail = isLast ? "))))" : ")))";
	return `    (comp (ref "${ref}") (value "${val}") (footprint "${fp}") (libsource (lib "${libEsc}") (part "${partEsc}")${trail}`;
}

function buildComponentLines(parts) {
	if (parts.length === 0) {
		return ["  (components)"];
	}
	const sorted = parts.slice().sort((a, b) => compareNatural(a.ref, b.ref));
	const lines = ["  (components"];
	for (let i = 0; i < sorted.length; i++) {
		const isLast = i === sorted.length - 1;
		lines.push(formatComponent(sorted[i], isLast));
	}
	return lines;
}

function compareNodes(a, b) {
	return compareNatural(a.ref, b.ref) || compareNatural(a.pin, b.pin);
}

function buildNetNodes(net, partMap) {
	const valid = [];
	for (const p of net.pins ?? []) {
		const ref = partMap.get(p.partId);
		if (ref !== undefined) {
			valid.push({ ref, pin: String(p.pin ?? "") });
		}
	}
	return valid.sort(compareNodes);
}

function formatNet(netSpec, isLast) {
	const { code, name, nodes } = netSpec;
	const codeEsc = escapeSexpr(code);
	const nameEsc = escapeSexpr(name);
	const nodeParts = nodes.map(
		(n) => `(node (ref "${escapeSexpr(n.ref)}") (pin "${escapeSexpr(n.pin)}"))`,
	);
	const nodesSuffix = nodeParts.length > 0 ? ` ${nodeParts.join(" ")}` : "";
	const trail = isLast ? ")))" : ")";
	return `    (net (code "${codeEsc}") (name "${nameEsc}")${nodesSuffix}${trail}`;
}

function buildNetLines(nets, partMap) {
	if (nets.length === 0) {
		return ["  (nets))"];
	}
	const sorted = nets.slice().sort((a, b) => compareNatural(a.name, b.name));
	const lines = ["  (nets"];
	for (let i = 0; i < sorted.length; i++) {
		const code = String(i + 1);
		const rawName = sorted[i].name ?? "";
		const name = rawName === "" ? `/N-${code}` : rawName;
		const nodes = buildNetNodes(sorted[i], partMap);
		const isLast = i === sorted.length - 1;
		lines.push(formatNet({ code, name, nodes }, isLast));
	}
	return lines;
}

export function irToKicadNetlist(ir) {
	const sourceName = escapeSexpr(ir?.name ?? "");
	const parts = ir?.parts ?? [];
	const nets = ir?.nets ?? [];
	const partMap = new Map(parts.map((p) => [p.id, p.ref]));

	const lines = [
		'(export (version "E")',
		`  (design (source "${sourceName}") (tool "Banana"))`,
		...buildComponentLines(parts),
		...buildNetLines(nets, partMap),
	];
	return `${lines.join("\n")}\n`;
}
