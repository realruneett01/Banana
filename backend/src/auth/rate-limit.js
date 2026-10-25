/**
 * In-memory failed-login limiter. Keyed per IP+username and per IP, so one attacker can
 * neither hammer a single account nor spray many accounts quickly. Resets on success.
 */
export class LoginLimiter {
	constructor({
		maxPerAccount = 5,
		maxPerIp = 25,
		windowMs = 15 * 60 * 1000,
		now = () => Date.now(),
	} = {}) {
		this.maxPerAccount = maxPerAccount;
		this.maxPerIp = maxPerIp;
		this.windowMs = windowMs;
		this.now = now;
		this.hits = new Map();
	}

	#fresh(key) {
		const t = this.now();
		const list = (this.hits.get(key) || []).filter(
			(x) => t - x < this.windowMs,
		);
		if (list.length) this.hits.set(key, list);
		else this.hits.delete(key);
		return list;
	}

	/** @returns {{allowed: boolean, retryAfterSec: number}} */
	check(ip, username) {
		const acct = this.#fresh(`a:${ip}:${username}`);
		const addr = this.#fresh(`i:${ip}`);
		const blocked =
			acct.length >= this.maxPerAccount
				? acct
				: addr.length >= this.maxPerIp
					? addr
					: null;
		if (!blocked) return { allowed: true, retryAfterSec: 0 };
		return {
			allowed: false,
			retryAfterSec: Math.max(
				1,
				Math.ceil((blocked[0] + this.windowMs - this.now()) / 1000),
			),
		};
	}

	fail(ip, username) {
		for (const key of [`a:${ip}:${username}`, `i:${ip}`]) {
			const list = this.#fresh(key);
			list.push(this.now());
			this.hits.set(key, list);
		}
		if (this.hits.size > 10000) this.hits.clear(); // memory bound under spraying
	}

	success(ip, username) {
		this.hits.delete(`a:${ip}:${username}`);
	}
}
