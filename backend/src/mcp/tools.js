import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { renderKicadFile } from "../kicad-renderer.js";
import {
	getFootprint,
	getSymbol,
	searchFootprints,
	searchSymbols,
} from "../design/kicad-lib.js";
import { Design, DesignError } from "../design/model.js";
import { DFM_PROFILES, dfmReport } from "../design/dfm.js";
import { runExport } from "../design/exports.js";
import * as P from "../design/project.js";
import { ngspiceAvailable } from "../design/simulate.js";
import { validate } from "./schema.js";

const str = (extra = {}) => ({ type: "string", ...extra });
const project = {
	type: "string",
	pattern: "^[a-z0-9][a-z0-9_-]{0,47}$",
	description: "Project name (lowercase letters, digits, dash, underscore)",
};
const pin = {
	type: "string",
	description:
		'Pin as "REF.PIN" where PIN is a pin number or a unique pin name, e.g. "R1.2" or "U1.VOUT"',
};

const simSchema = {
	type: "object",
	description:
		"How the part is modelled in simulation. Passives, LEDs, diodes and BJTs are automatic. Use ldo for a linear regulator, subckt for a custom SPICE model, or exclude to leave the part out.",
	properties: {
		exclude: { type: "boolean" },
		ldo: {
			type: "object",
			properties: {
				in: str(),
				gnd: str(),
				out: str(),
				vout: { type: "number" },
				dropout: { type: "number" },
			},
			required: ["in", "gnd", "out", "vout"],
			additionalProperties: false,
		},
		subckt: {
			type: "object",
			properties: {
				name: str(),
				pins: { type: "array", items: str(), maxItems: 40 },
				text: str({ maxLength: 20000 }),
			},
			required: ["name", "pins", "text"],
			additionalProperties: false,
		},
		diode: { type: "string", enum: ["led", "schottky", "switching"] },
	},
	additionalProperties: false,
};

const testSchema = {
	type: "object",
	description:
		"A simulation test: sources, loads, an analysis and expectations the result must meet.",
	properties: {
		name: str({ pattern: "^[\\w .-]{1,60}$" }),
		analysis: {
			type: "object",
			properties: {
				type: { enum: ["op", "tran", "ac"] },
				step: { type: ["string", "number"] },
				stop: { type: ["string", "number"] },
				start: { type: ["string", "number"] },
				pointsPerDecade: { type: "integer", minimum: 1, maximum: 200 },
			},
			required: ["type"],
			additionalProperties: false,
		},
		sources: {
			type: "array",
			maxItems: 20,
			items: {
				type: "object",
				properties: {
					name: str(),
					pos: str(),
					neg: str(),
					type: { enum: ["voltage", "current"] },
					kind: { enum: ["dc", "pulse", "sin"] },
					value: { type: ["string", "number"] },
					ac: { type: ["string", "number"] },
					pulse: { type: "object" },
					sin: { type: "object" },
				},
				required: ["name", "pos"],
				additionalProperties: false,
			},
		},
		loads: {
			type: "array",
			maxItems: 20,
			items: {
				type: "object",
				properties: {
					pos: str(),
					neg: str(),
					value: { type: ["string", "number"] },
				},
				required: ["pos", "value"],
				additionalProperties: false,
			},
		},
		expect: {
			type: "array",
			minItems: 1,
			maxItems: 50,
			items: {
				type: "object",
				properties: {
					measure: str(),
					stat: {
						enum: ["final", "max", "min", "avg", "rms", "pp", "db", "phase"],
					},
					min: { type: "number" },
					max: { type: "number" },
					approx: { type: "number" },
					tolerance: { type: "number", minimum: 0, maximum: 1 },
					from: { type: ["string", "number"] },
					to: { type: ["string", "number"] },
					at: { type: ["string", "number"] },
				},
				required: ["measure"],
				additionalProperties: false,
			},
		},
	},
	required: ["name", "expect"],
	additionalProperties: false,
};

const OPS = {
	add_part: (d, a) =>
		d.addPart({
			symbol: a.symbol,
			ref: a.ref,
			value: a.value,
			footprint: a.footprint,
			at: a.x !== undefined ? { x: a.x, y: a.y, rot: a.rot } : undefined,
			fields: a.fields,
		}),
	remove_part: (d, a) => d.removePart(a.ref),
	set_value: (d, a) => d.setValue(a.ref, a.value),
	set_footprint: (d, a) => d.setFootprint(a.ref, a.footprint),
	set_part_sim: (d, a) => {
		d.part(a.ref).sim = a.sim;
	},
	connect: (d, a) => d.connect(a.net, a.pins, { move: a.move }),
	disconnect: (d, a) => d.disconnect(a.pins),
	rename_net: (d, a) => d.renameNet(a.from, a.to),
	set_net_flags: (d, a) =>
		d.setNetFlags(a.net, { power: a.power, external: a.external }),
	mark_no_connect: (d, a) => d.markNoConnect(a.pin),
	place: (d, a) => d.place(a.ref, a.x, a.y, a.rot ?? 0),
	set_board: (d, a) => d.setBoard(a.width, a.height),
	add_track: (d, a) => d.addTrack(a),
	add_via: (d, a) => d.addVia(a),
	clear_routing: (d) => d.clearRouting(),
	add_test: (d, a) => d.addTest(a.test),
};

const opSchema = {
	type: "object",
	properties: {
		op: { enum: Object.keys(OPS) },
		symbol: str({
			description: 'add_part: library symbol id, e.g. "Device:R"',
		}),
		ref: str(),
		value: str(),
		footprint: str({
			description:
				'Library footprint id, e.g. "Resistor_SMD:R_0805_2012Metric"',
		}),
		x: { type: "number" },
		y: { type: "number" },
		rot: { enum: [0, 90, 180, 270] },
		fields: { type: "object" },
		sim: simSchema,
		net: str(),
		pins: { type: "array", items: pin, minItems: 1, maxItems: 200 },
		pin,
		move: { type: "boolean" },
		from: str(),
		to: str(),
		power: {
			type: "boolean",
			description:
				"set_net_flags: net is a power rail (drawn with power symbols)",
		},
		external: {
			type: "boolean",
			description:
				"set_net_flags: the rail is supplied from off-board (connector); satisfies power-input checks",
		},
		width: { type: "number" },
		height: { type: "number" },
		layer: { enum: ["F.Cu", "B.Cu"] },
		points: {
			type: "array",
			items: {
				type: "array",
				items: { type: "number" },
				minItems: 2,
				maxItems: 2,
			},
		},
		test: testSchema,
	},
	required: ["op"],
};

const wrap = (fn) => async (args) => P.withLock(args.project, () => fn(args));

export const TOOLS = [
	{
		name: "list_projects",
		description: "List the board projects stored on this machine.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		handler: async () => ({
			projectsDirectory: config.projectsDir,
			projects: P.listProjects(),
		}),
	},
	{
		name: "create_project",
		description:
			"Create a new board project (a git repository, so every build is a diffable commit).",
		inputSchema: {
			type: "object",
			properties: { project, title: str({ maxLength: 120 }) },
			required: ["project"],
			additionalProperties: false,
		},
		handler: async (a) =>
			P.withLock(a.project, () => P.createProject(a.project, a.title)),
	},
	{
		name: "get_design",
		description:
			"Return the current design: parts, nets, placement, board size, tests.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: { project },
			required: ["project"],
			additionalProperties: false,
		},
		handler: async (a) => P.loadDesign(a.project).summary(),
	},
	{
		name: "search_symbols",
		description:
			'Search KiCad\'s symbol library. Query words must all appear in "Library:Name", e.g. "ams1117 3.3" or "led".',
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: str({ minLength: 1, maxLength: 80 }),
				limit: { type: "integer", minimum: 1, maximum: 100 },
			},
			required: ["query"],
			additionalProperties: false,
		},
		handler: async (a) => ({
			symbols: searchSymbols(a.query, { limit: a.limit ?? 25 }),
		}),
	},
	{
		name: "get_symbol",
		description:
			"Describe a library symbol: its pins (number, name, electrical type), units and default footprint. Always read this before wiring a part.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				id: str({ description: 'e.g. "Regulator_Linear:AMS1117-3.3"' }),
			},
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (a) => {
			const s = getSymbol(a.id);
			if (!s) throw new DesignError(`Symbol "${a.id}" not found`);
			return {
				id: s.id,
				description: s.description,
				referencePrefix: s.referencePrefix,
				defaultFootprint: s.defaultFootprint,
				footprintFilters: s.fpFilters,
				units: s.units,
				pins: s.pins.map((p) => ({
					number: p.number,
					name: p.name,
					type: p.type,
					unit: p.unit,
					hidden: p.hidden,
				})),
			};
		},
	},
	{
		name: "search_footprints",
		description:
			'Search KiCad\'s footprint library, e.g. "R_0805" or "SOT-223".',
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: str({ minLength: 1, maxLength: 80 }),
				limit: { type: "integer", minimum: 1, maximum: 100 },
			},
			required: ["query"],
			additionalProperties: false,
		},
		handler: async (a) => ({
			footprints: searchFootprints(a.query, { limit: a.limit ?? 25 }),
		}),
	},
	{
		name: "get_footprint",
		description: "Describe a library footprint: pads and courtyard size.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: { id: str() },
			required: ["id"],
			additionalProperties: false,
		},
		handler: async (a) => {
			const f = getFootprint(a.id);
			if (!f) throw new DesignError(`Footprint "${a.id}" not found`);
			return {
				id: f.id,
				smd: f.isSmd,
				courtyard: {
					width: +(f.bbox.maxX - f.bbox.minX).toFixed(2),
					height: +(f.bbox.maxY - f.bbox.minY).toFixed(2),
				},
				pads: f.pads.map((p) => ({
					number: p.number,
					type: p.type,
					shape: p.shape,
					x: p.x,
					y: p.y,
					w: p.w,
					h: p.h,
				})),
			};
		},
	},
	{
		name: "edit",
		description:
			"Apply a batch of edits to a design atomically: if any operation fails nothing is changed. Operations: " +
			Object.keys(OPS).join(", ") +
			". Pass `build` with a commit message to write the KiCad files and commit in the same call.",
		inputSchema: {
			type: "object",
			properties: {
				project,
				operations: {
					type: "array",
					minItems: 1,
					maxItems: 300,
					items: opSchema,
				},
				build: str({
					maxLength: 200,
					description:
						"If set, build and commit with this message after the edits succeed",
				}),
			},
			required: ["project", "operations"],
			additionalProperties: false,
		},
		handler: wrap(async (a) => {
			const live = P.loadDesign(a.project);
			const work = Design.from(structuredClone(live.data));
			const log = [];
			for (const [i, op] of a.operations.entries()) {
				try {
					const r = OPS[op.op](work, op);
					log.push({
						op: op.op,
						ok: true,
						...(r && typeof r === "object" && !Array.isArray(r)
							? { result: r }
							: {}),
					});
				} catch (err) {
					throw new DesignError(
						`Operation ${i + 1} (${op.op}) failed: ${err.message}. No changes were saved.`,
						{ index: i, op, details: err.details },
					);
				}
			}
			P.saveDesign(a.project, work);
			const out = { applied: log.length, summary: work.summary() };
			if (a.build) out.build = await P.build(a.project, a.build);
			return out;
		}),
	},
	{
		name: "autoroute",
		description:
			"Freeze placement and route all nets on two layers (Manhattan tracks, vias). Reports nets it could not route. Re-run after changing parts.",
		inputSchema: {
			type: "object",
			properties: {
				project,
				tryAlternateOrder: {
					type: "boolean",
					description: "Retry with a different net order if some nets fail",
				},
			},
			required: ["project"],
			additionalProperties: false,
		},
		handler: wrap(async (a) => {
			let result = await P.autoRoute(a.project);
			if (result.failedNets.length && a.tryAlternateOrder) {
				const second = await P.autoRoute(a.project, { orderSeed: 1 });
				if (second.failedNets.length <= result.failedNets.length)
					result = second;
				else result = await P.autoRoute(a.project);
			}
			return result;
		}),
	},
	{
		name: "build",
		description:
			"Write the KiCad schematic, board and project files from the design and commit them. Open the .kicad_pro in KiCad, or use `diff`/`render` here.",
		inputSchema: {
			type: "object",
			properties: { project, message: str({ maxLength: 200 }) },
			required: ["project"],
			additionalProperties: false,
		},
		handler: wrap(async (a) =>
			P.build(a.project, a.message ?? "Update design"),
		),
	},
	{
		name: "run_checks",
		description:
			"Build, then run every check: electrical rules (built-in plus KiCad ERC where available), netlist parity against KiCad, placement, routing completeness and KiCad's DRC. ok=true only when there are no errors and every net is routed.",
		inputSchema: {
			type: "object",
			properties: { project },
			required: ["project"],
			additionalProperties: false,
		},
		handler: wrap(async (a) => P.checkProject(a.project)),
	},
	{
		name: "add_test",
		description: "Add or replace a simulation test (see the test schema).",
		inputSchema: {
			type: "object",
			properties: { project, test: testSchema },
			required: ["project", "test"],
			additionalProperties: false,
		},
		handler: wrap(async (a) => {
			const d = P.loadDesign(a.project);
			d.addTest(a.test);
			P.saveDesign(a.project, d);
			return { tests: d.data.tests.map((t) => t.name) };
		}),
	},
	{
		name: "run_simulation",
		description:
			"Run the project's simulation tests with ngspice and compare against the expectations. Parts without a SPICE model must have part.sim set (set_part_sim) or the test reports which one is missing.",
		inputSchema: {
			type: "object",
			properties: { project, test: str({ description: "Run only this test" }) },
			required: ["project"],
			additionalProperties: false,
		},
		handler: async (a) => ({
			ngspice: await ngspiceAvailable(),
			...(await P.simulateProject(a.project, a.test)),
		}),
	},
	{
		name: "history",
		description: "List the project's builds (commits), newest first.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				project,
				limit: { type: "integer", minimum: 1, maximum: 100 },
			},
			required: ["project"],
			additionalProperties: false,
		},
		handler: async (a) => ({
			commits: await P.history(a.project, a.limit ?? 30),
		}),
	},
	{
		name: "diff",
		description:
			"Compare two builds with Banana's diff engine and list what changed (moved parts, added/removed tracks, by net and layer). Defaults to the last two builds.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				project,
				base: str({ description: "commit or ref, default HEAD~1" }),
				target: str({ description: "commit or ref, default HEAD" }),
				file: { enum: ["board", "schematic"] },
			},
			required: ["project"],
			additionalProperties: false,
		},
		handler: async (a) => P.summarizeDiff(await P.diffBuilds(a.project, a)),
	},
	{
		name: "render",
		description:
			'Render the board or schematic with KiCad and list the layer SVGs. Pass `layer` (e.g. "F_Cu") to get that layer\'s SVG text.',
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				project,
				file: { enum: ["board", "schematic"] },
				layer: str({ maxLength: 40 }),
			},
			required: ["project"],
			additionalProperties: false,
		},
		handler: async (a) => {
			const dir = P.projectDir(a.project);
			const isPcb = (a.file ?? "board") === "board";
			const file = path.join(
				dir,
				`${a.project}.${isPcb ? "kicad_pcb" : "kicad_sch"}`,
			);
			if (!fs.existsSync(file))
				throw new DesignError("Nothing built yet. Run build first.");
			const r = await renderKicadFile(file, isPcb);
			const layers = r.svgFiles.map((f) => ({
				file: path.basename(f),
				bytes: fs.statSync(f).size,
			}));
			const out = {
				cached: Boolean(r.cached),
				layers,
				inBanana: {
					repoPath: dir,
					hint: "Open Banana, choose Local repository, and paste this path to browse every build visually.",
				},
			};
			if (a.layer) {
				const hit = r.svgFiles.find((f) =>
					path
						.basename(f)
						.toLowerCase()
						.includes(a.layer.toLowerCase().replace(/\./g, "_")),
				);
				if (!hit)
					throw new DesignError(`No layer matching "${a.layer}"`, {
						layers: layers.map((l) => l.file),
					});
				const text = fs.readFileSync(hit, "utf8");
				out.svg =
					text.length > 1_500_000
						? `${text.slice(0, 1_500_000)}…(truncated)`
						: text;
			}
			return out;
		},
	},
	{
		name: "dfm_check",
		description:
			"Check the design against typical low-cost manufacturing limits (track width, clearance, drill, annular ring, pad spacing, board size). Profiles: standard, budget, fine. These are typical values, not a specific manufacturer's promise.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: { project, profile: { enum: Object.keys(DFM_PROFILES) } },
			required: ["project"],
			additionalProperties: false,
		},
		handler: wrap(async (a) => {
			const design = P.loadDesign(a.project);
			const state = await P.projectState(a.project);
			const positions = Object.fromEntries(
				state.parts.filter((p) => p.at).map((p) => [p.ref, p.at]),
			);
			return dfmReport(design, positions, state.board, a.profile ?? "standard");
		}),
	},
	{
		name: "export",
		description:
			"Create files for manufacturing and documentation with KiCad: gerbers (a zip with the drill files), bom (CSV straight from the design), pos (pick-and-place CSV), netlist, pdf (board and schematic) or step (board outline only). Files are written to the project's results/exports/<kind>/ folder and listed in the result. Run run_checks first and only release a board that passes.",
		inputSchema: {
			type: "object",
			properties: {
				project,
				kind: { enum: ["gerbers", "bom", "pos", "netlist", "pdf", "step"] },
			},
			required: ["project", "kind"],
			additionalProperties: false,
		},
		handler: async (a) => runExport(a.project, a.kind),
	},
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));
export const toolList = () =>
	TOOLS.map((t) => ({
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema,
		annotations: { readOnlyHint: Boolean(t.readOnly), openWorldHint: false },
	}));

/** Validates and runs a tool. Returns { ok, result } or { ok:false, error, details }. */
export async function callTool(name, args, { handlers } = {}) {
	const tool = byName.get(name);
	if (!tool)
		return { ok: false, error: `Unknown tool "${name}"`, code: "unknown_tool" };
	const input = args ?? {};
	const errors = validate(input, tool.inputSchema);
	if (errors.length)
		return {
			ok: false,
			error: `Invalid arguments: ${errors.slice(0, 8).join("; ")}`,
			code: "invalid_arguments",
		};
	try {
		return {
			ok: true,
			result: await (handlers?.[name] ?? tool.handler)(input),
		};
	} catch (err) {
		if (err instanceof DesignError || err.statusCode === 400)
			return {
				ok: false,
				error: err.message,
				details: err.details,
				code: "design_error",
			};
		console.error(`[Banana MCP] tool ${name} failed:`, err);
		return {
			ok: false,
			error: "Internal error while running the tool (see server log)",
			code: "internal",
		};
	}
}
