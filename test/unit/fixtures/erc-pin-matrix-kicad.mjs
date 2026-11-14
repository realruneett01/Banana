// Builds one schematic holding every unordered pair of the 12 ERC pin types
// (two one-pin symbols joined by a wire per pair), runs `kicad-cli sch erc`
// on it and records the pin_to_pin severity of each pair.
// Regenerate the recorded table: node test/unit/fixtures/erc-pin-matrix-kicad.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KICAD_CLI = "C:/Program Files/KiCad/10.0/bin/kicad-cli.exe";
export const TABLE_PATH = fileURLToPath(
	new URL("./erc-pin-matrix-kicad.json", import.meta.url),
);

export const TYPES = [
	"input",
	"output",
	"bidirectional",
	"tri_state",
	"passive",
	"free",
	"unspecified",
	"power_in",
	"power_out",
	"open_collector",
	"open_emitter",
	"no_connect",
];

const ROOT_UUID = "10000000-0000-0000-0000-000000000000";
const uuid = (n) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const font = "(effects (font (size 1.27 1.27)))";

function libSymbol(type) {
	const name = `P_${type}`;
	return `(symbol "T:${name}" (pin_names (offset 0)) (in_bom yes) (on_board yes)
	(property "Reference" "U" (at 0 2.54 0) ${font})
	(property "Value" "${name}" (at 0 -2.54 0) ${font})
	(symbol "${name}_1_1" (pin ${type} line (at 0 0 0) (length 2.54)
		(name "A" ${font}) (number "1" ${font}))))`;
}

function placed(type, ref, [x, y]) {
	return `(symbol (lib_id "T:P_${type}") (at ${x} ${y} 0) (unit 1)
	(in_bom yes) (on_board yes) (uuid "${uuid(ref.slice(1))}")
	(property "Reference" "${ref}" (at ${x} ${y - 2.54} 0) ${font})
	(property "Value" "P_${type}" (at ${x} ${y + 2.54} 0) ${font})
	(pin "1" (uuid "${uuid(1e6 + Number(ref.slice(1)))}"))
	(instances (project "m" (path "/${ROOT_UUID}" (reference "${ref}") (unit 1)))))`;
}

// Every unordered pair [a, b] (a <= b in TYPES order) with its two refs.
export function pairs() {
	return TYPES.flatMap((a, i) =>
		TYPES.slice(i).map((b, k) => {
			const n = 2 * (i * TYPES.length + i + k);
			return { a, b, refs: [`U${n + 1}`, `U${n + 2}`] };
		}),
	);
}

function pairItems({ a, b, refs }, index) {
	const x = 25.4 + (index % 6) * 30.48;
	const y = 25.4 + Math.floor(index / 6) * 12.7;
	const wire = `(wire (pts (xy ${x} ${y}) (xy ${x + 10.16} ${y})) (stroke (width 0) (type default)) (uuid "${uuid(2e6 + index)}"))`;
	return [placed(a, refs[0], [x, y]), placed(b, refs[1], [x + 10.16, y]), wire];
}

export function buildSchematic() {
	const libs = TYPES.map(libSymbol).join("\n");
	const body = pairs().flatMap(pairItems).join("\n");
	return `(kicad_sch (version 20250114) (generator "eeschema") (generator_version "10.0")
(uuid "${ROOT_UUID}") (paper "A2")
(lib_symbols
${libs})
${body}
(sheet_instances (path "/" (page "1"))))
`;
}

// pin_to_pin violations -> { "a|b": "error" | "warning" | "ok" } per pair.
export function tableFromReport(report) {
	const byRef = new Map();
	for (const v of report.sheets.flatMap((s) => s.violations)) {
		if (v.type !== "pin_to_pin") continue;
		const ref = v.items[0].description.match(/Symbol (U\d+)/)?.[1];
		byRef.set(ref, v.severity);
	}
	const table = {};
	for (const { a, b, refs } of pairs()) {
		table[`${a}|${b}`] = byRef.get(refs[0]) ?? byRef.get(refs[1]) ?? "ok";
	}
	return table;
}

export function runKicadMatrix(cli = KICAD_CLI) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erc-matrix-"));
	const sch = path.join(dir, "m.kicad_sch");
	const out = path.join(dir, "m.json");
	fs.writeFileSync(sch, buildSchematic());
	execFileSync(cli, ["sch", "erc", "--format", "json", "-o", out, sch]);
	const report = JSON.parse(fs.readFileSync(out, "utf8"));
	fs.rmSync(dir, { recursive: true, force: true });
	return tableFromReport(report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const table = runKicadMatrix();
	fs.writeFileSync(TABLE_PATH, `${JSON.stringify(table, null, "\t")}\n`);
	console.log(`wrote ${Object.keys(table).length} pairs to ${TABLE_PATH}`);
}
