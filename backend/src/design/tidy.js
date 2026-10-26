import { copperLite, routingStatus } from "./checks.js";

const MIN_CUT = 0.2;
const round3 = (v) => Math.round(v * 1000) / 1000;

/** Replaces right-angle corners of one track by 45 degree cuts. `cut` is the length removed on each leg. */
function chamferTrack(track, cut) {
	const pts = track.points;
	if (pts.length < 3) return { track, corners: 0 };
	const out = [pts[0]];
	let corners = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const [px, py] = pts[i - 1];
		const [cx, cy] = pts[i];
		const [nx, ny] = pts[i + 1];
		const lenIn = Math.hypot(cx - px, cy - py);
		const lenOut = Math.hypot(nx - cx, ny - cy);
		const dIn = [(cx - px) / lenIn, (cy - py) / lenIn];
		const dOut = [(nx - cx) / lenOut, (ny - cy) / lenOut];
		const orthogonal =
			Math.abs(dIn[0] * dOut[0] + dIn[1] * dOut[1]) < 1e-9 &&
			(Math.abs(dIn[0]) < 1e-9 || Math.abs(dIn[1]) < 1e-9);
		// a leg gives up at most half its length, so the two cuts on a shared leg never overlap
		const available = Math.min(cut, lenIn / 2, lenOut / 2);
		const c = Math.floor(available * 100) / 100;
		if (!orthogonal || !(lenIn > 0) || !(lenOut > 0) || c < MIN_CUT) {
			out.push(pts[i]);
			continue;
		}
		for (const p of [
			[round3(cx - dIn[0] * c), round3(cy - dIn[1] * c)],
			[round3(cx + dOut[0] * c), round3(cy + dOut[1] * c)],
		]) {
			const last = out[out.length - 1];
			if (last[0] !== p[0] || last[1] !== p[1]) out.push(p); // two cuts meeting mid-leg share a point
		}
		corners++;
	}
	out.push(pts[pts.length - 1]);
	return { track: { ...track, points: out }, corners };
}

const fingerprint = (status) =>
	JSON.stringify(Object.entries(status).map(([n, r]) => [n, r.islands]));

/**
 * Cuts right-angle track corners to 45 degrees. A track keeps its new shape only if it adds no clearance or
 * short violation (exact geometry, `copperLite`) and every net keeps the same connectivity; otherwise that
 * track is left exactly as the router drew it.
 */
export function chamferTracks(
	design,
	positions,
	{ cut = 0.5, clearance = 0.2 } = {},
) {
	let original = design.data.tracks;
	let removed = 0;
	const withTracks = (tracks) => ({ data: { ...design.data, tracks } });
	const baseIssues = copperLite(design, positions, clearance).length;
	const baseStatus = fingerprint(routingStatus(design, positions));
	const accepts = (tracks) => {
		const d = withTracks(tracks);
		return (
			copperLite(d, positions, clearance).length <= baseIssues &&
			fingerprint(routingStatus(d, positions)) === baseStatus
		);
	};
	// zero-length tracks (a via sitting on a pad centre) are junk; drop them when nothing depends on them
	const degenerate = (t) =>
		t.points.every((p) => p[0] === t.points[0][0] && p[1] === t.points[0][1]);
	if (original.some(degenerate)) {
		const cleaned = original.filter((t) => !degenerate(t));
		if (accepts(cleaned)) {
			removed = original.length - cleaned.length;
			original = cleaned;
		}
	}
	const cuts = original.map((t) => chamferTrack(t, cut));
	const totalCorners = cuts.reduce((s, c) => s + c.corners, 0);
	if (totalCorners === 0)
		return {
			tracks: original,
			corners: 0,
			tracksChanged: 0,
			reverted: 0,
			removed,
		};
	const all = cuts.map((c) => c.track);
	if (accepts(all))
		return {
			tracks: all,
			corners: totalCorners,
			tracksChanged: cuts.filter((c) => c.corners).length,
			reverted: 0,
			removed,
		};
	// find the offenders one track at a time
	const result = [...original];
	let corners = 0;
	let tracksChanged = 0;
	let reverted = 0;
	cuts.forEach((c, i) => {
		if (!c.corners) return;
		const trial = [...result];
		trial[i] = c.track;
		if (accepts(trial)) {
			result[i] = c.track;
			corners += c.corners;
			tracksChanged++;
		} else reverted++;
	});
	return { tracks: result, corners, tracksChanged, reverted, removed };
}
