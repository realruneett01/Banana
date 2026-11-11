import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { newId } from "../ids.js";
import { validateIssue } from "../issue.js";
import { createKicadCli } from "../kicad-cli.js";

const SCH_PATH_PATTERN = "^([a-zA-Z]:[\\\\/]|[\\\\/]).+\\.kicad_sch$";
const PCB_PATH_PATTERN = "^([a-zA-Z]:[\\\\/]|[\\\\/]).+\\.kicad_pcb$";
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_REGEX = /^[0-9a-f]{32}$/i;

const ERC_INPUT_SCHEMA = {
	type: "object",
	required: ["schPath"],
	additionalProperties: false,
	properties: {
		schPath: {
			type: "string",
			pattern: SCH_PATH_PATTERN,
		},
	},
};

const DRC_INPUT_SCHEMA = {
	type: "object",
	required: ["pcbPath"],
	additionalProperties: false,
	properties: {
		pcbPath: {
			type: "string",
			pattern: PCB_PATH_PATTERN,
		},
	},
};

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

const EXPORT_NETLIST_OUTPUT_SCHEMA = {
	type: "object",
	required: ["netlistPath"],
	additionalProperties: false,
	properties: {
		netlistPath: {
			type: "string",
		},
	},
};

function mapSeverity(kicadSeverity) {
	const s = String(kicadSeverity || "")
		.toLowerCase()
		.trim();
	if (s === "warning" || s === "warn") {
		return "warning";
	}
	if (s === "info" || s === "information") {
		return "info";
	}
	return "error";
}

function resolveKind(item) {
	const text =
		`${item?.kind ?? ""} ${item?.type ?? ""} ${item?.description ?? ""}`.toLowerCase();
	if (text.includes("symbol") || text.includes("footprint")) {
		return "part";
	}
	if (text.includes("track") || text.includes("via")) {
		return "trace";
	}
	return "net";
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
		const s1 = val.slice(0, 8);
		const s2 = val.slice(8, 12);
		const s3 = val.slice(12, 16);
		const s4 = val.slice(16, 20);
		const s5 = val.slice(20);
		return `${s1}-${s2}-${s3}-${s4}-${s5}`.toLowerCase();
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

function extractItemIdsAndMessage(violation) {
	const items = Array.isArray(violation?.items) ? violation.items : [];
	const validItemIds = [];
	const missingUuidDescs = [];

	for (const item of items) {
		const rawUuid = normalizeUuid(item?.uuid);
		if (rawUuid) {
			const kind = resolveKind(item);
			validItemIds.push(`${kind}_${rawUuid}`);
		} else if (item?.description) {
			missingUuidDescs.push(item.description);
		}
	}

	if (validItemIds.length > 0) {
		const baseMsg =
			violation?.description || violation?.type || "KiCad violation";
		return { itemIds: validItemIds, message: baseMsg };
	}

	const base = violation?.description || violation?.type || "";
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

function normalizeSummary(summary, issues) {
	if (
		typeof summary?.errors === "number" &&
		typeof summary?.warnings === "number"
	) {
		return { errors: summary.errors, warnings: summary.warnings };
	}
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

async function runErcTool(input, cli, commit) {
	const outJsonPath = path.join(os.tmpdir(), `kicad-erc-${randomUUID()}.json`);
	const report = await cli.runErc(input.schPath, outJsonPath);
	const rawViolations = Array.isArray(report?.violations)
		? report.violations
		: [];
	const issues = rawViolations.map((v) =>
		convertViolationToIssue(v, "erc", commit),
	);
	return {
		issues,
		summary: normalizeSummary(report?.summary, issues),
	};
}

async function runDrcTool(input, cli, commit) {
	const outJsonPath = path.join(os.tmpdir(), `kicad-drc-${randomUUID()}.json`);
	const report = await cli.runDrc(input.pcbPath, outJsonPath);
	const rawViolations = Array.isArray(report?.violations)
		? report.violations
		: [];
	const issues = rawViolations.map((v) =>
		convertViolationToIssue(v, "drc", commit),
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

export function registerKicadTools(registry, { cli, commit } = {}) {
	const activeCli = cli || createKicadCli();
	const activeCommit = typeof commit === "string" ? commit : "HEAD";

	registerToolEntry(registry, {
		name: "kicad.erc",
		description: "Runs KiCad electrical rules check on a schematic",
		inputSchema: ERC_INPUT_SCHEMA,
		outputSchema: REPORT_OUTPUT_SCHEMA,
		handler: (input) => runErcTool(input, activeCli, activeCommit),
	});

	registerToolEntry(registry, {
		name: "kicad.drc",
		description: "Runs KiCad design rules check on a PCB layout",
		inputSchema: DRC_INPUT_SCHEMA,
		outputSchema: REPORT_OUTPUT_SCHEMA,
		handler: (input) => runDrcTool(input, activeCli, activeCommit),
	});

	registerToolEntry(registry, {
		name: "kicad.export_netlist",
		description: "Exports a netlist from a KiCad schematic",
		inputSchema: EXPORT_NETLIST_INPUT_SCHEMA,
		outputSchema: EXPORT_NETLIST_OUTPUT_SCHEMA,
		handler: (input) => runExportNetlistTool(input, activeCli),
	});
}
