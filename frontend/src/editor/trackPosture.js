import { constrainAngle } from "./routingModel.js";

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
