import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { config } from "../config.js";
import { getCapabilities } from "../kicad-compat.js";
import { DesignError } from "./model.js";
import * as P from "./project.js";

const run = promisify(execFile);

const FAB_LAYERS = [
	"F.Cu",
	"B.Cu",
	"F.Paste",
	"B.Paste",
	"F.SilkS",
	"B.SilkS",
	"F.Mask",
	"B.Mask",
	"Edge.Cuts",
];

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const csvCell = (v) => {
	const s = String(v ?? "");
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---- a small ZIP writer (stored+deflated entries, no dependencies) ----
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
export function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data: Buffer }] -> Buffer of a valid .zip */
export function createZip(entries) {
	const chunks = [];
	const central = [];
	let offset = 0;
	const stamp = new Date(Date.UTC(2020, 0, 1, 0, 0, 0)); // fixed: identical input gives identical archives
	const dosTime = 0;
	const dosDate =
		((stamp.getUTCFullYear() - 1980) << 9) |
		((stamp.getUTCMonth() + 1) << 5) |
		stamp.getUTCDate();
	for (const { name, data } of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const deflated = zlib.deflateRawSync(data);
		const useDeflate = deflated.length < data.length;
		const body = useDeflate ? deflated : data;
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(useDeflate ? 8 : 0, 8);
		local.writeUInt16LE(dosTime, 10);
		local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		chunks.push(local, nameBuf, body);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE(20, 4);
		cd.writeUInt16LE(20, 6);
		cd.writeUInt16LE(0x0800, 8);
		cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
		cd.writeUInt16LE(dosTime, 12);
		cd.writeUInt16LE(dosDate, 14);
		cd.writeUInt32LE(crc, 16);
		cd.writeUInt32LE(body.length, 20);
		cd.writeUInt32LE(data.length, 24);
		cd.writeUInt16LE(nameBuf.length, 28);
		cd.writeUInt32LE(offset, 42);
		central.push(cd, nameBuf);
		offset += local.length + nameBuf.length + body.length;
	}
	const cdSize = central.reduce((s, b) => s + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(cdSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, ...central, end]);
}

/** Bill of materials straight from the design: identical parts grouped, references in natural order. */
export function bomRows(design) {
	const groups = new Map();
	for (const p of design.data.parts) {
		const key = `${p.value}\u0000${p.footprint ?? ""}\u0000${p.symbol}`;
		if (!groups.has(key))
			groups.set(key, {
				value: p.value,
				footprint: p.footprint ?? "",
				symbol: p.symbol,
				refs: [],
			});
		groups.get(key).refs.push(p.ref);
	}
	return [...groups.values()]
		.map((g) => ({ ...g, refs: g.refs.sort(natural) }))
		.sort((a, b) => natural(a.refs[0], b.refs[0]));
}

export function bomCsv(design) {
	const lines = [
		["Reference", "Quantity", "Value", "Footprint", "Symbol"].join(","),
	];
	for (const g of bomRows(design))
		lines.push(
			[g.refs.join(" "), g.refs.length, g.value, g.footprint, g.symbol]
				.map(csvCell)
				.join(","),
		);
	return `${lines.join("\n")}\n`;
}

/** Which exports this KiCad can do, from its own help output (see kicad-compat). */
export function exportKinds(capabilities) {
	const pcb = new Set(capabilities?.pcbExports ?? []);
	const sch = new Set(capabilities?.schExports ?? []);
	const has = (set, ...names) => names.every((n) => set.has(n));
	const gerberCmd = pcb.has("gerbers")
		? "gerbers"
		: pcb.has("gerber")
			? "gerber"
			: null;
	return {
		gerbers: {
			label: "Gerbers + drill files (zip)",
			available: Boolean(gerberCmd) && has(pcb, "drill"),
			reason:
				"Needs kicad-cli with `pcb export gerbers` and `pcb export drill`.",
		},
		bom: { label: "Bill of materials (CSV)", available: true },
		pos: {
			label: "Pick-and-place positions (CSV)",
			available: has(pcb, "pos"),
			reason: "Needs `pcb export pos`.",
		},
		netlist: {
			label: "Netlist (KiCad)",
			available: has(sch, "netlist"),
			reason: "Needs `sch export netlist`.",
		},
		pdf: {
			label: "Board and schematic PDF",
			available: has(pcb, "pdf") && has(sch, "pdf"),
			reason: "Needs `pcb export pdf` and `sch export pdf`.",
		},
		step: {
			label:
				"Board STEP (outline only: library 3D models are not attached yet)",
			available: has(pcb, "step"),
			reason: "Needs `pcb export step`.",
		},
	};
}

const exportsDir = (name) =>
	path.join(P.projectDir(name), "results", "exports");
const SAFE_FILE = /^[A-Za-z0-9._-]{1,120}$/;

async function kicad(args) {
	if (!config.kicadCliPath)
		throw new DesignError(config.kicadError || "kicad-cli is not available");
	try {
		return await run(config.kicadCliPath, args, {
			timeout: 120_000,
			maxBuffer: 16 * 1024 * 1024,
		});
	} catch (err) {
		throw new DesignError(
			`KiCad could not create the export: ${String(err.stderr || err.message)
				.split("\n")
				.filter(Boolean)
				.slice(-3)
				.join(" ")}`,
		);
	}
}

const listDir = (dir) =>
	fs
		.readdirSync(dir)
		.sort(natural)
		.map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size }));

/**
 * Writes the project's KiCad files (no commit) and runs one export into results/exports/<kind>/.
 * Returns the files created; `download` is the file a user should take (the zip for fabrication output).
 */
export async function runExport(name, kind) {
	const caps = getCapabilities({
		cliPath: config.kicadCliPath,
		version: config.kicadVersion,
	});
	const kinds = exportKinds(caps);
	if (!kinds[kind])
		throw new DesignError(
			`Unknown export "${kind}" (use ${Object.keys(kinds).join(", ")})`,
		);
	if (!kinds[kind].available)
		throw new DesignError(
			`Not available with this KiCad: ${kinds[kind].reason}`,
		);
	return P.withLock(name, async () => {
		const design = P.loadDesign(name);
		if (!design.data.parts.length)
			throw new DesignError("The design has no parts yet.");
		await P.build(name, "", { commit: false });
		const dir = P.projectDir(name);
		const pcb = path.join(dir, `${name}.kicad_pcb`);
		const sch = path.join(dir, `${name}.kicad_sch`);
		const out = path.join(exportsDir(name), kind);
		fs.rmSync(out, { recursive: true, force: true });
		fs.mkdirSync(out, { recursive: true });
		let download = null;
		if (kind === "bom") {
			download = `${name}-bom.csv`;
			fs.writeFileSync(path.join(out, download), bomCsv(design));
		} else if (kind === "pos") {
			download = `${name}-positions.csv`;
			await kicad([
				"pcb",
				"export",
				"pos",
				"--format",
				"csv",
				"--units",
				"mm",
				"--side",
				"both",
				"-o",
				path.join(out, download),
				pcb,
			]);
		} else if (kind === "netlist") {
			download = `${name}.net`;
			await kicad([
				"sch",
				"export",
				"netlist",
				"--format",
				"kicadsexpr",
				"-o",
				path.join(out, download),
				sch,
			]);
		} else if (kind === "pdf") {
			await kicad([
				"pcb",
				"export",
				"pdf",
				"--layers",
				["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts"].join(","),
				"-o",
				path.join(out, `${name}-board.pdf`),
				pcb,
			]);
			await kicad([
				"sch",
				"export",
				"pdf",
				"-o",
				path.join(out, `${name}-schematic.pdf`),
				sch,
			]);
			download = `${name}-board.pdf`;
		} else if (kind === "step") {
			download = `${name}-board.step`;
			await kicad([
				"pcb",
				"export",
				"step",
				"--board-only",
				"--force",
				"-o",
				path.join(out, download),
				pcb,
			]);
		} else if (kind === "gerbers") {
			const work = path.join(out, "gerbers");
			fs.mkdirSync(work, { recursive: true });
			const cmd = caps.pcbExports.includes("gerbers") ? "gerbers" : "gerber";
			await kicad([
				"pcb",
				"export",
				cmd,
				"--layers",
				FAB_LAYERS.join(","),
				"-o",
				`${work}${path.sep}`,
				pcb,
			]);
			await kicad(["pcb", "export", "drill", "-o", `${work}${path.sep}`, pcb]);
			const files = fs.readdirSync(work).sort(natural);
			if (!files.length)
				throw new DesignError("KiCad produced no Gerber files");
			download = `${name}-fabrication.zip`;
			fs.writeFileSync(
				path.join(out, download),
				createZip(
					files.map((f) => ({
						name: f,
						data: fs.readFileSync(path.join(work, f)),
					})),
				),
			);
			fs.rmSync(work, { recursive: true, force: true });
		}
		return {
			kind,
			label: kinds[kind].label,
			files: listDir(out),
			download,
			directory: out,
		};
	});
}

/** Absolute path of one produced file, only for names that exist in that export's folder. */
export function exportFile(name, kind, file) {
	if (!SAFE_FILE.test(String(file))) throw new DesignError("Invalid file name");
	if (!/^[a-z]+$/.test(String(kind)))
		throw new DesignError("Invalid export kind");
	const full = path.join(exportsDir(name), kind, file);
	if (!fs.existsSync(full) || !fs.statSync(full).isFile())
		throw new DesignError(
			"That file has not been exported (run the export first).",
		);
	return full;
}
