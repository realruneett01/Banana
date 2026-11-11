import crypto from "node:crypto";
import Database from "better-sqlite3";

const DEFAULT_MAX_STATES = 1000;
const DEFAULT_TTL_MS = 600000;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS oauth_states (
	state TEXT PRIMARY KEY,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states(created_at);
`;

function prepareStatements(db) {
	return {
		insertOrReplace: db.prepare(
			"INSERT INTO oauth_states (state, created_at) VALUES (?, ?) ON CONFLICT(state) DO UPDATE SET created_at = excluded.created_at",
		),
		get: db.prepare("SELECT created_at FROM oauth_states WHERE state = ?"),
		delete: db.prepare("DELETE FROM oauth_states WHERE state = ?"),
		deleteAll: db.prepare("DELETE FROM oauth_states"),
		count: db.prepare("SELECT COUNT(*) AS count FROM oauth_states"),
		evictOldest: db.prepare(
			"DELETE FROM oauth_states WHERE state = (SELECT state FROM oauth_states ORDER BY created_at ASC, rowid ASC LIMIT 1)",
		),
		purgeExpired: db.prepare("DELETE FROM oauth_states WHERE created_at < ?"),
	};
}

function createSetTransaction(db, stmts, store) {
	return db.transaction((state, createdAt) => {
		const existing = stmts.get.get(state);
		if (!existing) {
			const row = stmts.count.get();
			if (row.count >= store.maxEntries) {
				stmts.evictOldest.run();
			}
		}
		stmts.insertOrReplace.run(state, createdAt);
	});
}

function createConsumeTransaction(db, stmts, store) {
	return db.transaction((state) => {
		const row = stmts.get.get(state);
		if (!row) return false;
		stmts.delete.run(state);
		return store.now() - row.created_at <= store.ttlMs;
	});
}

export class SqliteStateStore {
	constructor({
		filename = ":memory:",
		maxEntries = DEFAULT_MAX_STATES,
		ttlMs = DEFAULT_TTL_MS,
		now = () => Date.now(),
	} = {}) {
		this.filename = filename;
		this.maxEntries = maxEntries;
		this.ttlMs = ttlMs;
		this.now = now;
		this.db = new Database(filename);
		this.db.exec(SCHEMA_SQL);
		this.stmts = prepareStatements(this.db);
		this.setTx = createSetTransaction(this.db, this.stmts, this);
		this.consumeTx = createConsumeTransaction(this.db, this.stmts, this);
	}

	set(state, createdAt = this.now()) {
		if (!state || typeof state !== "string") return state;
		this.setTx(state, createdAt);
		return state;
	}

	generate() {
		this.purgeExpired();
		const state = crypto.randomBytes(16).toString("hex");
		this.set(state);
		return state;
	}

	purgeExpired() {
		const cutoff = this.now() - this.ttlMs;
		this.stmts.purgeExpired.run(cutoff);
	}

	validate(state) {
		if (!state || typeof state !== "string") return false;
		const row = this.stmts.get.get(state);
		if (!row) return false;
		if (this.now() - row.created_at > this.ttlMs) {
			this.stmts.delete.run(state);
			return false;
		}
		return true;
	}

	consume(state) {
		if (!state || typeof state !== "string") return false;
		return Boolean(this.consumeTx(state));
	}

	clear() {
		this.stmts.deleteAll.run();
	}

	get size() {
		const row = this.stmts.count.get();
		return row ? row.count : 0;
	}

	close() {
		this.db.close();
	}
}

export function createSqliteStateStore(options) {
	return new SqliteStateStore(options);
}
