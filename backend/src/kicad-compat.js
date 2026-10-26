/**
 * KiCad version compatibility.
 *
 * Banana supports KiCad 7 and newer. Instead of trusting a hard-coded table of what each release can do,
 * the installed `kicad-cli` is probed once (its own `--help` output lists its commands and options), and
 * the result drives every version-dependent decision. A conservative table keyed by major version is only
 * the fallback when probing fails.
 */
import { execFileSync } from "node:child_process";

export function parseKicadVersion(raw) {
	const text = String(raw ?? "").trim();
	const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text);
	if (!m)
		return {
			raw: text,
			major: 0,
			minor: 0,
			patch: 0,
			nightly: /nightly/i.test(text),
		};
	return {
		raw: text,
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3] ?? 0),
		nightly: /nightly|\b\d+\.99\b/i.test(text),
	};
}

/** `Usage: export [-h] {drill,dxf,gerber}` -> ["drill","dxf","gerber"]; also reads a "Subcommands:" list. */
export function parseSubcommands(help) {
	const out = new Set();
	const brace = /^Usage:.*\{([^}]*)\}/m.exec(help ?? "");
	if (brace)
		for (const c of brace[1].split(",")) if (c.trim()) out.add(c.trim());
	const block = /Subcommands:\s*\n((?:[ \t]+\S.*\n?)+)/.exec(help ?? "");
	if (block)
		for (const line of block[1].split("\n")) {
			const t = /^[ \t]+([A-Za-z][\w-]*)/.exec(line);
			if (t) out.add(t[1]);
		}
	return [...out];
}

/** All long options mentioned in a help text: ["--output","--layers",...]. */
export function parseOptions(help) {
	return [
		...new Set(
			[...(help ?? "").matchAll(/(?:^|[\s,])(--[a-z][a-z0-9-]*)/gim)].map((m) =>
				m[1].toLowerCase(),
			),
		),
	];
}

/** Conservative defaults by major version, used only when probing is impossible. */
export function fallbackCapabilities(version) {
	const v = typeof version === "object" ? version : parseKicadVersion(version);
	// Unknown or nightly versions (major 0) are treated as modern, as Banana always has.
	const modern = v.major >= 8 || v.major === 0;
	return {
		source: "table",
		major: v.major,
		version: v.raw,
		pcbCommands: modern ? ["export", "drc"] : ["export"],
		schCommands: modern ? ["export", "erc"] : ["export"],
		pcbExports: modern
			? ["drill", "dxf", "gerber", "gerbers", "pdf", "pos", "step", "svg"]
			: ["drill", "dxf", "gerber", "gerbers", "pdf", "pos", "step", "svg"],
		schExports: modern
			? ["bom", "dxf", "hpgl", "netlist", "pdf", "ps", "python-bom", "svg"]
			: ["dxf", "hpgl", "netlist", "pdf", "ps", "python-bom", "svg"],
		svg: {
			multiMode: modern,
			pageSizeMode: true,
			excludeDrawingSheet: true,
			theme: true,
		},
		hasErc: modern,
		hasDrc: modern,
		hasRender3d: v.major >= 9,
	};
}

/** Builds the capability object from the text of the probed `--help` outputs. */
export function capabilitiesFromHelp(version, help) {
	const v = typeof version === "object" ? version : parseKicadVersion(version);
	const pcbCommands = parseSubcommands(help.pcb);
	const schCommands = parseSubcommands(help.sch);
	const pcbExports = parseSubcommands(help.pcbExport);
	const schExports = parseSubcommands(help.schExport);
	if (
		pcbCommands.length === 0 ||
		pcbExports.length === 0 ||
		schCommands.length === 0
	)
		return null; // unparseable: caller falls back
	const svgOpts = parseOptions(help.pcbExportSvg);
	const schSvgOpts = parseOptions(help.schExportSvg);
	return {
		source: "probe",
		major: v.major,
		version: v.raw,
		pcbCommands,
		schCommands,
		pcbExports,
		schExports,
		svg: {
			multiMode: svgOpts.includes("--mode-multi"),
			pageSizeMode: svgOpts.includes("--page-size-mode"),
			excludeDrawingSheet: svgOpts.includes("--exclude-drawing-sheet"),
			theme: svgOpts.includes("--theme"),
		},
		schSvg: {
			excludeDrawingSheet: schSvgOpts.includes("--exclude-drawing-sheet"),
			theme: schSvgOpts.includes("--theme"),
			blackAndWhite: schSvgOpts.includes("--black-and-white"),
		},
		hasErc: schCommands.includes("erc"),
		hasDrc: pcbCommands.includes("drc"),
		hasRender3d: pcbCommands.includes("render"),
	};
}

const PROBES = [
	["pcb", ["pcb", "--help"]],
	["sch", ["sch", "--help"]],
	["pcbExport", ["pcb", "export", "--help"]],
	["schExport", ["sch", "export", "--help"]],
	["pcbExportSvg", ["pcb", "export", "svg", "--help"]],
	["schExportSvg", ["sch", "export", "svg", "--help"]],
];

function defaultRun(cliPath, args) {
	try {
		return execFileSync(cliPath, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 20000,
		});
	} catch (err) {
		// argparse-style tools print help to stdout/stderr and may exit non-zero; keep whatever text we got
		return `${err.stdout ?? ""}${err.stderr ?? ""}`;
	}
}

const cache = new Map();

/**
 * Capabilities of the installed kicad-cli (probed once per path+version and remembered).
 * `run(cliPath, args)` can be injected for tests.
 */
export function getCapabilities({ cliPath, version, run = defaultRun } = {}) {
	const v = parseKicadVersion(version);
	if (!cliPath) return fallbackCapabilities(v);
	const key = `${cliPath}|${v.raw}`;
	if (cache.has(key) && run === defaultRun) return cache.get(key);
	const help = {};
	for (const [name, args] of PROBES) help[name] = run(cliPath, args);
	const caps = capabilitiesFromHelp(v, help) ?? fallbackCapabilities(v);
	if (run === defaultRun) cache.set(key, caps);
	return caps;
}

export function clearCapabilityCache() {
	cache.clear();
}

export function describeCapabilities(c) {
	const parts = [
		c.hasDrc ? "DRC" : "no CLI DRC",
		c.hasErc ? "ERC" : "no CLI ERC",
		c.svg.multiMode ? "multi-layer SVG" : "per-layer SVG",
		c.hasRender3d ? "3D render" : "no 3D render",
	];
	return `KiCad ${c.version || c.major} (${c.source}): ${parts.join(", ")}`;
}
