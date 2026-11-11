import Database from "better-sqlite3";
import { validateSimRun } from "../environment-sim.js";
import { compareRuns, validateIssue } from "../issue.js";

const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sim_runs (
	id TEXT PRIMARY KEY,
	commit_sha TEXT,
	env_id TEXT,
	kind TEXT,
	status TEXT,
	started_at TEXT,
	json TEXT
);
CREATE TABLE IF NOT EXISTS issues (
	id TEXT PRIMARY KEY,
	sim_run_id TEXT,
	commit_sha TEXT,
	status TEXT,
	json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sim_runs_commit ON sim_runs(commit_sha);
CREATE INDEX IF NOT EXISTS idx_sim_runs_env_kind ON sim_runs(env_id, kind);
CREATE INDEX IF NOT EXISTS idx_issues_commit ON issues(commit_sha);
CREATE INDEX IF NOT EXISTS idx_issues_sim_run ON issues(sim_run_id);
`;

const VALID_STATUSES = new Set(["open", "fixed", "wontfix"]);

function validateIssuesList(issues) {
	if (!Array.isArray(issues)) {
		return ["$.issues: must be an array"];
	}
	const errors = [];
	for (let i = 0; i < issues.length; i++) {
		const res = validateIssue(issues[i]);
		if (!res.ok) {
			errors.push(...res.errors);
		}
	}
	return errors;
}

function validateRunAndIssues(run, issues) {
	const runRes = validateSimRun(run);
	const errors = runRes.ok ? [] : [...runRes.errors];
	errors.push(...validateIssuesList(issues));
	if (errors.length > 0) {
		throw new Error(`Validation failed:\n${errors.join("\n")}`);
	}
}

function buildFilterClauses(filters) {
	const clauses = [];
	const params = [];
	if (filters?.commit) {
		clauses.push("commit_sha = ?");
		params.push(filters.commit);
	}
	if (filters?.envId) {
		clauses.push("env_id = ?");
		params.push(filters.envId);
	}
	if (filters?.kind) {
		clauses.push("kind = ?");
		params.push(filters.kind);
	}
	return { clauses, params };
}

function buildRunQuery(filters, limitOne = false) {
	const { clauses, params } = buildFilterClauses(filters);
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = limitOne ? "LIMIT 1" : "";
	const sql =
		`SELECT json FROM sim_runs ${where} ORDER BY started_at DESC ${limit}`.trim();
	return { sql, params };
}

function createStatementCache(db) {
	const cache = new Map();
	return (sql) => {
		let stmt = cache.get(sql);
		if (!stmt) {
			stmt = db.prepare(sql);
			cache.set(sql, stmt);
		}
		return stmt;
	};
}

function initStatements(db) {
	db.exec(INIT_SCHEMA_SQL);
	return {
		selectRun: db.prepare("SELECT json FROM sim_runs WHERE id = ?"),
		selectIssuesByRun: db.prepare(
			"SELECT json FROM issues WHERE sim_run_id = ? ORDER BY rowid ASC",
		),
		selectIssue: db.prepare("SELECT json FROM issues WHERE id = ?"),
		updateIssue: db.prepare(
			"UPDATE issues SET status = ?, json = ? WHERE id = ?",
		),
		deleteIssues: db.prepare("DELETE FROM issues WHERE sim_run_id = ?"),
		deleteRun: db.prepare("DELETE FROM sim_runs WHERE id = ?"),
		insertRun: db.prepare(
			"INSERT INTO sim_runs (id, commit_sha, env_id, kind, status, started_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
		),
		insertIssue: db.prepare(
			"INSERT INTO issues (id, sim_run_id, commit_sha, status, json) VALUES (?, ?, ?, ?, ?)",
		),
	};
}

function executeSave(stmts, run, issues) {
	stmts.deleteIssues.run(run.id);
	stmts.deleteRun.run(run.id);
	stmts.insertRun.run(
		run.id,
		run.commit,
		run.envId,
		run.kind,
		run.status,
		run.startedAt,
		JSON.stringify(run),
	);
	for (const issue of issues) {
		stmts.insertIssue.run(
			issue.id,
			issue.simRunId || run.id,
			issue.commit || run.commit,
			issue.status,
			JSON.stringify(issue),
		);
	}
}

function updateIssue(stmts, issueId, status) {
	const row = stmts.selectIssue.get(issueId);
	if (!row) {
		return false;
	}
	const issue = JSON.parse(row.json);
	issue.status = status;
	stmts.updateIssue.run(status, JSON.stringify(issue), issueId);
	return true;
}

function getRunFromDb(stmts, id) {
	const runRow = stmts.selectRun.get(id);
	if (!runRow) {
		return null;
	}
	const issueRows = stmts.selectIssuesByRun.all(id);
	return {
		run: JSON.parse(runRow.json),
		issues: issueRows.map((row) => JSON.parse(row.json)),
	};
}

function listRunsFromDb(getStmt, filters) {
	const { sql, params } = buildRunQuery(filters, false);
	const rows = getStmt(sql).all(...params);
	return rows.map((r) => JSON.parse(r.json));
}

function latestRunFromDb(getStmt, stmts, filters) {
	const { sql, params } = buildRunQuery(filters, true);
	const row = getStmt(sql).get(...params);
	if (!row) {
		return null;
	}
	const run = JSON.parse(row.json);
	return getRunFromDb(stmts, run.id);
}

function compareCommitsFromDb(getStmt, stmts, opts = {}) {
	const { before, after, envId, kind } = opts;
	const beforeRun = latestRunFromDb(getStmt, stmts, {
		commit: before,
		envId,
		kind,
	});
	if (!beforeRun) {
		throw new Error(`no run for ${before}`);
	}
	const afterRun = latestRunFromDb(getStmt, stmts, {
		commit: after,
		envId,
		kind,
	});
	if (!afterRun) {
		throw new Error(`no run for ${after}`);
	}
	return compareRuns(beforeRun.issues, afterRun.issues);
}

function setIssueStatusInDb(updateTx, id, status) {
	if (!VALID_STATUSES.has(status)) {
		throw new Error(`invalid status: ${status}`);
	}
	return updateTx(id, status);
}

export function createSimStore({ filename = ":memory:" } = {}) {
	const db = new Database(filename);
	const stmts = initStatements(db);
	const getStmt = createStatementCache(db);
	const saveTx = db.transaction((run, issues) =>
		executeSave(stmts, run, issues),
	);
	const updateTx = db.transaction((id, status) =>
		updateIssue(stmts, id, status),
	);

	return {
		saveRun: (run, issues) => {
			validateRunAndIssues(run, issues);
			saveTx(run, issues);
		},
		getRun: (id) => getRunFromDb(stmts, id),
		listRuns: (filters) => listRunsFromDb(getStmt, filters),
		latestRun: (filters) => latestRunFromDb(getStmt, stmts, filters),
		compareCommits: (opts) => compareCommitsFromDb(getStmt, stmts, opts),
		setIssueStatus: (id, status) => setIssueStatusInDb(updateTx, id, status),
		close: () => db.close(),
	};
}
