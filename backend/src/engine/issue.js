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

function isPlainObject(v) {
	if (v === null || Array.isArray(v)) {
		return false;
	}
	return typeof v === "object";
}

function checkIssueId(id, errors) {
	if (typeof id === "string" && !isId(id, "issue")) {
		errors.push("$.id: invalid issue id");
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
	for (let i = 0; i < itemIds.length; i++) {
		if (typeof itemIds[i] === "string" && !isId(itemIds[i])) {
			errors.push(`$.itemIds[${i}]: invalid id`);
		}
	}
}

function checkSimRunId(simRunId, errors) {
	if (typeof simRunId === "string" && !isId(simRunId, "sim")) {
		errors.push("$.simRunId: invalid sim id");
	}
}

export function validateIssue(issue) {
	const res = validate(ISSUE_SCHEMA, issue);
	const errors = [...res.errors];
	if (!isPlainObject(issue)) {
		return { ok: false, errors };
	}
	checkIssueId(issue.id, errors);
	checkItemIds(issue.itemIds, errors);
	checkSimRunId(issue.simRunId, errors);
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

function buildKeySet(issues) {
	const set = new Set();
	for (const issue of issues) {
		set.add(issueKey(issue));
	}
	return set;
}

export function compareRuns(before, after) {
	const beforeList = (Array.isArray(before) ? before : []).filter(
		isPlainObject,
	);
	const afterList = (Array.isArray(after) ? after : []).filter(isPlainObject);
	const beforeKeys = buildKeySet(beforeList);
	const afterKeys = buildKeySet(afterList);

	const fixed = beforeList.filter((issue) => !afterKeys.has(issueKey(issue)));
	const stillOpen = afterList.filter((issue) =>
		beforeKeys.has(issueKey(issue)),
	);
	const newIssues = afterList.filter(
		(issue) => !beforeKeys.has(issueKey(issue)),
	);

	return {
		fixed,
		stillOpen,
		new: newIssues,
	};
}
