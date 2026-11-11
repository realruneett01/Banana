export function defaultKey(req) {
	if (req?.ip) {
		return req.ip;
	}
	if (req?.socket?.remoteAddress) {
		return req.socket.remoteAddress;
	}
	return "unknown";
}

function pruneExpired(store, nowMs) {
	for (const [key, entry] of store) {
		if (nowMs >= entry.resetAt) {
			store.delete(key);
		}
	}
}

function evictOldest(store) {
	const oldest = store.keys().next().value;
	if (oldest !== undefined) {
		store.delete(oldest);
	}
}

function ensureCapacity(store, nowMs, maxKeys) {
	if (store.size < maxKeys) {
		return;
	}
	pruneExpired(store, nowMs);
	if (store.size >= maxKeys) {
		evictOldest(store);
	}
}

function getOrCreateEntry(store, key, nowMs, config) {
	const current = store.get(key);
	if (current && nowMs < current.resetAt) {
		return current;
	}
	if (current) {
		store.delete(key);
	}
	ensureCapacity(store, nowMs, config.maxKeys);
	const fresh = { count: 0, resetAt: nowMs + config.windowMs };
	store.set(key, fresh);
	return fresh;
}

function setRateLimitHeaders(res, max, remaining, resetSeconds) {
	res.setHeader("RateLimit-Limit", String(max));
	res.setHeader("RateLimit-Remaining", String(Math.max(0, remaining)));
	res.setHeader("RateLimit-Reset", String(Math.max(0, resetSeconds)));
}

function sendRateLimitExceeded(res, max, resetSeconds) {
	const retryAfter = Math.max(1, resetSeconds);
	res.setHeader("Retry-After", String(retryAfter));
	setRateLimitHeaders(res, max, 0, resetSeconds);
	return res.status(429).json({ error: "Too many requests, retry later" });
}

export function createRateLimiter({
	windowMs = 60000,
	max = 20,
	keyFn = defaultKey,
	now = () => Date.now(),
	maxKeys = 10000,
} = {}) {
	const store = new Map();
	const config = { windowMs, maxKeys };

	const limiter = (req, res, next) => {
		const key = keyFn(req) || "unknown";
		const nowMs = now();
		const entry = getOrCreateEntry(store, key, nowMs, config);
		entry.count += 1;

		const remaining = max - entry.count;
		const resetSeconds = Math.ceil((entry.resetAt - nowMs) / 1000);

		if (entry.count > max) {
			return sendRateLimitExceeded(res, max, resetSeconds);
		}

		setRateLimitHeaders(res, max, remaining, resetSeconds);
		return next();
	};

	limiter.store = store;
	return limiter;
}

export function skipWhenLocal(limiter) {
	return (req, res, next) => {
		if (req?.app?.locals?.allowLocalRepos === true) {
			return next();
		}
		return limiter(req, res, next);
	};
}
