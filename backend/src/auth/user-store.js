import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 256;
export const ROLES = ["admin", "user"];

export function normalizeUsername(name) {
	return typeof name === "string" ? name.trim().toLowerCase() : "";
}

export function validateUsername(name) {
	return USERNAME_RE.test(normalizeUsername(name));
}

/** Returns an error string, or null when the password is acceptable. */
export function validatePassword(password) {
	if (typeof password !== "string") return "Password must be a string";
	if (password.length < MIN_PASSWORD)
		return `Password must be at least ${MIN_PASSWORD} characters`;
	if (password.length > MAX_PASSWORD)
		return `Password must be at most ${MAX_PASSWORD} characters`;
	return null;
}

export async function hashPassword(password) {
	const salt = crypto.randomBytes(16);
	const key = await scrypt(password, salt, SCRYPT.keylen, {
		N: SCRYPT.N,
		r: SCRYPT.r,
		p: SCRYPT.p,
	});
	return [
		"scrypt",
		SCRYPT.N,
		SCRYPT.r,
		SCRYPT.p,
		salt.toString("base64"),
		key.toString("base64"),
	].join("$");
}

export async function verifyPassword(password, stored) {
	try {
		const [alg, N, r, p, saltB64, keyB64] = String(stored).split("$");
		if (alg !== "scrypt") return false;
		const expected = Buffer.from(keyB64, "base64");
		// A truncated or empty stored key must never verify.
		if (expected.length < 32) return false;
		const actual = await scrypt(
			password,
			Buffer.from(saltB64, "base64"),
			expected.length,
			{
				N: Number(N),
				r: Number(r),
				p: Number(p),
			},
		);
		return (
			expected.length === actual.length &&
			crypto.timingSafeEqual(expected, actual)
		);
	} catch {
		return false;
	}
}

// Verified against when a username does not exist, so "unknown user" and
// "wrong password" take the same time.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString("hex"));

/** JSON-file user database. Small by design: this is a team tool, not a public service. */
export class UserStore {
	constructor(file) {
		this.file = file;
		this.users = [];
		this.load();
	}

	load() {
		try {
			const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
			this.users = Array.isArray(raw.users) ? raw.users : [];
		} catch (err) {
			if (err.code !== "ENOENT")
				throw new Error(
					`Cannot read user database ${this.file}: ${err.message}`,
				);
			this.users = [];
		}
	}

	save() {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
		fs.writeFileSync(
			tmp,
			`${JSON.stringify({ version: 1, users: this.users }, null, 2)}\n`,
			{ mode: 0o600 },
		);
		fs.renameSync(tmp, this.file);
	}

	get count() {
		return this.users.length;
	}

	find(username) {
		const name = normalizeUsername(username);
		return this.users.find((u) => u.username === name) || null;
	}

	list() {
		return this.users.map(({ username, role, disabled, createdAt }) => ({
			username,
			role,
			disabled: Boolean(disabled),
			createdAt,
		}));
	}

	async create(username, password, role = "user") {
		const name = normalizeUsername(username);
		if (!validateUsername(name))
			throw new Error(
				"Username must be 3-40 characters: letters, digits, dot, dash, underscore",
			);
		const pwError = validatePassword(password);
		if (pwError) throw new Error(pwError);
		if (!ROLES.includes(role))
			throw new Error(`Role must be one of: ${ROLES.join(", ")}`);
		if (this.find(name)) throw new Error(`User "${name}" already exists`);
		this.users.push({
			username: name,
			hash: await hashPassword(password),
			role,
			disabled: false,
			tokenVersion: 1,
			createdAt: new Date().toISOString(),
		});
		this.save();
	}

	async setPassword(username, password) {
		const user = this.find(username);
		if (!user) throw new Error("No such user");
		const pwError = validatePassword(password);
		if (pwError) throw new Error(pwError);
		user.hash = await hashPassword(password);
		user.tokenVersion += 1; // invalidates every existing session of this user
		this.save();
	}

	setDisabled(username, disabled) {
		const user = this.find(username);
		if (!user) throw new Error("No such user");
		user.disabled = Boolean(disabled);
		user.tokenVersion += 1;
		this.save();
	}

	remove(username) {
		const name = normalizeUsername(username);
		const before = this.users.length;
		this.users = this.users.filter((u) => u.username !== name);
		if (this.users.length === before) throw new Error("No such user");
		this.save();
	}

	/** @returns {Promise<object|null>} the user on success, otherwise null (never says why). */
	async authenticate(username, password) {
		const user = this.find(username);
		const ok = await verifyPassword(
			typeof password === "string" ? password : "",
			user ? user.hash : DUMMY_HASH,
		);
		return user && ok && !user.disabled ? user : null;
	}
}
