import { autoPlace } from "../auto-place.js";
import { validateCircuitIR } from "../circuit-ir.js";
import { runErc } from "../erc.js";
import { irToKicadPcb } from "../kicad-pcb-writer.js";
import { irToKicadSch } from "../kicad-sch-writer.js";
import { runSimulation, SIM_KINDS } from "../sim/run-sim.js";

const IR_VALIDATE_INPUT_SCHEMA = {
	type: "object",
	required: ["ir"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
	},
};

const IR_VALIDATE_OUTPUT_SCHEMA = {
	type: "object",
	required: ["valid", "errors"],
	additionalProperties: false,
	properties: {
		valid: { type: "boolean" },
		errors: {
			type: "array",
			items: { type: "string" },
		},
	},
};

const ERC_RUN_INPUT_SCHEMA = {
	type: "object",
	required: ["ir", "commit"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
		commit: { type: "string" },
	},
};

const ERC_RUN_OUTPUT_SCHEMA = {
	type: "object",
	required: ["issues"],
	additionalProperties: false,
	properties: {
		issues: { type: "array" },
	},
};

const AUTO_PLACE_INPUT_SCHEMA = {
	type: "object",
	required: ["ir", "boardW", "boardH"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
		boardW: { type: "number" },
		boardH: { type: "number" },
		gridMm: { type: "number" },
		marginMm: { type: "number" },
	},
};

const AUTO_PLACE_OUTPUT_SCHEMA = {
	type: "object",
	required: ["ir", "placed"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
		placed: {
			type: "array",
			items: { type: "string" },
		},
	},
};

const TO_KICAD_SCH_INPUT_SCHEMA = {
	type: "object",
	required: ["ir"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
		title: { type: "string" },
	},
};

const TO_KICAD_SCH_OUTPUT_SCHEMA = {
	type: "object",
	required: ["text", "warnings"],
	additionalProperties: false,
	properties: {
		text: { type: "string" },
		warnings: {
			type: "array",
			items: { type: "string" },
		},
	},
};

const TO_KICAD_PCB_INPUT_SCHEMA = {
	type: "object",
	required: ["ir", "boardW", "boardH"],
	additionalProperties: false,
	properties: {
		ir: { type: "object" },
		boardW: { type: "number" },
		boardH: { type: "number" },
	},
};

const TO_KICAD_PCB_OUTPUT_SCHEMA = {
	type: "object",
	required: ["text", "warnings"],
	additionalProperties: false,
	properties: {
		text: { type: "string" },
		warnings: {
			type: "array",
			items: { type: "string" },
		},
	},
};

const SIM_RUN_INPUT_SCHEMA = {
	type: "object",
	required: ["kind", "env", "commit", "inputs"],
	additionalProperties: false,
	properties: {
		kind: {
			type: "string",
			enum: SIM_KINDS,
		},
		env: { type: "object" },
		commit: { type: "string" },
		inputs: { type: "object" },
	},
};

const SIM_RUN_OUTPUT_SCHEMA = {
	type: "object",
	required: ["run", "issues"],
	additionalProperties: false,
	properties: {
		run: { type: "object" },
		issues: { type: "array" },
		error: { type: "string" },
	},
};

function handleValidateIr(input, fn) {
	const res = fn(input.ir);
	return {
		valid: res.ok,
		errors: res.errors,
	};
}

function handleRunErc(input, fn) {
	const issues = fn(input.ir, { commit: input.commit });
	return { issues };
}

function handleAutoPlace(input, fn) {
	return fn(input.ir, {
		boardW: input.boardW,
		boardH: input.boardH,
		gridMm: input.gridMm,
		marginMm: input.marginMm,
	});
}

function handleToKicadSch(input, fn) {
	return fn(input.ir, { title: input.title });
}

function handleToKicadPcb(input, fn) {
	return fn(input.ir, {
		boardW: input.boardW,
		boardH: input.boardH,
	});
}

function handleSimRun(input, fn) {
	return fn(input);
}

function createIrToolDefs(deps) {
	const validateFn = deps.validateCircuitIR || validateCircuitIR;
	const ercFn = deps.runErc || runErc;
	const autoPlaceFn = deps.autoPlace || autoPlace;

	return [
		{
			name: "ir.validate",
			description:
				"Validates a Circuit IR document against schema and semantics",
			inputSchema: IR_VALIDATE_INPUT_SCHEMA,
			outputSchema: IR_VALIDATE_OUTPUT_SCHEMA,
			handler: (input) => handleValidateIr(input, validateFn),
		},
		{
			name: "erc.run",
			description: "Runs electrical rules check on a Circuit IR",
			inputSchema: ERC_RUN_INPUT_SCHEMA,
			outputSchema: ERC_RUN_OUTPUT_SCHEMA,
			handler: (input) => handleRunErc(input, ercFn),
		},
		{
			name: "ir.auto_place",
			description: "Automatically places unplaced components on a PCB grid",
			inputSchema: AUTO_PLACE_INPUT_SCHEMA,
			outputSchema: AUTO_PLACE_OUTPUT_SCHEMA,
			handler: (input) => handleAutoPlace(input, autoPlaceFn),
		},
	];
}

function createWriterAndSimToolDefs(deps) {
	const schFn = deps.irToKicadSch || irToKicadSch;
	const pcbFn = deps.irToKicadPcb || irToKicadPcb;
	const simFn = deps.runSimulation || runSimulation;

	return [
		{
			name: "ir.to_kicad_sch",
			description:
				"Generates KiCad schematic S-expression text from Circuit IR",
			inputSchema: TO_KICAD_SCH_INPUT_SCHEMA,
			outputSchema: TO_KICAD_SCH_OUTPUT_SCHEMA,
			handler: (input) => handleToKicadSch(input, schFn),
		},
		{
			name: "ir.to_kicad_pcb",
			description:
				"Generates KiCad PCB layout S-expression text from Circuit IR",
			inputSchema: TO_KICAD_PCB_INPUT_SCHEMA,
			outputSchema: TO_KICAD_PCB_OUTPUT_SCHEMA,
			handler: (input) => handleToKicadPcb(input, pcbFn),
		},
		{
			name: "sim.run",
			description: "Runs thermal, trace current, or IR drop simulation",
			inputSchema: SIM_RUN_INPUT_SCHEMA,
			outputSchema: SIM_RUN_OUTPUT_SCHEMA,
			handler: (input) => handleSimRun(input, simFn),
		},
	];
}

export function registerDesignTools(registry, deps = {}) {
	const toolDefs = [
		...createIrToolDefs(deps),
		...createWriterAndSimToolDefs(deps),
	];
	for (const tool of toolDefs) {
		registry.register({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
			outputSchema: tool.outputSchema,
			permission: "read",
			handler: tool.handler,
		});
	}
}
