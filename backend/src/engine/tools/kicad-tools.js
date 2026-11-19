import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProjectErc } from "../erc-project.js";
import { newId } from "../ids.js";
import { validateIssue } from "../issue.js";
import { createKicadCli } from "../kicad-cli.js";
import { confineToRoot } from "./project-tools.js";

function createPathPattern(ext) {
	return `^([a-zA-Z]:[\\\\/]|[\\\\/]).+\\.${ext}$`;
}

const SCH_PATH_PATTERN = createPathPattern("kicad_sch");
const PCB_PATH_PATTERN = createPathPattern("kicad_pcb");
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_REGEX = /^[0-9a-f]{32}$/i;

function makeSinglePropSchema(propName, propSchema) {
	return {
		type: "object",
		required: [propName],
		additionalProperties: false,
		properties: {
			[propName]: propSchema,
		},
	};
}

const ERC_INPUT_SCHEMA = makeSinglePropSchema("schPath", {
	type: "string",
	pattern: SCH_PATH_PATTERN,
});

const DRC_INPUT_SCHEMA = makeSinglePropSchema("pcbPath", {
	type: "string",
	pattern: PCB_PATH_PATTERN,
});

const REPORT_OUTPUT_SCHEMA = {
	type: "object",
	required: ["issues", "summary"],
	additionalProperties: false,
	properties: {
		issues: {
			type: "array",
		},
		summary: {
			type: "object",
			required: ["errors", "warnings"],
			properties: {
				errors: { type: "number" },
				warnings: { type: "number" },
			},
		},
	},
};

const EXPORT_NETLIST_INPUT_SCHEMA = {
	type: "object",
	required: ["schPath"],
	additionalProperties: false,
	properties: {
		schPath: {
			type: "string",
			pattern: SCH_PATH_PATTERN,
		},
		format: {
			type: "string",
		},
	},
};

const ERC_PROJECT_INPUT_SCHEMA = makeSinglePropSchema("path", {
	type: "string",
	minLength: 1,
});

const SEVERITY_ARRAYS = {
	error: { type: "array" },
	warning: { type: "array" },
	info: { type: "array" },
};

const ERC_PROJECT_OUTPUT_SCHEMA = {
	type: "object",
	required: ["sheets", "counts", "issues", "warnings", "truncated"],
	additionalProperties: false,
	properties: {
		sheets: { type: "number" },
		counts: { type: "object" },
		issues: { type: "object", properties: SEVERITY_ARRAYS },
		warnings: { type: "array", items: { type: "string" } },
		truncated: { type: "boolean" },
	},
};

const MAX_ISSUES_PER_SEVERITY = 500;
const MAX_WARNINGS = 100;
const SEVERITIES = ["error", "warning", "info"];

const EXPORT_NETLIST_OUTPUT_SCHEMA = makeSinglePropSchema("netlistPath", {
	type: "string",
});

const SEVERITY_LEVELS = {
	warning: "warning",
	warn: "warning",
	info: "info",
	information: "info",
};

function mapSeverity(kicadSeverity) {
	const s = String(kicadSeverity || "")
		.toLowerCase()
		.trim();
	return SEVERITY_LEVELS[s] || "error";
}

const PART_KEYWORDS = ["symbol", "footprint"];
const TRACE_KEYWORDS = ["track", "via"];

function resolveKind(item) {
	const text =
		`${item?.kind ?? ""} ${item?.type ?? ""} ${item?.description ?? ""}`.toLowerCase();
	if (PART_KEYWORDS.some((kw) => text.includes(kw))) {
		return "part";
	}
	if (TRACE_KEYWORDS.some((kw) => text.includes(kw))) {
		return "trace";
	}
	return "net";
}

function formatHex32Uuid(val) {
	const parts = [
		val.slice(0, 8),
		val.slice(8, 12),
		val.slice(12, 16),
		val.slice(16, 20),
		val.slice(20),
	];
	return parts.join("-").toLowerCase();
}

function normalizeUuid(raw) {
	if (typeof raw !== "string") {
		return null;
	}
	const val = raw.trim();
	if (UUID_REGEX.test(val)) {
		return val.toLowerCase();
	}
	if (HEX32_REGEX.test(val)) {
		return formatHex32Uuid(val);
	}
	return null;
}

function formatNoUuidMessage(base, extra) {
	if (!extra) {
		return base || "KiCad violation";
	}
	if (!base) {
		return extra;
	}
	if (base.includes(extra)) {
		return base;
	}
	return `${base}: ${extra}`;
}

function getViolationItems(violation) {
	return Array.isArray(violation?.items) ? violation.items : [];
}

function getViolationTitle(violation) {
	return violation?.description || violation?.type || "";
}

function processViolationItem(item, { validItemIds, missingUuidDescs }) {
	const rawUuid = normalizeUuid(item?.uuid);
	if (rawUuid) {
		validItemIds.push(`${resolveKind(item)}_${rawUuid}`);
		return;
	}
	if (item?.description) {
		missingUuidDescs.push(item.description);
	}
}

function collectItemDetails(items) {
	const validItemIds = [];
	const missingUuidDescs = [];
	for (const item of items) {
		processViolationItem(item, { validItemIds, missingUuidDescs });
	}
	return { validItemIds, missingUuidDescs };
}

function extractItemIdsAndMessage(violation) {
	const items = getViolationItems(violation);
	const { validItemIds, missingUuidDescs } = collectItemDetails(items);
	const base = getViolationTitle(violation);

	if (validItemIds.length > 0) {
		return { itemIds: validItemIds, message: base || "KiCad violation" };
	}

	const extra = missingUuidDescs.filter(Boolean).join("; ");
	return {
		itemIds: [newId("part")],
		message: formatNoUuidMessage(base, extra),
	};
}

function convertViolationToIssue(violation, source, commit) {
	const { itemIds, message } = extractItemIdsAndMessage(violation);
	const issue = {
		id: newId("issue"),
		source,
		severity: mapSeverity(violation?.severity),
		itemIds,
		message,
		commit,
		status: "open",
	};
	const validation = validateIssue(issue);
	if (!validation.ok) {
		throw new Error(`Generated invalid issue: ${validation.errors.join("; ")}`);
	}
	return issue;
}

function countIssueSeverities(issues) {
	let errors = 0;
	let warnings = 0;
	for (const issue of issues) {
		if (issue.severity === "error") {
			errors += 1;
		} else if (issue.severity === "warning") {
			warnings += 1;
		}
	}
	return { errors, warnings };
}

function normalizeSummary(summary, issues) {
	if (
		typeof summary?.errors === "number" &&
		typeof summary?.warnings === "number"
	) {
		return { errors: summary.errors, warnings: summary.warnings };
	}
	return countIssueSeverities(issues);
}

async function executeRuleCheck({ runCheck, inputPath, toolName, commit }) {
	const outJsonPath = path.join(
		os.tmpdir(),
		`kicad-${toolName}-${randomUUID()}.json`,
	);
	const report = await runCheck(inputPath, outJsonPath);
	const rawViolations = Array.isArray(report?.violations)
		? report.violations
		: [];
	const issues = rawViolations.map((v) =>
		convertViolationToIssue(v, toolName, commit),
	);
	return {
		issues,
		summary: normalizeSummary(report?.summary, issues),
	};
}

async function runExportNetlistTool(input, cli) {
	const ext = input.format === "spice" ? "cir" : "net";
	const netlistPath = path.join(
		os.tmpdir(),
		`kicad-netlist-${randomUUID()}.${ext}`,
	);
	const format = input.format ?? "kicadsexpr";
	await cli.exportNetlist(input.schPath, netlistPath, format);
	return { netlistPath };
}

function capProjectReport(result) {
	const counts = {};
	const issues = {};
	for (const sev of SEVERITIES) {
		const group = result.issues.filter((i) => i.severity === sev);
		counts[sev] = group.length;
		issues[sev] = group.slice(0, MAX_ISSUES_PER_SEVERITY);
	}
	const truncated =
		SEVERITIES.some((sev) => counts[sev] > MAX_ISSUES_PER_SEVERITY) ||
		result.warnings.length > MAX_WARNINGS;
	const warnings = result.warnings.slice(0, MAX_WARNINGS);
	return { sheets: result.sheets, counts, issues, warnings, truncated };
}

// Whole-hierarchy ERC on a root sheet that must resolve (realpath) inside
// projectsRoot; shared by the erc.project tool and POST /api/erc/project.
export async function runConfinedProjectErc({ projectsRoot, schPath, commit }) {
	if (typeof schPath !== "string" || !schPath.endsWith(".kicad_sch")) {
		throw new Error("path must be a .kicad_sch file");
	}
	const root = projectsRoot ?? os.homedir();
	const real = await confineToRoot(fs.promises, root, schPath);
	const result = runProjectErc(real, { commit: commit ?? "" });
	if (!result.ok) {
		throw new Error(result.errors.join("; "));
	}
	return capProjectReport(result);
}

function registerToolEntry(registry, def) {
	registry.register({
		name: def.name,
		description: def.description,
		inputSchema: def.inputSchema,
		outputSchema: def.outputSchema,
		permission: "read",
		handler: def.handler,
	});
}

const RULE_CHECK_CONFIGS = [
	{
		name: "kicad.erc",
		description: "Runs KiCad electrical rules check on a schematic",
		inputSchema: ERC_INPUT_SCHEMA,
		toolName: "erc",
		getPath: (input) => input.schPath,
		runCheck: (cli, filePath, outPath) => cli.runErc(filePath, outPath),
	},
	{
		name: "kicad.drc",
		description: "Runs KiCad design rules check on a PCB layout",
		inputSchema: DRC_INPUT_SCHEMA,
		toolName: "drc",
		getPath: (input) => input.pcbPath,
		runCheck: (cli, filePath, outPath) => cli.runDrc(filePath, outPath),
	},
];

export function registerKicadTools(
	registry,
	{ cli, commit, projectsRoot } = {},
) {
	const activeCli = cli || createKicadCli();
	const activeCommit = typeof commit === "string" ? commit : "HEAD";

	for (const config of RULE_CHECK_CONFIGS) {
		registerToolEntry(registry, {
			name: config.name,
			description: config.description,
			inputSchema: config.inputSchema,
			outputSchema: REPORT_OUTPUT_SCHEMA,
			handler: (input) =>
				executeRuleCheck({
					runCheck: (filePath, outPath) =>
						config.runCheck(activeCli, filePath, outPath),
					inputPath: config.getPath(input),
					toolName: config.toolName,
					commit: activeCommit,
				}),
		});
	}

	registerToolEntry(registry, {
		name: "kicad.export_netlist",
		description: "Exports a netlist from a KiCad schematic",
		inputSchema: EXPORT_NETLIST_INPUT_SCHEMA,
		outputSchema: EXPORT_NETLIST_OUTPUT_SCHEMA,
		handler: (input) => runExportNetlistTool(input, activeCli),
	});

	registerToolEntry(registry, {
		name: "erc.project",
		description:
			"Runs ERC across a whole schematic hierarchy (root .kicad_sch inside the projects root)",
		inputSchema: ERC_PROJECT_INPUT_SCHEMA,
		outputSchema: ERC_PROJECT_OUTPUT_SCHEMA,
		handler: (input) =>
			runConfinedProjectErc({
				projectsRoot,
				schPath: input.path,
				commit: activeCommit,
			}),
	});
}
