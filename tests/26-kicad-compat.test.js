// KiCad version compatibility layer. KiCad 7 fixtures are REAL output captured from kicad-cli 7.0.11.
// The 8/9/10 inputs are SYNTHETIC (written from the documented argparse-style help format) and only exercise
// Banana's branching logic; they are not evidence that those versions were run. CI runs the real versions.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	capabilitiesFromHelp,
	clearCapabilityCache,
	describeCapabilities,
	fallbackCapabilities,
	getCapabilities,
	parseKicadVersion,
	parseOptions,
	parseSubcommands,
} from "../backend/src/kicad-compat.js";
import {
	buildRenderCommands,
	supportsModeMulti,
} from "../backend/src/kicad-renderer.js";
import { hasKicad } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const real = (n) =>
	fs.readFileSync(
		path.join(here, "fixtures", "kicad7-help", `${n}.txt`),
		"utf8",
	);
const REAL7 = {
	pcb: real("pcb"),
	sch: real("sch"),
	pcbExport: real("pcb-export"),
	schExport: real("sch-export"),
	pcbExportSvg: real("pcb-export-svg"),
	schExportSvg: real("sch-export-svg"),
};

const usage = (name, cmds) =>
	`Usage: ${name} [-h] {${cmds.join(",")}}\n\nOptional arguments:\n  -h, --help\tshows help message and exits \n\nSubcommands:\n${cmds.map((c) => `  ${c}     `).join("\n")}\n`;
const svgHelp = (extra = []) =>
	`Usage: svg [-h] [--output VAR] [--layers VAR] [--theme VAR] [--page-size-mode VAR] [--exclude-drawing-sheet] ${extra.join(" ")} input\n\nOptional arguments:\n  -o, --output\tOutput\n  -l, --layers\tLayers\n  -t, --theme\tTheme\n  --page-size-mode\tmode\n  --exclude-drawing-sheet\tno sheet\n${extra.map((e) => `  ${e}\tx`).join("\n")}\n`;
const SYNTHETIC8 = {
	pcb: usage("pcb", ["drc", "export"]),
	sch: usage("sch", ["erc", "export"]),
	pcbExport: usage("export", [
		"drill",
		"dxf",
		"gerber",
		"gerbers",
		"pdf",
		"pos",
		"step",
		"svg",
	]),
	schExport: usage("export", ["bom", "dxf", "netlist", "pdf", "svg"]),
	pcbExportSvg: svgHelp(), // KiCad 8.0.9 really has no --mode-multi (CI log of kicad/kicad:8.0)
};
const SYNTHETIC9 = {
	...SYNTHETIC8,
	pcb: usage("pcb", ["drc", "export", "render", "upgrade"]),
	sch: usage("sch", ["erc", "export", "upgrade"]),
	pcbExportSvg: svgHelp(["--mode-multi"]), // added in KiCad 9
};
const SYNTHETIC10 = {
	...SYNTHETIC9,
	pcb: usage("pcb", ["drc", "export", "render", "upgrade", "import"]),
};

test("version strings parse across formats", async (t) => {
	const cases = [
		["7.0.11", 7, 0, 11],
		["8.0.9", 8, 0, 9],
		["9.0.1", 9, 0, 1],
		["10.0.0", 10, 0, 0],
		["10.0.0-rc1", 10, 0, 0],
		[" 7.0.11 \n", 7, 0, 11],
		["(7.0.11)", 7, 0, 11],
		["9.99.0-1234-gabc", 9, 99, 0],
		["11.0.0", 11, 0, 0],
	];
	for (const [raw, major, minor, patch] of cases)
		await t.test(JSON.stringify(raw), () =>
			assert.deepEqual(
				[
					parseKicadVersion(raw).major,
					parseKicadVersion(raw).minor,
					parseKicadVersion(raw).patch,
				],
				[major, minor, patch],
			),
		);
	for (const bad of ["", "nightly", "abc", null, undefined])
		await t.test(`unparseable ${JSON.stringify(bad)}`, () =>
			assert.equal(parseKicadVersion(bad).major, 0),
		);
	assert.equal(parseKicadVersion("(nightly) 11.0").nightly, true);
});

test("help parsing: subcommands and options (real KiCad 7 text)", () => {
	assert.deepEqual(parseSubcommands(REAL7.pcb), ["export"]);
	assert.deepEqual(parseSubcommands(REAL7.pcbExport).sort(), [
		"drill",
		"dxf",
		"gerber",
		"gerbers",
		"pdf",
		"pos",
		"step",
		"svg",
	]);
	assert.deepEqual(parseSubcommands(REAL7.schExport).sort(), [
		"dxf",
		"hpgl",
		"netlist",
		"pdf",
		"ps",
		"python-bom",
		"svg",
	]);
	const opts = parseOptions(REAL7.pcbExportSvg);
	for (const o of [
		"--output",
		"--layers",
		"--theme",
		"--page-size-mode",
		"--exclude-drawing-sheet",
		"--mirror",
	])
		assert.ok(opts.includes(o), o);
	assert.ok(!opts.includes("--mode-multi"), "KiCad 7 has no --mode-multi");
});

test("help parsing tolerates garbage", async (t) => {
	for (const bad of [
		"",
		null,
		undefined,
		"no usage here",
		"Usage: x [-h]\n",
		"{",
		"Usage: {",
		"\u0000\u0001",
		"Usage: a {b,,c, }",
	])
		await t.test(JSON.stringify(bad), () => {
			assert.ok(Array.isArray(parseSubcommands(bad)));
			assert.ok(Array.isArray(parseOptions(bad)));
		});
	assert.deepEqual(parseSubcommands("Usage: a {b,,c, }").sort(), ["b", "c"]);
});

test("capabilities from the real KiCad 7 help: per-layer SVG, no CLI ERC/DRC/3D", () => {
	const c = capabilitiesFromHelp("7.0.11", REAL7);
	assert.equal(c.source, "probe");
	assert.deepEqual(
		[
			c.hasErc,
			c.hasDrc,
			c.hasRender3d,
			c.svg.multiMode,
			c.svg.pageSizeMode,
			c.svg.excludeDrawingSheet,
		],
		[false, false, false, false, true, true],
	);
	assert.ok(
		c.pcbExports.includes("gerbers") && c.schExports.includes("netlist"),
	);
	assert.ok(!c.schExports.includes("bom"), "KiCad 7 has python-bom only");
});

test("capabilities branch correctly for newer versions (synthetic help)", async (t) => {
	for (const [ver, help, multi, render] of [
		["8.0.4", SYNTHETIC8, false, false],
		["9.0.1", SYNTHETIC9, true, true],
		["10.0.0", SYNTHETIC10, true, true],
	]) {
		await t.test(`KiCad ${ver}`, () => {
			const c = capabilitiesFromHelp(ver, help);
			assert.equal(c.major, Number.parseInt(ver, 10));
			assert.deepEqual(
				[c.hasErc, c.hasDrc, c.svg.multiMode, c.hasRender3d],
				[true, true, multi, render],
			);
			assert.ok(c.schExports.includes("bom"));
			assert.match(describeCapabilities(c), new RegExp(`KiCad ${ver}`));
		});
	}
	await t.test("unparseable help -> null so callers fall back", () =>
		assert.equal(
			capabilitiesFromHelp("8.0.0", {
				pcb: "",
				sch: "",
				pcbExport: "",
				schExport: "",
				pcbExportSvg: "",
			}),
			null,
		),
	);
});

test("getCapabilities: probes once, remembers, falls back safely", async (t) => {
	clearCapabilityCache();
	const calls = [];
	const run = (cli, args) => {
		calls.push(args.join(" "));
		const key = {
			"pcb --help": "pcb",
			"sch --help": "sch",
			"pcb export --help": "pcbExport",
			"sch export --help": "schExport",
			"pcb export svg --help": "pcbExportSvg",
			"sch export svg --help": "schExportSvg",
		}[args.join(" ")];
		return SYNTHETIC9[key] ?? "";
	};
	await t.test("probe path", () => {
		const c = getCapabilities({
			cliPath: "/x/kicad-cli",
			version: "9.0.0",
			run,
		});
		assert.equal(c.source, "probe");
		assert.equal(c.hasRender3d, true);
		assert.equal(calls.length, 6);
	});
	await t.test("a failing kicad-cli falls back to the version table", () => {
		const c = getCapabilities({
			cliPath: "/x/kicad-cli",
			version: "8.0.0",
			run: () => "",
		});
		assert.equal(c.source, "table");
		assert.deepEqual(
			[c.hasErc, c.hasDrc, c.svg.multiMode],
			[true, true, false],
		);
	});
	await t.test("a throwing run is not fatal to the table fallback", () => {
		assert.throws(
			() =>
				getCapabilities({
					cliPath: "/x",
					version: "7.0.0",
					run: () => {
						throw new Error("boom");
					},
				}),
			/boom/,
		);
	});
	await t.test("no cli path -> table", () =>
		assert.equal(getCapabilities({ version: "7.0.11" }).source, "table"),
	);
});

test("fallback table by major version (unknown versions are treated as modern, as before)", async (t) => {
	const cases = [
		["7.0.11", false, false, false, false],
		["6.0.0", false, false, false, false],
		["8.0.0", true, true, false, false],
		["9.0.0", true, true, true, true],
		["10.0.0", true, true, true, true],
		["11.0.0", true, true, true, true],
		["(nightly)", true, true, true, false],
		["", true, true, true, false],
	];
	for (const [v, erc, drc, multi, render] of cases)
		await t.test(JSON.stringify(v), () => {
			const c = fallbackCapabilities(v);
			assert.deepEqual(
				[c.hasErc, c.hasDrc, c.svg.multiMode, c.hasRender3d],
				[erc, drc, multi, render],
			);
		});
});

test("renderer: SVG strategy follows capabilities, not just the version string", async (t) => {
	for (const v of ["7.0.11", "7.0.0", "6.0.0", "8.0.0", "8.0.9"])
		await t.test(`supportsModeMulti(${v}) is false`, () =>
			assert.equal(supportsModeMulti(v), false),
		);
	for (const v of ["9.0.1", "10.0.0", "11.0.0"])
		await t.test(`supportsModeMulti(${v}) is true`, () =>
			assert.equal(supportsModeMulti(v), true),
		);
	const args = { isPcb: true, filePath: "/r/b.kicad_pcb", outputDir: "/o" };
	await t.test("capabilities override a misleading version", () => {
		assert.equal(
			buildRenderCommands({
				...args,
				kicadVersion: "7.0.11",
				capabilities: { svg: { multiMode: true } },
			}).length,
			1,
		);
		assert.equal(
			buildRenderCommands({
				...args,
				kicadVersion: "9.0.0",
				capabilities: { svg: { multiMode: false } },
			}).length,
			7,
		);
	});
	await t.test("no capabilities -> version decides", () => {
		assert.equal(
			buildRenderCommands({ ...args, kicadVersion: "9.0.0" }).length,
			1,
		);
		assert.equal(
			buildRenderCommands({ ...args, kicadVersion: "7.0.11" }).length,
			7,
		);
	});
});

test("the installed kicad-cli probe agrees with its own version table", {
	skip: hasKicad() ? false : "kicad-cli not installed",
}, async () => {
	const { config } = await import("../backend/src/config.js");
	const probed = getCapabilities({
		cliPath: config.kicadCliPath,
		version: config.kicadVersion,
	});
	assert.equal(
		probed.source,
		"probe",
		"the real kicad-cli's help text must be parseable",
	);
	const table = fallbackCapabilities(config.kicadVersion);
	assert.equal(probed.hasErc, table.hasErc);
	assert.equal(probed.hasDrc, table.hasDrc);
	assert.equal(probed.svg.multiMode, table.svg.multiMode);
	assert.equal(probed.hasRender3d, table.hasRender3d);
	for (const e of ["svg", "gerbers", "drill", "pos", "step"])
		assert.ok(probed.pcbExports.includes(e), `pcb export ${e}`);
});
