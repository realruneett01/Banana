import { newId } from "../ids.js";

const COPPER_RHO_20C = 1.72e-8;
const COPPER_TEMP_COEFF = 0.00393;

function round4(value) {
	return Math.round(value * 10000) / 10000;
}

export function traceResistanceOhm({
	lengthMm,
	widthMm,
	thicknessUm = 35,
	tempC = 20,
} = {}) {
	const rho = COPPER_RHO_20C * (1 + COPPER_TEMP_COEFF * (tempC - 20));
	const lengthM = lengthMm * 1e-3;
	const widthM = widthMm * 1e-3;
	const thicknessM = thicknessUm * 1e-6;
	const areaM2 = widthM * thicknessM;
	return (rho * lengthM) / areaM2;
}

function computeTrackDrop(track, tempC) {
	const resistance = traceResistanceOhm({
		lengthMm: track.lengthMm,
		widthMm: track.widthMm,
		thicknessUm: track.thicknessUm,
		tempC,
	});
	const currentA = track.currentA ?? 0;
	return round4(currentA * resistance);
}

function buildIssue({ netId, total, limit, trackIds, commit, simRunId }) {
	if (typeof limit !== "number") {
		return null;
	}
	const severity =
		total > limit ? "error" : total > 0.8 * limit ? "warning" : null;
	if (!severity) {
		return null;
	}
	const message =
		severity === "error"
			? `Net ${netId} IR drop (${total} V) exceeds limit of ${limit} V`
			: `Net ${netId} IR drop (${total} V) exceeds 80% of limit (${limit} V)`;
	return {
		id: newId("issue"),
		source: "sim",
		severity,
		itemIds: [netId, ...trackIds],
		metric: "ir_drop",
		measured: total,
		limit,
		unit: "V",
		message,
		suggestion: "shorten or widen the path, or add a parallel copper pour",
		simRunId,
		commit,
		status: "open",
	};
}

function computeTrackResults(tracks, tempC) {
	const results = [];
	const netTracks = new Map();
	for (const track of tracks) {
		const drop = computeTrackDrop(track, tempC);
		results.push({
			itemId: track.id,
			metric: "ir_drop",
			value: drop,
			unit: "V",
		});
		const list = netTracks.get(track.netId) ?? [];
		list.push({ id: track.id, drop });
		netTracks.set(track.netId, list);
	}
	return { results, netTracks };
}

function computeNetResultsAndIssues({
	netTracks,
	railLimits,
	commit,
	simRunId,
}) {
	const results = [];
	const issues = [];
	for (const [netId, tracks] of netTracks.entries()) {
		const total = round4(tracks.reduce((sum, t) => sum + t.drop, 0));
		results.push({ itemId: netId, metric: "ir_drop", value: total, unit: "V" });
		const issue = buildIssue({
			netId,
			total,
			limit: railLimits?.[netId],
			trackIds: tracks.map((t) => t.id),
			commit,
			simRunId,
		});
		if (issue) {
			issues.push(issue);
		}
	}
	return { results, issues };
}

export function runIrDrop({
	tracks = [],
	railLimits = {},
	env,
	commit,
	simRunId,
} = {}) {
	const tempC = env?.ambientC?.max ?? 20;
	const { results: trackResults, netTracks } = computeTrackResults(
		tracks,
		tempC,
	);
	const { results: netResults, issues } = computeNetResultsAndIssues({
		netTracks,
		railLimits,
		commit,
		simRunId,
	});
	return {
		results: [...trackResults, ...netResults],
		issues,
	};
}
