import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const b64 = (buf) => Buffer.from(buf).toString("base64url");

/** Session secret: env var, otherwise a random key persisted next to the user database. */
export function loadSessionSecret(dataDir, env = process.env) {
	if (env.BANANA_SESSION_SECRET && env.BANANA_SESSION_SECRET.length >= 32)
		return env.BANANA_SESSION_SECRET;
	const file = path.join(dataDir, "session.secret");
	try {
		const existing = fs.readFileSync(file, "utf8").trim();
		if (existing.length >= 32) return existing;
	} catch {
		/* generate below */
	}
	const secret = crypto.randomBytes(48).toString("base64url");
	fs.mkdirSync(dataDir, { recursive: true });
	fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
	return secret;
}

export function signSession(payload, secret) {
	const body = b64(JSON.stringify(payload));
	const sig = b64(crypto.createHmac("sha256", secret).update(body).digest());
	return `${body}.${sig}`;
}

/** @returns {object|null} the payload when the signature is valid and not expired */
export function verifySession(token, secret, now = Date.now()) {
	if (typeof token !== "string") return null;
	const parts = token.split(".");
	if (parts.length !== 2) return null;
	const [body, sig] = parts;
	const expected = crypto.createHmac("sha256", secret).update(body).digest();
	let given;
	try {
		given = Buffer.from(sig, "base64url");
	} catch {
		return null;
	}
	if (
		given.length !== expected.length ||
		!crypto.timingSafeEqual(given, expected)
	)
		return null;
	try {
		const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
		if (typeof payload.exp !== "number" || payload.exp <= now) return null;
		if (typeof payload.u !== "string" || typeof payload.v !== "number")
			return null;
		return payload;
	} catch {
		return null;
	}
}
