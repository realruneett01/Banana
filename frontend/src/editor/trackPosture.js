import { constrainAngle, proposeRoute } from "./routingModel.js";

const MODES = Object.freeze(["straight-first", "diagonal-first"]);

/**
 * KiCad-style 45-degree posture. constrainAngle (the router's existing 45-degree mode) gives the
 * straight-first corner; diagonal-first is the opposite corner of the same parallelogram
 * (c1 + c2 = start + end).
 */
export function posture45(start, end, mode = "straight-first") {
	const legs = constrainAngle(start, end, "45");
	if (legs.length < 2) return [start, end];
	const [cx, cy] = legs[0];
	const corner =
		mode === "diagonal-first"
			? [start[0] + end[0] - cx, start[1] + end[1] - cy]
			: [cx, cy];
	return [start, corner, end];
}

export function togglePosture(mode) {
	const idx = MODES.indexOf(mode);
	return MODES[(idx + 1) % MODES.length];
}

/**
 * Corner points of the pending route leg (start excluded), honouring the posture in 45-degree
 * mode. Preview and commit both use this so the drawn track always matches the preview.
 */
export function legPoints(start, target, routeMode, posture) {
	if (routeMode === "45") return posture45(start, target, posture).slice(1);
	return constrainAngle(start, target, routeMode);
}

/**
 * proposeRoute over the posture path: each leg is already 45/90-aligned, so proposeRoute keeps it
 * as one straight segment; collision segment indices are remapped to the full path.
 */
export function proposePostureRoute(options, posture) {
	const { start, cursor, mode } = options;
	const legs = legPoints(start, cursor, mode, posture);
	const points = [[start[0], start[1]], ...legs];
	const collisions = legs.flatMap((end, i) =>
		proposeRoute({
			...options,
			start: points[i],
			cursor: end,
			mode: "45",
		}).collisions.map((c) => ({ ...c, segmentIndex: i })),
	);
	return { points, collisions };
}
