import { autoPlace } from "../auto-place.js";
import { validateCircuitIR } from "../circuit-ir.js";
import { runErc } from "../erc.js";
import { irToKicadPcb } from "../kicad-pcb-writer.js";
import { irToKicadSch } from "../kicad-sch-writer.js";
import { runSimulation, SIM_KINDS } from "../sim/run-sim.js";

const T_OBJ = { type: "object" };
const T_STR = { type: "string" };
const T_NUM = { type: "number" };
const T_ARR = { type: "array" };
const T_STR_ARR = { type: "array", items: T_STR };

function createSchema(properties, required = []) {
	return {
		type: "object",
		required,
		additionalProperties: false,
		properties,
	};
}

const KICAD_WRITER_OUTPUT_SCHEMA = createSchema(
	{
		text: T_STR,
		warnings: T_STR_ARR,
	},
	["text", "warnings"],
);

const handleValidate = (fn, { ir }) => {
	const res = fn(ir);
	return {
		valid: res.ok,
		errors: res.errors,
	};
};

const handleErc = (fn, { ir, commit }) => ({
	issues: fn(ir, { commit }),
});

const handleIrWithOptions = (fn, { ir, ...opts }) => fn(ir, opts);

const handleSim = (fn, input) => fn(input);

const TOOL_SPECS = [
	{
		name: "ir.validate",
		description: "Validates a Circuit IR document against schema and semantics",
		inputSchema: createSchema({ ir: T_OBJ }, ["ir"]),
		outputSchema: createSchema(
			{ valid: { type: "boolean" }, errors: T_STR_ARR },
			["valid", "errors"],
		),
		dep: "validateCircuitIR",
		fallback: validateCircuitIR,
		handle: handleValidate,
	},
	{
		name: "erc.run",
		description: "Runs electrical rules check on a Circuit IR",
		inputSchema: createSchema({ ir: T_OBJ, commit: T_STR }, ["ir", "commit"]),
		outputSchema: createSchema({ issues: T_ARR }, ["issues"]),
		dep: "runErc",
		fallback: runErc,
		handle: handleErc,
	},
	{
		name: "ir.auto_place",
		description: "Automatically places unplaced components on a PCB grid",
		inputSchema: createSchema(
			{
				ir: T_OBJ,
				boardW: T_NUM,
				boardH: T_NUM,
				gridMm: T_NUM,
				marginMm: T_NUM,
			},
			["ir", "boardW", "boardH"],
		),
		outputSchema: createSchema({ ir: T_OBJ, placed: T_STR_ARR }, [
			"ir",
			"placed",
		]),
		dep: "autoPlace",
		fallback: autoPlace,
		handle: handleIrWithOptions,
	},
	{
		name: "ir.to_kicad_sch",
		description: "Generates KiCad schematic S-expression text from Circuit IR",
		inputSchema: createSchema({ ir: T_OBJ, title: T_STR }, ["ir"]),
		outputSchema: KICAD_WRITER_OUTPUT_SCHEMA,
		dep: "irToKicadSch",
		fallback: irToKicadSch,
		handle: handleIrWithOptions,
	},
	{
		name: "ir.to_kicad_pcb",
		description: "Generates KiCad PCB layout S-expression text from Circuit IR",
		inputSchema: createSchema({ ir: T_OBJ, boardW: T_NUM, boardH: T_NUM }, [
			"ir",
			"boardW",
			"boardH",
		]),
		outputSchema: KICAD_WRITER_OUTPUT_SCHEMA,
		dep: "irToKicadPcb",
		fallback: irToKicadPcb,
		handle: handleIrWithOptions,
	},
	{
		name: "sim.run",
		description: "Runs thermal, trace current, or IR drop simulation",
		inputSchema: createSchema(
			{
				kind: { type: "string", enum: SIM_KINDS },
				env: T_OBJ,
				commit: T_STR,
				inputs: T_OBJ,
			},
			["kind", "env", "commit", "inputs"],
		),
		outputSchema: createSchema({ run: T_OBJ, issues: T_ARR, error: T_STR }, [
			"run",
			"issues",
		]),
		dep: "runSimulation",
		fallback: runSimulation,
		handle: handleSim,
	},
];

export function registerDesignTools(registry, deps = {}) {
	for (const tool of TOOL_SPECS) {
		const targetFn = deps[tool.dep] || tool.fallback;
		registry.register({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			outputSchema: tool.outputSchema,
			permission: "read",
			handler: (input) => tool.handle(targetFn, input),
		});
	}
}
