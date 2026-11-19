import { isId } from "./ids.js";
import { validate } from "./schema-lite.js";

export const ISSUE_SCHEMA = {
	type: "object",
	required: [
		"id",
		"source",
		"severity",
		"itemIds",
		"message",
		"commit",
		"status",
	],
	properties: {
		id: { type: "string" },
		source: {
			type: "string",
			enum: ["drc", "erc", "sim"],
		},
		severity: {
			type: "string",
			enum: ["error", "warning", "info"],
		},
		itemIds: {
			type: "array",
			items: { type: "string" },
		},
		metric: { type: "string" },
		measured: { type: "number" },
		limit: { type: "number" },
		unit: { type: "string" },
		message: { type: "string" },
		suggestion: { type: "string" },
		simRunId: { type: "string" },
		commit: { type: "string" },
		status: {
			type: "string",
			enum: ["open", "fixed", "wontfix"],
		},
	},
	additionalProperties: false,
};

const ID_CHECKS = {
	id: { prop: "id", kind: "issue", error: "$.id: invalid issue id" },
	simRunId: {
		prop: "simRunId",
		kind: "sim",
		error: "$.simRunId: invalid sim id",
	},
};

const RUN_DIFF_SPECS = [
	{ field: "fixed", from: "prev", against: "next", match: false },
	{ field: "stillOpen", from: "next", against: "prev", match: true },
	{ field: "new", from: "next", against: "prev", match: false },
];

function isPlainObject(target) {
	if (!target || typeof target !== "object") {
		return false;
	}
	return !Array.isArray(target);
}

function checkTypedId(entity, check, errors) {
	const val = entity[check.prop];
	if (typeof val === "string" && !isId(val, check.kind)) {
		errors.push(check.error);
	}
}

function checkItemIds(itemIds, errors) {
	if (!Array.isArray(itemIds)) {
		return;
	}
	if (itemIds.length === 0) {
		errors.push("$.itemIds: must contain at least 1 item");
		return;
	}
	itemIds.forEach((itemId, idx) => {
		if (typeof itemId === "string" && !isId(itemId)) {
			errors.push(`$.itemIds[${idx}]: invalid id`);
		}
	});
}

export function validateIssue(issue) {
	const report = validate(ISSUE_SCHEMA, issue);
	if (!isPlainObject(issue)) {
		return { ok: false, errors: [...report.errors] };
	}
	const semanticErrors = [];
	checkTypedId(issue, ID_CHECKS.id, semanticErrors);
	checkItemIds(issue.itemIds, semanticErrors);
	checkTypedId(issue, ID_CHECKS.simRunId, semanticErrors);
	const errors = report.errors.concat(semanticErrors);
	return {
		ok: errors.length === 0,
		errors,
	};
}

export function issuesForItem(issues, itemId) {
	if (!Array.isArray(issues) || typeof itemId !== "string") {
		return [];
	}
	return issues.filter(
		(issue) => Array.isArray(issue?.itemIds) && issue.itemIds.includes(itemId),
	);
}

function issueKey(issue) {
	const source = issue?.source ?? "";
	const metric = issue?.metric ?? "";
	const itemIds = Array.isArray(issue?.itemIds)
		? [...issue.itemIds].sort().join(",")
		: "";
	return `${source}|${metric}|${itemIds}`;
}

function extractRunEntries(run) {
	const items = Array.isArray(run) ? run.filter(isPlainObject) : [];
	return {
		items,
		keys: new Set(items.map(issueKey)),
	};
}

export function compareRuns(before, after) {
	const runs = {
		prev: extractRunEntries(before),
		next: extractRunEntries(after),
	};
	const diff = { fixed: [], stillOpen: [], new: [] };
	for (const { field, from, against, match } of RUN_DIFF_SPECS) {
		diff[field] = runs[from].items.filter(
			(issue) => runs[against].keys.has(issueKey(issue)) === match,
		);
	}
	return diff;
}
