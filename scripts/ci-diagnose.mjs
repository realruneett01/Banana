// Prints what this KiCad actually does with a small generated board: used by CI when tests fail on a
// KiCad version that cannot be run locally. Output is plain text and bounded.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BANANA_PROJECTS_DIR = fs.mkdtempSync(
	path.join(os.tmpdir(), "banana-diag-"),
);
const { config } = await import("../backend/src/config.js");
const { getCapabilities, describeCapabilities } = await import(
	"../backend/src/kicad-compat.js"
);
const { buildRenderCommands } = await import(
	"../backend/src/kicad-renderer.js"
);
const P = await import("../backend/src/design/project.js");

const section = (t) => console.log(`\n===== ${t}`);
const cli = (...args) => {
	try {
		return execFileSync(config.kicadCliPath, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 60000,
		});
	} catch (e) {
		return `FAILED: ${(e.stdout ?? "") + (e.stderr ?? "") || e.message}`;
	}
};

section("version and capabilities");
console.log(config.kicadVersion, config.kicadCliPath);
console.log(
	describeCapabilities(
		getCapabilities({
			cliPath: config.kicadCliPath,
			version: config.kicadVersion,
		}),
	),
);
section("pcb export svg --help");
console.log(
	cli("pcb", "export", "svg", "--help").split("\n").slice(0, 40).join("\n"),
);
section("pcb --help / export --help");
console.log(cli("pcb", "--help").split("\n").slice(0, 25).join("\n"));
console.log(cli("pcb", "export", "--help").split("\n").slice(0, 25).join("\n"));

const R = "Resistor_SMD:R_0805_2012Metric";
await P.createProject("diag");
const d = P.loadDesign("diag");
for (const [i, v] of ["1k", "2k"].entries())
	d.addPart({
		symbol: "Device:R",
		value: v,
		footprint: R,
		at: { x: 30 + i * 10, y: 30 },
	});
d.connect("A", ["R1.2", "R2.1"]);
d.connect("B", ["R1.1", "R2.2"]);
d.setBoard(40, 30);
P.saveDesign("diag", d);
const v1 = (await P.build("diag", "v1")).commit;
d.place("R1", 30, 40, 0);
P.saveDesign("diag", d);
const v2 = (await P.build("diag", "v2")).commit;

section("render commands the app uses");
const caps = getCapabilities({
	cliPath: config.kicadCliPath,
	version: config.kicadVersion,
});
console.log(
	JSON.stringify(
		buildRenderCommands({
			isPcb: true,
			filePath: "/x/diag.kicad_pcb",
			outputDir: "/x/out",
			kicadVersion: config.kicadVersion,
			capabilities: caps,
		}).slice(0, 2),
	),
);

section("diff payload");
try {
	const diff = await P.diffBuilds("diag", { base: v1, target: v2 });
	console.log(
		"modifications:",
		JSON.stringify(
			diff.modifications.map((m) => [m.action, m.type, m.title, m.refDes]),
		),
	);
	console.log(
		"layers processed:",
		diff.telemetry?.layersProcessed,
		"ms",
		Math.round(diff.telemetry?.tTotal ?? 0),
	);
	const files = [...(diff.target?.svgs ?? [])];
	console.log(
		"target layers:",
		files.map((s) => `${s.filename}(${s.content.length})`).join(", "),
	);
	const count = (svgs, k) =>
		(svgs ?? []).reduce(
			(n, s) => n + (s.content.match(new RegExp(k, "g")) ?? []).length,
			0,
		);
	for (const side of ["base", "target"]) {
		const svgs = diff.sideBySide?.[side];
		console.log(
			side,
			Object.fromEntries(
				[
					"diff-changed",
					"diff-added",
					"diff-deleted",
					"diff-unchanged",
					"FACC15",
					"22C55E",
					"EF4444",
				].map((k) => [k, count(svgs, k)]),
			),
		);
	}
	const f = files.find((s) => /F_Cu/.test(s.filename)) ?? files[0];
	if (f) {
		console.log("first 700 chars of", f.filename);
		console.log(f.content.slice(0, 700));
		const pads = f.content
			.split("\n")
			.filter((l) => /<(path|rect|circle)\b/.test(l));
		console.log("element lines:", pads.length, "sample:");
		console.log(pads.slice(0, 4).join("\n").slice(0, 1500));
	}
} catch (e) {
	console.log("diff failed:", e.stack ?? e.message);
}

section("netlist of a design with power nets");
try {
	await P.createProject("pwr");
	const p = P.loadDesign("pwr");
	const H = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical";
	p.addPart({
		symbol: "Connector_Generic:Conn_01x02",
		value: "J",
		footprint: H,
	});
	p.addPart({ symbol: "Device:R", value: "1k", footprint: R });
	p.connect("+5V", ["J1.1", "R1.1"]);
	p.connect("GND", ["J1.2", "R1.2"]);
	p.setNetFlags("+5V", { external: true });
	p.setNetFlags("GND", { external: true });
	P.saveDesign("pwr", p);
	await P.build("pwr", "pwr");
	const dir = P.projectDir("pwr");
	const sch = fs.readFileSync(path.join(dir, "pwr.kicad_sch"), "utf8");
	console.log("power symbol instances in the schematic:");
	const lines = sch.split("\n");
	console.log(
		lines
			.filter((l) => /lib_id "power:/.test(l))
			.slice(0, 6)
			.join("\n"),
	);
	console.log(
		lines
			.filter((l) => /^\s*\(wire /.test(l))
			.slice(0, 3)
			.join("\n"),
	);
	const lib = sch.slice(
		sch.indexOf('(symbol "power:GND"'),
		sch.indexOf('(symbol "power:GND"') + 420,
	);
	console.log("embedded power:GND begins:", lib);
	const net = path.join(dir, "pwr.net");
	console.log(
		cli(
			"sch",
			"export",
			"netlist",
			"--format",
			"kicadsexpr",
			"-o",
			net,
			path.join(dir, "pwr.kicad_sch"),
		).slice(0, 300),
	);
	const text = fs.readFileSync(net, "utf8");
	const nets = text.slice(text.indexOf("(nets"));
	console.log(nets.slice(0, 1800));
} catch (e) {
	console.log("netlist diagnostic failed:", e.stack ?? e.message);
}
