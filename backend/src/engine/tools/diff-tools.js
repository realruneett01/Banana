const PATH_PATTERN = "^([a-zA-Z]:[\\\\/]|[\\\\/]).+\\.(kicad_pcb|kicad_sch)$";

const INPUT_SCHEMA = {
	type: "object",
	required: ["basePath", "targetPath"],
	additionalProperties: false,
	properties: {
		basePath: {
			type: "string",
			pattern: PATH_PATTERN,
		},
		targetPath: {
			type: "string",
			pattern: PATH_PATTERN,
		},
		isPcb: {
			type: "boolean",
		},
	},
};

const OUTPUT_SCHEMA = {
	type: "object",
	required: ["modifications"],
	properties: {
		modifications: {
			type: "array",
		},
		pcbMetadata: {
			type: ["object", "null"],
		},
		telemetry: {
			type: "object",
		},
	},
};

function formatDiffOutput(result) {
	const output = {
		modifications: result?.modifications,
	};
	if (result?.pcbMetadata !== undefined) {
		output.pcbMetadata = result.pcbMetadata;
	}
	if (result?.telemetry !== undefined) {
		output.telemetry = result.telemetry;
	}
	return output;
}

function createResAdapter(resolve, reject) {
	let statusCode = 200;
	return {
		status(code) {
			statusCode = code;
			return this;
		},
		json(payload) {
			if (statusCode >= 400) {
				const message =
					payload?.error ||
					payload?.details ||
					`Diff failed with status ${statusCode}`;
				reject(new Error(message));
			} else {
				resolve(payload);
			}
			return payload;
		},
	};
}

async function defaultRunDiff({ basePath, targetPath, isPcb }) {
	const { executeDiffPipeline } = await import("../../diff-pipeline.js");
	return new Promise((resolve, reject) => {
		const res = createResAdapter(resolve, reject);
		executeDiffPipeline({ basePath, targetPath, isPcb }, res).catch(reject);
	});
}

function resolveIsPcb(input) {
	if (input.isPcb !== undefined) {
		return input.isPcb;
	}
	return input.basePath.endsWith(".kicad_pcb");
}

function createDiffHandler(runDiff) {
	return async (input) => {
		const isPcb = resolveIsPcb(input);
		const result = await runDiff({
			basePath: input.basePath,
			targetPath: input.targetPath,
			isPcb,
		});
		return formatDiffOutput(result);
	};
}

export function registerDiffTools(registry, deps = {}) {
	const runDiff = deps.runDiff || defaultRunDiff;
	registry.register({
		name: "diff.compare_files",
		description:
			"Compares two KiCad files (.kicad_pcb or .kicad_sch) and returns visual/structural diff",
		inputSchema: INPUT_SCHEMA,
		outputSchema: OUTPUT_SCHEMA,
		permission: "read",
		handler: createDiffHandler(runDiff),
	});
}
