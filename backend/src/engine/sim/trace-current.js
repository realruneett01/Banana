import { newId } from "../ids.js";

const MIL_PER_MM = 39.3701;
const MIL_PER_UM = 0.0393701;
const K_EXTERNAL = 0.048;
const K_INTERNAL = 0.024;
const COPPER_TEMP_LIMIT_C = 105;

export function maxCurrentA({
	widthMm,
	thicknessUm = 35,
	external = true,
	tempRiseC = 10,
} = {}) {
	if (typeof widthMm !== "number" || widthMm <= 0) {
		return 0;
	}
	if (thicknessUm <= 0 || tempRiseC <= 0) {
		return 0;
	}
	const k = external ? K_EXTERNAL : K_INTERNAL;
	const widthMil = widthMm * MIL_PER_MM;
	const thicknessMil = thicknessUm * MIL_PER_UM;
	const areaSqMil = widthMil * thicknessMil;
	return k * tempRiseC ** 0.44 * areaSqMil ** 0.725;
}

function calcEffectiveDT(tempRiseC, ambientMax) {
	const maxRise = COPPER_TEMP_LIMIT_C - ambientMax;
	return Math.min(tempRiseC, maxRise);
}

function isExternalLayer(layer) {
	return layer === "F.Cu" || layer === "B.Cu";
}

function computeTrackMax(track, effectiveDT) {
	if (effectiveDT <= 0) {
		return 0;
	}
	const external = isExternalLayer(track.layer);
	const raw = maxCurrentA({
		widthMm: track.widthMm,
		thicknessUm: track.thicknessUm,
		external,
		tempRiseC: effectiveDT,
	});
	return Math.round(raw * 100) / 100;
}

function determineSeverity(currentA, max) {
	if (currentA > max) {
		return "error";
	}
	if (currentA > 0.8 * max) {
		return "warning";
	}
	return null;
}

function createIssueMessage(currentA, max, severity) {
	if (max === 0) {
		return `Trace current ${currentA}A exceeds capacity 0A due to thermal limit`;
	}
	if (severity === "error") {
		return `Trace current ${currentA}A exceeds capacity ${max}A`;
	}
	return `Trace current ${currentA}A exceeds 80% threshold of capacity ${max}A`;
}

function buildTrackIssue(track, max, severity, context) {
	const message = createIssueMessage(track.currentA, max, severity);
	return {
		id: newId("issue"),
		source: "sim",
		severity,
		itemIds: [track.id],
		metric: "current",
		measured: track.currentA,
		limit: max,
		unit: "A",
		message,
		suggestion: "widen the trace or use thicker copper",
		simRunId: context.simRunId,
		commit: context.commit,
		status: "open",
	};
}

function processTrack(track, effectiveDT, context) {
	const max = computeTrackMax(track, effectiveDT);
	const result = {
		itemId: track.id,
		metric: "current_capacity",
		value: max,
		unit: "A",
	};
	const severity = determineSeverity(track.currentA, max);
	const issue =
		severity !== null ? buildTrackIssue(track, max, severity, context) : null;
	return { result, issue };
}

export function runTraceCurrent({
	tracks,
	env,
	commit,
	simRunId,
	tempRiseC = 10,
} = {}) {
	const ambientMax = env?.ambientC?.max ?? 25;
	const effectiveDT = calcEffectiveDT(tempRiseC, ambientMax);
	const context = { commit, simRunId };
	const results = [];
	const issues = [];

	for (const track of Array.isArray(tracks) ? tracks : []) {
		const { result, issue } = processTrack(track, effectiveDT, context);
		results.push(result);
		if (issue !== null) {
			issues.push(issue);
		}
	}

	return { results, issues };
}
