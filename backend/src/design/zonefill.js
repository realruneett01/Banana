import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { findPython } from "./checks.js";
import { childLists } from "./sexp.js";

const run = promisify(execFile);

const FILL_PY = `
import sys, pcbnew
board = pcbnew.LoadBoard(sys.argv[1])
filler = pcbnew.ZONE_FILLER(board)
filler.Fill(board.Zones())
pcbnew.SaveBoard(sys.argv[2], board)
`;

/** (filled_polygon ...) blocks per zone ("net|layer") from a board file KiCad saved after filling. */
export function extractFills(text) {
	const root = text.indexOf("(");
	const fills = new Map();
	for (const zone of childLists(text, root).filter((c) => c.head === "zone")) {
		const body = text.slice(zone.start, zone.end + 1);
		// KiCad up to 9 writes `(net 1) (net_name "GND")`; newer files may name the net directly: `(net "GND")`.
		// A zone on one layer is `(layer "X")`, newer files write `(layers "X")`.
		const net = (/\(net_name\s+"((?:[^"\\]|\\.)*)"\)/.exec(body) ??
			/\(net\s+"((?:[^"\\]|\\.)*)"\)/.exec(body))?.[1];
		const layer = /\(layers?\s+"((?:[^"\\]|\\.)*)"/.exec(body)?.[1];
		if (net === undefined || !layer) continue;
		const blocks = childLists(text, zone.start, zone.end)
			.filter((c) => c.head === "filled_polygon")
			.map((c) =>
				text
					.slice(c.start, c.end + 1)
					.replace(/\s+/g, " ")
					.replace(/\( /g, "(")
					.replace(/ \)/g, ")"),
			);
		if (blocks.length) fills.set(`${net}|${layer}`, blocks.join(" "));
	}
	return fills;
}

let refillProbe = null;
/** Whether this kicad-cli can refill zones itself (`pcb drc --refill-zones --save-board`, KiCad 10 and newer). */
export function cliCanRefillZones(cliPath = config.kicadCliPath) {
	if (!cliPath) return false;
	if (refillProbe?.cliPath === cliPath) return refillProbe.ok;
	let ok = false;
	try {
		const help = String(
			execFileSync(cliPath, ["pcb", "drc", "--help"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 30000,
			}),
		);
		ok = /--refill-zones/.test(help) && /--save-board/.test(help);
	} catch (e) {
		ok =
			/--refill-zones/.test(String(e.stdout ?? "")) &&
			/--save-board/.test(String(e.stdout ?? ""));
	}
	refillProbe = { cliPath, ok };
	return ok;
}

const cacheDir = () => path.join(config.tempRoot, "cache", "zonefill");

/**
 * Asks KiCad (pcbnew's own zone filler) to fill every pour in `boardText`. Results are cached by content and
 * KiCad version. When no pcbnew Python is available the pours stay unfilled: still valid files, KiCad fills them
 * itself on open, but Banana cannot draw or check the copper.
 */
export async function fillZones(boardText, { python, cli = true } = {}) {
	const key = crypto
		.createHash("sha256")
		.update(`${boardText}\u0000${config.kicadVersion}`)
		.digest("hex");
	const cached = path.join(cacheDir(), `${key}.json`);
	try {
		return {
			status: "ok",
			fills: new Map(JSON.parse(fs.readFileSync(cached, "utf8"))),
			cached: true,
		};
	} catch {
		/* not cached */
	}
	const py = python === undefined ? findPython() : python;
	const viaCli = !py && cli && cliCanRefillZones();
	if (!py && !viaCli)
		return {
			status: "unavailable",
			reason:
				"KiCad's pcbnew Python module was not found, so copper pours cannot be filled here.",
			fills: new Map(),
		};
	const work = fs.mkdtempSync(path.join(config.tempRoot, "zonefill-"));
	try {
		const input = path.join(work, "in.kicad_pcb");
		const output = path.join(work, "out.kicad_pcb");
		fs.writeFileSync(input, boardText);
		let saved = output;
		if (py) {
			await run(py, ["-c", FILL_PY, input, output], {
				timeout: 120_000,
				maxBuffer: 16 * 1024 * 1024,
			});
		} else {
			// kicad-cli refills and saves the board in place; the report itself is not needed
			await run(
				config.kicadCliPath,
				[
					"pcb",
					"drc",
					"--refill-zones",
					"--save-board",
					"--output",
					path.join(work, "drc.rpt"),
					input,
				],
				{ timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
			);
			saved = input;
		}
		const fills = extractFills(fs.readFileSync(saved, "utf8"));
		fs.mkdirSync(cacheDir(), { recursive: true });
		fs.writeFileSync(
			`${cached}.${process.pid}.tmp`,
			JSON.stringify([...fills]),
		);
		fs.renameSync(`${cached}.${process.pid}.tmp`, cached);
		return { status: "ok", fills, cached: false };
	} catch (err) {
		return {
			status: "error",
			reason: `Filling the copper pours failed: ${String(
				err.stderr || err.message,
			)
				.split("\n")
				.filter(Boolean)
				.slice(-2)
				.join(" ")}`,
			fills: new Map(),
		};
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}
