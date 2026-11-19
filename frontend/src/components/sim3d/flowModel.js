const COLD_COLOR = Object.freeze([0, 0.5, 1]);
const MID_COLOR = Object.freeze([1, 1, 0]);
const HOT_COLOR = Object.freeze([1, 0, 0]);

const SPARK_KINDS = new Set(["open_trace", "spark"]);
const FLASH_KINDS = new Set(["short_nets", "flash"]);
const SMOKE_KINDS = new Set([
	"part_over_temperature",
	"over_temperature",
	"smoke",
]);

export function clamp(val, min, max) {
	if (val < min) return min;
	if (val > max) return max;
	return val;
}

function lerp(a, b, t) {
	return a + t * (b - a);
}

function lerpColor(c1, c2, t) {
	return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

export function temperatureColor(celsius) {
	const temp = typeof celsius === "number" ? celsius : 25;
	if (temp <= 40) {
		return [...COLD_COLOR];
	}
	if (temp >= 85) {
		return [...HOT_COLOR];
	}
	if (temp <= 60) {
		const t = (temp - 40) / 20;
		return lerpColor(COLD_COLOR, MID_COLOR, t);
	}
	const t = (temp - 60) / 25;
	return lerpColor(MID_COLOR, HOT_COLOR, t);
}

function distance3d(p1, p2) {
	const dx = p2[0] - p1[0];
	const dy = p2[1] - p1[1];
	const dz = p2[2] - p1[2];
	return Math.hypot(dx, dy, dz);
}

function computeCumulative(points) {
	if (!Array.isArray(points) || points.length === 0) {
		return { cumulative: [], length: 0 };
	}
	const cumulative = [0];
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		total += distance3d(points[i - 1], points[i]);
		cumulative.push(total);
	}
	return { cumulative, length: total };
}

function computeSpeed(current, widthMm, config = {}) {
	const absCur = Math.abs(current);
	if (absCur < 1e-6) return 0;
	const k = config.k ?? 20;
	const min = config.minSpeed ?? 2;
	const max = config.maxSpeed ?? 100;
	const width = widthMm > 0 ? widthMm : 0.25;
	return clamp((k * absCur) / width, min, max);
}

function computeParticleCount(length, current, config = {}) {
	const absCur = Math.abs(current);
	if (absCur < 1e-6 || length <= 0) return 0;
	const density = config.density ?? 0.5;
	return Math.max(1, Math.round(length * absCur * density));
}

function buildSinglePath(segment, netCurrents, netTemps, config) {
	const netId = segment?.netId ?? "";
	const points = Array.isArray(segment?.points)
		? segment.points.map((p) => [...p])
		: [];
	const { cumulative, length } = computeCumulative(points);
	const current = Number(netCurrents?.[netId] ?? 0);
	const temp = Number(netTemps?.[netId] ?? 25);
	const speed = computeSpeed(current, segment?.widthMm, config);
	const particleCount = computeParticleCount(length, current, config);
	const color = temperatureColor(temp);
	return {
		netId,
		points,
		length,
		cumulative,
		current,
		speed,
		color,
		particleCount,
	};
}

export function buildFlowPaths(params = {}) {
	const { segments = [], netCurrents = {}, netTemps = {}, ...config } = params;
	if (!Array.isArray(segments)) return [];
	return segments.map((seg) =>
		buildSinglePath(seg, netCurrents, netTemps, config),
	);
}

function interpolateSegment(p1, p2, t) {
	return [
		p1[0] + t * (p2[0] - p1[0]),
		p1[1] + t * (p2[1] - p1[1]),
		p1[2] + t * (p2[2] - p1[2]),
	];
}

export function positionAt(path, distance) {
	const points = path?.points ?? [];
	if (points.length === 0) return [0, 0, 0];
	if (points.length === 1 || distance <= 0) {
		return [...points[0]];
	}
	const totalLength = path.length ?? 0;
	if (distance >= totalLength) {
		return [...points[points.length - 1]];
	}
	const cum = path.cumulative ?? [];
	for (let i = 0; i < cum.length - 1; i++) {
		if (distance <= cum[i + 1]) {
			const segLen = cum[i + 1] - cum[i];
			const t = segLen > 0 ? (distance - cum[i]) / segLen : 0;
			return interpolateSegment(points[i], points[i + 1], t);
		}
	}
	return [...points[points.length - 1]];
}

export function createPrng(seed = 1) {
	let s = Math.trunc(seed) >>> 0 || 123456789;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function makePathParticles(path, pathIndex, prng, startId) {
	const count = path.particleCount ?? 0;
	const particles = [];
	for (let i = 0; i < count; i++) {
		const u = prng();
		const distance = path.length > 0 ? u * path.length : 0;
		particles.push({
			id: startId + i,
			pathIndex,
			netId: path.netId,
			distance,
			position: positionAt(path, distance),
			color: [...path.color],
		});
	}
	return particles;
}

export function createFlowState(paths = [], options = {}) {
	const validPaths = Array.isArray(paths) ? paths : [];
	const prng = createPrng(options?.seed ?? 42);
	const particles = [];
	for (let i = 0; i < validPaths.length; i++) {
		const pathParticles = makePathParticles(
			validPaths[i],
			i,
			prng,
			particles.length,
		);
		particles.push(...pathParticles);
	}
	return { paths: validPaths, particles };
}

function wrapDistance(dist, length) {
	if (length <= 0) return 0;
	return ((dist % length) + length) % length;
}

function advanceParticle(particle, path, dtS) {
	const direction = path.current < 0 ? -1 : 1;
	const speed = path.speed ?? 0;
	const delta = direction * speed * dtS;
	const newDist = wrapDistance(particle.distance + delta, path.length ?? 0);
	return {
		...particle,
		distance: newDist,
		position: positionAt(path, newDist),
	};
}

export function stepFlow(state, dtS) {
	const paths = state?.paths ?? [];
	const particles = state?.particles ?? [];
	const dt = typeof dtS === "number" ? dtS : 0;
	const nextParticles = particles.map((p) => {
		const path = paths[p.pathIndex] ?? { length: 0, speed: 0, current: 0 };
		return advanceParticle(p, path, dt);
	});
	return {
		paths,
		particles: nextParticles,
	};
}

function pathMidpoint(path) {
	if (!path || !Array.isArray(path.points) || path.points.length === 0) {
		return [0, 0, 0];
	}
	const halfDist = (path.length ?? 0) / 2;
	return positionAt(path, halfDist);
}

function pathEndPoint(path) {
	if (!path || !Array.isArray(path.points) || path.points.length === 0) {
		return [0, 0, 0];
	}
	return [...path.points[path.points.length - 1]];
}

function blendMidpoints(pA, pB) {
	if (pA && pB) {
		const mA = pathMidpoint(pA);
		const mB = pathMidpoint(pB);
		return [(mA[0] + mB[0]) / 2, (mA[1] + mB[1]) / 2, (mA[2] + mB[2]) / 2];
	}
	if (pA) return pathMidpoint(pA);
	if (pB) return pathMidpoint(pB);
	return [0, 0, 0];
}

function resolveSpark(fault, paths) {
	const netId = fault?.netId ?? "";
	const path = paths.find((p) => p.netId === netId);
	const position = fault?.position ?? pathEndPoint(path);
	return {
		kind: "spark",
		position: [...position],
		netId,
		intensity: fault?.intensity ?? 1.0,
	};
}

function resolveFlash(fault, paths) {
	const netIds = fault?.netIds ?? [fault?.netId, fault?.otherNetId];
	const netA = netIds[0] ?? fault?.netId ?? "";
	const netB = netIds[1] ?? "";
	const pA = paths.find((p) => p.netId === netA);
	const pB = paths.find((p) => p.netId === netB);
	const position = fault?.position ?? blendMidpoints(pA, pB);
	return {
		kind: "flash",
		position: [...position],
		netId: fault?.netId ?? netA,
		intensity: fault?.intensity ?? 1.0,
	};
}

function resolveSmoke(fault, paths) {
	const netId = fault?.netId ?? fault?.partId ?? "";
	const path = paths.find((p) => p.netId === netId);
	const position = fault?.position ?? pathMidpoint(path);
	return {
		kind: "smoke",
		position: [...position],
		netId,
		intensity: fault?.intensity ?? 1.0,
	};
}

function classifyFault(kind) {
	if (SPARK_KINDS.has(kind)) return "spark";
	if (FLASH_KINDS.has(kind)) return "flash";
	if (SMOKE_KINDS.has(kind)) return "smoke";
	return null;
}

export function faultEffects(faults = [], paths = []) {
	if (!Array.isArray(faults)) return [];
	const pathList = Array.isArray(paths) ? paths : [];
	const effects = [];
	for (const fault of faults) {
		const cat = classifyFault(fault?.kind ?? fault?.type);
		if (cat === "spark") {
			effects.push(resolveSpark(fault, pathList));
		} else if (cat === "flash") {
			effects.push(resolveFlash(fault, pathList));
		} else if (cat === "smoke") {
			effects.push(resolveSmoke(fault, pathList));
		}
	}
	return effects;
}
